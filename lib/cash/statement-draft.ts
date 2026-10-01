// Хянаж буй (хадгалаагүй) банкны хуулгын ноорог — хэрэглэгч бүрд НЭГ мөр
// (docs/dev/arap.md §5l). Хуудаснаас гарахад данс оноолт, бүртгэлийн сонголт
// алга болохгүй. GL-д юу ч бичихгүй; «Хадгалах» амжилттай болмогц устна.
// Эрх: дуудагч (route) кассын write шалгана; энд зөвхөн org × user scope.

import { and, eq } from "drizzle-orm";

import type {
  ParsedBankStatement,
  ParsedBankStatementRow,
  StatementDraft,
} from "@/lib/cash/bank-statement-types";
import { db } from "@/lib/db";
import { bankStatementDrafts, cashAccounts } from "@/lib/db/schema";

/** Нэг ноорогт хадгалах дээд мөр — saveBankStatement-ийн хязгаартай ижил. */
export const STATEMENT_DRAFT_MAX_ROWS = 5_000;


export async function loadStatementDraft(
  orgId: string,
  userId: string
): Promise<StatementDraft | null> {
  const row = await db.query.bankStatementDrafts.findFirst({
    where: and(
      eq(bankStatementDrafts.organizationId, orgId),
      eq(bankStatementDrafts.userId, userId)
    ),
  });
  if (!row) return null;
  return {
    cashAccountId: row.cashAccountId,
    statement: row.statement as ParsedBankStatement,
    rows: row.rows as ParsedBankStatementRow[],
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function saveStatementDraft(input: {
  orgId: string;
  userId: string;
  cashAccountId: string;
  statement: ParsedBankStatement;
  rows: ParsedBankStatementRow[];
}): Promise<void> {
  if (!Array.isArray(input.rows) || input.rows.length === 0)
    throw new Error("Ноорогт хадгалах мөр алга");
  if (input.rows.length > STATEMENT_DRAFT_MAX_ROWS)
    throw new Error(`Ноорогт ${STATEMENT_DRAFT_MAX_ROWS.toLocaleString("en-US")} хүртэл мөр хадгална`);
  if (!input.statement || typeof input.statement !== "object" || !input.statement.fileName)
    throw new Error("Хуулгын мэдээлэл дутуу");
  const account = await db.query.cashAccounts.findFirst({
    where: and(
      eq(cashAccounts.id, input.cashAccountId),
      eq(cashAccounts.organizationId, input.orgId),
      eq(cashAccounts.isActive, true)
    ),
    columns: { id: true },
  });
  if (!account) throw new Error("Идэвхтэй банкны данс олдсонгүй");
  // Эх хуулгын мөрүүдийг давхар хадгалахгүй — засварласан мөрүүд `rows`-д.
  const statement = { ...input.statement, rows: [] };
  await db
    .insert(bankStatementDrafts)
    .values({
      organizationId: input.orgId,
      userId: input.userId,
      cashAccountId: account.id,
      statement,
      rows: input.rows,
    })
    .onConflictDoUpdate({
      target: [bankStatementDrafts.organizationId, bankStatementDrafts.userId],
      set: { cashAccountId: account.id, statement, rows: input.rows, updatedAt: new Date() },
    });
}

export async function deleteStatementDraft(orgId: string, userId: string): Promise<void> {
  await db
    .delete(bankStatementDrafts)
    .where(
      and(
        eq(bankStatementDrafts.organizationId, orgId),
        eq(bankStatementDrafts.userId, userId)
      )
    );
}
