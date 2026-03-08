import { describe, it, expect } from "vitest";
import type { PlayerId } from "@imposter-zero/types";
import {
  createDeck,
  dealWithDeck,
  regulationDeck,
  BASE_ARMY_KINDS,
  legalActions,
  apply,
  applySafe,
  playerZones,
  kingFacet,
  type IKState,
  type IKCard,
} from "../index.js";

const chooseEffect = (state: IKState, idx: number): IKState => {
  const result = applySafe(state, { kind: "effect_choice", choice: idx });
  if (!result.ok) throw new Error(`effect_choice(${idx}) failed: ${JSON.stringify(result.error)}`);
  return result.value;
};

const createArmyCard = (kindIndex: number, id: number): IKCard =>
  ({ id, kind: BASE_ARMY_KINDS[kindIndex]! }) as IKCard;

const setupCharismaticGame = (): IKState => {
  const kinds = regulationDeck(2);
  const deck = createDeck(kinds);
  return dealWithDeck(deck, 2, 0, ["charismatic", "default"]);
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

describe("Charismatic Leader setup", () => {
  it("deal sets facet correctly", () => {
    const state = setupCharismaticGame();
    expect(kingFacet(state, 0)).toBe("charismatic");
    expect(kingFacet(state, 1)).toBe("default");
  });

  it("successor is revealed after all players commit", () => {
    let state = setupCharismaticGame();
    state = apply(state, { kind: "crown", firstPlayer: 0 });

    expect(state.revealedSuccessors).toEqual([]);

    const p0commit = legalActions(state).filter((a) => a.kind === "commit")[0]!;
    state = apply(state, p0commit);

    expect(state.revealedSuccessors).toEqual([]);

    const p1commit = legalActions(state).filter((a) => a.kind === "commit")[0]!;
    state = apply(state, p1commit);

    expect(state.phase).toBe("play");
    expect(state.revealedSuccessors).toContain(0);
    expect(state.revealedSuccessors).not.toContain(1);
  });

  it("no squire needed for charismatic", () => {
    let state = setupCharismaticGame();
    state = apply(state, { kind: "crown", firstPlayer: 0 });

    const commitActions = legalActions(state).filter((a) => a.kind === "commit");
    const first = commitActions[0] as { kind: "commit"; successorId: number; dungeonId: number; squireId?: number };
    expect(first.squireId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Disgrace — take successor
// ---------------------------------------------------------------------------

describe("Charismatic Leader disgrace — take successor", () => {
  const buildCharismaticDisgraceState = (): IKState | null => {
    let state = setupCharismaticGame();
    state = apply(state, { kind: "crown", firstPlayer: 0 });

    const p0commit = legalActions(state).filter((a) => a.kind === "commit")[0]!;
    state = apply(state, p0commit);
    const p1commit = legalActions(state).filter((a) => a.kind === "commit")[0]!;
    state = apply(state, p1commit);

    const p0Hand = playerZones(state, 0).hand;
    const lowCard = p0Hand.reduce((a, b) =>
      a.kind.props.value <= b.kind.props.value ? a : b,
    );
    state = apply(state, { kind: "play", cardId: lowCard.id });

    for (let i = 0; i < 20 && (state.phase === "resolving" || state.phase === "end_of_turn"); i++) {
      const legal = legalActions(state);
      if (legal.length === 0) break;
      state = apply(state, legal[0]!);
    }

    if (state.activePlayer === 1 && state.phase === "play") {
      const p1Play = legalActions(state).find((a) => a.kind === "play");
      if (!p1Play) return null;
      state = apply(state, p1Play);
      for (let i = 0; i < 20 && (state.phase === "resolving" || state.phase === "end_of_turn"); i++) {
        const legal = legalActions(state);
        if (legal.length === 0) break;
        state = apply(state, legal[0]!);
      }
    }

    if (state.activePlayer !== 0 || state.phase !== "play") return null;
    if (!legalActions(state).some((a) => a.kind === "disgrace")) return null;
    return state;
  };

  it("take successor to hand (choose no-rally)", () => {
    const state = buildCharismaticDisgraceState();
    if (!state) return;

    const p0Before = playerZones(state, 0);
    const successorCard = p0Before.successor!.card;

    let s = apply(state, { kind: "disgrace" });

    while (s.phase === "resolving") {
      const opts = s.pendingResolution!.currentOptions;
      const passIdx = opts.findIndex((o) => o.kind === "pass");
      if (passIdx >= 0) {
        s = chooseEffect(s, passIdx);
        continue;
      }
      const yesNoFalse = opts.findIndex((o) => o.kind === "yesNo" && !(o as { kind: "yesNo"; value: boolean }).value);
      if (yesNoFalse >= 0) {
        s = chooseEffect(s, yesNoFalse);
        continue;
      }
      s = chooseEffect(s, 0);
    }

    const p0After = playerZones(s, 0);
    expect(p0After.king.face).toBe("down");
    expect(p0After.successor).toBeNull();
    expect(p0After.hand.some((c) => c.id === successorCard.id)).toBe(true);
    expect(s.charismaticRallyIds).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Disgrace — remove successor to rally
// ---------------------------------------------------------------------------

describe("Charismatic Leader disgrace — rally path", () => {
  it("remove successor from round, rally card <= successor value, tracks charismaticRallyIds", () => {
    let state = setupCharismaticGame();
    state = apply(state, { kind: "crown", firstPlayer: 0 });

    const p0Hand = playerZones(state, 0).hand;
    const hiValueCard = p0Hand.reduce((a, b) =>
      a.kind.props.value >= b.kind.props.value ? a : b,
    );
    const loValueCard = p0Hand.reduce((a, b) =>
      a.kind.props.value <= b.kind.props.value ? a : b,
    );

    state = apply(state, {
      kind: "commit",
      successorId: hiValueCard.id,
      dungeonId: loValueCard.id,
    });
    const p1commit = legalActions(state).filter((a) => a.kind === "commit")[0]!;
    state = apply(state, p1commit);

    const successorValue = hiValueCard.kind.props.value;
    const lowArmyKind = BASE_ARMY_KINDS.find((k) => k.props.value <= successorValue)!;
    const armyCard: IKCard = { id: 700, kind: lowArmyKind };

    const p1Hand = playerZones(state, 1).hand;
    const throneCard = p1Hand[0]!;

    state = {
      ...state,
      shared: {
        ...state.shared,
        court: [{ card: throneCard, face: "up" as const, playedBy: 1 as PlayerId }],
      },
      players: state.players.map((p, i) => {
        if (i === 0) return { ...p, army: [armyCard] };
        return { ...p, hand: p.hand.filter((c) => c.id !== throneCard.id) };
      }),
    };

    if (!legalActions(state).some((a) => a.kind === "disgrace")) return;

    const successorCard = playerZones(state, 0).successor!.card;
    let s = apply(state, { kind: "disgrace" });

    while (s.phase === "resolving") {
      const opts = s.pendingResolution!.currentOptions;
      const passIdx = opts.findIndex((o) => o.kind === "pass");
      if (passIdx >= 0) {
        s = chooseEffect(s, passIdx);
        continue;
      }
      const yesNoTrue = opts.findIndex((o) => o.kind === "yesNo" && (o as { kind: "yesNo"; value: boolean }).value);
      if (yesNoTrue >= 0) {
        s = chooseEffect(s, yesNoTrue);
        continue;
      }
      s = chooseEffect(s, 0);
    }

    const p0After = playerZones(s, 0);
    expect(p0After.king.face).toBe("down");
    expect(p0After.successor).toBeNull();

    expect(p0After.hand.some((c) => c.id === successorCard.id)).toBe(false);
    expect(s.shared.condemned.some((e) => e.card.id === successorCard.id)).toBe(true);

    expect(p0After.hand.some((c) => c.id === armyCard.id)).toBe(true);

    expect(s.charismaticRallyIds).toContain(armyCard.id);
    expect(s.armyRecruitedIds).toContain(armyCard.id);
  });

  it("rally filters to cards with value <= successor value", () => {
    let state = setupCharismaticGame();
    state = apply(state, { kind: "crown", firstPlayer: 0 });

    const p0Hand = playerZones(state, 0).hand;
    const loValueCard = p0Hand.reduce((a, b) =>
      a.kind.props.value <= b.kind.props.value ? a : b,
    );
    const hiValueCard = p0Hand.find((c) => c.id !== loValueCard.id && c.kind.props.value > loValueCard.kind.props.value) ?? p0Hand[1]!;

    state = apply(state, {
      kind: "commit",
      successorId: loValueCard.id,
      dungeonId: hiValueCard.id,
    });
    const p1commit = legalActions(state).filter((a) => a.kind === "commit")[0]!;
    state = apply(state, p1commit);

    const successorValue = loValueCard.kind.props.value;

    const lowArmyCard: IKCard = { id: 700, kind: BASE_ARMY_KINDS[0]! };
    const highArmyCard: IKCard = { id: 701, kind: BASE_ARMY_KINDS[BASE_ARMY_KINDS.length - 1]! };

    const p1Hand = playerZones(state, 1).hand;
    const throneCard = p1Hand[0]!;

    state = {
      ...state,
      shared: {
        ...state.shared,
        court: [{ card: throneCard, face: "up" as const, playedBy: 1 as PlayerId }],
      },
      players: state.players.map((p, i) => {
        if (i === 0) return { ...p, army: [lowArmyCard, highArmyCard] };
        return { ...p, hand: p.hand.filter((c) => c.id !== throneCard.id) };
      }),
    };

    if (!legalActions(state).some((a) => a.kind === "disgrace")) return;

    let s = apply(state, { kind: "disgrace" });

    let foundCardChoices = false;
    while (s.phase === "resolving") {
      const opts = s.pendingResolution!.currentOptions;
      const passIdx = opts.findIndex((o) => o.kind === "pass");
      if (passIdx >= 0) {
        s = chooseEffect(s, passIdx);
        continue;
      }
      const yesNoTrue = opts.findIndex((o) => o.kind === "yesNo" && (o as { kind: "yesNo"; value: boolean }).value);
      if (yesNoTrue >= 0) {
        s = chooseEffect(s, yesNoTrue);
        continue;
      }
      const cardOpts = opts.filter((o) => o.kind === "card");
      if (cardOpts.length > 0) {
        foundCardChoices = true;
        for (const opt of cardOpts) {
          if (opt.kind === "card") {
            const card = [lowArmyCard, highArmyCard].find((c) => c.id === opt.cardId);
            if (card) {
              expect(card.kind.props.value).toBeLessThanOrEqual(successorValue);
            }
          }
        }
      }
      s = chooseEffect(s, 0);
    }
  });

  it("empty army skips gracefully", () => {
    let state = setupCharismaticGame();
    state = apply(state, { kind: "crown", firstPlayer: 0 });

    const p0Hand = playerZones(state, 0).hand;
    state = apply(state, {
      kind: "commit",
      successorId: p0Hand[0]!.id,
      dungeonId: p0Hand[1]!.id,
    });
    const p1commit = legalActions(state).filter((a) => a.kind === "commit")[0]!;
    state = apply(state, p1commit);

    const p1Hand = playerZones(state, 1).hand;
    const throneCard = p1Hand[0]!;

    state = {
      ...state,
      shared: {
        ...state.shared,
        court: [{ card: throneCard, face: "up" as const, playedBy: 1 as PlayerId }],
      },
      players: state.players.map((p, i) => {
        if (i === 0) return { ...p, army: [] };
        return { ...p, hand: p.hand.filter((c) => c.id !== throneCard.id) };
      }),
    };

    if (!legalActions(state).some((a) => a.kind === "disgrace")) return;

    let s = apply(state, { kind: "disgrace" });

    while (s.phase === "resolving") {
      const opts = s.pendingResolution!.currentOptions;
      const passIdx = opts.findIndex((o) => o.kind === "pass");
      if (passIdx >= 0) {
        s = chooseEffect(s, passIdx);
        continue;
      }
      const yesNoTrue = opts.findIndex((o) => o.kind === "yesNo" && (o as { kind: "yesNo"; value: boolean }).value);
      if (yesNoTrue >= 0) {
        s = chooseEffect(s, yesNoTrue);
        continue;
      }
      s = chooseEffect(s, 0);
    }

    const p0After = playerZones(s, 0);
    expect(p0After.king.face).toBe("down");
    expect(p0After.successor).toBeNull();
    expect(s.charismaticRallyIds).toEqual([]);
  });

  it("all army cards above threshold — skip rally", () => {
    let state = setupCharismaticGame();
    state = apply(state, { kind: "crown", firstPlayer: 0 });

    const p0Hand = playerZones(state, 0).hand;
    const loValueCard = p0Hand.reduce((a, b) =>
      a.kind.props.value <= b.kind.props.value ? a : b,
    );

    state = apply(state, {
      kind: "commit",
      successorId: loValueCard.id,
      dungeonId: p0Hand.find((c) => c.id !== loValueCard.id)!.id,
    });
    const p1commit = legalActions(state).filter((a) => a.kind === "commit")[0]!;
    state = apply(state, p1commit);

    const successorValue = loValueCard.kind.props.value;
    const highArmyKind = BASE_ARMY_KINDS.find((k) => k.props.value > successorValue);
    if (!highArmyKind) return;

    const highArmyCard: IKCard = { id: 700, kind: highArmyKind };

    const p1Hand = playerZones(state, 1).hand;
    const throneCard = p1Hand[0]!;

    state = {
      ...state,
      shared: {
        ...state.shared,
        court: [{ card: throneCard, face: "up" as const, playedBy: 1 as PlayerId }],
      },
      players: state.players.map((p, i) => {
        if (i === 0) return { ...p, army: [highArmyCard] };
        return { ...p, hand: p.hand.filter((c) => c.id !== throneCard.id) };
      }),
    };

    if (!legalActions(state).some((a) => a.kind === "disgrace")) return;

    let s = apply(state, { kind: "disgrace" });

    while (s.phase === "resolving") {
      const opts = s.pendingResolution!.currentOptions;
      const passIdx = opts.findIndex((o) => o.kind === "pass");
      if (passIdx >= 0) {
        s = chooseEffect(s, passIdx);
        continue;
      }
      const yesNoTrue = opts.findIndex((o) => o.kind === "yesNo" && (o as { kind: "yesNo"; value: boolean }).value);
      if (yesNoTrue >= 0) {
        s = chooseEffect(s, yesNoTrue);
        continue;
      }
      s = chooseEffect(s, 0);
    }

    const p0After = playerZones(s, 0);
    expect(p0After.king.face).toBe("down");
    expect(p0After.hand.some((c) => c.id === highArmyCard.id)).toBe(false);
    expect(s.charismaticRallyIds).toEqual([]);
  });
});
