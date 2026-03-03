import { describe, it, expect } from "vitest";

import {
  startSession,
  applySessionAction,
  applyPlayerAction,
  applyTimeout,
  isTimedOut,
} from "../session.js";
import type { GameDef, PlayerId } from "@imposter-zero/types";

interface ToyState {
  readonly step: number;
  readonly over: boolean;
}

type ToyAction = "advance" | "finish";

const toyGame: GameDef<ToyState, ToyAction> = {
  gameType: {
    name: "toy",
    dynamics: "sequential",
    chanceMode: "deterministic",
    information: "perfect",
    minPlayers: 2,
    maxPlayers: 4,
  },
  create: () => ({ step: 0, over: false }),
  currentPlayer: (s) => (s.over ? -4 : (s.step % 2) as PlayerId),
  legalActions: (s) => (s.over ? [] : ["advance", "finish"]),
  apply: (s, a) =>
    a === "finish" ? { step: s.step + 1, over: true } : { step: s.step + 1, over: false },
  isTerminal: (s) => s.over,
  returns: (s) => (s.over ? [1, -1] : [0, 0]),
};

const mapping = new Map<string, PlayerId>([
  ["alice", 0],
  ["bob", 1],
]);

describe("startSession", () => {
  it("creates a session with initial state", () => {
    const session = startSession(toyGame, 2, mapping, 30000, 1000);
    expect(session.state.step).toBe(0);
    expect(session.state.over).toBe(false);
    expect(session.turnDuration).toBe(30000);
    expect(session.turnDeadline).toBe(31000);
  });

  it("rejects non-positive turnDuration", () => {
    expect(() => startSession(toyGame, 2, mapping, 0, 1000)).toThrow(RangeError);
    expect(() => startSession(toyGame, 2, mapping, -1, 1000)).toThrow(RangeError);
  });

  it("rejects mapping size mismatch", () => {
    const badMapping = new Map<string, PlayerId>([["alice", 0]]);
    expect(() => startSession(toyGame, 2, badMapping, 30000, 1000)).toThrow();
  });

  it("rejects numPlayers below game minimum", () => {
    const single = new Map<string, PlayerId>([["alice", 0]]);
    expect(() => startSession(toyGame, 1, single, 30000, 1000)).toThrow(RangeError);
  });

  it("rejects numPlayers above game maximum", () => {
    const five = new Map<string, PlayerId>([
      ["a", 0], ["b", 1], ["c", 2], ["d", 3], ["e", 4],
    ]);
    expect(() => startSession(toyGame, 5, five, 30000, 1000)).toThrow(RangeError);
  });
});

describe("applySessionAction", () => {
  it("advances game state", () => {
    const session = startSession(toyGame, 2, mapping, 30000, 1000);
    const next = applySessionAction(session, "advance", 2000);
    expect(next.state.step).toBe(1);
    expect(next.state.over).toBe(false);
  });

  it("resets turn deadline on non-terminal move", () => {
    const session = startSession(toyGame, 2, mapping, 30000, 1000);
    const next = applySessionAction(session, "advance", 5000);
    expect(next.turnDeadline).toBe(5000 + 30000);
  });

  it("sets deadline to now on terminal move", () => {
    const session = startSession(toyGame, 2, mapping, 30000, 1000);
    const next = applySessionAction(session, "finish", 5000);
    expect(next.state.over).toBe(true);
    expect(next.turnDeadline).toBe(5000);
  });

  it("is a no-op when game is already terminal", () => {
    const session = startSession(toyGame, 2, mapping, 30000, 1000);
    const finished = applySessionAction(session, "finish", 2000);
    const after = applySessionAction(finished, "advance", 3000);
    expect(after).toBe(finished);
  });
});

describe("applyPlayerAction", () => {
  it("succeeds for the correct active player", () => {
    const session = startSession(toyGame, 2, mapping, 30000, 1000);
    const result = applyPlayerAction(session, 0, "advance", 2000);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.state.step).toBe(1);
    }
  });

  it("rejects wrong player", () => {
    const session = startSession(toyGame, 2, mapping, 30000, 1000);
    const result = applyPlayerAction(session, 1, "advance", 2000);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("not_active_player");
    }
  });

  it("rejects when timed out", () => {
    const session = startSession(toyGame, 2, mapping, 30000, 1000);
    const result = applyPlayerAction(session, 0, "advance", 50000);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("timed_out");
    }
  });

  it("rejects when game is terminal", () => {
    const session = startSession(toyGame, 2, mapping, 30000, 1000);
    const finished = applySessionAction(session, "finish", 2000);
    const result = applyPlayerAction(finished, 0, "advance", 3000);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("game_terminal");
    }
  });

  it("resets deadline on success", () => {
    const session = startSession(toyGame, 2, mapping, 30000, 1000);
    const result = applyPlayerAction(session, 0, "advance", 5000);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.turnDeadline).toBe(5000 + 30000);
    }
  });

  it("sets deadline to now on terminal move", () => {
    const session = startSession(toyGame, 2, mapping, 30000, 1000);
    const result = applyPlayerAction(session, 0, "finish", 5000);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.state.over).toBe(true);
      expect(result.value.turnDeadline).toBe(5000);
    }
  });
});

describe("applyTimeout", () => {
  it("is a no-op when not timed out", () => {
    const session = startSession(toyGame, 2, mapping, 30000, 1000);
    const result = applyTimeout(session, 2000, "forfeit");
    expect(result.state.step).toBe(0);
  });

  it("applies first legal action when timed out", () => {
    const session = startSession(toyGame, 2, mapping, 30000, 1000);
    const result = applyTimeout(session, 50000, "forfeit");
    expect(result.state.step).toBe(1);
  });

  it("is a no-op when game is terminal", () => {
    const session = startSession(toyGame, 2, mapping, 30000, 1000);
    const finished = applySessionAction(session, "finish", 2000);
    const result = applyTimeout(finished, 50000, "forfeit");
    expect(result).toBe(finished);
  });
});

describe("isTimedOut", () => {
  it("returns false before deadline", () => {
    const session = startSession(toyGame, 2, mapping, 30000, 1000);
    expect(isTimedOut(session, 30999)).toBe(false);
  });

  it("returns true at exactly the deadline", () => {
    const session = startSession(toyGame, 2, mapping, 30000, 1000);
    expect(isTimedOut(session, 31000)).toBe(true);
  });

  it("returns true after deadline", () => {
    const session = startSession(toyGame, 2, mapping, 30000, 1000);
    expect(isTimedOut(session, 31001)).toBe(true);
  });
});
