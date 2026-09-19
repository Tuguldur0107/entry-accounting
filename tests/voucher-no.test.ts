import { test } from "node:test";
import assert from "node:assert/strict";

import {
  JOURNAL_MODULE_CODES,
  formatVoucherNo,
  moduleOfVoucherNo,
  nextVoucherNo,
  nextVoucherNos,
  parseVoucherNo,
  voucherNoScope,
} from "../lib/gl/voucher-no";

// ─── Цэвэр хэсэг ─────────────────────────────────────────────────────────────

test("scope нь модулийн код + огнооны жил", () => {
  assert.equal(voucherNoScope("gl", "2026-09-19"), "GL-26");
  assert.equal(voucherNoScope("cash", "2026-01-01"), "CM-26");
  assert.equal(voucherNoScope("vat", "2027-12-31"), "VAT-27");
});

test("гажиг огноонд ШИДНЭ — дугаар зохиохгүй", () => {
  assert.throws(() => voucherNoScope("gl", ""), /огноо буруу/);
  assert.throws(() => voucherNoScope("gl", "19/09/2026"), /огноо буруу/);
});

test("дугаар 6 оронгоор 0-дуулна", () => {
  assert.equal(formatVoucherNo("GL-26", 1), "GL-26-000001");
  assert.equal(formatVoucherNo("COST-26", 42), "COST-26-000042");
  assert.equal(formatVoucherNo("GL-26", 1234567), "GL-26-1234567");
});

test("дараалал 1-ээс бага бол ШИДНЭ", () => {
  assert.throws(() => formatVoucherNo("GL-26", 0), /дараалал буруу/);
  assert.throws(() => formatVoucherNo("GL-26", 1.5), /дараалал буруу/);
});

test("дугаарыг буцааж задална", () => {
  assert.deepEqual(parseVoucherNo("CM-26-000012"), {
    module: "cash",
    year: "26",
    seq: 12,
  });
  assert.deepEqual(parseVoucherNo("PROC-27-000001"), {
    module: "proc",
    year: "27",
    seq: 1,
  });
});

test("танихгүй дугаарт null — таамаглахгүй", () => {
  assert.equal(parseVoucherNo(null), null);
  assert.equal(parseVoucherNo(""), null);
  assert.equal(parseVoucherNo("ZZZ-26-000001"), null, "байхгүй модуль");
  assert.equal(parseVoucherNo("GL-2026-000001"), null, "жил 4 оронтой");
  assert.equal(parseVoucherNo("a1adc0e8"), null, "хуучин UUID хэлтэрхий");
});

test("буцаалт эх журналынхаа модулийг өвлөнө", () => {
  assert.equal(moduleOfVoucherNo("CM-26-000004", "gl"), "cash");
  assert.equal(moduleOfVoucherNo("FX-26-000001", "cash"), "fx");
  // Дугааргүй (энэ багана нэмэгдэхээс өмнөх) эх журналд fallback.
  assert.equal(moduleOfVoucherNo(null, "fa"), "fa");
  assert.equal(moduleOfVoucherNo("гажиг", "ar"), "ar");
});

test("модулийн кодууд давхардахгүй", () => {
  const codes = Object.values(JOURNAL_MODULE_CODES);
  assert.equal(new Set(codes).size, codes.length);
  for (const code of codes) assert.match(code, /^[A-Z]{2,4}$/);
});

// ─── DB давхарга (тоолуурыг хуурамчаар) ──────────────────────────────────────

/**
 * `insert … on conflict do update set value = value + n returning value`-ийг
 * дуурайна: scope бүрд тоолуур барьж, нэмэгдсэн ДАРАА-ийн утгыг буцаана.
 */
function fakeTx() {
  const counters = new Map<string, number>();
  const calls: string[] = [];
  return {
    counters,
    calls,
    execute: async (query: unknown) => {
      // drizzle-ийн `sql` template нь queryChunks дотор SQL хэлтэрхий
      // (StringChunk, объект) ба параметрүүдийг (энгийн утга) ээлжлүүлнэ —
      // энгийн утгуудыг нь шүүвэл [orgId, scope, count, count] гарна.
      const chunks =
        (query as { queryChunks?: unknown[] }).queryChunks ?? [];
      const params = chunks.filter(
        (chunk) => typeof chunk === "string" || typeof chunk === "number"
      );
      const [, scope, count] = params as [string, string, number];
      calls.push(scope);
      const next = (counters.get(scope) ?? 0) + Number(count);
      counters.set(scope, next);
      return [{ value: next }];
    },
  };
}

test("дараалсан дуудлага 1-ээс өсөнө", async () => {
  const tx = fakeTx();
  assert.equal(await nextVoucherNo(tx, "org", "gl", "2026-09-19"), "GL-26-000001");
  assert.equal(await nextVoucherNo(tx, "org", "gl", "2026-09-20"), "GL-26-000002");
  assert.equal(await nextVoucherNo(tx, "org", "gl", "2026-12-31"), "GL-26-000003");
});

test("модуль бүр ӨӨРИЙН тоолууртай", async () => {
  const tx = fakeTx();
  assert.equal(await nextVoucherNo(tx, "org", "gl", "2026-09-19"), "GL-26-000001");
  assert.equal(await nextVoucherNo(tx, "org", "cash", "2026-09-19"), "CM-26-000001");
  assert.equal(await nextVoucherNo(tx, "org", "gl", "2026-09-19"), "GL-26-000002");
});

test("жил солигдоход 1-ээс эхэлнэ", async () => {
  const tx = fakeTx();
  assert.equal(await nextVoucherNo(tx, "org", "gl", "2026-12-31"), "GL-26-000001");
  assert.equal(await nextVoucherNo(tx, "org", "gl", "2027-01-01"), "GL-27-000001");
  assert.equal(await nextVoucherNo(tx, "org", "gl", "2026-12-31"), "GL-26-000002");
});

test("багц нь scope бүрд НЭГ л хүсэлт явуулна", async () => {
  const tx = fakeTx();
  const nos = await nextVoucherNos(tx, "org", "cash", [
    "2026-09-19",
    "2026-09-20",
    "2027-01-04",
    "2026-09-21",
  ]);
  assert.deepEqual(nos, [
    "CM-26-000001",
    "CM-26-000002",
    "CM-27-000001",
    "CM-26-000003",
  ]);
  assert.deepEqual(tx.calls, ["CM-26", "CM-27"], "scope бүрд нэг хүсэлт");
});

test("багцын дараа ганцаарчилсан дуудлага үргэлжилнэ", async () => {
  const tx = fakeTx();
  await nextVoucherNos(tx, "org", "gl", ["2026-09-19", "2026-09-19"]);
  assert.equal(await nextVoucherNo(tx, "org", "gl", "2026-09-19"), "GL-26-000003");
});

test("хоосон багц хүсэлт явуулахгүй", async () => {
  const tx = fakeTx();
  assert.deepEqual(await nextVoucherNos(tx, "org", "gl", []), []);
  assert.deepEqual(tx.calls, []);
});
