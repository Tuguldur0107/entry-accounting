// Мэдлэгийн сангийн эх сурвалж (фаз 2): хувийн repo-гийн tarball задлах,
// бүрэн байдлын хамгаалалт (санг хоослохгүй), repo нэрийн шалгалт.
import assert from "node:assert/strict";
import test from "node:test";
import { gunzipSync, gzipSync } from "node:zlib";

import {
  extractTarFiles,
  isCompleteKnowledgeSource,
  normalizeKnowledgeRepo,
} from "../scripts/lib/knowledge-source.mjs";

const BLOCK = 512;

function header(name: string, size: number, type: string): Buffer {
  const h = Buffer.alloc(BLOCK);
  h.write(name, 0, 100, "utf8"); // 100 байт хүртэл (урт нэр нь pax-аар)
  h.write("0000644\0", 100, "ascii");
  h.write("0000000\0", 108, "ascii");
  h.write("0000000\0", 116, "ascii");
  h.write(size.toString(8).padStart(11, "0") + "\0", 124, "ascii");
  h.write("00000000000\0", 136, "ascii");
  h.write(type, 156, "ascii");
  h.write("ustar\0", 257, "ascii");
  h.write("00", 263, "ascii");
  // checksum: 8 зайг тооцоод бичнэ
  h.fill(0x20, 148, 156);
  let sum = 0;
  for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, "ascii");
  return h;
}

function pad(body: Buffer): Buffer {
  const rest = body.length % BLOCK;
  return rest === 0 ? body : Buffer.concat([body, Buffer.alloc(BLOCK - rest)]);
}

type Entry = { path: string; content?: string; type?: "file" | "dir"; pax?: boolean };

/** GitHub-ийн tarball-тай ижил хэлбэр: pax global header + `<repo>-<sha>/` угтвар. */
function makeTar(entries: Entry[]): Buffer {
  const parts: Buffer[] = [];
  const global = Buffer.from("52 comment=0123456789abcdef0123456789abcdef01234567\n");
  parts.push(header("pax_global_header", global.length, "g"), pad(global));
  for (const e of entries) {
    const full = `Tuguldur0107-entry-knowledge-abc1234/${e.path}`;
    if (e.type === "dir") {
      parts.push(header(full, 0, "5"));
      continue;
    }
    const body = Buffer.from(e.content ?? "", "utf8");
    if (e.pax) {
      const record = ` path=${full}\n`;
      const n = Buffer.byteLength(record);
      let len = n + String(n).length;
      if (String(len).length !== String(n).length) len = n + String(len).length;
      const paxBody = Buffer.from(`${len}${record}`, "utf8");
      parts.push(header("PaxHeader/x", paxBody.length, "x"), pad(paxBody));
      parts.push(header("placeholder-short-name", body.length, "0"), pad(body));
    } else {
      parts.push(header(full, body.length, "0"), pad(body));
    }
  }
  parts.push(Buffer.alloc(BLOCK * 2));
  return Buffer.concat(parts);
}

test("GitHub tarball: угтвар хавтас хасагдана, хавтас/pax global алгасагдана", () => {
  const tar = makeTar([
    { path: "01-онол-хууль-стандарт", type: "dir" },
    { path: "README.md", content: "# Мэдлэгийн сан" },
    { path: "01-онол-хууль-стандарт/tax/vat.md", content: "# НӨАТ\n\n## Хувь\n\n10%", pax: true },
  ]);
  const files = extractTarFiles(gunzipSync(gzipSync(tar)));
  assert.deepEqual(
    files.map((f) => f.path),
    ["README.md", "01-онол-хууль-стандарт/tax/vat.md"]
  );
  assert.equal(files[1].content, "# НӨАТ\n\n## Хувь\n\n10%");
});

test("кирилл урт зам pax `path`-аар бүтнээрээ сэргэнэ", () => {
  const longPath = "02-нягтлан-бодох-мэргэжлийн/guardrails/human-in-the-loop-маш-урт-нэртэй-файл.md";
  assert.ok(Buffer.byteLength(`Tuguldur0107-entry-knowledge-abc1234/${longPath}`) > 100);
  const files = extractTarFiles(makeTar([{ path: longPath, content: "x", pax: true }]));
  assert.deepEqual(files.map((f) => f.path), [longPath]);
});

test("таслагдсан архив ШИДНЭ (seed алгасаж DB хөндөхгүй)", () => {
  const tar = makeTar([{ path: "01-онол-хууль-стандарт/a.md", content: "a".repeat(2000) }]);
  assert.throws(() => extractTarFiles(tar.subarray(0, BLOCK * 3)), /дутуу/);
});

test("бүрэн эх сурвалж: 01, 02, 04-skills бүгд байх ёстой", () => {
  const full = [
    "01-онол-хууль-стандарт/tax/vat.md",
    "02-нягтлан-бодох-мэргэжлийн/payroll/pit.md",
    "04-ai-agent/skills/coa/SKILL.md",
  ];
  assert.equal(isCompleteKnowledgeSource(full), true);
  // Нэг хавтас дутвал бүрэн биш — устгалт хийгдэхгүй.
  assert.equal(isCompleteKnowledgeSource(full.slice(0, 2)), false);
  // Core-оос 01/02/04 хасагдсаны дараах локал хавтас: зөвхөн 03 + README.
  assert.equal(
    isCompleteKnowledgeSource(["03-стандарт/chart-of-accounts.md", "README.md"]),
    false
  );
  assert.equal(isCompleteKnowledgeSource([]), false);
  // Зөвхөн _index / README байвал хамрагдах файл биш тул тооцохгүй.
  assert.equal(
    isCompleteKnowledgeSource([
      "01-онол-хууль-стандарт/_index.md",
      "02-нягтлан-бодох-мэргэжлийн/payroll/pit.md",
      "04-ai-agent/skills/coa/SKILL.md",
    ]),
    false
  );
});

test("KNOWLEDGE_REPO: зөвхөн owner/repo хэлбэр", () => {
  assert.equal(normalizeKnowledgeRepo(" Tuguldur0107/entry-knowledge "), "Tuguldur0107/entry-knowledge");
  assert.equal(normalizeKnowledgeRepo("https://github.com/a/b"), null);
  assert.equal(normalizeKnowledgeRepo("a/b/c"), null);
  assert.equal(normalizeKnowledgeRepo("../etc"), null);
  assert.equal(normalizeKnowledgeRepo(undefined), null);
});
