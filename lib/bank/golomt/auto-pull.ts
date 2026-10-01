// Голомтын хуулгын ӨДРИЙН АВТОМАТ татлага (docs/dev/bank-api.md §7) — ЭНГИЙН
// модуль ("use server" БИШ): ticker (lib/notifications/ticker.ts) ба cron route
// (`/api/cron/notifications?job=bank`) дуудна. Request scope ГАДНА — cookies(),
// revalidatePath() ДУУДАХГҮЙ, org-ийг параметрээр авна.
//
// - Зөвхөн `auto_fetch = true`, идэвхтэй холболттой байгууллага (анхнаасаа унтраалттай)
// - Байгууллага × өдөр НЭГ удаа: notification_runs (job golomt_statement_pull) claim
// - Данс бүрд сүүлийн татлагын дараах өдрөөс ӨЧИГДӨР хүртэл (анх 7 хоног) —
//   өнөөдрийн хуулга дуусаагүй тул татахгүй
// - Татсан хуулга GL-д БИЧИГДЭХГҮЙ: bank_statement_pulls-д хүлээгдэж, хэрэглэгч
//   «Хянах» → данс оноох → «Хадгалах» (ердийн saveBankStatement)
// - Өдрийн хаалтын үлдэгдэл bank_balance_snapshots-д (тулгалтад)
// - Үр дүн аудит (`system: true`) → rules.ts → кассын бичих эрхтэй гишүүдэд мэдэгдэл

import { and, eq, max } from "drizzle-orm";

import { logAuditEvent } from "@/lib/audit";
import { db } from "@/lib/db";
import {
  bankApiConnections,
  bankStatementPulls,
  cashAccounts,
  memberships,
  notificationRuns,
} from "@/lib/db/schema";
import { todayInUlaanbaatar } from "@/lib/periods/selection";

import { GolomtClient } from "./client";
import {
  GOLOMT_BANK_KEY,
  golomtCredentialsFromRow,
  pullGolomtStatement,
  saveGolomtBalanceSnapshots,
} from "./connection";
import { GOLOMT_STATEMENT_MAX_DAYS, golomtAccountId, isGolomtCashAccount } from "./constants";

export const GOLOMT_AUTO_PULL_JOB = "golomt_statement_pull";
/** Анх асаахад (өмнөх татлагагүй) хэдэн хоногийг татах. */
export const GOLOMT_AUTO_PULL_FIRST_DAYS = 7;

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/**
 * Дараагийн татлагын муж — ЦЭВЭР (тесттэй). Өчигдөр хүртэл; өмнөх татлагын
 * дараах өдрөөс, анх бол сүүлийн 7 хоног; удаан зогссон бол 92 хоногоор хязгаарлана.
 * Татах зүйлгүй бол null.
 */
export function golomtAutoPullRange(
  lastEndDate: string | null,
  today: string
): { startDate: string; endDate: string } | null {
  const endDate = addDays(today, -1);
  let startDate = lastEndDate ? addDays(lastEndDate, 1) : addDays(today, -GOLOMT_AUTO_PULL_FIRST_DAYS);
  const earliest = addDays(endDate, -(GOLOMT_STATEMENT_MAX_DAYS - 1));
  if (startDate < earliest) startDate = earliest;
  return startDate > endDate ? null : { startDate, endDate };
}

async function orgOwnerUserId(orgId: string): Promise<string> {
  const owner = await db.query.memberships.findFirst({
    where: and(eq(memberships.organizationId, orgId), eq(memberships.role, "owner")),
    columns: { userId: true },
  });
  if (!owner) throw new Error("Байгууллагын owner гишүүнчлэл олдсонгүй");
  return owner.userId;
}

type ConnectionRow = typeof bankApiConnections.$inferSelect;

export type GolomtAutoPullOrgResult = {
  accounts: number;
  newRows: number;
  errors: string[];
};

/** Нэг байгууллагын бүх Голомтын дансыг татна (claim-ийг дуудагч хийнэ). */
export async function pullGolomtForConnection(
  row: ConnectionRow,
  today: string
): Promise<GolomtAutoPullOrgResult> {
  const orgId = row.organizationId;
  const accounts = (
    await db.query.cashAccounts.findMany({
      where: and(eq(cashAccounts.organizationId, orgId), eq(cashAccounts.isActive, true)),
    })
  ).filter((account) => isGolomtCashAccount(account));

  const result: GolomtAutoPullOrgResult = { accounts: accounts.length, newRows: 0, errors: [] };
  const pulledAccounts: string[] = [];
  let client: GolomtClient | null = null;
  try {
    if (accounts.length > 0) {
      client = new GolomtClient(golomtCredentialsFromRow(row));
      await client.login();
    }
    for (const account of accounts) {
      const accountId = golomtAccountId(account.accountNumber);
      if (!accountId || !client) continue;
      const [last] = await db
        .select({ endDate: max(bankStatementPulls.endDate) })
        .from(bankStatementPulls)
        .where(eq(bankStatementPulls.cashAccountId, account.id));
      const range = golomtAutoPullRange(last?.endDate ?? null, today);
      if (!range) continue;
      try {
        const { result: pulled, entries } = await pullGolomtStatement({
          orgId,
          row,
          client,
          accountId,
          currency: account.currency,
          ...range,
        });
        // Мөргүй татлага ч бичигдэнэ — дараагийн мужийн эхлэл болно.
        await db.insert(bankStatementPulls).values({
          organizationId: orgId,
          cashAccountId: account.id,
          bank: GOLOMT_BANK_KEY,
          startDate: range.startDate,
          endDate: range.endDate,
          statement: pulled.statement,
          rowCount: pulled.statement.rows.length,
        });
        await saveGolomtBalanceSnapshots({
          orgId,
          cashAccountId: account.id,
          currency: account.currency,
          entries,
          ...range,
          today,
        });
        result.newRows += pulled.statement.rows.length;
        if (pulled.statement.rows.length > 0)
          pulledAccounts.push(`${account.name} (${pulled.statement.rows.length})`);
      } catch (caught) {
        // Данс тус бүрийн алдаа (хаагдсан, буруу дугаар) — бусад данс үргэлжилнэ.
        result.errors.push(
          `${account.name}: ${caught instanceof Error ? caught.message : String(caught)}`
        );
      }
    }
  } catch (caught) {
    // Нэвтрэлт / нууц тайлах — бүх данс унана.
    result.errors.push(caught instanceof Error ? caught.message : String(caught));
  }

  await db
    .update(bankApiConnections)
    .set({
      lastAutoFetchAt: new Date(),
      lastAutoFetchError: result.errors.length ? result.errors.join("; ").slice(0, 1000) : null,
    })
    .where(eq(bankApiConnections.id, row.id));

  const owner = await orgOwnerUserId(orgId);
  if (result.newRows > 0)
    await logAuditEvent({
      userId: owner,
      organizationId: orgId,
      system: true,
      action: "auto_fetch",
      entityType: "bank_api_connection",
      entityId: row.id,
      summary: `Голомтоос ${result.newRows} шинэ гүйлгээ татагдлаа — ${pulledAccounts.join(", ")}. Мөнгөн хөрөнгө → Банкны хуулга хэсэгт хянаж, данс оноогоод хадгална уу (GL-д автоматаар бичигдээгүй).`,
    });
  if (result.errors.length > 0)
    await logAuditEvent({
      userId: owner,
      organizationId: orgId,
      system: true,
      action: "auto_fetch_failed",
      entityType: "bank_api_connection",
      entityId: row.id,
      summary: `Голомтын хуулга автоматаар татагдсангүй — ${result.errors.join("; ").slice(0, 500)}`,
    });
  return result;
}

export type GolomtAutoPullRunResult = {
  today: string;
  connections: number;
  claimed: number;
  newRows: number;
  errors: { organizationId: string; error: string }[];
};

/** Бүх байгууллагын өдрийн татлага; байгууллага × өдөр НЭГ удаа (давхар дуудлага аюулгүй). */
export async function runGolomtAutoPull(
  today: string = todayInUlaanbaatar()
): Promise<GolomtAutoPullRunResult> {
  const connections = await db.query.bankApiConnections.findMany({
    where: and(
      eq(bankApiConnections.bank, GOLOMT_BANK_KEY),
      eq(bankApiConnections.isEnabled, true),
      eq(bankApiConnections.autoFetch, true)
    ),
  });
  const run: GolomtAutoPullRunResult = {
    today,
    connections: connections.length,
    claimed: 0,
    newRows: 0,
    errors: [],
  };
  for (const row of connections) {
    const [claim] = await db
      .insert(notificationRuns)
      .values({ organizationId: row.organizationId, job: GOLOMT_AUTO_PULL_JOB, periodKey: today })
      .onConflictDoNothing({
        target: [notificationRuns.job, notificationRuns.periodKey, notificationRuns.organizationId],
      })
      .returning({ id: notificationRuns.id });
    if (!claim) continue;
    run.claimed++;
    try {
      const result = await pullGolomtForConnection(row, today);
      run.newRows += result.newRows;
      await db
        .update(notificationRuns)
        .set({
          finishedAt: new Date(),
          emitted: result.newRows,
          error: result.errors.length ? result.errors.join("; ").slice(0, 1000) : null,
        })
        .where(eq(notificationRuns.id, claim.id));
      for (const error of result.errors)
        run.errors.push({ organizationId: row.organizationId, error });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      await db
        .update(notificationRuns)
        .set({ finishedAt: new Date(), error: message })
        .where(eq(notificationRuns.id, claim.id));
      run.errors.push({ organizationId: row.organizationId, error: message });
    }
  }
  return run;
}
