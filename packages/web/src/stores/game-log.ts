import { create } from "zustand";

export interface GameLogEntry {
  readonly id: number;
  readonly turnNumber: number;
  readonly playerName: string;
  readonly playerIndex: number;
  readonly description: string;
  readonly timestamp: number;
  readonly kind: "play" | "disgrace" | "commit" | "round_start" | "round_end" | "trace";
}

interface GameLogState {
  readonly entries: ReadonlyArray<GameLogEntry>;
  readonly nextId: number;
}

interface GameLogActions {
  addEntry: (entry: Omit<GameLogEntry, "id">) => void;
  clear: () => void;
}

type GameLogStore = GameLogState & GameLogActions;

export const useGameLogStore = create<GameLogStore>((set) => ({
  entries: [],
  nextId: 0,
  addEntry: (entry) =>
    set((state) => ({
      entries: [...state.entries, { ...entry, id: state.nextId }],
      nextId: state.nextId + 1,
    })),
  clear: () => set({ entries: [], nextId: 0 }),
}));
