import assert from "node:assert/strict";
import { test } from "node:test";

import {
  firstMatchingRule,
  ruleMatches,
  toRuleSuggestion,
  type BankRule,
} from "../lib/cash/bank-rules";

function makeRule(overrides: Partial<BankRule> = {}): BankRule {
  return {
    id: "r1",
    name: "Цахилгаан",
    matchText: "УБЦТС",
    side: "any",
    minAmount: null,
    maxAmount: null,
    counterAccountNumber: "71000001",
    setCounterparty: null,
    setDescription: null,
    mode: "suggest",
    priority: 100,
    isActive: true,
    ...overrides,
  };
}

const expenseRow = {
  income: 0,
  expense: 145000,
  counterparty: "УБЦТС ХК",
  description: "8-р сарын цахилгааны төлбөр",
};

test("текст том/жижиг үсэг ялгахгүй, харилцагч+утга хоёуланд хайна", () => {
  assert.equal(ruleMatches(expenseRow, makeRule({ matchText: "убцтс" })), true);
  assert.equal(
    ruleMatches(expenseRow, makeRule({ matchText: "ЦАХИЛГААНЫ ТӨЛБӨР" })),
    true
  );
  assert.equal(
    ruleMatches(expenseRow, makeRule({ matchText: "интернет" })),
    false
  );
});

test("чиглэл ба дүнгийн муж шүүнэ; идэвхгүй дүрэм таарахгүй", () => {
  assert.equal(ruleMatches(expenseRow, makeRule({ side: "expense" })), true);
  assert.equal(ruleMatches(expenseRow, makeRule({ side: "income" })), false);
  // Дүнгийн хил: 145000 нь [145000, 145000]-д багтана (inclusive).
  assert.equal(
    ruleMatches(
      expenseRow,
      makeRule({ minAmount: 145000, maxAmount: 145000 })
    ),
    true
  );
  assert.equal(
    ruleMatches(expenseRow, makeRule({ minAmount: 145000.01 })),
    false
  );
  assert.equal(
    ruleMatches(expenseRow, makeRule({ maxAmount: 144999.99 })),
    false
  );
  assert.equal(ruleMatches(expenseRow, makeRule({ isActive: false })), false);
});

test("firstMatchingRule — priority бага нь түрүүлнэ, тэнцвэл нэрээр", () => {
  const generic = makeRule({ id: "g", name: "Ерөнхий", priority: 200 });
  const specific = makeRule({ id: "s", name: "Тусгай", priority: 50 });
  const sameB = makeRule({ id: "b", name: "Б дүрэм", priority: 50 });
  assert.equal(
    firstMatchingRule(expenseRow, [generic, specific])?.id,
    "s"
  );
  assert.equal(
    firstMatchingRule(expenseRow, [specific, sameB])?.id,
    "b"
  );
  assert.equal(
    firstMatchingRule(expenseRow, [makeRule({ matchText: "байхгүй" })]),
    null
  );
});

test("toRuleSuggestion — дүрмийн үйлдлүүд саналд бүрэн дамжина", () => {
  const rule = makeRule({
    mode: "auto",
    setCounterparty: "УБЦТС ТӨХК",
    setDescription: "Цахилгааны зардал",
  });
  const suggestion = toRuleSuggestion(rule);
  assert.equal(suggestion.kind, "rule");
  assert.equal(suggestion.confidence, "high");
  assert.equal(suggestion.mode, "auto");
  assert.equal(suggestion.counterAccountNumber, "71000001");
  assert.equal(suggestion.setCounterparty, "УБЦТС ТӨХК");
  assert.equal(suggestion.setDescription, "Цахилгааны зардал");
});
