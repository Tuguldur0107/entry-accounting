import assert from "node:assert/strict";
import test from "node:test";

import { stornoFromMirror, stornoOf } from "../lib/gl/storno";

test("stornoOf — тал хэвээр, дүн сөрөг; тэнцэл хадгалагдана", () => {
  const lines = [
    { debit: "4200", credit: "0" },
    { debit: "0", credit: "3818.18" },
    { debit: "0", credit: "381.82" },
  ];
  const storno = lines.map(stornoOf);
  assert.deepEqual(storno[0], { debit: "-4200", credit: "0" });
  assert.deepEqual(storno[1], { debit: "0", credit: "-3818.18" });
  const sum = (key: "debit" | "credit") => storno.reduce((s, l) => s + Number(l[key]), 0);
  assert.ok(Math.abs(sum("debit") - sum("credit")) < 0.005);
  assert.deepEqual(stornoOf({ debit: 10, credit: 0, debitFc: "3", creditFc: 0 }), {
    debit: "-10",
    credit: "0",
    debitFc: "-3",
    creditFc: "0",
  });
  assert.throws(() => stornoOf({ debit: "abc", credit: 0 }));
});

test("stornoFromMirror — «Дт Орлого X» ≡ «Кт Орлого −X»", () => {
  assert.deepEqual(stornoFromMirror({ accountNumber: "51100000", debit: "4200", credit: "0" }), {
    accountNumber: "51100000",
    debit: "0",
    credit: "-4200",
  });
  assert.deepEqual(stornoFromMirror({ accountNumber: "13110000", debit: "0", credit: "4200" }), {
    accountNumber: "13110000",
    debit: "-4200",
    credit: "0",
  });
});

test("буцаалтыг Дт/Кт сольж бичихгүй — lib-д `debit: x.credit` хэлбэр үлдээгүй", async () => {
  const { readdirSync, readFileSync, statSync } = await import("node:fs");
  const { join } = await import("node:path");
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? walk(path) : path.endsWith(".ts") ? [path] : [];
    });
  const offenders = walk("lib").filter((file) =>
    /\bdebit:\s*(line|l|row)\.credit\s*,\s*\n?\s*credit:\s*(line|l|row)\.debit/.test(readFileSync(file, "utf8"))
  );
  assert.deepEqual(offenders, [], "stornoOf (lib/gl/storno.ts) ашиглана уу");
});
