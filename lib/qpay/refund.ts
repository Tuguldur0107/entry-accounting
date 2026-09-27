// QPay-д орсон мөнгийг борлуулалт болгохгүйгээр харилцагчид буцаах (P1) —
// давхар төлбөр (QR хаагдсаны дараа төлсөн ч сагс өөр хэлбэрээр зарагдсан) ба
// дүн зөрсөн төлбөр. docs/dev/pos.md «QPay шийдвэрлэлт».
//
// Журнал ҮРГЭЛЖ баримтаас (журналгүй «шийдсэн» төлөв БАЙХГҮЙ). Мөнгө QPay-д
// орсон тул бүх замд Dt QPay түр данс — QPay банк руу шилжүүлэхэд ердийн
// ewallet settlement (түр данс → банк) тэр орлогыг тулгана:
//   cash         Dt QPay түр данс / Кт ээлжийн касс   (кассаас бэлнээр өгөв)
//   bank         Dt QPay түр данс / Кт сонгосон данс  (шилжүүлгээр буцаав)
//   store_credit Dt QPay түр данс / Кт дэлгүүрийн кредитийн өглөг + кредитийн бичлэг
// НЭГ транзакц: intent-ийг эхэлж «refunded» болгож (өрсөлдөгч finalize / давхар
// дарахаас хамгаална) дараа нь журнал + мөнгөн баримт.

import { and, asc, eq, isNull } from "drizzle-orm";

import { logAuditEvent } from "@/lib/audit";
import { assertEnabledMainAccount } from "@/lib/costing/posting-helpers";
import { db } from "@/lib/db";
import {
  cashAccounts,
  cashDocuments,
  counterparties,
  journalLines,
  journalVouchers,
  posPaymentMethods,
  posQpayIntents,
  posShifts,
  posStoreCredits,
  segmentConfigs,
  segmentValues,
} from "@/lib/db/schema";
import { postingCodeBuilderFromData } from "@/lib/gl/posting-code";
import { nextVoucherNo } from "@/lib/gl/voucher-no";
import { assertPeriodOpen, assertPeriodOpenInTx } from "@/lib/periods/guard";
import { POS_MODULE_TAG, POS_SOURCE_TYPE } from "@/lib/pos/constants";
import { ensurePosSettings } from "@/lib/pos/load-data";
import { ulaanbaatarNow } from "@/lib/pos/sale-math";

import {
  QPAY_ERRORS,
  QPAY_PROVIDER,
  QPAY_REFUND_METHOD_LABELS,
  QPAY_REFUND_METHODS,
  type QpayIntentStatus,
  type QpayRefundMethod,
} from "./constants";
import { pickFinalizeShift, refundableAmount } from "./intent";
import type { QpayIntentResolution } from "./types";

/** Журналын мөрийн бизнес объект — intent бүрийн буцаалт мөрдөгдөнө. */
export const QPAY_BUSINESS_OBJECT = "pos_qpay_intent";

export interface RefundQpayInput {
  method: QpayRefundMethod;
  reason: string;
  /** bank: буцаан шилжүүлсэн данс (касс/банк). */
  cashAccountId?: string | null;
  /** store_credit: кредит үлдээх харилцагч. */
  counterpartyId?: string | null;
}

const fmt = (value: number) => value.toLocaleString("en-US");

/** QPay түр данс (QPay хэлбэрийн касс/банкны данс) — QPay-ээр орсон мөнгө энд. */
export async function loadQpayClearingAccount(orgId: string) {
  const methods = await db.query.posPaymentMethods.findMany({
    where: and(eq(posPaymentMethods.organizationId, orgId), eq(posPaymentMethods.provider, QPAY_PROVIDER)),
    with: { cashAccount: true },
  });
  const clearing =
    methods.find((m) => m.isActive && m.cashAccount?.isActive)?.cashAccount ??
    methods.find((m) => m.cashAccount?.isActive)?.cashAccount ??
    null;
  if (!clearing) throw new Error("QPay түр данс тохируулаагүй — POS тохиргоо → Төлбөрийн хэлбэр → QPay");
  return clearing;
}

export async function refundQpayIntentCore(
  orgId: string,
  userId: string,
  intentId: string,
  input: RefundQpayInput
): Promise<{ voucherNo: string; amount: number; resolution: QpayIntentResolution }> {
  const reason = input.reason?.trim() ?? "";
  if (reason.length < 3) throw new Error("Буцаах шалтгаан заавал — жишээ нь «Бэлнээр аль хэдийн зарсан, давхар төлбөр»");
  if (!QPAY_REFUND_METHODS.includes(input.method)) throw new Error("Буцаах хэлбэр буруу");

  const intent = await db.query.posQpayIntents.findFirst({
    where: and(eq(posQpayIntents.id, intentId), eq(posQpayIntents.organizationId, orgId)),
  });
  if (!intent) throw new Error("QPay intent олдсонгүй");
  const status = intent.status as QpayIntentStatus;
  const amount = refundableAmount({ ...intent, status });
  if (amount == null)
    throw new Error(
      `[${QPAY_ERRORS.intentNotPaid}] Буцаах мөнгө алга — зөвхөн QPay-д орсон ч борлуулалт болоогүй төлбөрийг буцаана`
    );

  // QPay түр данс — мөнгө орсон газар.
  const clearing = await loadQpayClearingAccount(orgId);

  const settings = await ensurePosSettings(orgId, userId);
  const date = ulaanbaatarNow().date;
  await assertPeriodOpen(orgId, date);

  // Кредит талын данс — хэлбэрээс.
  let fromAccount: typeof cashAccounts.$inferSelect | null = null;
  let shiftId: string | null = null;
  let counterparty: { id: string; name: string } | null = null;
  if (input.method === "cash") {
    // Бэлэн мөнгө ТЭР салбарын кассаас гарна — ижил агуулахын нээлттэй ээлж.
    const originalShift = intent.shiftId
      ? await db.query.posShifts.findFirst({
          where: and(eq(posShifts.id, intent.shiftId), eq(posShifts.organizationId, orgId)),
          columns: { warehouseId: true, cashAccountId: true, documentNo: true },
        })
      : null;
    const openShifts = await db.query.posShifts.findMany({
      where: and(eq(posShifts.organizationId, orgId), eq(posShifts.status, "open")),
      columns: { id: true, warehouseId: true, cashAccountId: true },
      orderBy: [asc(posShifts.openedAt)],
    });
    const snapshot = intent.cartSnapshot as { warehouseId?: string | null } | null;
    const target = pickFinalizeShift({
      snapshotShiftId: intent.shiftId,
      warehouseId: snapshot?.warehouseId || originalShift?.warehouseId || null,
      cashAccountId: originalShift?.cashAccountId ?? null,
      openShifts,
    });
    if (!target)
      throw new Error("Кассаас бэлнээр буцаахад тэр салбарт (агуулахад) нээлттэй ээлж хэрэгтэй — ээлж нээнэ үү");
    shiftId = target.shiftId;
    const shift = openShifts.find((row) => row.id === target.shiftId);
    fromAccount =
      (await db.query.cashAccounts.findFirst({
        where: and(eq(cashAccounts.id, shift?.cashAccountId ?? ""), eq(cashAccounts.organizationId, orgId)),
      })) ?? null;
  } else if (input.method === "bank") {
    if (!input.cashAccountId) throw new Error("Буцаан шилжүүлсэн дансаа сонгоно уу");
    fromAccount =
      (await db.query.cashAccounts.findFirst({
        where: and(eq(cashAccounts.id, input.cashAccountId), eq(cashAccounts.organizationId, orgId)),
      })) ?? null;
  } else {
    if (!input.counterpartyId) throw new Error("Кредит үлдээх харилцагчаа сонгоно уу");
    counterparty =
      (await db.query.counterparties.findFirst({
        where: and(eq(counterparties.id, input.counterpartyId), eq(counterparties.organizationId, orgId)),
        columns: { id: true, name: true },
      })) ?? null;
    if (!counterparty) throw new Error("Харилцагч олдсонгүй");
    await assertEnabledMainAccount(orgId, settings.storeCreditLiabilityAccountNumber);
  }
  if (input.method !== "store_credit") {
    if (!fromAccount || !fromAccount.isActive) throw new Error("Касс / банкны данс идэвхгүй эсвэл олдсонгүй");
    if (fromAccount.id === clearing.id) throw new Error("QPay түр данснаас өөрөө рүүгээ буцаах боломжгүй — өөр данс сонгоно уу");
    if (fromAccount.currency !== "MNT") throw new Error("QPay төлбөр ₮-өөр — буцаах данс MNT байна");
  }

  const [configs, values] = await Promise.all([
    db.query.segmentConfigs.findMany({ where: eq(segmentConfigs.organizationId, orgId) }),
    db.query.segmentValues.findMany({
      where: and(eq(segmentValues.organizationId, orgId), eq(segmentValues.isEnabled, true)),
    }),
  ]);
  const cashCode = postingCodeBuilderFromData({ configs, values, moduleTag: "CA" });
  const posCode = postingCodeBuilderFromData({ configs, values, moduleTag: POS_MODULE_TAG });

  const label = QPAY_REFUND_METHOD_LABELS[input.method];
  const tag = `[QPay буцаалт ${intent.qpayInvoiceId?.slice(0, 8) ?? intent.id.slice(0, 8)}]`;
  const description = `${tag} ${label} — ${reason}`;
  const businessObject = { businessObjectType: QPAY_BUSINESS_OBJECT, businessObjectId: intent.id };
  const at = new Date();

  return db.transaction(async (tx) => {
    await assertPeriodOpenInTx(tx, orgId, date);
    // Эхлээд intent-ийг «эзэмшинэ»: өрсөлдөгч finalize / давхар дарах бол 0 мөр → зогсоно.
    const claimed = await tx
      .update(posQpayIntents)
      .set({ status: "refunded", qrImage: null, updatedAt: at })
      .where(and(eq(posQpayIntents.id, intent.id), eq(posQpayIntents.status, status), isNull(posQpayIntents.saleId)))
      .returning({ id: posQpayIntents.id });
    if (claimed.length === 0)
      throw new Error(`[${QPAY_ERRORS.alreadyFinalized}] Энэ QPay төлбөр аль хэдийн борлуулалт болсон эсвэл буцаагдсан`);

    const voucherNo = await nextVoucherNo(tx, orgId, "cash", date);
    const [voucher] = await tx
      .insert(journalVouchers)
      .values({
        userId,
        organizationId: orgId,
        documentNo: voucherNo,
        date,
        description,
        status: "posted",
        externalRef: `qpay-refund:${intent.id}`,
      })
      .returning({ id: journalVouchers.id });

    const creditAccountNumber =
      input.method === "store_credit" ? settings.storeCreditLiabilityAccountNumber : fromAccount!.glAccountNumber;
    const [cashDoc] = await tx
      .insert(cashDocuments)
      .values({
        userId,
        organizationId: orgId,
        documentNo: `QP-${date.replaceAll("-", "")}-${intent.id.slice(0, 8).toUpperCase()}`,
        // Бэлэн / банк: касс → QPay түр данс шилжүүлэг (цэвэр нөлөө). Кредит:
        // QPay түр данс руу орлого, эсрэг тал нь кредитийн өглөг.
        documentType: input.method === "store_credit" ? "receipt" : "transfer",
        date,
        fromCashAccountId: input.method === "store_credit" ? null : fromAccount!.id,
        toCashAccountId: clearing.id,
        counterAccountNumber: input.method === "store_credit" ? creditAccountNumber : null,
        counterparty: counterparty?.name ?? null,
        counterpartyId: counterparty?.id ?? null,
        description,
        amount: String(amount),
        currency: "MNT",
        exchangeRate: "1",
        baseAmount: String(amount),
        status: "posted",
        voucherId: voucher.id,
        // [POS_SOURCED]: касс модулиас засах/устгах хориотой — буцаалт нь intent-ийн түүх.
        sourceType: POS_SOURCE_TYPE,
        sourceId: intent.id,
        postedAt: at,
      })
      .returning({ id: cashDocuments.id });

    await tx.insert(journalLines).values([
      {
        voucherId: voucher.id,
        cashAccountId: clearing.id,
        accountNumber: cashCode(clearing.glAccountNumber),
        debit: String(amount),
        credit: "0",
        description: `${tag} QPay-д орсон төлбөр`,
        sortOrder: 0,
        ...businessObject,
      },
      {
        voucherId: voucher.id,
        cashAccountId: input.method === "store_credit" ? null : fromAccount!.id,
        accountNumber: input.method === "store_credit" ? posCode(creditAccountNumber) : cashCode(creditAccountNumber),
        debit: "0",
        credit: String(amount),
        description: `${tag} ${label}${counterparty ? ` — ${counterparty.name}` : ""}`,
        sortOrder: 1,
        ...businessObject,
      },
    ]);

    let storeCreditId: string | null = null;
    if (input.method === "store_credit" && counterparty) {
      const [credit] = await tx
        .insert(posStoreCredits)
        .values({
          organizationId: orgId,
          counterpartyId: counterparty.id,
          amount: String(amount),
          balance: String(amount),
          status: "active",
        })
        .returning({ id: posStoreCredits.id });
      storeCreditId = credit.id;
    }

    const resolution: QpayIntentResolution = {
      kind: input.method,
      amount,
      reason,
      voucherId: voucher.id,
      voucherNo,
      cashDocumentId: cashDoc.id,
      shiftId,
      cashAccountId: fromAccount?.id ?? null,
      counterpartyId: counterparty?.id ?? null,
      storeCreditId,
      userId,
      at: at.toISOString(),
    };
    await tx
      .update(posQpayIntents)
      .set({ resolution: resolution as unknown as Record<string, unknown> })
      .where(eq(posQpayIntents.id, intent.id));
    await logAuditEvent(
      {
        userId,
        organizationId: orgId,
        action: "refund",
        entityType: "pos_qpay_intent",
        entityId: intent.id,
        summary: `QPay төлбөр харилцагчид буцаагдав (${label}) — ${fmt(amount)}₮, ${voucherNo}: ${reason}`,
      },
      tx
    );
    return { voucherNo, amount, resolution };
  });
}
