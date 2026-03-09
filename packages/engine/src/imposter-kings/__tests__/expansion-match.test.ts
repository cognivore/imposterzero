import { describe, it, expect } from "vitest";
import { TERMINAL, type ActivePlayer, type PlayerId } from "@imposter-zero/types";

import {
  type IKState,
  type IKAction,
  legalActions,
  apply,
  isTerminal,
  currentPlayer,
  playerZones,
  BASE_ARMY_KINDS,
} from "../index.js";
import {
  buildPlayerArmies,
  createExpansionRound,
  exhaustArmyCardsPostRound,
  playExpandedMatch,
  type PlayerArmy,
} from "../expansion-match.js";
import { REGULATION_2P_EXPANSION, expansionConfigForPlayers } from "../config.js";

const seededRng = (seed: number) => {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
};

const randomSelect = (
  rng: () => number,
) => (
  _state: IKState,
  legal: ReadonlyArray<IKAction>,
  _player: ActivePlayer,
): IKAction => legal[Math.floor(rng() * legal.length)]!;

describe("Expansion Round (2p with Army)", () => {
  it("creates round with correct hand/army sizes", () => {
    const sigs = [
      ["Aegis", "Exile", "Ancestor"] as const,
      ["Stranger", "Conspiracist", "Flagbearer"] as const,
    ];
    const armies = buildPlayerArmies(REGULATION_2P_EXPANSION, sigs);
    const state = createExpansionRound(REGULATION_2P_EXPANSION, armies, 0, seededRng(42));

    expect(state.players[0]!.hand.length).toBe(9);
    expect(state.players[1]!.hand.length).toBe(9);
    expect(state.players[0]!.army.length).toBe(8);
    expect(state.players[1]!.army.length).toBe(8);
    expect(state.phase).toBe("crown");
  });

  it("uses the 3-player deck when configured for 3 players", () => {
    const config = expansionConfigForPlayers(3);
    const armies: ReadonlyArray<PlayerArmy> = [
      { available: BASE_ARMY_KINDS.slice(0, 3), exhausted: [] },
      { available: BASE_ARMY_KINDS.slice(0, 3), exhausted: [] },
      { available: BASE_ARMY_KINDS.slice(0, 3), exhausted: [] },
    ];
    const state = createExpansionRound(config, armies, 0, seededRng(42));

    expect(state.players.every((player) => player.hand.length === 8)).toBe(true);
    expect(state.shared.forgotten).toBeNull();
  });

  it("random play with army completes without errors (5 games)", () => {
    const simpleArmies: ReadonlyArray<PlayerArmy> = [
      { available: BASE_ARMY_KINDS.slice(0, 3), exhausted: [] },
      { available: BASE_ARMY_KINDS.slice(0, 3), exhausted: [] },
    ];

    for (let i = 0; i < 5; i++) {
      const rng = seededRng(i * 7919);
      const state = createExpansionRound(REGULATION_2P_EXPANSION, simpleArmies, 0, rng);
      const select = randomSelect(rng);

      let s = state;
      let steps = 0;
      while (!isTerminal(s) && steps < 500) {
        const legal = legalActions(s);
        if (legal.length === 0) break;
        const action = select(s, legal, currentPlayer(s));
        s = apply(s, action);
        steps++;
      }

      expect(isTerminal(s)).toBe(true);
    }
  });
});

describe("Expansion Match (multi-round)", () => {
  it("plays to target score with army persistence", () => {
    const simpleArmies: ReadonlyArray<PlayerArmy> = [
      { available: BASE_ARMY_KINDS.slice(0, 3), exhausted: [] },
      { available: BASE_ARMY_KINDS.slice(0, 3), exhausted: [] },
    ];
    const rng = seededRng(123);

    const result = playExpandedMatch(
      REGULATION_2P_EXPANSION,
      simpleArmies,
      randomSelect(rng),
      0,
      3,
      50,
      rng,
    );

    expect(result.match.roundsPlayed).toBeGreaterThan(0);
    expect(result.match.scores.some((s) => s >= 3)).toBe(true);
    expect(result.roundResults.length).toBe(result.match.roundsPlayed);
  });
});

describe("Army exhaustion across rounds", () => {
  it("exhaustArmyCardsPostRound preserves exhausted state", () => {
    const armies: ReadonlyArray<PlayerArmy> = [
      { available: BASE_ARMY_KINDS.slice(0, 3), exhausted: BASE_ARMY_KINDS.slice(3, 5) },
      { available: BASE_ARMY_KINDS.slice(0, 3), exhausted: [] },
    ];
    const state = createExpansionRound(REGULATION_2P_EXPANSION, armies, 0, seededRng(42));

    const result = exhaustArmyCardsPostRound(state, armies);
    expect(result[0]!.exhausted.length).toBe(2);
    expect(result[1]!.exhausted.length).toBe(0);
  });

  it("recruited card becomes exhausted even after being played to court", () => {
    const armies: ReadonlyArray<PlayerArmy> = [
      { available: BASE_ARMY_KINDS.slice(0, 3), exhausted: [] },
      { available: BASE_ARMY_KINDS.slice(0, 3), exhausted: [] },
    ];
    let state = createExpansionRound(REGULATION_2P_EXPANSION, armies, 0, seededRng(42));
    state = apply(state, { kind: "crown", firstPlayer: 0 });
    expect(state.phase).toBe("mustering");

    const p1 = state.players[state.activePlayer]!;
    const exhaustTarget = p1.army[0]!;
    state = apply(state, { kind: "begin_recruit", exhaustCardId: exhaustTarget.id });

    const p1b = state.players[state.activePlayer]!;
    const recruitTarget = p1b.army[0]!;
    const recruitedName = recruitTarget.kind.name;
    state = apply(state, {
      kind: "recruit",
      discardFromHandId: p1b.hand[0]!.id,
      takeFromArmyId: recruitTarget.id,
    });
    expect(state.armyRecruitedIds).toContain(recruitTarget.id);

    state = apply(state, { kind: "end_mustering" });
    state = apply(state, { kind: "end_mustering" });
    expect(state.phase).toBe("setup");

    const s1 = legalActions(state).find((a) => a.kind === "commit")!;
    state = apply(state, s1);
    const s2 = legalActions(state).find((a) => a.kind === "commit")!;
    state = apply(state, s2);
    expect(state.phase).toBe("play");

    const musteringPlayer = state.activePlayer === 1 ? 1 : 0;
    const recruitedCard = state.players[musteringPlayer]!.hand.find(
      (c) => c.id === recruitTarget.id,
    );
    if (recruitedCard) {
      const playAction = legalActions(state).find(
        (a) => a.kind === "play" && a.cardId === recruitedCard.id,
      );
      if (playAction) {
        state = apply(state, playAction);
        while (state.phase === "resolving" || state.phase === "end_of_turn") {
          const legal = legalActions(state);
          if (legal.length === 0) break;
          state = apply(state, legal[0]!);
        }
      }
    }

    const finalState: IKState = {
      ...state,
      armyRecruitedIds: [recruitTarget.id],
    };
    const result = exhaustArmyCardsPostRound(finalState, armies);
    const musterIdx = 1;
    expect(result[musterIdx]!.exhausted.map((k) => k.name)).toContain(recruitedName);
  });

  it("recruited card in court is still marked exhausted for next round", () => {
    const armies: ReadonlyArray<PlayerArmy> = [
      { available: BASE_ARMY_KINDS.slice(0, 3), exhausted: [] },
      { available: BASE_ARMY_KINDS.slice(0, 3), exhausted: [] },
    ];
    const state = createExpansionRound(REGULATION_2P_EXPANSION, armies, 0, seededRng(42));

    const recruitedCard = state.players[0]!.army[0]!;
    const recruitedName = recruitedCard.kind.name;

    const fakeState: IKState = {
      ...state,
      armyRecruitedIds: [recruitedCard.id],
      shared: {
        ...state.shared,
        court: [{ card: recruitedCard, face: "up" as const, playedBy: 0 as PlayerId }],
      },
      players: state.players.map((p, i) =>
        i === 0 ? { ...p, army: p.army.filter((c) => c.id !== recruitedCard.id) } : p,
      ),
    };

    const result = exhaustArmyCardsPostRound(fakeState, armies);
    expect(result[0]!.exhausted.map((k) => k.name)).toContain(recruitedName);
  });
});
