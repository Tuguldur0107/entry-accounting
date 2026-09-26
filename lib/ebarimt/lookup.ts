// ТЕГ-ийн нийтийн лавлах (нэвтрэлтгүй) — РД → ТТД/нэр, дүүргийн кодууд.
// 24 цагийн in-process кэш; уначихвал ШИДНЭ (утга зохиохгүй).

import { EBARIMT_ERRORS, EBARIMT_PUBLIC_API_BASE, MERCHANT_TIN_RE, REGISTER_NO_RE } from "./constants";
import { EbarimtError } from "./receipt";
import { gatewayHeaders } from "./gateway-auth";

/**
 * Лавлахын суурь хаяг. `api.ebarimt.mn` нь ЗӨВХӨН Монголын IP-ээс хандагддаг тул
 * гадаад бүсийн серверт (Railway) env `EBARIMT_PUBLIC_API_BASE`-ээр Монголд
 * байрлах прокси (операторын PosAPI сервер дээрх reverse proxy г.м.) өгнө —
 * зам нь ижил (`/getTinInfo`, `/getInfo`, `/getBranchInfo`). docs/integrations/01 P1-1.
 */
export function publicApiBase(): string {
  const env = process.env.EBARIMT_PUBLIC_API_BASE?.trim().replace(/\/+$/, "");
  return env && /^https?:\/\/\S+$/.test(env) ? env : EBARIMT_PUBLIC_API_BASE;
}

/**
 * ТЕГ-ийн 2026-05-11-ний мэдэгдэл: иргэний РД нь хувийн мэдээлэл (ХХМХ хууль
 * 4.1.11) — `getTinInfo`-г иргэний регистрээр дуудахгүй, 2026-06-15-аас зогсоох
 * төлөвлөгөөтэй; байгууллагын регистрээр лавлах ч хязгаарлагдаж болзошгүй.
 * Иймд ТТД-г ШУУД оруулах нь үндсэн зам (docs/integrations/01 P1-2).
 */
export const TIN_DIRECT_HINT =
  "ТТД-г шууд оруулж болно (харилцагчийн ETAX «Татвар төлөгчийн мэдээлэл» цонх; хуулийн этгээд 11 орон)";

export interface TinInfo {
  regNo: string;
  tin: string;
  /** ТЕГ-ийн бүртгэлийн нэр; нэрийн лавлах унасан бол "". */
  name: string;
  /** НӨАТ суутган төлөгч эсэх (getInfo), тодорхойгүй бол null. */
  vatPayer: boolean | null;
  /** НХАТ (нийслэлийн албан татвар) суутган төлөгч — Entry `totalCityTax` дэмжихгүй (P2-4). */
  cityPayer: boolean | null;
  /** НӨАТ-аас чөлөөлөгдөх төсөл — албан: receipts[].taxType VAT_FREE + taxProductCode 304 (P2-3). */
  freeProject: boolean | null;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const tinCache = new Map<string, { at: number; value: TinInfo }>();

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
    // Монголын прокси (EBARIMT_PUBLIC_API_BASE) WAF-ын ард бол нууц header — allowlist-ийн
    // хост руу л; албан api.ebarimt.mn руу ХЭЗЭЭ Ч илгээхгүй (жагсаалтад оруулахгүй).
    const response = await fetch(url, { headers: gatewayHeaders(url), signal: controller.signal, cache: "no-store" });
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

/**
 * `getTinInfo?regNo=` хариу → ТТД. Албан хариу `{ msg, status, data: <ТТД тоо> }`
 * (PosAPI 3.0 — нэр БУЦААХГҮЙ); зарим прокси `data: { tin }` өгдөг тул хоёуланг
 * танина. Олдоогүй бол "" — ЦЭВЭР (tests/ebarimt-lookup.test.ts).
 */
export function parseTinInfoResponse(json: unknown): string {
  const data = json && typeof json === "object" && "data" in json ? (json as { data: unknown }).data : json;
  if (typeof data === "number" && Number.isFinite(data) && data > 0) return String(Math.trunc(data));
  if (typeof data === "string" && /^\d{11,14}$/.test(data.trim())) return data.trim();
  const tin = pick(data, ["tin", "TIN"]);
  return /^\d{11,14}$/.test(tin) ? tin : "";
}

export interface TaxpayerInfo {
  name: string;
  found: boolean;
  vatPayer: boolean | null;
  cityPayer: boolean | null;
  freeProject: boolean | null;
}

/**
 * `getInfo?tin=` хариу → нэр, НӨАТ төлөгч эсэх. Албан хариу
 * `{ msg, status, data: { name, found, vatPayer, cityPayer, freeProject, … } }` — ЦЭВЭР.
 */
export function parseTaxpayerInfoResponse(json: unknown): TaxpayerInfo {
  const data = json && typeof json === "object" && "data" in json ? (json as { data: unknown }).data : json;
  const record = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const name = pick(record, ["name", "NAME", "orgName"]);
  const found = typeof record.found === "boolean" ? record.found : name !== "";
  const vatPayer = typeof record.vatPayer === "boolean" ? record.vatPayer : null;
  const cityPayer = typeof record.cityPayer === "boolean" ? record.cityPayer : null;
  const freeProject = typeof record.freeProject === "boolean" ? record.freeProject : null;
  return { name, found, vatPayer, cityPayer, freeProject };
}

/**
 * РД (байгууллагын 7 орон / иргэний АА00000000) → ТТД + нэр. Хоёр алхамтай:
 * `getTinInfo` (РД → ТТД) → `getInfo` (ТТД → нэр). ТТД олдохгүй бол ШИДНЭ;
 * нэрийн лавлах унавал ТТД-ээр үргэлжилнэ (нэр хоосон — зохиохгүй).
 */
export async function lookupTinByRegNo(regNoRaw: string): Promise<TinInfo> {
  const regNo = regNoRaw.trim().toUpperCase();
  if (!regNo) throw new EbarimtError(EBARIMT_ERRORS.settings, "Регистрийн дугаар хоосон");
  if (REGISTER_NO_RE.test(regNo))
    throw new EbarimtError(
      EBARIMT_ERRORS.settings,
      "Иргэний регистрийн дугаараар ТТД лавлахгүй (Хувь хүний мэдээлэл хамгаалах тухай хууль 4.1.11, ТЕГ 2026-05-11) — иргэнд eBarimt хэрэглэгчийн дугаар (8 орон), эсвэл ТТД (12–14 орон) оруулна"
    );
  if (MERCHANT_TIN_RE.test(regNo)) {
    // ТТД шууд өгөгдсөн — лавлах шаардлагагүй, зөвхөн нэр.
    const info = await lookupTaxpayerByTin(regNo);
    return { regNo, tin: regNo, name: info.name, vatPayer: info.vatPayer, cityPayer: info.cityPayer, freeProject: info.freeProject };
  }
  const cached = tinCache.get(regNo);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;
  let tin = "";
  try {
    tin = parseTinInfoResponse(await getJson(`${publicApiBase()}/getTinInfo?regNo=${encodeURIComponent(regNo)}`));
  } catch (error) {
    // Лавлах хүрэхгүй / хаагдсан (гео-хязгаар, 2026-06-15-ын зогсоолт) — ТТД-ийн замыг заана.
    const reason = error instanceof Error ? error.message.replace(/^\[[A-Z_]+\]\s*/, "") : String(error);
    throw new EbarimtError(EBARIMT_ERRORS.posApi, `${reason}. ${TIN_DIRECT_HINT}`);
  }
  if (!tin)
    throw new EbarimtError(EBARIMT_ERRORS.settings, `"${regNo}" регистртэй татвар төлөгч ТЕГ-ийн бүртгэлд олдсонгүй. ${TIN_DIRECT_HINT}`);
  let info: TaxpayerInfo = { name: "", found: true, vatPayer: null, cityPayer: null, freeProject: null };
  try {
    info = await lookupTaxpayerByTin(tin);
  } catch {
    // Нэр нь зөвхөн харуулах мэдээлэл — баримт ТТД-ээр илгээгдэнэ.
  }
  if (!info.found) throw new EbarimtError(EBARIMT_ERRORS.settings, `"${regNo}" регистртэй татвар төлөгч ТЕГ-ийн бүртгэлд олдсонгүй. ${TIN_DIRECT_HINT}`);
  const value: TinInfo = { regNo, tin, name: info.name, vatPayer: info.vatPayer, cityPayer: info.cityPayer, freeProject: info.freeProject };
  if (info.name) tinCache.set(regNo, { at: Date.now(), value });
  return value;
}

/**
 * ТТД → бүртгэлийн мэдээлэл (`getInfo?tin=`): нэр, НӨАТ төлөгч эсэх. B2B баримтад
 * худалдан авагчийн НЭР хэвлэх шаардлагатай (ХСН шаардлага №16) тул ТТД шууд
 * оруулсан үед ч нэрийг эндээс авна. Олдоогүй бол ШИДНЭ (нэр зохиохгүй).
 */
export async function lookupTaxpayerByTin(tinRaw: string): Promise<TaxpayerInfo> {
  const tin = tinRaw.trim();
  if (!MERCHANT_TIN_RE.test(tin)) throw new EbarimtError(EBARIMT_ERRORS.settings, "ТТД 11–14 оронтой тоо байна");
  const info = parseTaxpayerInfoResponse(await getJson(`${publicApiBase()}/getInfo?tin=${encodeURIComponent(tin)}`));
  if (!info.found) throw new EbarimtError(EBARIMT_ERRORS.settings, `ТТД ${tin} ТЕГ-ийн бүртгэлд олдсонгүй`);
  return info;
}

export function isRegisterNoShape(value: string): boolean {
  return REGISTER_NO_RE.test(value.trim()) || /^\d{7}$/.test(value.trim());
}
