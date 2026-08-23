"use client";

// Ажлын панелийн НЭГДСЭН бүртгэл (Zustand). Chat програмын загвар:
// хэд хэдэн ажлыг зэрэг нээж, хураан, хооронд нь сэлгэнэ.
//
// Гол дүрмүүд:
//   - Нэг зүйлийг (жишээ нь нэг журнал) хоёр удаа нээхгүй — байгааг нь
//     фокуслоно (key-ээр dedupe) ба refreshToken-ийг өсгөж дахин ачаалуулна.
//   - Хураахад панель UNMOUNT ХИЙГДЭХГҮЙ — зөвхөн нуугдана. Тиймээс бөглөж
//     байсан форм, бичиж байсан журнал хэвээр үлдэнэ.
//   - Харагдаж буй панель дээд тал нь MAX_PANELS — нээх, сэргээх, dedupe
//     БҮХ зам дээр мөрдөнө; хэтэрвэл хамгийн эртнийг ХУРААНА (хаахгүй).
//   - Байрлал `slot`-оор тогтмол: фокус солиход панель ХӨДЛӨХГҮЙ, зөвхөн
//     zIndex өөрчлөгдөнө (эс бөгөөс идэвхгүй панелийн товч дээр дарахад
//     mousedown дээр байрлал сольчихоод click нь өөр газар буудаг).

import { create } from "zustand";

export type PanelKind =
  | "voucher" // GL журнал — засах эсвэл харах
  | "voucher-new" // Шинэ журнал бичих
  | "drill" // Самбарын метрикийн задаргаа (журналуудын жагсаалт)
  | "cash-doc" // Мөнгөн гүйлгээний баримтын дэлгэрэнгүй
  | "cash-new" // Шинэ мөнгөн гүйлгээ / АР-АП төлөлт бичих
  | "cost-entry" // Өртгийн бичилтийн дэлгэрэнгүй
  | "fa-asset" // Үндсэн хөрөнгийн карт — дэлгэрэнгүй
  | "fa-asset-form" // Хөрөнгө үүсгэх / картыг бөглөж идэвхжүүлэх
  | "arap-doc" // АР/АП баримт — үүсгэх эсвэл харах
  | "ai-chat"; // AI туслах — глобал хөвөгч чат

/** Самбарын задаргааны нэг мөр (drill панелийн payload-д). */
export interface DrillPanelRow {
  id: string;
  date: string;
  description: string;
  module: string;
  lineCount: number;
  amount: number;
  status: string;
}

/** Drill панелийн payload — самбар дээр бодогдсон мөрүүдийг шууд авч явна. */
export interface DrillPanelPayload {
  title: string;
  note?: string;
  rows: DrillPanelRow[];
  link?: { href: string; label: string };
  [key: string]: unknown;
}

export interface PanelInstance {
  /** Дотоод дахин давтагдашгүй id. */
  id: string;
  /** Ижил зүйлийг дахин нээхээс сэргийлэх түлхүүр (kind + бизнес id). */
  key: string;
  kind: PanelKind;
  title: string;
  /** Панелийн төрлөөс хамаарсан props (PanelHost дотор тайлагдана). */
  payload: Record<string, unknown>;
  /**
   * Дахин ачаалах дохио — dedupe-ээр дахин нээх, хураагдснаа сэргэх бүрд
   * өснө. Панелийн агуулга үүнийг fetch effect-ийнхээ dep болгоно.
   */
  refreshToken: number;
  minimized: boolean;
  /** Дэлгэц дүүрэн горим. */
  maximized: boolean;
  /** Нээгдсэн/фокуслогдсон дараалал — zIndex-ийн зэрэглэлд. */
  order: number;
  /** Байрлалын тогтмол суудал (0..MAX-1) — шатласан офсет үүнээс. */
  slot: number;
  /** Хадгалаагүй өөрчлөлттэй эсэх — хаахад анхааруулна. */
  dirty: boolean;
}

export const MAX_PANELS = 5;

type PanelState = {
  panels: PanelInstance[];
  /** Фокустай панелийн id (хамгийн дээр харагдана). */
  activeId: string | null;
  openPanel: (input: {
    key: string;
    kind: PanelKind;
    title: string;
    payload?: Record<string, unknown>;
  }) => string;
  closePanel: (id: string) => void;
  closeAll: () => void;
  minimize: (id: string) => void;
  restore: (id: string) => void;
  toggleMaximize: (id: string) => void;
  focus: (id: string) => void;
  setTitle: (id: string, title: string) => void;
  setDirty: (id: string, dirty: boolean) => void;
  refreshOpenPanels: () => void;
  /**
   * Жагсаалтын өмнөх/дараагийн баримт руу панель дотроосоо шилжих.
   * payload-д navIds (жагсаалтын id-ууд) + navField (аль талбар нь id вэ)
   * байвал л ажиллана; dirty панель шилжихгүй (бөглөсөн зүйл алдагдана).
   */
  navigatePanel: (id: string, direction: 1 | -1) => void;
};

let seq = 0;
let newVoucherSeq = 0;
const nextId = () => `panel-${++seq}`;

const visibleOf = (panels: PanelInstance[]) =>
  panels.filter((panel) => !panel.minimized);

/** Харагдах тоог MAX-д барина: keepId-ээс бусдын хамгийн эртнийг хураана. */
function enforceVisibleCap(
  panels: PanelInstance[],
  keepId: string | null
): PanelInstance[] {
  let result = panels;
  for (;;) {
    const visible = visibleOf(result).filter((panel) => panel.id !== keepId);
    const total = visibleOf(result).length;
    if (total < MAX_PANELS || visible.length === 0) return result;
    const oldest = visible.reduce((a, b) => (a.order < b.order ? a : b));
    result = result.map((panel) =>
      panel.id === oldest.id
        ? { ...panel, minimized: true, maximized: false }
        : panel
    );
  }
}

/** Харагдаж буй панелиудын эзэлээгүй хамгийн бага суудал. */
function freeSlot(panels: PanelInstance[]): number {
  const taken = new Set(visibleOf(panels).map((panel) => panel.slot));
  let slot = 0;
  while (taken.has(slot)) slot += 1;
  return slot;
}

/** Фокус шилжих дараагийн панель — хамгийн сүүлд идэвхтэй байсан харагдах нь. */
function topVisibleId(panels: PanelInstance[]): string | null {
  return (
    visibleOf(panels).reduce<PanelInstance | null>(
      (top, panel) => (!top || panel.order > top.order ? panel : top),
      null
    )?.id ?? null
  );
}

export const usePanelStore = create<PanelState>()((set, get) => ({
  panels: [],
  activeId: null,

  openPanel: ({ key, kind, title, payload = {} }) => {
    const existing = get().panels.find((panel) => panel.key === key);
    if (existing) {
      // Дахин нээхгүй — сэргээж фокуслоод, агуулгыг нь дахин ачаалуулна.
      // Payload-ыг ШИНЭЭР солино — нээгч талаас шинэ өгөгдөл (жишээ нь
      // самбар дахин бодогдсон drill мөрүүд) ирсэн байж болно.
      set((state) => {
        let panels = state.panels;
        if (existing.minimized)
          panels = enforceVisibleCap(panels, existing.id);
        const slot = existing.minimized ? freeSlot(panels) : existing.slot;
        return {
          panels: panels.map((panel) =>
            panel.id === existing.id
              ? {
                  ...panel,
                  title,
                  payload,
                  minimized: false,
                  order: ++seq,
                  slot,
                  refreshToken: panel.refreshToken + 1,
                }
              : panel
          ),
          activeId: existing.id,
        };
      });
      return existing.id;
    }

    const id = nextId();
    set((state) => {
      const panels = enforceVisibleCap(state.panels, null);
      return {
        panels: [
          ...panels,
          {
            id,
            key,
            kind,
            title,
            payload,
            refreshToken: 0,
            minimized: false,
            maximized: false,
            order: ++seq,
            slot: freeSlot(panels),
            dirty: false,
          },
        ],
        activeId: id,
      };
    });
    return id;
  },

  closePanel: (id) =>
    set((state) => {
      const panels = state.panels.filter((panel) => panel.id !== id);
      return {
        panels,
        activeId:
          state.activeId === id ? topVisibleId(panels) : state.activeId,
      };
    }),

  closeAll: () => set({ panels: [], activeId: null }),

  minimize: (id) =>
    set((state) => {
      const panels = state.panels.map((panel) =>
        panel.id === id
          ? { ...panel, minimized: true, maximized: false }
          : panel
      );
      return {
        panels,
        activeId:
          state.activeId === id ? topVisibleId(panels) : state.activeId,
      };
    }),

  restore: (id) =>
    set((state) => {
      let panels = enforceVisibleCap(state.panels, id);
      panels = panels.map((panel) =>
        panel.id === id
          ? {
              ...panel,
              minimized: false,
              order: ++seq,
              slot: freeSlot(panels),
              // Хураастай байх зуур өгөгдөл хуучирсан байж болно.
              refreshToken: panel.refreshToken + 1,
            }
          : panel
      );
      return { panels, activeId: id };
    }),

  toggleMaximize: (id) =>
    set((state) => ({
      panels: state.panels.map((panel) =>
        panel.id === id ? { ...panel, maximized: !panel.maximized } : panel
      ),
      activeId: id,
    })),

  focus: (id) =>
    set((state) => {
      const target = state.panels.find((panel) => panel.id === id);
      if (!target || state.activeId === id) return state;
      return {
        panels: state.panels.map((panel) =>
          panel.id === id ? { ...panel, order: ++seq } : panel
        ),
        activeId: id,
      };
    }),

  setTitle: (id, title) =>
    set((state) => {
      const target = state.panels.find((panel) => panel.id === id);
      if (!target || target.title === title) return state;
      return {
        panels: state.panels.map((panel) =>
          panel.id === id ? { ...panel, title } : panel
        ),
      };
    }),

  // Мутаци амжилттай болсны дараа НЭЭЛТТЭЙ бусад панелиудын өгөгдлийг
  // сэргээнэ (refreshToken bump → fetch effect дахин ажиллана). Эс бөгөөс
  // жишээ нь нэхэмжлэлийн панель төлөлт хийгдсэний дараа ч хуучин үлдэгдлээ
  // үзүүлсээр байдаг. Dirty панель хамгаалагдана — тэдний fetch effect
  // өөрөө алгасдаг тул бичсэн зүйл алдагдахгүй.
  refreshOpenPanels: () =>
    set((state) => ({
      panels: state.panels.map((panel) =>
        panel.dirty
          ? panel
          : { ...panel, refreshToken: panel.refreshToken + 1 }
      ),
    })),

  navigatePanel: (id, direction) =>
    set((state) => {
      const panel = state.panels.find((entry) => entry.id === id);
      if (!panel || panel.dirty) return state;
      const navIds = panel.payload.navIds as string[] | undefined;
      const navField = panel.payload.navField as string | undefined;
      if (!navIds?.length || !navField) return state;
      const current = panel.payload[navField] as string | undefined;
      const index = current ? navIds.indexOf(current) : -1;
      const next = index >= 0 ? navIds[index + direction] : undefined;
      if (!next) return state;
      return {
        panels: state.panels.map((entry) =>
          entry.id === id
            ? {
                ...entry,
                // Dedupe key нь бизнес id агуулдаг тул хамт шинэчилнэ —
                // эс бөгөөс жагсаалтаас мөн баримтыг дахин нээхэд давхар
                // панель үүснэ.
                key: current ? entry.key.replace(current, next) : entry.key,
                payload: { ...entry.payload, [navField]: next },
              }
            : entry
        ),
      };
    }),

  setDirty: (id, dirty) =>
    set((state) => {
      // Өөрчлөгдөөгүй бол state-ээ хэвээр буцаана — эс бөгөөс формын
      // onDirtyChange → setDirty → дахин render → onDirtyChange гэсэн
      // төгсгөлгүй давталт үүснэ.
      const target = state.panels.find((panel) => panel.id === id);
      if (!target || target.dirty === dirty) return state;
      return {
        panels: state.panels.map((panel) =>
          panel.id === id ? { ...panel, dirty } : panel
        ),
      };
    }),
}));

/**
 * Мутацийн дараах нэгдсэн сэргээлт — router.refresh()-тэй ХАМТ дуудна.
 * router.refresh() нь server component-уудыг л шинэчилдэг, нээлттэй
 * панелиудын client fetch-ийг хөндөдгүй.
 */
export function refreshOpenPanels() {
  usePanelStore.getState().refreshOpenPanels();
}

/**
 * Жагсаалтаас нээгдэх панелиудын prev/next навигацийн payload хэсэг —
 * navIds өгвөл панелийн толгойд ‹ › сумнууд гарч жагсаалт дотор шилжинэ.
 */
function navPayload(navField: string, navIds?: string[]) {
  return navIds && navIds.length > 1 ? { navIds, navField } : {};
}

/** Панель нээх богино туслахууд — callsite бүрд key/title давтахгүйн тулд. */
export function openVoucherPanel(
  voucherId: string,
  title?: string,
  navIds?: string[]
) {
  return usePanelStore.getState().openPanel({
    key: `voucher:${voucherId}`,
    kind: "voucher",
    title: title || "Журнал",
    payload: { voucherId, ...navPayload("voucherId", navIds) },
  });
}

export function openNewVoucherPanel() {
  // Дарах бүрд ШИНЭ хоосон форм — тогтмол key байсан бол өмнөх хагас
  // бөглөсөн ноорог чимээгүй сэргэж, хэрэглэгчийг төөрөлдүүлнэ.
  return usePanelStore.getState().openPanel({
    key: `voucher:new:${++newVoucherSeq}`,
    kind: "voucher-new",
    title: "Шинэ журнал",
    payload: {},
  });
}

/** Самбарын метрикийн задаргаа — мөрүүд нь payload-аар шууд дамжина. */
export function openDrillPanel(payload: DrillPanelPayload) {
  return usePanelStore.getState().openPanel({
    key: `drill:${payload.title}`,
    kind: "drill",
    title: payload.title,
    payload,
  });
}

/** Мөнгөн гүйлгээний баримтын дэлгэрэнгүй. */
export function openCashDocPanel(
  documentId: string,
  title?: string,
  navIds?: string[]
) {
  return usePanelStore.getState().openPanel({
    key: `cash-doc:${documentId}`,
    kind: "cash-doc",
    title: title || "Мөнгөн гүйлгээ",
    payload: { documentId, ...navPayload("documentId", navIds) },
  });
}

/** Татварын төлөлтийн prefill — Татвар модулийн "Төлөлт хийх" товчноос. */
export interface CashTaxPaymentInit {
  /** Татварын өглөгийн үндсэн данс (8 орон) — зарлагын харилцах данс. */
  counterAccountNumber: string;
  description: string;
  /** Панелийн гарчиг (default "Татварын төлөлт"). */
  title?: string;
}

/**
 * Шинэ мөнгөн гүйлгээ бичих. arApDocumentId өгвөл тухайн АР/АП баримтын
 * төлөлт болгож урьдчилан бөглөнө (АР/АП-ийн "Төлөлт" товчноос);
 * taxPayment өгвөл татварын өглөг рүү хийх зарлага болгож бөглөнө.
 */
export function openCashNewPanel(init?: {
  arApDocumentId?: string;
  taxPayment?: CashTaxPaymentInit;
}) {
  const settlement = init?.arApDocumentId;
  const taxPayment = init?.taxPayment;
  return usePanelStore.getState().openPanel({
    // Төлөлт нь баримт бүрд тусдаа панель; энгийн шинэ гүйлгээ нь
    // дарах бүрд шинэ хоосон форм.
    key: settlement
      ? `cash-new:arap:${settlement}`
      : `cash-new:${++newVoucherSeq}`,
    kind: "cash-new",
    title: settlement
      ? "АР/АП төлөлт"
      : taxPayment
        ? taxPayment.title ?? "Татварын төлөлт"
        : "Шинэ мөнгөн гүйлгээ",
    payload: { arApDocumentId: settlement, taxPayment },
  });
}

/** Өртгийн бичилтийн дэлгэрэнгүй. */
export function openCostEntryPanel(entryId: string, title?: string) {
  return usePanelStore.getState().openPanel({
    key: `cost-entry:${entryId}`,
    kind: "cost-entry",
    title: title || "Өртгийн бичилт",
    payload: { entryId },
  });
}

/** Үндсэн хөрөнгийн карт — дэлгэрэнгүй. */
export function openFaAssetPanel(
  assetId: string,
  title?: string,
  navIds?: string[]
) {
  return usePanelStore.getState().openPanel({
    key: `fa-asset:${assetId}`,
    kind: "fa-asset",
    title: title || "Үндсэн хөрөнгө",
    payload: { assetId, ...navPayload("assetId", navIds) },
  });
}

/**
 * Хөрөнгийн форм: assetId өгвөл тухайн картыг бөглөж идэвхжүүлэх,
 * өгөхгүй бол шинэ хөрөнгө үүсгэх.
 */
export function openFaAssetFormPanel(init?: { assetId?: string }) {
  const assetId = init?.assetId;
  return usePanelStore.getState().openPanel({
    key: assetId ? `fa-asset-form:${assetId}` : `fa-asset-form:new:${++newVoucherSeq}`,
    kind: "fa-asset-form",
    title: assetId ? "Хөрөнгө идэвхжүүлэх" : "Шинэ үндсэн хөрөнгө",
    payload: { assetId },
  });
}

/**
 * АР/АП баримт: documentId өгвөл харах, өгөхгүй бол шинээр үүсгэх.
 * mode нь receivable/payable/combined харагдацын аль нь болохыг заана.
 */
export function openArapDocPanel(init: {
  documentId?: string;
  mode: "receivable" | "payable" | "combined";
  title?: string;
  navIds?: string[];
}) {
  const { documentId, mode, title, navIds } = init;
  return usePanelStore.getState().openPanel({
    key: documentId
      ? `arap-doc:${documentId}`
      : `arap-doc:new:${++newVoucherSeq}`,
    kind: "arap-doc",
    title:
      title ||
      (documentId
        ? "АР/АП баримт"
        : mode === "payable"
          ? "Шинэ нэхэмжлэх"
          : "Шинэ нэхэмжлэл"),
    payload: {
      documentId,
      mode,
      ...(documentId ? navPayload("documentId", navIds) : {}),
    },
  });
}

/** AI туслах — глобал нэг чат панель (dedupe key тогтмол). */
export function openAiChatPanel() {
  return usePanelStore.getState().openPanel({
    key: "ai-chat",
    kind: "ai-chat",
    title: "AI туслах",
    payload: {},
  });
}
