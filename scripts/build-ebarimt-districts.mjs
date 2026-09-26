#!/usr/bin/env node
// ТЕГ-ийн АЛБАН дүүрэг/хорооны кодын лавлахыг lib/ebarimt/district-codes.json болгоно.
//
//   node scripts/build-ebarimt-districts.mjs "DISTRICT CODE.txt"
//
// ЭХ = PosAPI 3.0 мерчантын багц (`0. PROD/DISTRICT CODE.txt`) — ТЕГ-ийн
// `getBranchInfo` хариу: { msg, status, data: [{ branchCode, branchName,
// subBranchCode, subBranchName }] }. eBarimt-ийн `districtCode` = branchCode (2
// орон) + subBranchCode (2 орон) — ж: Баянзүрх 3-р хороо = "24" + "03" = "2403".
// Код ЗОХИОХГҮЙ: 2+2 оронтой биш, нэргүй мөр алгасагдана; давхардлаас эхнийх нь.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUTPUT = resolve("lib/ebarimt/district-codes.json");

const input = process.argv[2];
if (!input) {
  console.error('Хэрэглээ: node scripts/build-ebarimt-districts.mjs "DISTRICT CODE.txt"');
  process.exit(1);
}

const json = JSON.parse(readFileSync(input, "utf8"));
const rows = Array.isArray(json) ? json : json?.data;
if (!Array.isArray(rows)) {
  console.error("getBranchInfo хэлбэрийн JSON биш ({ data: [...] })");
  process.exit(1);
}

const seen = new Set();
const out = [];
let skipped = 0;
for (const row of rows) {
  const branch = String(row?.branchCode ?? "").trim();
  const sub = String(row?.subBranchCode ?? "").trim();
  const district = String(row?.branchName ?? "").trim();
  const khoroo = String(row?.subBranchName ?? "").trim();
  if (!/^\d{2}$/.test(branch) || !/^\d{2}$/.test(sub) || !district || !khoroo) {
    skipped += 1;
    continue;
  }
  const code = branch + sub;
  if (seen.has(code)) continue;
  seen.add(code);
  out.push({ code, district, khoroo });
}
out.sort((a, b) => a.code.localeCompare(b.code));

writeFileSync(OUTPUT, "[" + out.map((entry) => JSON.stringify(entry)).join(",\n") + "]\n");
console.log(`${out.length} код → ${OUTPUT} (алгассан: ${skipped})`);
for (const sample of out.filter((e) => ["2403", "3505"].includes(e.code))) {
  console.log(`  ${sample.code} ${sample.district} · ${sample.khoroo}`);
}
