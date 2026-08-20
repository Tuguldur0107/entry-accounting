"use server";

// НӨАТ модулийн server actions — сарын тайлан + тооцооны ноорог журнал.
//
// Knowledge: knowledge/01-онол-хууль-стандарт/tax/vat.md,
// knowledge/02-нягтлан-бодох-мэргэжлийн/workflows/vat-return.md.
// Тооцооны журнал ЗААВАЛ ноорог үүснэ (human-in-the-loop §9) — нягтланч
// шалгаад GL журналаас Post дарна.

import { revalidatePath } from "next/cache";
import { and, eq, gte, inArray, lte } from "drizzle-orm";

import { getActiveOrg, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  cashAccounts,
  chartOfAccounts,
  journalLines,
  journalVouchers,
  segmentConfigs,
  segmentValues,
} from "@/lib/db/schema";
import { createVoucher } from "@/lib/actions/gl";
import { unwrapAction } from "@/lib/action-result";
import { loadVatSettings } from "@/lib/vat/settings";
import { computeVatReturn, type VatReturnSummary } from "@/lib/vat/return";
import { extractMainAccount } from "@/lib/reports/balances";
import { SEGMENT_DEFS } from "@/lib/constants/standard-accounts";
import { buildSegCode } from "@/lib/grid/segments";
import { isPeriodCode, periodRange } from "@/lib/periods/period";

/** Идэвхтэй сегментүүдээр бүтэн posting код угсрагч (S9 default "GL"). */
async function vatPostingCodeBuilder(orgId: string) {
  const [configs, values] = await Promise.all([
    db.query.segmentConfigs.findMany({
      where: eq(segmentConfigs.organizationId, orgId),
    }),
    db.query.segmentValues.findMany({
      where: and(
        eq(segmentValues.organizationId, orgId),
        eq(segmentValues.isEnabled, true)
      ),
    }),
  ]);
  const configMap = new Map(configs.map((config) => [config.segmentId, config]));
  const activeSegIds = SEGMENT_DEFS.filter(
    (definition) =>
      definition.id === 3 || configMap.get(definition.id)?.isEnabled === true
  ).map((definition) => definition.id);
  const defaults: Record<number, string> = {};
  for (const segmentId of activeSegIds) {
    const options = values.filter((value) => value.segmentId === segmentId);
    if (options.length === 1) defaults[segmentId] = options[0].code;
  }
  return (mainAccount: string) =>
    buildSegCode({ ...defaults, 3: mainAccount }, activeSegIds, defaults);
}

const settlementRefOf = (periodCode: string) => `vat-settlement:${periodCode}`;

/**
 * АР/АП панелийн "НӨАТ нэмэх" товчны default-ууд — нэвтэрсэн хэрэглэгчийн
 * тохиргооноос бүтэн segment кодтой НӨАТ-ийн данс + хувь.
 */
export async function getVatLineDefaults(): Promise<{
  /** Гаралтын НӨАТ (АР нэхэмжлэлийн мөрөнд). */
  outputCode: string;
  /** Оролтын НӨАТ (АП нэхэмжлэхийн мөрөнд). */
  inputCode: string;
  ratePercent: number;
}> {
  const { orgId, userId } = await getActiveOrg();
  const settings = await loadVatSettings(orgId, userId);
  const code = await vatPostingCodeBuilder(orgId);
  return {
    outputCode: code(settings.outputVatAccountNumber),
    inputCode: code(settings.inputVatAccountNumber),
    ratePercent: Number(settings.vatRatePercent),
  };
}

export type VatReturnData = {
  summary: VatReturnSummary;
  settings: {
    outputVatAccountNumber: string;
    inputVatAccountNumber: string;
    vatRatePercent: number;
  };
  /** Энэ сарын тооцооны журнал аль хэдийн үүссэн бол. */
  settlement: { id: string; status: string; date: string } | null;
  /** Тооцооны төлбөрийн мөрөнд сонгох банкны данс. */
  cashAccounts: { id: string; name: string; glAccountNumber: string }[];
  /** Хуанлийн оны эхнээс тайлант үеийн эцэс хүртэлх борлуулалтын орлого (5XXXXXXX, Кт−Дт). */
  yearSales: number;
  /** НӨАТ төлөгчөөр бүртгүүлэх борлуулалтын босго (2026: 400 сая ₮). */
  registrationThreshold: number;
};

/** НӨАТ-ийн бүртгэлийн босго — 2026 оны шинэчлэлт (tax/2026-updates.md). */
const VAT_REGISTRATION_THRESHOLD_MNT = 400_000_000;

export async function getVatReturnData(
  periodCode: string
): Promise<VatReturnData> {
  const { orgId, userId } = await getActiveOrg();
  if (!isPeriodCode(periodCode)) throw new Error("Тайлант үеийн код буруу байна");

  const settings = await loadVatSettings(orgId, userId);
  const { startDate, endDate } = periodRange(periodCode);
  // Бүртгэлийн босгын хяналт — хуанлийн оны эхнээс тайлант үеийн эцэс хүртэл.
  const yearStart = `${periodCode.slice(0, 4)}-01-01`;

  const [rows, settlementVoucher, accounts, yearRows] = await Promise.all([
    db
      .select({
        accountNumber: journalLines.accountNumber,
        debit: journalLines.debit,
        credit: journalLines.credit,
        date: journalVouchers.date,
        status: journalVouchers.status,
      })
      .from(journalLines)
      .innerJoin(journalVouchers, eq(journalLines.voucherId, journalVouchers.id))
      .where(
        and(
          eq(journalVouchers.organizationId, orgId),
          gte(journalVouchers.date, startDate),
          lte(journalVouchers.date, endDate),
          inArray(journalVouchers.status, ["posted", "reversed"])
        )
      ),
    db.query.journalVouchers.findFirst({
      where: and(
        eq(journalVouchers.organizationId, orgId),
        eq(journalVouchers.externalRef, settlementRefOf(periodCode))
      ),
      columns: { id: true, status: true, date: true },
    }),
    db.query.cashAccounts.findMany({
      where: and(eq(cashAccounts.organizationId, orgId), eq(cashAccounts.isActive, true)),
      columns: { id: true, name: true, glAccountNumber: true },
    }),
    db
      .select({
        accountNumber: journalLines.accountNumber,
        debit: journalLines.debit,
        credit: journalLines.credit,
      })
      .from(journalLines)
      .innerJoin(journalVouchers, eq(journalLines.voucherId, journalVouchers.id))
      .where(
        and(
          eq(journalVouchers.organizationId, orgId),
          gte(journalVouchers.date, yearStart),
          lte(journalVouchers.date, endDate),
          inArray(journalVouchers.status, ["posted", "reversed"])
        )
      ),
  ]);

  // Орлогын данс (5XXXXXXX) — оны борлуулалт = Σ(Кт − Дт).
  const yearSales = yearRows.reduce(
    (sum, row) =>
      extractMainAccount(row.accountNumber).startsWith("5")
        ? sum + (Number(row.credit) - Number(row.debit))
        : sum,
    0
  );

  const summary = computeVatReturn(
    rows.map((row) => ({
      mainAccount: extractMainAccount(row.accountNumber),
      debit: Number(row.debit),
      credit: Number(row.credit),
      date: row.date,
      status: row.status,
    })),
    {
      periodCode,
      outputVatAccount: settings.outputVatAccountNumber,
      inputVatAccount: settings.inputVatAccountNumber,
    }
  );

  return {
    summary,
    settings: {
      outputVatAccountNumber: settings.outputVatAccountNumber,
      inputVatAccountNumber: settings.inputVatAccountNumber,
      vatRatePercent: Number(settings.vatRatePercent),
    },
    settlement: settlementVoucher ?? null,
    cashAccounts: accounts,
    yearSales,
    registrationThreshold: VAT_REGISTRATION_THRESHOLD_MNT,
  };
}

/**
 * Сарын НӨАТ тооцооны НООРОГ журнал (vat.md-ийн загвараар):
 *   Төлөх:        Dr Гаралтын НӨАТ / Cr Оролтын НӨАТ / Cr Банк (зөрүү)
 *   Буцаан авах:  Dr Гаралтын НӨАТ / Cr Оролтын НӨАТ (гаралтын дүнгээр
 *                 offset — үлдэгдэл оролтын дансанд дараа сард шилжинэ)
 * Огноо нь ӨНӨӨДӨР (тооцоо дараа сард хийгддэг) — createVoucher периодын
 * хамгаалалтаа өөрөө хийнэ. Idempotent: нэг сард нэг л тооцоо (externalRef).
 */
export async function createVatSettlementDraft(data: {
  periodCode: string;
  /** Төлөх дүнтэй үед заавал — төлбөр гарах банкны данс. */
  cashAccountId?: string;
}): Promise<{ id: string; dedup?: boolean }> {
  const { orgId } = await requireRole("accountant");
  if (!isPeriodCode(data.periodCode))
    throw new Error("Тайлант үеийн код буруу байна");

  const existing = await db.query.journalVouchers.findFirst({
    where: and(
      eq(journalVouchers.organizationId, orgId),
      eq(journalVouchers.externalRef, settlementRefOf(data.periodCode))
    ),
    columns: { id: true },
  });
  if (existing) return { id: existing.id, dedup: true };

  const { summary, settings } = await getVatReturnData(data.periodCode);
  if (summary.outputVat <= 0 && summary.inputVat <= 0)
    throw new Error(`${data.periodCode} сард НӨАТ-ийн бичилт алга`);
  if (summary.outputVat <= 0)
    throw new Error(
      "Гаралтын НӨАТ 0 байна — тооцооны бичилт шаардлагагүй (оролтын НӨАТ дараа сард шилжинэ)"
    );

  const code = await vatPostingCodeBuilder(orgId);
  const lines: { account: string; debit: number; credit: number; description: string }[] = [
    {
      account: code(settings.outputVatAccountNumber),
      debit: summary.outputVat,
      credit: 0,
      description: `Гаралтын НӨАТ ${data.periodCode}`,
    },
  ];
  // Оролтын НӨАТ-ийг гаралтаас ихгүй дүнгээр хаана (илүү нь дараа сард).
  const inputOffset = Math.min(summary.inputVat, summary.outputVat);
  if (inputOffset > 0)
    lines.push({
      account: code(settings.inputVatAccountNumber),
      debit: 0,
      credit: inputOffset,
      description: `Оролтын НӨАТ хаалт ${data.periodCode}`,
    });

  if (summary.payableVat > 0) {
    if (!data.cashAccountId)
      throw new Error("Төлөх дүнтэй тооцоонд банкны данс сонгоно уу");
    const account = await db.query.cashAccounts.findFirst({
      where: and(
        eq(cashAccounts.id, data.cashAccountId),
        eq(cashAccounts.organizationId, orgId),
        eq(cashAccounts.isActive, true)
      ),
      columns: { glAccountNumber: true },
    });
    if (!account) throw new Error("Идэвхтэй банкны данс олдсонгүй");
    lines.push({
      account: code(account.glAccountNumber),
      debit: 0,
      credit: summary.payableVat,
      description: `НӨАТ төлөлт ${data.periodCode} (${summary.deadline} дотор)`,
    });
  }

  // Данс идэвхтэй эсэхийг createVoucher-ийн server validator ДАХИН шалгана;
  // энд тохиргооны данс огт байхгүй тохиолдлыг эрт, ойлгомжтой унагана.
  for (const main of [
    settings.outputVatAccountNumber,
    settings.inputVatAccountNumber,
  ]) {
    const account = await db.query.chartOfAccounts.findFirst({
      where: and(
        eq(chartOfAccounts.organizationId, orgId),
        eq(chartOfAccounts.number, main),
        eq(chartOfAccounts.isEnabled, true)
      ),
      columns: { id: true },
    });
    if (!account)
      throw new Error(
        `${main} НӨАТ-ийн данс идэвхтэй жагсаалтад алга — Тохиргоо → Ерөнхий журналын тохиргоо хэсгээс нэмнэ үү`
      );
  }

  const { id } = unwrapAction(await createVoucher({
    date: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10),
    description: `НӨАТ тооцоо ${data.periodCode}${
      summary.refundableVat > 0
        ? ` (буцаан авах ${summary.refundableVat.toLocaleString()}₮ дараа сард шилжинэ)`
        : ""
    }`,
    lines: lines.map((line) => ({ ...line })),
    status: "draft",
    externalRef: settlementRefOf(data.periodCode),
  }));

  revalidatePath("/vat");
  revalidatePath("/tax/vat");
  revalidatePath("/gl/journal");
  return { id };
}
