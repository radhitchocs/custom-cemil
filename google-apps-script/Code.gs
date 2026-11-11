/**
 * CUMIL (Custom Cemilan) — Backend pesanan Google Spreadsheet
 *
 * Cara pakai singkat:
 * 1. Buat Google Spreadsheet, lalu buka Extensions > Apps Script.
 * 2. Tempel seluruh isi file ini ke Code.gs, simpan.
 * 3. Jalankan fungsi setupSpreadsheet() satu kali dan izinkan akses.
 * 4. Deploy > New deployment > Web app.
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 5. Salin URL /exec ke konstanta ORDER_ENDPOINT di index.html.
 *
 * Catatan keamanan:
 * - Jangan menaruh API key/token di frontend. Endpoint ini memang publik
 *   supaya pelanggan tidak perlu login Google.
 * - Semua data divalidasi ulang di server, teks dibersihkan dari formula
 *   injection, dan ID pesanan dipakai untuk mencegah baris ganda.
 */

const CONFIG = Object.freeze({
  // Kosongkan jika script terpasang langsung di spreadsheet (bound script).
  // Jika standalone, isi dengan ID spreadsheet: docs.google.com/spreadsheets/d/<ID>/edit
  SPREADSHEET_ID: "1qmoc1U54G5LlJQu-bD75HUL0Kk2DapTaoQumO3oKZJM",
  SHEET_NAME: "Pesanan",
  TIMEZONE: "Asia/Jakarta",

  STATUSES: ["Pending", "Confirmed", "Processing", "Ready", "Completed", "Cancelled"],
  INITIAL_STATUS: "Pending",

  MAX_NAME: 80,
  MAX_NOTES: 500,
  MAX_TEXT: 120,
  MAX_ORDER_ID: 64,
  MAX_MIX: 4,
  MIN_GRAM_PER_SIDE: 50,
  MAX_GRAM_PER_SIDE: 150,
  MAX_PRICE: 1000000
});

const HEADERS = [
  "Timestamp",
  "ID Pesanan",
  "Nama Pelanggan",
  "Pengambilan / Pengantaran",
  "Snack Manis",
  "Mix Manis",
  "Berat Manis (g)",
  "Bumbu Manis",
  "Level Pedas Manis",
  "Snack Asin",
  "Mix Asin",
  "Berat Asin (g)",
  "Bumbu Asin",
  "Level Pedas Asin",
  "Total Berat (g)",
  "Mode Kemasan",
  "Estimasi Harga (Rp)",
  "Catatan",
  "Status"
];

const COL = Object.freeze({
  TIMESTAMP: 1,
  ORDER_ID: 2,
  NAMA: 3,
  PENGAMBILAN: 4,
  SNACK_MANIS: 5,
  MIX_MANIS: 6,
  BERAT_MANIS: 7,
  BUMBU_MANIS: 8,
  LEVEL_MANIS: 9,
  SNACK_ASIN: 10,
  MIX_ASIN: 11,
  BERAT_ASIN: 12,
  BUMBU_ASIN: 13,
  LEVEL_ASIN: 14,
  TOTAL_BERAT: 15,
  MODE: 16,
  HARGA: 17,
  CATATAN: 18,
  STATUS: 19
});

const STATUS_STYLE = Object.freeze({
  Pending:    { background: "#FCE8B2", font: "#7F6000" },
  Confirmed:  { background: "#D9EAD3", font: "#274E13" },
  Processing: { background: "#CFE2F3", font: "#0B5394" },
  Ready:      { background: "#EAD1DC", font: "#741B47" },
  Completed:  { background: "#D9D9D9", font: "#434343" },
  Cancelled:  { background: "#F4CCCC", font: "#990000" }
});

// Samakan dengan daftar di index.html. Jika menu berubah, perbarui juga di sini.
const PRODUK_VALID = Object.freeze({
  manis: [
    "Pangpang", "Pluntir Coklat", "Kuping Gajah", "Astor",
    "Choco Crunch", "Momo Roll", "Sale Pisang", "Cereal Ring"
  ],
  gurih: [
    "Seblak Mix Ori", "Kerupuk Seblak Rafael", "Asbes Jengkol", "Kerupuk Kencur",
    "Kerupuk Beton", "Basreng Stik", "Kemplang Ikan", "Kerupuk Tongkol",
    "Kerupuk Tahu Kotak"
  ]
});

const BUMBU_VALID = Object.freeze({
  manis: {
    "Original": false, "Cokelat": false, "Keju": false, "Matcha": false, "SKM": false
  },
  gurih: {
    "Original": false, "Balado": true, "Pedas Daun Jeruk": true,
    "Keju Asin": false, "Jagung Bakar": false
  }
});

const ALLOWED_FULFILLMENT = Object.freeze([
  "Ambil sendiri",
  "Antar (sekitar kampus UPNVJT)"
]);

const ALLOWED_MODES = Object.freeze([
  "Siap Dinikmati",
  "Siap Dibawa"
]);

/* =====================================================================
   Menu spreadsheet
   ===================================================================== */

function onOpen() {
  try {
    SpreadsheetApp.getUi()
      .createMenu("Cumil")
      .addItem("Siapkan Spreadsheet Pesanan", "setupSpreadsheet")
      .addToUi();
  } catch (err) {
    // Diabaikan jika script tidak terpasang pada spreadsheet.
  }
}

function setupSpreadsheet() {
  const ss = getSpreadsheet_();
  ss.setSpreadsheetTimeZone(CONFIG.TIMEZONE);

  let sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(CONFIG.SHEET_NAME);

  pastikanHeader_(sheet);
  formatSheet_(sheet);
  SpreadsheetApp.flush();
  return sheet.getName();
}

/* =====================================================================
   Endpoint Web App
   ===================================================================== */

function doGet() {
  return jsonOut_({
    ok: true,
    message: "Endpoint pesanan Cumil aktif.",
    waktu: Utilities.formatDate(new Date(), CONFIG.TIMEZONE, "yyyy-MM-dd HH:mm:ss")
  });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  let locked = false;

  try {
    locked = lock.tryLock(20000);
    if (!locked) {
      return jsonOut_({ ok: false, error: "Server sedang sibuk. Coba lagi sebentar." });
    }

    if (!e || !e.postData || !e.postData.contents) {
      throw validationError_("Data pesanan kosong.");
    }

    let mentah;
    try {
      mentah = JSON.parse(e.postData.contents);
    } catch (err) {
      throw validationError_("Format data pesanan tidak valid.");
    }

    const pesanan = validasiPesanan_(mentah);
    const sheet = ambilSheetPesanan_();

    const duplikat = cariPesanan_(sheet, pesanan.orderId);
    if (duplikat) {
      return jsonOut_({
        ok: true,
        duplicate: true,
        orderId: pesanan.orderId,
        row: duplikat.row,
        timestamp: duplikat.timestamp
      });
    }

    const hasil = tambahPesanan_(sheet, pesanan);
    return jsonOut_({
      ok: true,
      duplicate: false,
      orderId: pesanan.orderId,
      row: hasil.row,
      timestamp: hasil.timestamp
    });
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    return jsonOut_({ ok: false, error: pesanError_(err) });
  } finally {
    if (locked) lock.releaseLock();
  }
}

/* =====================================================================
   Validasi & sanitasi data
   ===================================================================== */

function validasiPesanan_(d) {
  if (!d || typeof d !== "object" || Array.isArray(d)) {
    throw validationError_("Data pesanan tidak valid.");
  }

  const orderId = teks_(d.orderId, "ID pesanan", 8, CONFIG.MAX_ORDER_ID);
  if (!/^CML-\d{8}-\d{6}-[A-Z0-9]{4,8}$/.test(orderId)) {
    throw validationError_("ID pesanan tidak valid.");
  }

  const nama = teks_(d.nama, "Nama", 1, CONFIG.MAX_NAME);

  const pengambilan = teks_(d.pengambilan, "Pengambilan/pengantaran", 1, 100);
  if (ALLOWED_FULFILLMENT.indexOf(pengambilan) === -1) {
    throw validationError_("Pilihan pengambilan/pengantaran tidak valid.");
  }

  const modeKemasan = teks_(d.modeKemasan, "Mode kemasan", 1, 50);
  if (ALLOWED_MODES.indexOf(modeKemasan) === -1) {
    throw validationError_("Mode kemasan tidak valid.");
  }

  const catatanMentah = d.catatan == null ? "" : d.catatan;
  if (typeof catatanMentah !== "string") {
    throw validationError_("Catatan tidak valid.");
  }
  const catatan = teks_(catatanMentah, "Catatan", 0, CONFIG.MAX_NOTES);

  const manis = validasiSisi_(d.manis, "manis");
  const gurih = validasiSisi_(d.gurih, "gurih");

  const totalGram = manis.gram + gurih.gram;
  const estimasiHarga = angka_(d.estimasiHarga, 0, CONFIG.MAX_PRICE, "Estimasi harga");

  return {
    orderId,
    nama,
    pengambilan,
    modeKemasan,
    catatan,
    manis,
    gurih,
    totalGram,
    estimasiHarga
  };
}

function validasiSisi_(raw, side) {
  const label = side === "manis" ? "manis" : "asin";

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw validationError_(`Data snack ${label} tidak valid.`);
  }

  if (!Array.isArray(raw.produk) || raw.produk.length < 1 || raw.produk.length > CONFIG.MAX_MIX) {
    throw validationError_(`Jumlah produk snack ${label} tidak valid.`);
  }

  const produk = [];
  raw.produk.forEach((item) => {
    const nama = teks_(item, `Produk ${label}`, 1, CONFIG.MAX_TEXT);
    if (PRODUK_VALID[side].indexOf(nama) === -1) {
      throw validationError_(`Produk ${label} tidak dikenal: ${nama}`);
    }
    if (produk.indexOf(nama) !== -1) {
      throw validationError_(`Produk ${label} tidak boleh duplikat.`);
    }
    produk.push(nama);
  });

  const mix = raw.mix === true;
  if (mix && produk.length < 2) {
    throw validationError_(`Mix snack ${label} minimal 2 jenis.`);
  }
  if (!mix && produk.length !== 1) {
    throw validationError_(`Snack ${label} tanpa mix harus 1 jenis.`);
  }

  const gram = angka_(raw.gram, CONFIG.MIN_GRAM_PER_SIDE, CONFIG.MAX_GRAM_PER_SIDE, `Berat ${label}`);

  const bumbu = teks_(raw.bumbu, `Bumbu ${label}`, 1, CONFIG.MAX_TEXT);
  if (!Object.prototype.hasOwnProperty.call(BUMBU_VALID[side], bumbu)) {
    throw validationError_(`Bumbu ${label} tidak dikenal: ${bumbu}`);
  }

  let levelPedas = null;
  if (BUMBU_VALID[side][bumbu]) {
    levelPedas = angka_(raw.levelPedas, 0, 3, `Level pedas ${label}`);
  }

  return { produk, mix, gram, bumbu, levelPedas };
}

function teks_(nilai, label, min, max) {
  if (typeof nilai !== "string") {
    throw validationError_(`${label} tidak valid.`);
  }
  const bersih = nilai.trim();
  if (bersih.length < min || bersih.length > max) {
    throw validationError_(`${label} harus ${min}-${max} karakter.`);
  }
  return bersih;
}

function angka_(nilai, min, max, label) {
  const n = Number(nilai);
  if (!isFinite(n) || Math.floor(n) !== n || n < min || n > max) {
    throw validationError_(`${label} tidak valid.`);
  }
  return n;
}

function validationError_(pesan) {
  const err = new Error(pesan);
  err.name = "ValidationError";
  return err;
}

function pesanError_(err) {
  if (err && err.name === "ValidationError") return err.message;
  return "Server gagal menyimpan pesanan. Coba lagi.";
}

// Cegah teks input pengguna dibaca sebagai formula oleh Google Sheets.
function selAman_(nilai) {
  let s = nilai == null ? "" : String(nilai);
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return s;
}

/* =====================================================================
   Spreadsheet: header, format, status dropdown, conditional formatting
   ===================================================================== */

function getSpreadsheet_() {
  const id = String(CONFIG.SPREADSHEET_ID || "").trim();
  if (id) return SpreadsheetApp.openById(id);

  const aktif = SpreadsheetApp.getActiveSpreadsheet();
  if (!aktif) {
    throw new Error("Script tidak terpasang pada spreadsheet. Isi CONFIG.SPREADSHEET_ID.");
  }
  return aktif;
}

function ambilSheetPesanan_() {
  const ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  let baru = false;

  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEET_NAME);
    baru = true;
  }

  if (baru || sheet.getLastRow() === 0) {
    ss.setSpreadsheetTimeZone(CONFIG.TIMEZONE);
    pastikanHeader_(sheet);
    formatSheet_(sheet);
  } else {
    pastikanHeader_(sheet);
  }

  return sheet;
}

function pastikanHeader_(sheet) {
  const header = sheet.getRange(1, 1, 1, HEADERS.length);
  const sekarang = header.getDisplayValues()[0];
  const cocok = HEADERS.every((judul, i) => sekarang[i] === judul);
  if (cocok) return;

  if (sheet.getLastRow() <= 1) {
    header.setValues([HEADERS]);
    return;
  }

  throw new Error(
    "Header sheet " + CONFIG.SHEET_NAME + " tidak cocok. " +
    "Gunakan spreadsheet baru atau sesuaikan header dengan panduan."
  );
}

function formatSheet_(sheet) {
  sheet.setFrozenRows(1);
  sheet.setRowHeight(1, 42);

  const header = sheet.getRange(1, 1, 1, HEADERS.length);
  header
    .setBackground("#5A2A0C")
    .setFontColor("#FFFFFF")
    .setFontWeight("bold")
    .setFontSize(11)
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle")
    .setWrap(true);

  const lebar = [
    150, 190, 140, 190, 220, 75, 90, 110, 100,
    220, 75, 90, 110, 100, 90, 130, 130, 220, 110
  ];
  lebar.forEach((w, i) => sheet.setColumnWidth(i + 1, w));

  const jumlahBaris = Math.max(sheet.getMaxRows() - 1, 1);
  const dataRange = sheet.getRange(2, 1, jumlahBaris, HEADERS.length);
  dataRange.setVerticalAlignment("middle");

  sheet.getRange(2, COL.TIMESTAMP, jumlahBaris, 1).setNumberFormat("yyyy-mm-dd hh:mm:ss");
  sheet.getRange(2, COL.BERAT_MANIS, jumlahBaris, 1).setNumberFormat("0");
  sheet.getRange(2, COL.BERAT_ASIN, jumlahBaris, 1).setNumberFormat("0");
  sheet.getRange(2, COL.TOTAL_BERAT, jumlahBaris, 1).setNumberFormat("0");
  sheet.getRange(2, COL.HARGA, jumlahBaris, 1).setNumberFormat('"Rp"#,##0');

  [COL.TIMESTAMP, COL.BERAT_MANIS, COL.BERAT_ASIN, COL.TOTAL_BERAT, COL.HARGA, COL.STATUS]
    .forEach((kolom) => sheet.getRange(2, kolom, jumlahBaris, 1).setHorizontalAlignment("center"));

  [COL.SNACK_MANIS, COL.SNACK_ASIN, COL.CATATAN]
    .forEach((kolom) => sheet.getRange(2, kolom, jumlahBaris, 1).setWrap(true));

  if (!sheet.getFilter()) {
    sheet.getRange(1, 1, Math.max(sheet.getMaxRows(), 2), HEADERS.length).createFilter();
  }

  pastikanStatusConfig_(sheet);
}

function validasiStatus_() {
  return SpreadsheetApp.newDataValidation()
    .requireValueInList(CONFIG.STATUSES, true)
    .setAllowInvalid(false)
    .setHelpText("Pilih status pesanan.")
    .build();
}

function pastikanStatusConfig_(sheet) {
  const jumlahBaris = Math.max(sheet.getMaxRows() - 1, 1);
  const statusRange = sheet.getRange(2, COL.STATUS, jumlahBaris, 1);

  statusRange.setDataValidation(validasiStatus_());

  const rulesLama = sheet.getConditionalFormatRules().filter((rule) => {
    return !rule.getRanges().some((r) => {
      return r.getColumn() === COL.STATUS && r.getLastColumn() === COL.STATUS;
    });
  });

  const rulesBaru = CONFIG.STATUSES.map((status) => {
    const gaya = STATUS_STYLE[status];
    return SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo(status)
      .setBackground(gaya.background)
      .setFontColor(gaya.font)
      .setBold(true)
      .setRanges([statusRange])
      .build();
  });

  sheet.setConditionalFormatRules(rulesLama.concat(rulesBaru));
}

/* =====================================================================
   Simpan pesanan
   ===================================================================== */

function cariPesanan_(sheet, orderId) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;

  const ids = sheet.getRange(2, COL.ORDER_ID, lastRow - 1, 1).getDisplayValues();
  for (let i = 0; i < ids.length; i++) {
    if (ids[i][0] === orderId) {
      const row = i + 2;
      return {
        row,
        timestamp: sheet.getRange(row, COL.TIMESTAMP).getDisplayValue()
      };
    }
  }
  return null;
}

function tambahPesanan_(sheet, pesanan) {
  const sekarang = new Date();

  const baris = [
    sekarang,
    selAman_(pesanan.orderId),
    selAman_(pesanan.nama),
    selAman_(pesanan.pengambilan),
    selAman_(pesanan.manis.produk.join(" + ")),
    pesanan.manis.mix ? "Ya" : "Tidak",
    pesanan.manis.gram,
    selAman_(pesanan.manis.bumbu),
    pesanan.manis.levelPedas === null ? "-" : pesanan.manis.levelPedas,
    selAman_(pesanan.gurih.produk.join(" + ")),
    pesanan.gurih.mix ? "Ya" : "Tidak",
    pesanan.gurih.gram,
    selAman_(pesanan.gurih.bumbu),
    pesanan.gurih.levelPedas === null ? "-" : pesanan.gurih.levelPedas,
    pesanan.totalGram,
    selAman_(pesanan.modeKemasan),
    pesanan.estimasiHarga,
    selAman_(pesanan.catatan),
    CONFIG.INITIAL_STATUS
  ];

  sheet.appendRow(baris);
  const row = sheet.getLastRow();

  formatBaris_(sheet, row);

  return {
    row,
    timestamp: Utilities.formatDate(sekarang, CONFIG.TIMEZONE, "yyyy-MM-dd HH:mm:ss")
  };
}

function formatBaris_(sheet, row) {
  try {
    const timestamp = sheet.getRange(row, COL.TIMESTAMP);
    timestamp.setNumberFormat("yyyy-mm-dd hh:mm:ss");
    timestamp.setHorizontalAlignment("center");

    sheet.getRange(row, COL.BERAT_MANIS).setNumberFormat("0").setHorizontalAlignment("center");
    sheet.getRange(row, COL.BERAT_ASIN).setNumberFormat("0").setHorizontalAlignment("center");
    sheet.getRange(row, COL.TOTAL_BERAT).setNumberFormat("0").setHorizontalAlignment("center");
    sheet.getRange(row, COL.HARGA).setNumberFormat('"Rp"#,##0').setHorizontalAlignment("center");

    sheet.getRange(row, COL.SNACK_MANIS).setWrap(true);
    sheet.getRange(row, COL.SNACK_ASIN).setWrap(true);
    sheet.getRange(row, COL.CATATAN).setWrap(true);

    const status = sheet.getRange(row, COL.STATUS);
    status.setHorizontalAlignment("center");
    status.setDataValidation(validasiStatus_());
    status.setValue(CONFIG.INITIAL_STATUS);

    if (row >= sheet.getMaxRows()) {
      pastikanStatusConfig_(sheet);
    }
  } catch (err) {
    console.warn("Pesanan tersimpan, tetapi format baris gagal diterapkan: " + err.message);
  }
}

/* =====================================================================
   Utilitas respons
   ===================================================================== */

function jsonOut_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
