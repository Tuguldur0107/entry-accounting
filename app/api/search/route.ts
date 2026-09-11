import { and, desc, eq, ilike, or } from "drizzle-orm";

import { getActiveOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  arApDocuments,
  cashDocuments,
  journalVouchers,
  purchaseOrders,
} from "@/lib/db/schema";

export const runtime = "nodejs";

const GROUP_LIMIT = 6;

/** Захиалгын төлөв — палитрт монголоор харуулна. */
const PO_STATUS_LABELS: Record<string, string> = {
  draft: "ноорог",
  open: "нээлттэй",
  closed: "хаагдсан",
  cancelled: "цуцлагдсан",
};

/**
 * П10 — палитрын баримтын хайлт: АР/АП нэхэмжлэх, кассын баримт, журнал,
 * худалдан авалтын захиалга (PO) — дугаар/тайлбар/харилцагчаар. Лавлах дата
 * (данс/харилцагч/бараа) клиент кэшээс шүүгддэг тул энд ирэхгүй.
 */
export async function GET(request: Request) {
  let orgId: string;
  try {
    ({ orgId } = await getActiveOrg());
  } catch {
    return Response.json({ error: "Нэвтрэх шаардлагатай" }, { status: 401 });
  }

  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (query.length < 2)
    return Response.json({
      arap: [],
      cash: [],
      vouchers: [],
      purchaseOrders: [],
    });
  // ilike-ийн % ба _ тусгай тэмдэгтүүдийг literal болгоно.
  const pattern = `%${query.replace(/[\\%_]/g, "\\$&")}%`;

  try {
    const [arap, cash, vouchers, orders] = await Promise.all([
      db.query.arApDocuments.findMany({
        where: and(
          eq(arApDocuments.organizationId, orgId),
          or(
            ilike(arApDocuments.documentNo, pattern),
            ilike(arApDocuments.description, pattern)
          )
        ),
        columns: {
          id: true,
          documentNo: true,
          documentType: true,
          description: true,
          date: true,
          status: true,
        },
        with: { counterparty: { columns: { name: true } } },
        orderBy: [desc(arApDocuments.date)],
        limit: GROUP_LIMIT,
      }),
      db.query.cashDocuments.findMany({
        where: and(
          eq(cashDocuments.organizationId, orgId),
          or(
            ilike(cashDocuments.documentNo, pattern),
            ilike(cashDocuments.counterparty, pattern),
            ilike(cashDocuments.description, pattern)
          )
        ),
        columns: {
          id: true,
          documentNo: true,
          counterparty: true,
          description: true,
          date: true,
          status: true,
        },
        orderBy: [desc(cashDocuments.date)],
        limit: GROUP_LIMIT,
      }),
      db.query.journalVouchers.findMany({
        where: and(
          eq(journalVouchers.organizationId, orgId),
          ilike(journalVouchers.description, pattern)
        ),
        columns: { id: true, description: true, date: true, status: true },
        orderBy: [desc(journalVouchers.date)],
        limit: GROUP_LIMIT,
      }),
      db.query.purchaseOrders.findMany({
        where: and(
          eq(purchaseOrders.organizationId, orgId),
          or(
            ilike(purchaseOrders.documentNo, pattern),
            ilike(purchaseOrders.description, pattern),
            ilike(purchaseOrders.externalRef, pattern)
          )
        ),
        columns: {
          id: true,
          documentNo: true,
          description: true,
          date: true,
          status: true,
        },
        with: { counterparty: { columns: { name: true } } },
        orderBy: [desc(purchaseOrders.date)],
        limit: GROUP_LIMIT,
      }),
    ]);

    return Response.json({
      arap: arap.map((document) => ({
        id: document.id,
        documentNo: document.documentNo,
        documentType: document.documentType,
        label: `${document.documentNo} · ${document.counterparty.name}`,
        sub: `${document.date} · ${document.status}`,
      })),
      cash: cash.map((document) => ({
        id: document.id,
        documentNo: document.documentNo,
        label: `${document.documentNo}${document.counterparty ? ` · ${document.counterparty}` : ""}`,
        sub: `${document.date} · ${document.status}`,
      })),
      vouchers: vouchers.map((voucher) => ({
        id: voucher.id,
        label: voucher.description,
        sub: `${voucher.date} · ${voucher.status}`,
      })),
      purchaseOrders: orders.map((order) => ({
        id: order.id,
        documentNo: order.documentNo,
        label: `${order.documentNo} · ${order.counterparty.name}`,
        sub: `${order.date} · ${PO_STATUS_LABELS[order.status] ?? order.status}`,
      })),
    });
  } catch (caught) {
    const message =
      caught instanceof Error ? caught.message : "Хайлт ажилласангүй";
    return Response.json({ error: message }, { status: 400 });
  }
}
