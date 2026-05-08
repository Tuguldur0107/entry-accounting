"use client";

import { create } from "zustand";

interface GlStore {
  isJournalModalOpen: boolean;
  openJournalModal: () => void;
  closeJournalModal: () => void;

  isAccountModalOpen: boolean;
  openAccountModal: () => void;
  closeAccountModal: () => void;
}

export const useGlStore = create<GlStore>((set) => ({
  isJournalModalOpen: false,
  openJournalModal: () => set({ isJournalModalOpen: true }),
  closeJournalModal: () => set({ isJournalModalOpen: false }),

  isAccountModalOpen: false,
  openAccountModal: () => set({ isAccountModalOpen: true }),
  closeAccountModal: () => set({ isAccountModalOpen: false }),
}));
