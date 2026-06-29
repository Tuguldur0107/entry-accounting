import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";
import {
  buildCashAccountCodeRules,
  validateCashAccountCode,
} from "@/lib/cash/account-code-validation";
import type { ParsedBankStatement } from "@/lib/cash/bank-statement-types";
import { db } from "@/lib/db";
import {
  bankStatementLines,
  bankStatements,
  cashAccounts,
  cashDocuments,
  chartOfAccounts,
  journalLines,
  journalVouchers,
  segmentConfigs,
  segmentValues,
} from "@/lib/db/schema";

export const runtime = "nodejs";

type SavePayload = ParsedBankStatement & {
  cashAccountId: string;
};

function chunks<T>(items: T[], size = 400) {
  const output: T[][] = [];
  for (let index = 0; index < items.length; index += size)
    output.push(items.slice(index, index + size));
  return output;
}

export async function POST(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId)
    return Response.json({ error: "Нэвтрэх шаардлагатай" }, { status: 401 });

  try {
    const payload = (await request.json()) as SavePayload;
    if (!payload.cashAccountId)
      throw new Error("Банкны Cash данс сонгоно уу");
    if (!payload.fileName || !payload.fileHash)
      throw new Error("Хуулгын файлын мэдээлэл дутуу");
    if (!Array.isArray(payload.rows) || payload.rows.length === 0)
      throw new Error("Хадгалах гүйлгээ алга");
    if (payload.rows.length > 5_000)
      throw new Error("Нэг удаад 5,000 хүртэл гүйлгээ хадгална");

    const [cashAccount, duplicate, glAccounts, configs, values] =
      await Promise.all([
        db.query.cashAccounts.findFirst({
          where: and(
            eq(cashAccounts.id, payload.cashAccountId),
            eq(cashAccounts.userId, userId),
            eq(cashAccounts.isActive, true)
          ),
        }),
        db.query.bankStatements.findFirst({
          where: and(
            eq(bankStatements.userId, userId),
            eq(bankStatements.fileHash, payload.fileHash)
          ),
          columns: { id: true },
        }),
        db.query.chartOfAccounts.findMany({
          where: eq(chartOfAccounts.userId, userId),
        }),
        db.query.segmentConfigs.findMany({
          where: eq(segmentConfigs.userId, userId),
        }),
        db.query.segmentValues.findMany({
          where: eq(segmentValues.userId, userId),
        }),
      ]);
    if (!cashAccount) throw new Error("Идэвхтэй банкны Cash данс олдсонгүй");
    if (duplicate) throw new Error("Энэ хуулга өмнө нь импортлогдсон байна");
    if (cashAccount.currency !== "MNT")
      throw new Error(
        `${cashAccount.currency} дансны хуулгад валютын ханшийн модуль шаардлагатай`
      );

    const accountCodeRules = buildCashAccountCodeRules(
      configs,
      values,
      glAccounts
    );

    const rows = payload.rows.map((row, index) => {
      const income = Number(row.income);
      const expense = Number(row.expense);
      if (
        !Number.isFinite(income) ||
        !Number.isFinite(expense) ||
        (income <= 0 && expense <= 0) ||
        (income > 0 && expense > 0)
      )
        throw new Error(`${index + 1}-р мөрийн орлого/зарлагын дүн буруу`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(row.transactionDate))
        throw new Error(`${index + 1}-р мөрийн огноо буруу`);
      let debitMain: string;
      let creditMain: string;
      try {
        debitMain = validateCashAccountCode(
          row.debitAccountNumber,
          accountCodeRules
        );
        creditMain = validateCashAccountCode(
          row.creditAccountNumber,
          accountCodeRules
        );
      } catch (caught) {
        const reason =
          caught instanceof Error ? caught.message : "дансны бүтэц буруу";
        throw new Error(`${index + 1}-р мөрийн DR/CR ${reason}`);
      }
      if (income > 0 && debitMain !== cashAccount.glAccountNumber)
        throw new Error(`${index + 1}-р мөрийн DR тал банкны данс биш байна`);
      if (expense > 0 && creditMain !== cashAccount.glAccountNumber)
        throw new Error(`${index + 1}-р мөрийн CR тал банкны данс биш байна`);

      return {
        ...row,
        income,
        expense,
        debitMain,
        creditMain,
        amount: income > 0 ? income : expense,
      };
    });

    const totalIncome = rows.reduce((sum, row) => sum + row.income, 0);
    const totalExpense = rows.reduce((sum, row) => sum + row.expense, 0);

    const statementId = await db.transaction(async (tx) => {
      const [statement] = await tx
        .insert(bankStatements)
        .values({
          userId,
          cashAccountId: cashAccount.id,
          fileName: payload.fileName.slice(0, 255),
          fileHash: payload.fileHash,
          bankName: payload.bankName?.slice(0, 120) || cashAccount.bankName,
          periodStart: payload.periodStart || null,
          periodEnd: payload.periodEnd || null,
          rowCount: rows.length,
          totalIncome: String(totalIncome),
          totalExpense: String(totalExpense),
          status: "posted",
        })
        .returning({ id: bankStatements.id });

      const postingRows = rows.map((row) => ({
        ...row,
        voucherId: randomUUID(),
        cashDocumentId: randomUUID(),
      }));

      for (const group of chunks(postingRows)) {
        await tx.insert(journalVouchers).values(
          group.map((row) => ({
            id: row.voucherId,
            userId,
            date: row.transactionDate,
            description: `[BANK ${statement.id.slice(0, 8)}-${row.rowNumber}] ${
              row.description || row.counterparty || "Банкны гүйлгээ"
            }`,
            status: "posted",
          }))
        );
      }

      const allJournalLines = postingRows.flatMap((row) => [
        {
          voucherId: row.voucherId,
          accountNumber: row.debitAccountNumber,
          debit: String(row.amount),
          credit: "0",
          description: row.description || row.counterparty,
          sortOrder: 0,
        },
        {
          voucherId: row.voucherId,
          accountNumber: row.creditAccountNumber,
          debit: "0",
          credit: String(row.amount),
          description: row.description || row.counterparty,
          sortOrder: 1,
        },
      ]);
      for (const group of chunks(allJournalLines))
        await tx.insert(journalLines).values(group);

      for (const group of chunks(postingRows)) {
        await tx.insert(cashDocuments).values(
          group.map((row) => ({
            id: row.cashDocumentId,
            userId,
            documentNo: `BS-${statement.id.slice(0, 8).toUpperCase()}-${
              row.rowNumber
            }`,
            documentType: row.income > 0 ? "receipt" : "payment",
            date: row.transactionDate,
            fromCashAccountId: row.expense > 0 ? cashAccount.id : null,
            toCashAccountId: row.income > 0 ? cashAccount.id : null,
            counterAccountNumber:
              row.income > 0 ? row.creditMain : row.debitMain,
            cashFlowCode:
              row.debitAccountNumber.split(".")[7] ||
              row.creditAccountNumber.split(".")[7] ||
              null,
            counterparty: row.counterparty || null,
            description: row.description || "Банкны гүйлгээ",
            amount: String(row.amount),
            status: "posted",
            voucherId: row.voucherId,
            postedAt: new Date(),
          }))
        );
      }

      const persistedLines = postingRows.map((row) => ({
        statementId: statement.id,
        rowNumber: row.rowNumber,
        transactionDate: row.transactionDate,
        valueDate: row.valueDate || null,
        description: row.description || "Банкны гүйлгээ",
        counterparty: row.counterparty || null,
        counterAccount: row.counterAccount || null,
        income: String(row.income),
        expense: String(row.expense),
        balance: row.balance == null ? null : String(row.balance),
        debitAccountNumber: row.debitAccountNumber,
        creditAccountNumber: row.creditAccountNumber,
        rawData: JSON.stringify(row.rawData),
        cashDocumentId: row.cashDocumentId,
        voucherId: row.voucherId,
      }));
      for (const group of chunks(persistedLines))
        await tx.insert(bankStatementLines).values(group);

      return statement.id;
    });

    revalidatePath("/cash");
    revalidatePath("/cash/accounts");
    revalidatePath("/cash/transactions");
    revalidatePath("/cash/statements");
    revalidatePath("/gl/journal");
    revalidatePath("/gl/reports");
    return Response.json({ id: statementId, rowCount: rows.length });
  } catch (caught) {
    const error = caught as { code?: string; message?: string };
    const message =
      error.code === "23505"
        ? "Энэ хуулга өмнө нь импортлогдсон байна"
        : error.message || "Хуулга хадгалж чадсангүй";
    return Response.json({ error: message }, { status: 400 });
  }
}
