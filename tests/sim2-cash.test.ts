// SIM2-005/011: кассын ЦЭВЭР туслахууд — нээлтийн журнал таних, засварт
// тэмдэг шилжүүлэх, нэг GL-ийн олон дансны тулгалт.
import test from "node:test";
import assert from "node:assert/strict";

import {
  carryCashAccountTags,
  cashOpeningAccountIdOf,
  isCashModuleVoucher,
} from "../lib/cash/gl-sync";
import { groupCashAccountsByGl } from "../lib/cash/reconciliation";

const ID = "3f0c1d2e-4b5a-4c6d-8e9f-0a1b2c3d4e5f";

test("нээлтийн журнал externalRef / тайлбарын тэмдгээр танигдана", () => {
  assert.equal(cashOpeningAccountIdOf({ externalRef: `cash-opening:${ID}` }), ID);
  assert.equal(cashOpeningAccountIdOf({ externalRef: `cash-opening:${ID}:2` }), ID);
  assert.equal(cashOpeningAccountIdOf({ description: `Нээлтийн үлдэгдэл — №2 [НЭЭЛТ:${ID}]` }), ID);
  assert.equal(cashOpeningAccountIdOf({ externalRef: "bank:123", description: "Орлого" }), null);
  // Тэмдэг алдагдсан (вэб засвар) ч нээлт гэж танигдана
  assert.equal(isCashModuleVoucher({ externalRef: `cash-opening:${ID}`, lines: [{ cashAccountId: null }] }), true);
  assert.equal(isCashModuleVoucher({ externalRef: null, lines: [{ cashAccountId: ID }] }), true);
  assert.equal(isCashModuleVoucher({ externalRef: null, description: "Гар журнал", lines: [{ cashAccountId: null }] }), false);
});

test("журнал засварт кассын тэмдэг үндсэн дансаар шилжинэ, хоёрдмол бол таамаглахгүй", () => {
  const code = (main: string) => `000.000000.${main}.00.00.00.00.0000.GL.000`;
  const map = carryCashAccountTags([
    { accountNumber: code("10000001"), cashAccountId: "a" },
    { accountNumber: code("41000001"), cashAccountId: null },
    { accountNumber: code("11000001"), cashAccountId: "b" },
    { accountNumber: code("11000001"), cashAccountId: "c" },
  ]);
  assert.equal(map.get("10000001"), "a");
  assert.equal(map.has("41000001"), false);
  assert.equal(map.has("11000001"), false, "b/c хоёрдмол");
});

test("SIM2-005: 10000001 дээрх 3 касс — Σ 5.65M = GL, данс тус бүр зөрүүгүй", () => {
  const groups = groupCashAccountsByGl(
    [
      { name: "Касс MNT", glAccountNumber: "10000001", expected: 4_200_000 },
      { name: "Касс дэлгүүр №1", glAccountNumber: "10000001", expected: 800_000 },
      { name: "Касс дэлгүүр №2", glAccountNumber: "10000001", expected: 650_000 },
      { name: "Хаан банк", glAccountNumber: "11000001", expected: 142_000_000 },
    ],
    new Map([["10000001", 5_650_000], ["11000001", 142_000_000]])
  );
  assert.equal(groups.length, 2);
  assert.deepEqual(
    groups.map((group) => [group.glAccountNumber, group.accounts.length, group.total, group.diff]),
    [["10000001", 3, 5_650_000, 0], ["11000001", 1, 142_000_000, 0]]
  );
  // Ханшгүй нээлттэй данс бүлгийг тодорхойгүй болгоно (зохиохгүй)
  const unknown = groupCashAccountsByGl(
    [{ glAccountNumber: "11000002", expected: null }, { glAccountNumber: "11000002", expected: 5 }],
    new Map()
  );
  assert.equal(unknown[0].total, null);
  assert.equal(unknown[0].diff, null);
});
