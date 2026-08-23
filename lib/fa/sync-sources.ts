import { extractMainAccount as mainAccountOf } from "@/lib/reports/balances";
// FA картын ноорог — эх үүсвэрээс (plain server модуль, "use server" БИШ).
//
// АП нэхэмжлэх / касс / GL журнал FA ӨРТГИЙН данс руу цэвэр Dr бичмэгц
// картын НООРОГ үүснэ: өртөг = цэвэр Dr, огноо = воучерийн огноо. Хэрэглэгч
// ашиглалтын хугацаа, эхлэх сараа бөглөж идэвхжүүлнэ — идэвхжүүлэлт GL
// бичихгүй (өртөг аль хэдийн данслагдсан). Элэгдлийн воучер (70000001 /
// 21000099) өртгийн данс хөндөхгүй тул давхардахгүй.

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/lib/db";
import { fixedAssets, journalVouchers } from "@/lib/db/schema";

// FA өртгийн дансууд (KB §2.20, standard chart) — хуримтлагдсан элэгдлийн
// contra (20000002, 21000099) болон түр данс (20000099) ОРОХГҮЙ.
export const FA_COST_ACCOUNTS = new Set(["20000001", "21010000", "21000001"]);


export async function syncFixedAssetDraftForVoucher(voucherId: string) {
  try {
    const voucher = await db.query.journalVouchers.findFirst({
      where: eq(journalVouchers.id, voucherId),
      with: { lines: true },
    });
    if (!voucher || voucher.status !== "posted") return;
    const userId = voucher.userId;
    const orgId = voucher.organizationId;
    if (!orgId) return;

    let net = 0;
    for (const line of voucher.lines) {
      if (!FA_COST_ACCOUNTS.has(mainAccountOf(line.accountNumber))) continue;
      net += Number(line.debit) - Number(line.credit);
    }
    net = Math.round(net * 100) / 100;
    if (net <= 0) return;

    const existing = await db.query.fixedAssets.findFirst({
      where: and(
        eq(fixedAssets.organizationId, orgId),
        eq(fixedAssets.sourceVoucherId, voucherId)
      ),
      columns: { id: true },
    });
    if (existing) return;

    await db.insert(fixedAssets).values({
      userId,
      organizationId: orgId,
      code: `FA-${voucher.date.replaceAll("-", "")}-${crypto
        .randomUUID()
        .slice(0, 6)
        .toUpperCase()}`,
      name: voucher.description || "Үндсэн хөрөнгө",
      acquisitionDate: voucher.date,
      cost: String(net),
      status: "draft",
      sourceVoucherId: voucherId,
    });
    revalidatePath("/fa");
    revalidatePath("/fa/assets");
  } catch (error) {
    console.error("[syncFixedAssetDraftForVoucher]", error);
  }
}

/** Воучер буцаагдахад түүнээс үүссэн ИДЭВХЖҮҮЛЭЭГҮЙ ноорог картыг устгана. */
export async function removeDraftAssetsForVoucher(voucherId: string) {
  try {
    await db
      .delete(fixedAssets)
      .where(
        and(
          eq(fixedAssets.sourceVoucherId, voucherId),
          eq(fixedAssets.status, "draft")
        )
      );
    revalidatePath("/fa");
    revalidatePath("/fa/assets");
  } catch (error) {
    console.error("[removeDraftAssetsForVoucher]", error);
  }
}
