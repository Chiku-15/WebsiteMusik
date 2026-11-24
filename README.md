# K-POP PULSE (versi GitHub) — Statistik YouTube & Spotify Artis K-pop

Situs statistik **YouTube + Spotify** untuk artis K-pop — saat ini berisi **BABYMONSTER** dan **TREASURE** — direkam otomatis **tiap jam** oleh GitHub Actions, lalu ditampilkan sebagai situs grafik: jumlah views, likes, subscriber, stream Spotify, pertumbuhan harian, sampai perkiraan tanggal tembus milestone. Ada **dua tombol platform di header — YouTube dan Spotify** — cukup tekan untuk berganti (model seperti bm-tracker.com). Dibuka pertama kali, pengunjung disambut **halaman pembuka (landing page)** bergaya situs K-pop generik, lalu masuk ke **Beranda** berisi papan peringkat lagu paling banyak ditonton/di-stream, video/lagu yang sedang naik, rilisan terbaru, dan ringkasan channel — sebelum menjelajah halaman tiap artis.

**Tidak perlu server, tidak perlu VPS.** Semuanya berjalan gratis di GitHub: Actions merekam data, Pages menayangkannya.

## Fitur

- **Halaman pembuka (landing) generik** bertema K-pop — tidak menampilkan artis mana pun sebelum tombol "Masuk Sekarang" ditekan
- **Beranda portal padat (2 kolom)** (tampilan pertama setelah masuk): kiri = papan peringkat **Top 10 lagu paling banyak ditonton** lintas artis (**views digabung dari semua versi lagu**) + kartu jelajah artis; kanan = **Sedang tren minggu ini** (pertumbuhan 7 hari tertinggi); bawah = **Rilisan terbaru** — semuanya muat tanpa scroll panjang
- **Halaman Milestone per artis** (tab "Milestone" di halaman BABYMONSTER / TREASURE, datanya terpisah per artis):
  - **Tabel** — hari sejak rilis tiap video sampai menembus 10 jt / 20 jt / 50 jt / 100 jt / 150 jt / 200 jt / 300 jt / 400 jt / 500 jt views; tercepat per kolom ditandai ★; klik baris = buka detail video
  - **Data resmi YG Entertainment / media** — milestone yang pernah diumumkan resmi (mis. SHEESH 100 jt di hari ke-11, BATTER UP 100 jt di hari ke-18, BOY 100 jt di hari ke-488, IF I 100 jt di hari ke-12) ditandai **✓ hijau** dengan tooltip sumber & tanggal pastinya; sel tanpa ✓ = hasil kurva pemantauan (est.)
  - **Akan datang** — milestone berikutnya tiap video + perkiraan tanggal
  - **Tercapai** — daftar semua milestone yang sudah ditembus, urut tanggal
- **`data/milestones.json`** — kurasi manual milestone resmi (pengumuman YG Entertainment via ygfamily.com / yg-life.com, Yonhap, Korea Herald, Chosun, OSEN, allkpop). Dipakai dua arah: situs menampilkannya sebagai data otoritatif, dan `collect.js` menyisipkannya sebagai **jangkar data nyata** sehingga kurva sebelum pemantauan mengikuti pencapaian resmi (bukan sekadar model)
- **Dua artis** dalam satu situs (tab Beranda / BABYMONSTER / TREASURE) — mudah ditambah artis lain
- **Kartu channel bisa diklik** → modal detail channel: subscriber, total ditonton, jumlah video, rata-rata sub/hari
- **Grafik pertumbuhan channel SEJAK CHANNEL DIBUAT** (BM 28 Des 2022, TREASURE 8 Feb 2019) — interaktif: hover tooltip, tombol rentang (7 hari / 60 hari / 1 tahun / sejak dibuat), zoom scroll & geser (tarik), metrik subscriber/total views
- **81 video terpantau**: MV resmi + Dance Practice penuh + **video performa lagu sendiri** (Dance Performance / Performance Video / Exclusive & Special Performance Video) — tanpa video solo member, focus cut, cover lagu orang lain, stage practice, live/concert, versi JP/RAW, highlight, teaser, behind, dll.
- **Grafik per video SEJAK TANGGAL RILIS ASLI**: views kumulatif + kurva likes (2 poros, muncul otomatis setelah perekaman likes berjalan) + views ditambahkan per hari/pekan/bulan (7 hari / 60 hari / 1 tahun / sejak rilis). **Antar jangkar data nyata (milestone resmi / arsip Wayback / pengukuran) kurva diisi penuh lewat interpolasi PCHIP** — tidak ada bulan kosong dan tidak ada delta antar jangkar yang terjatuh ke satu bulan titik terakhir
- **Modal lagu ala bm-tracker**: views + delta, rata-rata/hari, likes + rasio per 1.000 views, **chip milestone tercapai beserta tanggalnya (✓ = resmi YG/media, lengkap "hari ke-N")**, tabel prediksi milestone berikutnya, dan **Semua versi lagu ini** (MV / Performance / Practice / Remix dari lagu yang sama, bisa diklik)
- **Mode gabungan versi lagu**: satu tombol **“Gabungan semua versi”** menjumlahkan views/likes seluruh versi lagu yang sama (judul sama walau beda versi — mis. DARARI ori + DARARI Remix) per hari kalender, lengkap dengan grafik gabungan & statistik gabungan
- **Modal channel ala bm-tracker**: rentang 7 hari / 60 hari / 1 tahun / sejak dibuat, Views/hari, dan **tabel Milestone total views** (tanggal dicapai + jarak antar milestone + baris milestone berikutnya)
- **Likes & komentar ditampilkan** sesuai YouTube (dari API; muncul begitu pengukuran pertama berhasil). **Jumlah komentar video juga direkam tiap jam** dan tampil di modal lagu, bersama rasio like per 1.000 views; rekap “likes terbanyak” di halaman Rekor menampilkan komentar & rasio juga
- **Pembeda data nyata vs estimasi**: legenda + garis putus-putus/batang transparan = estimasi, titik solid = pengukuran nyata, plus catatan penjelas
- **Milestone & prediksi**: perkiraan tanggal tembus 500 jt, 1 M dsb. (berdasarkan rata-rata 7 hari)
- **Mode gelap/terang** dengan tombol toggle
- Seluruh antarmuka berbahasa Indonesia
- **Deteksi rilis baru otomatis**: MV/dance practice/performance video baru yang diunggah ke channel langsung masuk daftar; video solo member & konten non-performa otomatis diabaikan
- **Halaman Media Sosial** — follower Instagram, X (Twitter), TikTok & Weverse kedua grup (+ subscriber YouTube & followers Spotify), delta 7/30 hari, grafik mini, badge sumber (persis/aprox/mirror/manual). Angka bisa diisi manual lewat `data/social-override.json`. Kolektor `collect_social.js` mencoba 3 cara per platform (endpoint resmi → meta halaman → mirror) dan menyimpan angka terakhir walau sumber sesekali gagal
- **Halaman Peringkat Chart** — posisi lagu di **Billboard Global 200 & Global Excl. US** (mingguan), **Spotify Global Top 200** (harian, via kworb.net), **Melon Top 100**, **Genie Top 200** & **Bugs Top 100** (harian): status saat ini, rekor terbaik, dan grafik histori posisi (poros dibalik — makin tinggi makin bagus). Titik hanya direkam saat artis masuk chart; Melon kerap menolak IP datacenter (Genie/Bugs jadi pembanding, Spotify Global via kworb paling stabil)
- **Halaman Diskografi** — semua album/EP/singel resmi kedua grup dengan cover, tipe, tanggal rilis, jumlah lagu & total stream per album — klik album membuka halaman album lengkap dengan daftar lagu + grafik per lagu. Judul album live/tur yang panjang dirapikan otomatis: nama pendek + baris khusus info venue/tanggal (mis. "1st WORLD TOUR <HELLO MONSTERS> IN JAPAN" + "13 Apr 2025 · K-ARENA YOKOHAMA")
- **Halaman Berita K-pop** — berita terbaru yang menyebut BABYMONSTER/TREASURE dari RSS **Soompi, Koreaboo & tag Kbizoom per artis**, dengan filter chip per grup, **thumbnail foto artikel** (dari feed/og:image; CDN anti-hotlink ditangani dengan `referrerpolicy=no-referrer`, fallback inisial sumber) dan tanggal publikasi yang jelas di tiap kartu
- **Halaman Timeline Grup** — garis waktu perjalanan kedua grup dari pra-debut sampai sekarang: reveal anggota, debut, tiap EP/album/singel, tur dunia & peristiwa penting, lengkap badge tipe (Debut/Album/Singel/Tur/Acara), pill nama grup dan filter chip per grup. **Posisi kartu mengikuti grup**: pada filter "Kedua grup" kartu TREASURE selalu di KIRI garis & BABYMONSTER selalu di KANAN (ada legenda); filter satu grup bergantian kiri-kanan. Tanggal dikurasi manual dari Wikipedia resmi tiap grup — rilisan baru tinggal ditambahkan ke konstanta `TIMELINE` di index.html
- **Halaman Peta Panas Harian** — heatmap: **satu peta = tepat satu tahun kalender** dengan **tab tahun dari tahun debut grup** (TREASURE 2020, BABYMONSTER 2023). **Tata letak per bulan yang mudah dibaca**: setiap baris = satu bulan (Januari di atas → Desember di bawah), kolom = tanggal 1–31 dengan ruler angka — tanggal 1 selalu di kolom paling kiri dan kolom setelah tanggal terakhir bulan itu dibiarkan kosong; hover menyorot baris/label bulan + tooltip nama bulan & tanggal lengkap; ringkasan total tahun + hari tersibuk, batang pertumbuhan Jan–Des, dan filter artis gabungan/per grup
- **Seksi “Lonjakan tak biasa” di beranda** — log persisten video yang tambahan views/harinya ≥ 2,5× median 30 hari sebelumnya (indikasi viral, mis. TikTok); barisnya bisa diklik untuk membuka grafik video
- **Perbaikan navigasi**: membuka halaman khusus lain dari halaman khusus yang sedang terbuka kini langsung berganti (sebelumnya harus klik “Kembali” dulu), dan tombol **“Kembali”** di semua halaman khusus kini pasti berfungsi (sebelumnya 5 halaman baru punya tombol yang tidak terikat event)

### Bagian Spotify (tombol “Spotify” di header)

- **Toggle YouTube ⇄ Spotify** di header lengkap dengan hitungan item yang dipantau — model seperti bm-tracker (YouTube (81) | Spotify (167)); pilihan artis & tema ikut terbawa saat berganti
- **Beranda Spotify**: total stream gabungan, stream 24 jam, papan peringkat **lagu paling banyak di-stream** (semua versi digabung: remix/ver. JP dihitung satu entri, versi live dipisah tanda Live), berita **milestone** (tercapai 30 hari terakhir + target terdekat beserta perkiraan tanggalnya), **pertumbuhan harian tertinggi**, dan kartu artis
- **Halaman artis Spotify**: total stream, stream/hari, **pendengar per bulan** + delta mingguan, followers (opsional), daftar **album/EP/singel lengkap dengan tipe (Single/EP/Album/Live), tanggal rilis, total stream & delta harian** — klik album untuk membuka daftar lagu dengan bar progres menuju milestone berikutnya, plus **kotak pencarian lagu**. Tab **Milestone** berisi **tabel milestone ala tabel YouTube**: baris = lagu, kolom = 1 jt s/d 1 mlr stream, sel = **hari ke-N sejak rilis** (✓ hijau = tercapai, pudar = dari kurva estimasi, ★ = tercepat di kolom) + sub-tab **Akan datang** dan **Tercapai**
- **Modal lagu Spotify**: total stream (gabungan semua versi/ID), delta 24 jam, rata-rata 7 hari, grafik kumulatif sejak rilis (terukur vs estimasi) **dengan kotak “TOTAL STREAM + delta /24 jam” menempel di kanan-atas grafik**, chip milestone tercapai, tabel prediksi milestone berikutnya
- **Stream harian lagu baru tetap terisi**: kworb kadang mengosongkan kolom harian (lagu baru di luar chart harian, mis. SHOCK) — angka harian otomatis diturunkan dari dua titik perekaman terakhir sehingga tidak ada lagi “+0/hari”
- **Sumber data Spotify tanpa API key**: angka stream harian dari **Spotify Charts (via kworb.net)**, metadata album/track & tanggal rilis dari halaman **embed resmi Spotify** (di-cache). Pendengar per bulan dari daftar global kworb (artis yang masuk daftar). *Opsional*: isi Secret `SPOTIFY_CLIENT_ID` + `SPOTIFY_CLIENT_SECRET` (Spotify Web API) untuk ikut merekam **followers** — tanpa secret, kolektor mencoba token anonim lalu fallback publik **stats.fm**

## Cara kerja singkat

```
GitHub Actions (tiap jam, lewat menit ke-13 — menit :00 padat, run sering ditunda)
  │ node collect.js        → YouTube Data API v3 (Secret YOUTUBE_API_KEY)
  │                          + views panggung SEMUA edisi MAMA (data/mama.json + data/mama-2020…2025.json,
  │                            dipindai otomatis, tiap putaran)
  │ node collect_spotify.js → Spotify Charts via kworb.net + embed Spotify (tanpa API key;
  │                           opsional Spotify Web API utk followers)
  │ node collect_social.js  → sosmed (IG/X/TikTok), Billboard/Melon/Genie/Bugs/Spotify Global (kworb),
  │                           RSS berita, log anomali views (semua tanpa API key, best-effort)
  ▼
data/*.json + data/spotify-*.json (riwayat angka, di-commit oleh github-actions[bot])
  ▼
GitHub Pages menayangkan index.html — tombol YouTube/Spotify di header berganti tampilan
```

## Struktur file

| File | Fungsi |
| --- | --- |
| `index.html` | Situs (satu file, tanpa build) — YouTube & Spotify |
| `config.json` | Daftar artis, channel, video YouTube, dan album Spotify yang dipantau |
| `collect.js` | Skrip pengambil data YouTube + pembaruan otomatis views panggung SEMUA edisi MAMA 2026 & 2020-2025 — dipindai otomatis dari folder data/ (Node.js, tanpa dependensi) |
| `collect_spotify.js` | Skrip pengambil data Spotify (kworb + embed; tanpa dependensi) |
| `collect_social.js` | Skrip pengambil data sosial media, chart, berita & anomali (tanpa dependensi, best-effort) |
| `data/videos.json` | Riwayat views & likes per video YouTube (harian sejak rilis) |
| `data/channels.json` | Riwayat subscriber & total views per channel |
| `data/spotify-tracks.json` | Riwayat stream per lagu Spotify (semua versi digabung) |
| `data/spotify-albums.json` | Metadata album/EP/singel + daftar lagunya |
| `data/spotify-artists.json` | Total stream harian, pendengar/bln, followers, riwayat artis |
| `data/spotify-meta.json` | Info pembaruan terakhir bagian Spotify |
| `data/backfill/` | Penanda video yang sudah dibackfill dari arsip |
| `data/meta.json` | Info pembaruan terakhir bagian YouTube |
| `data/social.json` | Riwayat follower Instagram/X/TikTok per grup (+ kartu Weverse) |
| `data/charts.json` | Riwayat posisi live: Billboard Global 200 & Global Excl. US, Spotify Global Top 200 (kworb), Melon, Genie & Bugs Top 100 |
| `data/chart-history.json` | Riwayat & rekor pencapaian chart dari debut (kurasi manual — puncak/debut/entri terverifikasi) |
| `data/trofi.json` | Trofi acara musik, penghargaan besar, Inkigayo Hot Stage & nominasi (kurasi manual; reviu penuh 16 Nov 2026 vs Wikipedia: BABYMONSTER = 2 trofi acara musik + 12 penghargaan besar, TREASURE = 4 trofi acara musik + 43 penghargaan besar + 1 daesang KGMA 2026) |
| `data/jadwal.json` | Jadwal tur/event manual untuk halaman Jadwal & Countdown |
| `data/mama.json` | Panggung MAMA 2026 untuk halaman **Awards** (26 artis · 71 video). **Views per video diperbarui otomatis** oleh kolektor (`collect.js` → `updateMamaViews`, YouTube Data API, tiap jam); nama panggung, urutan naik panggung & daftar video tetap dikurasi manual — edit file untuk menambah/mengubah panggungan |
| `data/mama-2025.json` | Panggung MAMA 2025 (Kai Tak Stadium, Hong Kong · 28–29 Nov 2025) untuk **dropdown MAMA 2025** di halaman Awards (29 artis + 4 artis tamu · 71 video). Struktur identik dengan `data/mama.json` — views juga diperbarui otomatis tiap jam oleh `collect.js`; ringkasan awal dirangkum dari mama-2025.mirekapps.com |
| `data/mama-2020.json` … `data/mama-2024.json` | Panggung MAMA edisi lampau untuk **dropdown Edisi di halaman Awards** (dipilih lewat dropdown “EDISI”): MAMA 2020 (CJ ENM Contents World, Paju — daring pandemi · 6 Des 2020 · 28 artis · 29 video), MAMA 2021 (CJ ENM Contents World, Paju · 11 Des 2021 · 20 artis · 20 video), MAMA 2022 (Kyocera Dome Osaka · 29–30 Nov 2022 · 31 artis · 31 video, 2 hari), MAMA 2023 (Tokyo Dome · 28–29 Nov 2023 · 24 artis · 26 video, 2 hari), MAMA 2024 (Dolby Theatre LA + Kyocera Dome Osaka · 21–23 Nov 2024 · 29 artis · 33 video, 3 hari). **Panggung kolaborasi tiap edisi terhubung seperti 2025/2026** (garis warna, legenda & blok kolaborasi): Triangular Fight & unit BoA 2020, BlooM The Sound 2021, LINNK & Freakout-secara-segmen 2022, I Am Special (anggota TREASURE) & Endless Rain × YOSHIKI 2023, opening TWS·ILLIT·RIIZE & reuni BIGBANG × G-DRAGON 2024. Struktur identik dengan `data/mama.json` — views tiap video juga diperbarui otomatis tiap jam oleh `collect.js` (pemindaian `mama-*.json`); urutan naik panggung dirujuk ke daftar performer Wikipedia tiap edisi, video & views dari unggahan resmi kanal Mnet (panggung tanpa unggahan resmi Mnet — mis. Street Man Fighter × Kang Daniel 2022, hanya ada video BEHIND — sengaja tidak dimasukkan) |
| `data/members.json` | Profil 17 anggota (klik kartu = detail profil + **foto solo artis**) |
| `img/members/` | Foto solo 17 anggota (dipakai di kartu profil & halaman detail; ganti file `<slug>.jpg` untuk mengganti foto) |
| `data/news.json` | Berita terbaru yang menyebut artis (RSS, maks. 60 entri, tiap entri berisi thumbnail `img`) |
| `data/anomalies.json` | Log lonjakan views tak biasa (≥ 2,5× median harian) |
| `data/social-override.json` | *(Opsional, buat sendiri)* angka follower manual bila scraper macet |
| `.github/workflows/collect.yml` | Jadwal pengambilan data (tiap jam, YouTube + Spotify dalam satu run) |

## Cara pasang di GitHub (dari nol)

> Kamu butuh **YouTube API Key** (gratis). Kalau belum punya, lihat bagian di bawah.

1. **Buat repo baru** di GitHub, mis. `pemantau-youtube`. Public.
2. **Unggah semua file** proyek ini ke repo (tombol *Add file → Upload files*), atau lewat `git push`.
3. **Simpan API key** sebagai Secret:
 - Buka *Settings → Secrets and variables → Actions → New repository secret*
 - Name: `YOUTUBE_API_KEY` — Secret: isi API key-mu → *Add secret*
 - (Direkomendasikan untuk **followers Spotify**) tambah `SPOTIFY_CLIENT_ID` & `SPOTIFY_CLIENT_SECRET` dari [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) (buat app apa pun, dapatkan *Client ID* & *Client secret*). Tanpa ini collector mencoba token anonim Spotify lalu fallback publik **stats.fm** (pencocokan via Spotify ID); nilai followers terakhir tetap dipertahankan bila keduanya gagal — semua fitur lain tetap jalan penuh.
4. **Aktifkan GitHub Pages**:
 - *Settings → Pages → Build and deployment → Source: **Deploy from a branch***
 - Branch: `main`, folder: `/(root)` → *Save*
5. **Jalankan data pertama**:
 - Buka tab *Actions → Kumpulkan data (YouTube + Spotify) → Run workflow → Run workflow*
 - Tunggu ±2–5 menit sampai selesai; file di `data/` akan terisi (termasuk `data/spotify-*.json`).
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

## Data sosial media, chart, berita & anomali (collect_social.js)

Langkah ketiga di workflow. Semua sumbernya publik & tanpa API key, dijalankan best-effort — kalau satu sumber gagal, sumber lain tetap jalan dan angka terakhir yang terekam tetap dipakai situs.

- **Rate-limit internal** (supaya tidak diblokir sumber): sosial 6 jam, Billboard 12 jam, chart Korea 6 jam, berita 1 jam — bisa diubah lewat env `SOCIAL_H`, `BILLBOARD_H`, `KOREA_H`, `NEWS_H` di workflow
- **Instagram**: coba endpoint `web_profile_info` (angka persis) → meta `og:description` halaman profil (angka dibulatkan, badge “aprox”). Dua-duanya sering menolak IP datacenter GitHub — kalau selalu gagal, isi angka manual (lihat bawah)
- **X (Twitter)**: via mirror Nitter (xcancel/lightbrd/nitter.net) → `r.jina.ai` (aprox). Ketersediaan mirror berubah-ubah
- **TikTok**: baca JSON `followerCount` dari halaman profil
- **Weverse**: jumlah follower **tidak dipublikasikan lewat web publik** — kartunya berisi tautan saja
- **Billboard Global 200**: dibaca dari baris chart di billboard.com (mingguan). **Melon**: sering menolak IP datacenter — bila gagal, kartu chart menampilkan pesan dan Genie jadi pembanding. **Spotify Global Top 200**: dari kworb.net (`country/global_daily.html`) — tabel 200 baris, artis & judul diambil dari link artist/track sehingga tidak salah potong; jumlah stream/hari ikut disimpan di titik riwayat. **Bugs/Genie**: 3 percobaan per putaran + header Referer
- **Berita**: RSS Soompi + Koreaboo (difilter kata BABYMONSTER/TREASURE) + tag Kbizoom per artis
- **Anomali**: video yang tambahan views/harinya ≥ 2,5× median harian 30 titik sebelumnya dicatat ke `data/anomalies.json` (satu entri per video per hari, maks. 300)

**Mengisi angka follower manual** — buat file `data/social-override.json` (akan ikut ter-commit otomatis):

```json
{
  "babymonster": { "instagram": 10500000, "twitter": null, "tiktok": null },
  "treasure":    { "instagram": 7100000,  "twitter": null, "tiktok": null }
}
```

Angka manual (badge “manual”) selalu menimpa angka scraper pada hari yang sama — dan tetap tampil di halaman Media Sosial meski sumber online sedang macet.

## Notifikasi Telegram (opsional, disarankan)

Supaya situs makin "hidup sendiri": collector mengirim pesan Telegram tiap ada video baru
terdeteksi (yang langsung masuk pantauan, maupun yang butuh review) dan alert saat koleksi
gagal — web tidak mati diam-diam. Cara aktifkan:

1. Chat [@BotFather](https://t.me/BotFather) di Telegram → `/newbot` → salin token yang diberikan.
2. Kirim satu pesan apa pun ke bot kamu, lalu buka `https://api.telegram.org/bot<TOKEN>/getUpdates` → salin `chat.id`.
3. Simpan 2 Secret di repo (*Settings → Secrets and variables → Actions*):
   - `TELEGRAM_BOT_TOKEN` — token dari BotFather
   - `TELEGRAM_CHAT_ID` — id chat tujuan
4. Selesai — tidak perlu konfigurasi lain. Tanpa 2 secret ini collector tetap jalan normal
   (deteksi video baru tetap berfungsi, hanya tidak ada pesan Telegram).

Cara kerja deteksi: playlist uploads (via API, ±200 unggahan terakhir) **dan** RSS channel
YouTube (±15 unggahan terakhir, tanpa kuota API) dipindai setiap putaran. Judul yang dikenali
(MV / dance practice / performance video) otomatis masuk pantauan pada putaran yang sama;
sisanya hanya dilaporkan. Daftar id yang sudah dilaporkan disimpan di `data/notified.json`
agar tidak ada pesan ganda, dan putaran pertama hanya sinkronisasi (tidak spam).

## Memperbarui repo yang sudah terpasang (versi lama → versi ini)

1. Unduh ZIP terbaru, lalu **ganti semua file** di repo (termasuk seluruh isi `data/` **dan folder baru `img/members/`** — foto solo 17 anggota). Cara termudah: hapus file lama di repo, unggah semua file baru. File baru di versi ini: `collect_social.js` (sosmed/chart/berita/anomali), `data/social.json`, `data/charts.json`, `data/news.json`, `data/anomalies.json`, `data/spotify-*.json`, `img/members/*.jpg`, dan `config.json` yang menambah field Spotify + handle sosmed per artis.
2. Jalankan sekali *Actions → Kumpulkan data (YouTube + Spotify) → Run workflow*.
3. Selesai — tombol **Spotify** di header langsung berisi data (167 lagu, 23 album BM & TREASURE per 7 Nov 2026), grafik YouTube pun langsung penuh sejak tanggal rilis.

> Kalau kamu hanya mengganti `collect.js`/`config.json`/`index.html` dan membiarkan `data/` lama: tidak apa-apa. `collect.js` versi ini melakukan **migrasi otomatis** (schema v3) — titik estimasi lama dibangun ulang dengan model terbaru, titik data lama yang tidak valid dibuang, hanya titik terukur yang rapat/21 hari terakhir yang dipertahankan, lalu estimasi dibangun ulang dari tanggal rilis yang benar. Video yang tidak lagi dipantau otomatis hilang dari grafik.

## Tanggal rilis & tanggal channel dibuat

- `config.json` sekarang menyimpan **tanggal rilis asli** tiap MV (contoh: SHEESH 1 Apr 2024, FOREVER 1 Jul 2024, BATTER UP 27 Nov 2023, KING KONG 28 Mei 2024, dsb.).
- Saat `collect.js` berjalan dengan API key, **tanggal rilis dikoreksi otomatis** dari YouTube API (`snippet.publishedAt`) — termasuk untuk video yang masih memakai tanggal perkiraan.
- Tanggal dibuatnya channel diambil dari API (`snippet.publishedAt` channel) dan dipakai sebagai titik awal grafik subscriber/total views di modal channel.

## Tentang data historis (backfill)

YouTube **tidak menyediakan** riwayat views harian lewat API — hanya angka saat ini. Supaya grafik tetap terisi dari tanggal rilis:

1. **Titik pengukuran nyata** (solid) — direkam tiap jam oleh Actions selama situs berjalan.
2. **Jangkar arsip** — setiap putaran Actions, `collect.js` mencoba mengambil ±6 snapshot lama tiap video dari **Wayback Machine** (web.archive.org) sebagai titik nyata tambahan (views **+ likes**), maksimal 25 video per putaran (bertahap, dicache per versi logika di `data/backfill/v3-*.json`). Video di-backfill bila: titik nyata < 3, **ada celah > 30 hari** antar titik, titik pertama masih > 30 hari setelah rilis, atau **likes belum terekam sejak dekat tanggal rilis** — jadi MV lama ber-celah panjang (mis. DRIP) tidak lagi terlewat. **Versi 3 tambah jendela harian**: bila dalam 45 hari terakhir ada celah rekam > 36 jam (mis. Actions sempat berhenti sepekan), kolektor mengambil maks. 12 snapshot HARIAN di jendela itu — grafik “views per hari” tidak lagi tampil datar palsu di segmen celah. Mode **“wayback-mass”** mengambil ±40 snapshot per video untuk semua video sekaligus.
3. **Interpolasi antar titik** (putus-putus, legenda “Interpolasi”, tooltip “(interpolasi)”) — hari/pekan/bulan tanpa perekaman diisi dari kurva PCHIP monoton yang melewati SEMUA titik nyata, dihitung di frontend. **Tidak ada model estimasi** — jumlah seluruh nilai bucket selalu persis = total kenaikan views. Bucket terakhir (hari/pekan berjalan) diskalakan ke nilai setara periode penuh supaya ujung grafik tidak tampak “anjlok” palsu.

**Grafik channel kini 100% data nyata — tanpa estimasi model.** Titik-titiknya dikumpulkan dari berbagai sumber: **YouTube Data API** (direkam GitHub Actions tiap jam), **Social Blade** (rekaman harian), **Wikipedia** + arsip media, dan **pengumuman resmi YG Entertainment** (tanggal milestone subscriber/total views, mis. 10 jt subscriber 9 Sep 2025, 10 miliar views 3 Sep 2026). Titik estimasi model lama dibuang otomatis setiap putaran Actions. Karena riwayat harian publik tidak tersedia, antar titik sumber dihubungkan garis lurus; tanggal milestone yang berada DI ANTARA dua titik data nyata ditandai **(±)** = perkiraan garis lurus, bukan tanggal resmi. Section **Milestone video** kini tampil di bagian paling bawah detail channel (buka lewat klik kartu channel di halaman artis).

Setiap kali Actions merekam angka baru, estimasi pada hari itu **ditimpa data nyata** — makin lama situs berjalan, makin banyak titik solid dan prediksi makin akurat.

## Pertanyaan umum

**Apakah API key saya aman?** Ya — key disimpan sebagai *repository secret*, tidak ikut ter-commit, dan hanya dipakai di Actions. Situs publik tidak pernah menyentuh key karena data sudah dikumpulkan ke `data/*.json`.

**Dari mana angka Spotify berasal? Apa akurat?** Angka stream per lagu diproses dari **data harian publik Spotify Charts** (via kworb.net — situs rujukan para pelacak streaming), metadata album/track & tanggal rilis dari **halaman embed resmi Spotify**. Total stream gabungan di situs ini sama persis dengan angka yang terlihat di aplikasi Spotify (contoh: SUGAR HONEY ICE TEA 49.025.510 per 7 Nov 2026). Pendengar per bulan: dari daftar global kworb (lengkap + delta harian) — kalau artis di luar 2.500 besar global (contoh: TREASURE), angka diambil dari halaman resmi artis Spotify (ditandai "±", dibulatkan). Riwayat sebelum situs berjalan diisi estimasi model (ditandai), sama seperti sisi YouTube.

**Grafik video kini 100% data nyata + interpolasi — tanpa model estimasi.** Titik nyata dari YouTube API, arsip Wayback (views & likes), dan pengumuman resmi; grafik kumulatif memakai **poros waktu linier** (jarak antar titik proporsional tanggal — celah perekaman terlihat jujur, bukan melompat), dan mulai dari **0 views di tanggal rilis**. **Grafik channel juga hanya data nyata** dari YouTube API, Social Blade, dan pengumuman resmi YG/media. Tanggal milestone yang berada DI ANTARA dua titik data nyata ditandai **(±)** = perkiraan garis lurus, bukan tanggal resmi. Section **Milestone video** tampil di bagian paling bawah detail channel (buka lewat klik kartu channel di halaman artis).

**Kenapa likes kadang masih "–"?** Likes diambil dari `statistics.likeCount` (YouTube Data API — secret `YOUTUBE_API_KEY`) atau dari endpoint publik YouTube saat mode scraping. Likes tampil otomatis pada putaran pertama setelah versi ini dipasang — kartu, modal, dan rasio likes/1.000 views langsung terisi untuk BM maupun TREASURE.

**Kenapa ada segmen putus-putus? Bisa lihat yang real?** YouTube **tidak menyediakan** riwayat views harian untuk publik, jadi hari/pekan/bulan tanpa perekaman diisi **interpolasi** dari kurva yang melewati semua titik nyata (legenda “Interpolasi”, tooltip “(interpolasi)”) — bukan tebakan model. Titik likes yang baru mulai terekam tampil pendek di ujung kanan grafik kumulatif dan diberi catatan tanggalnya; mode **“wayback-mass”** mempercepat pengisian arsip lama. Makin lama Actions berjalan, makin panjang segmen data nyata.

**Kenapa ada lagu yang tadinya 0 stream (contoh: SHOCK)?** Parser tabel kworb dulu gagal membaca baris yang sel *stream harian*-nya kosong (biasa terjadi pada lagu baru yang belum masuk chart harian 200 besar) — lagunya dianggap tidak ada sehingga tampil 0. Sudah diperbaiki: sel kosong sekarang sah (daily = 0) dan total stream tetap terbaca. Setelah di-deploy, jalankan sekali workflow *Kumpulkan data* dan angka SHOCK (dan semua lagu berstatus sama) langsung terisi.

**Run Actions gagal `! [rejected] main -> main (fetch first)`?** Itu terjadi kalau repo berubah saat run masih berjalan (mis. kamu mengunggah file situs bersamaan dengan run). Versi workflow ini sudah mengatasinya sendiri: sebelum push, bot menarik commit terbaru (`git pull --rebase`) lalu mendorong, dengan 3× percobaan ulang. Tidak ada data yang hilang — cukup jalankan ulang workflow.

---
Dibuat dengan GitHub Actions + GitHub Pages

## Pembaruan 24 November 2026

- **Panggung kolaborasi MAMA 2020-2024 kini tergambar seperti 2025/2026**: panggung spesialnya sebenarnya sudah tercatat lama (mis. “JESSI X HWA SA”, “THE BOYZ X ATEEZ X Stray Kids — Triangular Fight”), tapi belum dihubungkan ke sistem kolaborasi — jadi grafiknya polos tanpa garis/legenda. Kini semua edisi memakai grammar yang sama dengan 2025/2026 (tema panggung “X with Y, Z”) sehingga muncul **garis berwarna di chart, legenda panggung kolab di dalam grafik, blok “Panggung kolaborasi” di kartu artis** dan toggle “kreditkan juga artis featured” ikut berfungsi: 2020 — GANG (Jessi & Hwa Sa), Bad Girl Good Girl (OH MY GIRL × (G)I-DLE), Triangular Fight, segmen ulang tahun ke-20 BoA (Winter, (G)I-DLE, YooA, unit IZ*ONE), BoA × TAEMIN; 2021 — pembukaan **BlooM The Sound** (Hyunjin, Yeonjun, Yeji, Heeseung, Wooyoung, Karina × 6 grup), One Dream (INI × JO1), Lee Hyori × STREET WOMAN FIGHTER; 2022 — Two Women (Hyolyn × BIBI), Music Makes One (Jung Jae-il × Tiger JK × 3RACHA), Into the Universe (INI × NiziU), We Never Die (JAURIM × (G)I-DLE), **LINNK the Next Generation** (IVE, KEP1ER, NMIXX, LE SSERAFIM, NEWJEANS); 2023 — **I Am Special** (termasuk Choi Hyun-suk, Haruto & Yoshi TREASURE), Endless Rain × YOSHIKI (TXT, BOYNEXTDOOR, RIIZE, ZEROBASEONE), Coexist (JO1 × INI), Rising Sun (TVXQ! × RIIZE), Goddess Awakened; 2024 — **Opening Sequence** (TWS, ILLIT, RIIZE — kini lengkap 3 unggahan resmi: +TWS ‘Dynamite’ 1,13 jt & RIIZE ‘Kick It’ 2,23 jt → 33 video), Cross The Line (Lee Young Ji × PLAVE + artis tamu Lee Ji-ah), dan **reuni BIGBANG** (G-DRAGON ‘Übermensch’ × BIGBANG Daesung & Taeyang). Teks blok kini memakai “entri panggung” (bukan “artis”) supaya akurat untuk panggung yang entri induknya gabungan beberapa artis. Panggung yang TIDAK punya unggahan resmi Mnet tetap tidak ditambahkan (Street Man Fighter × Kang Daniel 2022 hanya ada video BEHIND).
- **Grafik per jam (“1 hari”) lebih jujur**: jam terakhir yang baru berjalan sebagian kini bertanda **estimasi + tooltip “(periode berjalan)”** — sebelumnya delta jam parsial tampil sebagai angka “nyata” yang rendah sehingga tampak seperti views anjlok di ujung kanan grafik. Hint baru menjelaskan bahwa garis putus-putus = jembatan antara dua pengukuran yang jaraknya >3 jam.
- **Workflow kolektor**: jadwal digeser ke **menit ke-13 tiap jam** (`13 * * * *`) — di menit :00 antrean GitHub Actions paling padat dan run terjadwal sering ditunda/dilewati, sehingga grafik per jam bisa bolong. Berkas `.github/workflows/collect.yml` kini ikut di dalam zip update.

- **Dropdown EDISI MAMA (2020-2026) di halaman Awards**: judul tahun MAMA kini menjadi **dropdown “EDISI”** di samping chip Hari/Urutan — MAMA 2026, 2025, 2024, 2023, 2022, 2021 & **2020** bisa dipilih langsung; tahun terpilih tersimpan (localStorage) dan tetap dipakai saat halaman dibuka lagi. Semua edisi diisi **data panggung asli dari unggahan resmi kanal Mnet** (video & views) dengan urutan naik panggung yang dirujuk ke daftar performer Wikipedia tiap edisi: MAMA 2020 (daring CJ ENM Contents World · 28 artis · 29 video — TREASURE disorot: ‘BOY + I LOVE YOU’ & ‘MMM’), MAMA 2021 (Paju · 20 artis · 20 video — TREASURE/BABYMONSTER memang tidak tampil di edisi ini), MAMA 2022 (Kyocera Dome, 2 hari · 31 artis — TREASURE ‘VolKno+JIKJIN+HELLO’), MAMA 2023 (Tokyo Dome, 2 hari · 24 artis — TREASURE ‘MOVE (T5) + BONA BONA’), MAMA 2024 (LA + Osaka, 3 hari · 29 artis — TREASURE ‘KING KONG + RUN’), MAMA 2025 (Kai Tak Stadium, 2 hari · 33 entri termasuk 4 artis tamu — BABYMONSTER dua panggung & TREASURE ‘TRAZY MODE’), MAMA 2026 (berjalan). Fitur pendukung mengikuti edisi: pembatas Hari 1|2|3, panggung kolaborasi, artis tamu, toggle “kreditkan juga artis featured” (2025/2026), dan chart bintang beradaptasi (langkah garis bantu otomatis utk edisi dgn views besar). Tahun yang berkasnya tidak ada di repo otomatis dinonaktifkan di dropdown.
- **Views SEMUA edisi MAMA kini terupdate otomatis**: `collect.js` tidak lagi meng-hardcode daftar berkas — folder `data/` **dipindai otomatis** (pola `mama.json` & `mama-<tahun>.json`), jadi views tiap video panggung edisi 2020-2025 ikut segar tiap jam oleh GitHub Actions, dan edisi 2027 nanti terupdate begitu berkasnya ditambah tanpa mengubah kode.
- **Grafik “ditambahkan per hari” rentang 7/30 hari kini tampil walau riwayat perekaman masih pendek**: dulu rentang 1 hari terlihat (per jam) tapi 7/30 hari kosong karena butuh ≥2 hari kalender perekaman. Sekarang: bucket harian dibangun dari **pasangan pengukuran nyata** (hari dgn rekaman di dua sisi = “Data nyata”), celah perekaman panjang di jendela pendek **tidak lagi diinterpolasi** (dulu muncul bar raksasa palsu yang menenggelamkan bar riil), fallback terakhir = kurva per jam atas blok yang sudah terekam, dan bila data benar-benar belum cukup muncul pesan jelas “grafik X hari belum bisa dibuat… butuh minimal 2 hari kalender perekaman — rentang 1 hari tetap tersedia”.

## Pembaruan 22 November 2026

- **Modal Perbandingan video/lagu dibaca ulang — kurva detail per hari, perbandingan hari yang sama**: dulu kurva digambar mentah dari titik riwayat yang jarang (anchored milestone + pantauan) sehingga tampak patah-patah dan tooltip mencampur hari berbeda (video A hari ke-187 dibanding video B hari ke-21) — selisihnya jadi menyesatkan. Kini kedua kurva disampel **per hari sejak rilis pada hari yang sama**: tooltip selalu memuat dua nilai sekaligus + selisihnya (mis. hari ke-498: SHEESH 355,59 jt vs DRIP 324,43 jt — unggul 31,16 jt), **titik bulat & garis penuh = pengukuran nyata**, **garis putus-putus = perkiraan** di antara dua pengukuran nyata (label "(perkiraan)" di tooltip). Interpolasi linier sengaja dipakai supaya angka di grafik = angka tabel milestone & titik milestone tepat duduk di atas kurva; total ujung kanan tetap nilai nyata persis. Berlaku di versi YouTube & Spotify.
- **Riwayat pencatatan artis kini penuh (tidak ada lagi sel kosong)**: catatan lama (sebelum Actions mulai merekam) hanya punya pendengar bulanan — kolom Total stream & Stream/hari tampil "–". Sekarang keduanya diisi **± perkiraan**: dibagi mundur dari jangkar pencatatan nyata PERTAMA, proporsional rasio pendengar bulanan tiap periode, dari dasar katalog awal yang kecil (BM ≈ 0 — BATTER UP baru terbit 27 Nov 2023; TR ≈ 10 jt — BOY baru 8 hari). Angka jangkar nyata tidak pernah berubah; semua titik hasil perkiraan bertanda **±** dengan tooltip penjelasan.
- **Performa rilisan terbaru — tidak ada lagi garis strip**: MOON M/V kini punya **debut 24 jam resmi laporan penggemar (9.267.038)**; SHOCK M/V dapat jangkar media **23,8 jt @48 jam** + 100 jt @11h21j (Soompi/resmi). Kalau tidak ada sumber kurasi maupun titik rekam situs, angka debut 24 jam & pekan pertama diisi **± perkiraan** bertingkat: (1) interpolasi kurva power-law antara dua jangkar awal yang mengurung hari target, (2) kurva tipikal b≈0,85 dari satu jangkar, (3) rasio tipikal per tipe video terhadap total sekarang (dikalibrasi dari video pemantauan yang angkanya tercatat). Contoh: SHOCK 24 jam ≈ 14,7 jt (perkiraan), DESERVE pekan pertama ≈ 64,9 jt (perkiraan), MOON MV pekan pertama ≈ 48,5 jt (perkiraan).
- **Status keikutsertaan BM/TREASURE di Jadwal & Countdown diverifikasi dari sumber**: **SBS Gayo Daejeon 2026** — TREASURE & BABYMONSTER **konfirmasi** di lineup final 44 artis (diumumkan 9–10 Nov, sumber SBS NOW/berita SBS); **KBS Song Festival 2026** — BM & TR masuk lineup menurut rekap media (batch lanjutan; batch pertama 13 Nov hanya 9 artis); **MBC Gayo Daejejeon, Golden Disc Hanoi & MKMA** — lineup belum diumumkan, catatan diperbarui "keikutsertaan menunggu pengumuman". Dropdown filter (Semua/BABYMONSTER/TREASURE/Tur/Event/…) hanya pernah menampilkan acara dua artis ini.
- **Diskografi kini punya versi YouTube**: toggle **Spotify · stream | YouTube · views** di atas halaman. Versi YT mengelompokkan semua video yang dipantau **per lagu** (M/V + performance + dance practice yang menyebut judul yang sama digabung): total views dijumlahkan, ada rata-rata **+views/hari** (7 hari), tanggal MV, thumbnail YouTube, showcase carousel besar dengan warna aksen ikut rilisan — klik kartu = tampilkan di showcase, klik cover besar = buka M/V-nya.
- **Grafik "ditambahkan per hari" diperbaiki**: bucket harian dulu menimpa isi hari saat data direkam per jam (hari terukur hanya menampilkan kenaikan SATU jam → tampak turun drastis), padahal hari sisa celah perekaman tampil besar. Sekarang delta hari = nilai akhir hari − nilai akhir hari sebelumnya; hari tanpa perekaman diisi interpolasi linier rata antara dua pengukuran nyata (tetap berlabel "dibagi rata"), jadi kurva 7/30 hari tampak konsisten & totalnya tetap akurat. Berlaku di modal video, Statistik Channel (YT & Spotify) — grafik harian kembali terlihat seperti data nyata.
- **Jadwal & Countdown ditambah acara mendatang** (dari pengumuman resmi stasiun & media): **KBS Song Festival 2026** (18 Des, KBS Arena — lineup 24 artis diumumkan 13 Nov), **SBS Gayo Daejeon 2026** (24–25 Des, KINTEX — edisi ke-30 pertama kali dua malam), **MBC Gayo Daejejeon** (31 Des — perkiraan rutin tahunan), **Golden Disc Awards ke-41** (9–10 Jan 2027, Mỹ Đình National Stadium, Hanoi, Vietnam), **MKMA (MBN Music Awards)** (26 Feb 2027, KSPO Dome), plus catatan kaki tur [CHOOM] Hong Kong: kaki Amerika & Eropa menyusul (TBA). Event untuk **dua grup sekaligus** kini pakai group `both` (tampil di filter kedua grup).
- **Trofi khusus voting fans dipersempat ke acara musik saja** (sesuai masukan): MAMA Fans' Choice (2020–2026) **tidak lagi masuk** seksi itu — tetap tercatat lengkap di **Penghargaan besar**. Seksi kini hanya berisi trofi voting fans dari acara musik: Inkigayo Hot Stage (7 untuk TREASURE termasuk 'IF I' & unit HYUNHAYO 'NALLY-NA', 2 untuk BABYMONSTER: 'CHOOM' & 'DESERVE').
- **Diskografi (Spotify)**: klik kartu album/single kini **menampilkannya di showcase atas** (cover besar + tanggal · jumlah lagu · total stream · stream/hari) tanpa langsung membuka halaman album — klik cover besar tetap membuka album. **Warna aksen tiap rilisan ikut cover-nya** (SHOCK merah, WE GO UP hijau, SUGAR HONEY ICE TEA kuning, DRIP ungu, REBOOT emas, dst.) — showcase, titik navigasi, dan kartu terpilih mengikutinya.
- **Riwayat pencatatan artis kini terisi**: jangkar komunitas di X (@bmspotiify, rekap TEUME) + **titik perkiraan bulanan** (tanda `est`) menutup celah Mei 2024→Nov 2026 (BABYMONSTER) dan Mar 2022→Agu 2025 (TREASURE); tabel memberi tooltip sumber per titik. Titik perkiraan ditimpa data nyata saat Actions merekam.
- **Kalender rilisan kini punya versi YouTube**: toggle **Spotify | YouTube** di atas halaman — versi YT menampilkan MV/performance/practice per bulan dengan views, tanpa perlu ganti platform.
- **Trofi & Penghargaan**: dropdown urutan daftar Penghargaan besar (**urutan mendapat / A-Z / gengsi — Daesang paling atas**), seksi baru **Trofi khusus voting fans** (Inkigayo Hot Stage + Fans' Choice MAMA) untuk TREASURE & BABYMONSTER — termasuk 4 kemenangan Hot Stage baru: 'IF I' (Jun 2026) & 'NALLY-NA' unit HYUNHAYO (Jul 2026) untuk TREASURE, 'CHOOM' (Mei 2026) & 'DESERVE' EP.1329 (Nov 2026) untuk BABYMONSTER — dan **Riwayat nominasi kini bisa dibuka/tutup** (default tertutup supaya scroll pendek).
- **MAMA 2026 tuntas**: malam kedua (21 Nov) Best Rap & Hip Hop Performance dimenangkan Zico & Lilas ("DUET") — 'IF I' TREASURE berstatus nominasi; badge MENUNGGU hilang. Sumber: Soompi & Billboard.

## Pembaruan 21 November 2026

- **MAMA 2026 masuk Trofi & Penghargaan**: malam pertama (20 Nov, Kyocera Dome Osaka) — BABYMONSTER menang Fans' Choice Top 10 — Female (ke-3 berturut-turut), TREASURE menang Fans' Choice Top 10 — Male + penghargaan spesial Super Stage Artist. Kategori malam kedua (termasuk Best Rap & Hip Hop Performance: TREASURE 'IF I') tampil dengan badge **MENUNGGU** sampai pengumumannya dimasukkan manual ke `data/trofi.json`.
- **Fitur baru**: halaman **Duel BM vs TREASURE** (adu statistik YouTube & Spotify, badge UNGGUL tiap kategori + skor), halaman **Papan peringkat lagu** (semua lagu diberi peringkat kenaikan 7 hari — dua tab: Views MV & Stream Spotify), banner **"Sejak kunjungan terakhirmu"** di Beranda (snapshot localStorage; titik pembanding diperbarui otomatis ±20 jam atau lewat tombol "perbarui titik"), dan tombol **⬇ CSV** di modal video YouTube & modal lagu Spotify.
- **Riwayat pendengar bulanan diperkaya jangkar arsip**: puncak BABYMONSTER 10,07 jt (Mei 2024) & puncak TREASURE 6,65 jt (Mar–Apr 2022) + titik komunitas lain kini bagian riwayat artis; `collect_spotify.js` dipastikan tidak menghapus titik yang hanya membawa pendengar bulanan. Statistik Channel & Grafik silang menampilkan **puncak tercatat**.
- **Kartu share & PWA ringan**: `og.png` (1200×630) + meta Open Graph/Twitter Card supaya pratinjau tautan rapi di WhatsApp/X/Discord, plus `manifest.json`, ikon 192/512 & apple-touch-icon (bisa dipasang sebagai app).
