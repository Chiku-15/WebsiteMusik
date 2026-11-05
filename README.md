# Pemantau YouTube (versi GitHub) — BABYMONSTER × TREASURE

Statistik YouTube dua artis — **BABYMONSTER** dan **TREASURE** — direkam otomatis **2× sehari** oleh GitHub Actions, lalu ditampilkan sebagai situs grafik ala bm-tracker: jumlah views, likes, subscriber, pertumbuhan harian, sampai perkiraan tanggal tembus milestone.

**Tidak perlu server, tidak perlu VPS.** Semuanya berjalan gratis di GitHub: Actions merekam data, Pages menayangkannya.

## Fitur

- **Dua artis** dalam satu situs (tab BABYMONSTER / TREASURE) — mudah ditambah artis lain
- **Kartu channel**: subscriber, total ditonton, jumlah video + grafik mini pertumbuhan
- **120+ video terpantau**: MV, Dance Performance, dan Dance Practice resmi
- **Grafik per video**: views kumulatif + views ditambahkan per hari
- **Milestone & prediksi**: perkiraan tanggal tembus 500 jt, 1 M dsb. (berdasarkan rata-rata 7 hari)
- **Mode gelap/terang** dengan tombol toggle
- Seluruh antarmuka berbahasa Indonesia
- **Deteksi rilis baru otomatis**: MV/performance/practice baru yang diunggah ke channel langsung masuk daftar tanpa edit apa pun

## Cara kerja singkat

```
GitHub Actions (07:00 & 19:00 WIB)
  │ node collect.js → YouTube Data API v3 (pakai Secret YT_API_KEY)
  ▼
data/*.json (riwayat angka, di-commit oleh github-actions[bot])
  ▼
GitHub Pages menayangkan index.html yang membaca data/*.json
```

## Struktur file

| File | Fungsi |
| --- | --- |
| `index.html` | Situs (satu file, tanpa build) |
| `config.json` | Daftar artis, channel, dan video yang dipantau |
| `collect.js` | Skrip pengambil data (Node.js, tanpa dependensi) |
| `data/videos.json` | Riwayat views & likes per video |
| `data/channels.json` | Riwayat subscriber & total views per channel |
| `data/meta.json` | Info pembaruan terakhir |
| `.github/workflows/collect.yml` | Jadwal pengambilan data (2× sehari) |

## Cara pasang di GitHub (dari nol)

> Kamu butuh **YouTube API Key** (gratis). Kalau belum punya, lihat bagian di bawah.

1. **Buat repo baru** di GitHub, mis. `pemantau-youtube`. Public.
2. **Unggah semua file** proyek ini ke repo (tombol *Add file → Upload files*), atau lewat `git push`.
3. **Simpan API key** sebagai Secret:
 - Buka *Settings → Secrets and variables → Actions → New repository secret*
 - Name: `YT_API_KEY` — Secret: isi API key-mu → *Add secret*
4. **Aktifkan GitHub Pages**:
 - *Settings → Pages → Build and deployment → Source: **Deploy from a branch***
 - Branch: `main`, folder: `/(root)` → *Save*
5. **Jalankan data pertama**:
 - Buka tab *Actions → Kumpulkan data YouTube → Run workflow → Run workflow*
 - Tunggu ±1 menit sampai selesai; file di `data/` akan terisi.
6. **Buka situsnya**: `https://USERNAME.github.io/pemantau-youtube/`
7. Selesai! Data berikutnya otomatis terekam **setiap hari pukul 07:00 & 19:00 WIB**.

## Cara ambil YouTube API Key (kalau belum punya)

1. Buka [console.cloud.google.com](https://console.cloud.google.com) → buat project baru (nama bebas).
2. Menu *APIs & Services → Library* → cari **YouTube Data API v3** → *Enable*.
3. Menu *APIs & Services → Credentials → Create credentials → API key* → salin kuncinya.
4. (Disarankan) Klik API key tersebut → *API restrictions* → batasi hanya untuk *YouTube Data API v3*.
5. Kuota gratis 10.000 unit/hari — pemantau ini hanya memakai ±15 unit per putaran, jadi sangat aman.

## Menambah artis / video

Edit `config.json`:

```json
{
 "id": "artis-baru",
 "name": "NAMA ARTIS",
 "handle": "@handleYouTube",
 "channel_id": "UCxxxxxxxxxxxxxxxxxxxxxx",
 "color": "#8b5cf6",
 "videos": [
 { "id": "VIDEO_ID", "category": "mv", "featured": true }
 ]
}
```

- `category` pilihan: `mv`, `dance_performance`, `dance_practice`
- `channel_id` ada di URL channel YouTube (bagian setelah `/channel/`)
- Video **MV/performance/practice baru** yang diunggah ke channel sudah otomatis terdeteksi; menambah lewat `config.json` hanya perlu kalau ingin memantau video lama/khusus.

## Mengganti jadwal

Edit `.github/workflows/collect.yml` bagian `cron` (zona UTC):

- 1× sehari → hapus salah satu baris cron (sisakan `0 0 * * *` = 07:00 WIB)
- 4× sehari → tambah `0 6 * * *` dan `0 18 * * *`

## Pertanyaan umum

**Apakah API key saya aman?** Ya — key disimpan sebagai *repository secret*, tidak ikut ter-commit, dan hanya dipakai di Actions. Situs publik tidak pernah menyentuh key karena data sudah dikumpulkan ke `data/*.json`.

**Kenapa grafik masih kosong?** Riwayat terkumpul mulai hari pertama dipasang. Semakin lama semakin lengkap — biarkan Actions bekerja beberapa hari.

**Angka di awal sedikit meleset (subscriber dibulatkan, tanggal rilis perkiraan)?** Titik data pertama berasal dari cuplikan halaman publik YouTube yang dibulatkan (mis. "425 jt views", "2 years ago"). Begitu workflow pertama dijalankan dengan API key, semua angka dan tanggal rilis otomatis diperbarui ke nilai persis dari YouTube Data API.

---
Dibuat dengan GitHub Actions + GitHub Pages
