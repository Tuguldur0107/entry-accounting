// AG Grid-ийн МӨРИЙН ӨНДРИЙН зөрчлийг барих статик тест.
//
// ШАЛТГААН (2026-09-19, бодит алдаа): журналын жагсаалтад `getRowHeight`
// (журналын мөрийн тоогоор) БА баганын `autoHeight: true` ХОЁУЛАА байсан.
// AG Grid эхлээд getRowHeight-ээр мөрүүдээ байрлуулаад, дараа нь autoHeight
// баганыг хэмжиж мөрийн өндрийг ДАХИН тааруулдаг — рендерийн дараа мөрүүд
// босоо чиглэлд ШИЛЖИНЭ. Хулганы доорх мөр өөр болсон тул хэрэглэгч журнал
// дээр дархад ХАЖУУГИЙН журналын панель нээгдэж байв.
//
// Дүрэм: нэг grid-д мөрийн өндрийг НЭГ л эзэн тогтооно —
//   • мөрүүдийг өөрөө өрдөг grid (журнал) → `getRowHeight`
//   • чөлөөт урт текст  → баганын `autoHeight`
// Хоёуланг нэг файлд хамт бичихийг ХОРИГЛОНО.

import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["components", "app"];

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsxFiles(full));
    else if (full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

test("нэг grid файлд getRowHeight ба autoHeight ХАМТ байхгүй", () => {
  const offenders: string[] = [];
  for (const root of ROOTS) {
    for (const file of tsxFiles(root)) {
      const source = readFileSync(file, "utf8");
      if (!source.includes("getRowHeight")) continue;
      // Тайлбар доторх дурдлагыг тооцохгүй — зөвхөн БОДИТ багана тохиргоо.
      const hasAutoHeight = source
        .split("\n")
        .some(
          (line) =>
            /autoHeight\s*:\s*true/.test(line) && !line.trim().startsWith("//")
        );
      if (hasAutoHeight) offenders.push(file);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `Мөрийн өндрийн зөрчил — эдгээр файлд getRowHeight ба autoHeight хамт байна:\n${offenders.join("\n")}`
  );
});
