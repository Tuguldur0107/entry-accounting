// Тооцоо нийлсэн актын ЦЭВЭР логик (lib/arap/statement.ts): тэмдэг, эхний
// үлдэгдэл, гүйлгээ, эцсийн үлдэгдэл, дүгнэлтийн текст.

import assert from "node:assert/strict";
import test from "node:test";

import { buildStatement, statementConclusion, statementDocumentSign } from "../lib/arap/statement";

test("баримтын тэмдэг — авлага +, өглөг −", () => {
  assert.equal(statementDocumentSign("ar_invoice"), 1);
  assert.equal(statementDocumentSign("ar_credit_note"), -1);
  assert.equal(statementDocumentSign("ap_bill"), -1);
  assert.equal(statementDocumentSign("ap_debit_note"), 1);
});

test("эхний үлдэгдэл, гүйлгээ, эцсийн үлдэгдэл", () => {
  const statement = buildStatement(
    [
      { date: "2026-08-10", reference: "AR-1", description: "Нэхэмжлэх", amount: 1_000_000, order: 0 },
      { date: "2026-08-20", reference: "CM-1", description: "Төлбөр", amount: -400_000, order: 1 },
      { date: "2026-09-05", reference: "AR-2", description: "Нэхэмжлэх", amount: 500_000, order: 0 },
      { date: "2026-09-05", reference: "CM-2", description: "Төлбөр", amount: -600_000, order: 1 },
      { date: "2026-09-12", reference: "AP-1", description: "Худалдан авалт", amount: -150_000, order: 0 },
      { date: "2026-10-01", reference: "AR-3", description: "Дараа сар", amount: 999, order: 0 },
      { date: "2026-09-15", reference: "X", description: "0", amount: 0, order: 0 },
    ],
    "2026-09-01",
    "2026-09-30"
  );
  assert.equal(statement.opening, 600_000);
  assert.deepEqual(
    statement.rows.map((row) => [row.reference, row.debit, row.credit, row.balance]),
    [
      ["AR-2", 500_000, 0, 1_100_000],
      ["CM-2", 0, 600_000, 500_000],
      ["AP-1", 0, 150_000, 350_000],
    ]
  );
  assert.deepEqual([statement.totalDebit, statement.totalCredit, statement.closing], [500_000, 750_000, 350_000]);
  const empty = buildStatement([{ date: "2026-01-01", reference: "AR-0", description: "", amount: 250, order: 0 }], "2026-09-01", "2026-09-30");
  assert.deepEqual([empty.opening, empty.rows.length, empty.closing], [250, 0, 250]);
});

test("дүгнэлт", () => {
  assert.match(statementConclusion(350_000, "2026-09-30", "Entry ХХК", "Бат ХХК"), /Бат ХХК нь Entry ХХК-д 350,000\.00₮ төлөх/);
  assert.match(statementConclusion(-20_000, "2026-09-30", "Entry ХХК", "Бат ХХК"), /Entry ХХК нь Бат ХХК-д 20,000\.00₮ төлөх/);
  assert.match(statementConclusion(0.001, "2026-09-30", "Entry ХХК", "Бат ХХК"), /тооцоо дууссан/);
});
