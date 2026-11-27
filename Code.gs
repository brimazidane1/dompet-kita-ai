// ============================================================================
// GOOGLE APPS SCRIPT - CATATAN PENGELUARAN PASUTRI AI (ANTI-CORS & ANTI-NIMPA)
// ============================================================================
// Setup Script Properties (Project Settings -> Script Properties):
// 1. GEMINI_API_KEY : API Key dari Google AI Studio (https://aistudio.google.com/apikey)
// 2. APP_PIN        : PIN rahasia bersama Suami & Istri (misal: 123456)
//
// PENTING SAAT DEPLOY:
// Deploy -> New deployment -> Web app
// - Execute as: Me
// - Who has access: Anyone
// ============================================================================

const GEMINI_MODELS = [
  "gemini-3.6-flash",
  "gemini-3.8-flash",
  "gemini-4-hydrogen",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
];

const SHEET_CONFIG = {
  BULANAN: { descCol: 2, totalCol: 3, label: "Pengeluaran Bulanan" },
  FOYA_FOYA: { descCol: 8, totalCol: 9, label: "Foya-foya Bulanan" },
  SAMPINGAN: { descCol: 14, totalCol: 15, label: "Sampingan Bulanan" },
  DATE_COL: 1,
  START_ROW: 3, // Tanggal pertama mulai di baris A3
};

function doGet(e) {
  return jsonResponse({
    status: "ok",
    message: "Google Apps Script aktif dan siap menerima request!",
  });
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse({ status: "error", message: "Request body kosong." });
    }

    const payload = JSON.parse(e.postData.contents);
    const props = PropertiesService.getScriptProperties();
    const savedPin = props.getProperty("APP_PIN");
    const geminiApiKey = props.getProperty("GEMINI_API_KEY");

    if (!savedPin) {
      return jsonResponse({
        status: "error",
        message: "APP_PIN belum diatur di Script Properties Apps Script.",
      });
    }

    if (String(payload.pin || "").trim() !== String(savedPin).trim()) {
      return jsonResponse({
        status: "error",
        message: "PIN salah! Periksa kembali PIN di pengaturan.",
      });
    }

    const action = payload.action || "preview";

    // Endpoint khusus tombol "Tes Koneksi"
    if (action === "ping") {
      const ssName = SpreadsheetApp.getActiveSpreadsheet().getName();
      return jsonResponse({
        status: "ok",
        message: "Terhubung ke Google Sheet: " + ssName,
        hasGeminiKey: Boolean(geminiApiKey),
      });
    }

    const actor = payload.actor === "i" ? "i" : "s";

    // Mode Preview: tampilkan nama item bersih + kode pelaku (tanpa harga ganda)
    if (action === "preview") {
      if (!geminiApiKey) {
        return jsonResponse({
          status: "error",
          message:
            "GEMINI_API_KEY belum diatur di Script Properties Apps Script.",
        });
      }
      const rawText = String(payload.text || "").trim();
      if (!rawText) {
        return jsonResponse({
          status: "error",
          message: "Teks catatan tidak boleh kosong.",
        });
      }

      const parsedResult = parseExpenseWithGemini(rawText, actor, geminiApiKey);
      const enriched = parsedResult.items.map((it) => ({
        ...it,
        targetSheet: resolveSheetNameByCutoff25(it.date),
        categoryLabel: (SHEET_CONFIG[it.category] || SHEET_CONFIG.BULANAN)
          .label,
      }));

      return jsonResponse({
        status: "ok",
        modelUsed: parsedResult.modelUsed,
        items: enriched,
      });
    }

    // Mode Commit: simpan ke Google Sheet
    if (action === "commit") {
      let items = payload.items;
      let modelUsed = "manual-preview";

      if ((!items || !items.length) && payload.text) {
        if (!geminiApiKey) {
          return jsonResponse({
            status: "error",
            message: "GEMINI_API_KEY belum diatur di Script Properties.",
          });
        }
        const parsedResult = parseExpenseWithGemini(
          String(payload.text).trim(),
          actor,
          geminiApiKey,
        );
        items = parsedResult.items;
        modelUsed = parsedResult.modelUsed;
      }

      if (!items || !items.length) {
        return jsonResponse({
          status: "error",
          message: "Tidak ada item pengeluaran yang bisa dicatat.",
        });
      }

      const resultSummary = writeItemsSafelyWithLock(items, actor);
      return jsonResponse({
        status: "ok",
        modelUsed: modelUsed,
        results: resultSummary,
      });
    }

    return jsonResponse({
      status: "error",
      message: "Action tidak dikenali: " + action,
    });
  } catch (err) {
    return jsonResponse({
      status: "error",
      message: err.message || String(err),
    });
  }
}

function parseExpenseWithGemini(userText, actor, apiKey) {
  const tz = "Asia/Jakarta";
  const todayStr = Utilities.formatDate(new Date(), tz, "yyyy-MM-dd");
  const dayName = Utilities.formatDate(new Date(), tz, "EEEE");
  const cleanedInput = String(userText || "")
    .replace(/[.,;]+$/g, "")
    .trim();

  const prompt = `
Hari ini adalah ${dayName}, tanggal ${todayStr} (zona waktu Asia/Jakarta).
Pengguna yang mencatat saat ini memiliki kode profil: "${actor}" ("s" = suami, "i" = istri).

Tugasmu adalah mengekstrak SEMUA daftar pengeluaran dari teks bahasa Indonesia berikut menjadi array JSON.
PENTING: Jika ada 2, 3, atau lebih item yang dipisahkan koma, kata "dan", "sama", atau spasi, WAJIB ekstrak SEMUANYA menjadi objek terpisah. Jangan pernah melewatkan item pertama!

CONTOH INPUT:
"Nasi kuning 8000, kukusan 8000"
CONTOH OUTPUT:
[
  {"date": "${todayStr}", "category": "BULANAN", "item": "nasi kuning ${actor}", "amount": 8000},
  {"date": "${todayStr}", "category": "BULANAN", "item": "kukusan ${actor}", "amount": 8000}
]

ATURAN WAJIB:
1. TANGGAL ("date"):
   - Format harus "YYYY-MM-DD".
   - Jika tidak disebutkan tanggalnya, gunakan tanggal hari ini (${todayStr}).
   - Jika disebut "kemarin", "lusa", "tanggal 22", dll, hitung tanggal pastinya berdasarkan patokan hari ini (${todayStr}).
2. KATEGORI ("category"):
   - Nilai hanya boleh salah satu dari: "BULANAN", "FOYA_FOYA", atau "SAMPINGAN".
   - DEFAULT adalah "BULANAN" (untuk makan, jajan harian, laundry, belanja dapur, bensin, dll).
   - HANYA gunakan "FOYA_FOYA" jika pengguna secara eksplisit menyebut kata "foya-foya" / "foya foya" untuk item tersebut.
   - HANYA gunakan "SAMPINGAN" jika pengguna secara eksplisit menyebut kata "sampingan" untuk item tersebut.
3. DESKRIPSI ITEM ("item"):
   - Tulis nama barang/pengeluaran secara ringkas dalam huruf kecil (contoh: "nasi kuning", "kukusan", "sbux", "token listrik").
   - JANGAN sertakan nominal harga di dalam field "item" karena harga sudah masuk di field "amount".
   - Hapus kata pemicu kategori seperti "foya-foya" atau "sampingan" dari nama item.
   - Akhiri deskripsi dengan spasi dan kode "${actor}" (contoh: "nasi kuning ${actor}"). Jika pengguna secara eksplisit menyebut pelaku lain untuk item tertentu (misal suami mencatat tapi bilang "istri beli kopi"), gunakan kode pelaku item tersebut ("i").
4. NOMINAL ("amount"):
   - Angka bulat (integer) dalam Rupiah tanpa titik/koma (contoh: "16rb" -> 16000, "1,5jt" -> 1500000, "8000" -> 8000).

Teks catatan pengguna:
<<<${cleanedInput}>>>
`;

  const requestBody = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            date: { type: "STRING" },
            category: {
              type: "STRING",
              enum: ["BULANAN", "FOYA_FOYA", "SAMPINGAN"],
            },
            item: { type: "STRING" },
            amount: { type: "INTEGER" },
          },
          required: ["date", "category", "item", "amount"],
        },
      },
    },
  };

  let lastError = "";

  for (let m = 0; m < GEMINI_MODELS.length; m++) {
    const modelName = GEMINI_MODELS[m];
    const url =
      "https://generativelanguage.googleapis.com/v1beta/models/" +
      modelName +
      ":generateContent?key=" +
      encodeURIComponent(apiKey);

    const response = UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(requestBody),
      muteHttpExceptions: true,
    });

    const code = response.getResponseCode();
    const bodyText = response.getContentText();

    if (code === 200) {
      const parsed = JSON.parse(bodyText);
      const rawJsonText = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawJsonText) {
        throw new Error("Gemini tidak mengembalikan hasil JSON.");
      }

      const items = JSON.parse(rawJsonText);
      const normalized = items.map((entry) => {
        let cleanItem = String(entry.item || "").trim();
        if (!/\s+(s|i)$/i.test(cleanItem)) {
          cleanItem = cleanItem + " " + actor;
        }
        const validCat = ["BULANAN", "FOYA_FOYA", "SAMPINGAN"].includes(
          entry.category,
        )
          ? entry.category
          : "BULANAN";
        return {
          date: String(entry.date || todayStr).trim(),
          category: validCat,
          item: cleanItem,
          amount: Math.round(Number(entry.amount) || 0),
        };
      });

      return { items: normalized, modelUsed: modelName };
    }

    lastError = modelName + " (" + code + "): " + bodyText;
    if (code === 503 || code === 429 || code === 404) {
      continue;
    } else {
      throw new Error("Gemini API Error - " + lastError);
    }
  }

  throw new Error("Semua model Gemini sedang sibuk. Detail: " + lastError);
}

function writeItemsSafelyWithLock(items, defaultActor) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const grouped = {};

    items.forEach((entry) => {
      const cat = SHEET_CONFIG[entry.category] ? entry.category : "BULANAN";
      const sheetName = resolveSheetNameByCutoff25(entry.date);
      const key = `${sheetName}|${entry.date}|${cat}`;

      if (!grouped[key]) {
        grouped[key] = {
          sheetName: sheetName,
          date: entry.date,
          category: cat,
          entries: [],
        };
      }
      grouped[key].entries.push({
        item: String(entry.item || "").trim(),
        amount: Math.round(Number(entry.amount) || 0),
      });
    });

    const summary = [];

    Object.values(grouped).forEach((group) => {
      const sheet = ss.getSheetByName(group.sheetName);
      if (!sheet) {
        throw new Error(
          `Tab sheet "${group.sheetName}" tidak ditemukan di Google Sheet.`,
        );
      }

      const rowIndex = findDateRow(sheet, group.date);
      if (rowIndex === -1) {
        throw new Error(
          `Tanggal ${group.date} tidak ditemukan pada Kolom A di tab "${group.sheetName}".`,
        );
      }

      const colConfig = SHEET_CONFIG[group.category];
      const descCell = sheet.getRange(rowIndex, colConfig.descCol);
      const totalCell = sheet.getRange(rowIndex, colConfig.totalCol);

      // 1. Format deskripsi: "nasi kuning 8rb s, kukusan 8rb s" (anti-double)
      const existingDesc = String(descCell.getValue() || "").trim();
      const newDescParts = group.entries.map((e) =>
        formatItemOnceForSheet(e.item, e.amount, defaultActor),
      );
      const combinedDesc = existingDesc
        ? `${existingDesc}, ${newDescParts.join(", ")}`
        : newDescParts.join(", ");

      // 2. Format Total Harian sebagai rumus berurutan: "=8000+8000"
      const existingFormula = String(totalCell.getFormula() || "").trim();
      const existingNumeric = Number(totalCell.getValue()) || 0;
      const addedExpr = group.entries.map((e) => String(e.amount)).join("+");

      let finalFormula = "";
      if (existingFormula.startsWith("=")) {
        const baseExpr = existingFormula.substring(1).trim();
        finalFormula = baseExpr ? `=${baseExpr}+${addedExpr}` : `=${addedExpr}`;
      } else if (existingNumeric > 0) {
        finalFormula = `=${existingNumeric}+${addedExpr}`;
      } else {
        finalFormula = `=${addedExpr}`;
      }

      descCell.setValue(combinedDesc);
      totalCell.setFormula(finalFormula);
      SpreadsheetApp.flush();

      const updatedTotal = Number(totalCell.getValue()) || 0;

      summary.push({
        sheet: group.sheetName,
        date: group.date,
        category: colConfig.label,
        description: combinedDesc,
        total: updatedTotal,
        newTotal: updatedTotal,
        formula: finalFormula,
      });
    });

    return summary;
  } finally {
    lock.releaseLock();
  }
}

function formatItemOnceForSheet(rawItem, amount, defaultActor) {
  let text = String(rawItem || "").trim();
  let actorCode = defaultActor;

  const actorMatch = text.match(/\s+(s|i)$/i);
  if (actorMatch) {
    actorCode = actorMatch[1].toLowerCase();
    text = text.replace(/\s+(s|i)$/i, "").trim();
  }

  text = text.replace(/\s+\d+(?:[.,]\d+)?\s*(?:rb|k|jt)?$/i, "").trim();

  const hargaLabel = formatHargaSingkat(amount);
  return `${text} ${hargaLabel} ${actorCode}`;
}

function formatHargaSingkat(amount) {
  const num = Number(amount) || 0;
  if (num >= 1000) {
    const rb = num / 1000;
    return `${Number.isInteger(rb) ? rb : rb.toString().replace(".", ",")}rb`;
  }
  return String(num);
}

// Cut-off Tanggal 25: Tgl 26 bulan ini s/d Tgl 25 bulan depan -> Tab Bulan Depan
function resolveSheetNameByCutoff25(isoDate) {
  const [year, month, day] = isoDate.split("-").map(Number);
  let targetMonth = month;
  let targetYear = year;

  if (day >= 26) {
    targetMonth += 1;
    if (targetMonth > 12) {
      targetMonth = 1;
      targetYear += 1;
    }
  }

  const shortMonths = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const shortYear = String(targetYear).slice(-2);
  return `${shortMonths[targetMonth - 1]} ${shortYear}`;
}

// Cari baris tanggal mulai dari baris A3
function findDateRow(sheet, targetIsoDate) {
  const lastRow = sheet.getLastRow();
  if (lastRow < SHEET_CONFIG.START_ROW) return -1;

  const numRows = lastRow - SHEET_CONFIG.START_ROW + 1;
  const range = sheet.getRange(
    SHEET_CONFIG.START_ROW,
    SHEET_CONFIG.DATE_COL,
    numRows,
    1,
  );
  const rawValues = range.getValues();
  const displayValues = range.getDisplayValues();
  const sheetTz = sheet.getParent().getSpreadsheetTimeZone();

  const [year, month, day] = targetIsoDate.split("-").map(Number);
  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const expectedText = `${day} ${monthNames[month - 1]} ${year}`;

  for (let i = 0; i < rawValues.length; i++) {
    const val = rawValues[i][0];
    const disp = String(displayValues[i][0] || "").trim();

    if (disp.includes(expectedText)) {
      return i + SHEET_CONFIG.START_ROW;
    }
    if (val instanceof Date && !isNaN(val.getTime())) {
      const formatted = Utilities.formatDate(val, sheetTz, "yyyy-MM-dd");
      if (formatted === targetIsoDate) {
        return i + SHEET_CONFIG.START_ROW;
      }
    }
  }
  return -1;
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON,
  );
}
