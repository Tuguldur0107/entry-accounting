"use client";

// Панелийн kind → component БҮРТГЭЛ. Шинэ панелийн төрөл нэмэхэд:
//   1. lib/store/panel-store.ts — PanelKind-д нэр + openXxxPanel туслах
//   2. components/panel/<kind>-panel.tsx — агуулгын component
//   3. ЭНД бүртгэнэ
// PanelHost энэ бүртгэлээс уншдаг тул panel-host.tsx-д гар хүрэхгүй.

import type { PanelInstance, PanelKind } from "@/lib/store/panel-store";

import { AiChatPanel } from "./ai-chat-panel";
import { ArapDocPanel } from "./arap-doc-panel";
import { CashDocPanel } from "./cash-doc-panel";
import { CashNewPanel } from "./cash-new-panel";
import { CostEntryPanel } from "./cost-entry-panel";
import { DrillPanel } from "./drill-panel";
import { FaAssetPanel } from "./fa-asset-panel";
import { GoodsReceiptPanel } from "./goods-receipt-panel";
import { PosSalePanel } from "./pos-sale-panel";
import { PurchaseOrderPanel } from "./purchase-order-panel";
import { ReportLinePanel } from "./report-line-panel";
import { FaAssetFormPanel } from "./fa-asset-form-panel";
import { VoucherPanel } from "./voucher-panel";

export interface PanelBodyProps {
  panel: PanelInstance;
  /** Панелийн хаалт — dirty бол баталгаажуулалттай (PanelHost эзэмшинэ). */
  requestClose: () => void;
}

export interface PanelKindConfig {
  component: React.ComponentType<PanelBodyProps>;
  /**
   * Хураастай + цэвэр байсан ч mounted үлдэх эсэх. Анхдагчаар цэвэр
   * хураастай панель unmount хийгдэж, сэргээхэд шинээр татагддаг (санах ой
   * хэмнэнэ). Арын процесстой (жишээ нь стрийм явж буй чат) панель true.
   */
  keepMounted?: boolean;
  /**
   * SIM2-031: богино формтой панель — анхны хэмжээ агуулгадаа тохирно
   * (өргөн, дээд өндөр px). Байхгүй бол дэлгэц дүүрэн (мөртэй баримт).
   */
  compact?: { width: number; maxHeight: number };
}

export const PANEL_REGISTRY: Record<PanelKind, PanelKindConfig> = {
  voucher: { component: VoucherPanel },
  "voucher-new": { component: VoucherPanel },
  drill: { component: DrillPanel },
  "report-line": { component: ReportLinePanel },
  "cash-doc": { component: CashDocPanel },
  "cash-new": { component: CashNewPanel, compact: { width: 760, maxHeight: 720 } },
  "cost-entry": { component: CostEntryPanel },
  "fa-asset": { component: FaAssetPanel },
  "fa-asset-form": { component: FaAssetFormPanel },
  "arap-doc": { component: ArapDocPanel },
  "purchase-order": { component: PurchaseOrderPanel },
  "goods-receipt": { component: GoodsReceiptPanel },
  "pos-sale": { component: PosSalePanel },
  "ai-chat": { component: AiChatPanel, keepMounted: true },
};
