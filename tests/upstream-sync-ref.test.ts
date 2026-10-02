// Fork-ийн upstream sync (`.github/workflows/upstream-sync.yml`) ref заагаагүй үед
// (Даваагийн cron, хоосон dispatch) core-ийн `main` биш ХАМГИЙН СҮҮЛИЙН RELEASE TAG-ийг
// татна. 2026-10-02: cron нь `main`-ийг татдаг байсан тул fork-ууд release хийгдээгүй,
// CHANGELOG-гүй commit-уудыг (#246–#249) авах байсан.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const workflow = readFileSync(".github/workflows/upstream-sync.yml", "utf8");

test("ref-гүй sync main руу унахгүй — сүүлийн release tag-ийг тодорхойлно", () => {
  assert.doesNotMatch(workflow, /inputs\.ref \|\| 'main'/, "ref-гүй үед main руу шууд унаж байна");
  assert.doesNotMatch(workflow, /default: "main"/, "dispatch-ийн анхдагч ref main хэвээр");
  assert.match(workflow, /git ls-remote --tags --refs upstream 'v\*\.\*\.\*'/);
  assert.match(workflow, /sort -V \| tail -n 1/);
  // Tag тодорхойлолт fetch-ээс ӨМНӨ
  assert.ok(
    workflow.indexOf("git ls-remote --tags --refs upstream") < workflow.indexOf('git fetch upstream --tags "$REF"'),
    "tag тодорхойлолт fetch-ийн дараа байна"
  );
});

test("хувилбарын эрэмбэ semver-ээр (v1.10.0 > v1.9.0), лексик биш", () => {
  const tags = ["refs/tags/v1.9.0", "refs/tags/v1.10.0", "refs/tags/v1.7.0", "refs/tags/v1.5.2"]
    .map((ref) => `abc123\t${ref}`)
    .join("\n");
  const latest = execFileSync("sh", ["-c", "sed 's#.*refs/tags/##' | sort -V | tail -n 1"], { input: tags })
    .toString()
    .trim();
  assert.equal(latest, "v1.10.0");
});
