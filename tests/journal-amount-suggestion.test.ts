import assert from "node:assert/strict";
import test from "node:test";

import { applyJournalAmountSuggestion } from "../lib/grid/journal-amount-suggestion";

const rows = () => [
  { id: "1", debit: 0, credit: 0, account: "", description: "" },
  { id: "2", debit: 0, credit: 0, account: "", description: "" },
];

test("debit suggests the same credit amount on the following row", () => {
  const result = applyJournalAmountSuggestion(rows(), "1", "debit", 1250);

  assert.equal(result[0].debit, 1250);
  assert.equal(result[0].credit, 0);
  assert.equal(result[1].debit, 0);
  assert.equal(result[1].credit, 1250);
});

test("credit suggests the same debit amount on the following row", () => {
  const result = applyJournalAmountSuggestion(rows(), "1", "credit", 800);

  assert.equal(result[0].debit, 0);
  assert.equal(result[0].credit, 800);
  assert.equal(result[1].debit, 800);
  assert.equal(result[1].credit, 0);
});

test("an existing amount on the following row is not overwritten", () => {
  const initial = rows();
  initial[1].credit = 300;

  const result = applyJournalAmountSuggestion(initial, "1", "debit", 900);

  assert.equal(result[1].credit, 300);
  assert.equal(result[1].debit, 0);
});

test("editing the amount keeps debit and credit mutually exclusive", () => {
  const initial = rows();
  initial[0].credit = 400;

  const result = applyJournalAmountSuggestion(initial, "1", "debit", 500);

  assert.equal(result[0].debit, 500);
  assert.equal(result[0].credit, 0);
});
