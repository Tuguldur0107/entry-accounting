"use client";

// Ажлын панелийн НЭГДСЭН бүртгэл (Zustand). Chat програмын загвар:
// хэд хэдэн ажлыг зэрэг нээж, хураан, хооронд нь сэлгэнэ.
//
// Гол дүрмүүд:
//   - Нэг зүйлийг (жишээ нь нэг журнал) хоёр удаа нээхгүй — байгааг нь
//     фокуслоно (key-ээр dedupe).
//   - Хураахад панель UNMOUNT ХИЙГДЭХГҮЙ — зөвхөн нуугдана. Тиймээс бөглөж
//     байсан форм, бичиж байсан журнал хэвээр үлдэнэ.
//   - Дээд тал нь MAX_PANELS; хэтэрвэл хамгийн эртний ХУРААГДААГҮЙ панелийг
//     хураана (хаахгүй — өгөгдөл алдагдахгүй).

import { create } from "zustand";

export type PanelKind =
  | "voucher" // GL журнал — засах эсвэл харах
  | "voucher-new" // Шинэ журнал бичих
  | "drill"; // Самбарын метрикийн задаргаа

export interface PanelInstance {
  /** Дотоод дахин давтагдашгүй id. */
  id: string;
  /** Ижил зүйлийг дахин нээхээс сэргийлэх түлхүүр (kind + бизнес id). */
  key: string;
  kind: PanelKind;
  title: string;
  /** Панелийн төрлөөс хамаарсан props (PanelHost дотор тайлагдана). */
  payload: Record<string, unknown>;
  minimized: boolean;
  /** Дэлгэц дүүрэн горим. */
  maximized: boolean;
  /** Нээгдсэн дараалал — стекийн байрлал тооцоход. */
  order: number;
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
};

let seq = 0;
const nextId = () => `panel-${++seq}`;

export const usePanelStore = create<PanelState>()((set, get) => ({
  panels: [],
  activeId: null,

  openPanel: ({ key, kind, title, payload = {} }) => {
    const existing = get().panels.find((panel) => panel.key === key);
    if (existing) {
      // Дахин нээхгүй — байгааг нь сэргээж фокуслоно.
      set((state) => ({
        panels: state.panels.map((panel) =>
          panel.id === existing.id
            ? { ...panel, minimized: false, order: ++seq }
            : panel
        ),
        activeId: existing.id,
      }));
      return existing.id;
    }

    const id = nextId();
    set((state) => {
      let panels = [...state.panels];
      // Хязгаар хэтэрвэл хамгийн эртний хураагдаагүйг хураана (хаахгүй).
      const visible = panels.filter((panel) => !panel.minimized);
      if (visible.length >= MAX_PANELS) {
        const oldest = visible.reduce((a, b) => (a.order < b.order ? a : b));
        panels = panels.map((panel) =>
          panel.id === oldest.id ? { ...panel, minimized: true } : panel
        );
      }
      panels.push({
        id,
        key,
        kind,
        title,
        payload,
        minimized: false,
        maximized: false,
        order: ++seq,
        dirty: false,
      });
      return { panels, activeId: id };
    });
    return id;
  },

  closePanel: (id) =>
    set((state) => {
      const panels = state.panels.filter((panel) => panel.id !== id);
      const activeId =
        state.activeId === id
          ? panels
              .filter((panel) => !panel.minimized)
              .reduce<PanelInstance | null>(
                (top, panel) => (!top || panel.order > top.order ? panel : top),
                null
              )?.id ?? null
          : state.activeId;
      return { panels, activeId };
    }),

  closeAll: () => set({ panels: [], activeId: null }),

  minimize: (id) =>
    set((state) => {
      const panels = state.panels.map((panel) =>
        panel.id === id ? { ...panel, minimized: true, maximized: false } : panel
      );
      const activeId =
        state.activeId === id
          ? panels
              .filter((panel) => !panel.minimized)
              .reduce<PanelInstance | null>(
                (top, panel) => (!top || panel.order > top.order ? panel : top),
                null
              )?.id ?? null
          : state.activeId;
      return { panels, activeId };
    }),

  restore: (id) =>
    set((state) => ({
      panels: state.panels.map((panel) =>
        panel.id === id ? { ...panel, minimized: false, order: ++seq } : panel
      ),
      activeId: id,
    })),

  toggleMaximize: (id) =>
    set((state) => ({
      panels: state.panels.map((panel) =>
        panel.id === id ? { ...panel, maximized: !panel.maximized } : panel
      ),
      activeId: id,
    })),

  focus: (id) =>
    set((state) => ({
      panels: state.panels.map((panel) =>
        panel.id === id ? { ...panel, order: ++seq } : panel
      ),
      activeId: id,
    })),

  setTitle: (id, title) =>
    set((state) => ({
      panels: state.panels.map((panel) =>
        panel.id === id ? { ...panel, title } : panel
      ),
    })),

  setDirty: (id, dirty) =>
    set((state) => ({
      panels: state.panels.map((panel) =>
        panel.id === id ? { ...panel, dirty } : panel
      ),
    })),
}));

/** Панель нээх богино туслахууд — callsite бүрд key/title давтахгүйн тулд. */
export function openVoucherPanel(voucherId: string, title?: string) {
  return usePanelStore.getState().openPanel({
    key: `voucher:${voucherId}`,
    kind: "voucher",
    title: title || "Журнал",
    payload: { voucherId },
  });
}

export function openNewVoucherPanel() {
  return usePanelStore.getState().openPanel({
    key: "voucher:new",
    kind: "voucher-new",
    title: "Шинэ журнал",
    payload: {},
  });
}
