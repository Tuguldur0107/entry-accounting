#!/usr/bin/env node
// ТЕГ / ҮСХ-ын АЛБАН «Бүтээгдэхүүн, үйлчилгээний нэгдсэн ангилал» файлыг
// lib/ebarimt/classification-codes.json болгоно.
//
//   node scripts/build-ebarimt-classifications.mjs Angilal/БҮНА.xlsx
//   node scripts/build-ebarimt-classifications.mjs codes.csv
//   node scripts/build-ebarimt-classifications.mjs a.xlsx b.xlsx   (нийлүүлнэ)
//
// Баганыг НЭРЭЭР биш АГУУЛГААР танина (албан файлуудын толгой янз бүр):
//   • код   = 7 оронтой тоо хамгийн олон таарсан багана
//   • нэр   = тэр мөрүүдэд хамгийн их текст агуулсан өөр багана
// Код ЗОХИОХГҮЙ: 7 оронтой биш, нэргүй мөр алгасагдана; давхардсан кодоос
// эхнийх нь үлдэнэ. Үр дүнгийн тоо + жишээг хэвлэнэ — шалгаад commit хийнэ.

import { readFileSync, writeFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import ExcelJS from "exceljs";

const OUTPUT = resolve("lib/ebarimt/classification-codes.json");
const CODE_RE = /^\d{7}$/;

function cellText(value) {
  if (value == null) return "";
  if (typeof value === "object") {
    if ("richText" in value) return value.richText.map((part) => part.text).join("");
    if ("text" in value) return String(value.text);
    if ("result" in value) return String(value.result ?? "");
  }
  return String(value);
}

/** CSV-г энгийн байдлаар задлана (хашилттай талбар, таслал/цэгтэй таслал). */
function parseCsv(text) {
  const delimiter = (text.split("\n")[0].match(/;/g) ?? []).length > (text.split("\n")[0].match(/,/g) ?? []).length ? ";" : ",";
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

async function readMatrix(file) {
  const ext = extname(file).toLowerCase();
  if (ext === ".csv" || ext === ".txt") return [parseCsv(readFileSync(file, "utf8"))];
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(file);
  return workbook.worksheets.map((sheet) => {
    const rows = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const values = [];
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        values[col - 1] = cellText(cell.value).trim();
      });
      rows.push(values);
    });
    return rows;
  });
}

function extract(rows) {
  const width = Math.max(0, ...rows.map((row) => row.length));
  const codeHits = Array.from({ length: width }, (_, col) =>
    rows.filter((row) => CODE_RE.test((row[col] ?? "").replace(/\s/g, ""))).length
  );
  const codeCol = codeHits.indexOf(Math.max(...codeHits));
  if (codeCol < 0 || codeHits[codeCol] === 0) return [];
  const codeRows = rows.filter((row) => CODE_RE.test((row[codeCol] ?? "").replace(/\s/g, "")));
  const textScore = Array.from({ length: width }, (_, col) =>
    col === codeCol
      ? -1
      : codeRows.reduce((sum, row) => {
          const value = row[col] ?? "";
          return sum + (/[^\d\s.,-]/.test(value) ? value.length : 0);
        }, 0)
  );
  const nameCol = textScore.indexOf(Math.max(...textScore));
  return codeRows.map((row) => ({
    code: row[codeCol].replace(/\s/g, ""),
    name: (row[nameCol] ?? "").replace(/\s+/g, " ").trim(),
  }));
}

async function main() {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error("Хэрэглээ: node scripts/build-ebarimt-classifications.mjs <файл.xlsx|csv> [...]");
    process.exit(1);
  }
  const byCode = new Map();
  let skipped = 0;
  for (const file of files) {
    for (const rows of await readMatrix(file)) {
      for (const entry of extract(rows)) {
        if (!entry.name) {
          skipped += 1;
          continue;
        }
        if (!byCode.has(entry.code)) byCode.set(entry.code, entry);
      }
    }
  }
  const entries = [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
  if (entries.length === 0) {
    console.error("7 оронтой кодтой мөр олдсонгүй — файлаа шалгана уу. JSON өөрчлөгдсөнгүй.");
    process.exit(2);
  }
  writeFileSync(OUTPUT, JSON.stringify(entries, null, 0).replace(/},\{/g, "},\n{") + "\n");
  console.log(`✔ ${entries.length} код → ${OUTPUT}${skipped ? ` (нэргүй ${skipped} мөр алгасав)` : ""}`);
  for (const entry of entries.slice(0, 5)) console.log(`  ${entry.code}  ${entry.name}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
