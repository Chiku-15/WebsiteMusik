#!/usr/bin/env node
/**
 * collect_music.js — kolektor stats musik tambahan (dijalankan GitHub Actions per jam)
 *
 * Yang diperbarui otomatis:
 *   data/ytmusic.json   — views tiap versi resmi lagu (field `id` per part) dijumlah → total per lagu
 *   data/livestage.json — views tiap panggung live (field `id` per stage)
 *
 * Sumber angka (urutan prioritas):
 *   1. YouTube Data API videos.list part=statistics (YOUTUBE_API_KEY) — ±1-2 unit/run, ±40 id → 1 call
 *   2. data/videos.json (hasil kolektor YouTube utama) untuk id kanal BABYMONSTER/TREASURE
 *   3. Snapshot lama di file itu sendiri (id yang tak terjangkau tetap konsisten, tidak pernah di-nol-kan)
 *
 * Prinsip: tidak pernah menulis angka nol/karangan — bila tidak ada satupun id yang berhasil
 * dibaca ulang, file tidak ditulis dan data lama tetap dipakai.
 */

const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const DATA = path.join(ROOT, "data");

const log = (...a) => console.log("[collect_music]", ...a);

function readJSON(file) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA, file), "utf8")); }
  catch (e) { return null; }
}
function writeJSON(file, obj) {
  fs.writeFileSync(path.join(DATA, file), JSON.stringify(obj, null, 1) + "\n");
}
/* tanggal hari ini di zona WIB */
function todayWIB() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
}
/* views terakhir yang tercatat di videos.json (kolektor utama) untuk sebuah id */
function viewsFromVideosJson(videos, id) {
  const v = videos && videos[id];
  if (!v || !Array.isArray(v.history)) return null;
  for (let i = v.history.length - 1; i >= 0; i--) {
    if (v.history[i].v != null) return v.history[i].v;
  }
  return null;
}

/* --- ambil views dari YouTube Data API (≤50 id per call, 1 unit per call) --- */
async function fetchYouTubeViews(ids, key) {
  const out = {};
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const url = "https://www.googleapis.com/youtube/v3/videos?part=statistics&id=" + batch.join(",") + "&key=" + key;
    const r = await fetch(url);
    if (!r.ok) throw new Error("YouTube API " + r.status + " " + (await r.text()).slice(0, 200));
    const j = await r.json();
    for (const it of j.items || []) {
      out[it.id] = it.statistics && it.statistics.viewCount != null ? Number(it.statistics.viewCount) : null;
    }
  }
  return out;
}

(async () => {
  const KEY = process.env.YOUTUBE_API_KEY || "";
  const ytm = readJSON("ytmusic.json");
  const ls = readJSON("livestage.json");
  if (!ytm || !ls) {
    log("ytmusic.json / livestage.json tidak ditemukan di data/ — lewati (file kurasi belum diunggah).");
    return;
  }
  const videos = readJSON("videos.json"); // fallback kanal resmi

  /* kumpulkan semua id unik */
  const ids = new Set();
  for (const a of Object.values(ytm.artists || {}))
    for (const s of a.songs || [])
      for (const p of s.parts || []) if (p.id) ids.add(p.id);
  for (const a of Object.values(ls.artists || {}))
    for (const st of a.stages || []) if (st.id) ids.add(st.id);
  const idList = [...ids];
  log("id unik:", idList.length);

  let fresh = {}; // id -> views
  let apiOk = false;
  if (KEY && idList.length) {
    try {
      fresh = await fetchYouTubeViews(idList, KEY);
      apiOk = true;
      log("YouTube API: " + Object.keys(fresh).length + " video terbaca");
    } catch (e) {
      log("YouTube API gagal — pakai fallback videos.json:", String(e.message).slice(0, 120));
    }
  } else if (!KEY) {
    log("YOUTUBE_API_KEY kosong — pakai fallback data/videos.json");
  }

  const resolve = (id, oldV) => {
    if (apiOk && fresh[id] != null && fresh[id] > 0) return { v: fresh[id], src: "api" };
    const f = viewsFromVideosJson(videos, id);
    if (f != null && f > 0 && f !== oldV) return { v: f, src: "videos.json" };
    return { v: oldV, src: "snapshot" };
  };

  const today = todayWIB();
  let changed = 0, apic = 0, fall = 0, snap = 0;

  /* --- ytmusic.json --- */
  if (apiOk) {
    for (const a of Object.values(ytm.artists || {})) {
      for (const s of a.songs || []) {
        let total = 0;
        for (const p of s.parts || []) {
          const { v, src } = resolve(p.id, p.views);
          if (v != null) {
            /* views YouTube monoton naik — jangan pernah mundurkan angka (bila sumber lebih tua dari snapshot, snapshot yang menang) */
            const nv = Math.max(v, p.views || 0);
            if (nv > (p.views || 0)) changed++;
            else if (nv < v) log("  angka sumber lebih tua dari snapshot, dipertahankan:", p.id, v, "<", p.views);
            p.views = nv; total += nv;
            if (src === "api") apic++; else if (src === "videos.json") fall++; else snap++;
          }
          else if (p.views != null) total += p.views;
        }
        if (total > 0) s.views = total;
        if (s.n != null && s.parts) s.n = s.parts.length;
      }
    }
  } else {
    /* tanpa API: hanya id kanal resmi yang bisa segar dari videos.json */
    let any = 0;
    for (const a of Object.values(ytm.artists || {})) {
      for (const s of a.songs || []) {
        let total = 0;
        for (const p of s.parts || []) {
          const f = viewsFromVideosJson(videos, p.id);
          if (f != null && f > 0) {
            const nv = Math.max(f, p.views || 0);
            if (nv > (p.views || 0)) changed++;
            p.views = nv; total += nv; any++;
          }
          else if (p.views != null) total += p.views;
        }
        if (total > 0) s.views = total;
        if (s.n != null && s.parts) s.n = s.parts.length;
      }
    }
    log("ytmusic fallback videos.json:", any, "part terbaca");
  }

  /* --- livestage.json --- */
  let lsAny = 0;
  for (const a of Object.values(ls.artists || {})) {
    for (const st of a.stages || []) {
      const { v } = resolve(st.id, st.views);
      if (v != null && v > 0) {
        const nv = Math.max(v, st.views || 0);
        if (nv > (st.views || 0)) changed++;
        st.views = nv;
        lsAny++;
      }
    }
  }

  /* tanggal hanya bergeser bila ada angka yang benar-benar naik */
  if (changed > 0) {
    ytm.captured = today; ytm.updated = today;
    ls.captured = today; ls.updated = today;
    writeJSON("ytmusic.json", ytm);
    writeJSON("livestage.json", ls);
    log("Simpan: " + changed + " angka naik (ytmusic part segar: " + (apic + fall) + ", livestage terbaca: " + lsAny + ")");
  } else {
    log("Tidak ada angka yang berubah — file tidak diubah (data lama tetap).");
  }
})();
