import { create } from "zustand";
import type { PlayerId } from "@imposter-zero/types";

export interface MobileUIState {
  readonly drawerOpen: boolean;
  readonly playerModalOpen: PlayerId | "hero" | null;
  readonly subModal: "army" | "exhaust" | null;
}

interface MobileUIActions {
  toggleDrawer: () => void;
  openDrawer: () => void;
  closeDrawer: () => void;
  openPlayerModal: (player: PlayerId | "hero") => void;
  closePlayerModal: () => void;
  openSubModal: (kind: "army" | "exhaust") => void;
  closeSubModal: () => void;
  dismissAll: () => void;
}

export const useMobileUIStore = create<MobileUIState & MobileUIActions>((set) => ({
  drawerOpen: false,
  playerModalOpen: null,
  subModal: null,
  toggleDrawer: () => set((s) => ({ drawerOpen: !s.drawerOpen, playerModalOpen: null, subModal: null })),
  openDrawer: () => set({ drawerOpen: true, playerModalOpen: null, subModal: null }),
  closeDrawer: () => set({ drawerOpen: false }),
  openPlayerModal: (player) => set({ playerModalOpen: player, subModal: null, drawerOpen: false }),
  closePlayerModal: () => set({ playerModalOpen: null, subModal: null }),
  openSubModal: (kind) => set({ subModal: kind }),
  closeSubModal: () => set({ subModal: null }),
  dismissAll: () => set({ drawerOpen: false, playerModalOpen: null, subModal: null }),
}));
