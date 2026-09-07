"use server";

// Тайлангийн задаргааны өгөгдөл — нэг үндсэн дансны хуулгыг журналын
// түвшинд (drill панелийн мөр болгож) буцаана. Баланс/тайлангийн үзүүлэлт
// дээр дарж данс руу, дансаар нь журнал руу "хамгийн гүн" задрах гинжийн
// сервер тал. GL тайлантай ИЖИЛ дүрэм: posted + reversed журнал тоологдоно
// (эх + буцаалт нэт 0).

import { and, eq, inArray, lte, or, sql } from "drizzle-orm";

import { getActiveOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { journalLines, journalVouchers } from "@/lib/db/schema";
import type { DrillPanelRow } from "@/lib/store/panel-store";
import { actionError, type ActionResult } from "@/lib/action-result";

export async function getAccountDrillRows(input: {
  /** Үндсэн данс — 8 оронтой дугаар. */
  mainAccount: string;
  from: string;
  to: string;
}): Promise<
  ActionResult<{ rows: DrillPanelRow[]; opening: number; closing: number }>
> {
  try {
    return await getAccountDrillRowsCore(input);
  } catch (caught) {
    return actionError(
      "getAccountDrillRows",
      caught,
      "Дансны задаргаа ачаалагдсангүй"
    );
  }
}

async function getAccountDrillRowsCore(input: {
  mainAccount: string;
  from: string;
  to: string;
}) {
  const { orgId } = await getActiveOrg();
  const main = input.mainAccount.trim();
  if (!/^\d{8}$/.test(main)) throw new Error("Үндсэн дансны дугаар буруу");
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(input.from) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(input.to)
  )
    throw new Error("Огнооны формат буруу");

  const lineRows = await db
    .select({
      voucherId: journalLines.voucherId,
      date: journalVouchers.date,
      description: journalVouchers.description,
      status: journalVouchers.status,
      debit: journalLines.debit,
      credit: journalLines.credit,
    })
    .from(journalLines)
    .innerJoin(journalVouchers, eq(journalLines.voucherId, journalVouchers.id))
    .where(
      and(
        eq(journalVouchers.organizationId, orgId),
        inArray(journalVouchers.status, ["posted", "reversed"]),
        lte(journalVouchers.date, input.to),
        or(
          eq(sql`split_part(${journalLines.accountNumber}, '.', 3)`, main),
          eq(journalLines.accountNumber, main)
        )
      )
    );

  let opening = 0;
  const byVoucher = new Map<string, DrillPanelRow>();
  for (const line of lineRows) {
    const net = Number(line.debit) - Number(line.credit);
    if (line.date < input.from) {
      opening += net;
      continue;
    }
    const existing = byVoucher.get(line.voucherId);
    if (existing) {
      existing.amount = Math.round((existing.amount + net) * 100) / 100;
      existing.lineCount += 1;
    } else {
      byVoucher.set(line.voucherId, {
        id: line.voucherId,
        date: line.date,
        description: line.description,
        module: "",
        lineCount: 1,
        amount: Math.round(net * 100) / 100,
        status: line.status,
      });
    }
  }

  const rows = [...byVoucher.values()].sort((a, b) =>
    a.date < b.date ? 1 : a.date > b.date ? -1 : 0
  );
  opening = Math.round(opening * 100) / 100;
  const closing =
    Math.round(
      (opening + rows.reduce((sum, row) => sum + row.amount, 0)) * 100
    ) / 100;

  return { rows, opening, closing };
}
