"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

type SidebarState = {
  collapsed: boolean;
  width: number;
  mobileOpen: boolean;
  toggle: () => void;
  setCollapsed: (value: boolean) => void;
  setWidth: (value: number) => void;
  toggleMobile: () => void;
  setMobileOpen: (value: boolean) => void;
};

export const SIDEBAR_MIN_WIDTH = 176;
export const SIDEBAR_MAX_WIDTH = 360;
export const SIDEBAR_DEFAULT_WIDTH = 220;

export const useSidebarStore = create<SidebarState>()(
  persist(
    (set) => ({
      collapsed: false,
      width: SIDEBAR_DEFAULT_WIDTH,
      mobileOpen: false,
      toggle: () => set((s) => ({ collapsed: !s.collapsed })),
      setCollapsed: (value) => set({ collapsed: value }),
      setWidth: (value) =>
        set({
          width: Math.min(
            SIDEBAR_MAX_WIDTH,
            Math.max(SIDEBAR_MIN_WIDTH, Math.round(value))
          ),
        }),
      toggleMobile: () => set((state) => ({ mobileOpen: !state.mobileOpen })),
      setMobileOpen: (value) => set({ mobileOpen: value }),
    }),
    {
      name: "ea.sidebar",
      partialize: (state) => ({
        collapsed: state.collapsed,
        width: state.width,
      }),
    }
  )
);
