import { extractMainAccount as mainAccountOf } from "@/lib/reports/balances";
// FA картын ноорог — эх үүсвэрээс (plain server модуль, "use server" БИШ).
//
// АП нэхэмжлэх / касс / GL журнал FA ӨРТГИЙН данс руу цэвэр Dr бичмэгц
// картын НООРОГ үүснэ: өртөг = цэвэр Dr, огноо = воучерийн огноо. Хэрэглэгч
// ашиглалтын хугацаа, эхлэх сараа бөглөж идэвхжүүлнэ — идэвхжүүлэлт GL
// бичихгүй (өртөг аль хэдийн данслагдсан). Элэгдлийн воучер (70000001 /
// 20000002 / 21000099) өртгийн данс хөндөхгүй тул давхардахгүй. Нээлтийн
// журнал (opening-* / [ОНБ]) карт үүсгэхгүй — lib/fa/opening.ts.

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/lib/db";
import { fixedAssets, journalVouchers } from "@/lib/db/schema";
import { accumDepAccountFor, isOpeningBalanceVoucher } from "@/lib/fa/opening";

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
    // Нэвтрүүлэлтийн нээлтийн журнал — картууд тусад нь (нээлтийн хуримтлагдсан
    // элэгдэлтэйгээ) бүртгэгддэг тул ноорог карт үүсгэвэл ДАВХАРДАНА (ENT-046).
    if (isOpeningBalanceVoucher(voucher)) return;
    const userId = voucher.userId;
    const orgId = voucher.organizationId;
    if (!orgId) return;

    let net = 0;
    // Картын өртгийн данс = воучерт ХАМГИЙН ИХ Dr авсан ҮХ-ийн данс (данснаас
    // хасалт тэр данснаас кредитлэнэ — default 20000001 биш байж болно).
    const byAccount = new Map<string, number>();
    for (const line of voucher.lines) {
      const main = mainAccountOf(line.accountNumber);
      if (!FA_COST_ACCOUNTS.has(main)) continue;
      const delta = Number(line.debit) - Number(line.credit);
      net += delta;
      byAccount.set(main, (byAccount.get(main) ?? 0) + delta);
    }
    const assetAccountNumber = [...byAccount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
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
      ...(assetAccountNumber
        ? { assetAccountNumber, accumDepAccountNumber: accumDepAccountFor(assetAccountNumber) }
        : {}),
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
