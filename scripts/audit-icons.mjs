#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const strict = process.argv.includes("--strict");
const roots = ["app", "components", "lib"];
const files = execFileSync(
  "rg",
  [
    "--files",
    ...roots,
    "-g",
    "*.tsx",
    "-g",
    "*.ts",
    "-g",
    "!**/.next/**",
    "-g",
    "!**/node_modules/**",
  ],
  { encoding: "utf8" }
)
  .trim()
  .split("\n")
  .filter(Boolean);

const registryFile = "components/ui/icon-registry.ts";
const illustrationAllowlist = new Set([
  "components/auth/brand.tsx",
  "components/auth/LedgerIllustration.tsx",
]);

const directLucide = [];
const rawSvg = [];
const textGlyph = [];
const glyphPattern = /^[×✕⌄↩]$/u;

for (const file of files) {
  const source = readFileSync(file, "utf8");
  const lines = source.split("\n");

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    if (file !== registryFile && line.includes("lucide-react")) {
      directLucide.push(`${file}:${lineNumber}`);
    }
    const inlineIllustration =
      line.includes("<svg") &&
      line.includes("position:") &&
      line.includes("absolute");
    if (
      !illustrationAllowlist.has(file) &&
      line.includes("<svg") &&
      !inlineIllustration
    ) {
      rawSvg.push(`${file}:${lineNumber}`);
    }
    if (file.endsWith(".tsx") && glyphPattern.test(line.trim())) {
      textGlyph.push(`${file}:${lineNumber}`);
    }
  });
}

console.log("Entry Icon Kit audit");
console.log(`Direct lucide imports outside registry: ${directLucide.length}`);
console.log(`Raw SVG candidates outside illustration allowlist: ${rawSvg.length}`);
console.log(`Text-glyph candidates: ${textGlyph.length}`);

for (const [label, rows] of [
  ["Direct imports", directLucide],
  ["Raw SVG", rawSvg],
  ["Text glyph", textGlyph],
]) {
  if (!rows.length) continue;
  console.log(`\n${label}`);
  rows.forEach((row) => console.log(`- ${row}`));
}

if (strict && (directLucide.length || rawSvg.length || textGlyph.length)) {
  process.exitCode = 1;
}
