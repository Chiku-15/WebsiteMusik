#!/usr/bin/env node
/**
 * recover_history.js — pemulih data riil dari riwayat git (Pemantau K-POP PULSE)
 * ================================================================
 * Kenapa ada: riwayat titik rekam bersifat kumulatif, dan setiap putaran GitHub Actions
 * melakukan commit data. Artinya SEMUA titik nyata yang pernah direkam situs masih ada
 * di riwayat git — walau file data saat ini pernah diunggah ulang/di-seed ulang sehingga
 * riwayatnya menyusut jadi titik perekaman terbaru + kurva estimasi (e:1).
 *
 * Apa yang dilakukan skrip ini:
 *   1. Telusuri setiap commit yang menyentuh data/spotify-tracks.json, data/videos.json
 *      dan data/channels.json (inkremental — mulai dari commit terakhir yang diproses,
 *      ditandai di data/.recover-progress.json).
 *   2. Dari setiap snapshot lama, ambil semua titik NYATA (e≠1) — tidak ada yang diarang.
 *   3. Gabungkan titik-titik itu ke file data saat ini:
 *        • titik nyata hasil pemulihan MENANG atas titik estimasi di sekitarnya;
 *        • titik estimasi (e:1) yang kini terapit dua titik nyata (±26 jam) dibuang;
 *        • titik estimasi sebelum titik nyata pertama (masa pra-pemantauan) tetap dipertahankan;
 *        • deret di-clamp monoton naik seperti yang dilakukan kolektor.
 *   4. Simpan penanda commit terakhir supaya putaran berikutnya cukup memproses commit baru.
 *
 * Dipanggil otomatis oleh workflow sebelum kolektor berjalan. Tidak butuh API key & aman
 * diulang (idempoten).
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = __dirname;
const DATA = path.join(ROOT, "data");
const MARKER = path.join(DATA, ".recover-progress.json");
const MAX_COMMITS_FIRST_RUN = 1500;
const FILES = [
  { f: "data/spotify-tracks.json", kind: "hist" },
  { f: "data/videos.json", kind: "hist" },
  { f: "data/channels.json", kind: "hist" },
];

function git(args, enc) {
  return execFileSync("git", args, { cwd: ROOT, maxBuffer: 1024 * 1024 * 512, encoding: enc || "utf8" });
}

function loadJSON(s) { try { return JSON.parse(s); } catch (e) { return null; } }

/* kumpulkan titik nyata dari satu snapshot */
function realPoints(obj, out) {
  if (!obj || typeof obj !== "object") return;
  for (const id of Object.keys(obj)) {
    const h = obj[id] && obj[id].history;
    if (!Array.isArray(h)) continue;
    for (const p of h) {
      if (!p || typeof p.t !== "number" || typeof p.v !== "number" || p.e === 1) continue;
      const k = id + "|" + Math.floor(p.t);
      const prev = out.get(k);
      if (!prev || p.v > prev.v) out.set(k, { t: p.t, v: p.v });
    }
  }
}

function mergeInto(hist, recovered, id) {
  const pts = (hist || []).filter((p) => p && typeof p.t === "number");
  const byT = new Map();
  for (const p of pts) byT.set(Math.floor(p.t), p);
  const rec = recovered.get(id);
  if (rec) {
    for (const [t, p] of rec) {
      const cur = byT.get(t);
      if (!cur) byT.set(t, { t, v: p.v, e: 0 });
      else if (cur.e === 1) byT.set(t, { t, v: Math.max(cur.v || 0, p.v), e: 0 });
      else if (p.v > cur.v) cur.v = p.v;
    }
  }
  let arr = [...byT.values()].sort((a, b) => a.t - b.t);
  const times = arr.filter((p) => p.e !== 1).map((p) => p.t);
  /* buang titik estimasi yang kini terapit dua titik nyata (±26 jam) */
  if (times.length >= 2) {
    arr = arr.filter((p) => {
      if (p.e !== 1) return true;
      let before = false, after = false;
      for (const t of times) { if (t <= p.t - 3600 && p.t - t <= 26 * 3600) before = true; if (t >= p.t + 3600 && t - p.t <= 26 * 3600) after = true; }
      return !(before && after);
    });
  }
  /* clamp monoton */
  let maxV = 0;
  for (const p of arr) { if (p.v < maxV) p.v = maxV; if (p.v > maxV) maxV = p.v; }
  return arr;
}

function main() {
  let marker = { last: null };
  try { marker = { ...marker, ...loadJSON(fs.readFileSync(MARKER, "utf8")) }; } catch (e) {}
  let markerDirty = false;

  for (const { f } of FILES) {
    const abs = path.join(ROOT, f);
    if (!fs.existsSync(abs)) continue;
    /* daftar commit yang menyentuh file ini (terbaru dulu) */
    let log;
    try { log = git(["log", "--format=%H %ct", "--no-merges", "--", f]).trim().split("\n").filter(Boolean); } catch (e) { continue; }
    let commits = log.map((l) => { const sp = l.lastIndexOf(" "); return { h: l.slice(0, sp), t: Number(l.slice(sp + 1)) }; });
    if (marker.last) {
      const idx = commits.findIndex((c) => c.h === marker.last);
      if (idx >= 0) commits = commits.slice(0, idx); // hanya commit LEBIH BARU dari marker
    }
    if (!commits.length) continue;
    if (marker.last === null && commits.length > MAX_COMMITS_FIRST_RUN) {
      console.log(`recover: ${commits.length} commit untuk ${f} — dibatasi ${MAX_COMMITS_FIRST_RUN} terbaru (run ulang untuk sisanya)`);
      commits = commits.slice(0, MAX_COMMITS_FIRST_RUN);
    }
    /* snapshot lama dari commit TERBARU → terlama; titik nyata diakumulasi */
    const recovered = new Map(); // id -> Map(floor(t) -> {t, v})
    let used = 0;
    for (const c of commits.slice().reverse()) {
      let snap;
      try { snap = loadJSON(git(["show", c.h + ":" + f])); } catch (e) { continue; }
      if (!snap) continue;
      realPoints(snap, recovered);
      used++;
    }
    if (!used) continue;
    /* per id: map besar → simpan map per id agar merge cepat */
    const perId = new Map();
    for (const [k, p] of recovered) {
      const id = k.slice(0, k.lastIndexOf("|"));
      if (!perId.has(id)) perId.set(id, new Map());
      perId.get(id).set(Math.floor(p.t), p);
    }
    const cur = loadJSON(fs.readFileSync(abs, "utf8"));
    if (!cur) continue;
    let changed = 0, added = 0;
    for (const id of Object.keys(cur)) {
      const o = cur[id];
      if (!o || !Array.isArray(o.history)) continue;
      const rec = perId.get(id);
      if (!rec) continue;
      const before = o.history.length;
      o.history = mergeInto(o.history, new Map([[id, rec]]), id);
      if (o.history.length !== before) { changed++; added += o.history.length - before; }
    }
    if (changed) {
      fs.writeFileSync(abs, JSON.stringify(cur, null, 1));
      console.log(`recover: ${f} — ${changed} entri diperbarui (+${added} titik nyata dari ${used} commit)`);
    } else {
      console.log(`recover: ${f} — ${used} commit diproses, tidak ada titik baru`);
    }
  }
  /* marker = commit terbaru global yang sudah diproses */
  try {
    const top = git(["log", "--format=%H", "--no-merges", "-1"]).trim();
    if (top && top !== marker.last) { fs.writeFileSync(MARKER, JSON.stringify({ last: top }, null, 1)); markerDirty = true; }
  } catch (e) {}
  if (markerDirty) console.log("recover: penanda commit diperbarui (putaran berikutnya inkremental)");
}

try { main(); } catch (e) { console.error("recover gagal (dilewati):", String(e).slice(0, 300)); process.exit(0); }
