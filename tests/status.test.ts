import test from "node:test";
import assert from "node:assert/strict";

import { countByStatus, DOCUMENT_STATUS, statusMeta } from "../lib/status";

test("B1: гол 3 төлөв өнгө, дүрс, ХЭЛБЭРЭЭРЭЭ ялгарна (өнгө ялгадаггүй хүнд)", () => {
  const core = ["posted", "draft", "reversed"].map((status) => statusMeta(status));
  assert.equal(new Set(core.map((meta) => meta.tone)).size, 3);
  assert.equal(new Set(core.map((meta) => meta.icon)).size, 3);
  assert.equal(new Set(core.map((meta) => meta.shape)).size, 3);
  assert.equal(statusMeta("draft").shape, "dashed");
});

test("B1: шошго монгол, «сторно» үгүй; үл мэдэгдэх төлөв хоосон биш", () => {
  for (const meta of Object.values(DOCUMENT_STATUS)) {
    assert.match(meta.label, /^[А-ЯЁӨҮа-яёөү ]+$/u);
    assert.doesNotMatch(meta.label.toLowerCase(), /сторно/);
  }
  assert.equal(statusMeta("weird").label, "weird");
  assert.equal(statusMeta(null).label, "—");
});

test("B1: chip-ийн тоолол бүртгэлийн дарааллаар", () => {
  const rows = ["draft", "posted", "posted", "reversed", "posted"].map((status) => ({ status }));
  assert.deepEqual(countByStatus(rows, (row) => row.status), [
    { status: "posted", count: 3 },
    { status: "draft", count: 1 },
    { status: "reversed", count: 1 },
  ]);
});

test("Аудит: POS борлуулалтын төлөв нэгдсэн бүртгэлд, нэр нь POS-ынхтой ижил", async () => {
  const { SALE_STATUS_LABELS } = await import("../lib/pos/constants");
  for (const [status, label] of Object.entries(SALE_STATUS_LABELS))
    assert.equal(statusMeta(status).label, label, status);
  // буцаасан нь буцаагдсантай ижил хэлбэр (зураастай)
  assert.equal(statusMeta("returned").shape, "struck");
});
