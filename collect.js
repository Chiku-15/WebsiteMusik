#!/usr/bin/env node
/**
 * collect.js — Pemantau YouTube (versi GitHub)
 * Mengumpulkan statistik channel & video lalu menyimpannya ke data/.
 *
 * Mode:
 *  1) API (disarankan)  : set GitHub Secret YT_API_KEY → pakai YouTube Data API v3 (hemat kuota).
 *  2) Scraping (cadangan): tanpa API key → baca halaman publik YouTube.
 *
 * Jalankan: node collect.js
 * Jadwal: lihat .github/workflows/collect.yml (2x sehari).
 */

const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, "config.json"), "utf-8"));
const API_KEY = process.env.YT_API_KEY || "";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const HISTORY_CAP = 4000; // maksimum titik data per video/channel
const DISCOVERY_PAGES = 4; // halaman playlist uploads yang discan utk video baru (50/hal)
const WAYBACK_MAX_VIDEOS = 25; // budget video yang dibackfill dari Wayback Machine per putaran
const WAYBACK_PER_VIDEO = 6; // maksimum snapshot arsip yang diambil per video
const WAYBACK_SLEEP_MS = 1100; // jeda sopan antar permintaan ke web.archive.org

// ---------- util ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function log(...a) {
  console.log(new Date().toISOString(), ...a);
}

async function retry(fn, tries = 4, base = 1200) {
  let err;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      err = e;
      const wait = base * Math.pow(2, i);
      log(`  retry ${i + 1}/${tries} setelah error: ${String(e).slice(0, 160)} — tunggu ${Math.round(wait / 1000)}s`);
      await sleep(wait);
    }
  }
  throw err;
}

async function fetchText(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", ...(opts.headers || {}) },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url.slice(0, 90)}`);
  return res.text();
}

async function fetchJSON(url, opts = {}) {
  const t = await fetchText(url, opts);
  return JSON.parse(t);
}

function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), "utf-8"));
  } catch {
    return fallback;
  }
}

function writeJSON(file, obj) {
  const full = path.join(DATA_DIR, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, JSON.stringify(obj, null, 1));
}

function sameWIBDay(t1, t2) {
  const f = (t) => new Date(t * 1000).toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
  return f(t1) === f(t2);
}

function appendHistory(history, point) {
  const last = history[history.length - 1];
  if (last) {
    if (last.e !== 1 && point.e === 1) return false; // estimasi tidak pernah menimpa data terukur
    if (sameWIBDay(last.t, point.t)) {
      // granularitas harian: simpan satu titik terbaru per hari (timpa estimasi dgn data nyata)
      if (point.t > last.t || (last.e === 1 && point.e !== 1)) {
        history[history.length - 1] = point;
        return true;
      }
      return false;
    }
    if (point.t - last.t < 30 * 60) return false; // dedupe < 30 menit
  }
  history.push(point);
  if (history.length > HISTORY_CAP) history.splice(0, history.length - HISTORY_CAP);
  return true;
}

/* pastikan estimasi sebelum titik terukur tidak melebihi nilai terukur (kurva tetap naik) */
function clampEstimates(history) {
  for (let i = history.length - 2; i >= 0; i--) {
    if (history[i].e !== 1) break;
    if (history[i].v > history[i + 1].v) history[i].v = history[i + 1].v;
    else break;
  }
}

/* gabungkan titik terukur (dari API/scrape) ke dalam seri harian, urut + monoton.
 * Dalam satu hari kalender WIB: titik terukur selalu menggantikan estimasi. */
function mergeHistory(series, keptReal) {
  const map = new Map();
  for (const p of series) map.set(p.t, p);
  const dayKey = (t) => new Date(t * 1000).toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
  const dayIdx = new Map();
  for (const t of map.keys()) {
    const k = dayKey(t);
    if (!dayIdx.has(k)) dayIdx.set(k, []);
    dayIdx.get(k).push(t);
  }
  const reals = [...(keptReal || [])].filter((p) => p && p.e !== 1).sort((a, b) => a.t - b.t);
  for (const p of reals) {
    const k = dayKey(p.t);
    for (const t of dayIdx.get(k) || []) map.delete(t); // buang estimasi & titik lama di hari yg sama
    dayIdx.set(k, [p.t]);
    map.set(p.t, { ...p, e: 0 });
  }
  const out = [...map.values()].sort((a, b) => a.t - b.t);
  for (let i = out.length - 2; i >= 0; i--) {
    if (out[i].v > out[i + 1].v) out[i].v = out[i + 1].v;
  }
  if (out.length > HISTORY_CAP) out.splice(0, out.length - HISTORY_CAP);
  return out;
}

/*
 * buildEstimatedSeries — buat riwayat harian ESTIMASI (e:1) dari tanggal rilis s/d hari
 * sebelum pengukuran, di-anchor supaya kumulatif hari ini = currentV.
 * Model dua fase: spike awal peluruhan geometris (rasio hari-60 = k), lalu ekor panjang r2.
 */
function buildEstimatedSeries(publishedISO, currentV, measuredT, opts = {}) {
  const out = [];
  if (!publishedISO || !currentV || currentV <= 0) return out;
  const t0 = new Date(publishedISO + "T00:00:00+07:00").getTime() / 1000;
  if (!isFinite(t0) || t0 >= measuredT) return out;
  const elapsed = (measuredT - t0) / 86400;
  const D = Math.floor(elapsed);          // hari penuh yang sudah lewat (hari berjalan = D)
  const frac = Math.max(0.05, Math.min(1, elapsed - D));
  if (D < 2) return out;
  const k = opts.k ?? 0.18;
  const r2 = opts.r2 ?? 0.9985;
  const r1 = Math.pow(k, 1 / 60);
  const w = [];
  for (let d = 0; d <= D; d++) w.push(d < 60 ? Math.pow(r1, d) : Math.pow(r1, 60) * Math.pow(r2, d - 60));
  // normalisasi: hari berjalan baru sebagian terpakai saat pengukuran
  let total = 0;
  for (let d = 0; d < D; d++) total += w[d];
  total += w[D] * frac;
  let cum = 0;
  for (let d = 0; d < D; d++) {
    cum += w[d];
    out.push({ t: t0 + (d + 1) * 86400 - 1, v: Math.round((currentV * cum) / total), l: null, e: 1 });
  }
  return out;
}

/*
 * buildAnchoredSeries — seperti di atas, tapi titik SNAPSHOT ARSIP (Wayback) dipakai
 * sebagai jangkar nyata (e:0); antar jangkar diinterpolasi geometrik (e:1).
 */
function buildAnchoredSeries(publishedISO, anchors, currentV, measuredT) {
  if (!publishedISO || !currentV || currentV <= 0) return [];
  const t0 = new Date(publishedISO + "T00:00:00+07:00").getTime() / 1000;
  if (!isFinite(t0) || t0 >= measuredT) return [];
  const model = buildEstimatedSeries(publishedISO, currentV, measuredT);
  const nodes = [];
  if (model.length) nodes.push({ t: model[0].t, v: model[0].v, e: 1 });
  const sorted = [...(anchors || [])].sort((a, b) => a.t - b.t);
  for (const a of sorted) {
    const lastN = nodes[nodes.length - 1];
    const minT = lastN ? lastN.t : t0;
    const minV = lastN ? lastN.v : 0;
    if (a.t <= minT || a.v <= minV || a.v >= currentV) continue;
    nodes.push({ t: a.t, v: a.v, e: 0 });
  }
  nodes.push({ t: measuredT, v: currentV, e: 0 });
  const out = [];
  for (let i = 0; i < nodes.length; i++) {
    if (i > 0) {
      const b = nodes[i - 1], a = nodes[i];
      const days = Math.max(1, Math.round((a.t - b.t) / 86400));
      for (let d = 1; d < days; d++) {
        const t = b.t + d * 86400 - 1;
        if (t >= a.t) break;
        out.push({ t, v: Math.round(b.v * Math.pow(a.v / b.v, d / days)), l: null, e: 1 });
      }
    }
    out.push({ t: nodes[i].t, v: nodes[i].v, l: null, e: nodes[i].e });
  }
  return out;
}

/* ---------- backfill dari Wayback Machine (berjalan di GitHub Actions) ---------- */
function parseViewCountFromPage(html) {
  let m = /"viewCount":"(\d+)"/.exec(html);
  if (m) return parseInt(m[1], 10);
  m = /itemprop="interactionCount" content="(\d+)"/.exec(html);
  if (m) return parseInt(m[1], 10);
  m = /"viewCount":\{"simpleText":"([\d,.]+)\s*views?"/.exec(html);
  if (m) return parseInt(m[1].replace(/[,.]/g, ""), 10) || null;
  m = /([\d,]{4,})\s+views/.exec(html);
  if (m) return parseInt(m[1].replace(/,/g, ""), 10) || null;
  return null;
}

function cdxTsToEpoch(ts) {
  const s = String(ts).padEnd(14, "0");
  const y = +s.slice(0, 4), mo = +s.slice(4, 6) - 1, d = +s.slice(6, 8);
  const h = +s.slice(8, 10), mi = +s.slice(10, 12), se = +s.slice(12, 14);
  return Math.floor(Date.UTC(y, mo, d, h, mi, se) / 1000);
}

async function waybackAnchors(vid, publishedISO) {
  const from = (publishedISO || "").replace(/-/g, "");
  const cdx =
    `https://web.archive.org/cdx/search/cdx?url=youtube.com%2Fwatch%3Fv%3D${vid}` +
    `&output=json&fl=timestamp,statuscode&filter=statuscode:200&collapse=timestamp:6&limit=-40` +
    (from ? `&from=${from}` : "");
  let rows;
  try {
    rows = JSON.parse(await fetchText(cdx, { headers: { "User-Agent": "pemantau-yt/1.0" } }));
  } catch (e) {
    log(`  CDX gagal (${String(e).slice(0, 80)}) — Wayback dinonaktifkan untuk putaran ini`);
    return null; // sinyal: archive.org tak terjangkau
  }
  if (!Array.isArray(rows) || rows.length < 2) return [];
  const list = rows.slice(1).filter((r) => r[1] === "200").map((r) => r[0]);
  if (!list.length) return [];
  const picked = new Set();
  const n = Math.min(WAYBACK_PER_VIDEO, list.length);
  for (let i = 0; i < n; i++) {
    const idx = Math.round((i * (list.length - 1)) / Math.max(1, n - 1));
    picked.add(list[idx]);
  }
  const anchors = [];
  for (const ts of picked) {
    try {
      const html = await fetchText(`https://web.archive.org/web/${ts}id_/https://www.youtube.com/watch?v=${vid}`);
      const v = parseViewCountFromPage(html);
      if (v && v > 0) anchors.push({ t: cdxTsToEpoch(ts), v });
    } catch (e) {
      log(`  snapshot ${ts} gagal: ${String(e).slice(0, 70)}`);
    }
    await sleep(WAYBACK_SLEEP_MS);
  }
  return anchors;
}

async function backfillFromWayback(videos, now) {
  let budget = WAYBACK_MAX_VIDEOS;
  let archiveAlive = true;
  let done = 0;
  for (const [id, rec] of Object.entries(videos)) {
    if (budget <= 0 || !archiveAlive) break;
    if (!rec.published || !rec.history || !rec.history.length) continue;
    if (rec.history.filter((p) => p.e !== 1).length >= 3) continue; // sudah cukup data nyata
    const marker = `backfill/${id}.json`;
    if (readJSON(marker, null)) continue; // sudah pernah dicoba
    budget--;
    try {
      const last = rec.history[rec.history.length - 1];
      const anchors = await waybackAnchors(id, rec.published);
      if (anchors === null) { archiveAlive = false; break; }
      if (anchors.length) {
        const series = buildAnchoredSeries(rec.published, anchors, last.v, last.t);
        if (series.length > 3) {
          const keptReal = rec.history.filter((p) => p.e !== 1);
          rec.history = mergeHistory(series, keptReal);
          done++;
          log(`backfill ${id}: ${anchors.length} jangkar arsip → ${rec.history.length} titik`);
        }
      }
      writeJSON(marker, { done: true, at: now, anchors: anchors.length });
    } catch (e) {
      log(`! backfill ${id} gagal: ${String(e).slice(0, 90)}`);
    }
  }
  if (done) log(`backfill Wayback selesai: ${done} video (budget ${WAYBACK_MAX_VIDEOS}/putaran)`);
}

function isoDurationToSeconds(iso) {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || "");
  if (!m) return null;
  const [, d, h, mi, s] = m.map((x) => (x ? parseInt(x, 10) : 0));
  return ((d || 0) * 24 + (h || 0)) * 3600 + (mi || 0) * 60 + (s || 0);
}

// ---------- klasifikasi judul ----------
const RE_EXCLUDE =
  /out now|watch now|hits? \d+|teaser|trailer|making|behind the|reaction|highlight|special program|countdown|spoiler|mashup|preview\b|episode\b|ep\.\s*\d|回应|shorts\b/i;
const RE_MV = /\bm\s*\/\s*v\b/i;
const RE_PRACTICE = /dance\s*practice|practice\s*video|stage\s*practice/i;
const RE_PERFORMANCE = /performance|choreography/i;

function classifyTitle(title) {
  if (!title || RE_EXCLUDE.test(title)) return null;
  if (RE_MV.test(title)) return "mv";
  if (RE_PRACTICE.test(title)) return "dance_practice";
  if (RE_PERFORMANCE.test(title)) return "dance_performance";
  return null;
}

// ---------- mode API ----------
async function apiChannels(ids) {
  const url =
    `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&id=${ids.join(",")}&key=${API_KEY}`;
  const j = await fetchJSON(url);
  const map = new Map();
  for (const item of j.items || []) map.set(item.id, item);
  return map;
}

async function apiPlaylistRecent(uploadsId, pages) {
  const ids = [];
  let pageToken = "";
  for (let p = 0; p < pages; p++) {
    const url =
      `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&maxResults=50` +
      `&playlistId=${uploadsId}&key=${API_KEY}${pageToken ? `&pageToken=${pageToken}` : ""}`;
    const j = await fetchJSON(url);
    for (const it of j.items || []) {
      const vid = it.contentDetails?.videoId;
      const title = it.snippet?.title;
      if (vid && title) ids.push({ id: vid, title });
    }
    pageToken = j.nextPageToken;
    if (!pageToken) break;
  }
  return ids;
}

async function apiVideos(ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const url =
      `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails` +
      `&id=${batch.join(",")}&key=${API_KEY}`;
    const j = await fetchJSON(url);
    for (const it of j.items || []) out.push(it);
  }
  return out;
}

async function collectAPI() {
  log("Mode: API YouTube Data v3");
  const videos = readJSON("videos.json", {});
  const channels = readJSON("channels.json", {});
  const now = Math.floor(Date.now() / 1000);

  // 1) channel stats
  const chanIds = CONFIG.artists.map((a) => a.channel_id);
  const chanMap = await retry(() => apiChannels(chanIds));
  for (const artist of CONFIG.artists) {
    const it = chanMap.get(artist.channel_id);
    if (!it) {
      log(`! Channel tidak ditemukan: ${artist.name} (${artist.channel_id})`);
      continue;
    }
    const st = it.statistics || {};
    const ch = channels[artist.id] || { channel_id: artist.channel_id, name: artist.name, handle: artist.handle };
    ch.channel_id = artist.channel_id;
    ch.name = artist.name;
    ch.handle = artist.handle;
    ch.avatar =
      it.snippet?.thumbnails?.high?.url ||
      it.snippet?.thumbnails?.default?.url ||
      ch.avatar ||
      null;
    ch.history = ch.history || [];
    const point = {
      t: now,
      s: parseInt(st.subscriberCount || "0", 10),
      v: parseInt(st.viewCount || "0", 10),
      c: parseInt(st.videoCount || "0", 10),
    };
    if (appendHistory(ch.history, point)) log(`channel ${artist.name}: subs=${point.s} views=${point.v}`);
    channels[artist.id] = ch;
  }

  // 2) discovery video baru dari playlist uploads terbaru
  let configChanged = false;
  for (const artist of CONFIG.artists) {
    const uploadsId = "UU" + artist.channel_id.slice(2);
    const known = new Set(artist.videos.map((v) => v.id));
    let recent = [];
    try {
      recent = await retry(() => apiPlaylistRecent(uploadsId, DISCOVERY_PAGES));
    } catch (e) {
      log(`! Gagal baca playlist uploads ${artist.name}: ${e}`);
    }
    const exclude = new Set(artist.exclude_ids || []);
    for (const r of recent) {
      if (known.has(r.id) || exclude.has(r.id) || videos[r.id]) continue;
      const cat = classifyTitle(r.title);
      if (!cat) continue;
      artist.videos.push({ id: r.id, category: cat, featured: false, discovered: true });
      known.add(r.id);
      configChanged = true;
      log(`+ video baru terdeteksi: ${artist.name} — ${r.title}`);
    }
  }

  // 3) statistik semua video terpantau
  const allIds = [];
  for (const artist of CONFIG.artists) for (const v of artist.videos) allIds.push(v.id);
  const metaById = new Map();
  for (const artist of CONFIG.artists) {
    for (const v of artist.videos) metaById.set(v.id, { artist: artist.id, category: v.category, featured: !!v.featured });
  }
  const items = await retry(() => apiVideos(allIds));
  let updated = 0;
  for (const it of items) {
    const meta = metaById.get(it.id);
    if (!meta) continue;
    const st = it.statistics || {};
    const rec = videos[it.id] || {
      title: it.snippet?.title,
      channel: meta.artist,
      category: meta.category,
      featured: meta.featured,
      published: (it.snippet?.publishedAt || "").slice(0, 10),
      duration: isoDurationToSeconds(it.contentDetails?.duration),
      history: [],
    };
    rec.title = it.snippet?.title || rec.title;
    rec.duration = isoDurationToSeconds(it.contentDetails?.duration) || rec.duration;
    rec.published = (it.snippet?.publishedAt || rec.published || "").slice(0, 10);
    rec.history = rec.history || [];
    if (appendHistory(rec.history, {
      t: now,
      v: parseInt(st.viewCount || "0", 10) || 0,
      l: parseInt(st.likeCount || "0", 10) || 0,
    })) updated++;
    clampEstimates(rec.history);
    videos[it.id] = rec;
  }
  log(`video diperbarui: ${updated}/${allIds.length}`);

  try { await backfillFromWayback(videos, now); } catch (e) { log(`! modul backfill: ${e}`); }

  writeJSON("videos.json", videos);
  writeJSON("channels.json", channels);
  if (configChanged) {
    fs.writeFileSync(path.join(ROOT, "config.json"), JSON.stringify(CONFIG, null, 2));
    log("config.json diperbarui (video baru)");
  }
  return { videos: Object.keys(videos).length, channels: Object.keys(channels).length, mode: "api" };
}

// ---------- mode scraping (cadangan, tanpa API key) ----------
function extractYtInitialData(html) {
  let m = /var ytInitialData\s*=\s*(\{.*?\});/.exec(html);
  if (!m) m = /window\["ytInitialData"\]\s*=\s*(\{.*?\});/.exec(html);
  return m ? JSON.parse(m[1]) : null;
}

function collectRenderers(node, out) {
  if (Array.isArray(node)) {
    for (const n of node) collectRenderers(n, out);
  } else if (node && typeof node === "object") {
    if (node.playlistVideoRenderer) out.push(node.playlistVideoRenderer);
    if (node.lockupViewModel) out.push(node.lockupViewModel);
    for (const k of Object.keys(node)) collectRenderers(node[k], out);
  }
}

function textOf(n) {
  if (!n) return "";
  if (typeof n === "string") return n;
  if (n.simpleText) return n.simpleText;
  if (n.content) return n.content;
  if (Array.isArray(n.runs)) return n.runs.map((r) => r.text || "").join("");
  return "";
}

function parseShortCount(s) {
  const m = /([\d.,]+)\s*([KMB])?/i.exec((s || "").replace(/,/g, ""));
  if (!m) return null;
  const mult = { k: 1e3, m: 1e6, b: 1e9 }[(m[2] || "").toLowerCase()] || 1;
  return Math.round(parseFloat(m[1]) * mult);
}

async function scrapeChannel(handle) {
  const html = await fetchText(`https://www.youtube.com/${handle}/about?hl=en&gl=US`);
  const out = {};
  let m = /<meta property="og:image" content="([^"]+)"/.exec(html);
  if (m) out.avatar = m[1];
  m = /"subscriberCountText":"([\d.,KM]+)\s*subscribers?"/.exec(html);
  if (m) out.subs = parseShortCount(m[1]);
  m = /"viewCountText":"([\d,]+)\s*views?"/.exec(html);
  if (m) out.views = parseInt(m[1].replace(/,/g, ""), 10);
  m = /"videoCountText":"([\d,]+)\s*videos?"/.exec(html);
  if (m) out.videos = parseInt(m[1].replace(/,/g, ""), 10);
  return out;
}

async function scrapePlaylistPage(plId, continuation, clientVersion) {
  let html;
  if (!continuation) {
    html = await fetchText(`https://www.youtube.com/playlist?list=${plId}&hl=en&gl=US`);
  } else {
    const body = {
      context: { client: { clientName: "WEB", clientVersion: clientVersion || "2.20260101.00.00", hl: "en", gl: "US" } },
      continuation,
    };
    html = await fetchText("https://www.youtube.com/youtubei/v1/browse?prettyPrint=false", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }
  const data = extractYtInitialData(html);
  if (!data) return { items: [], tokens: [], clientVersion };
  const cv = /"clientVersion":"([\d.]+)"/.exec(html);
  const rends = [];
  collectRenderers(data, rends);
  const tokens = [];
  (function findTok(n) {
    if (Array.isArray(n)) return n.forEach(findTok);
    if (n && typeof n === "object") {
      if (n.continuationCommand && n.continuationCommand.token) tokens.push(n.continuationCommand.token);
      for (const k of Object.keys(n)) findTok(n[k]);
    }
  })(data);
  const items = [];
  for (const r of rends) {
    if (r.videoId) {
      items.push({ id: r.videoId, title: textOf(r.title), viewsText: textOf(r.viewCountText || r.shortViewCountText) });
    } else if (r.contentId) {
      const meta = r.metadata || {};
      const title = textOf(meta.lockupMetadataViewModel?.title);
      let viewsText = "";
      (function scan(n) {
        if (Array.isArray(n)) return n.forEach(scan);
        if (n && typeof n === "object") {
          const c = n.text && typeof n.text === "object" ? n.text.content : null;
          if (c && /views?|ditonton/i.test(c)) viewsText = viewsText || c;
          for (const k of Object.keys(n)) scan(n[k]);
        }
      })(meta);
      items.push({ id: r.contentId, title, viewsText });
    }
  }
  return { items, tokens, clientVersion: cv ? cv[1] : clientVersion };
}

async function scrapeVideo(vid) {
  // coba endpoint player (ringan), lalu halaman watch
  try {
    const body = {
      context: { client: { clientName: "WEB", clientVersion: "2.20260101.00.00", hl: "en", gl: "US" } },
      videoId: vid,
    };
    const j = await fetchJSON("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const vd = j.videoDetails || {};
    if (vd.viewCount) {
      const mf = j.microformat?.playerMicroformatRenderer || {};
      return {
        title: vd.title,
        views: parseInt(vd.viewCount, 10),
        likes: null,
        duration: parseInt(vd.lengthSeconds || "0", 10) || null,
        published: (mf.publishDate || mf.uploadDate || "").slice(0, 10) || null,
      };
    }
  } catch (e) {
    log(`  player gagal utk ${vid}: ${String(e).slice(0, 80)}`);
  }
  const html = await fetchText(`https://www.youtube.com/watch?v=${vid}&hl=en&gl=US`, {
    headers: { Cookie: "CONSENT=YES+cb; SOCS=CAI" },
  });
  let title = null, views = null, likes = null, duration = null, published = null;
  const m = /var ytInitialPlayerResponse\s*=\s*(\{.*?\});/.exec(html);
  if (m) {
    try {
      const pr = JSON.parse(m[1]);
      const vd = pr.videoDetails || {};
      title = vd.title;
      views = parseInt(vd.viewCount || "0", 10) || null;
      duration = parseInt(vd.lengthSeconds || "0", 10) || null;
      const mf = pr.microformat?.playerMicroformatRenderer || {};
      published = (mf.publishDate || mf.uploadDate || "").slice(0, 10) || null;
    } catch {}
  }
  const lm = /"accessibilityText":"([\d,.]+\s*(?:K|M|B)?)\s*likes?"/.exec(html) ||
    /"likeCount":"?(\d+)"?/.exec(html);
  if (lm) likes = parseShortCount(lm[1]) || parseInt(lm[1], 10);
  if (!title) {
    const t = /<meta name="title" content="([^"]+)"/.exec(html);
    if (t) title = t[1];
  }
  if (!views) {
    const v = /"viewCount":"(\d+)"/.exec(html);
    if (v) views = parseInt(v[1], 10);
  }
  return { title, views, likes, duration, published };
}

async function collectScrape() {
  log("Mode: scraping publik (tanpa API key) — lebih lambat & kurang presisi");
  const videos = readJSON("videos.json", {});
  const channels = readJSON("channels.json", {});
  const now = Math.floor(Date.now() / 1000);

  for (const artist of CONFIG.artists) {
    let info = {};
    try {
      info = await retry(() => scrapeChannel(artist.handle));
    } catch (e) {
      log(`! gagal channel ${artist.name}: ${e}`);
    }
    const ch = channels[artist.id] || { channel_id: artist.channel_id, name: artist.name, handle: artist.handle };
    Object.assign(ch, { channel_id: artist.channel_id, name: artist.name, handle: artist.handle });
    if (info.avatar) ch.avatar = info.avatar;
    ch.history = ch.history || [];
    appendHistory(ch.history, { t: now, s: info.subs ?? null, v: info.views ?? null, c: info.videos ?? null });
    channels[artist.id] = ch;
    log(`channel ${artist.name}: ${JSON.stringify(info).slice(0, 120)}`);
    writeJSON("channels.json", channels); // simpan cepat agar data channel tetap aman
    await sleep(800);
  }

  const total = CONFIG.artists.reduce((n, a) => n + a.videos.length, 0);
  let i = 0;
  for (const artist of CONFIG.artists) {
    for (const v of artist.videos) {
      i++;
      let d;
      try {
        d = await retry(() => scrapeVideo(v.id), 3, 2000);
      } catch (e) {
        log(`[${i}/${total}] gagal ${v.id}: ${e}`);
        await sleep(1500);
        continue;
      }
      if (!d.views) {
        log(`[${i}/${total}] kosong ${v.id}`);
        await sleep(1200);
        continue;
      }
      const rec = videos[v.id] || {
        title: d.title,
        channel: artist.id,
        category: v.category,
        featured: !!v.featured,
        published: d.published,
        duration: d.duration,
        history: [],
      };
      if (d.title) rec.title = d.title;
      if (d.published) rec.published = d.published;
      if (d.duration) rec.duration = d.duration;
      rec.history = rec.history || [];
      appendHistory(rec.history, { t: now, v: d.views, l: d.likes });
      clampEstimates(rec.history);
      videos[v.id] = rec;
      log(`[${i}/${total}] ${v.id} v=${d.views} l=${d.likes}`);
      await sleep(700);
    }
  }

  try { await backfillFromWayback(videos, now); } catch (e) { log(`! modul backfill: ${e}`); }

  writeJSON("videos.json", videos);
  writeJSON("channels.json", channels);
  return { videos: Object.keys(videos).length, channels: Object.keys(channels).length, mode: "scrape" };
}

// ---------- main ----------
async function main() {
  const started = Date.now();
  let result;
  try {
    result = API_KEY ? await collectAPI() : await collectScrape();
  } catch (e) {
    console.error("GAGAL:", e);
    process.exitCode = 1;
    result = null;
  }
  if (result) {
    writeJSON("meta.json", {
      last_updated: Math.floor(Date.now() / 1000),
      mode: result.mode,
      duration_sec: Math.round((Date.now() - started) / 1000),
      quota_note: API_KEY ? "pakai YouTube Data API v3" : "scraping publik",
    });
    log(`selesai dalam ${Math.round((Date.now() - started) / 1000)}s — videos=${result.videos} channels=${result.channels}`);
  }
  return result;
}

if (require.main === module) main();

module.exports = {
  appendHistory, clampEstimates, mergeHistory, buildEstimatedSeries, buildAnchoredSeries,
  backfillFromWayback, waybackAnchors, classifyTitle, parseShortCount, scrapePlaylistPage,
  CONFIG, API_KEY, DATA_DIR,
};
