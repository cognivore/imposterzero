import { create } from "zustand";
import type { CardName } from "@imposter-zero/engine";

/**
 * Tracks cards revealed to the player by game effects (e.g., Spy).
 * Card ID → CardName so the hand helper can account for them.
 */

interface SeenCardsState {
  readonly seenCards: ReadonlyMap<number, CardName>;
}

interface SeenCardsActions {
  addSeen: (cardId: number, name: CardName) => void;
  clear: () => void;
}

type SeenCardsStore = SeenCardsState & SeenCardsActions;

export const useSeenCardsTracker = create<SeenCardsStore>((set, get) => ({
  seenCards: new Map(),

  addSeen: (cardId, name) => {
    const next = new Map(get().seenCards);
    next.set(cardId, name);
    set({ seenCards: next });
  },

  clear: () => set({ seenCards: new Map() }),
}));
