"use server";

// НӨАТ модулийн server actions — сарын тайлан + тооцооны ноорог журнал.
//
// Knowledge: entry-knowledge/01-онол-хууль-стандарт/tax/vat.md,
// entry-knowledge/02-нягтлан-бодох-мэргэжлийн/workflows/vat-return.md.
// Тооцооны журнал ЗААВАЛ ноорог үүснэ (human-in-the-loop §9) — нягтланч
// шалгаад GL журналаас Post дарна.

import { revalidatePath } from "next/cache";
import { and, eq, gte, inArray, like, lt, lte, or, sql } from "drizzle-orm";

import { getActiveOrg, requireModuleAction, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  cashAccounts,
  chartOfAccounts,
  journalLines,
  journalVouchers,
  segmentConfigs,
  segmentValues,
  vatSettings,
} from "@/lib/db/schema";
import { createVoucher } from "@/lib/actions/gl";
import {
  actionError,
  unwrapAction,
  type ActionResult,
} from "@/lib/action-result";
import { loadVatSettings } from "@/lib/vat/settings";
import {
  carriedInputVat,
  computeVatReturn,
  type VatReturnSummary,
  planVatSettlementDelta,
} from "@/lib/vat/return";
import { extractMainAccount } from "@/lib/reports/balances";
import { SEGMENT_DEFS } from "@/lib/constants/standard-accounts";
import { buildSegCode } from "@/lib/grid/segments";
import { canAutoDefaultSegment } from "@/lib/gl/posting-code";
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
    if (!canAutoDefaultSegment(segmentId)) continue;
    const options = values.filter((value) => value.segmentId === segmentId);
    if (options.length === 1) defaults[segmentId] = options[0].code;
  }
  return (mainAccount: string) =>
    buildSegCode({ ...defaults, 3: mainAccount }, activeSegIds, defaults);
}

const settlementRefOf = (periodCode: string) => `vat-settlement:${periodCode}`;

/** Тухайн сарын бүх тооцооны журнал (үндсэн + нэмэлт `:N`), буцаагдаагүй. */
async function loadSettledVat(
  orgId: string,
  periodCode: string,
  outputVatAccount: string,
  inputVatAccount: string
) {
  const ref = settlementRefOf(periodCode);
  const vouchers = await db.query.journalVouchers.findMany({
    where: and(
      eq(journalVouchers.organizationId, orgId),
      or(eq(journalVouchers.externalRef, ref), like(journalVouchers.externalRef, `${ref}:%`)),
      inArray(journalVouchers.status, ["draft", "posted"])
    ),
    with: { lines: true },
  });
  let output = 0;
  let input = 0;
  for (const voucher of vouchers)
    for (const line of voucher.lines) {
      const main = extractMainAccount(line.accountNumber);
      if (main === outputVatAccount) output += Number(line.debit) - Number(line.credit);
      else if (main === inputVatAccount) input += Number(line.credit) - Number(line.debit);
    }
  return {
    output: Math.round(output * 100) / 100,
    input: Math.round(input * 100) / 100,
    count: vouchers.length,
    hasDraft: vouchers.some((voucher) => voucher.status === "draft"),
  };
}

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
  /** Байгууллага НӨАТ төлөгч эсэх (docs/pos §3.8) — унтраавал POS-д НӨАТ мөр үүсэхгүй. */
  isVatPayer: boolean;
  /** Энэ сарын тооцооны журнал аль хэдийн үүссэн бол. */
  settlement: { id: string; status: string; date: string } | null;
  /**
   * SIM2-015: бичигдсэн тооцоо(нууд)-ын Dr гаралт / Кт оролт ба одоогийн
   * тайлантай зөрүү — needed бол create_vat_settlement НЭМЭЛТ тооцоо үүсгэнэ.
   */
  settled: { output: number; input: number; count: number; hasDraft: boolean };
  settlementDelta: ReturnType<typeof planVatSettlementDelta>;
  /**
   * SIM2-027: шилжсэн кредитийн задаргаа (үеийн эхэнд): оролтын НӨАТ-ын
   * үлдэгдэл, төлөгдөөгүй гаралтын НӨАТ (нээлт г.м.) — цэвэр = carriedInVat.
   */
  carriedBreakdown: { inputOpening: number; unpaidOutputOpening: number };
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
  const { orgId, userId } = await requireModuleAction("tax", "read");
  if (!isPeriodCode(periodCode)) throw new Error("Тайлант үеийн код буруу байна");

  const settings = await loadVatSettings(orgId, userId);
  const { startDate, endDate } = periodRange(periodCode);
  // Бүртгэлийн босгын хяналт — хуанлийн оны эхнээс тайлант үеийн эцэс хүртэл.
  const yearStart = `${periodCode.slice(0, 4)}-01-01`;

  const mainExpr = sql<string>`case when position('.' in ${journalLines.accountNumber}) > 0 then split_part(${journalLines.accountNumber}, '.', 3) else ${journalLines.accountNumber} end`;
  const [rows, settlementVoucher, accounts, yearRows, openingRows] = await Promise.all([
    db
      .select({
        voucherId: journalLines.voucherId,
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
    // Тайлант үеийн ЭХЭН дэх НӨАТ-ын дансны үлдэгдэл — шилжсэн кредит (ENT-052).
    db
      .select({
        main: mainExpr,
        debit: sql<string>`coalesce(sum(${journalLines.debit}), 0)`,
        credit: sql<string>`coalesce(sum(${journalLines.credit}), 0)`,
      })
      .from(journalLines)
      .innerJoin(journalVouchers, eq(journalLines.voucherId, journalVouchers.id))
      .where(
        and(
          eq(journalVouchers.organizationId, orgId),
          lt(journalVouchers.date, startDate),
          inArray(journalVouchers.status, ["posted", "reversed"]),
          inArray(mainExpr, [settings.outputVatAccountNumber, settings.inputVatAccountNumber])
        )
      )
      .groupBy(mainExpr),
  ]);
  const openingNet = (main: string) => {
    const row = openingRows.find((entry) => entry.main === main);
    return row ? Number(row.debit) - Number(row.credit) : 0;
  };
  const carriedInVat = carriedInputVat({
    inputDebitBalance: openingNet(settings.inputVatAccountNumber),
    outputCreditBalance: -openingNet(settings.outputVatAccountNumber),
  });
  const carriedBreakdown = {
    inputOpening: Math.round(Math.max(0, openingNet(settings.inputVatAccountNumber)) * 100) / 100,
    unpaidOutputOpening: Math.round(Math.max(0, -openingNet(settings.outputVatAccountNumber)) * 100) / 100,
  };

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
      voucherId: row.voucherId,
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
      carriedInVat,
    }
  );

  const settled = await loadSettledVat(
    orgId,
    periodCode,
    settings.outputVatAccountNumber,
    settings.inputVatAccountNumber
  );

  return {
    summary,
    settled,
    settlementDelta: planVatSettlementDelta(summary, settled),
    carriedBreakdown,
    settings: {
      outputVatAccountNumber: settings.outputVatAccountNumber,
      inputVatAccountNumber: settings.inputVatAccountNumber,
      vatRatePercent: Number(settings.vatRatePercent),
    },
    isVatPayer: settings.isVatPayer,
    settlement: settlementVoucher ?? null,
    cashAccounts: accounts,
    yearSales,
    registrationThreshold: VAT_REGISTRATION_THRESHOLD_MNT,
  };
}

/**
 * НӨАТ төлөгч эсэх туг (docs/pos §3.8, D4). Тохиргооны мөр байхгүй бол
 * loadVatSettings default-аар үүсгээд дараа нь шинэчилнэ (upsert).
 * Унтраавал POS борлуулалтад НӨАТ мөр үүсэхгүй — татварын тохиргооны
 * шийдвэр тул `tax` модулийн post эрх шаардана.
 */
export async function updateVatPayerFlag(isVatPayer: boolean): Promise<void> {
  const { orgId, userId } = await requireModuleAction("tax", "post");
  const settings = await loadVatSettings(orgId, userId);
  await db
    .update(vatSettings)
    .set({ isVatPayer: Boolean(isVatPayer), updatedAt: new Date() })
    .where(and(eq(vatSettings.id, settings.id), eq(vatSettings.organizationId, orgId)));
  revalidatePath("/vat");
  revalidatePath("/tax/vat");
  revalidatePath("/pos");
}

/**
 * Сарын НӨАТ тооцооны НООРОГ журнал (vat.md-ийн загвараар):
 *   Төлөх:        Dr Гаралтын НӨАТ / Cr Оролтын НӨАТ / Cr Банк (зөрүү)
 *   Буцаан авах:  Dr Гаралтын НӨАТ / Cr Оролтын НӨАТ (гаралтын дүнгээр
 *                 offset — үлдэгдэл оролтын дансанд дараа сард шилжинэ)
 * Оролтын хаалт нь энэ сарын оролт + өмнөх саруудаас шилжсэн кредитээс
 * гаралтаас ихгүй дүн. Огноо нь ТАЙЛАНТ ҮЕИЙН СҮҮЛИЙН ӨДӨР (ENT-035: урьд
 * өнөөдрийн огноогоор бичигдэж 2025-02-ын тооцоо 2026-09-д орж байв);
 * тэр үе хаагдсан бол createVoucher-ийн периодын хамгаалалт татгалзана.
 * Idempotent: нэг сард нэг л тооцоо (externalRef).
 */
export async function createVatSettlementDraft(
  data: Parameters<typeof createVatSettlementDraftCore>[0]
): Promise<ActionResult<{ id: string; dedup?: boolean; supplement?: boolean }>> {
  try {
    return await createVatSettlementDraftCore(data);
  } catch (caught) {
    return actionError(
      "createVatSettlementDraft",
      caught,
      "Тооцооны ноорог үүсээгүй"
    );
  }
}

async function createVatSettlementDraftCore(data: {
  periodCode: string;
  /** Төлөх дүнтэй үед заавал — төлбөр гарах банкны данс. */
  cashAccountId?: string;
}): Promise<{ id: string; dedup?: boolean; supplement?: boolean }> {
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

  const { summary, settings, settled, settlementDelta } = await getVatReturnData(data.periodCode);
  if (existing) {
    // SIM2-015: тооцоо хуучирсан бол НЭМЭЛТ тооцоо (зөрүүгээр). Ноорог
    // тооцоо байвал давхар ноорог гаргахгүй — устгаад дахин үүсгэхийг заана.
    if (!settlementDelta.needed) return { id: existing.id, dedup: true };
    if (settled.hasDraft)
      throw new Error(
        `[VAT_SETTLEMENT_STALE] ${data.periodCode}-ийн НООРОГ тооцоо тайлантай зөрүүтэй (гаралт Δ ${settlementDelta.outputDelta}) — ноорог тооцоог устгаад дахин үүсгэнэ`
      );
    if (settlementDelta.negative)
      throw new Error(
        `[VAT_SETTLEMENT_DECREASE] ${data.periodCode}-ийн тооцооноос хойш НӨАТ буурсан (гаралт Δ ${settlementDelta.outputDelta}, төлөх Δ ${settlementDelta.payableDelta}) — тооцооны журналыг буцааж дахин үүсгэнэ`
      );
    return await createVatSupplementDraft(orgId, data, settings, settled.count, settlementDelta, summary.deadline);
  }
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
  // Оролтын НӨАТ-ийг (энэ сарын + шилжсэн кредит) гаралтаас ихгүй дүнгээр
  // хаана (илүү нь дараа сард). Төлөх = гаралт − хаалт = summary.payableVat.
  const inputOffset = Math.min(
    Math.round((summary.inputVat + summary.carriedInVat) * 100) / 100,
    summary.outputVat
  );
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
    date: periodRange(data.periodCode).endDate,
    description: `НӨАТ тооцоо ${data.periodCode}${
      summary.refundableVat > 0
        ? ` (буцаан авах ${summary.refundableVat.toLocaleString()}₮ дараа сард шилжинэ)`
        : ""
    }`,
    lines: lines.map((line) => ({ ...line })),
    status: "draft",
    externalRef: settlementRefOf(data.periodCode),
    module: "vat",
  }));

  revalidatePath("/vat");
  revalidatePath("/tax/vat");
  revalidatePath("/gl/journal");
  return { id };
}

/** Нэмэлт тооцооны НООРОГ (`vat-settlement:YYYY-MM:N`) — SIM2-015. */
async function createVatSupplementDraft(
  orgId: string,
  data: { periodCode: string; cashAccountId?: string },
  settings: { outputVatAccountNumber: string; inputVatAccountNumber: string },
  existingCount: number,
  delta: ReturnType<typeof planVatSettlementDelta>,
  deadline: string
): Promise<{ id: string; dedup?: boolean; supplement: true }> {
  const code = await vatPostingCodeBuilder(orgId);
  const lines: { account: string; debit: number; credit: number; description: string }[] = [];
  if (delta.outputDelta > 0)
    lines.push({
      account: code(settings.outputVatAccountNumber),
      debit: delta.outputDelta,
      credit: 0,
      description: `Гаралтын НӨАТ нэмэлт ${data.periodCode}`,
    });
  if (Math.abs(delta.inputDelta) >= 0.01)
    lines.push({
      account: code(settings.inputVatAccountNumber),
      debit: delta.inputDelta < 0 ? -delta.inputDelta : 0,
      credit: delta.inputDelta > 0 ? delta.inputDelta : 0,
      description: `Оролтын НӨАТ хаалт нэмэлт ${data.periodCode}`,
    });
  if (delta.payableDelta >= 0.01) {
    if (!data.cashAccountId)
      throw new Error(
        `Нэмэлт төлөх НӨАТ ${delta.payableDelta.toLocaleString()}₮ — банкны данс (cashAccount) сонгоно уу`
      );
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
      credit: delta.payableDelta,
      description: `НӨАТ нэмэлт төлөлт ${data.periodCode} (${deadline} дотор)`,
    });
  }
  const { id } = unwrapAction(
    await createVoucher({
      date: periodRange(data.periodCode).endDate,
      description: `НӨАТ нэмэлт тооцоо ${data.periodCode} (тооцооноос хойш батлагдсан баримтууд)`,
      lines,
      status: "draft",
      externalRef: `${settlementRefOf(data.periodCode)}:${existingCount + 1}`,
      module: "vat",
    })
  );
  revalidatePath("/vat");
  revalidatePath("/tax/vat");
  revalidatePath("/gl/journal");
  return { id, supplement: true };
}
