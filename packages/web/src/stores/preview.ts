import { create } from "zustand";
import type { CardVisual } from "../views/card/types.js";

export type PreviewSource = "hand" | "court" | "opponent" | "side" | null;

export interface PreviewState {
  readonly hoveredCard: CardVisual | null;
  readonly source: PreviewSource;
  setHovered: (card: CardVisual | null, source: PreviewSource) => void;
}

export const usePreviewStore = create<PreviewState>((set) => ({
  hoveredCard: null,
  source: null,
  setHovered: (card, source) => set({ hoveredCard: card, source }),
}));
