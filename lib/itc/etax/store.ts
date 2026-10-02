// eTax — DB давхарга (SERVER; "use server" БИШ: action, хуудас, хожим AI tool дуудна).
// docs/dev/etax.md. ЦЭВЭР логик: submission.ts. Дүрэм:
//  - Тайлан ЗОХИОХГҮЙ — snapshot нь `getVatReturnData`-ийн дүнг л хуулна
//  - Төлөвийн бичилт бүр уншсан төлөвтөө НӨХЦӨЛТЭЙ (`where status = <уншсан>` + returning, C4)
//  - Нууц үг `encryptSecret`-ээр; утга нь алдаа/лог/аудитад гарахгүй
//  - ТЕГ рүү юу ч ИЛГЭЭХГҮЙ (албан API спек ирээгүй) — зөвхөн Keycloak нэвтрэлт шалгана

import { and, desc, eq, inArray } from "drizzle-orm";

import { getVatReturnData } from "@/lib/actions/vat";
import { decryptSecret } from "@/lib/ai/crypto";
import { db } from "@/lib/db";
import { etaxConnections, etaxFormMappings, etaxSubmissions, organizationProfile } from "@/lib/db/schema";
import { ItcError, describeToken, isAccessTokenUsable, isItcEnvironment, type ItcToken } from "@/lib/itc/auth";
import { fetchItcToken } from "@/lib/itc/client";
import { ITC_ERRORS, type ItcEnvironment } from "@/lib/itc/constants";
import { isPeriodCode } from "@/lib/periods/period";
import { ulaanbaatarToday } from "@/lib/periods/document-date";
import { stateChangedError } from "@/lib/state-guard";

import {
  mappingProblems,
  normalizeCellMapping,
  normalizeSheetMapping,
  sheetMappingProblems,
  type EtaxFormCell,
  type EtaxSheetMapping,
  type EtaxSheetTemplate,
} from "./api";
import { etaxClientId, etaxNeKey, type EtaxAuth } from "./client";
import {
  ETAX_ACTIVE_STATUSES,
  ETAX_ERRORS,
  ETAX_STATUS_LABELS,
  ETAX_WEB_BASE,
  isEtaxFormKey,
  type EtaxSubmissionStatus,
} from "./constants";
import {
  EtaxError,
  assertTransition,
  buildVatSnapshot,
  normalizeTaxReference,
  requiresTaxReference,
  snapshotAmountsDiffer,
  validateVatSnapshot,
  type EtaxTaxpayer,
  type EtaxValidation,
  type EtaxVatSnapshot,
} from "./submission";
import type { EtaxConnectionView, EtaxMappingView, EtaxPageData, EtaxSubmissionView } from "./types";

type ConnectionRow = typeof etaxConnections.$inferSelect;
type SubmissionRow = typeof etaxSubmissions.$inferSelect;

const ACTIVE = [...ETAX_ACTIVE_STATUSES];

/** jsonb баганад бичихэд — схем `Record<string, unknown>` (interface-д index signature байхгүй). */
const asJson = (snapshot: EtaxVatSnapshot): Record<string, unknown> => snapshot as unknown as Record<string, unknown>;

export async function loadEtaxConnectionRow(orgId: string): Promise<ConnectionRow | null> {
  return (await db.query.etaxConnections.findFirst({ where: eq(etaxConnections.organizationId, orgId) })) ?? null;
}

function environmentOf(row: { environment: string }): ItcEnvironment {
  return row.environment === "staging" ? "staging" : "production";
}

export function toEtaxConnectionView(row: ConnectionRow): EtaxConnectionView {
  const environment = environmentOf(row);
  return {
    environment,
    username: row.username,
    hasPassword: !!row.passwordEnc,
    isEnabled: row.isEnabled,
    lastCheckAt: row.lastCheckAt?.toISOString() ?? null,
    lastCheckOkAt: row.lastCheckOkAt?.toISOString() ?? null,
    lastCheckError: row.lastCheckError,
    webUrl: ETAX_WEB_BASE[environment],
    entId: row.entId,
    entName: row.entName,
    entTin: row.entTin,
    branchName: row.branchName,
    lastOrgSyncAt: row.lastOrgSyncAt?.toISOString() ?? null,
    apiReady: etaxNeKey() !== null,
  };
}

/**
 * eTax API сесс — нууц үг энд л тайлагдана; token дуусвал (30 сек skew) дахин нэвтэрнэ;
 * NE-KEY = операторын env. Нууц утга алдаа/логт орохгүй.
 */
export function etaxSessionOf(row: ConnectionRow): { env: ItcEnvironment; entId: number | null; auth(): Promise<EtaxAuth> } {
  if (!isItcEnvironment(row.environment)) throw new ItcError(ITC_ERRORS.config, "ITC орчин буруу — тохиргоогоо хадгална уу");
  const env = row.environment;
  const password = decryptSecret(row.passwordEnc);
  if (!password) throw new ItcError(ITC_ERRORS.config, "Нууц үг тайлагдсангүй (AUTH_SECRET солигдсон?) — тохиргоонд дахин оруулна уу");
  const neKey = etaxNeKey();
  let current: ItcToken | null = null;
  return {
    env,
    entId: row.entId,
    async auth() {
      if (!current || !isAccessTokenUsable(current)) current = await fetchItcToken(env, { username: row.username, password }, etaxClientId(env));
      return { token: current, neKey };
    },
  };
}

/** Холболт + entId заавал (API дуудлагын өмнө). */
export async function requireEtaxSession(orgId: string): Promise<{ row: ConnectionRow; env: ItcEnvironment; entId: number; auth(): Promise<EtaxAuth> }> {
  const row = await loadEtaxConnectionRow(orgId);
  if (!row) throw new EtaxError(ETAX_ERRORS.config, "Эхлээд eTax холболтоо хадгална уу (Татвар → eTax тайлан → тохиргоо)");
  if (!row.isEnabled) throw new EtaxError(ETAX_ERRORS.config, "eTax холболт идэвхгүй — тохиргооноос асаана уу");
  const session = etaxSessionOf(row);
  if (session.entId == null) throw new EtaxError(ETAX_ERRORS.config, "ТЕГ-ийн байгууллагын дугаар (entId) татагдаагүй — тохиргоонд «Байгууллага татах» дарна уу");
  return { row, env: session.env, entId: session.entId, auth: session.auth };
}

type MappingRow = typeof etaxFormMappings.$inferSelect;

export async function loadEtaxMappingRow(orgId: string, form = "vat"): Promise<MappingRow | null> {
  return (await db.query.etaxFormMappings.findFirst({ where: and(eq(etaxFormMappings.organizationId, orgId), eq(etaxFormMappings.form, form)) })) ?? null;
}

/** Мэдээний холболтууд — загвар бүрд нэг (хадгалаагүй бол эхгүй default). */
export function sheetMappingsOf(row: Pick<MappingRow, "sheets" | "sheetTemplates">): { templates: EtaxSheetTemplate[]; mappings: EtaxSheetMapping[] } {
  const templates = (row.sheetTemplates ?? []) as unknown as EtaxSheetTemplate[];
  const saved = row.sheets ?? {};
  const mappings = templates.map((t) => normalizeSheetMapping(saved[t.sheetCode], { sheetFormNo: t.sheetFormNo, sheetCode: t.sheetCode }));
  return { templates, mappings };
}

export function toEtaxMappingView(row: MappingRow): EtaxMappingView {
  const templateCells = (row.templateCells ?? []) as unknown as EtaxFormCell[];
  const cells = normalizeCellMapping(row.cells);
  const { templates, mappings } = sheetMappingsOf(row);
  return {
    form: isEtaxFormKey(row.form) ? row.form : "vat",
    formNo: row.formNo,
    taxTypeId: row.taxTypeId,
    taxTypeName: row.taxTypeName,
    reportCode: row.reportCode,
    templateVersion: row.templateVersion,
    cells,
    templateCells,
    templateFetchedAt: row.templateFetchedAt?.toISOString() ?? null,
    problems: mappingProblems(cells, templateCells.length ? templateCells : null),
    sheetTemplates: templates,
    sheets: mappings,
    sheetTemplatesFetchedAt: row.sheetTemplatesFetchedAt?.toISOString() ?? null,
    sheetProblems: mappings.flatMap((m) => sheetMappingProblems(m, templates.find((t) => t.sheetCode === m.sheetCode)?.columns ?? null)),
  };
}

/**
 * Нэвтрэлт шалгах — ITC Keycloak-аас token авна, юу ч илгээхгүй. Үр дүн `lastCheck*`-д
 * (алдааны мессеж нууц утгагүй). Хариуд token-ийн утга БИШ зөвхөн хугацаа.
 */
export async function checkEtaxConnection(orgId: string): Promise<{ expiresAt: string }> {
  const row = await loadEtaxConnectionRow(orgId);
  if (!row) throw new ItcError(ITC_ERRORS.config, "Эхлээд eTax холболтоо хадгална уу");
  if (!isItcEnvironment(row.environment)) throw new ItcError(ITC_ERRORS.config, "ITC орчин буруу — тохиргоогоо хадгална уу");
  const password = decryptSecret(row.passwordEnc);
  if (!password) throw new ItcError(ITC_ERRORS.config, "Нууц үг тайлагдсангүй (AUTH_SECRET солигдсон?) — тохиргоонд дахин оруулна уу");
  const now = new Date();
  try {
    const token = await fetchItcToken(row.environment, { username: row.username, password }, etaxClientId(row.environment));
    const described = describeToken(token);
    await db
      .update(etaxConnections)
      .set({ lastCheckAt: now, lastCheckOkAt: now, lastCheckError: null, updatedAt: now })
      .where(eq(etaxConnections.id, row.id));
    return { expiresAt: described.expiresAt };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db
      .update(etaxConnections)
      .set({ lastCheckAt: now, lastCheckError: message.slice(0, 500), updatedAt: now })
      .where(eq(etaxConnections.id, row.id));
    throw error;
  }
}

/** Татвар төлөгчийн толгой — Компанийн мэдээллээс (хоосон бол шалгалт алдаа өгнө). */
export async function loadEtaxTaxpayer(orgId: string): Promise<EtaxTaxpayer> {
  const profile = await db.query.organizationProfile.findFirst({
    where: eq(organizationProfile.organizationId, orgId),
    columns: { name: true, registerNo: true, vatPayerNo: true },
  });
  return { name: profile?.name ?? "", registerNo: profile?.registerNo ?? null, vatPayerNo: profile?.vatPayerNo ?? null };
}

function statusOf(value: string): EtaxSubmissionStatus {
  return value in ETAX_STATUS_LABELS ? (value as EtaxSubmissionStatus) : "draft";
}

export function toEtaxSubmissionView(row: SubmissionRow): EtaxSubmissionView {
  return {
    id: row.id,
    form: isEtaxFormKey(row.form) ? row.form : "vat",
    formCode: row.formCode,
    periodCode: row.periodCode,
    status: statusOf(row.status),
    environment: environmentOf(row),
    snapshot: row.snapshot as unknown as EtaxVatSnapshot,
    validation: (row.validation as EtaxValidation | null) ?? null,
    taxReference: row.taxReference,
    reportNo: row.reportNo,
    taxStatusId: row.taxStatusId,
    taxStatusName: row.taxStatusName,
    taxSyncedAt: row.taxSyncedAt?.toISOString() ?? null,
    sheetsSavedAt: row.sheetsSavedAt?.toISOString() ?? null,
    sheetsSummary: row.sheetsSummary ?? null,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    resultNote: row.resultNote,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function loadActiveVatSubmission(orgId: string, periodCode: string): Promise<SubmissionRow | null> {
  return (
    (await db.query.etaxSubmissions.findFirst({
      where: and(
        eq(etaxSubmissions.organizationId, orgId),
        eq(etaxSubmissions.form, "vat"),
        eq(etaxSubmissions.periodCode, periodCode),
        inArray(etaxSubmissions.status, ACTIVE)
      ),
    })) ?? null
  );
}

export async function loadEtaxSubmission(orgId: string, id: string): Promise<SubmissionRow | null> {
  return (
    (await db.query.etaxSubmissions.findFirst({
      where: and(eq(etaxSubmissions.organizationId, orgId), eq(etaxSubmissions.id, id)),
    })) ?? null
  );
}

/** Одоогийн бодолтоос snapshot — хуудас ба бэлтгэл НЭГ эх. */
async function currentVatSnapshot(orgId: string, periodCode: string, now: Date): Promise<{ snapshot: EtaxVatSnapshot; isVatPayer: boolean }> {
  const [data, taxpayer] = await Promise.all([getVatReturnData(periodCode), loadEtaxTaxpayer(orgId)]);
  return {
    snapshot: buildVatSnapshot({
      summary: data.summary,
      settings: data.settings,
      taxpayer,
      settlementVoucherId: data.settlement?.id ?? null,
      computedAt: now,
    }),
    isVatPayer: data.isVatPayer,
  };
}

/** `/tax/etax` хуудасны өгөгдөл. */
export async function loadEtaxPageData(orgId: string, periodCode: string): Promise<EtaxPageData> {
  if (!isPeriodCode(periodCode)) throw new EtaxError(ETAX_ERRORS.validation, "Тайлант үеийн код буруу");
  const now = new Date();
  const [connection, active, history, live, mapping] = await Promise.all([
    loadEtaxConnectionRow(orgId),
    loadActiveVatSubmission(orgId, periodCode),
    db.query.etaxSubmissions.findMany({
      where: eq(etaxSubmissions.organizationId, orgId),
      orderBy: [desc(etaxSubmissions.updatedAt)],
      limit: 50,
    }),
    currentVatSnapshot(orgId, periodCode, now),
    loadEtaxMappingRow(orgId),
  ]);
  const current = active ? toEtaxSubmissionView(active) : null;
  return {
    periodCode,
    connection: connection ? toEtaxConnectionView(connection) : null,
    current,
    stale: current ? snapshotAmountsDiffer(current.snapshot, live.snapshot) : false,
    history: history.map(toEtaxSubmissionView),
    isVatPayer: live.isVatPayer,
    live: { ...live.snapshot.amounts, deadline: live.snapshot.deadline },
    mapping: mapping ? toEtaxMappingView(mapping) : null,
  };
}

/**
 * НӨАТ-ын тайланг eTax-д бэлтгэх — ноорог үүсгэнэ/шинэчилнэ. Тушаасан/хүлээн авсан
 * илгээлт байвал татгалзана (буцаасан бол шинээр үүснэ). «Бэлэн» ноорог дүн нь
 * зөрвөл НООРОГ руу буцна (хүн дахин хянана).
 */
export async function prepareVatSubmission(
  orgId: string,
  userId: string,
  periodCode: string
): Promise<{ submission: EtaxSubmissionView; created: boolean; revertedToDraft: boolean }> {
  if (!isPeriodCode(periodCode)) throw new EtaxError(ETAX_ERRORS.validation, "Тайлант үеийн код буруу");
  const now = new Date();
  const today = ulaanbaatarToday(now);
  const [{ snapshot }, connection, existing] = await Promise.all([
    currentVatSnapshot(orgId, periodCode, now),
    loadEtaxConnectionRow(orgId),
    loadActiveVatSubmission(orgId, periodCode),
  ]);
  const validation = validateVatSnapshot(snapshot, today);
  const environment = connection ? environmentOf(connection) : "production";

  if (existing && (existing.status === "submitted" || existing.status === "accepted"))
    throw new EtaxError(
      ETAX_ERRORS.state,
      `${periodCode} сарын НӨАТ-ын тайлан аль хэдийн «${ETAX_STATUS_LABELS[statusOf(existing.status)]}» — дахин бэлтгэхгүй (ТЕГ буцаасан бол «Буцаасан» гэж бүртгэнэ)`
    );

  if (existing) {
    const revertedToDraft =
      (existing.status === "ready" || existing.status === "saved") && snapshotAmountsDiffer(existing.snapshot as unknown as EtaxVatSnapshot, snapshot);
    const [updated] = await db
      .update(etaxSubmissions)
      .set({
        snapshot: asJson(snapshot),
        formCode: snapshot.formCode,
        validation,
        environment,
        status: revertedToDraft ? "draft" : existing.status,
        updatedAt: now,
      })
      .where(and(eq(etaxSubmissions.id, existing.id), eq(etaxSubmissions.status, existing.status)))
      .returning();
    if (!updated) throw stateChangedError("eTax илгээлт");
    return { submission: toEtaxSubmissionView(updated), created: false, revertedToDraft };
  }

  const [created] = await db
    .insert(etaxSubmissions)
    .values({
      organizationId: orgId,
      userId,
      form: "vat",
      formCode: snapshot.formCode,
      periodCode,
      status: "draft",
      environment,
      snapshot: asJson(snapshot),
      validation,
    })
    .returning();
  return { submission: toEtaxSubmissionView(created), created: true, revertedToDraft: false };
}

/**
 * Төлөв шилжүүлэх — зөвхөн `ETAX_TRANSITIONS`-ийн ирмэгээр, уншсан төлөвтөө нөхцөлтэй (C4).
 * «Бэлэн» болоход snapshot-ыг ДАХИН шалгана (алдаатай бол татгалзана); «Тушаасан»-д
 * ТЕГ-ийн дугаар заавал.
 */
export async function transitionEtaxSubmission(
  orgId: string,
  userId: string,
  input: { id: string; to: EtaxSubmissionStatus; taxReference?: string | null; note?: string | null }
): Promise<{ submission: EtaxSubmissionView; from: EtaxSubmissionStatus }> {
  const row = await loadEtaxSubmission(orgId, input.id);
  if (!row) throw new EtaxError(ETAX_ERRORS.state, "eTax илгээлт олдсонгүй");
  const from = statusOf(row.status);
  assertTransition(from, input.to);
  const now = new Date();
  const note = typeof input.note === "string" && input.note.trim() ? input.note.trim().slice(0, 1000) : null;
  const patch: Partial<SubmissionRow> = { status: input.to, updatedAt: now };

  if (input.to === "ready") {
    const validation = validateVatSnapshot(row.snapshot as unknown as EtaxVatSnapshot, ulaanbaatarToday(now));
    patch.validation = validation;
    if (validation.errors.length)
      throw new EtaxError(ETAX_ERRORS.validation, `Шалгалт алдаатай — ${validation.errors.join("; ")}`);
  }
  if (requiresTaxReference(input.to)) {
    const reference = normalizeTaxReference(input.taxReference) ?? (row.reportNo != null ? String(row.reportNo) : null);
    if (!reference) throw new EtaxError(ETAX_ERRORS.validation, "ТЕГ-ийн хүлээн авсан дугаарыг оруулна уу (eTax → Тайлангийн түүх)");
    patch.taxReference = reference;
    patch.submittedAt = now;
    patch.submittedByUserId = userId;
  } else if (input.taxReference !== undefined) {
    const reference = normalizeTaxReference(input.taxReference);
    if (reference) patch.taxReference = reference;
  }
  if (note !== null) patch.resultNote = note;
  if (input.to === "rejected" && !note && !row.resultNote)
    throw new EtaxError(ETAX_ERRORS.validation, "ТЕГ-ийн буцаасан шалтгааныг бичнэ үү");

  const [updated] = await db
    .update(etaxSubmissions)
    .set(patch)
    .where(and(eq(etaxSubmissions.id, row.id), eq(etaxSubmissions.organizationId, orgId), eq(etaxSubmissions.status, from)))
    .returning();
  if (!updated) throw stateChangedError("eTax илгээлт");
  return { submission: toEtaxSubmissionView(updated), from };
}
