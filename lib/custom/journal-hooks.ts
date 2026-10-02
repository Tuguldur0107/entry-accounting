// Fork-ийн журналын hook-ийг (beforeJournalPost / afterJournalPost) БҮХ модульд
// нэг цэгээс дуудна (docs/ontology-audit.md M4).
//
// Өмнө нь hook зөвхөн GL-ийн гар журналд (createVoucher / postVoucher) ажиллаж
// АР/АП, касс, POS, ҮХ, өртөг, хангамж, цалин, НӨАТ, банкны хуулгын журналууд
// тойрдог байв. Одоо:
//   • DB trigger `ea_journal_vouchers_posted_note` (scripts/lib/ledger-invariants.mjs)
//     транзакц дотор батлагдсан журнал бүрийг `ea.posted_vouchers` GUC-д тэмдэглэнэ;
//   • `db.transaction` (lib/db/index.ts) callback-ийн ДАРАА, commit-ийн ӨМНӨ
//     `runJournalPostHooksInTx`-ийг дуудна — {ok:false} бол транзакц бүхэлдээ буцна;
//   • commit-ийн ДАРАА `afterJournalPost` (алдаа нь бичилтийг унагахгүй).
// Hook бүртгээгүй (SaaS, ихэнх fork) үед юу ч уншихгүй — дамжуулалт.
// Буцаалтын журнал (улаан сторно / reversalOfVoucherId) `beforeJournalPost`-оор
// ХОРИГЛОГДОХГҮЙ — засварын зам хаагдахгүй; `afterJournalPost` нь `reversal: true`-тэй.

import { inArray, sql } from "drizzle-orm";

import type { db as dbType } from "@/lib/db";
import { journalVouchers } from "@/lib/db/schema";

import { getCustomization, runAfterJournalPost, runBeforeJournalPost } from "./loader";
import type { JournalHookContext } from "./types";

type Tx = Parameters<Parameters<typeof dbType.transaction>[0]>[0];

/** scripts/lib/ledger-invariants.mjs-ийн POSTED_VOUCHERS_GUC-тэй ИЖИЛ. */
export const POSTED_VOUCHERS_GUC = "ea.posted_vouchers";

/** GUC-ийн утга ("<id>:c,<id>:p,") → давхардалгүй жагсаалт (эхний тэмдэглэл). ЦЭВЭР. */
export function parsePostedVoucherNote(
  raw: string | null | undefined
): { voucherId: string; source: JournalHookContext["source"] }[] {
  const seen = new Set<string>();
  const result: { voucherId: string; source: JournalHookContext["source"] }[] = [];
  for (const part of (raw ?? "").split(",")) {
    const match = /^([0-9a-f-]{36}):([cp])$/i.exec(part.trim());
    if (!match || seen.has(match[1])) continue;
    seen.add(match[1]);
    result.push({ voucherId: match[1], source: match[2] === "c" ? "create_posted" : "post" });
  }
  return result;
}

/** Улаан сторно — бүх мөр сөрөг/0 (ядаж нэг нь сөрөг). ЦЭВЭР. */
export function isStornoLines(lines: readonly { debit: number; credit: number }[]): boolean {
  return (
    lines.length > 0 &&
    lines.every((line) => line.debit <= 0 && line.credit <= 0) &&
    lines.some((line) => line.debit < 0 || line.credit < 0)
  );
}

export function hasJournalHooks(): boolean {
  const hooks = getCustomization().hooks;
  return !!(hooks?.beforeJournalPost || hooks?.afterJournalPost);
}

/**
 * Транзакц дотор батлагдсан журнал бүрд `beforeJournalPost` (буцаалтаас бусад).
 * Commit-ийн дараах `afterJournalPost`-д өгөх контекстуудыг буцаана.
 */
export async function runJournalPostHooksInTx(tx: Tx): Promise<JournalHookContext[]> {
  const rows = (await tx.execute(
    sql`select current_setting(${POSTED_VOUCHERS_GUC}, true) as note`
  )) as unknown as { note: string | null }[];
  const noted = parsePostedVoucherNote(rows[0]?.note);
  if (noted.length === 0) return [];

  const vouchers = await tx.query.journalVouchers.findMany({
    where: inArray(
      journalVouchers.id,
      noted.map((entry) => entry.voucherId)
    ),
    with: { lines: { orderBy: (line, { asc }) => [asc(line.sortOrder)] } },
  });
  const byId = new Map(vouchers.map((voucher) => [voucher.id, voucher]));

  const contexts: JournalHookContext[] = [];
  for (const { voucherId, source } of noted) {
    const voucher = byId.get(voucherId);
    // Тэр транзакц дотроо устсан / дахин өөрчлөгдсөн журнал — hook-гүй.
    if (!voucher || voucher.status !== "posted") continue;
    const lines = voucher.lines.map((line) => ({
      account: line.accountNumber,
      debit: Number(line.debit),
      credit: Number(line.credit),
      description: line.description ?? "",
    }));
    const context: JournalHookContext = {
      orgId: voucher.organizationId,
      userId: voucher.userId,
      voucherId,
      date: voucher.date,
      description: voucher.description,
      lines,
      totalDebit: lines.reduce((sum, line) => sum + line.debit, 0),
      source,
      documentNo: voucher.documentNo,
      externalRef: voucher.externalRef,
      reversal: !!voucher.reversalOfVoucherId || isStornoLines(lines),
    };
    if (!context.reversal) await runBeforeJournalPost(context);
    contexts.push(context);
  }
  return contexts;
}

/** Commit-ийн ДАРАА — алдаа хэзээ ч бичилтийг унагахгүй (loader залгина). */
export async function runAfterJournalPostHooks(contexts: readonly JournalHookContext[]): Promise<void> {
  for (const context of contexts) await runAfterJournalPost(context);
}
