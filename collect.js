#!/usr/bin/env node
/**
 * collect.js — Pemantau YouTube (versi GitHub)
 * Mengumpulkan statistik channel & video lalu menyimpannya ke data/.
 *
 * Mode:
 *  1) API (disarankan)  : set GitHub Secret YOUTUBE_API_KEY → pakai YouTube Data API v3 (hemat kuota).
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
const API_KEY = process.env.YOUTUBE_API_KEY || "";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const HISTORY_CAP = 4000; // maksimum titik data per video/channel
const DISCOVERY_PAGES = 4; // halaman playlist uploads yang discan utk video baru (50/hal)

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
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(obj, null, 1));
}

function appendHistory(history, point) {
  const last = history[history.length - 1];
  if (last && point.t - last.t < 30 * 60) return false; // dedupe < 30 menit
  history.push(point);
  if (history.length > HISTORY_CAP) history.splice(0, history.length - HISTORY_CAP);
  return true;
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
    videos[it.id] = rec;
  }
  log(`video diperbarui: ${updated}/${allIds.length}`);

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
      videos[v.id] = rec;
      log(`[${i}/${total}] ${v.id} v=${d.views} l=${d.likes}`);
      await sleep(700);
    }
  }

  writeJSON("videos.json", videos);
  writeJSON("channels.json", channels);
  return { videos: Object.keys(videos).length, channels: Object.keys(channels).length, mode: "scrape" };
}

// ---------- main ----------
(async () => {
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
})();
