// Батлагдсан журналыг УЛААН СТОРНО-оор буцаах (CLAUDE.md §1) — дуудагчийн
// транзакц дотор. GL-ийн «Буцаах» (`unpostVoucherCore`) ба дэд дэвтэр өөрийн
// журналаа буцаахдаа (цалин — `reversePayrollVoucher`) НЭГ логикоор: эх
// журнал `reversed`, эх огноогоор буцаалтын журнал (ижил тал, сөрөг дүн),
// эх модулийн дугаар, аудит. Эрх, период, эзэмшлийн шалгалт ДУУДАГЧИЙН үүрэг.
// Валютын журнал (IAS 21) — буцаалт ЭХИЙН валют, ханш, валютын дүнгээр
// (сөрөг) бичигдэнэ: мөрийн касс/бизнес объектын түлхүүр ч хадгалагдана, тэгэхгүй
// бол валютын үлдэгдэл, PO-ийн клиринг цэвэрлэгдэхгүй (ontology-audit M2).

import { and, eq } from "drizzle-orm";

import { logAuditEvent } from "@/lib/audit";
import type { db } from "@/lib/db";
import { journalLines, journalVouchers } from "@/lib/db/schema";
import { stornoOf } from "@/lib/gl/storno";
import { moduleOfVoucherNo, nextVoucherNo } from "@/lib/gl/voucher-no";
import { stateChangedError } from "@/lib/state-guard";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type ReversibleVoucher = {
  id: string;
  date: string;
  description: string;
  documentNo: string | null;
  currency?: string;
  exchangeRate?: string;
  rateSource?: string | null;
  rateDate?: string | null;
  lines: {
    accountNumber: string;
    debit: string;
    credit: string;
    debitFc?: string;
    creditFc?: string;
    description: string | null;
    cashAccountId?: string | null;
    businessObjectType?: string | null;
    businessObjectId?: string | null;
  }[];
};

/** Буцаалтын журналын ID-г буцаана. Эх журнал батлагдсан биш бол `[STATE_CHANGED]`. */
export async function reverseVoucherInTx(
  tx: Tx,
  input: { orgId: string; userId: string; voucher: ReversibleVoucher }
): Promise<string> {
  const { orgId, userId, voucher } = input;
  const [claimed] = await tx
    .update(journalVouchers)
    .set({ status: "reversed" })
    .where(
      and(
        eq(journalVouchers.id, voucher.id),
        eq(journalVouchers.organizationId, orgId),
        eq(journalVouchers.status, "posted")
      )
    )
    .returning({ id: journalVouchers.id });
  if (!claimed) throw stateChangedError("Журнал");

  const [reversal] = await tx
    .insert(journalVouchers)
    .values({
      userId,
      organizationId: orgId,
      date: voucher.date,
      description: `Буцаалт: ${voucher.description}`,
      // Буцаалт нь эх журналынхаа модульд үлдэнэ (CM-ийн буцаалт CM-).
      documentNo: await nextVoucherNo(
        tx,
        orgId,
        moduleOfVoucherNo(voucher.documentNo, "gl"),
        voucher.date
      ),
      status: "posted",
      currency: voucher.currency ?? "MNT",
      exchangeRate: voucher.exchangeRate ?? "1",
      rateSource: voucher.rateSource ?? null,
      rateDate: voucher.rateDate ?? null,
      // Эх журналтайгаа хосолно: эхийг устгавал буцаалт FK cascade-аар
      // хамт устана; буцаалтыг дангаар устгахыг deleteVoucher хориглоно.
      reversalOfVoucherId: voucher.id,
    })
    .returning({ id: journalVouchers.id });

  await tx.insert(journalLines).values(
    voucher.lines.map((line, index) => ({
      voucherId: reversal.id,
      accountNumber: line.accountNumber,
      ...stornoOf({
        debit: Number(line.debit),
        credit: Number(line.credit),
        debitFc: Number(line.debitFc ?? 0),
        creditFc: Number(line.creditFc ?? 0),
      }),
      description: line.description,
      cashAccountId: line.cashAccountId ?? null,
      businessObjectType: line.businessObjectType ?? null,
      businessObjectId: line.businessObjectId ?? null,
      sortOrder: index,
    }))
  );
  await logAuditEvent(
    {
      userId,
      organizationId: orgId,
      action: "unpost",
      entityType: "journal",
      entityId: voucher.id,
      summary: `Журнал буцаагдав — ${voucher.date}, ${voucher.description}, дүн ${voucher.lines.reduce((sum, line) => sum + Number(line.debit), 0).toLocaleString("en-US")}₮`,
    },
    tx
  );
  return reversal.id;
}
