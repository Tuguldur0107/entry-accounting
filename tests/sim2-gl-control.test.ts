// SIM2-038 (хяналтын данс) ба SIM2-037 (ҮХ ↔ GL) — ЦЭВЭР туслахууд.
import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_CONTROL_ACCOUNTS,
  controlAccountHits,
  isGuardExemptRef,
  normalizeGuardMode,
} from "../lib/gl/control-accounts";
import { faExpectedGl } from "../lib/fa/reconcile";

const code = (main: string) => `000.000000.${main}.00.00.00.00.0000.GL.000`;

test("SIM2-038: 13110000 / 31000001 гар журнал илэрнэ, нээлт чөлөөтэй", () => {
  const control = new Set<string>(DEFAULT_CONTROL_ACCOUNTS);
  // B: суутган татварын reclass Dr 31000001 250k / Cr 31430000
  assert.deepEqual(controlAccountHits([code("31000001"), code("31430000")], control), ["31000001"]);
  // найдваргүй авлага хасах Dr 71000000 5.5M / Cr 13110000
  assert.deepEqual(controlAccountHits([code("71000000"), code("13110000")], control), ["13110000"]);
  assert.deepEqual(controlAccountHits([code("72100000"), code("11000001")], control), []);
  assert.equal(isGuardExemptRef("opening-balance:2024-12-31"), true);
  assert.equal(isGuardExemptRef("cash-opening:abc"), true);
  assert.equal(isGuardExemptRef("bank:123"), false);
  assert.equal(normalizeGuardMode("block"), "block");
  assert.equal(normalizeGuardMode(null), "warn");
  assert.equal(normalizeGuardMode("anything"), "warn");
});

test("SIM2-037: картын өртөг/хуримт. элэгдэл → хүлээгдэх GL", () => {
  const base = {
    assetAccountNumber: "20000001",
    accumDepAccountNumber: "20000002",
    disposalDate: null,
    openingAccumulated: 0,
    sourceVoucherPosted: false,
  };
  const expected = faExpectedGl(
    [
      // B 2026-05: 24M-ийн хөрөнгө (идэвхтэй)
      { ...base, id: "a", status: "active", acquisitionDate: "2026-05-10", cost: 24_000_000 },
      // Нээлтийн хөрөнгө — 1.2M хуримт. элэгдэлтэй
      { ...base, id: "b", status: "active", acquisitionDate: "2020-01-01", cost: 6_000_000, openingAccumulated: 1_200_000 },
      // АП-аар орсон ноорог карт (GL-д аль хэдийн) — тоологдоно
      { ...base, id: "c", status: "draft", acquisitionDate: "2026-05-15", cost: 500_000, sourceVoucherPosted: true },
      // Гараар үүсгэсэн ноорог — GL-д байхгүй
      { ...base, id: "d", status: "draft", acquisitionDate: "2026-05-16", cost: 700_000 },
      // asOf-оос өмнө данснаас хассан — тоологдохгүй
      { ...base, id: "e", status: "disposed", acquisitionDate: "2021-01-01", disposalDate: "2026-04-30", cost: 900_000 },
      // asOf-оос хойш хассан — тоологдоно
      { ...base, id: "f", status: "disposed", acquisitionDate: "2021-01-01", disposalDate: "2026-06-30", cost: 800_000 },
    ],
    [
      { assetId: "a", periodMonth: "2026-05", amount: 400_000, status: "posted" },
      { assetId: "b", periodMonth: "2026-05", amount: 50_000, status: "posted" },
      { assetId: "b", periodMonth: "2026-04", amount: 50_000, status: "reversed" },
      { assetId: "a", periodMonth: "2026-06", amount: 400_000, status: "posted" },
    ],
    "2026-05-31"
  );
  assert.equal(expected.get("20000001"), 24_000_000 + 6_000_000 + 500_000 + 800_000);
  assert.equal(expected.get("20000002"), -(400_000 + 1_200_000 + 50_000));
});
