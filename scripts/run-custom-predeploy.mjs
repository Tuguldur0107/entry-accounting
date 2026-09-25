// Харилцагчийн (fork) deploy-ийн өмнөх алхам — `custom/predeploy.mjs` байвал
// ажиллуулна, байхгүй бол чимээгүй алгасна.
//
// ЯАГААД: fork өөрийн DDL-ээ `package.json`-ийн `db:predeploy` мөрт нэмдэг
// байв. Core тэр мөрийг шинэчлэх бүрд sync PR conflict болж, 2026-09-25-нд
// гараар шийдсэн мөр устаж smartgps-ийн deploy EJSONPARSE-ээр унасан. Одоо
// fork `package.json`-д ГАР ХҮРЭХГҮЙ — энэ файлыг л `custom/`-д бичнэ.
//
// Байрлал: `apply-pending-ddl.mjs`-ийн ДАРАА, `drizzle-kit push`-ийн ӨМНӨ —
// push-ийн интерактив асуултаас (хүснэгт/багана нэр солих) сэргийлэх DDL
// (archive руу зөөх г.м.) энд байх ёстой. Алдаа гарвал exit 1 → deploy зогсоно
// (хагас схемтэй апп асахаас дээр).

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const file = resolve("custom/predeploy.mjs");

if (!existsSync(file)) {
  console.log("custom-predeploy: custom/predeploy.mjs алга — алгаслаа");
} else {
  console.log("custom-predeploy: custom/predeploy.mjs ажиллуулж байна");
  await import(pathToFileURL(file).href);
}
