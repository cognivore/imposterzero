import { describe, it, expect } from "vitest";

import {
  createLobby,
  createLobbyForGame,
  lobbyTransition,
  lobbyTransitionSafe,
  type LobbyState,
  type LobbyAction,
} from "../lobby.js";
import type { GameDef, GameType } from "@imposter-zero/types";

const fakeGameType: GameType = {
  name: "test",
  dynamics: "sequential",
  chanceMode: "deterministic",
  information: "perfect",
  minPlayers: 2,
  maxPlayers: 4,
};

const fakeGame: GameDef<null, null> = {
  gameType: fakeGameType,
  create: () => null,
  currentPlayer: () => 0,
  legalActions: () => [],
  apply: () => null,
  isTerminal: () => true,
  returns: () => [0, 0],
};

const act = (state: LobbyState, action: LobbyAction): LobbyState =>
  lobbyTransition(state, action);

const join = (state: LobbyState, id: string): LobbyState =>
  act(state, { kind: "join", playerId: id });

const ready = (state: LobbyState, id: string, now = 1000): LobbyState =>
  act(state, { kind: "ready", playerId: id, ready: true, now });

const unready = (state: LobbyState, id: string, now = 1000): LobbyState =>
  act(state, { kind: "ready", playerId: id, ready: false, now });

const toInGame = (): LobbyState => {
  let lobby = createLobby(2, 4);
  lobby = join(lobby, "alice");
  lobby = join(lobby, "bob");
  lobby = ready(lobby, "alice");
  lobby = ready(lobby, "bob");
  return act(lobby, { kind: "start", gameId: "g1", now: 2000 });
};

describe("createLobby", () => {
  it("creates a waiting lobby with no players", () => {
    const lobby = createLobby(2, 4);
    expect(lobby.kind).toBe("waiting");
    expect(lobby.players).toEqual([]);
    expect(lobby.minPlayers).toBe(2);
    expect(lobby.maxPlayers).toBe(4);
  });

  it("rejects minPlayers < 1", () => {
    expect(() => createLobby(0, 4)).toThrow(RangeError);
  });

  it("rejects maxPlayers < minPlayers", () => {
    expect(() => createLobby(3, 2)).toThrow(RangeError);
  });
});

describe("createLobbyForGame", () => {
  it("derives bounds from game type", () => {
    const lobby = createLobbyForGame(fakeGame);
    expect(lobby.minPlayers).toBe(2);
    expect(lobby.maxPlayers).toBe(4);
  });
});

describe("join", () => {
  it("adds a player to the lobby", () => {
    const lobby = join(createLobby(2, 4), "alice");
    expect(lobby.players).toHaveLength(1);
    expect(lobby.players[0]!.id).toBe("alice");
    expect(lobby.players[0]!.ready).toBe(false);
  });

  it("is idempotent for same player", () => {
    const lobby = join(join(createLobby(2, 4), "alice"), "alice");
    expect(lobby.players).toHaveLength(1);
  });

  it("rejects join when full", () => {
    let lobby = createLobby(2, 2);
    lobby = join(lobby, "alice");
    lobby = join(lobby, "bob");
    expect(() => join(lobby, "charlie")).toThrow();
  });

  it("resets to waiting state", () => {
    const lobby = join(createLobby(2, 4), "alice");
    expect(lobby.kind).toBe("waiting");
  });
});

describe("leave", () => {
  it("removes a player", () => {
    let lobby = join(createLobby(2, 4), "alice");
    lobby = join(lobby, "bob");
    lobby = act(lobby, { kind: "leave", playerId: "alice" });
    expect(lobby.players).toHaveLength(1);
    expect(lobby.players[0]!.id).toBe("bob");
  });

  it("returns to waiting after leave breaks ready quorum", () => {
    let lobby = createLobby(2, 4);
    lobby = join(lobby, "alice");
    lobby = join(lobby, "bob");
    lobby = ready(lobby, "alice");
    lobby = ready(lobby, "bob");
    expect(lobby.kind).toBe("starting");
    lobby = act(lobby, { kind: "leave", playerId: "bob" });
    expect(lobby.kind).toBe("waiting");
  });
});

describe("ready", () => {
  it("marks a player ready", () => {
    let lobby = join(createLobby(2, 4), "alice");
    lobby = ready(lobby, "alice");
    expect(lobby.players[0]!.ready).toBe(true);
  });

  it("transitions to starting when all ready and quorum met", () => {
    let lobby = createLobby(2, 4);
    lobby = join(lobby, "alice");
    lobby = join(lobby, "bob");
    lobby = ready(lobby, "alice");
    expect(lobby.kind).toBe("waiting");
    lobby = ready(lobby, "bob");
    expect(lobby.kind).toBe("starting");
  });

  it("stays waiting if below minPlayers", () => {
    let lobby = join(createLobby(2, 4), "alice");
    lobby = ready(lobby, "alice");
    expect(lobby.kind).toBe("waiting");
  });

  it("un-readying drops back to waiting", () => {
    let lobby = createLobby(2, 4);
    lobby = join(lobby, "alice");
    lobby = join(lobby, "bob");
    lobby = ready(lobby, "alice");
    lobby = ready(lobby, "bob");
    expect(lobby.kind).toBe("starting");
    lobby = unready(lobby, "alice");
    expect(lobby.kind).toBe("waiting");
  });
});

describe("start", () => {
  it("transitions from starting to in_game", () => {
    let lobby = createLobby(2, 4);
    lobby = join(lobby, "alice");
    lobby = join(lobby, "bob");
    lobby = ready(lobby, "alice");
    lobby = ready(lobby, "bob");
    expect(lobby.kind).toBe("starting");
    lobby = act(lobby, { kind: "start", gameId: "g1", now: 2000 });
    expect(lobby.kind).toBe("in_game");
    if (lobby.kind === "in_game") {
      expect(lobby.gameId).toBe("g1");
      expect(lobby.startedAt).toBe(2000);
    }
  });

  it("rejects start from waiting state", () => {
    const lobby = join(createLobby(2, 4), "alice");
    expect(() => act(lobby, { kind: "start", gameId: "g1", now: 1000 })).toThrow();
  });
});

describe("gameOver", () => {
  it("transitions from in_game to post_game", () => {
    let lobby = toInGame();
    lobby = act(lobby, { kind: "gameOver", returns: [1, -1], now: 3000 });
    expect(lobby.kind).toBe("post_game");
    if (lobby.kind === "post_game") {
      expect(lobby.returns).toEqual([1, -1]);
      expect(lobby.finishedAt).toBe(3000);
      expect(lobby.gameId).toBe("g1");
    }
  });

  it("rejects gameOver from waiting state", () => {
    const lobby = createLobby(2, 4);
    expect(() => act(lobby, { kind: "gameOver", returns: [], now: 1000 })).toThrow();
  });

  it("rejects gameOver with wrong returns length", () => {
    const lobby = toInGame();
    expect(() =>
      act(lobby, { kind: "gameOver", returns: [1], now: 3000 }),
    ).toThrow();
  });
});

describe("in_game restrictions", () => {
  it("rejects join during game", () => {
    expect(() => join(toInGame(), "charlie")).toThrow();
  });

  it("rejects leave during game", () => {
    expect(() => act(toInGame(), { kind: "leave", playerId: "alice" })).toThrow();
  });

  it("rejects ready toggle during game", () => {
    expect(() => ready(toInGame(), "alice")).toThrow();
  });
});

describe("lobbyTransitionSafe", () => {
  it("returns ok for valid transitions", () => {
    const lobby = createLobby(2, 4);
    const result = lobbyTransitionSafe(lobby, { kind: "join", playerId: "alice" });
    expect(result.ok).toBe(true);
  });

  it("returns err for join during game", () => {
    const result = lobbyTransitionSafe(toInGame(), { kind: "join", playerId: "charlie" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("join_during_game");
  });

  it("returns err for lobby full", () => {
    let lobby = createLobby(2, 2);
    lobby = join(lobby, "alice");
    lobby = join(lobby, "bob");
    const result = lobbyTransitionSafe(lobby, { kind: "join", playerId: "charlie" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("lobby_full");
  });

  it("returns err for returns length mismatch", () => {
    const result = lobbyTransitionSafe(toInGame(), {
      kind: "gameOver",
      returns: [1, -1, 0],
      now: 3000,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("returns_length_mismatch");
      if (result.error.kind === "returns_length_mismatch") {
        expect(result.error.expected).toBe(2);
        expect(result.error.received).toBe(3);
      }
    }
  });

  it("returns ok for correct returns length", () => {
    const result = lobbyTransitionSafe(toInGame(), {
      kind: "gameOver",
      returns: [1, -1],
      now: 3000,
    });
    expect(result.ok).toBe(true);
  });
});
