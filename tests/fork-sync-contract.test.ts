// Fork ↔ core sync-ийн гэрээ — харилцагчийн repo-д core файл засах
// шаардлагагүй байх, merge-ийн гараар шийдсэн conflict үлдэгдэл CI-д баригдах.
//
// 2026-09-25: smartgps-ийн v1.6.0 sync PR-ын conflict-ийг гараар шийдэхэд
// package.json-ийн db:predeploy мөр устаж JSON эвдэрсэн → Railway build унасан.
// Шалтгаан нь fork өөрийн DDL-ээ package.json-д нэмдэг байсан явдал —
// одоо `custom/predeploy.mjs` (scripts/run-custom-predeploy.mjs) замаар.
//
// DATABASE_URL ШААРДАХГҮЙ.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const RUNNER = resolve("scripts/run-custom-predeploy.mjs");

function runIn(dir: string) {
  return spawnSync(process.execPath, [RUNNER], { cwd: dir, encoding: "utf8" });
}

test("db:predeploy: custom hook нь DDL-ийн ДАРАА, push-ийн ӨМНӨ", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const steps = String(pkg.scripts["db:predeploy"]).split("&&").map((s) => s.trim());
  const ddl = steps.indexOf("node scripts/apply-pending-ddl.mjs");
  const hook = steps.indexOf("node scripts/run-custom-predeploy.mjs");
  const push = steps.findIndex((s) => s.startsWith("drizzle-kit push"));
  assert.ok(ddl >= 0 && hook >= 0 && push >= 0, steps.join(" | "));
  assert.ok(ddl < hook && hook < push, "дараалал: apply-pending-ddl → custom → push");
});

test("custom/predeploy.mjs байхгүй бол чимээгүй алгасна", () => {
  const dir = mkdtempSync(join(tmpdir(), "custom-predeploy-"));
  try {
    const run = runIn(dir);
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /алга — алгаслаа/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("custom/predeploy.mjs байвал ажиллана, алдаа нь deploy-г зогсооно", () => {
  const dir = mkdtempSync(join(tmpdir(), "custom-predeploy-"));
  try {
    mkdirSync(join(dir, "custom"));
    const hook = join(dir, "custom", "predeploy.mjs");
    writeFileSync(hook, 'import { writeFileSync } from "node:fs";\nwriteFileSync("ran.txt", "ok");\n');
    const ok = runIn(dir);
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(readFileSync(join(dir, "ran.txt"), "utf8"), "ok");

    writeFileSync(hook, 'throw new Error("fork DDL унасан");\n');
    const failed = runIn(dir);
    assert.notEqual(failed.status, 0, "алдаатай hook deploy-г зогсоох ёстой");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("git-д бүртгэлтэй файлд merge conflict-ийн тэмдэг үлдээгүй", () => {
  let files: string[];
  try {
    files = execFileSync("git", ["ls-files"], { encoding: "utf8" }).split("\n").filter(Boolean);
  } catch {
    return; // git-гүй орчин (tarball) — алгасна
  }
  const textLike = /\.(tsx?|mjs|js|json|md|sql|ya?ml|css|toml|txt)$/;
  const offenders: string[] = [];
  for (const file of files.filter((f) => textLike.test(f))) {
    let source: string;
    try {
      source = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    if (/^(<<<<<<< |>>>>>>> )/m.test(source)) offenders.push(file);
  }
  assert.deepEqual(offenders, [], `conflict-ийн тэмдэг үлдсэн: ${offenders.join(", ")}`);
});
