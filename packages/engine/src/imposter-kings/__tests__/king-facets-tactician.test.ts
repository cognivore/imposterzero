import { describe, it, expect } from "vitest";
import type { PlayerId } from "@imposter-zero/types";
import {
  createDeck,
  dealWithDeck,
  regulationDeck,
  BASE_ARMY_KINDS,
  SIGNATURE_CARD_KINDS,
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

const setupTacticianGame = (): IKState => {
  const kinds = regulationDeck(2);
  const deck = createDeck(kinds);
  return dealWithDeck(deck, 2, 0, ["masterTactician", "default"]);
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

describe("Master Tactician setup", () => {
  it("deal sets facet correctly", () => {
    const state = setupTacticianGame();
    expect(kingFacet(state, 0)).toBe("masterTactician");
    expect(kingFacet(state, 1)).toBe("default");
  });

  it("squire zone starts null", () => {
    const state = setupTacticianGame();
    expect(playerZones(state, 0).squire).toBeNull();
    expect(playerZones(state, 1).squire).toBeNull();
  });

  it("tactician commit requires squireId", () => {
    let state = setupTacticianGame();
    state = apply(state, { kind: "crown", firstPlayer: 0 });

    const p0Hand = playerZones(state, 0).hand;
    expect(p0Hand.length).toBeGreaterThanOrEqual(3);

    const legal = legalActions(state);
    const commitActions = legal.filter((a) => a.kind === "commit");
    expect(commitActions.length).toBeGreaterThan(0);
    const firstCommit = commitActions[0] as { kind: "commit"; successorId: number; dungeonId: number; squireId?: number };
    expect(firstCommit.squireId).toBeDefined();
  });

  it("3-card commit places successor, dungeon, and squire", () => {
    let state = setupTacticianGame();
    state = apply(state, { kind: "crown", firstPlayer: 0 });

    const commitActions = legalActions(state).filter((a) => a.kind === "commit");
    const commit = commitActions[0]!;
    state = apply(state, commit);

    const p0 = playerZones(state, 0);
    expect(p0.successor).not.toBeNull();
    expect(p0.dungeon).not.toBeNull();
    expect(p0.squire).not.toBeNull();
  });

  it("default player still does 2-card commit", () => {
    let state = setupTacticianGame();
    state = apply(state, { kind: "crown", firstPlayer: 0 });

    const p0commit = legalActions(state).filter((a) => a.kind === "commit")[0]!;
    state = apply(state, p0commit);

    const p1legal = legalActions(state).filter((a) => a.kind === "commit");
    const p1commit = p1legal[0] as { kind: "commit"; successorId: number; dungeonId: number; squireId?: number };
    expect(p1commit.squireId).toBeUndefined();
    state = apply(state, p1legal[0]!);

    expect(playerZones(state, 1).squire).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Disgrace — successor matches throne
// ---------------------------------------------------------------------------

describe("Master Tactician disgrace — successor matches throne", () => {
  const buildMatchedState = (): IKState | null => {
    let state = setupTacticianGame();
    state = apply(state, { kind: "crown", firstPlayer: 0 });

    const p0Hand = playerZones(state, 0).hand;
    if (p0Hand.length < 3) return null;

    const card0 = p0Hand[0]!;
    const card1 = p0Hand[1]!;
    const card2 = p0Hand[2]!;

    state = apply(state, {
      kind: "commit",
      successorId: card0.id,
      dungeonId: card1.id,
      squireId: card2.id,
    });

    const p1commit = legalActions(state).filter((a) => a.kind === "commit")[0]!;
    state = apply(state, p1commit);

    const throneCard = playerZones(state, 1).hand[0]!;
    const successorBaseValue = card0.kind.props.value;

    const matchingThrone = (() => {
      for (const p of state.players) {
        for (const c of p.hand) {
          if (c.kind.props.value === successorBaseValue && c.id !== card0.id) return c;
        }
      }
      return null;
    })();
    if (!matchingThrone) return null;

    const armyCard = createArmyCard(0, 700);
    const exhaustedCard = createArmyCard(1, 701);

    state = {
      ...state,
      shared: {
        ...state.shared,
        court: [{ card: matchingThrone, face: "up" as const, playedBy: 1 as PlayerId }],
      },
      players: state.players.map((p, i) => {
        if (i === 0) {
          return {
            ...p,
            hand: p.hand.filter((c) => c.id !== matchingThrone.id),
            army: [armyCard],
            exhausted: [exhaustedCard],
          };
        }
        return {
          ...p,
          hand: p.hand.filter((c) => c.id !== matchingThrone.id),
        };
      }),
    };

    return state;
  };

  it("matched successor: take successor, recall, take squire to hand", () => {
    const state = buildMatchedState();
    if (!state) return;

    const p0Before = playerZones(state, 0);
    const successorCard = p0Before.successor!.card;
    const squireCard = p0Before.squire!.card;
    const handBefore = p0Before.hand.length;

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
    expect(p0After.squire).toBeNull();
    expect(p0After.hand.some((c) => c.id === successorCard.id)).toBe(true);
    expect(p0After.hand.some((c) => c.id === squireCard.id)).toBe(true);
  });

  it("matched successor: take successor, recall, remove squire to rally", () => {
    const state = buildMatchedState();
    if (!state) return;

    const p0Before = playerZones(state, 0);
    const successorCard = p0Before.successor!.card;
    const squireCard = p0Before.squire!.card;

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
    expect(p0After.squire).toBeNull();
    expect(p0After.hand.some((c) => c.id === successorCard.id)).toBe(true);
    expect(p0After.hand.some((c) => c.id === squireCard.id)).toBe(false);
    expect(s.shared.condemned.some((e) => e.card.id === squireCard.id)).toBe(true);
    expect(s.armyRecruitedIds.length).toBeGreaterThan(0);
  });

  it("recall only offers base army cards — non-base-army exhausted cards are excluded", () => {
    let state = setupTacticianGame();
    state = apply(state, { kind: "crown", firstPlayer: 0 });

    const p0Hand = playerZones(state, 0).hand;
    if (p0Hand.length < 3) return;

    const card0 = p0Hand[0]!;
    const card1 = p0Hand[1]!;
    const card2 = p0Hand[2]!;

    state = apply(state, {
      kind: "commit",
      successorId: card0.id,
      dungeonId: card1.id,
      squireId: card2.id,
    });

    const p1commit = legalActions(state).filter((a) => a.kind === "commit")[0]!;
    state = apply(state, p1commit);

    const successorBaseValue = card0.kind.props.value;

    const matchingThrone = (() => {
      for (const p of state.players) {
        for (const c of p.hand) {
          if (c.kind.props.value === successorBaseValue && c.id !== card0.id) return c;
        }
      }
      return null;
    })();
    if (!matchingThrone) return;

    const baseArmyNames = ["Elder", "Inquisitor", "Soldier", "Judge", "Oathbound"];

    const elderKind = BASE_ARMY_KINDS.find((k) => k.name === "Elder")!;
    const baseArmyExhausted: IKCard = { id: 750, kind: elderKind };

    const foolKind = regulationDeck(2).find((k) => k.name === "Fool")!;
    const nonBaseExhausted: IKCard = { id: 751, kind: foolKind };

    state = {
      ...state,
      shared: {
        ...state.shared,
        court: [{ card: matchingThrone, face: "up" as const, playedBy: 1 as PlayerId }],
      },
      players: state.players.map((p, i) => {
        if (i === 0) {
          return {
            ...p,
            hand: p.hand.filter((c) => c.id !== matchingThrone.id),
            army: [createArmyCard(0, 700)],
            exhausted: [baseArmyExhausted, nonBaseExhausted],
          };
        }
        return {
          ...p,
          hand: p.hand.filter((c) => c.id !== matchingThrone.id),
        };
      }),
    };

    let s = apply(state, { kind: "disgrace" });

    let recallChoicesSeen = false;
    while (s.phase === "resolving") {
      const opts = s.pendingResolution!.currentOptions;

      const passIdx = opts.findIndex((o) => o.kind === "pass");
      if (passIdx >= 0) {
        s = chooseEffect(s, passIdx);
        continue;
      }

      const cardChoices = opts.filter((o) => o.kind === "card");
      if (cardChoices.length > 0 && !recallChoicesSeen) {
        recallChoicesSeen = true;

        const offeredIds = cardChoices.map(
          (o) => (o as { kind: "card"; cardId: number }).cardId,
        );

        expect(offeredIds).toContain(baseArmyExhausted.id);
        expect(offeredIds).not.toContain(nonBaseExhausted.id);

        for (const id of offeredIds) {
          const card = [baseArmyExhausted, nonBaseExhausted].find((c) => c.id === id);
          if (card) {
            expect(baseArmyNames).toContain(card.kind.name);
          }
        }
      }

      const yesNoFalse = opts.findIndex((o) => o.kind === "yesNo" && !(o as { kind: "yesNo"; value: boolean }).value);
      if (yesNoFalse >= 0) {
        s = chooseEffect(s, yesNoFalse);
        continue;
      }
      s = chooseEffect(s, 0);
    }

    expect(recallChoicesSeen).toBe(true);
    expect(s.phase).not.toBe("resolving");
  });

  it("recall skips when all exhausted cards are non-base-army", () => {
    let state = setupTacticianGame();
    state = apply(state, { kind: "crown", firstPlayer: 0 });

    const p0Hand = playerZones(state, 0).hand;
    if (p0Hand.length < 3) return;

    const card0 = p0Hand[0]!;
    const card1 = p0Hand[1]!;
    const card2 = p0Hand[2]!;

    state = apply(state, {
      kind: "commit",
      successorId: card0.id,
      dungeonId: card1.id,
      squireId: card2.id,
    });

    const p1commit = legalActions(state).filter((a) => a.kind === "commit")[0]!;
    state = apply(state, p1commit);

    const successorBaseValue = card0.kind.props.value;

    const matchingThrone = (() => {
      for (const p of state.players) {
        for (const c of p.hand) {
          if (c.kind.props.value === successorBaseValue && c.id !== card0.id) return c;
        }
      }
      return null;
    })();
    if (!matchingThrone) return;

    const foolKind = regulationDeck(2).find((k) => k.name === "Fool")!;
    const nonBase1: IKCard = { id: 760, kind: foolKind };
    const assassinKind = regulationDeck(2).find((k) => k.name === "Assassin")!;
    const nonBase2: IKCard = { id: 761, kind: assassinKind };

    state = {
      ...state,
      shared: {
        ...state.shared,
        court: [{ card: matchingThrone, face: "up" as const, playedBy: 1 as PlayerId }],
      },
      players: state.players.map((p, i) => {
        if (i === 0) {
          return {
            ...p,
            hand: p.hand.filter((c) => c.id !== matchingThrone.id),
            army: [createArmyCard(0, 700)],
            exhausted: [nonBase1, nonBase2],
          };
        }
        return {
          ...p,
          hand: p.hand.filter((c) => c.id !== matchingThrone.id),
        };
      }),
    };

    const p0Before = playerZones(state, 0);
    const successorCard = p0Before.successor!.card;
    const squireCard = p0Before.squire!.card;

    let s = apply(state, { kind: "disgrace" });

    let sawRecallCardChoice = false;
    while (s.phase === "resolving") {
      const opts = s.pendingResolution!.currentOptions;
      const passIdx = opts.findIndex((o) => o.kind === "pass");
      if (passIdx >= 0) {
        s = chooseEffect(s, passIdx);
        continue;
      }
      const cardChoices = opts.filter((o) => o.kind === "card");
      if (cardChoices.length > 0) {
        const offeredIds = cardChoices.map(
          (o) => (o as { kind: "card"; cardId: number }).cardId,
        );
        if (offeredIds.includes(nonBase1.id) || offeredIds.includes(nonBase2.id)) {
          sawRecallCardChoice = true;
        }
      }
      const yesNoFalse = opts.findIndex((o) => o.kind === "yesNo" && !(o as { kind: "yesNo"; value: boolean }).value);
      if (yesNoFalse >= 0) {
        s = chooseEffect(s, yesNoFalse);
        continue;
      }
      s = chooseEffect(s, 0);
    }

    expect(sawRecallCardChoice).toBe(false);

    const p0After = playerZones(s, 0);
    expect(p0After.king.face).toBe("down");
    expect(p0After.hand.some((c) => c.id === successorCard.id)).toBe(true);
    expect(p0After.hand.some((c) => c.id === squireCard.id)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Disgrace — successor does NOT match throne
// ---------------------------------------------------------------------------

describe("Master Tactician disgrace — successor mismatch", () => {
  const buildMismatchedState = (): IKState | null => {
    let state = setupTacticianGame();
    state = apply(state, { kind: "crown", firstPlayer: 0 });

    const p0Hand = playerZones(state, 0).hand;
    if (p0Hand.length < 3) return null;

    const card0 = p0Hand[0]!;
    const card1 = p0Hand[1]!;
    const card2 = p0Hand[2]!;

    state = apply(state, {
      kind: "commit",
      successorId: card0.id,
      dungeonId: card1.id,
      squireId: card2.id,
    });

    const p1commit = legalActions(state).filter((a) => a.kind === "commit")[0]!;
    state = apply(state, p1commit);

    const successorBaseValue = card0.kind.props.value;
    const mismatchThrone = (() => {
      for (const p of state.players) {
        for (const c of p.hand) {
          if (c.kind.props.value !== successorBaseValue) return c;
        }
      }
      return null;
    })();
    if (!mismatchThrone) return null;

    state = {
      ...state,
      shared: {
        ...state.shared,
        court: [{ card: mismatchThrone, face: "up" as const, playedBy: 1 as PlayerId }],
      },
      players: state.players.map((p) => ({
        ...p,
        hand: p.hand.filter((c) => c.id !== mismatchThrone.id),
      })),
    };

    return state;
  };

  it("mismatch: choose successor", () => {
    const state = buildMismatchedState();
    if (!state) return;

    const p0Before = playerZones(state, 0);
    const successorCard = p0Before.successor!.card;
    const squireCard = p0Before.squire!.card;

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
    expect(p0After.hand.some((c) => c.id === successorCard.id)).toBe(true);
  });

  it("mismatch: choose squire", () => {
    const state = buildMismatchedState();
    if (!state) return;

    const p0Before = playerZones(state, 0);
    const squireCard = p0Before.squire!.card;

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
    expect(p0After.squire).toBeNull();
    expect(p0After.hand.some((c) => c.id === squireCard.id)).toBe(true);
  });
});
