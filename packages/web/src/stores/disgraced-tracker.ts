import { create } from "zustand";
import type { CardName, CourtEntry } from "@imposter-zero/engine";

/**
 * Tracks which court cards have been disgraced (flipped face-down).
 * Maintains a map from card ID → CardName so the hand helper and
 * disgraced-card-peek features know what a face-down court card was.
 *
 * Updated by diffing consecutive court states: when a card transitions
 * from face === "up" to face === "down", its name is captured.
 */

interface DisgracedTrackerState {
  readonly disgracedCards: ReadonlyMap<number, CardName>;
  readonly prevCourt: ReadonlyArray<CourtEntry> | null;
}

interface DisgracedTrackerActions {
  updateCourt: (court: ReadonlyArray<CourtEntry>) => void;
  clear: () => void;
}

type DisgracedTrackerStore = DisgracedTrackerState & DisgracedTrackerActions;

export const useDisgracedTracker = create<DisgracedTrackerStore>((set, get) => ({
  disgracedCards: new Map(),
  prevCourt: null,

  updateCourt: (court) => {
    const { prevCourt, disgracedCards } = get();

    if (prevCourt === null) {
      set({ prevCourt: court });
      return;
    }

    const prevById = new Map(prevCourt.map((e) => [e.card.id, e]));
    let changed = false;
    let nextDisgraced = disgracedCards;

    for (const entry of court) {
      const prev = prevById.get(entry.card.id);
      if (prev && prev.face === "up" && entry.face === "down") {
        if (!changed) {
          nextDisgraced = new Map(disgracedCards);
          changed = true;
        }
        (nextDisgraced as Map<number, CardName>).set(entry.card.id, prev.card.kind.name);
      }
    }

    set({
      prevCourt: court,
      ...(changed ? { disgracedCards: nextDisgraced } : {}),
    });
  },

  clear: () => set({ disgracedCards: new Map(), prevCourt: null }),
}));
