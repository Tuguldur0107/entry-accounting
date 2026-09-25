// Мэдлэгийн сангийн ЭХ СУРВАЛЖ — ЦЭВЭР (сүлжээ/DB-гүй, тесттэй).
//
// Фаз 2 (docs/knowledge/00-proposal.md §6): 01 / 02 / 04-ai-agent/skills нь core
// repo-д БАЙХГҮЙ, хувийн `entry-knowledge` repo-д амьдарна. SaaS preDeploy нь тэр
// repo-гийн tarball-ийг GitHub API-аар (build secret-ээр) татаж, энд задлаад
// seed-knowledge.mjs руу өгнө. Fork харилцагчид token байхгүй тул юу ч ачаалагдахгүй.
//
// Plain JS: preDeploy-д tsx байхгүй байж болзошгүй (knowledge-parse.mjs-тэй ижил).
// Төрлийн зарлал нь knowledge-source.d.mts.

import { INCLUDED_ROOTS, isIncludedPath } from "./knowledge-parse.mjs";

const BLOCK = 512;

function readString(buf, offset, length) {
  const slice = buf.subarray(offset, offset + length);
  const end = slice.indexOf(0);
  return slice.subarray(0, end === -1 ? slice.length : end).toString("utf8");
}

function readOctal(buf, offset, length) {
  const text = readString(buf, offset, length).trim();
  return text ? parseInt(text, 8) : 0;
}

/** pax extended header ("<len> key=value\n" мөрүүд) → { path } г.м. Урт нь
 *  БАЙТААР (кирилл 2 байт) тул Buffer дээр тасална — тэмдэгтээр биш. */
function parsePax(body) {
  const out = {};
  let pos = 0;
  while (pos < body.length) {
    const space = body.indexOf(0x20, pos);
    if (space <= pos) break;
    const len = Number(body.subarray(pos, space).toString("ascii"));
    if (!Number.isInteger(len) || len <= 0 || pos + len > body.length) break;
    const record = body.subarray(space + 1, pos + len - 1).toString("utf8");
    const eq = record.indexOf("=");
    if (eq > 0) out[record.slice(0, eq)] = record.slice(eq + 1);
    pos += len;
  }
  return out;
}

/**
 * Задалсан (gunzip хийсэн) tar → энгийн файлууд. GitHub-ийн tarball нь бүх замыг
 * `<owner>-<repo>-<sha>/` угтвартай өгдөг тул `stripComponents` (default 1)
 * тэр түвшнийг хасна. Кирилл нэртэй урт зам нь pax `path`-аар ирдэг — дэмжинэ.
 * Гэмтсэн архив → ШИДНЭ (дуудагч seed-ийг алгасна, DB хөндөхгүй).
 */
export function extractTarFiles(tar, { stripComponents = 1 } = {}) {
  const files = [];
  let offset = 0;
  let pendingPath = null;
  while (offset + BLOCK <= tar.length) {
    const header = tar.subarray(offset, offset + BLOCK);
    if (header.every((b) => b === 0)) break; // архивын төгсгөл (2 хоосон блок)

    const size = readOctal(header, 124, 12);
    const type = String.fromCharCode(header[156] || 0x30);
    const bodyStart = offset + BLOCK;
    const bodyEnd = bodyStart + size;
    if (bodyEnd > tar.length) throw new Error("tar архив дутуу (таслагдсан)");
    const body = tar.subarray(bodyStart, bodyEnd);
    offset = bodyStart + Math.ceil(size / BLOCK) * BLOCK;

    if (type === "x") {
      pendingPath = parsePax(body).path ?? null;
      continue;
    }
    if (type === "g") continue; // pax global header (GitHub: comment=<sha>) — файлд хамаарахгүй
    if (type === "L") {
      pendingPath = readString(body, 0, body.length);
      continue;
    }

    const prefix = readString(header, 345, 155);
    const name = readString(header, 0, 100);
    const fullPath = pendingPath ?? (prefix ? `${prefix}/${name}` : name);
    pendingPath = null;

    if (type !== "0" && type !== "\0") continue; // зөвхөн энгийн файл (хавтас, link алгасна)
    const parts = fullPath.split("/").filter(Boolean);
    if (parts.length <= stripComponents) continue;
    files.push({ path: parts.slice(stripComponents).join("/"), content: body.toString("utf8") });
  }
  return files;
}

/**
 * Эх сурвалж БҮРЭН эсэх — INCLUDED_ROOTS бүрд дор хаяж нэг хамрагдах файл байх.
 * Бүрэн биш үед seed зөвхөн нэмж/шинэчилнэ, DB-ээс ЮУ Ч УСТГАХГҮЙ: core-оос
 * 01/02/04 хасагдсаны дараа token-гүй deploy (эсвэл хагас татагдсан архив)
 * production-ийн санг хоосолж болохгүй.
 */
export function isCompleteKnowledgeSource(paths) {
  const included = paths.filter(isIncludedPath);
  return INCLUDED_ROOTS.every((root) =>
    included.some((p) => p === root || p.startsWith(`${root}/`))
  );
}

/** `owner/repo` хэлбэр шалгана — env-ийн алдааг сүлжээ хөндөхөөс өмнө барина. */
export function normalizeKnowledgeRepo(value) {
  const trimmed = String(value ?? "").trim();
  return /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(trimmed) ? trimmed : null;
}
