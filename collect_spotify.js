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
  const re = /<td class="text"><div><a href="https:\/\/open\.spotify\.com\/track\/([A-Za-z0-9]{22})"[^>]*>([\s\S]*?)<\/a><\/div><\/td><td>([\d,]+)<\/td><td>([\d,]+)<\/td>/g;
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
 * Model: kenaikan harian menurun power-law inc(d) ∝ (1+d)^-k, dinormalisasi
 * agar kumulatif tepat menyentuh C0 pada hari titik nyata pertama.
 */
function buildEstimatedSeries(releaseT, firstRealT, C0, k = 0.9) {
  if (!releaseT || !firstRealT || !C0 || firstRealT <= releaseT) return [];
  const D0 = Math.floor((firstRealT - releaseT) / DAY);
  if (D0 < 3) return [];
  let sum = 0;
  for (let d = 0; d < D0; d++) sum += Math.pow(1 + d, -k);
  const A = C0 / sum;
  const pts = [];
  let cum = 0;
  const stepOf = (d) => (d < 30 ? 1 : d < 180 ? 7 : 30);
  for (let d = 0; d < D0; d += stepOf(d)) {
    cum = 0;
    for (let i = 0; i < d; i++) cum += Math.pow(1 + i, -k);
    pts.push({ t: releaseT + d * DAY + 12 * 3600, v: Math.round(A * cum), e: 1 });
  }
  pts.push({ t: firstRealT - DAY, v: Math.round(A * (sum - Math.pow(1 + (D0 - 1), -k))), e: 1 });
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

  /* --- 0. (opsional) followers via Spotify Web API resmi --- */
  let followersMap = {};
  const cid = process.env.SPOTIFY_CLIENT_ID;
  const csec = process.env.SPOTIFY_CLIENT_SECRET;
  if (cid && csec) {
    try {
      log("↳ mode: Spotify Web API (followers)");
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
        for (const a of CONFIG.artists) {
          if (!a.spotify_id) continue;
          const r = await fetch(`https://api.spotify.com/v1/artists/${a.spotify_id}`, {
            headers: { Authorization: "Bearer " + access_token },
          });
          if (r.ok) {
            const j = await r.json();
            followersMap[a.id] = (j.followers && j.followers.total) || null;
          }
          await sleep(200);
        }
      }
    } catch (e) {
      log("  ! followers gagal:", String(e).slice(0, 120));
    }
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
    const kworbTotal = kworbIds.reduce((s, id) => s + kworb[id].total, 0);
    const kworbDaily = kworbIds.reduce((s, id) => s + kworb[id].daily, 0);
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
      newTracksRaw[artist.id][tid] = {
        name: s.title,
        releaseDate: releaseDates[tid] || oldRaw.releaseDate || null,
        cover: s.cover || oldRaw.cover || null,
        duration: s.duration || oldRaw.duration || null,
        total: s.total,
        daily: s.daily,
        history: retainReal(keptReal),
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
      // tanggal rilis: minimum antar ID
      const rds = ids.map((tid) => (newTracksRaw[artist.id][tid] || {}).releaseDate).filter(Boolean).sort();
      const rd = rds[0] || null;
      // estimasi sejak rilis
      const firstReal = merged[0];
      let est = [];
      if (firstReal && rd) {
        const relT = Date.parse(rd + "T12:00:00Z") / 1000;
        est = buildEstimatedSeries(relT, firstReal.t, firstReal.v, 0.9);
      }
      const primary = ids.slice().sort((a, b) => (newTracksRaw[artist.id][b].total || 0) - (newTracksRaw[artist.id][a].total || 0))[0];
      const totalSum = ids.reduce((s, tid) => s + ((newTracksRaw[artist.id][tid] || {}).total || 0), 0);
      const dailySum = ids.reduce((s, tid) => s + ((newTracksRaw[artist.id][tid] || {}).daily || 0), 0);
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
    const ml = listenersMap[artist.name] || null;
    const oldArt = oldArtists[artist.id] || {};
    const artHist = (oldArt.history || []).filter((p) => p && p.t && p.total != null);
    artHist.push({ t: tn, total: kworbTotal, daily: kworbDaily, ml: ml ? ml.listeners : null });
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
      followers: followersMap[artist.id] || oldArt.followers || null,
      totalStreams: kworbTotal,
      dailyStreams: kworbDaily,
      trackCount: kworbIds.length,
      history: [...seen.values()].sort((a, b) => a.t - b.t),
      openUrl: `https://open.spotify.com/artist/${artist.spotify_id}`,
    };
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
  };
  fs.writeFileSync(path.join(DATA, "spotify-meta.json"), JSON.stringify(meta, null, 1));
  fs.writeFileSync(path.join(DATA, "spotify-release-dates.json"), JSON.stringify(releaseDates));

  log(`\n✓ Selesai: ${Object.keys(newTracks).length} lagu, ${Object.keys(newAlbums).length} album, ${Object.keys(newArtists).length} artis — ${meta.duration_sec}s`);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
