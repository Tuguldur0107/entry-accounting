// Голомтын холболтын DB давхарга — тохиргоо унших/хадгалах, нууц тайлах,
// хуулга татаж импортын хэлбэрт оруулах. Эрхийн шалгалт action-д
// (lib/actions/bank-api.ts); энд зөвхөн orgId-оор scope.

import { and, desc, eq, isNull, sql } from "drizzle-orm";

import { decryptSecret } from "@/lib/ai/crypto";
import { db } from "@/lib/db";
import {
  bankApiConnections,
  bankBalanceSnapshots,
  bankStatementPulls,
  cashAccounts,
} from "@/lib/db/schema";
import type { ParsedBankStatement } from "@/lib/cash/bank-statement-types";
import { loadImportedExternalRefs } from "@/lib/cash/statement-external-refs";

import { GolomtClient, type GolomtCredentials } from "./client";
import {
  isGolomtEnvironment,
  type GolomtConnectionView,
  type GolomtPendingPull,
} from "./constants";
import {
  golomtDailyClosingBalances,
  golomtStatementToParsed,
  type GolomtStatementEntry,
  type GolomtStatementResult,
} from "./statement";

export const GOLOMT_BANK_KEY = "golomt";

export async function loadGolomtConnectionRow(orgId: string) {
  return db.query.bankApiConnections.findFirst({
    where: and(
      eq(bankApiConnections.organizationId, orgId),
      eq(bankApiConnections.bank, GOLOMT_BANK_KEY)
    ),
  });
}

type ConnectionRow = NonNullable<Awaited<ReturnType<typeof loadGolomtConnectionRow>>>;

export function toGolomtConnectionView(row: ConnectionRow): GolomtConnectionView {
  return {
    environment: isGolomtEnvironment(row.environment) ? row.environment : "uat",
    username: row.username,
    clientId: row.clientId ?? "",
    registerNo: row.registerNo,
    isEnabled: row.isEnabled,
    hasSecrets: Boolean(row.passwordEnc && row.sessionKeyEnc && row.ivKeyEnc),
    lastCheckedAt: row.lastCheckedAt ? row.lastCheckedAt.toISOString() : null,
    lastCheckError: row.lastCheckError,
    autoFetch: row.autoFetch,
    lastAutoFetchAt: row.lastAutoFetchAt ? row.lastAutoFetchAt.toISOString() : null,
    lastAutoFetchError: row.lastAutoFetchError,
  };
}

/** Нууцыг тайлна; AUTH_SECRET солигдсон г.м. тайлагдахгүй бол ил алдаа. */
export function golomtCredentialsFromRow(row: ConnectionRow): GolomtCredentials {
  const password = decryptSecret(row.passwordEnc);
  const sessionKey = decryptSecret(row.sessionKeyEnc);
  const ivKey = decryptSecret(row.ivKeyEnc);
  if (!password || !sessionKey || !ivKey)
    throw new Error(
      "Голомтын нууц мэдээллийг тайлж чадсангүй — холболтын тохиргоонд нууц үг, түлхүүрээ дахин оруулна уу"
    );
  if (!isGolomtEnvironment(row.environment))
    throw new Error("Голомтын холболтын орчин буруу");
  return {
    environment: row.environment,
    username: row.username,
    password,
    sessionKey,
    ivKey,
    clientId: row.clientId,
    registerNo: row.registerNo,
  };
}

/** Шалгалт/татлагын үр дүнг тэмдэглэнэ (алдаа нь нууцгүй текст). */
export async function recordGolomtCheck(
  connectionId: string,
  error: string | null
) {
  await db
    .update(bankApiConnections)
    .set({ lastCheckedAt: new Date(), lastCheckError: error })
    .where(eq(bankApiConnections.id, connectionId));
}

type PullInput = {
  orgId: string;
  row: ConnectionRow;
  /** Нэг session-оор олон данс татах бол (автомат татлага) дамжуулна. */
  client?: GolomtClient;
  accountId: string;
  currency: string;
  startDate: string;
  endDate: string;
};

/**
 * Хуулга татаж импортын хэлбэрт оруулна (өмнө хадгалагдсан мөрийг алгасна)
 * + банкны түүхий мөрүүд (өдрийн хаалтын үлдэгдэл бодоход). Түүхий мөрийг
 * client руу буцаахгүй — action зөвхөн `result`-ийг буцаана.
 */
export async function pullGolomtStatement(
  input: PullInput
): Promise<{ result: GolomtStatementResult; entries: GolomtStatementEntry[] }> {
  const client = input.client ?? new GolomtClient(golomtCredentialsFromRow(input.row));
  const entries = await client.fetchStatement(
    input.accountId,
    input.startDate,
    input.endDate
  );
  // Эхлээд бүх мөрийн түлхүүрийг бодоод, өмнө хадгалагдсаныг DB-ээс нэг
  // дор шалгана — дараа нь алгасна.
  const base = {
    accountId: input.accountId,
    currency: input.currency,
    startDate: input.startDate,
    endDate: input.endDate,
    entries,
  };
  const draft = golomtStatementToParsed(base);
  const refs = draft.statement.rows
    .map((row) => row.externalRef)
    .filter((ref): ref is string => !!ref);
  const alreadyImported = await loadImportedExternalRefs(input.orgId, refs);
  const result =
    alreadyImported.size === 0
      ? draft
      : golomtStatementToParsed({ ...base, alreadyImported });
  return { result, entries };
}

export async function fetchGolomtStatementForOrg(
  input: PullInput
): Promise<GolomtStatementResult> {
  return (await pullGolomtStatement(input)).result;
}

/**
 * Өдрийн хаалтын үлдэгдлийг хадгална (данс × огноо upsert). Зөвхөн БҮТЭН
 * өнгөрсөн өдрүүд (`< today`) — өнөөдрийн хуулга дуусаагүй. Мөр ирээгүй
 * бол юу ч бичихгүй (үлдэгдэл таахгүй). Бичсэн өдрийн тоо.
 */
export async function saveGolomtBalanceSnapshots(input: {
  orgId: string;
  cashAccountId: string;
  currency: string;
  entries: GolomtStatementEntry[];
  startDate: string;
  endDate: string;
  today: string;
}): Promise<number> {
  const lastComplete = new Date(Date.parse(`${input.today}T00:00:00Z`) - 86_400_000)
    .toISOString()
    .slice(0, 10);
  const endDate = input.endDate < lastComplete ? input.endDate : lastComplete;
  if (input.startDate > endDate) return 0;
  const days = golomtDailyClosingBalances(input.entries, input.startDate, endDate);
  if (days.length === 0) return 0;
  await db
    .insert(bankBalanceSnapshots)
    .values(
      days.map((day) => ({
        organizationId: input.orgId,
        cashAccountId: input.cashAccountId,
        bank: GOLOMT_BANK_KEY,
        asOfDate: day.date,
        balance: day.balance.toFixed(2),
        currency: input.currency.toUpperCase(),
      }))
    )
    .onConflictDoUpdate({
      target: [bankBalanceSnapshots.cashAccountId, bankBalanceSnapshots.asOfDate],
      set: {
        balance: sql`excluded.balance`,
        currency: sql`excluded.currency`,
        createdAt: new Date(),
      },
    });
  return days.length;
}

function pullRefs(statement: ParsedBankStatement): string[] {
  return statement.rows
    .map((row) => row.externalRef)
    .filter((ref): ref is string => !!ref);
}

/**
 * Хэрэгсэхгүй болгоогүй, импортлогдоогүй мөртэй автомат татлагууд. Мөр
 * хадгалагдсан эсэхийг externalRef-ээр тооцно — хэрэглэгч гараар татаж
 * хадгалсан ч энд давхар харагдахгүй.
 */
export async function loadGolomtPendingPulls(orgId: string): Promise<GolomtPendingPull[]> {
  const pulls = await db
    .select({
      id: bankStatementPulls.id,
      cashAccountId: bankStatementPulls.cashAccountId,
      cashAccountName: cashAccounts.name,
      startDate: bankStatementPulls.startDate,
      endDate: bankStatementPulls.endDate,
      statement: bankStatementPulls.statement,
      createdAt: bankStatementPulls.createdAt,
    })
    .from(bankStatementPulls)
    .innerJoin(cashAccounts, eq(cashAccounts.id, bankStatementPulls.cashAccountId))
    .where(
      and(
        eq(bankStatementPulls.organizationId, orgId),
        isNull(bankStatementPulls.dismissedAt),
        sql`${bankStatementPulls.rowCount} > 0`
      )
    )
    .orderBy(desc(bankStatementPulls.endDate))
    .limit(50);
  if (pulls.length === 0) return [];
  const allRefs = pulls.flatMap((pull) => pullRefs(pull.statement as ParsedBankStatement));
  const imported = await loadImportedExternalRefs(orgId, allRefs);
  return pulls
    .map((pull) => ({
      id: pull.id,
      cashAccountId: pull.cashAccountId,
      cashAccountName: pull.cashAccountName,
      startDate: pull.startDate,
      endDate: pull.endDate,
      newRows: pullRefs(pull.statement as ParsedBankStatement).filter((ref) => !imported.has(ref))
        .length,
      createdAt: pull.createdAt.toISOString(),
    }))
    .filter((pull) => pull.newRows > 0);
}

/**
 * Хүлээгдэж буй татлагыг импортын хүснэгтэд ачаалах хэлбэр — одоо ч
 * импортлогдоогүй мөрүүд л (дугаарлалт шинээр).
 */
export async function loadGolomtPullStatement(
  orgId: string,
  pullId: string
): Promise<{ cashAccountId: string; statement: ParsedBankStatement; skipped: number } | null> {
  const pull = await db.query.bankStatementPulls.findFirst({
    where: and(
      eq(bankStatementPulls.id, pullId),
      eq(bankStatementPulls.organizationId, orgId),
      isNull(bankStatementPulls.dismissedAt)
    ),
  });
  if (!pull) return null;
  const statement = pull.statement as ParsedBankStatement;
  const imported = await loadImportedExternalRefs(orgId, pullRefs(statement));
  const rows = statement.rows
    .filter((row) => !row.externalRef || !imported.has(row.externalRef))
    .map((row, index) => ({ ...row, rowNumber: index + 1 }));
  return {
    cashAccountId: pull.cashAccountId,
    statement: { ...statement, rows },
    skipped: statement.rows.length - rows.length,
  };
}
