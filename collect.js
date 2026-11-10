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
const API_KEY = process.env.YOUTUBE_API_KEY || process.env.YT_API_KEY || ""; // nama baru + fallback nama lama
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const HISTORY_CAP = 4000; // maksimum titik data per video/channel
const DISCOVERY_PAGES = 4; // halaman playlist uploads yang discan utk video baru (50/hal)
const WAYBACK_MAX_VIDEOS = parseInt(process.env.WAYBACK_MAX || "25", 10) || 25; // budget backfill Wayback per putaran
const WAYBACK_PER_VIDEO = 6; // maksimum snapshot arsip yang diambil per video
const WAYBACK_SLEEP_MS = 1100; // jeda sopan antar permintaan ke web.archive.org
const SCHEMA_VERSION = 3; // penanda format data; beda versi -> migrasi otomatis
const EST_CAP = 380; // batas titik estimasi per video (hemat ukuran file)
const EST_KEEP_DAILY = 100; // estimasi 100 hari terakhir selalu harian

// milestone RESMI (kurasi manual dari pengumuman YG/media) — dipakai sbg jangkar nyata
let OFFICIAL_MS = {};
try { OFFICIAL_MS = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "milestones.json"), "utf-8")).videos || {}; }
catch { OFFICIAL_MS = {}; }

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

/* hash string -> uint32 (untuk noise deterministik agar rebuild estimasi stabil) */
function hstr(s) {
  let h = 2166136261;
  for (let i = 0; i < String(s).length; i++) { h ^= String(s).charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
/* noise deterministik -0.08..0.08 dari seed + indeks hari */
function jitter(seed, i) {
  let x = hstr(seed + ":" + i);
  x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0;
  return ((x % 1600) / 10000) - 0.08;
}

/*
 * buildEstimatedSeries — buat riwayat ESTIMASI (e:1) dari tanggal rilis s/d hari sebelum
 * pengukuran, di-anchor supaya kumulatif di jangkar = currentV.
 * Model dua fase: spike awal peluruhan geometris (rasio hari-60 = k), lalu ekor panjang r2.
 * r2 dicari numerik agar LAJU HARIAN di ujung ekor ≈ g (laju terukur di jangkar) — sambungan
 * ke data nyata jadi mulus; dibatasi [0.988, 0.9985] supaya bentuk tetap realistis dan
 * bulan-bulan tengah tidak menggelembung (perbaikan grafik "views per hari").
 * Noise ±6% deterministik supaya kurva terlihat alami.
 * Output berbasis PERIODE: harian (100 hari terakhir), mingguan (s/d 2 tahun), bulanan
 * (sisanya) — delta tiap bucket akurat tanpa penebangan titik.
 */
/* Keluarkan titik kumulatif per hari pada batas kalender — aturan:
 *   zona harian (100 hari terakhir)  -> titik tiap hari;
 *   zona mingguan (s/d 2 tahun)      -> titik tiap Minggu DAN tiap akhir bulan;
 *   zona bulanan (sisanya)           -> titik tiap akhir bulan.
 * Selama titik ada di setiap akhir bulan, jumlah delta per bulan kalender di situs
 * PASTI akurat (delta bulan = cum(akhir bln) - cum(akhir bln lalu)); titik Minggu
 * membuat tampilan mingguan akurat. Tanpa titik akhir bulan di zona mingguan, bulan
 * ber-5-Minggu mendapat delta 35 hari (batang +25%) dan bulan ber-4-Minggu 28 hari. */
function emitCalendarBuckets(t0, D, cumAt, out, e) {
  const monthIdx = (t) => { const x = new Date((t + 7 * 3600) * 1000); return x.getUTCFullYear() * 12 + x.getUTCMonth(); };
  const weekday = (t) => { const x = new Date((t + 7 * 3600) * 1000); return (x.getUTCDay() + 6) % 7; }; // 0=Senin
  for (let d = 0; d < D; d++) {
    const tEnd = t0 + (d + 1) * 86400 - 1;
    const tNext = t0 + (d + 1) * 86400;
    const monthEnd = d + 1 >= D || monthIdx(tEnd) !== monthIdx(tNext);
    const gran = d >= D - 100 ? "day" : d >= D - 730 ? "week" : "month";
    const emit = gran === "day" || monthEnd || (gran === "week" && weekday(tEnd) === 6);
    if (emit) out.push({ t: tEnd, v: Math.round(cumAt(d)), l: null, e });
  }
}

function buildEstimatedSeries(publishedISO, currentV, measuredT, opts = {}) {
  const out = [];
  if (!publishedISO || !currentV || currentV <= 0) return out;
  const t0 = new Date(publishedISO + "T00:00:00+07:00").getTime() / 1000;
  if (!isFinite(t0) || t0 >= measuredT) return out;
  const D = Math.floor((measuredT - t0) / 86400); // hari penuh yang sudah lewat
  if (D < 2) return out;
  const k = opts.k ?? 0.15;
  const seed = opts.seed || "v";
  const r1 = Math.pow(k, 1 / 60);
  // target laju harian di jangkar: laju terukur (opts.g) dibatasi agar masuk akal
  const avg = currentV / D;
  const g = Math.max(1, Math.min(opts.g || avg, avg * 1.35, currentV * 0.04));
  let w = null;
  if (D > 60) {
    const mk = (r2) => { const a = new Array(D); for (let d = 0; d < D; d++) a[d] = d < 60 ? Math.pow(r1, d) : Math.pow(r1, 60) * Math.pow(r2, d - 60); return a; };
    let lo = 0.978, hi = 0.9985;
    const sum = (a) => a.reduce((x, y) => x + y, 0);
    for (let i = 0; i < 40; i++) {
      const m = (lo + hi) / 2, a = mk(m);
      if (currentV * (a[D - 1] / sum(a)) > g) hi = m; else lo = m; // ekor terlalu gemuk -> perkecil r2
    }
    const cand = mk((lo + hi) / 2);
    // utk lagu tua: tolak bentuk yg terlalu terkonsentrasi (30 hari pertama > 30% total)
    if (D > 400) {
      let first30 = 0;
      for (let d = 0; d < Math.min(30, D); d++) first30 += cand[d];
      w = first30 / sum(cand) <= 0.3 ? cand : mk(0.9985);
    } else w = cand; // lagu muda: utamakan sambungan mulus ke data nyata
  } else {
    // umur pendek: satu fase peluruhan geometris, r dicari agar nilai hari terakhir ≈ g
    const mk = (r) => { const a = new Array(D); for (let d = 0; d < D; d++) a[d] = Math.pow(r, d); return a; };
    let lo = 0.8, hi = 0.999999;
    const sum = (a) => a.reduce((x, y) => x + y, 0);
    for (let i = 0; i < 60; i++) {
      const m = (lo + hi) / 2, a = mk(m);
      if (a[D - 1] / sum(a) > g / currentV) hi = m; else lo = m;
    }
    const cand = mk((lo + hi) / 2);
    w = cand[0] / sum(cand) <= 0.22 ? cand : mk(0.94);
  }
  for (let d = 0; d < D; d++) w[d] = Math.max(1e-9, w[d] * (1 + jitter(seed, d)));
  let total = 0;
  for (let d = 0; d < D; d++) total += w[d];
  // hari berjalan (parsial) ikut dinormalisasi supaya jangkar tepat di waktu pengukuran:
  // cum(akhir kemarin) < currentV, dan titik jangkar (e:1) di-push di t=measuredT.
  // Tanpa ini, delta "kemarin" pada video yang baru dipantau selalu 0.
  const fracDay = Math.min(1, Math.max(0.05, (measuredT - (t0 + D * 86400)) / 86400));
  const wTail = w.slice(Math.max(0, D - 7)).reduce((a, b) => a + b, 0) / Math.max(1, Math.min(7, D));
  const totalAll = total + wTail * fracDay;
  // views kumulatif per hari, lalu emisi per bucket kalender (delta bulan/minggu akurat)
  const cumDays = new Array(D);
  let run = 0;
  for (let d = 0; d < D; d++) { run += w[d]; cumDays[d] = Math.round((currentV * run) / totalAll); }
  emitCalendarBuckets(t0, D, (i) => cumDays[i], out, 1);
  // jangkar estimasi tepat di waktu pengukuran (ditimpa titik nyata di hari yang sama saat merge)
  out.push({ t: measuredT, v: currentV, l: null, e: 1 });
  // titik nol tepat sebelum hari rilis: supaya delta bucket pertama (bulan/hari rilis)
  // muncul sebagai batang di grafik "views ditambahkan", bukan hilang begitu saja
  out.unshift({ t: t0 - 1, v: 0, l: null, e: 1 });
  return out;
}

/*
 * buildChannelSeries — estimasi riwayat channel (subs s, views v, video c) dari tanggal
 * channel dibuat s/d pengukuran. Tiap metrik pakai kurva pangkat sendiri:
 *   subs p=1.2 (makin cepat), views p=1.0 (relatif stabil), video p=0.85 (melambat).
 */
function buildChannelSeries(createdISO, measuredT, metrics, opts = {}) {
  const out = [];
  if (!createdISO) return out;
  const t0 = new Date(createdISO + "T00:00:00+07:00").getTime() / 1000;
  if (!isFinite(t0) || t0 >= measuredT) return out;
  const D = Math.floor((measuredT - t0) / 86400);
  const frac = Math.max(0.05, Math.min(1, (measuredT - t0) / 86400 - D));
  if (D < 2) return out;
  const seed = opts.seed || "c";
  const beta = 30;
  const weights = {};
  const totals = {};
  for (const key of Object.keys(metrics)) {
    const p = metrics[key].p ?? 1;
    const arr = [];
    let tot = 0;
    for (let d = 0; d <= D; d++) {
      let base = Math.pow(d + beta, p);
      base *= 1 + jitter(seed + key, d);
      arr.push(base); tot += base;
    }
    weights[key] = arr;
    totals[key] = tot * 1; // hari terakhir dihitung penuh (hari berjalan)
  }
  const cums = { s: 0, v: 0, c: 0 };
  for (let d = 0; d < D; d++) {
    const pt = { t: t0 + (d + 1) * 86400 - 1, e: 1 };
    for (const key of Object.keys(metrics)) {
      cums[key] += weights[key][d];
      pt[key] = metrics[key].cur > 0 ? Math.round((metrics[key].cur * cums[key]) / totals[key]) : null;
    }
    out.push(pt);
  }
  return out;
}

/*
 * thinSeries — pangkas titik lama (bukan 100 hari terakhir) agar total <= cap.
 * Grafik bulanan tetap akurat; detail harian tetap utk 100 hari terakhir.
 * Titik penutup bulan TIDAK pernah dipangkas (dulu video tua kehilangan titik akhir
 * bulan -> batang beberapa bulan hilang / delta bulan melompat).
 */
function monthKeyOf(t) {
  const x = new Date((t + 7 * 3600) * 1000); // zona WIB
  return x.getUTCFullYear() * 12 + x.getUTCMonth();
}
function thinSeries(pts, cap = EST_CAP, keepRecent = EST_KEEP_DAILY) {
  if (pts.length <= cap) return pts;
  const head = pts.slice(0, pts.length - keepRecent);
  const tail = pts.slice(pts.length - keepRecent);
  const step = Math.max(1, Math.ceil(head.length / Math.max(1, cap - keepRecent)));
  const out = head.filter((p, i) => {
    if (i % step === 0) return true;
    const nx = head[i + 1] || tail[0]; // titik terakhir head dibandingkan dgn awal tail
    return nx && monthKeyOf(nx.t) !== monthKeyOf(p.t); // penutup bulan selalu disimpan
  });
  return out.concat(tail);
}

/*
 * rebuildVideoEstimates — regenerasi ulang seluruh titik estimasi sebuah video.
 * Jangkar = titik TERUKUR (API/scrape/Wayback). Estimasi menambal dari tanggal rilis
 * sampai jangkar pertama; antar jangkar diinterpolasi. Titik terukur tidak pernah diubah.
 */
/* laju harian antara dua titik terukur (per hari, aman utk gap pendek) */
function rateBetween(a, b) {
  if (!a || !b || b.t <= a.t || b.v < a.v) return null;
  return (b.v - a.v) / Math.max(1, (b.t - a.t) / 86400);
}

function rebuildVideoEstimates(rec, id) {
  const reals = (rec.history || []).filter((p) => p.e !== 1).sort((a, b) => a.t - b.t);
  if (!reals.length || !rec.published) return;
  const last = reals[reals.length - 1];
  if (!(last.v > 0)) return;
  let est;
  if (reals.length >= 2) {
    // Jangkar >= 2 (milestone resmi / arsip Wayback / pengukuran lama + titik terbaru):
    // segmen rilis->jangkar pertama mengikuti model, sisanya diinterpolasi PCHIP antar
    // jangkar — TIDAK ada celah kosong lagi. Celah kosong dulu bikin grafik bulanan salah:
    // seluruh delta antar jangkar dijatuhkan ke bulan titik terakhir (batang NOVEMBER
    // raksasa) dan bulan-bulan di antaranya kosong (kasus 'IF I' cuma 2 batang).
    // laju harian dipakai sbg bentuk sambung hanya bila jangkar pertama berdekatan;
    // kalau jaraknya jauh, rata-rata antar jangkar menyesatkan -> biarkan model pilih sendiri
    const gGap = reals[1] && reals[1].t - reals[0].t <= 60 * 86400 ? rateBetween(reals[0], reals[1]) : null;
    const g = gGap || undefined;
    const anchors = reals.slice(0, -1).map((p) => ({ t: p.t, v: p.v, w: p.w }));
    est = thinSeries(buildAnchoredSeries(rec.published, anchors, last.v, last.t, { g, seed: id }));
  } else {
    const anchor = reals.find((p) => p.v > 0) || last;
    const g = rateBetween(anchor, reals[reals.indexOf(anchor) + 1]) || undefined;
    est = thinSeries(buildEstimatedSeries(rec.published, anchor.v, anchor.t, { g, seed: id }));
  }
  rec.history = mergeHistory(est, reals);
}

/*
 * applyOfficialMilestones — sisipkan milestone resmi (data/milestones.json) sebagai titik
 * NYATA (e:0, o:1) ke dalam history. Titik ini menjadi jangkar rebuildVideoEstimates sehingga
 * kurva sebelum pemantauan mengikuti pencapaian resmi (mis. SHEESH 100 jt di hari ke-11),
 * dan tabel milestone menampilkan hari yang sesuai pengumuman YG/media.
 * Aman diulang: dilewati bila sudah ada titik nyata yang menutupi nilai tsb di hari yang sama,
 * atau bila penyisipan akan merusak kemonotonan kurva.
 */
function applyOfficialMilestones(rec, id) {
  const entry = OFFICIAL_MS[id];
  if (!entry || !Array.isArray(entry.ms) || !rec) return false;
  rec.history = rec.history || [];
  const hist = rec.history;
  const reals = hist.filter((p) => p.e !== 1); // hanya titik nyata; estimasi akan dibangun ulang
  const lastReal = reals.length ? reals[reals.length - 1] : null;
  const cur = lastReal ? lastReal.v : 0;
  let changed = false;
  for (const it of entry.ms) {
    if (!it || !(it.m > 0) || !it.d) continue;
    const t = new Date(it.d + "T00:00:00+07:00").getTime() / 1000;
    if (!isFinite(t)) continue;
    if (cur > 0 && it.m >= cur) continue; // belum tercapai / sama dgn titik terakhir
    if (reals.some((p) => Math.abs(p.t - t) < 20 * 3600 && p.v >= it.m)) continue;
    const prev = reals.filter((p) => p.t <= t).pop();
    const next = reals.find((p) => p.t > t);
    if (prev && prev.v > it.m) continue; // jangan patahkan kemonotonan
    if (next && next.v < it.m) continue;
    hist.push({ t, v: it.m, l: null, e: 0, o: 1 });
    reals.push({ t, v: it.m, e: 0 });
    reals.sort((a, b) => a.t - b.t);
    changed = true;
  }
  if (changed) hist.sort((a, b) => a.t - b.t);
  return changed;
}

/* regenerasi estimasi channel (subs/views/video) dari tanggal channel dibuat */
function rebuildChannelEstimates(ch) {
  const reals = (ch.history || []).filter((p) => p.e !== 1).sort((a, b) => a.t - b.t);
  if (!reals.length || !ch.created) return;
  const first = reals[0];
  const pick = (k) => { for (const p of reals) if (p[k] > 0) return p[k]; return 0; };
  const est = thinSeries(
    buildChannelSeries(ch.created, first.t, {
      s: { cur: pick("s"), p: 1.2 },
      v: { cur: pick("v"), p: 1.0 },
      c: { cur: pick("c"), p: 0.85 },
    }, { seed: ch.channel_id || ch.name || "ch" }),
    420, 110
  );
  ch.history = mergeHistory(est, reals);
}

/*
 * pchipSeries — interpolasi kubik monoton (Fritsch–Carlson) di ruang LOG views.
 * Dipakai untuk menyambung jangkar-jangkar arsip/pengukuran lama: laju harian berubah
 * LEMBUT antar segmen (interpolasi geometrik per-segmen dulu bikin batang "melompat" 2x
 * di bulan bergantian karena jarak antar jangkar tidak seragam).
 * Monoton dijamin: nilai antara selalu di antara kedua jangkar.
 */
function pchipSeries(nodes) {
  const xs = nodes.map((n) => n.t);
  const ys = nodes.map((n) => Math.log(n.v));
  const n = xs.length;
  if (n < 2) return () => (nodes.length ? nodes[nodes.length - 1].v : 0);
  const h = [], d = [];
  for (let i = 0; i < n - 1; i++) { h.push(xs[i + 1] - xs[i]); d.push((ys[i + 1] - ys[i]) / h[i]); }
  const m = new Array(n).fill(0);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) m[i] = 0;
    else {
      const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1];
      m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
    }
  }
  return (t) => {
    if (t <= xs[0]) return Math.exp(ys[0] + m[0] * (t - xs[0]));
    if (t >= xs[n - 1]) return Math.exp(ys[n - 1] + m[n - 1] * (t - xs[n - 1]));
    let lo = 0;
    while (lo < n - 2 && t > xs[lo + 1]) lo++;
    const s = (t - xs[lo]) / h[lo];
    const y = (2 * s * s * s - 3 * s * s + 1) * ys[lo] + (s * s * s - 2 * s * s + s) * h[lo] * m[lo]
            + (-2 * s * s * s + 3 * s * s) * ys[lo + 1] + (s * s * s - s * s) * h[lo] * m[lo + 1];
    return Math.exp(y);
  };
}

/*
 * buildAnchoredSeries — titik SNAPSHOT ARSIP (Wayback) / pengukuran lama dipakai sebagai
 * jangkar nyata (e:0). Segmen rilis→jangkar pertama mengikuti kurva model (sambungan mulus
 * di jangkar pertama); antar jangkar diinterpolasi PCHIP mulus (e:1), dikeluarkan per
 * periode (harian 100 hari terakhir, mingguan s/d 2 tahun, bulanan sisanya) supaya jumlah
 * per bucket akurat.
 */
function buildAnchoredSeries(publishedISO, anchors, currentV, measuredT, opts = {}) {
  if (!publishedISO || !currentV || currentV <= 0) return [];
  const t0 = new Date(publishedISO + "T00:00:00+07:00").getTime() / 1000;
  if (!isFinite(t0) || t0 >= measuredT) return [];
  const sorted = [...(anchors || [])]
    .filter((a) => a && a.t > t0 && a.t < measuredT && a.v > 0 && a.v < currentV)
    .sort((a, b) => a.t - b.t);
  const out = [];
  if (sorted.length) {
    // segmen pertama: model estimasi rilis -> jangkar pertama (kumulatif tepat = jangkar)
    const model = buildEstimatedSeries(publishedISO, sorted[0].v, sorted[0].t, opts);
    for (const p of model) if (p.t < sorted[0].t) out.push(p);
  }
  // buang jangkar yang merusak kemonotonan (mis-parse arsip), lalu interpolasi PCHIP
  const mono = [];
  for (const nd of [...sorted, { t: measuredT, v: currentV }]) {
    if (!mono.length || nd.v > mono[mono.length - 1].v) mono.push(nd);
  }
  if (mono.length >= 2) {
    const f = pchipSeries(mono);
    const T0 = mono[0].t;
    const Dd = Math.max(1, Math.floor((measuredT - T0) / 86400));
    emitCalendarBuckets(T0, Dd, (i) => f(T0 + (i + 1) * 86400 - 1), out, 1);
  }
  for (const nd of sorted) out.push({ t: nd.t, v: nd.v, l: null, e: 0, ...(nd.w ? { w: 1 } : {}) });
  out.push({ t: measuredT, v: currentV, l: null, e: 0 });
  return out;
}

/* ---------- backfill dari Wayback Machine (berjalan di GitHub Actions) ---------- */
function parseViewCountFromPage(html) {
  // hanya pola TERSTRUKTUR — regex longgar bisa menangkap views video lain di halaman arsip
  let m = /"viewCount":"(\d+)"/.exec(html);
  if (m) return parseInt(m[1], 10);
  m = /itemprop="interactionCount" content="(\d+)"/.exec(html);
  if (m) return parseInt(m[1], 10);
  m = /"viewCount":\{"simpleText":"([\d,.]+)\s*views?"/.exec(html);
  if (m) return parseInt(m[1].replace(/[,.]/g, ""), 10) || null;
  return null;
}

/*
 * Migrasi otomatis: jika schema lama, buang titik estimasi lama (dibangun ulang dgn model
 * baru), buang video yang tak lagi dipantau, dan bersihkan titik terukur lama yang
 * TERISOLASI (calon jangkar Wayback lama yang bisa salah baca) — titik API harian yang
 * rapat tetap dipelihara. Marker backfill dihapus agar Wayback diulang dgn parser baru.
 */
function migrateIfNeeded() {
  const meta = readJSON("meta.json", {});
  if (meta.schema === SCHEMA_VERSION) return;
  log(`Migrasi schema ${meta.schema || 1} → ${SCHEMA_VERSION}: membangun ulang estimasi & membersihkan jangkar lama yang meragukan`);
  const cutoff = Math.floor(Date.now() / 1000) - 21 * 86400;
  const watched = new Set();
  for (const a of CONFIG.artists) for (const v of a.videos) watched.add(v.id);
  const videos = readJSON("videos.json", {});
  const outV = {};
  for (const [id, rec] of Object.entries(videos)) {
    if (!watched.has(id)) continue;
    const pts = (rec.history || []).filter((p) => p.e !== 1).sort((a, b) => a.t - b.t);
    const keep = pts.map((p, i) => {
      if (p.t >= cutoff) return true;
      const prevT = i > 0 ? pts[i - 1].t : -Infinity;
      const nextT = i < pts.length - 1 ? pts[i + 1].t : Infinity;
      return p.t - prevT < 36 * 3600 || nextT - p.t < 36 * 3600; // masih rapat = data API harian
    });
    outV[id] = { ...rec, history: pts.filter((_, i) => keep[i]) };
  }
  writeJSON("videos.json", outV);
  const channels = readJSON("channels.json", {});
  for (const a of CONFIG.artists) {
    const ch = channels[a.id];
    if (ch && Array.isArray(ch.history)) ch.history = ch.history.filter((p) => p.e !== 1 && p.t >= cutoff);
  }
  writeJSON("channels.json", channels);
  try { fs.rmSync(path.join(DATA_DIR, "backfill"), { recursive: true, force: true }); } catch {}
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
        const series = buildAnchoredSeries(rec.published, anchors, last.v, last.t, { seed: id });
        if (series.length > 3) {
          const keptReal = rec.history.filter((p) => p.e !== 1);
          rec.history = mergeHistory(series, keptReal);
          // tandai titik jangkar arsip (w:1) agar bisa dibedakan dari titik API harian
          const tsSet = new Set(anchors.map((a) => a.t));
          rec.history = rec.history.map((p) => (p.e !== 1 && tsSet.has(p.t) ? { ...p, w: 1 } : p));
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
/* Konten non-MV / non-dance TIDAK dipantau (permintaan pengguna): focus cut, solo
 * practice/performance, cover lagu orang lain, stage practice, live/concert performance,
 * versi JP/anime/RAW, highlight/teaser/behind/making, clip promosi, dsb.
 * DIPANTAU: M/V, DANCE PERFORMANCE VIDEO, PERFORMANCE VIDEO, EXCLUSIVE/SPECIAL
 * PERFORMANCE VIDEO (lagu sendiri, bukan solo) — kategori dance_performance. */
const RE_EXCLUDE =
  /focus\s*cut|solo\s*dance|solo\s*performance|solo\s*ver\.?|choreography|dance\s*cover|stage\s*practice|stage\s*cam|fancam|live\s*performance|performance\s*film|japanese\s*ver\.?|-?jp\s*ver\.?|japan\s*ver\.?|\bjapan\b|raw\s*version|raw\s*ver\.?|anime|concert|making|behind|teaser|trailer|visual\s*film|jacket|mashup|reaction|highlight|reply\b|countdown|spoiler|preview\b|episode\b|commentary|shorts\b|out now|watch now|part\s*switch|eye\s*contact|drake|a\$ap|lil pump|timtim|jenny from the block|vocal\s*clip|close[-\s]?up|d[-\s]?day\b|hits\s*\d+|teumecam|\bof\s+treasure\b|응원법|비하인드|매거진|촬영|포커스|回应|リリース/i;
const RE_MV = /\bm\s*\/\s*v\b/i;
const RE_PRACTICE = /dance\s*practice|practice\s*video/i;
const RE_DANCE_PERF = /dance\s*performance|performance\s*video/i;

function classifyTitle(title) {
  if (!title || RE_EXCLUDE.test(title)) return null;
  if (RE_DANCE_PERF.test(title)) return "dance_performance";
  if (RE_MV.test(title)) return "mv";
  if (RE_PRACTICE.test(title)) return "dance_practice";
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
    // tanggal dibuatnya channel (snippet.publishedAt) -> jangkar estimasi sejak awal
    const createdIso = (it.snippet?.publishedAt || "").slice(0, 10);
    if (createdIso) ch.created = createdIso;
    else if (!ch.created && artist.created) ch.created = artist.created;
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
    rebuildChannelEstimates(ch);
  }

  // 2) discovery video baru dari playlist uploads terbaru
  let configChanged = false;
  const seenDiscovery = new Set(); // cegah video yang sama masuk 2 artis
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
      if (known.has(r.id) || exclude.has(r.id) || videos[r.id] || seenDiscovery.has(r.id)) continue;
      const cat = classifyTitle(r.title);
      if (!cat) continue;
      seenDiscovery.add(r.id);
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
      l: st.likeCount != null ? parseInt(st.likeCount, 10) || 0 : null,
    })) updated++;
    videos[it.id] = rec;
  }
  log(`video diperbarui: ${updated}/${allIds.length}`);

  try { await backfillFromWayback(videos, now); } catch (e) { log(`! modul backfill: ${e}`); }

  // bangun ulang estimasi sejak tanggal rilis (pakai jangkar terukur terbaru, termasuk Wayback)
  for (const [id, rec] of Object.entries(videos)) {
    try { applyOfficialMilestones(rec, id); } catch {}
    rebuildVideoEstimates(rec, id);
  }

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
  const m = /([\d][\d.,]*)\s*(rb|jt|k|m|b)?/i.exec((s || "").trim());
  if (!m) return null;
  const unit = (m[2] || "").toLowerCase();
  const mult = { rb: 1e3, jt: 1e6, k: 1e3, m: 1e6, b: 1e9 }[unit] || 1;
  let num = m[1];
  if (unit === "rb" || unit === "jt") num = num.replace(/\./g, "").replace(/,/g, "."); // "1,2 jt"
  else if (/^\d{1,3}([.,]\d{3})+$/.test(num)) num = num.replace(/[.,]/g, ""); // 1.234.567 / 1,234,567
  else num = num.replace(/,/g, "");
  const v = parseFloat(num) * mult;
  return isFinite(v) ? Math.round(v) : null;
}

/* likes tanpa API key: endpoint next publik -> "like this video along with N other people" */
async function fetchLikesNext(vid) {
  const body = {
    context: { client: { clientName: "WEB", clientVersion: "2.20260101.00.00", hl: "en", gl: "US" } },
    videoId: vid,
  };
  const j = await fetchJSON("https://www.youtube.com/youtubei/v1/next?prettyPrint=false", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = JSON.stringify(j);
  let m = /like this video along with ([\d.,]+) other people/i.exec(text);
  if (m) { const n = parseInt(m[1].replace(/[.,]/g, ""), 10); if (n) return n; }
  m = /"accessibilityText":"([\d.,]+\s*[KMB]?)\s*likes?"/i.exec(text);
  if (m) return parseShortCount(m[1]) || parseInt(m[1].replace(/[.,]/g, ""), 10) || null;
  m = /"likeCount":"(\d+)"/.exec(text);
  if (m) return parseInt(m[1], 10) || null;
  return null;
}

async function scrapeChannel(handle) {
  const html = await fetchText(`https://www.youtube.com/${handle}/about?hl=en&gl=US`);
  const out = {};
  let m = /<meta property="og:image" content="([^"]+)"/.exec(html);
  if (m) out.avatar = m[1];
  m = /[jJ]oined\s+([A-Za-z]{3,9}\s+\d{1,2},\s*\d{4})/.exec(html);
  if (m) { const d = new Date(m[1]); if (!isNaN(d)) out.created = d.toISOString().slice(0, 10); }
  m = /"subscriberCountText":"([\d.,KM]+)\s*subscribers?"/.exec(html);
  if (m) out.subs = parseShortCount(m[1]);
  m = /"viewCountText":"([\d,]+)\s*views?"/.exec(html);
  if (m) out.views = parseInt(m[1].replace(/,/g, ""), 10);
  m = /"videoCountText":"([\d,]+)\s*videos?"/.exec(html);
  if (m) out.videos = parseInt(m[1].replace(/,/g, ""), 10);
  return out;
}

async function scrapePlaylistPage(plId, continuation, clientVersion) {
  let text;
  if (!continuation) {
    text = await fetchText(`https://www.youtube.com/playlist?list=${plId}&hl=en&gl=US`);
  } else {
    const body = {
      context: { client: { clientName: "WEB", clientVersion: clientVersion || "2.20260101.00.00", hl: "en", gl: "US" } },
      continuation,
    };
    text = await fetchText("https://www.youtube.com/youtubei/v1/browse?prettyPrint=false", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }
  /* Respons continuation adalah JSON murni — bukan halaman HTML. Dulu selalu diurai
   * sbg ytInitialData sehingga halaman 2+ kosong (temuan audit kelengkapan MV). */
  const trimmed = String(text).replace(/^\uFEFF/, "").trimStart();
  let data = null;
  if (trimmed.startsWith("{")) {
    try { data = JSON.parse(trimmed); } catch { data = null; }
  }
  if (!data) data = extractYtInitialData(text);
  if (!data) return { items: [], tokens: [], clientVersion };
  const cv = /"clientVersion":"([\d.]+)"/.exec(text) || /"clientVersion":"([\d.]+)"/.exec(trimmed);
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
  // 1) endpoint player (ringan): views, judul, tanggal
  let base = null;
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
      base = {
        title: vd.title,
        views: parseInt(vd.viewCount, 10),
        duration: parseInt(vd.lengthSeconds || "0", 10) || null,
        published: (mf.publishDate || mf.uploadDate || "").slice(0, 10) || null,
      };
    }
  } catch (e) {
    log(`  player gagal utk ${vid}: ${String(e).slice(0, 80)}`);
  }
  // 2) likes via endpoint next (ringan) — sebelumnya selalu null di mode scraping
  let likes = null;
  try { likes = await fetchLikesNext(vid); } catch (e) { log(`  likes gagal utk ${vid}: ${String(e).slice(0, 70)}`); }
  if (base) return { ...base, likes };
  const html = await fetchText(`https://www.youtube.com/watch?v=${vid}&hl=en&gl=US`, {
    headers: { Cookie: "CONSENT=YES+cb; SOCS=CAI" },
  });
  let title = null, views = null, likes2 = null, duration = null, published = null;
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
  if (lm) likes2 = parseShortCount(lm[1]) || parseInt(lm[1], 10);
  if (!title) {
    const t = /<meta name="title" content="([^"]+)"/.exec(html);
    if (t) title = t[1];
  }
  if (!views) {
    const v = /"viewCount":"(\d+)"/.exec(html);
    if (v) views = parseInt(v[1], 10);
  }
  return {
    title: base?.title || title,
    views: base?.views || views,
    likes: likes != null ? likes : likes2,
    duration: base?.duration || duration,
    published: base?.published || published,
  };
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
    if (info.created) ch.created = info.created;
    else if (!ch.created && artist.created) ch.created = artist.created;
    ch.history = ch.history || [];
    appendHistory(ch.history, { t: now, s: info.subs ?? null, v: info.views ?? null, c: info.videos ?? null });
    channels[artist.id] = ch;
    rebuildChannelEstimates(ch);
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
        published: d.published || v.published,
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
      if (i % 10 === 0) writeJSON("videos.json", videos); // simpan bertahap (tahan terputus)
      await sleep(700);
    }
  }

  try { await backfillFromWayback(videos, now); } catch (e) { log(`! modul backfill: ${e}`); }

  for (const [id, rec] of Object.entries(videos)) {
    try { applyOfficialMilestones(rec, id); } catch {}
    rebuildVideoEstimates(rec, id);
  }

  writeJSON("videos.json", videos);
  writeJSON("channels.json", channels);
  return { videos: Object.keys(videos).length, channels: Object.keys(channels).length, mode: "scrape" };
}

// ---------- main ----------
async function main() {
  const started = Date.now();
  migrateIfNeeded();
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
      schema: SCHEMA_VERSION,
      mode: result.mode,
      duration_sec: Math.round((Date.now() - started) / 1000),
      quota_note: API_KEY ? "pakai YouTube Data API v3" : "scraping publik",
      note: "Grafik menyertakan estimasi harian sejak tanggal rilis video / tanggal channel dibuat (ditandai est.). Titik terukur menimpanya.",
    });
    log(`selesai dalam ${Math.round((Date.now() - started) / 1000)}s — videos=${result.videos} channels=${result.channels}`);
  }
  return result;
}

if (require.main === module) main();

module.exports = {
  main, appendHistory, mergeHistory, buildEstimatedSeries, buildChannelSeries, buildAnchoredSeries,
  rebuildVideoEstimates, rebuildChannelEstimates, thinSeries, migrateIfNeeded, applyOfficialMilestones,
  backfillFromWayback, waybackAnchors, classifyTitle, parseShortCount, scrapePlaylistPage,
  CONFIG, API_KEY, DATA_DIR, SCHEMA_VERSION,
};
