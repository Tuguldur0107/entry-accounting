// ТЕГ-ийн нийтийн лавлах (нэвтрэлтгүй) — РД → ТТД/нэр, дүүргийн кодууд.
// 24 цагийн in-process кэш; уначихвал ШИДНЭ (утга зохиохгүй).

import { EBARIMT_ERRORS, EBARIMT_PUBLIC_API_BASE, REGISTER_NO_RE } from "./constants";
import { EbarimtError } from "./receipt";

export interface TinInfo {
  regNo: string;
  tin: string;
  name: string;
}

export interface BranchInfoEntry {
  code: string;
  name: string;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const tinCache = new Map<string, { at: number; value: TinInfo }>();
let branchCache: { at: number; value: BranchInfoEntry[] } | null = null;

/**
 * Сүлжээний түүхий алдааг (англи «This operation was aborted», «fetch failed»)
 * монгол тайлбар болгоно — ЦЭВЭР (tests/ebarimt-lookup.test.ts, ENT-034).
 */
export function describeLookupFailure(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);
  if (name === "AbortError" || /aborted|timeout/i.test(message))
    return "ТЕГ-ийн лавлах 8 секундэд хариу өгсөнгүй (timeout) — хэсэг хугацааны дараа дахин оролдоно уу";
  const status = /^HTTP (\d{3})$/.exec(message)?.[1];
  if (status)
    return `ТЕГ-ийн лавлах алдаа буцаалаа (HTTP ${status}) — хэсэг хугацааны дараа дахин оролдоно уу`;
  return "ТЕГ-ийн лавлахад холбогдож чадсангүй (сүлжээ) — хэсэг хугацааны дараа дахин оролдоно уу";
}

async function getJsonOnce(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function getJson(url: string): Promise<unknown> {
  // Түр зуурын саатал элбэг тул НЭГ удаа дахин оролдоно.
  try {
    return await getJsonOnce(url);
  } catch {
    try {
      return await getJsonOnce(url);
    } catch (error) {
      throw new EbarimtError(EBARIMT_ERRORS.posApi, describeLookupFailure(error));
    }
  }
}

function pick(obj: unknown, keys: string[]): string {
  if (!obj || typeof obj !== "object") return "";
  const record = obj as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return "";
}

/** РД (АА00000000 / 7 оронтой ТТД) → ТТД + нэр. Олдохгүй бол ШИДНЭ. */
export async function lookupTinByRegNo(regNoRaw: string): Promise<TinInfo> {
  const regNo = regNoRaw.trim().toUpperCase();
  if (!regNo) throw new EbarimtError(EBARIMT_ERRORS.settings, "Регистрийн дугаар хоосон");
  const cached = tinCache.get(regNo);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;
  const json = await getJson(`${EBARIMT_PUBLIC_API_BASE}/getTinInfo?regNo=${encodeURIComponent(regNo)}`);
  const data = (json && typeof json === "object" && "data" in json ? (json as { data: unknown }).data : json) ?? {};
  const tin = pick(data, ["tin", "TIN", "id"]);
  const name = pick(data, ["name", "NAME", "orgName"]);
  if (!tin) throw new EbarimtError(EBARIMT_ERRORS.settings, `"${regNo}" РД-тэй байгууллага ТЕГ-ийн бүртгэлд олдсонгүй`);
  const value = { regNo, tin, name };
  tinCache.set(regNo, { at: Date.now(), value });
  return value;
}

export function isRegisterNoShape(value: string): boolean {
  return REGISTER_NO_RE.test(value.trim()) || /^\d{7}$/.test(value.trim());
}

/** Дүүргийн кодын лавлах — тохиргооны сонголтод. */
export async function lookupBranchInfo(): Promise<BranchInfoEntry[]> {
  if (branchCache && Date.now() - branchCache.at < CACHE_TTL_MS) return branchCache.value;
  const json = await getJson(`${EBARIMT_PUBLIC_API_BASE}/getBranchInfo`);
  const root = json && typeof json === "object" && "data" in json ? (json as { data: unknown }).data : json;
  const entries: BranchInfoEntry[] = [];
  const visit = (node: unknown, prefix: string) => {
    if (Array.isArray(node)) {
      for (const child of node) visit(child, prefix);
      return;
    }
    if (!node || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    const code = pick(record, ["branchCode", "code", "districtCode"]);
    const name = pick(record, ["branchName", "name", "districtName"]);
    if (code && name) entries.push({ code, name: prefix ? `${prefix} · ${name}` : name });
    const children = record.children ?? record.subBranches ?? record.districts;
    if (children) visit(children, name || prefix);
  };
  visit(root, "");
  branchCache = { at: Date.now(), value: entries };
  return entries;
}
