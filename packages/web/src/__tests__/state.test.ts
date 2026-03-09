import { describe, expect, it } from "vitest";
import type { PlayerId } from "@imposter-zero/types";
import {
  BASE_ARMY_KINDS,
  REGULATION_2P_EXPANSION,
  apply,
  createExpansionRound,
  legalActions,
  type IKState,
  type IKMusteringAction,
  type IKSetupAction,
} from "@imposter-zero/engine";

import { detectLogEvents, type ClientPhase } from "../state.js";

const seededRng = (seed: number) => {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
};

const asMusteringPhase = (
  state: IKState,
): Extract<ClientPhase, { readonly _tag: "mustering" }> => ({
  _tag: "mustering",
  me: "bot-1",
  name: "bot-1",
  myIndex: 1 as PlayerId,
  token: "token",
  roomId: "room",
  gameState: state,
  legalActions: legalActions(state) as readonly IKMusteringAction[],
  activePlayer: state.activePlayer,
  numPlayers: state.numPlayers,
  playerNames: ["bot-0", "bot-1"],
  turnDeadline: 0,
});

const asSetupPhase = (
  state: IKState,
  myIndex: PlayerId,
): Extract<ClientPhase, { readonly _tag: "setup" }> => ({
  _tag: "setup",
  me: "bot-1",
  name: "bot-1",
  myIndex,
  token: "token",
  roomId: "room",
  gameState: state,
  legalActions: legalActions(state) as readonly IKSetupAction[],
  activePlayer: state.activePlayer,
  numPlayers: state.numPlayers,
  playerNames: ["bot-0", "bot-1"],
  turnDeadline: 0,
});

describe("detectLogEvents", () => {
  it("logs recommission distinctly from begin recruiting", () => {
    const armies = [
      { available: BASE_ARMY_KINDS.slice(0, 3), exhausted: BASE_ARMY_KINDS.slice(3, 5) },
      { available: BASE_ARMY_KINDS.slice(0, 3), exhausted: BASE_ARMY_KINDS.slice(3, 5) },
    ] as const;

    let state = createExpansionRound(REGULATION_2P_EXPANSION, armies, 0, seededRng(42));
    state = apply(state, { kind: "crown", firstPlayer: 0 });

    const prev = asMusteringPhase(state);
    const recommission = legalActions(state).find(
      (action): action is Extract<IKMusteringAction, { readonly kind: "recommission" }> =>
        action.kind === "recommission",
    );

    expect(recommission).toBeDefined();

    const next = asMusteringPhase(apply(state, recommission!));
    const events = detectLogEvents(prev, next);

    expect(events).toHaveLength(1);
    expect(events[0]?.description.startsWith("recommissioned: recovered ")).toBe(true);
    expect(events[0]?.description.includes("to begin recruiting")).toBe(false);
  });

  it("logs king facet selection during mustering", () => {
    const armies = [
      { available: BASE_ARMY_KINDS.slice(0, 3), exhausted: [] },
      { available: BASE_ARMY_KINDS.slice(0, 3), exhausted: [] },
    ] as const;

    let state = createExpansionRound(REGULATION_2P_EXPANSION, armies, 0, seededRng(42));
    state = apply(state, { kind: "crown", firstPlayer: 0 });

    const prev = asMusteringPhase(state);
    const next = asMusteringPhase(apply(state, { kind: "select_king", facet: "masterTactician" }));
    const events = detectLogEvents(prev, next);

    expect(events).toHaveLength(1);
    expect(events[0]?.description).toBe("selected Master Tactician");
  });

  it("logs own setup commit with concrete role assignments", () => {
    const armies = [
      { available: BASE_ARMY_KINDS.slice(0, 3), exhausted: [] },
      { available: BASE_ARMY_KINDS.slice(0, 3), exhausted: [] },
    ] as const;

    let state = createExpansionRound(REGULATION_2P_EXPANSION, armies, 0, seededRng(42));
    state = apply(state, { kind: "crown", firstPlayer: 0 });
    state = apply(state, { kind: "end_mustering" });
    state = apply(state, { kind: "end_mustering" });

    const prev = asSetupPhase(state, 0 as PlayerId);
    const commit = legalActions(state).find(
      (action): action is IKSetupAction => action.kind === "commit",
    );

    expect(commit).toBeDefined();

    const next = asSetupPhase(apply(state, commit!), 0 as PlayerId);
    const events = detectLogEvents(prev, next);

    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe("commit");
    expect(events[0]?.description).toContain(" as Successor");
    expect(events[0]?.description).toContain(" as Dungeon");
  });

  it("logs opponent setup commit without leaking hidden card identities", () => {
    const armies = [
      { available: BASE_ARMY_KINDS.slice(0, 3), exhausted: [] },
      { available: BASE_ARMY_KINDS.slice(0, 3), exhausted: [] },
    ] as const;

    let state = createExpansionRound(REGULATION_2P_EXPANSION, armies, 0, seededRng(42));
    state = apply(state, { kind: "crown", firstPlayer: 0 });
    state = apply(state, { kind: "end_mustering" });
    state = apply(state, { kind: "end_mustering" });
    state = apply(state, legalActions(state).find((action): action is IKSetupAction => action.kind === "commit")!);

    const prev = asSetupPhase(state, 0 as PlayerId);
    const commit = legalActions(state).find(
      (action): action is IKSetupAction => action.kind === "commit",
    );

    expect(commit).toBeDefined();

    const next = asSetupPhase(apply(state, commit!), 0 as PlayerId);
    const events = detectLogEvents(prev, next);

    expect(events).toHaveLength(1);
    expect(events[0]?.description).toBe("committed setup: chose a Successor and a Dungeon");
  });
});
