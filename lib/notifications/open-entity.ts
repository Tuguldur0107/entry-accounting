"use client";

// Мэдэгдэл дарахад ХААНА очих вэ — entityType (аудитын үгсийн сан) →
// панель (lib/store/panel-store.ts-ийн open* туслахууд); панельгүй объект
// (period, payroll, inventory, fa элэгдэл, ханшийн тэгшитгэл) → href.
// Шинэ панель бичихгүй — байгаа dispatcher-ууд л.

import {
  openArapDocPanel,
  openCashDocPanel,
  openCostEntryPanel,
  openGoodsReceiptPanel,
  openPurchaseOrderPanel,
  openVoucherPanel,
} from "@/lib/store/panel-store";

export interface NotificationTarget {
  href: string | null;
  entityType: string | null;
  entityId: string | null;
  payload: Record<string, unknown> | null;
}

/** Панель нээгдвэл true; үгүй бол дуудагч href руу шилжинэ. */
export function openNotificationPanel(target: NotificationTarget): boolean {
  const { entityType, entityId } = target;
  if (!entityType || !entityId) return false;
  const action = typeof target.payload?.action === "string" ? target.payload.action : "";
  switch (entityType) {
    case "journal":
      openVoucherPanel(entityId);
      return true;
    case "arap":
      openArapDocPanel({
        documentId: entityId,
        mode: target.href?.startsWith("/payables") ? "payable" : "receivable",
      });
      return true;
    case "cash":
      // fx_post / fx_reverse нь тэгшитгэлийн id — кассын баримт биш.
      if (action.startsWith("fx_")) return false;
      openCashDocPanel(entityId);
      return true;
    case "cost":
      openCostEntryPanel(entityId);
      return true;
    case "purchase_order":
      openPurchaseOrderPanel({ purchaseOrderId: entityId });
      return true;
    case "goods_receipt":
      openGoodsReceiptPanel({ receiptId: entityId });
      return true;
    default:
      return false;
  }
}

/** Панель эсвэл href — аль нэгээр нь очно. */
export function openNotificationTarget(
  target: NotificationTarget,
  router: { push: (href: string) => void }
): void {
  if (openNotificationPanel(target)) return;
  if (target.href) router.push(target.href);
}
