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
}

export const PANEL_REGISTRY: Record<PanelKind, PanelKindConfig> = {
  voucher: { component: VoucherPanel },
  "voucher-new": { component: VoucherPanel },
  drill: { component: DrillPanel },
  "cash-doc": { component: CashDocPanel },
  "cash-new": { component: CashNewPanel },
  "cost-entry": { component: CostEntryPanel },
  "fa-asset": { component: FaAssetPanel },
  "fa-asset-form": { component: FaAssetFormPanel },
  "arap-doc": { component: ArapDocPanel },
  "ai-chat": { component: AiChatPanel, keepMounted: true },
};
