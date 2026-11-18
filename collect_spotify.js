#!/usr/bin/env node
/**
 * collect_spotify.js — pengumpul data streaming Spotify (untuk Pemantau K-POP PULSE)
 * ================================================================
 * Sumber data (semua publik, tanpa API key):
 *   1. kworb.net/spotify/artist/<ID>_songs.html  → total stream & stream
 *      harian per lagu (diproses kworb dari data resmi Spotify Charts).
 *   2. kworb.net/spotify/listeners.html          → monthly listeners artis
 *      (untuk artis yang masuk daftar global).
 *   3. open.spotify.com/embed/album/<ID>         → metadata album resmi
 *      (nama, cover, daftar track + durasi).
 *   4. open.spotify.com/embed/track/<ID>         → tanggal rilis & cover lagu
 *      (dipanggil sekali per lagu, lalu dicache di data/spotify-release-dates.json).
 *   5. (Opsional) Spotify Web API resmi — jika secret SPOTIFY_CLIENT_ID &
 *      SPOTIFY_CLIENT_SECRET diisi → followers artis ikut direkam.
 *   6. api.stats.fm/search (publik, tanpa key) → fallback followers artis bila
 *      token anonim Spotify diblokir; nilai terakhir tetap dipertahankan.
 *
 * Artis & daftar album dibaca dari config.json (field spotify_id,
 * kworb_songs_url, spotify_albums di masing-masing artis).
 *
 * Penggabungan lagu: semua ID Spotify dengan judul dasar yang sama (tanpa
 * sufiks versi seperti Remix/JP Ver./(7 ver.)) digabung jadi SATU entri lagu;
 * rekaman live (tour/konser) dipisah dengan tanda (live).
 *
 * Riwayat: setiap putaran menyimpan titik kumulatif per lagu/artis (e:0 =
 * titik nyata, e:1 = estimasi model sejak tanggal rilis — hanya mengisi
 * masa sebelum rekaman pertama, titik nyata selalu menang).
 * Output: data/spotify-tracks.json, data/spotify-albums.json,
 *         data/spotify-artists.json, data/spotify-meta.json
 */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const DATA = path.join(ROOT, "data");
if (!fs.existsSync(DATA)) fs.mkdirSync(DATA, { recursive: true });

const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, "config.json"), "utf8"));
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const DAY = 86400;
const now = () => Math.floor(Date.now() / 1000);

/* ---------------- util ---------------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function log(...a) { console.log(...a); }

async function fetchText(url, tries = 4) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const ac = new AbortController();
      const to = setTimeout(() => ac.abort(), 30000);
      const res = await fetch(url, {
        headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" },
        signal: ac.signal,
      });
      clearTimeout(to);
      if (res.status === 200) return await res.text();
      lastErr = new Error(`HTTP ${res.status} untuk ${url}`);
      if (res.status === 404) throw lastErr;
    } catch (e) {
      lastErr = e;
      if (String(e).includes("HTTP 404")) throw e;
    }
    await sleep(2500 * (i + 1));
  }
  throw lastErr;
}

const num = (s) => parseInt(String(s).replace(/[,\s]/g, ""), 10) || 0;
const dayKey = (t) => Math.floor(t / DAY);

/* ---------- override tanggal rilis (premier resmi single) ----------
 * Spotify/kworb terkadang memberi tanggal VERSI ALBUM atau versi pengganti, bukan
 * tanggal premier lagunya — akibatnya kurva estimasi (dan Rekap 12 bulan) mulai
 * dari tanggal yang salah. Override = tanggal premier resmi yang bisa diverifikasi:
 *  - BATTER UP: single pre-debut 27 Nov 2023 (versi "(7 ver.)" di EP BABYMONS7ER
 *    1 Apr 2024 menggantikan single asli di katalog — stream era 2023 tak lagi
 *    tercantum di kworb; selisih total karier diakomodasi offset di situs);
 *  - FOREVER: digital single 1 Jul 2024 (versi album DRIP 1 Nov 2024);
 *  - CLIK CLAK: pre-release single 10 Okt 2024 (versi album DRIP 1 Nov 2024);
 *  - TREASURE: single THE FIRST STEP 2020-2021 (versi di kompilasi
 *    TREASURE EFFECT 11 Jan 2021). */
const RD_OVERRIDE = {
  "babymonster::batterup": "2023-11-27",
  "babymonster::forever": "2024-07-01",
  "babymonster::clikclak": "2024-10-10",
  "treasure::boy": "2020-08-07",
  "treasure::iloveyou": "2020-10-13",
  "treasure::mmm": "2020-11-09",
  "treasure::mytreasure": "2021-01-08",
};

/* ---------------- kunci judul lagu ---------------- */
function songKeyOf(title) {
  return String(title || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9\u3131-\u314e\uac00-\ud7a3\u3040-\u30ff\u4e00-\u9fff]+/g, "")
    .trim();
}
function stripCjk(s) {
  return String(s || "").replace(/[\u3131-\u314e\uac00-\ud7a3\u3040-\u30ff\u4e00-\u9fff]/g, "");
}

/** pisahkan judul menjadi {base, live}: base = judul bersih tanpa sufiks versi */
function splitTitle(t) {
  let s = String(t || "").replace(/～[^～]*～/g, " ");
  const isLive = /(\b|\)|\])[-–\s]*(live( version)?|\(live\)|\btour\b|\bfan concert\b|\bdome\b|\barena\b|\bk-arena\b|kyocera|makuhari)/i.test(s)
    || /-\s*live/i.test(s);
  // potong pada penanda live/show
  s = s.split(/\s*[-–]\s*(?:live|.*\btour\b.*|.*\bfan concert\b.*|.*\bdome\b.*|.*\barena\b.*|.*\bk-arena\b.*|.*kyocera.*|.*makuhari.*)/i)[0];
  s = s.replace(/\([^)]*\)/g, " ").replace(/\[[^\]]*\]/g, " ");
  // buang sufiks versi di akhir, berulang
  const MARK = /[\s\-–]+(remix|remaster(ed)?|ver\.?|version|jp|japanese|english|kr|korean|rock|kaboom|bonus track|drama edit|feat\.?|featuring|sped up|slowed( reverb)?|karaoke|inst\.?|instrumental|acoustic|edit|mix)[\w\s．.]*$/i;
  let prev;
  do { prev = s; s = s.replace(MARK, "").replace(/[\s\-–,.]+$/, ""); } while (s !== prev);
  s = s.trim();
  return { base: s || String(t || "").trim(), live: isLive };
}

/** kandidat kecocokan judul (untuk menautkan lagu↔album) */
function candOf(title) {
  const { base } = splitTitle(title);
  const set = new Set();
  set.add(songKeyOf(title));
  set.add(songKeyOf(base));
  set.add(songKeyOf(stripCjk(base)));
  set.add(songKeyOf(stripCjk(title)));
  return [...set].filter(Boolean);
}

/* ---------------- parsers ---------------- */
/** tipe album dari note di config: "BATTER UP (single, 2023)" → "single" */
function albumTypeOf(note) {
  const s = String(note || "").toLowerCase();
  if (/live/.test(s)) return "live";
  if (/\bsingle\b/.test(s)) return "single";
  if (/(\bep\b|mini album)/.test(s)) return "ep";
  if (/\balbum\b/.test(s)) return "album";
  return null;
}

/** kworb: halaman lagu per artis → {id:{title,total,daily}} */
function parseKworbSongs(html) {
  const out = {};
  // sel "daily" boleh KOSONG (lagu baru/tidak masuk chart harian terakhir),
  // contoh: <td>313,696</td><td></td> — karena itu pakai [\d,]* bukan [\d,]+.
  const re = /<td class="text"><div><a href="https:\/\/open\.spotify\.com\/track\/([A-Za-z0-9]{22})"[^>]*>([\s\S]*?)<\/a><\/div><\/td><td>([\d,]*)<\/td><td>([\d,]*)<\/td>/g;
  let m;
  while ((m = re.exec(html))) {
    out[m[1]] = {
      title: m[2].replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").trim(),
      total: num(m[3]),
      daily: num(m[4]),
    };
  }
  return out;
}

/** kworb: listeners.html → { "NAMA ARTIS": {listeners, delta} } */
function parseKworbListeners(html) {
  const out = {};
  const re = /<tr>([\s\S]*?)<\/tr>/g;
  let m;
  while ((m = re.exec(html))) {
    const cells = [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) =>
      c[1].replace(/<[^>]+>/g, "").trim()
    );
    if (cells.length >= 4 && /^[\d,]+$/.test(cells[2]) && !/^[\d,]+$/.test(cells[1])) {
      out[cells[1]] = { listeners: num(cells[2]), delta: num(cells[3]) };
    }
  }
  return out;
}

/** embed Spotify → __NEXT_DATA__ JSON */
function embedEntity(html) {
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) return null;
  try {
    const d = JSON.parse(m[1]);
    return (d.props && d.props.pageProps && d.props.pageProps.state && d.props.pageProps.state.data && d.props.pageProps.state.data.entity) || null;
  } catch {
    return null;
  }
}

function coverOf(entity) {
  try {
    const imgs = entity.visualIdentity && entity.visualIdentity.image;
    if (imgs && imgs.length) return imgs[0].url;
  } catch {}
  return null;
}

/**
 * fallback monthly listeners dari halaman artis Spotify (HTML SEO untuk bot
 * pencari: "Listen to TREASURE on Spotify. Artist · 1.8M monthly listeners.").
 * Dipakai untuk artis yang TIDAK masuk daftar 2.500 besar global kworb.
 * Halaman memuat DUA bentuk angka: bentuk bulat utk pratinjau ("1.9M") dan
 * angka PERSIS di bagian About/JSON-LD ("1,885,365"). Semua kemunculan di-
 * pindai dan yang paling presisi dipilih (tanpa akhiran K/M/B & mengandung
 * pemisah ribuan) supaya pendengar bulanan tercatat persis, bukan bulat.
 */
async function fetchMonthlyListenersFallback(spotifyId) {
  const parseAll = (txt) => {
    const out = [];
    const re = /([0-9][0-9.,]*)\s*([KMB])?\s+monthly listeners/gi;
    let m;
    while ((m = re.exec(String(txt || "")))) {
      const n = parseFloat(m[1].replace(/,/g, ""));
      if (!isFinite(n) || n <= 0) continue;
      const mul = m[2] === "B" ? 1e9 : m[2] === "M" ? 1e6 : m[2] === "K" ? 1e3 : 1;
      const exact = !m[2] && /,/.test(m[1]); // "1,885,365" = angka persis
      out.push({ v: Math.round(n * mul), exact });
    }
    return out;
  };
  const pick = (cands) => {
    if (!cands.length) return null;
    const exact = cands.filter((c) => c.exact);
    if (exact.length) return exact[0].v;
    // tidak ada angka persis — pakai yang terbesar di antara bentuk bulat
    return Math.max(...cands.map((c) => c.v));
  };
  try {
    const res = await fetch(`https://open.spotify.com/artist/${spotifyId}`, {
      headers: {
        "User-Agent": "Googlebot/2.1 (+http://www.google.com/bot.html)",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout ? AbortSignal.timeout(20000) : undefined,
    });
    if (!res.ok) return null;
    const html = await res.text();
    const md = (html.match(/<meta name="description" content="([^"]*)"/) || [])[1];
    const ld = (html.match(/"description":"([^"]*)"/) || [])[1];
    const v = pick([...parseAll(md), ...parseAll(ld), ...parseAll(html.slice(0, 400000))]);
    if (v) log(`  ↳ monthly listeners dari halaman Spotify: ${v.toLocaleString("en-US")}`);
    return v;
  } catch (e) {
    log("  ! fallback monthly listeners gagal:", String(e).slice(0, 100));
    return null;
  }
}

/* ---------------- riwayat ---------------- */
function mergeHistory(est, real) {
  const byKey = new Map();
  for (const p of real) byKey.set("r" + dayKey(p.t), p);
  for (const p of est) byKey.set("e" + p.t, p);
  return [...byKey.values()].sort((a, b) => a.t - b.t);
}

/** retensi titik nyata: harian 90 terakhir, mingguan hingga 2 th, bulanan selebihnya */
function retainReal(points) {
  const real = points.filter((p) => !p.e);
  const nowT = now();
  const seen = new Map();
  for (const p of [...real].sort((a, b) => a.t - b.t)) {
    const age = nowT - p.t;
    let key;
    if (age <= 90 * DAY) key = "d" + dayKey(p.t);
    else if (age <= 730 * DAY) key = "w" + Math.floor(p.t / (7 * DAY));
    else key = "m" + String(ymd(p.t)).slice(0, 7);
    const prev = seen.get(key);
    if (!prev || p.v >= prev.v) seen.set(key, p);
  }
  return [...seen.values()].sort((a, b) => a.t - b.t);
}
const ymd = (t) => new Date(t * 1000).toISOString().slice(0, 10);

/**
 * Estimasi kurva kumulatif dari tanggal rilis sampai titik nyata pertama.
 * Model: kenaikan harian power-law bergeser inc(d) = A·(K+d)^-α — dua parameter
 * di-FIT PER LAGU dari data kworb:
 *  - α: laju di ujung kurva ≈ harian kworb terkini (lagu yang masih ramai → α kecil,
 *    distribusi rata; lagu sepi → α besar, terkonsentrasi di awal);
 *  - K: pangsa hari pertama ≈ 0,45% dari total (kalibrasi rilis nyata: SHEESH 0,40%,
 *    DRIP ±0,30%) supaya bulan rilis tidak dibengkakkan.
 * Tanpa data harian → α default 0,75, K = 1. (Model lama: k tetap 0,9 → hari pertama
 * mewakili ±10% total, jauh dari pola riil Spotify.)
 */
function buildEstimatedSeries(releaseT, firstRealT, C0, currentDaily) {
  if (!releaseT || !firstRealT || !C0 || firstRealT <= releaseT) return [];
  const D0 = Math.floor((firstRealT - releaseT) / DAY);
  if (D0 < 3) return [];
  const LAUNCH = 0.0045; // pangsa total stream pada hari pertama
  const sumInt = (K, a) => (Math.abs(a - 1) < 1e-9
    ? Math.log((K + D0) / K)
    : (Math.pow(K + D0, 1 - a) - Math.pow(K, 1 - a)) / (1 - a));
  const endRate = (K, a) => (C0 / sumInt(K, a)) * Math.pow(K + D0, -a);
  const launch = (K, a) => Math.pow(K, -a) / sumInt(K, a);
  let K = 1, a = 0.75;
  const cd = Math.max(0, Math.floor(currentDaily || 0));
  if (cd > 0) {
    const fitAcd = (K) => { // α agar laju ujung kurva = cd
      let lo = 0.15, hi = 1.6;
      const e = (al) => endRate(K, al) - cd;
      if (e(lo) < 0) return lo;      // lagu masih naik/datar → kurva paling rata
      if (e(hi) > 0) return hi;      // sangat sepi
      for (let i = 0; i < 36; i++) { const m = (lo + hi) / 2; if (e(m) > 0) lo = m; else hi = m; }
      return (lo + hi) / 2;
    };
    a = fitAcd(1);
    if (a > 0.151 && a < 1.599 && launch(1, a) > LAUNCH) {
      // cari K supaya pangsa hari pertama ≈ LAUNCH (α di-refit tiap K)
      let lo = 1, hi = D0;
      for (let i = 0; i < 36; i++) {
        const m = (lo + hi) / 2;
        if (launch(m, fitAcd(m)) > LAUNCH) lo = m; else hi = m;
      }
      K = (lo + hi) / 2; a = fitAcd(K);
    }
  }
  const w = [];
  for (let d = 0; d < D0; d++) w.push(Math.pow(K + d, -a));
  const sumW = w.reduce((s, x) => s + x, 0);
  const A = C0 / sumW;
  const pts = [];
  let cum = 0;
  const stepOf = (d) => (d < 30 ? 1 : d < 180 ? 7 : 30);
  for (let d = 0; d < D0; d += stepOf(d)) {
    cum = 0;
    for (let i = 0; i < d; i++) cum += w[i];
    pts.push({ t: releaseT + d * DAY + 12 * 3600, v: Math.round(A * cum), e: 1 });
  }
  pts.push({ t: firstRealT - DAY, v: Math.round(A * (sumW - w[D0 - 1])), e: 1 });
  return pts;
}

function loadJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA, file), "utf8"));
  } catch {
    return fallback;
  }
}

/* ================================================================ */
async function main() {
  const t0 = now();
  log(`▶ collect_spotify — mulai`, new Date().toISOString());

  const releaseDates = loadJson("spotify-release-dates.json", {});
  const oldTracksRaw = loadJson("spotify-tracks-raw.json", {});
  const oldArtists = loadJson("spotify-artists.json", {});

  /* --- 0. followers via Spotify Web API --- */
  /* Urutan: 1) secret SPOTIFY_CLIENT_ID & SPOTIFY_CLIENT_SECRET (paling andal),
     2) token anonim pemutar embed Spotify (tanpa key, bisa berubah kapan saja). */
  let followersMap = {};
  let apiToken = null;
  let anonToken = null;
  const cid = process.env.SPOTIFY_CLIENT_ID;
  const csec = process.env.SPOTIFY_CLIENT_SECRET;
  const artistIds = CONFIG.artists.map((a) => a.spotify_id).filter(Boolean);
  async function getAnonToken() {
    if (anonToken) return anonToken;
    /* beberapa endpoint token publik — dicakup satu per satu karena ketersediaannya
     * berubah-ubah (IP runner GitHub Actions kadang diblokir Cloudflare) */
    const tries = [
      "https://open.spotify.com/get_access_token?reason=transport&productType=embed",
      "https://open.spotify.com/get_access_token?reason=init&productType=web-player",
      "https://open.spotify.com/api/token?reason=init&productType=web-player",
    ];
    for (const u of tries) {
      try {
        const res = await fetch(u, {
          headers: { "User-Agent": UA, "Accept": "application/json", "Referer": "https://open.spotify.com/" },
          signal: AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined,
        });
        if (!res.ok) { log("  ! token anonim (" + u.split("?")[0].split("/").pop() + "): HTTP " + res.status); continue; }
        const j = await res.json();
        if (j && j.accessToken) { anonToken = j.accessToken; return anonToken; }
      } catch (e) {
        log("  ! token anonim gagal:", String(e).slice(0, 100));
      }
    }
    return null;
  }
  async function fetchFollowers(token) {
    const r = await fetch(`https://api.spotify.com/v1/artists?ids=${artistIds.join(",")}`, {
      headers: { Authorization: "Bearer " + token },
    });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const list = (await r.json()).artists || [];
    for (const j of list) {
      const a = CONFIG.artists.find((x) => x.spotify_id === j.id);
      if (a && j.followers && j.followers.total) followersMap[a.id] = j.followers.total;
    }
  }
  if (artistIds.length) {
    if (cid && csec) {
      try {
        log("↳ mode: Spotify Web API (followers) — via secret");
        const res = await fetch("https://accounts.spotify.com/api/token", {
          method: "POST",
          headers: {
            Authorization: "Basic " + Buffer.from(cid + ":" + csec).toString("base64"),
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: "grant_type=client_credentials",
        });
        if (res.ok) {
          const { access_token } = await res.json();
          apiToken = access_token;
          await fetchFollowers(access_token);
        } else {
          log("  ! token secret gagal: HTTP " + res.status);
        }
      } catch (e) {
        log("  ! followers gagal:", String(e).slice(0, 120));
      }
    } else {
      log("↳ secret SPOTIFY_CLIENT_ID/SECRET belum diisi → coba token anonim Spotify");
      try {
        const tok = await getAnonToken();
        if (tok) { apiToken = tok; await fetchFollowers(tok); }
      } catch (e) {
        log("  ! followers (anonim) gagal:", String(e).slice(0, 120));
      }
      /* 2b) fallback publik stats.fm — mirror data Spotify tanpa key. Dicoba per artis
       *     yang masih kosong; pencocokan lewat Spotify ID supaya tidak salah nama. */
      for (const artist of CONFIG.artists) {
        if (!artist.spotify_id || followersMap[artist.id]) continue;
        try {
          const res = await fetch(`https://api.stats.fm/api/v1/search?query=${encodeURIComponent(artist.name)}&limit=5`, {
            headers: { "User-Agent": UA, "Accept": "application/json" },
            signal: AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined,
          });
          if (!res.ok) throw new Error("HTTP " + res.status);
          const arts = ((await res.json()).items || {}).artists || [];
          const hit = arts.find((x) => x && x.followers && ((x.externalIds || {}).spotify || []).includes(artist.spotify_id));
          if (hit) {
            followersMap[artist.id] = hit.followers;
            log(`  ↳ stats.fm ${artist.name}: ${hit.followers.toLocaleString("en-US")} followers`);
          }
          await sleep(250);
        } catch (e) {
          log(`  ! stats.fm ${artist.name}:`, String(e).slice(0, 80));
        }
      }
      if (!Object.keys(followersMap).length) {
        log("  ! followers kosong — isi secret SPOTIFY_CLIENT_ID & SPOTIFY_CLIENT_SECRET di repo (paling akurat); fallback publik stats.fm pun ikut dicoba otomatis.");
      }
    }
    log(`↳ followers: ${Object.keys(followersMap).length}/${artistIds.length} artis`);
  }

  /* --- 1. kworb listeners (monthly listeners) --- */
  let listenersMap = {};
  try {
    const lh = await fetchText("https://kworb.net/spotify/listeners.html");
    listenersMap = parseKworbListeners(lh);
    log(`↳ kworb listeners: ${Object.keys(listenersMap).length} artis di daftar`);
  } catch (e) {
    log("  ! listeners gagal:", String(e).slice(0, 120));
  }

  const newTracks = {};       // per LAGU gabungan — untuk situs
  const newTracksRaw = {};    // per ID Spotify — cache internal
  const newAlbums = {};
  const newArtists = {};

  for (const artist of CONFIG.artists) {
    if (!artist.spotify_id || !artist.kworb_songs_url) {
      log(`■ ${artist.name} — dilewati (tidak ada spotify_id/kworb_songs_url)`);
      continue;
    }
    log(`\n■ ${artist.name}`);

    /* --- 2. kworb lagu --- */
    const songsHtml = await fetchText(artist.kworb_songs_url);
    const kworb = parseKworbSongs(songsHtml);
    const kworbIds = Object.keys(kworb);
    let kworbTotal = kworbIds.reduce((s, id) => s + kworb[id].total, 0);
    let kworbDaily = kworbIds.reduce((s, id) => s + kworb[id].daily, 0);
    log(`↳ kworb: ${kworbIds.length} lagu | total ${kworbTotal.toLocaleString("en-US")} | harian +${kworbDaily.toLocaleString("en-US")}`);

    /* --- 3. embed artis (avatar) --- */
    let artistImg = null;
    try {
      const ah = await fetchText(`https://open.spotify.com/embed/artist/${artist.spotify_id}`);
      const ae = embedEntity(ah);
      if (ae) artistImg = coverOf(ae);
    } catch (e) {
      log("  ! avatar artis gagal:", String(e).slice(0, 100));
    }
    await sleep(250);

    /* --- 4. album dari embed --- */
    const albumMeta = {};
    for (const al of artist.spotify_albums || []) {
      try {
        const hh = await fetchText(`https://open.spotify.com/embed/album/${al.id}`);
        const ent = embedEntity(hh);
        if (!ent) { log(`  ! album ${al.id} tanpa data`); continue; }
        albumMeta[al.id] = {
          id: al.id,
          name: ent.name,
          artistId: artist.id,
          note: al.note || null,
          cover: coverOf(ent),
          trackList: (ent.trackList || []).map((t) => ({
            id: t.uri.split(":").pop(),
            title: t.title,
            duration: Math.round((t.duration || 0) / 1000),
          })),
          openUrl: `https://open.spotify.com/album/${al.id}`,
        };
        log(`↳ album "${ent.name}" — ${albumMeta[al.id].trackList.length} track`);
      } catch (e) {
        log(`  ! album ${al.id} gagal:`, String(e).slice(0, 100));
      }
      await sleep(250);
    }

    /* --- 5. tanggal rilis & cover lagu (embed track, cache) --- */
    const allTrackIds = new Set();
    for (const id of kworbIds) allTrackIds.add(id);
    for (const al of Object.values(albumMeta)) for (const t of al.trackList) allTrackIds.add(t.id);
    let fetchedRD = 0;
    for (const tid of allTrackIds) {
      if (releaseDates[tid]) continue;
      try {
        const th = await fetchText(`https://open.spotify.com/embed/track/${tid}`);
        const ent = embedEntity(th);
        if (ent) {
          releaseDates[tid] = ((ent.releaseDate && ent.releaseDate.isoString) || "").slice(0, 10) || null;
          if (kworb[tid]) {
            const cv = coverOf(ent);
            if (cv) kworb[tid].cover = cv;
            if (ent.duration) kworb[tid].duration = Math.round(ent.duration / 1000);
          }
          fetchedRD++;
        }
      } catch (e) {
        log(`  ! rilis ${tid} gagal:`, String(e).slice(0, 90));
      }
      await sleep(220);
    }
    log(`↳ tanggal rilis: ${fetchedRD} baru diambil (cache total ${Object.keys(releaseDates).length})`);

    const tn = now();

    /* --- 6. riwayat mentah per ID Spotify --- */
    newTracksRaw[artist.id] = newTracksRaw[artist.id] || {};
    for (const tid of allTrackIds) {
      const s = kworb[tid];
      if (!s) {
        // ID album yang tidak ada di kworb — pertahankan riwayat lama saja
        const oldRaw = (oldTracksRaw[artist.id] || {})[tid];
        if (oldRaw) newTracksRaw[artist.id][tid] = oldRaw;
        continue;
      }
      const oldRaw = (oldTracksRaw[artist.id] || {})[tid] || {};
      const keptReal = (oldRaw.history || []).filter((p) => !p.e);
      if (s.total > 0) {
        keptReal.push({ t: tn, v: s.total, e: 0 });
        if (s.daily > 0 && s.total > s.daily) {
          const y = tn - DAY;
          if (!keptReal.some((p) => dayKey(p.t) === dayKey(y))) {
            keptReal.push({ t: y, v: s.total - s.daily, e: 0 });
          }
        }
      }
      keptReal.sort((a, b) => a.t - b.t);
      let maxV = 0;
      for (const p of keptReal) { if (p.v < maxV) p.v = maxV; maxV = p.v; }
      const keptHist = retainReal(keptReal);
      /* kworb kadang tidak mengisi kolom harian (lagu baru / di luar chart
       * harian — contohnya SHOCK). Kalau kosong, turunkan stream harian dari
       * dua titik terukur terakhir supaya "+ per hari" tidak tampil 0. */
      if (!s.daily && keptHist.length >= 2) {
        const p2 = keptHist[keptHist.length - 2], p1 = keptHist[keptHist.length - 1];
        const dd = p1.v - p2.v;
        if (dd > 0) s.daily = Math.max(1, Math.round(dd / Math.max(1, (p1.t - p2.t) / DAY)));
      }
      newTracksRaw[artist.id][tid] = {
        name: s.title,
        releaseDate: releaseDates[tid] || oldRaw.releaseDate || null,
        cover: s.cover || oldRaw.cover || null,
        duration: s.duration || oldRaw.duration || null,
        total: s.total,
        daily: s.daily,
        history: keptHist,
      };
    }

    /* --- 7. kelompokkan per JUDUL DASAR lagu --- */
    const groups = {}; // key -> {ids:[], name, live}
    for (const tid of kworbIds) {
      const s = kworb[tid];
      const st = splitTitle(s.title);
      const key = songKeyOf(st.base) + (st.live ? "::live" : "");
      if (!key) continue;
      const g = groups[key] = groups[key] || { ids: [], name: st.base, live: st.live };
      g.ids.push(tid);
      if (st.base.length > g.name.length) g.name = st.base;
    }

    /* --- 8. resolusi judul album → kunci lagu --- */
    const groupAlias = {}; // aliasKey -> groupKey
    for (const gk of Object.keys(groups)) {
      const live = groups[gk].live;
      for (const c of candOf(groups[gk].name)) {
        const ak = c + (live ? "::live" : "");
        if (!groupAlias[ak]) groupAlias[ak] = gk;
      }
    }
    const albumIsLive = (al) =>
      /(live|\btour\b|\bdome\b|\barena\b|fan concert|k-arena|kyocera|makuhari|special in)/i.test((al && al.name) || "");
    const resolveAlbumTrack = (title, al) => {
      const st = splitTitle(title);
      const baseKey = songKeyOf(st.base);
      if (!baseKey) return null;
      if (al && albumIsLive(al)) {
        // album live: hanya cocok ke grup live
        if (groups[baseKey + "::live"]) return baseKey + "::live";
        return null;
      }
      // album studio: utamakan grup studio, hindari grup live
      if (groups[baseKey] && !groups[baseKey].live) return baseKey;
      for (const c of candOf(title)) {
        const gk = Object.keys(groups).find((k) => k === c && !groups[k].live);
        if (gk) return gk;
      }
      for (const c of candOf(title)) {
        const a = groupAlias[c];
        if (a && !groups[a].live) return a;
      }
      return null;
    };

    /* --- 9. susun entri lagu gabungan --- */
    for (const gk of Object.keys(groups)) {
      const g = groups[gk];
      const ids = g.ids;
      // album yang cocok via alias/kandidat
      const albSet = new Set();
      for (const al of Object.values(albumMeta)) {
        for (const t of al.trackList) {
          if (resolveAlbumTrack(t.title, al) === gk) { albSet.add(al.id); break; }
        }
      }
      const albumIds = [...albSet];
      // nama tampilan: judul album (kanonik) bila cocok, selain itu nama grup
      let dispName = g.name;
      outer: for (const al of Object.values(albumMeta)) {
        for (const t of al.trackList) {
          if (resolveAlbumTrack(t.title, al) === gk) {
            const st = splitTitle(t.title);
            dispName = st.base || t.title;
            break outer;
          }
        }
      }
      if (g.live) dispName = dispName.replace(/\s*\((7 ver\.?|remix[^(]*)\)\s*$/i, "").trim();
      // gabung riwayat: per hari, jumlah kumulatif tiap ID
      const dayVals = new Map();
      for (const tid of ids) {
        for (const p of (newTracksRaw[artist.id][tid] || {}).history || []) {
          const dk = dayKey(p.t);
          const cur = dayVals.get(dk) || { sum: 0, ts: p.t };
          cur.sum += p.v;
          cur.ts = Math.max(cur.ts, p.t);
          dayVals.set(dk, cur);
        }
      }
      const merged = [...dayVals.entries()]
        .map(([dk, { sum, ts }]) => ({ t: ts, v: sum, e: 0 }))
        .sort((a, b) => a.t - b.t);
      let mx = 0;
      for (const p of merged) { if (p.v < mx) p.v = mx; mx = p.v; }
      // tanggal rilis: override premier resmi > minimum antar ID
      const rds = ids.map((tid) => (newTracksRaw[artist.id][tid] || {}).releaseDate).filter(Boolean).sort();
      const rd = RD_OVERRIDE[artist.id + "::" + gk] || rds[0] || null;
      const totalSum = ids.reduce((s, tid) => s + ((newTracksRaw[artist.id][tid] || {}).total || 0), 0);
      const dailySum = ids.reduce((s, tid) => s + ((newTracksRaw[artist.id][tid] || {}).daily || 0), 0);
      // estimasi sejak rilis (α di-fit ke laju harian kworb)
      const firstReal = merged[0];
      let est = [];
      if (firstReal && rd) {
        const relT = Date.parse(rd + "T12:00:00Z") / 1000;
        est = buildEstimatedSeries(relT, firstReal.t, firstReal.v, dailySum);
      }
      const primary = ids.slice().sort((a, b) => (newTracksRaw[artist.id][b].total || 0) - (newTracksRaw[artist.id][a].total || 0))[0];
      const cover = (albumIds[0] && albumMeta[albumIds[0]] && albumMeta[albumIds[0]].cover)
        || ids.map((tid) => (newTracksRaw[artist.id][tid] || {}).cover).find(Boolean) || null;
      const duration = ids.map((tid) => (newTracksRaw[artist.id][tid] || {}).duration).find(Boolean) || null;
      const fullKey = artist.id + "::" + gk;
      newTracks[fullKey] = {
        key: fullKey,
        name: dispName || g.name,
        live: g.live || undefined,
        artistId: artist.id,
        albumIds,
        trackIds: ids,
        releaseDate: rd,
        duration,
        cover,
        openUrl: `https://open.spotify.com/track/${primary}`,
        history: mergeHistory(est, merged),
        kworb: { total: totalSum, daily: dailySum, ts: tn },
      };
    }

    /* --- 10. lagu album yang tidak terhubung kworb (stream 0 / baru rilis) --- */
    for (const al of Object.values(albumMeta)) {
      for (const t of al.trackList) {
        const resolved = resolveAlbumTrack(t.title, al);
        if (resolved && newTracks[artist.id + "::" + resolved]) continue;
        const stt = splitTitle(t.title);
        const key = artist.id + "::" + songKeyOf(stt.base) + (albumIsLive(al) ? "::live" : "");
        if (newTracks[key]) continue;
        const rdList = al.trackList.map((x) => releaseDates[x.id]).filter(Boolean).sort();
        newTracks[key] = {
          key,
          name: stt.base || t.title,
          live: albumIsLive(al) ? true : undefined,
          artistId: artist.id,
          albumIds: [al.id],
          trackIds: [t.id],
          releaseDate: releaseDates[t.id] || rdList[0] || null,
          duration: t.duration || null,
          cover: al.cover,
          openUrl: `https://open.spotify.com/track/${t.id}`,
          history: [],
          kworb: null,
        };
      }
    }

    /* --- 11. album --- */
    for (const al of Object.values(albumMeta)) {
      const rdList = al.trackList.map((t) => releaseDates[t.id]).filter(Boolean).sort();
      const rows = [];
      const usedKey = new Set();
      for (const t of al.trackList) {
        const resolved = resolveAlbumTrack(t.title, al);
        let key = resolved
          ? artist.id + "::" + resolved
          : artist.id + "::" + songKeyOf(splitTitle(t.title).base) + (albumIsLive(al) ? "::live" : "");
        if (usedKey.has(key)) continue; // baris dobel di album yang sama
        usedKey.add(key);
        rows.push({ key, title: t.title, duration: t.duration });
      }
      newAlbums[al.id] = {
        id: al.id,
        name: al.name,
        artistId: artist.id,
        cover: al.cover,
        openUrl: al.openUrl,
        releaseDate: rdList[0] || null,
        type: albumTypeOf(al.note),
        tracks: rows,
      };
    }

    /* --- 12. artis --- */
    /* hitung ulang total & harian kworb — angka harian turunan (lagu yang kolom
     * hariannya kosong di kworb) ikut masuk jumlah artis */
    kworbTotal = kworbIds.reduce((s, id) => s + kworb[id].total, 0);
    kworbDaily = kworbIds.reduce((s, id) => s + kworb[id].daily, 0);
    let ml = listenersMap[artist.name] || null;
    let mlApprox = false;
    if (!ml) {
      // artis di luar 2.500 besar global kworb → ambil dari halaman Spotify
      const v = await fetchMonthlyListenersFallback(artist.spotify_id);
      if (v) { ml = { listeners: v, delta: null }; mlApprox = true; }
      await sleep(300);
    }
    const oldArt = oldArtists[artist.id] || {};
    const artHist = (oldArt.history || []).filter((p) => p && p.t && p.total != null);
    artHist.push({ t: tn, total: kworbTotal, daily: kworbDaily, ml: ml ? ml.listeners : null, f: followersMap[artist.id] || oldArt.followers || null });
    const seen = new Map();
    for (const p of artHist.sort((a, b) => a.t - b.t)) {
      const age = tn - p.t;
      const key = age <= 90 * DAY ? "d" + dayKey(p.t) : "w" + Math.floor(p.t / (7 * DAY));
      seen.set(key, p);
    }
    newArtists[artist.id] = {
      id: artist.id,
      name: artist.name,
      spotifyId: artist.spotify_id,
      color: artist.color,
      image: artistImg || oldArt.image || null,
      monthlyListeners: ml ? ml.listeners : null,
      mlDelta: ml ? ml.delta : null,
      mlApprox: mlApprox || undefined,
      followers: followersMap[artist.id] || oldArt.followers || null,
      totalStreams: kworbTotal,
      dailyStreams: kworbDaily,
      trackCount: kworbIds.length,
      history: [...seen.values()].sort((a, b) => a.t - b.t),
      openUrl: `https://open.spotify.com/artist/${artist.spotify_id}`,
    };
  }

  /* --- 12b. popularity per lagu via Spotify Web API (riwayat file terpisah) --- */
  /* Popularity = angka resmi Spotify 0-100 per lagu. Direkam bertahap ke
   * spotify-popularity.json keyed by track ID; situs memakainya untuk grafik
   * popularitas di modal lagu & daftar "Popularity tertinggi" di Rekor. */
  try {
    const tok = apiToken || (await getAnonToken());
    if (tok) {
      const popHist = loadJson("spotify-popularity.json", {});
      const allTids = [];
      for (const aid of Object.keys(newTracksRaw)) for (const tid of Object.keys(newTracksRaw[aid])) allTids.push(tid);
      let nPop = 0;
      for (let i = 0; i < allTids.length; i += 50) {
        const batch = allTids.slice(i, i + 50);
        const r = await fetch("https://api.spotify.com/v1/tracks?ids=" + batch.join(","), {
          headers: { Authorization: "Bearer " + tok },
          signal: AbortSignal.timeout ? AbortSignal.timeout(20000) : undefined,
        });
        if (!r.ok) throw new Error("HTTP " + r.status);
        for (const trj of (await r.json()).tracks || []) {
          if (!trj || !trj.id || trj.popularity == null) continue;
          const arr = popHist[trj.id] || (popHist[trj.id] = []);
          const lastP = arr.length ? arr[arr.length - 1] : null;
          if (lastP && lastP.p === trj.popularity && now() - lastP.t < 20 * 3600) continue;
          arr.push({ t: now(), p: trj.popularity });
          if (arr.length > 500) arr.splice(0, arr.length - 500);
          nPop++;
        }
      }
      fs.writeFileSync(path.join(DATA, "spotify-popularity.json"), JSON.stringify(popHist));
      log(`✓ popularity: ${Object.keys(popHist).length} lagu tersimpan (${nPop} titik baru)`);
    } else {
      log("! popularity dilewati — tidak ada token Spotify");
    }
  } catch (e) {
    log("! popularity gagal:", String(e).slice(0, 140));
  }

  /* --- 13. simpan --- */
  fs.writeFileSync(path.join(DATA, "spotify-tracks.json"), JSON.stringify(newTracks));
  fs.writeFileSync(path.join(DATA, "spotify-albums.json"), JSON.stringify(newAlbums, null, 1));
  fs.writeFileSync(path.join(DATA, "spotify-artists.json"), JSON.stringify(newArtists, null, 1));
  fs.writeFileSync(path.join(DATA, "spotify-tracks-raw.json"), JSON.stringify(newTracksRaw));
  const meta = {
    last_updated: now(),
    schema: 2,
    mode: "kworb+embed",
    duration_sec: now() - t0,
    note: CONFIG.site.schema_note_spotify || "",
    has_followers: Object.keys(followersMap).length > 0,
    has_popularity: (() => { try { return Object.keys(JSON.parse(fs.readFileSync(path.join(DATA, "spotify-popularity.json"), "utf8") || "{}")).length > 0; } catch { return false; } })(),
  };
  fs.writeFileSync(path.join(DATA, "spotify-meta.json"), JSON.stringify(meta, null, 1));
  fs.writeFileSync(path.join(DATA, "spotify-release-dates.json"), JSON.stringify(releaseDates));

  log(`\n✓ Selesai: ${Object.keys(newTracks).length} lagu, ${Object.keys(newAlbums).length} album, ${Object.keys(newArtists).length} artis — ${meta.duration_sec}s`);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
