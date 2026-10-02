// preDeploy-ийн eBarimt нөхөлтүүд (scripts/apply-pending-ddl.mjs) drizzle push-ээс ӨМНӨ
// ажилладаг. Тэдний уншдаг багана push-ээр л үүсдэг байвал хувилбар алгассан fork
// (2026-10-02 SmartGPS v1.6 → v1.7) дээр «column does not exist» гэж унаж, хуучин
// мөрийн ТЕГ-ийн дүн хоосон үлддэг. Энэ тест: нөхөлтийн уншдаг багана бүр нөхөлтөөс
// ӨМНӨ `add column if not exists`-ээр нэмэгдэнэ.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const ddl = readFileSync("scripts/apply-pending-ddl.mjs", "utf8");

function addColumnIndex(table: string, column: string): number {
  return ddl.indexOf(`["${table}", "${column}",`);
}

test("eBarimt нөхөлтийн уншдаг багана нөхөлтөөс ӨМНӨ нэмэгдэнэ", () => {
  const firstBackfill = ddl.indexOf("ebarimt_total нөхөлт (sent)");
  assert.ok(firstBackfill > 0, "нөхөлт олдсонгүй — тест эвдэрсэн");
  for (const [table, column] of [
    ["pos_sales", "city_tax_amount"],
    ["pos_ebarimt_submissions", "arap_document_id"],
  ]) {
    const at = addColumnIndex(table, column);
    assert.ok(at > 0, `${table}.${column} add column жагсаалтад алга`);
    assert.ok(at < firstBackfill, `${table}.${column} нөхөлтөөс ХОЙШ нэмэгдэж байна`);
  }
});

test("нэмэлт баганын төрөл schema.ts-тэй ижил (push-д diff үлдэхгүй)", () => {
  const schema = readFileSync("lib/db/schema.ts", "utf8");
  assert.match(ddl, /\["pos_sales", "city_tax_amount", "numeric\(18, 2\) not null default 0"\]/);
  assert.match(schema, /cityTaxAmount: numeric\("city_tax_amount", \{ precision: 18, scale: 2 \}\)\.notNull\(\)\.default\("0"\)/);
  assert.match(ddl, /\["pos_ebarimt_submissions", "arap_document_id", "uuid"\]/);
  assert.match(schema, /arapDocumentId: uuid\("arap_document_id"\)/);
});
