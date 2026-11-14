#!/usr/bin/env node
/**
 * collect_social.js — pengumpul data sosial media, chart, berita & anomali
 * untuk situs Pemantau K-POP PULSE (dijalankan setelah collect.js).
 *
 * Output:
 *   data/social.json    — follower Instagram / X (Twitter) / TikTok per grup
 *   data/charts.json    — posisi Billboard Global 200, Melon Top 100, Genie Top 200
 *   data/news.json      — berita terbaru yang menyebut BABYMONSTER / TREASURE
 *   data/anomalies.json — log lonjakan views tak biasa (>= 2,5x median harian)
 *
 * Sumber (semua publik, tanpa API key):
 *   - Instagram : web_profile_info (angka persis) → og:description (angka bulat, ditandai aprox)
 *   - X         : mirror Nitter (xcancel/lightbrd/nitter.net) → r.jina.ai (aprox)
 *   - TikTok    : halaman profil @user → JSON "followerCount"
 *   - Weverse   : jumlah follower TIDAK dipublikasikan via web publik — kartu link saja
 *   - Billboard : halaman chart (baris server-rendered)
 *   - Melon     : halaman chart (sering menolak datacenter IP — boleh gagal, dilewati halus)
 *   - Genie     : halaman chart Top 200 (parsing tabel)
 *   - Berita    : RSS Soompi, Koreaboo, Kbizoom (tag per artis)
 *
 * Prinsip: SEMUA pengambilan dibungkus try — kalau satu sumber gagal, sumber lain
 * tetap jalan dan data lama tidak ditimpa. Angka dari sumber dibulatkan ditandai
 * "approx": true. Angka manual bisa diisi lewat data/social-override.json (opsional).
 *
 * Antisipasi rate-limit: sosial min. tiap 6 jam, Billboard tiap 12 jam,
 * chart Korea tiap 6 jam, berita tiap 1 jam (variabel env SOCIAL_H / BILLBOARD_H /
 * KOREA_H / NEWS_H bisa mengubahnya).
 */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const DATA = path.join(ROOT, "data");
if (!fs.existsSync(DATA)) fs.mkdirSync(DATA, { recursive: true });
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, "config.json"), "utf8"));

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const GBOOT = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const now = () => Math.floor(Date.now() / 1000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SOCIAL_MIN_H = parseFloat(process.env.SOCIAL_H || "6") || 6;
const BILLBOARD_MIN_H = parseFloat(process.env.BILLBOARD_H || "12") || 12;
const KOREA_MIN_H = parseFloat(process.env.KOREA_H || "6") || 6;
const NEWS_MIN_H = parseFloat(process.env.NEWS_H || "1") || 1;
const ANOM_RATIO = 2.5; // sama dengan fitur "lonjakan tidak biasa" di halaman Rekor
const ANOM_CAP = 300;   // maksimum log anomali disimpan
const CAP_SOCIAL = 2000;
const CAP_CHART = 1200;

/* ---------------- util ---------------- */
function log(...a) { console.log(new Date().toISOString(), ...a); }
async function fetchText(url, opts = {}, tries = 2, timeoutMs = 25000) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9,ko;q=0.8", ...(opts.headers || {}) },
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "follow",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url.slice(0, 80)}`);
      return await res.text();
    } catch (e) {
      lastErr = e;
      if (i < tries - 1) await sleep(1500);
    }
  }
  throw lastErr;
}
async function fetchJSON(url, opts = {}, tries = 2) {
  return JSON.parse(await fetchText(url, opts, tries));
}
function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA, file), "utf-8")); } catch { return fallback; }
}
function writeJSON(file, obj) {
  fs.writeFileSync(path.join(DATA, file), JSON.stringify(obj, null, 1));
}
function wibDayKey(t) {
  return new Date(t * 1000).toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
}
/* angka bulat "10.5M", "7M", "1,234,567" → number */
function parseShort(s) {
  if (!s) return null;
  const m = /([\d][\d.,]*)\s*([KMBkmb])?/.exec(String(s).trim());
  if (!m) return null;
  const mult = { k: 1e3, m: 1e6, b: 1e9 }[(m[2] || "").toLowerCase()] || 1;
  let num = m[1];
  if (/^\d{1,3}([.,]\d{3})+$/.test(num)) num = num.replace(/[.,]/g, "");
  else num = num.replace(/,/g, ".").replace(/\.(?=.*\.)/g, "");
  const v = parseFloat(num) * mult;
  return isFinite(v) ? Math.round(v) : null;
}
function decodeEntities(s) {
  return String(s || "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&#x27;/g, "'").replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(+n); } catch { return ""; } })
    .trim();
}
/* satu titik per hari WIB — titik baru di hari yang sama menimpa yang lama */
function appendDaily(history, point, cap = CAP_SOCIAL) {
  const last = history[history.length - 1];
  if (last) {
    if (wibDayKey(last.t) === wibDayKey(point.t)) {
      // titik manual > angka scraper > angka bulat
      const rank = (p) => (p.src === "manual" ? 0 : p.approx ? 2 : 1);
      if (rank(point) <= rank(last)) history[history.length - 1] = point;
      return true;
    }
    if (point.t - last.t < 20 * 3600) return false;
  }
  history.push(point);
  if (history.length > cap) history.splice(0, history.length - cap);
  return true;
}

/* ---------------- tracker sosial media ---------------- */
async function trackInstagram(user) {
  // 1) endpoint web_profile_info — angka persis
  try {
    const j = await fetchJSON(
      `https://i.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(user)}`,
      { headers: { "x-ig-app-id": "936619743392459", Accept: "*/*" } }, 1
    );
    const u = j && j.data && j.data.user;
    const f = u && u.edge_followed_by && u.edge_followed_by.count;
    if (f != null) return { f: +f, approx: false, src: "api" };
  } catch (e) { log(`  IG api gagal: ${String(e).slice(0, 90)}`); }
  // 2) og:description halaman profil — angka dibulatkan
  for (const extra of [{}, { headers: { "User-Agent": GBOOT } }]) {
    try {
      const html = await fetchText(`https://www.instagram.com/${encodeURIComponent(user)}/`, extra, 1, 20000);
      const m = /<meta property="og:description" content="([^"]+)"/.exec(html);
      if (m) {
        const mm = /([\d.,]+\s*[KMBkmb]?)\s*followers/i.exec(decodeEntities(m[1]));
        if (mm) { const f = parseShort(mm[1]); if (f) return { f, approx: true, src: "meta" }; }
      }
    } catch (e) { /* diabaikan — dicoba UA berikutnya */ }
  }
  return null;
}
async function trackTwitter(user) {
  const hosts = ["https://xcancel.com", "https://lightbrd.com", "https://nitter.net", "https://nitter.poast.org"];
  for (const h of hosts) {
    try {
      const html = await fetchText(`${h}/${encodeURIComponent(user)}`, {}, 1, 20000);
      let m = /Followers<\/span>[^0-9]{0,80}([\d.,]+\s*[KMBkmb]?)/i.exec(html)
        || /Followers:\s*<\/b>\s*([\d.,]+)/i.exec(html)
        || /([\d.,]+\s*[KMBkmb]?)\s*Followers/i.exec(html);
      if (m) { const f = parseShort(m[1]); if (f) return { f, approx: false, src: "nitter" }; }
    } catch (e) { /* coba mirror berikutnya */ }
  }
  try {
    const html = await fetchText(`https://r.jina.ai/https://x.com/${encodeURIComponent(user)}`, {}, 1, 25000);
    const m = /([\d.,]+\s*[KMBkmb]?)\s*followers/i.exec(html);
    if (m) { const f = parseShort(m[1]); if (f) return { f, approx: true, src: "jina" }; }
  } catch (e) { log(`  X jina gagal: ${String(e).slice(0, 90)}`); }
  return null;
}
async function trackTikTok(user) {
  for (const extra of [{}, { headers: { "User-Agent": GBOOT } }]) {
    try {
      const html = await fetchText(`https://www.tiktok.com/@${encodeURIComponent(user)}`, extra, 1, 25000);
      const m = /"followerCount":(\d+)/.exec(html) || /"followersCount":(\d+)/.exec(html);
      if (m) return { f: +m[1], approx: false, src: "html" };
    } catch (e) { /* coba UA berikutnya */ }
  }
  return null;
}
const TRACKERS = { instagram: trackInstagram, twitter: trackTwitter, tiktok: trackTikTok };
const PLATFORM_LABEL = { instagram: "Instagram", twitter: "X (Twitter)", tiktok: "TikTok" };

async function collectSocial() {
  const social = readJSON("social.json", null) || { _info: SOCIAL_INFO, artists: {} };
  social._info = SOCIAL_INFO;
  const last = social.updated || 0;
  const due = now() - last >= SOCIAL_MIN_H * 3600;
  for (const artist of CONFIG.artists) {
    const so = (artist.social || {});
    const rec = social.artists[artist.id] || {};
    rec.instagram = rec.instagram || (so.instagram ? { handle: so.instagram, url: `https://www.instagram.com/${so.instagram}/`, history: [] } : null);
    rec.twitter = rec.twitter || (so.twitter ? { handle: so.twitter, url: `https://x.com/${so.twitter}`, history: [] } : null);
    rec.tiktok = rec.tiktok || (so.tiktok ? { handle: so.tiktok, url: `https://www.tiktok.com/@${so.tiktok}`, history: [] } : null);
    rec.weverse = rec.weverse || (so.weverse ? { handle: so.weverse, url: `https://weverse.io/${so.weverse}`, note: "Jumlah follower Weverse tidak dipublikasikan lewat web publik — kartu ini hanya tautan." } : null);
    if (due) {
      for (const key of ["instagram", "twitter", "tiktok"]) {
        const acc = rec[key];
        if (!acc) continue;
        let got = null;
        try { got = await TRACKERS[key](acc.handle); } catch (e) { log(`  ${artist.id}/${key} error: ${String(e).slice(0, 90)}`); }
        if (got && got.f > 0) {
          acc.history = acc.history || [];
          if (appendDaily(acc.history, { t: now(), f: got.f, approx: !!got.approx, src: got.src })) {
            log(`${artist.id} ${PLATFORM_LABEL[key]}: ${got.f.toLocaleString("id-ID")}${got.approx ? " (aprox)" : ""} [${got.src}]`);
          }
        } else {
          log(`${artist.id} ${PLATFORM_LABEL[key]}: tidak ada data (semua sumber gagal)`);
        }
        await sleep(1200); // jeda sopan antar akun/platform
      }
    }
    social.artists[artist.id] = rec;
  }
  if (due) social.updated = now();
  // override manual (opsional): data/social-override.json { "babymonster": { "instagram": 10500000, "twitter": null, "tiktok": null } }
  const ov = readJSON("social-override.json", null);
  if (ov && typeof ov === "object") {
    for (const [aid, vals] of Object.entries(ov)) {
      const rec = social.artists[aid];
      if (!rec || !vals || typeof vals !== "object") continue;
      for (const key of ["instagram", "twitter", "tiktok"]) {
        const acc = rec[key];
        if (acc && Number.isFinite(vals[key]) && vals[key] > 0) {
          acc.history = acc.history || [];
          if (appendDaily(acc.history, { t: now(), f: Math.round(vals[key]), approx: false, src: "manual" })) {
            log(`${aid} ${PLATFORM_LABEL[key]}: ${Math.round(vals[key]).toLocaleString("id-ID")} [manual]`);
          }
        }
      }
    }
  }
  writeJSON("social.json", social);
  return social;
}

/* ---------------- chart Billboard Global 200 ---------------- */
const ALIAS = {
  babymonster: /babymonster|베이비몬스터/i,
  treasure: /\btreasure\b|트레저/i,
};
async function fetchBillboard() {
  const html = await fetchText("https://www.billboard.com/charts/billboard-global-200/", {}, 2, 60000);
  const mD = /charts\/billboard-global-200\/(\d{4}-\d{2}-\d{2})/.exec(html);
  const chartDate = mD ? mD[1] : wibDayKey(now());
  const parts = html.split("a-chart-result-item-container");
  if (parts.length < 100) throw new Error(`struktur Billboard berubah (container=${parts.length - 1})`);
  const rows = [];
  const strip = (s) => decodeEntities(String(s).replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
  for (let i = 2; i < parts.length; i++) {
    // sel rank baris ke-i ada di akhir chunk sebelumnya; nomor baris 1 pakai font 33, baris lain 22
    const rankSpans = [...parts[i - 1].matchAll(/<span class="c-label\s+a-font-basic u-font-size-\d+@desktop[^"]*"[^>]*>\s*(\d+)\s*<\/span>/g)];
    const rM = rankSpans.length ? rankSpans[rankSpans.length - 1] : null;
    const tM = /<h3 id="title-of-a-story"[^>]*>([\s\S]*?)<\/h3>/.exec(parts[i]);
    if (!rM || !tM) continue;
    // artis: anchor /artist/ pertama yang teksnya tidak kosong (opsional)
    let artist = "";
    for (const aM of parts[i].matchAll(/<a[^>]+href="https:\/\/www\.billboard\.com\/artist\/[^"]*"[^>]*>([\s\S]*?)<\/a>/g)) {
      const txt = strip(aM[1]);
      if (txt) { artist = txt; break; }
    }
    rows.push({ rank: +rM[1], title: strip(tM[1]), artist });
  }
  if (rows.length < 50) throw new Error(`baris Billboard terbaca ${rows.length} — parser perlu diperbarui`);
  log(`Billboard Global 200 (${chartDate}): ${rows.length} baris terbaca`);
  return { chartDate, rows };
}
async function fetchGenie() {
  // 2 halaman = Top 100 (cukup utk mendeteksi lagu artis yang masuk)
  const rows = [];
  for (const pg of [1, 2]) {
    const html = await fetchText(`https://www.genie.co.kr/chart/top200?ditc=D&pg=${pg}`, {}, 2, 30000);
    const chunks = html.split('<tr class="list"');
    for (let i = 1; i < chunks.length; i++) {
      const c = chunks[i];
      const rM = /<td class="number">\s*(\d+)/.exec(c);
      const tM = /class="title ellipsis"[^>]*>\s*([^<]+?)\s*</.exec(c);
      const aM = /class="artist ellipsis"[^>]*>\s*([^<]+?)\s*</.exec(c);
      if (!rM || !tM) continue;
      rows.push({ rank: +rM[1], title: decodeEntities(tM[1]), artist: aM ? decodeEntities(aM[1]) : "" });
    }
    await sleep(1200);
  }
  if (rows.length < 100) throw new Error(`baris Genie terbaca ${rows.length}`);
  log(`Genie Top 100: ${rows.length} baris terbaca`);
  return { chartDate: wibDayKey(now()), rows };
}
/* Melon sering menolak IP datacenter — best effort, boleh gagal */
async function fetchMelon() {
  const html = await fetchText(
    "https://www.melon.com/chart/index.htm",
    { headers: { Referer: "https://www.melon.com/new/index.htm", Accept: "text/html,application/xhtml+xml" } },
    1, 30000
  );
  const rows = [];
  const chunks = html.split(/<tr/).slice(1);
  for (const c of chunks) {
    const rM = /<span class="rank">\s*(\d+)\s*<\/span>/.exec(c);
    const tM = /<div class="wrap_song_info">[\s\S]*?<a[^>]*>([^<]+)<\/a>/.exec(c)
      || /<a[^>]*class="ellipsis"[^>]*>([^<]+)<\/a>/.exec(c);
    const aM = /class="ellipsis artist"[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>/.exec(c);
    if (!rM || !tM) continue;
    rows.push({ rank: +rM[1], title: decodeEntities(tM[1]), artist: aM ? decodeEntities(aM[1]) : "" });
  }
  if (rows.length < 50) throw new Error(`baris Melon terbaca ${rows.length}`);
  log(`Melon Top 100: ${rows.length} baris terbaca`);
  return { chartDate: wibDayKey(now()), rows };
}

function applyChart(charts, key, meta, data) {
  const ch = charts.charts[key] || { label: meta.label, url: meta.url, artists: {} };
  ch.label = meta.label; ch.url = meta.url;
  ch.chartDate = data.chartDate;
  ch.updated = now();
  ch.lastError = null;
  for (const artist of CONFIG.artists) {
    const hit = data.rows.find((r) => ALIAS[artist.id] && ALIAS[artist.id].test(r.artist));
    const rec = ch.artists[artist.id] || { history: [], best: null };
    if (hit) {
      const pt = {
        t: now(), rank: hit.rank, title: hit.title,
        lw: meta.lw ? hit.lw : undefined, peak: hit.peak,
      };
      // satu titik per periode chart (mingguan/harian) — pakai chartDate sbg kunci hari
      const lastPt = rec.history[rec.history.length - 1];
      if (!lastPt || wibDayKey(lastPt.t) !== wibDayKey(pt.t) || lastPt.title !== pt.title) {
        rec.history.push(pt);
        if (rec.history.length > CAP_CHART) rec.history.splice(0, rec.history.length - CAP_CHART);
      } else {
        rec.history[rec.history.length - 1] = pt;
      }
      if (!rec.best || hit.rank < rec.best.rank) {
        rec.best = { rank: hit.rank, title: hit.title, t: now(), date: data.chartDate };
      }
      log(`${meta.label} · ${artist.name}: #${hit.rank} — "${hit.title}"`);
    } else {
      log(`${meta.label} · ${artist.name}: tidak masuk chart ${data.chartDate}`);
    }
    ch.artists[artist.id] = rec;
  }
  charts.charts[key] = ch;
}
function markChartError(charts, key, meta, err) {
  const ch = charts.charts[key] || { label: meta.label, url: meta.url, artists: {} };
  ch.label = meta.label; ch.url = meta.url;
  ch.lastError = String(err && err.message || err).slice(0, 200);
  ch.updated = now();
  charts.charts[key] = ch;
  log(`! ${meta.label}: ${ch.lastError}`);
}
const CHART_META = {
  billboard_global_200: { label: "Billboard Global 200", url: "https://www.billboard.com/charts/billboard-global-200/" },
  melon_top100: { label: "Melon Top 100", url: "https://www.melon.com/chart/index.htm" },
  genie_top200: { label: "Genie Top 200", url: "https://www.genie.co.kr/chart/top200" },
};
async function collectCharts() {
  const charts = readJSON("charts.json", null) || { _info: CHARTS_INFO, charts: {} };
  charts._info = CHARTS_INFO;
  // Billboard (mingguan)
  const bb = charts.charts.billboard_global_200;
  if (now() - (bb && bb.updated || 0) >= BILLBOARD_MIN_H * 3600) {
    try { applyChart(charts, "billboard_global_200", CHART_META.billboard_global_200, await fetchBillboard()); }
    catch (e) { markChartError(charts, "billboard_global_200", CHART_META.billboard_global_200, e); }
    await sleep(1500);
  }
  // Genie (harian)
  const ge = charts.charts.genie_top200;
  if (now() - (ge && ge.updated || 0) >= KOREA_MIN_H * 3600) {
    try { applyChart(charts, "genie_top200", CHART_META.genie_top200, await fetchGenie()); }
    catch (e) { markChartError(charts, "genie_top200", CHART_META.genie_top200, e); }
    await sleep(1500);
  }
  // Melon (harian, sering diblokir)
  const me = charts.charts.melon_top100;
  if (now() - (me && me.updated || 0) >= KOREA_MIN_H * 3600) {
    try { applyChart(charts, "melon_top100", CHART_META.melon_top100, await fetchMelon()); }
    catch (e) { markChartError(charts, "melon_top100", CHART_META.melon_top100, e); }
  }
  charts.updated = now();
  writeJSON("charts.json", charts);
  return charts;
}

/* ---------------- berita (RSS) ---------------- */
const NEWS_FEEDS = [
  { source: "Soompi", url: "https://www.soompi.com/feed", filter: true },
  { source: "Koreaboo", url: "https://www.koreaboo.com/feed/", filter: true },
  { source: "Kbizoom · BABYMONSTER", url: "https://kbizoom.com/tag/babymonster/feed/", filter: false },
  { source: "Kbizoom · TREASURE", url: "https://kbizoom.com/tag/treasure/feed/", filter: false },
];
const RE_TARGET = /babymonster|treasure|베이비몬스터|트레저/i;
function parseRss(xml) {
  const out = [];
  const blocks = xml.split(/<item[\s>]/).slice(1);
  for (const b of blocks) {
    const tM = /<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/.exec(b);
    const lM = /<link>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/.exec(b)
      || /<guid[^>]*>(?:<!\[CDATA\[)?(https?:\/\/[^\s<]+)(?:\]\]>)?<\/guid>/.exec(b);
    const dM = /<pubDate>([\s\S]*?)<\/pubDate>/.exec(b) || /<updated>([\s\S]*?)<\/updated>/.exec(b);
    const descM = /<description>(?:<!\[CDATA\[)?([\s\S]{0,400}?)(?:\]\]>)?<\/description>/.exec(b)
      || /<content:encoded>(?:<!\[CDATA\[)?([\s\S]{0,400}?)(?:\]\]>)?<\/content:encoded>/.exec(b);
    if (!tM || !lM) continue;
    out.push({
      title: decodeEntities(tM[1].replace(/<[^>]+>/g, "")).trim(),
      link: lM[1].trim(),
      t: dM ? Math.floor(new Date(dM[1].trim()).getTime() / 1000) || null : null,
      desc: descM ? decodeEntities(descM[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim().slice(0, 220) : "",
    });
  }
  return out;
}
async function collectNews() {
  const news = readJSON("news.json", null) || { _info: NEWS_INFO, items: [] };
  news._info = NEWS_INFO;
  if (news.updated && now() - news.updated < NEWS_MIN_H * 3600) return news;
  const byLink = new Map();
  for (const it of news.items || []) byLink.set(it.link.replace(/[?#].*$/, ""), it);
  for (const feed of NEWS_FEEDS) {
    try {
      const xml = await fetchText(feed.url, {}, 2, 25000);
      const items = parseRss(xml);
      let n = 0;
      for (const it of items) {
        const hay = `${it.title} ${it.desc}`;
        if (feed.filter && !RE_TARGET.test(hay)) continue;
        const key = it.link.replace(/[?#].*$/, "");
        const prev = byLink.get(key);
        if (!prev || (it.t && prev.t && it.t > prev.t)) {
          byLink.set(key, { t: it.t || (prev && prev.t) || now(), title: it.title, link: it.link, desc: it.desc, source: feed.source });
          n++;
        }
      }
      log(`berita ${feed.source}: ${items.length} entri, ${n} diterima`);
    } catch (e) {
      log(`! berita ${feed.source}: ${String(e).slice(0, 120)}`);
    }
    await sleep(1200);
  }
  news.items = [...byLink.values()].sort((a, b) => (b.t || 0) - (a.t || 0)).slice(0, 60);
  news.updated = now();
  writeJSON("news.json", news);
  return news;
}

/* ---------------- anomali views (log persisten, semantik = fitur Rekor no 10) ---------------- */
function computeAnomalies(videos) {
  const found = [];
  for (const [vid, rec] of Object.entries(videos || {})) {
    const h = (rec.history || []).filter((p) => p.e !== 1 && p.v != null).sort((a, b) => a.t - b.t);
    if (h.length < 12) continue;
    const last = h[h.length - 1];
    const prev = h[h.length - 2];
    const gapH = (last.t - prev.t) / 3600;
    if (gapH <= 0 || gapH > 36) continue;      // titik terakhir terlalu tua → lewati
    const delta = last.v - prev.v;
    if (delta <= 0) continue;
    const base = h.slice(-31, -1);
    const rates = [];
    for (let i = 1; i < base.length; i++) {
      const g = (base[i].t - base[i - 1].t) / 86400;
      if (g > 0.1 && g < 2) rates.push((base[i].v - base[i - 1].v) / g);
    }
    if (rates.length < 8) continue;
    const med = rates.sort((a, b) => a - b)[Math.floor(rates.length / 2)] || 0;
    if (med <= 0) continue;
    const rate = delta / (gapH / 24);          // tambahan views per hari (setara)
    const ratio = rate / med;
    if (ratio < ANOM_RATIO) continue;
    found.push({
      t: last.t,
      videoId: vid,
      title: rec.title || vid,
      artist: rec.channel || "",
      delta: Math.round(delta),
      rate: Math.round(rate),
      med: Math.round(med),
      ratio: Math.round(ratio * 10) / 10,
    });
  }
  return found;
}
function collectAnomalies() {
  const prev = readJSON("anomalies.json", null) || { _info: ANOM_INFO, items: [] };
  prev._info = ANOM_INFO;
  const videos = readJSON("videos.json", {});
  const found = computeAnomalies(videos);
  const map = new Map();
  for (const it of prev.items || []) map.set(`${it.videoId}|${wibDayKey(it.t)}`, it);
  let nBaru = 0;
  for (const it of found) {
    const k = `${it.videoId}|${wibDayKey(it.t)}`;
    if (!map.has(k)) nBaru++;
    map.set(k, it);
  }
  prev.items = [...map.values()].sort((a, b) => (b.t || 0) - (a.t || 0)).slice(0, ANOM_CAP);
  prev.updated = now();
  writeJSON("anomalies.json", prev);
  log(`anomali: ${found.length} terdeteksi run ini, ${nBaru} baru, total log ${prev.items.length}`);
  return prev;
}

/* ---------------- info schema ---------------- */
const SOCIAL_INFO = "Follower sosial media per grup. Sumber: Instagram (web_profile_info/og:meta — angka meta dibulatkan, ditandai aprox), X via mirror Nitter, TikTok via halaman profil. Bisa diisi manual lewat data/social-override.json (src=manual). Weverse tidak mempublikasikan follower via web. Semua sumber best-effort: kalau gagal, angka terakhir tetap dipakai.";
const CHARTS_INFO = "Posisi lagu artis di chart. Billboard Global 200 (mingguan) dari baris halaman chart billboard.com; Melon Top 100 & Genie Top 200 (harian) dari halaman chart masing-masing. Titik hanya direkam saat lagu artis masuk chart. Melon sering menolak IP datacenter — bila lastError terisi, sumber sedang tidak tersedia.";
const NEWS_INFO = "Berita terbaru yang menyebut BABYMONSTER/TREASURE, dari RSS Soompi, Koreaboo, dan tag Kbizoom per artis. Dedupe per tautan, maksimum 60 entri.";
const ANOM_INFO = `Log lonjakan views tak biasa: tambahan views per hari >= ${ANOM_RATIO}x median harian 30 titik sebelumnya (semantik sama dengan fitur 'lonjakan tidak biasa' di halaman Rekor). Satu entri per video per hari.`;

/* ---------------- main ---------------- */
async function main() {
  const started = Date.now();
  log("=== collect_social.js dimulai ===");
  try { await collectSocial(); } catch (e) { log(`! sosial gagal: ${String(e).slice(0, 200)}`); }
  try { await collectCharts(); } catch (e) { log(`! chart gagal: ${String(e).slice(0, 200)}`); }
  try { await collectNews(); } catch (e) { log(`! berita gagal: ${String(e).slice(0, 200)}`); }
  try { collectAnomalies(); } catch (e) { log(`! anomali gagal: ${String(e).slice(0, 200)}`); }
  log(`=== selesai dalam ${Math.round((Date.now() - started) / 1000)}s ===`);
}
if (require.main === module) main();
module.exports = { main, parseShort, appendDaily, computeAnomalies, fetchBillboard, fetchGenie, fetchMelon, parseRss, collectNews, collectSocial, collectCharts, collectAnomalies };
