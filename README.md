# K-POP PULSE (versi GitHub) — Statistik YouTube Artis K-pop

Situs statistik YouTube untuk artis K-pop — saat ini berisi **BABYMONSTER** dan **TREASURE** — direkam otomatis **2× sehari** oleh GitHub Actions, lalu ditampilkan sebagai situs grafik: jumlah views, likes, subscriber, pertumbuhan harian, sampai perkiraan tanggal tembus milestone. Dibuka pertama kali, pengunjung disambut **halaman pembuka (landing page)** bergaya situs K-pop generik, lalu masuk ke **Beranda** berisi papan peringkat lagu paling banyak ditonton, video yang sedang tren, rilisan terbaru, dan ringkasan channel — sebelum menjelajah halaman tiap artis.

**Tidak perlu server, tidak perlu VPS.** Semuanya berjalan gratis di GitHub: Actions merekam data, Pages menayangkannya.

## Fitur

- **Halaman pembuka (landing) generik** bertema K-pop — tidak menampilkan artis mana pun sebelum tombol "Masuk Sekarang" ditekan
- **Beranda portal** (tampilan pertama setelah masuk): papan peringkat **Top 10 lagu paling banyak ditonton** lintas artis, **Sedang tren minggu ini** (pertumbuhan 7 hari tertinggi), **Rilisan terbaru**, ringkasan total views/subscriber gabungan, dan kartu jelajah artis
- **Dua artis** dalam satu situs (tab Beranda / BABYMONSTER / TREASURE) — mudah ditambah artis lain
- **Kartu channel bisa diklik** → modal detail channel: subscriber, total ditonton, jumlah video, rata-rata sub/hari
- **Grafik pertumbuhan channel SEJAK CHANNEL DIBUAT** (BM 28 Des 2022, TREASURE 8 Feb 2019) — interaktif: hover tooltip, tombol rentang (60 hari / 1 tahun / sejak dibuat), zoom scroll & geser (tarik), metrik subscriber/total views
- **81 video terpantau**: MV resmi + Dance Practice penuh + **video performa lagu sendiri** (Dance Performance / Performance Video / Exclusive & Special Performance Video) — tanpa video solo member, focus cut, cover lagu orang lain, stage practice, live/concert, versi JP/RAW, highlight, teaser, behind, dll.
- **Grafik per video SEJAK TANGGAL RILIS ASLI**: views kumulatif + views ditambahkan per hari (60 hari / 1 tahun / sejak rilis)
- **Likes ditampilkan** sesuai YouTube (dari API; muncul begitu pengukuran pertama berhasil)
- **Pembeda data nyata vs estimasi**: legenda + garis putus-putus/batang transparan = estimasi, titik solid = pengukuran nyata, plus catatan penjelas
- **Milestone & prediksi**: perkiraan tanggal tembus 500 jt, 1 M dsb. (berdasarkan rata-rata 7 hari)
- **Mode gelap/terang** dengan tombol toggle
- Seluruh antarmuka berbahasa Indonesia
- **Deteksi rilis baru otomatis**: MV/dance practice/performance video baru yang diunggah ke channel langsung masuk daftar; video solo member & konten non-performa otomatis diabaikan

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
| `data/videos.json` | Riwayat views & likes per video (harian sejak rilis) |
| `data/channels.json` | Riwayat subscriber & total views per channel |
| `data/backfill/` | Penanda video yang sudah dibackfill dari arsip |
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

- `category` pilihan: `mv`, `dance_practice`, `dance_performance`
- `published` (opsional): tanggal rilis `YYYY-MM-DD` — dipakai untuk estimasi awal, dikoreksi otomatis oleh API
- `channel_id` ada di URL channel YouTube (bagian setelah `/channel/`)
- Video **MV / dance practice / performance video baru** yang diunggah ke channel sudah otomatis terdeteksi; menambah lewat `config.json` hanya perlu kalau ingin memantau video lama/khusus.
- Yang otomatis diabaikan: teaser, highlight, focus cut, **video solo member** (mis. judul "... of TREASURE", solo dance practice/performance), cover lagu orang lain, stage practice, live/concert performance, versi JP/RAW, behind/making, clip promosi, dsb.
- Yang **dipantau** (kategori `dance_performance`): *Dance Performance Video*, *Performance Video*, *Exclusive Performance Video*, dan *Special Performance Video* untuk lagu grup sendiri.

## Mengganti jadwal

Edit `.github/workflows/collect.yml` bagian `cron` (zona UTC):

- 1× sehari → hapus salah satu baris cron (sisakan `0 0 * * *` = 07:00 WIB)
- 4× sehari → tambah `0 6 * * *` dan `0 18 * * *`

## Memperbarui repo yang sudah terpasang (versi lama → versi ini)

1. Unduh ZIP terbaru, lalu **ganti semua file** di repo (termasuk seluruh isi `data/`). Cara termudah: hapus file lama di repo, unggah semua file baru.
2. Jalankan sekali *Actions → Kumpulkan data YouTube → Run workflow*.
3. Selesai — grafik langsung penuh sejak tanggal rilis; angka presisi dari API menimpa estimasi mulai putaran pertama.

> Kalau kamu hanya mengganti `collect.js`/`config.json`/`index.html` dan membiarkan `data/` lama: tidak apa-apa. `collect.js` versi ini melakukan **migrasi otomatis** (schema v3) — titik estimasi lama dibangun ulang dengan model terbaru, titik data lama yang tidak valid dibuang, hanya titik terukur yang rapat/21 hari terakhir yang dipertahankan, lalu estimasi dibangun ulang dari tanggal rilis yang benar. Video yang tidak lagi dipantau otomatis hilang dari grafik.

## Tanggal rilis & tanggal channel dibuat

- `config.json` sekarang menyimpan **tanggal rilis asli** tiap MV (contoh: SHEESH 1 Apr 2024, FOREVER 1 Jul 2024, BATTER UP 27 Nov 2023, KING KONG 28 Mei 2024, dsb.).
- Saat `collect.js` berjalan dengan API key, **tanggal rilis dikoreksi otomatis** dari YouTube API (`snippet.publishedAt`) — termasuk untuk video yang masih memakai tanggal perkiraan.
- Tanggal dibuatnya channel diambil dari API (`snippet.publishedAt` channel) dan dipakai sebagai titik awal grafik subscriber/total views di modal channel.

## Tentang data historis (backfill)

YouTube **tidak menyediakan** riwayat views harian lewat API — hanya angka saat ini. Supaya grafik tetap terisi dari tanggal rilis:

1. **Titik pengukuran nyata** (solid) — direkam 2× sehari oleh Actions selama situs berjalan.
2. **Titik estimasi** (putus-putus/transparan, diberi tanda "(est.)") — dihitung dari tanggal rilis + views terkini memakai model pertumbuhan MV (spike awal → mereda → ekor panjang).
3. **Jangkar arsip** — setiap putaran Actions, `collect.js` mencoba mengambil ±6 snapshot lama tiap video dari **Wayback Machine** (web.archive.org) sebagai titik nyata tambahan, maksimal 25 video per putaran (bertahap, dicache di `data/backfill/`). Video yang sudah punya cukup data nyata dilewati otomatis.

Hal yang sama berlaku untuk **grafik channel**: estimasi harian sejak channel dibuat, ditandai est., dan ditimpa pengukuran nyata.

Setiap kali Actions merekam angka baru, estimasi pada hari itu **ditimpa data nyata** — makin lama situs berjalan, makin banyak titik solid dan prediksi makin akurat.

## Pertanyaan umum

**Apakah API key saya aman?** Ya — key disimpan sebagai *repository secret*, tidak ikut ter-commit, dan hanya dipakai di Actions. Situs publik tidak pernah menyentuh key karena data sudah dikumpulkan ke `data/*.json`.

**Grafik sekarang langsung penuh.** Sejak versi ini riwayat diisi dari tanggal rilis (video) dan tanggal channel dibuat (channel) memakai estimasi (lihat "Tentang data historis"). Tanda **(est.)** pada kartu/tooltip berarti angka itu masih berbasis estimasi.

**Kenapa likes kadang masih "–"?** Likes diambil dari `statistics.likeCount` (YouTube Data API — secret `YT_API_KEY`) atau dari endpoint publik YouTube saat mode scraping. Likes tampil otomatis pada putaran pertama setelah versi ini dipasang — kartu, modal, dan rasio likes/1.000 views langsung terisi untuk BM maupun TREASURE.

**Kenapa ada angka estimasi? Bisa lihat yang real?** YouTube **tidak menyediakan** riwayat views harian untuk publik (hanya pemilik channel bisa melihatnya di YouTube Studio), jadi rincian per-hari masa lalu memang diestimasi — ditandai batang transparan/garis putus-putus + legenda "Estimasi". Yang **selalu nyata**: total views, likes, subscriber saat ini, dan semua titik solid (pengukuran langsung dari YouTube API 2× sehari sejak situs berjalan). Makin lama situs dipasang, makin panjang bagian nyatanya.

---
Dibuat dengan GitHub Actions + GitHub Pages
