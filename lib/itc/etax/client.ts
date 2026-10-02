// eTax API HTTP клиент (SERVER; DB-гүй) — АЛБАН спек docs/integrations/etax/00-etax-api-spec.md §3.
// Keycloak token нь lib/itc/client.ts `fetchItcToken` (client_id `etaxClientId`), үүнээс гадна
// header `NE-KEY` = Entry-ийн ОПЕРАТОРЫН түлхүүр (posapi@itc.gov.mn-ээс, серверийн env
// `ETAX_NE_KEY` — харилцагчийн UI-д ХЭЗЭЭ Ч харуулахгүй). Хост `ETAX_API_BASE` /
// `ETAX_API_BASE_STAGING` env-ээр дарагдана (прокси, ebarimt-ийн gateway header-тэй ижил).
// Алдаа бүр EtaxError `[CODE]`; нууц (token, NE-KEY) алдаа/логт орохгүй.

import { gatewayHeaders } from "@/lib/ebarimt/gateway-auth";
import { bearerHeader, type ItcToken } from "@/lib/itc/auth";
import type { ItcEnvironment } from "@/lib/itc/constants";

import {
  assertEtaxCode,
  parseFormDetail,
  parseHistory,
  parseReportList,
  parseSaveResponse,
  parseSaveSheetResponse,
  parseSheetDetail,
  parseSheetList,
  parseSubmitResponse,
  parseUserOrgs,
  type EtaxFormTemplate,
  type EtaxHistoryRow,
  type EtaxOrg,
  type EtaxReportListRow,
  type EtaxSaveResult,
  type EtaxSheetInfo,
  type EtaxSheetTemplate,
} from "./api";
import { ETAX_API_BASE, ETAX_CLIENT_IDS, ETAX_ERRORS, ETAX_PATHS, ETAX_TIMEOUT_MS } from "./constants";
import { EtaxError } from "./submission";

/** Keycloak client_id — env `ETAX_CLIENT_ID` байвал тэр (бодит орчны албан утга тодорхойгүй — constants). */
export function etaxClientId(env: ItcEnvironment, vars: Record<string, string | undefined> = process.env): string {
  return vars.ETAX_CLIENT_ID?.trim() || ETAX_CLIENT_IDS[env];
}

/** NE-KEY — операторын env; байхгүй бол null (дуудлага ил алдаа өгнө). */
export function etaxNeKey(vars: Record<string, string | undefined> = process.env): string | null {
  return vars.ETAX_NE_KEY?.trim() || null;
}

export function etaxApiBaseEnvName(env: ItcEnvironment): string {
  return env === "staging" ? "ETAX_API_BASE_STAGING" : "ETAX_API_BASE";
}

/** API суурь хаяг — орчны прокси env түрүүлнэ (ЦЭВЭР — `vars` өгч тестлэнэ). */
export function etaxApiBase(env: ItcEnvironment, vars: Record<string, string | undefined> = process.env): string {
  const override = vars[etaxApiBaseEnvName(env)]?.trim();
  if (override) {
    if (!/^https?:\/\//i.test(override)) throw new EtaxError(ETAX_ERRORS.config, `${etaxApiBaseEnvName(env)} http(s) URL байна`);
    return override.replace(/\/+$/, "");
  }
  return ETAX_API_BASE[env];
}

export interface EtaxAuth {
  token: Pick<ItcToken, "accessToken">;
  neKey: string | null;
}

type Query = Record<string, string | number | null | undefined>;

function withQuery(url: string, query?: Query): string {
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value != null && value !== "") params.set(key, String(value));
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

async function request(env: ItcEnvironment, auth: EtaxAuth, method: "GET" | "POST", path: string, query?: Query, body?: unknown): Promise<unknown> {
  if (!auth.neKey)
    throw new EtaxError(ETAX_ERRORS.config, "eTax NE-KEY (операторын түлхүүр, серверийн env ETAX_NE_KEY) тохируулагдаагүй — Entry багт хандана уу");
  const url = withQuery(`${etaxApiBase(env)}${path}`, query);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ETAX_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...bearerHeader(auth.token),
      "NE-KEY": auth.neKey,
      ...gatewayHeaders(url),
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store",
    });
    const raw = await response.text();
    let json: unknown;
    try {
      json = raw ? JSON.parse(raw) : {};
    } catch {
      json = { message: raw.slice(0, 500) };
    }
    if (response.status === 401 || response.status === 403)
      throw new EtaxError(ETAX_ERRORS.auth, `eTax ${response.status} — token хүчингүй эсвэл NE-KEY эрхгүй (${path})`);
    if (response.status >= 400) {
      const message = typeof json === "object" && json && "message" in json ? String((json as { message: unknown }).message) : "";
      throw new EtaxError(ETAX_ERRORS.api, `eTax HTTP ${response.status} (${path}): ${message || "хариу алдаатай"}`);
    }
    return json;
  } catch (error) {
    if (error instanceof EtaxError) throw error;
    if (error instanceof Error && error.name === "AbortError")
      throw new EtaxError(ETAX_ERRORS.network, `eTax ${Math.round(ETAX_TIMEOUT_MS / 1000)} сек-д хариулсангүй (${path})`);
    const reason = error instanceof Error ? error.message : String(error);
    throw new EtaxError(ETAX_ERRORS.network, `eTax-д хүрсэнгүй (${path}): ${reason}`);
  } finally {
    clearTimeout(timer);
  }
}

/** §3.2 — ITC хэрэглэгчийн холбогдсон байгууллагууд (entId). */
export async function fetchEtaxUserOrgs(env: ItcEnvironment, auth: EtaxAuth): Promise<EtaxOrg[]> {
  return parseUserOrgs(await request(env, auth, "GET", ETAX_PATHS.userOrgs));
}

/** §3.3 — тушаах тайлангийн жагсаалт. */
export async function fetchEtaxReportList(env: ItcEnvironment, auth: EtaxAuth, entId: number): Promise<EtaxReportListRow[]> {
  return parseReportList(await request(env, auth, "GET", ETAX_PATHS.reportList, { entId }));
}

/** §3.4 — жилийн түүх (төлөв). */
export async function fetchEtaxHistory(env: ItcEnvironment, auth: EtaxAuth, entId: number, year: number): Promise<EtaxHistoryRow[]> {
  return parseHistory(await request(env, auth, "GET", ETAX_PATHS.history, { entId, year }));
}

/** §3.7 — маягтын загвар (нүдний жагсаалт). */
export async function fetchEtaxFormDetail(
  env: ItcEnvironment,
  auth: EtaxAuth,
  query: { entId: number; branchId: number; formNo: number; taxTypeId: number; year: number; period: number }
): Promise<EtaxFormTemplate> {
  return parseFormDetail(await request(env, auth, "GET", ETAX_PATHS.formDetail, query));
}

/** §3.9 — тайлан ХАДГАЛАХ (ТЕГ-ийн төлөв 2). */
export async function saveEtaxFormData(env: ItcEnvironment, auth: EtaxAuth, entId: number, body: unknown): Promise<EtaxSaveResult> {
  return parseSaveResponse(await request(env, auth, "POST", ETAX_PATHS.saveFormData, { entId }, body));
}

/** §3.10 — тайлан ИЛГЭЭХ (ТЕГ загварын validations-оо шалгана). */
export async function submitEtaxReport(env: ItcEnvironment, auth: EtaxAuth, entId: number, body: unknown): Promise<{ message: string }> {
  return parseSubmitResponse(await request(env, auth, "POST", ETAX_PATHS.submit, { entId }, body));
}

// ── §3.11–§3.15 Хавсралт мэдээ ──────────────────────────────────────────────

/** §3.11 — тайлангийн хавсралт мэдээний жагсаалт (reportNo-той тайланд). */
export async function fetchEtaxSheetList(env: ItcEnvironment, auth: EtaxAuth, query: { entId: number; formNo: number; reportNo: number }): Promise<EtaxSheetInfo[]> {
  return parseSheetList(await request(env, auth, "GET", ETAX_PATHS.sheetList, query));
}

/** §3.12 — мэдээний загвар (баганууд). */
export async function fetchEtaxSheetDetail(env: ItcEnvironment, auth: EtaxAuth, query: { entId: number; sheetFormNo: number }): Promise<EtaxSheetTemplate> {
  return parseSheetDetail(await request(env, auth, "GET", ETAX_PATHS.sheetDetail, query));
}

/** §3.14 — мэдээний мөр хадгалах. */
export async function saveEtaxSheetData(env: ItcEnvironment, auth: EtaxAuth, entId: number, body: unknown, expectedReportNo: number): Promise<{ reportNo: number }> {
  return parseSaveSheetResponse(await request(env, auth, "POST", ETAX_PATHS.saveSheetData, { entId }, body), expectedReportNo);
}

/** §3.15 — мэдээний бүх мөр устгах (дахин бичихийн өмнө). */
export async function deleteEtaxSheetData(env: ItcEnvironment, auth: EtaxAuth, entId: number, body: unknown): Promise<void> {
  assertEtaxCode(await request(env, auth, "POST", ETAX_PATHS.deleteAllSheetData, { entId }, body), "Мэдээ устгах");
}
