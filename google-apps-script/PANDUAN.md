# Panduan Integrasi Cumil ke Google Spreadsheet

Panduan ini menjelaskan cara menyiapkan Google Spreadsheet, Google Apps Script, deployment Web App, dan pengujian integrasi pesanan website Cumil.

## 1. Arsitektur singkat

```
Website index.html
   │  POST JSON (Content-Type: text/plain)
   ▼
Google Apps Script Web App (doPost)
   │  validasi + sanitasi + cek ID ganda + LockService
   ▼
Google Spreadsheet → sheet "Pesanan"
```

- Frontend **tidak menyimpan kredensial apa pun**. Hanya URL Web App publik yang dipakai.
- Pelanggan **tidak perlu login Google**.
- Semua data divalidasi ulang di Apps Script. Frontend hanya mengirim data yang memang sudah ada di website.
- Baris baru ditulis dengan status awal `Pending`.
- ID pesanan dibuat di frontend dan dicek ulang di server. Jika request diulang karena koneksi putus, server mengembalikan baris yang sama, bukan membuat baris ganda.
- Notifikasi sukses di website hanya muncul setelah Apps Script membalas `ok: true`.

## 2. Struktur kolom spreadsheet

Sheet dibuat otomatis dengan nama `Pesanan` dan kolom berikut:

| Kolom | Header | Sumber data website |
|---|---|---|
| A | Timestamp | Waktu server menerima pesanan |
| B | ID Pesanan | ID unik `CML-YYYYMMDD-HHMMSS-XXXXXX` |
| C | Nama Pelanggan | Input `Nama kamu` |
| D | Pengambilan / Pengantaran | Radio `Ambil sendiri` / `Antar (sekitar kampus UPNVJT)` |
| E | Snack Manis | Jenis snack manis yang dipilih, digabung ` + ` jika mix |
| F | Mix Manis | `Ya` / `Tidak` |
| G | Berat Manis (g) | Slider berat snack manis |
| H | Bumbu Manis | Bumbu snack manis |
| I | Level Pedas Manis | Level 0–3, atau `-` jika bumbu tidak pedas |
| J | Snack Asin | Jenis snack asin yang dipilih, digabung ` + ` jika mix |
| K | Mix Asin | `Ya` / `Tidak` |
| L | Berat Asin (g) | Slider berat snack asin |
| M | Bumbu Asin | Bumbu snack asin |
| N | Level Pedas Asin | Level 0–3, atau `-` jika bumbu tidak pedas |
| O | Total Berat (g) | Berat manis + berat asin |
| P | Mode Kemasan | `Siap Dinikmati` / `Siap Dibawa` |
| Q | Estimasi Harga (Rp) | Harga estimasi dari website |
| R | Catatan | Input catatan (opsional) |
| S | Status | Dropdown status, awal `Pending` |

Contoh isi untuk pesanan mix:

| Snack Manis | Mix Manis | Berat Manis (g) | Bumbu Manis |
|---|---|---|---|
| Kuping Gajah + Astor | Ya | 125 | Cokelat |

## 3. Menyiapkan Google Spreadsheet dan Apps Script

1. Buat Google Spreadsheet baru.
2. Ganti nama spreadsheet, misalnya **Cumil Orders**.
3. Buka menu **Extensions → Apps Script**.
4. Hapus isi default `Code.gs`, lalu tempel seluruh isi file:
   `google-apps-script/Code.gs`
5. Simpan project (Ctrl/Cmd + S).
6. Pada `Code.gs`, atur konfigurasi:
   - Disarankan isi ID spreadsheet agar Web App selalu menulis ke file yang benar:
     ```js
     SPREADSHEET_ID: "1AbC...ID_SPREADSHEET_KAMU",
     ```
     ID diambil dari URL spreadsheet:
     `docs.google.com/spreadsheets/d/<ID_SPREADSHEET_KAMU>/edit`
   - Jika dibiarkan kosong, script akan mencoba memakai spreadsheet tempat script terpasang (bound script).
7. Jalankan fungsi **`setupSpreadsheet`** sekali:
   - Pilih fungsi `setupSpreadsheet` di dropdown editor Apps Script.
   - Klik **Run**.
   - Saat diminta otorisasi: **Review permissions → pilih akun → Advanced → Go to project (unsafe) → Allow**.
8. Kembali ke spreadsheet. Sheet `Pesanan` akan dibuat dengan:
   - header berwarna,
   - baris pertama dibekukan,
   - filter,
   - format tanggal dan angka,
   - dropdown Status di kolom S,
   - conditional formatting untuk 6 status.

Jika `setupSpreadsheet` dijalankan ulang, header dan konfigurasi status akan disiapkan lagi. Jangan mengubah urutan header secara manual setelah data mulai masuk.

## 4. Deploy Apps Script sebagai Web App

1. Di editor Apps Script, klik **Deploy → New deployment**.
2. Klik ikon gear, pilih **Web app**.
3. Isi:
   - **Description**: `Cumil order endpoint`
   - **Execute as**: `Me (email kamu)`
   - **Who has access**: `Anyone`
4. Klik **Deploy**.
5. Salin **Web app URL**. URL harus berakhiran `/exec`, bukan `/dev`.
6. Buka file `index.html`, cari bagian konfigurasi:

   ```js
   const ORDER_ENDPOINT = "";
   ```

   Tempel URL tadi:

   ```js
   const ORDER_ENDPOINT = "https://script.google.com/macros/s/AKfycb.../exec";
   ```

7. Simpan dan deploy ulang website (commit/push ke hosting yang dipakai).

Pengaturan **Who has access: Anyone** wajib supaya pelanggan bisa mengirim pesanan tanpa login Google.

### Update Apps Script setelah mengubah kode

Setelah mengubah `Code.gs`, buat versi deployment baru:

1. **Deploy → Manage deployments**.
2. Klik ikon pensil pada deployment aktif.
3. Pada **Version**, pilih **New version**.
4. Klik **Deploy**.

Tanpa langkah ini, URL `/exec` masih memakai kode versi lama.

## 5. Cara kerja di website

Saat pelanggan menekan **Pesan via WhatsApp** (tombol utama atau tombol bawah):

1. Nama divalidasi seperti sebelumnya.
2. Website menyusun payload dari data yang benar-benar ada:
   - nama, pengambilan/pengantaran, catatan,
   - mode kemasan,
   - produk, mix, berat, bumbu, level pedas untuk sisi manis dan asin,
   - total berat dan estimasi harga.
3. Website mengirim POST ke Web App Apps Script.
4. Jika server membalas sukses:
   - baris baru sudah tersimpan,
   - status sukses dan ID pesanan ditampilkan,
   - WhatsApp dibuka dengan pesan yang menyertakan ID pesanan.
5. Jika gagal:
   - tidak ada notifikasi sukses,
   - tidak ada konfeti,
   - ditampilkan pesan error dan tautan WhatsApp **tanpa dicatat** sebagai fallback.

Tombol **Salin Pesanan** tetap berfungsi seperti sebelumnya dan tidak menulis baris baru. Pencatatan dilakukan saat pelanggan menekan tombol kirim WhatsApp.

## 6. Pengujian pesanan

1. Buka website yang sudah memakai `ORDER_ENDPOINT` yang benar.
2. Isi nama, pilih produk, berat, bumbu, mode kemasan, dan catatan.
3. Klik **Pesan via WhatsApp**.
4. Pastikan tab WhatsApp terbuka dan pesan berisi ID pesanan.
5. Buka spreadsheet, sheet `Pesanan`.
6. Periksa:
   - ada satu baris baru,
   - Timestamp terisi,
   - ID Pesanan di website sama dengan kolom B,
   - produk mix tercatat dengan pemisah ` + `,
   - berat, bumbu, level pedas, total, harga, dan catatan sesuai,
   - Status berisi `Pending`.
7. Di tab WhatsApp, belum perlu benar-benar mengirim pesan untuk pengujian pencatatan.

### Uji anti-pesan ganda

1. Klik tombol **Pesan via WhatsApp** dua kali cepat.
2. Pastikan tetap hanya ada satu baris dengan ID yang sama.
3. Klik lagi pesanan identik dalam 5 menit; website akan menyebut pesanan sudah tersimpan dan tidak menambah baris baru.
4. Ubah pesanan atau nama, lalu kirim lagi; baris baru harus muncul.

### Uji kegagalan

1. Sementara ubah `ORDER_ENDPOINT` menjadi URL yang salah.
2. Kirim pesanan.
3. Pastikan:
   - website menampilkan pesan gagal,
   - tidak ada toast sukses,
   - tidak ada konfeti,
   - tidak ada baris baru di spreadsheet.
4. Kembalikan URL yang benar.

### Uji endpoint langsung

Buka URL Web App `/exec` di browser. Harus muncul JSON:

```json
{"ok":true,"message":"Endpoint pesanan Cumil aktif.","waktu":"..."}
```

Jika muncul halaman login Google atau error akses, deployment belum memakai **Who has access: Anyone**.

## 7. Pengujian Status dan Conditional Formatting

1. Buka sheet `Pesanan`.
2. Klik salah satu sel di kolom **Status** pada baris pesanan.
3. Pastikan muncul dropdown berisi:
   - Pending
   - Confirmed
   - Processing
   - Ready
   - Completed
   - Cancelled
4. Pilih status lain, misalnya `Confirmed`.
5. Pastikan warna latar/font sel berubah sesuai status, dan kolom lain tidak berubah.
6. Kirim pesanan baru dari website.
7. Pastikan baris baru otomatis:
   - berstatus `Pending`,
   - memiliki dropdown Status,
   - ikut terkena aturan warna conditional formatting.

Warna status yang dipakai:

| Status | Warna latar | Warna teks |
|---|---|---|
| Pending | Kuning muda | Cokelat tua |
| Confirmed | Hijau muda | Hijau tua |
| Processing | Biru muda | Biru tua |
| Ready | Pink muda | Maroon |
| Completed | Abu-abu muda | Abu-abu tua |
| Cancelled | Merah muda | Merah tua |

## 8. Keamanan dan batasan

- **Tidak ada API key atau kredensial Google di frontend.** URL Web App boleh publik; akses ke spreadsheet tetap melalui Apps Script.
- **Validasi server-side** mencakup:
  - nama, catatan, ID pesanan,
  - daftar produk dan bumbu yang dikenal,
  - jumlah produk saat mix,
  - rentang berat 50–150 g per sisi,
  - level pedas 0–3,
  - pilihan pengambilan dan mode kemasan,
  - estimasi harga.
- **Formula injection dicegah**: teks yang diawali `=`, `+`, `-`, atau `@` ditulis sebagai teks biasa.
- **LockService** mencegah dua request menulis bersamaan.
- **Deduplikasi ID pesanan** mencegah baris ganda saat retry atau klik berulang.
- Endpoint publik tetap bisa disalahgunakan (spam request). Untuk situs pre-order kecil, pantau kuota Apps Script dan jumlah baris. Jika perlu, tambahkan rate limiting di depan endpoint, tetapi jangan menaruh secret di `index.html`.
- Apps Script memiliki kuota eksekusi harian. Untuk volume besar, pertimbangkan backend sendiri dengan Google Sheets API dan service account yang disimpan di server.

## 9. Troubleshooting

| Gejala | Penyebab umum | Solusi |
|---|---|---|
| Website bilang integrasi belum dikonfigurasi | `ORDER_ENDPOINT` kosong atau bukan URL `/exec` yang valid | Tempel URL Web App yang benar |
| Muncul halaman login Google | Deployment bukan `Anyone` | Edit deployment, ubah akses |
| `Respons server tidak valid` | URL salah, deployment belum aktif, atau respons bukan JSON | Buka URL `/exec` di browser, cek JSON aktif |
| Error CORS | Header request diubah menjadi `application/json` | Biarkan `Content-Type: text/plain;charset=utf-8` |
| Tidak ada baris baru | Error saat `doPost` | Buka Apps Script → **Executions**, lihat log error |
| Produk ditolak server | Menu di `index.html` berubah, whitelist `Code.gs` belum diperbarui | Samakan `PRODUK_VALID` dan `BUMBU_VALID` di `Code.gs` |
| Status baru tidak berwarna | Conditional formatting belum disiapkan | Jalankan `setupSpreadsheet` lagi |
| Dropdown Status hilang | Data validation terhapus manual | Jalankan `setupSpreadsheet` lagi |
| Timestamp berbeda zona waktu | Zona waktu spreadsheet/script berbeda | `setupSpreadsheet` mengatur `Asia/Jakarta`; sesuaikan `CONFIG.TIMEZONE` bila perlu |
| Perubahan kode tidak aktif | Deployment masih versi lama | Deploy ulang dengan **New version** |

## 10. Perawatan saat menu berubah

Jika daftar camilan atau bumbu di `index.html` berubah, perbarui juga:

- `PRODUK_VALID` di `Code.gs`
- `BUMBU_VALID` di `Code.gs`
- `ALLOWED_FULFILLMENT` dan `ALLOWED_MODES` bila alurnya berubah

Jika status pesanan berubah:

- perbarui `CONFIG.STATUSES` dan `STATUS_STYLE` di `Code.gs`,
- jalankan `setupSpreadsheet` lagi.
