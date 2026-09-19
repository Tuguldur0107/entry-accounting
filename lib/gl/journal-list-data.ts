// Журналын жагсаалтын мөр — ваучер + мөрүүд дээр ЭХ БАРИМТЫН лавлагаа
// (харилцагч, валют, ханш) ба үүсгэсэн хэрэглэгчийг нэмнэ.
//
// journal_vouchers хүснэгтэд валют/харилцагч БАЙХГҮЙ (GL нь зөвхөн MNT) —
// эдгээр нь кассын баримт (cash_documents) ба АР/АП баримтын (ar_ap_documents)
// voucherId / reversalVoucherId холбоосоор олдоно. Бусад эх (ҮХ элэгдэл,
// цалин, өртөг, FX тэгшитгэл, гар журнал) MNT-ээр, харилцагчгүй.
//
// Валютын дүн = MNT дүн ÷ баримтын ханш (2 орон) — ЛАВЛАГАА (журналын мөр
// өөрөө MNT-ээр л хадгалагддаг тул эх баримтын валютын дүнгээс бөөрөнхийллийн
// хэмжээгээр зөрч болно). Ханш зохиохгүй: ханшгүй / MNT баримт → валютын
// дүн харагдахгүй.

import { and, eq, inArray, isNotNull, or } from "drizzle-orm";

// ⚠ Энэ модуль `@/lib/db`-г import хийдэг — ЗӨВХӨН server (page.tsx) дуудна.
// Client component-д хэрэгтэй төрөл/цэвэр функц journal-list-types.ts-д.

import { db } from "@/lib/db";
import {
  arApDocuments,
  cashDocuments,
  counterparties,
  journalVouchers,
  users,
} from "@/lib/db/schema";
import type { JournalListRow } from "@/lib/gl/journal-list-types";

export type { JournalListRow } from "@/lib/gl/journal-list-types";

type SourceMeta = {
  counterpartyName: string | null;
  currency: string;
  exchangeRate: number | null;
};

/** Ханшийг зөвхөн валютын баримтад, 0/1-ээс өөр бодит тоо үед л буцаана. */
function rateOf(currency: string, raw: string | null): number | null {
  if (currency === "MNT") return null;
  const rate = Number(raw);
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

export async function loadJournalListRows(
  orgId: string
): Promise<JournalListRow[]> {
  const vouchers = await db.query.journalVouchers.findMany({
    where: eq(journalVouchers.organizationId, orgId),
    with: { lines: { orderBy: (l, { asc }) => [asc(l.sortOrder)] } },
    orderBy: (v, { desc }) => [desc(v.date), desc(v.createdAt)],
  });
  if (vouchers.length === 0) return [];

  const userIds = [...new Set(vouchers.map((voucher) => voucher.userId))];
  const [cashDocs, arapDocs, userRows] = await Promise.all([
    db
      .select({
        voucherId: cashDocuments.voucherId,
        reversalVoucherId: cashDocuments.reversalVoucherId,
        counterparty: cashDocuments.counterparty,
        currency: cashDocuments.currency,
        exchangeRate: cashDocuments.exchangeRate,
      })
      .from(cashDocuments)
      .where(
        and(
          eq(cashDocuments.organizationId, orgId),
          or(
            isNotNull(cashDocuments.voucherId),
            isNotNull(cashDocuments.reversalVoucherId)
          )
        )
      ),
    db
      .select({
        voucherId: arApDocuments.voucherId,
        reversalVoucherId: arApDocuments.reversalVoucherId,
        counterpartyName: counterparties.name,
        currency: arApDocuments.currency,
        exchangeRate: arApDocuments.exchangeRate,
      })
      .from(arApDocuments)
      .innerJoin(counterparties, eq(counterparties.id, arApDocuments.counterpartyId))
      .where(
        and(
          eq(arApDocuments.organizationId, orgId),
          or(
            isNotNull(arApDocuments.voucherId),
            isNotNull(arApDocuments.reversalVoucherId)
          )
        )
      ),
    db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(inArray(users.id, userIds)),
  ]);

  const metaByVoucher = new Map<string, SourceMeta>();
  const attach = (
    ids: (string | null)[],
    meta: SourceMeta
  ) => {
    for (const id of ids) if (id && !metaByVoucher.has(id)) metaByVoucher.set(id, meta);
  };
  for (const doc of arapDocs)
    attach([doc.voucherId, doc.reversalVoucherId], {
      counterpartyName: doc.counterpartyName,
      currency: doc.currency,
      exchangeRate: rateOf(doc.currency, doc.exchangeRate),
    });
  // Касс АР/АП-ийн дараа: нэг журналд хоёулаа холбогдсон бол (төлбөр)
  // харилцагчийн бүртгэлийн нэр давуу, кассын чөлөөт текст нөхнө.
  for (const doc of cashDocs)
    attach([doc.voucherId, doc.reversalVoucherId], {
      counterpartyName: doc.counterparty?.trim() || null,
      currency: doc.currency,
      exchangeRate: rateOf(doc.currency, doc.exchangeRate),
    });

  const userNameById = new Map(userRows.map((user) => [user.id, user.name]));

  return vouchers.map((voucher) => {
    const meta = metaByVoucher.get(voucher.id);
    return {
      ...voucher,
      counterpartyName: meta?.counterpartyName ?? null,
      currency: meta?.currency ?? "MNT",
      exchangeRate: meta?.exchangeRate ?? null,
      createdByName: userNameById.get(voucher.userId) ?? "—",
    };
  });
}
