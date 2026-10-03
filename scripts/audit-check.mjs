// `npm audit --audit-level=high`-ийн оронд — засвар ГАРААГҮЙ advisory-г ИЛ,
// ХУГАЦААТАЙ хасалтаар л зөвшөөрнө. Бусад high/critical бүгд CI-г унагана.
//
// Яагаад: 2026-10-03 braces (GHSA-vfj7-8cjw-p6xm, high) — БҮХ хувилбар эмзэг,
// засвартай хувилбар алга (3.0.3 хамгийн сүүлийнх). `npm audit` нь хасалт
// дэмждэггүй тул бүх PR-ийн CI улаан болсон. Хасалт `until` огноо өнгөрмөгц
// автоматаар хүчингүй болно — засвар гарсан эсэхийг дахин шалгахад хүргэнэ.
import { execFileSync } from "node:child_process";

/** advisory URL-ийн GHSA id → { until: YYYY-MM-DD, reason } */
const ALLOW = {
  "GHSA-vfj7-8cjw-p6xm": {
    until: "2026-11-03",
    reason: "braces stack-exhaustion DoS — засвартай хувилбар алга; зөвхөн build/CLI хэрэгслийн glob-д (shadcn, eslint — хэрэглэгчийн оролт хүрэхгүй)",
  },
};

const BLOCKING = new Set(["high", "critical"]);

let raw;
try {
  raw = execFileSync("npm", ["audit", "--json"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
} catch (error) {
  // npm audit эмзэг байдал олдвол exit 1 өгдөг — stdout-д JSON хэвээр
  raw = error.stdout;
}
const report = JSON.parse(raw);
const today = new Date().toISOString().slice(0, 10);

const advisories = new Map();
for (const vuln of Object.values(report.vulnerabilities ?? {})) {
  for (const via of vuln.via) {
    if (typeof via === "object" && BLOCKING.has(via.severity)) advisories.set(via.url, via);
  }
}

const blocking = [];
for (const [url, adv] of advisories) {
  const id = url.split("/").pop();
  const allow = ALLOW[id];
  if (allow && today <= allow.until) {
    console.log(`зөвшөөрсөн (${allow.until} хүртэл): ${id} ${adv.name} — ${allow.reason}`);
    continue;
  }
  blocking.push(`${adv.severity} ${adv.name} ${id}: ${adv.title}${allow ? ` (хасалтын хугацаа ${allow.until} дууссан)` : ""}`);
}

if (blocking.length) {
  console.error(`Хамаарлын аудит: ${blocking.length} high/critical\n- ${blocking.join("\n- ")}`);
  process.exit(1);
}
console.log("Хамаарлын аудит: high/critical алга (зөвшөөрсөн хасалтаас бусад)");
