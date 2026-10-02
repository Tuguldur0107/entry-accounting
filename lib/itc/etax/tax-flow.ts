// eTax API урсгал — DB давхарга (SERVER): байгууллага татах (entId), тушаах жагсаалт,
// маягтын загвар + нүдний холболт, ТЕГ-д хадгалах → илгээх → төлөв шинэчлэх.
// docs/dev/etax.md §4–§5. Дүрэм: snapshot-ын дүнг л холбосон нүдэнд буулгана (зохиохгүй);
// төлөвийн бичилт уншсан төлөвтөө нөхцөлтэй (C4); ТЕГ-ийн хариу мессеж хэрэглэгчид ил;
// нууц (token, NE-KEY) алдаа/лог/аудитад орохгүй.

import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { etaxConnections, etaxFormMappings, etaxSubmissions } from "@/lib/db/schema";
import { stateChangedError } from "@/lib/state-guard";
import { ulaanbaatarToday } from "@/lib/periods/document-date";

import {
  buildReportDataDetail,
  etaxPeriodOf,
  findHistoryRow,
  findVatReportRow,
  mappingProblems,
  normalizeCellMapping,
  pickEtaxOrg,
  reportHeadOf,
  saveFormDataBody,
  submitBody,
  taxStatusToEntry,
  type EtaxCellMapping,
  type EtaxFormCell,
  type EtaxReportHead,
  type EtaxReportListRow,
} from "./api";
import { fetchEtaxFormDetail, fetchEtaxHistory, fetchEtaxReportList, fetchEtaxUserOrgs, saveEtaxFormData, submitEtaxReport } from "./client";
import { ETAX_ERRORS, ETAX_TAX_STATUS_LABELS, ETAX_VAT_FIELDS, type EtaxSubmissionStatus } from "./constants";
import {
  loadEtaxConnectionRow,
  loadEtaxMappingRow,
  loadEtaxSubmission,
  loadEtaxTaxpayer,
  requireEtaxSession,
  etaxSessionOf,
  toEtaxConnectionView,
  toEtaxMappingView,
  toEtaxSubmissionView,
} from "./store";
import { EtaxError, assertTransition, validateVatSnapshot, type EtaxVatSnapshot } from "./submission";
import type { EtaxConnectionView, EtaxMappingView, EtaxReportChoice, EtaxSubmissionView } from "./types";

type SubmissionRow = typeof etaxSubmissions.$inferSelect;

const statusOf = (value: string): EtaxSubmissionStatus => value as EtaxSubmissionStatus;

/** §3.2 — ITC хэрэглэгчийн байгууллагуудаас Компанийн мэдээллийн регистрээр сонгож entId хадгална. */
export async function syncEtaxOrg(orgId: string): Promise<{ connection: EtaxConnectionView; orgCount: number }> {
  const row = await loadEtaxConnectionRow(orgId);
  if (!row) throw new EtaxError(ETAX_ERRORS.config, "Эхлээд eTax холболтоо хадгална уу");
  const session = etaxSessionOf(row);
  const [orgs, taxpayer] = await Promise.all([fetchEtaxUserOrgs(session.env, await session.auth()), loadEtaxTaxpayer(orgId)]);
  const org = pickEtaxOrg(orgs, taxpayer.registerNo);
  const now = new Date();
  await db
    .update(etaxConnections)
    .set({
      entId: org.entId,
      entName: org.name || null,
      entTin: org.tin || null,
      branchCode: org.branchCode,
      branchName: [org.branchName, org.subBranchName].filter(Boolean).join(" · ") || null,
      lastOrgSyncAt: now,
      lastCheckAt: now,
      lastCheckOkAt: now,
      lastCheckError: null,
      updatedAt: now,
    })
    .where(eq(etaxConnections.id, row.id));
  const saved = await loadEtaxConnectionRow(orgId);
  if (!saved) throw new EtaxError(ETAX_ERRORS.config, "eTax холболт олдсонгүй");
  return { connection: toEtaxConnectionView(saved), orgCount: orgs.length };
}

/** §3.3 — тушаах жагсаалтын ТӨРЛҮҮД (татварын төрөл × маягт, давхардалгүй) — холболтын сонголтод. */
export async function loadEtaxReportChoices(orgId: string): Promise<EtaxReportChoice[]> {
  const session = await requireEtaxSession(orgId);
  const rows = await fetchEtaxReportList(session.env, await session.auth(), session.entId);
  const seen = new Map<string, EtaxReportChoice>();
  for (const r of rows) {
    if (r.taxTypeId == null || r.formNo == null) continue;
    const key = `${r.taxTypeId}:${r.formNo}`;
    if (!seen.has(key))
      seen.set(key, {
        taxTypeId: r.taxTypeId,
        taxTypeName: r.taxTypeName,
        formNo: r.formNo,
        taxReportCode: r.taxReportCode,
        periodName: r.periodName,
        returnDueDate: r.returnDueDate,
        statusName: r.statusName,
      });
  }
  return [...seen.values()];
}

async function reportRowFor(orgId: string, periodCode: string, prefer: { taxTypeId: number; formNo: number }): Promise<{ row: EtaxReportListRow; env: Awaited<ReturnType<typeof requireEtaxSession>> }> {
  const session = await requireEtaxSession(orgId);
  const rows = await fetchEtaxReportList(session.env, await session.auth(), session.entId);
  return { row: findVatReportRow(rows, periodCode, prefer), env: session };
}

/**
 * §3.7 — маягтын загварыг ТЕГ-ээс татаж нүдний жагсаалтыг холболтод хадгална (татварын
 * төрөл/маягт сонгосон эсвэл солигдсон үед). Загвар тайлант үе шаарддаг — одоогийн сар.
 */
export async function fetchEtaxTemplate(
  orgId: string,
  userId: string,
  input: { taxTypeId: number; formNo: number; taxTypeName?: string | null; periodCode: string }
): Promise<EtaxMappingView> {
  const { row: listRow, env: session } = await reportRowFor(orgId, input.periodCode, input);
  const head = reportHeadOf(listRow);
  const template = await fetchEtaxFormDetail(session.env, await session.auth(), {
    entId: session.entId,
    branchId: head.branchId,
    formNo: head.formNo,
    taxTypeId: head.taxTypeId,
    year: head.year,
    period: head.period,
  });
  const existing = await loadEtaxMappingRow(orgId);
  const now = new Date();
  const cells = template.cells as unknown as Record<string, unknown>[];
  const patch = {
    userId,
    formNo: head.formNo,
    taxTypeId: head.taxTypeId,
    taxTypeName: input.taxTypeName ?? listRow.taxTypeName ?? null,
    reportCode: template.reportCode || listRow.taxReportCode || null,
    templateVersion: template.version,
    templateCells: cells,
    templateFetchedAt: now,
    updatedAt: now,
  };
  if (existing) {
    const formChanged = existing.formNo !== head.formNo || existing.taxTypeId !== head.taxTypeId;
    await db
      .update(etaxFormMappings)
      .set({ ...patch, ...(formChanged ? { cells: {} } : {}) })
      .where(eq(etaxFormMappings.id, existing.id));
  } else {
    await db.insert(etaxFormMappings).values({ ...patch, organizationId: orgId, form: "vat", cells: {} });
  }
  const saved = await loadEtaxMappingRow(orgId);
  if (!saved) throw new EtaxError(ETAX_ERRORS.config, "Холболт хадгалагдсангүй");
  return toEtaxMappingView(saved);
}

/** Нүдний холболт хадгалах — загвар татагдсан байх ёстой; дутуу байж болно (хадгалахад л шалгана). */
export async function saveEtaxMapping(orgId: string, userId: string, cells: unknown): Promise<EtaxMappingView> {
  const existing = await loadEtaxMappingRow(orgId);
  if (!existing) throw new EtaxError(ETAX_ERRORS.config, "Эхлээд маягтын загварыг ТЕГ-ээс татна уу");
  const mapping = normalizeCellMapping(cells);
  const templateCells = (existing.templateCells ?? []) as unknown as EtaxFormCell[];
  const unknown = ETAX_VAT_FIELDS.map((f) => mapping[f]).filter((k): k is string => !!k && !templateCells.some((c) => c.key === k));
  if (unknown.length) throw new EtaxError(ETAX_ERRORS.validation, `Загварт байхгүй нүд: ${unknown.join(", ")}`);
  await db
    .update(etaxFormMappings)
    .set({ cells: mapping as Record<string, string | null>, userId, updatedAt: new Date() })
    .where(eq(etaxFormMappings.id, existing.id));
  const saved = await loadEtaxMappingRow(orgId);
  return toEtaxMappingView(saved!);
}

function requireMapping(mappingRow: Awaited<ReturnType<typeof loadEtaxMappingRow>>): { mapping: EtaxCellMapping; cells: EtaxFormCell[]; formNo: number; taxTypeId: number } {
  if (!mappingRow) throw new EtaxError(ETAX_ERRORS.config, "Маягтын нүдний холболт тохируулаагүй — eTax тохиргоонд загвар татаж холбоно уу");
  const cells = (mappingRow.templateCells ?? []) as unknown as EtaxFormCell[];
  const mapping = normalizeCellMapping(mappingRow.cells);
  const problems = mappingProblems(mapping, cells.length ? cells : null);
  if (problems.length) throw new EtaxError(ETAX_ERRORS.validation, `Маягтын холболт дутуу: ${problems.join("; ")}`);
  return { mapping, cells, formNo: mappingRow.formNo, taxTypeId: mappingRow.taxTypeId };
}

/**
 * §3.9 — «Бэлэн» / «ТЕГ-д хадгалсан» илгээлтийг ТЕГ-д ХАДГАЛНА (reportNo авна, ТЕГ-ийн төлөв 2).
 * Илгээхгүй. Snapshot-ыг дахин шалгана; дүн зөрсөн (stale) бол дуудагч бэлтгэх үйлдлээр
 * шинэчилсэн байх ёстой (энд snapshot-ыг л явуулна).
 */
export async function saveSubmissionToTax(orgId: string, userId: string, submissionId: string): Promise<{ submission: EtaxSubmissionView; message: string }> {
  const row = await loadEtaxSubmission(orgId, submissionId);
  if (!row) throw new EtaxError(ETAX_ERRORS.state, "eTax илгээлт олдсонгүй");
  const from = statusOf(row.status);
  assertTransition(from, "saved");
  const snapshot = row.snapshot as unknown as EtaxVatSnapshot;
  const validation = validateVatSnapshot(snapshot, ulaanbaatarToday());
  if (validation.errors.length) throw new EtaxError(ETAX_ERRORS.validation, `Шалгалт алдаатай — ${validation.errors.join("; ")}`);
  const { mapping, cells, formNo, taxTypeId } = requireMapping(await loadEtaxMappingRow(orgId));
  const { row: listRow, env: session } = await reportRowFor(orgId, row.periodCode, { taxTypeId, formNo });
  const head: EtaxReportHead = reportHeadOf(listRow, row.reportNo ?? listRow.reportNo);
  const detail = buildReportDataDetail(snapshot, mapping, cells);
  const result = await saveEtaxFormData(session.env, await session.auth(), session.entId, saveFormDataBody(head, detail));
  const now = new Date();
  const [updated] = await db
    .update(etaxSubmissions)
    .set({
      status: "saved",
      reportNo: result.reportNo,
      taxReference: String(result.reportNo),
      taxStatusId: result.statusId ?? 2,
      taxStatusName: ETAX_TAX_STATUS_LABELS[result.statusId ?? 2] ?? null,
      taxSyncedAt: now,
      taxHead: { ...head, reportNo: result.reportNo } as unknown as Record<string, unknown>,
      validation,
      resultNote: result.message || null,
      submittedByUserId: userId,
      updatedAt: now,
    })
    .where(and(eq(etaxSubmissions.id, row.id), eq(etaxSubmissions.organizationId, orgId), eq(etaxSubmissions.status, from)))
    .returning();
  if (!updated) throw stateChangedError("eTax илгээлт");
  return { submission: toEtaxSubmissionView(updated), message: result.message };
}

/** §3.10 — ТЕГ-д хадгалсан тайланг ИЛГЭЭНЭ (ТЕГ загварын шалгуураа тулгана, алдаа ил). */
export async function submitSubmissionToTax(orgId: string, userId: string, submissionId: string): Promise<{ submission: EtaxSubmissionView; message: string }> {
  const row = await loadEtaxSubmission(orgId, submissionId);
  if (!row) throw new EtaxError(ETAX_ERRORS.state, "eTax илгээлт олдсонгүй");
  const from = statusOf(row.status);
  if (from !== "saved") throw new EtaxError(ETAX_ERRORS.state, "Эхлээд «ТЕГ-д хадгалах» хийнэ");
  assertTransition(from, "submitted");
  const head = row.taxHead as unknown as EtaxReportHead | null;
  if (!head || !row.reportNo) throw new EtaxError(ETAX_ERRORS.state, "ТЕГ-ийн толгой/reportNo алга — дахин хадгална уу");
  const session = await requireEtaxSession(orgId);
  const result = await submitEtaxReport(session.env, await session.auth(), session.entId, submitBody({ ...head, reportNo: row.reportNo }));
  const now = new Date();
  const [updated] = await db
    .update(etaxSubmissions)
    .set({
      status: "submitted",
      taxReference: String(row.reportNo),
      taxStatusId: 3,
      taxStatusName: ETAX_TAX_STATUS_LABELS[3],
      taxSyncedAt: now,
      submittedAt: now,
      submittedByUserId: userId,
      resultNote: result.message || null,
      updatedAt: now,
    })
    .where(and(eq(etaxSubmissions.id, row.id), eq(etaxSubmissions.organizationId, orgId), eq(etaxSubmissions.status, from)))
    .returning();
  if (!updated) throw stateChangedError("eTax илгээлт");
  return { submission: toEtaxSubmissionView(updated), message: result.message };
}

/**
 * §3.4 — ТЕГ-ийн түүхээс төлөв уншиж Entry-д тусгана: 11 → accepted, 8 → rejected (зөвхөн
 * submitted-ээс), 2/3/6 → зөвхөн taxStatus шинэчилнэ. Танигдахгүй код → төлөв хөндөхгүй.
 */
export async function refreshTaxStatus(orgId: string, submissionId: string): Promise<{ submission: EtaxSubmissionView; found: boolean }> {
  const row = await loadEtaxSubmission(orgId, submissionId);
  if (!row) throw new EtaxError(ETAX_ERRORS.state, "eTax илгээлт олдсонгүй");
  const from = statusOf(row.status);
  const session = await requireEtaxSession(orgId);
  const { year, period } = etaxPeriodOf(row.periodCode);
  const head = row.taxHead as unknown as EtaxReportHead | null;
  const history = await fetchEtaxHistory(session.env, await session.auth(), session.entId, year);
  const match = findHistoryRow(history, { reportNo: row.reportNo, year, period, formNo: head?.formNo ?? null });
  const now = new Date();
  if (!match) {
    const [updated] = await db.update(etaxSubmissions).set({ taxSyncedAt: now, updatedAt: now }).where(eq(etaxSubmissions.id, row.id)).returning();
    return { submission: toEtaxSubmissionView(updated), found: false };
  }
  const mapped = taxStatusToEntry(match.statusId);
  // Урагш л: saved → submitted (вэбээс илгээсэн), submitted → accepted | rejected. Ухрахгүй.
  const next: EtaxSubmissionStatus | null =
    from === "saved" && mapped === "submitted"
      ? "submitted"
      : from === "submitted" && (mapped === "accepted" || mapped === "rejected")
        ? mapped
        : null;
  const patch: Partial<SubmissionRow> = {
    taxStatusId: match.statusId,
    taxStatusName: match.statusName || (match.statusId != null ? ETAX_TAX_STATUS_LABELS[match.statusId] ?? null : null),
    taxSyncedAt: now,
    updatedAt: now,
    ...(row.reportNo == null && /^\d+$/.test(match.reportNo) ? { reportNo: Number(match.reportNo), taxReference: match.reportNo } : {}),
  };
  if (next) {
    patch.status = next;
    if (next === "submitted") {
      patch.submittedAt = now;
      patch.taxReference = row.taxReference ?? (row.reportNo != null ? String(row.reportNo) : match.reportNo || null);
    }
    if (next === "rejected") patch.resultNote = `ТЕГ буцаасан (${match.statusName || "код 8"})${match.receivedEmpName ? ` — ${match.receivedEmpName}` : ""}`;
  }
  const [updated] = await db
    .update(etaxSubmissions)
    .set(patch)
    .where(and(eq(etaxSubmissions.id, row.id), eq(etaxSubmissions.status, from)))
    .returning();
  if (!updated) throw stateChangedError("eTax илгээлт");
  return { submission: toEtaxSubmissionView(updated), found: true };
}
