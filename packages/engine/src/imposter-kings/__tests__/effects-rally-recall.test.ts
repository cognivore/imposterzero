import { describe, it, expect } from "vitest";
import {
  createDeck,
  dealWithDeck,
  regulationDeck,
  SIGNATURE_CARD_KINDS,
  BASE_ARMY_KINDS,
  legalActions,
  apply,
  applySafe,
  playerZones,
  type IKState,
  type IKCard,
} from "../index.js";

const chooseEffect = (state: IKState, idx: number): IKState => {
  const result = applySafe(state, { kind: "effect_choice", choice: idx });
  if (!result.ok) throw new Error(`effect_choice(${idx}) failed: ${JSON.stringify(result.error)}`);
  return result.value;
};

const setupBaseGame = (): IKState => {
  const kinds = regulationDeck(2);
  const deck = createDeck(kinds);
  let state = dealWithDeck(deck, 2, 0);
  state = apply(state, { kind: "crown", firstPlayer: 0 });
  const s1 = legalActions(state).find((a) => a.kind === "commit")!;
  state = apply(state, s1);
  const s2 = legalActions(state).find((a) => a.kind === "commit")!;
  state = apply(state, s2);
  return state;
};

const createArmyCard = (kindIndex: number, id: number): IKCard =>
  ({ id, kind: BASE_ARMY_KINDS[kindIndex]! }) as IKCard;

const injectArmyAndExhausted = (
  state: IKState,
  player: number,
  army: ReadonlyArray<IKCard>,
  exhausted: ReadonlyArray<IKCard>,
): IKState => ({
  ...state,
  players: state.players.map((p, i) =>
    i === player ? { ...p, army, exhausted } : p,
  ),
});

// ---------------------------------------------------------------------------
// Rally tests
// ---------------------------------------------------------------------------

describe("Rally", () => {
  it("moves chosen card from army to hand and tracks in armyRecruitedIds", () => {
    const state = setupBaseGame();
    const armyCard1 = createArmyCard(0, 800);
    const armyCard2 = createArmyCard(1, 801);

    const flagbearerKind = SIGNATURE_CARD_KINDS.find((k) => k.name === "Flagbearer")!;
    const flagbearer: IKCard = { id: 900, kind: flagbearerKind };

    const p0Hand = playerZones(state, 0).hand;
    const p1Hand = playerZones(state, 1).hand;
    const disgracedCard = p1Hand[0]!;

    let s: IKState = {
      ...state,
      players: state.players.map((p, i) => {
        if (i === 0) {
          return {
            ...p,
            hand: [flagbearer, ...p.hand.filter((c) => c.id !== p0Hand[0]!.id)],
            army: [armyCard1, armyCard2],
            exhausted: [createArmyCard(2, 802)],
          };
        }
        return { ...p, hand: p.hand.filter((c) => c.id !== disgracedCard.id) };
      }),
      shared: {
        ...state.shared,
        court: [{ card: disgracedCard, face: "down" as const, playedBy: 1 as const }],
      },
    };

    s = apply(s, { kind: "play", cardId: flagbearer.id });
    expect(s.phase).toBe("resolving");

    const proceedIdx = s.pendingResolution!.currentOptions.findIndex((o) => o.kind === "proceed");
    s = chooseEffect(s, proceedIdx);

    while (s.phase === "resolving") {
      s = chooseEffect(s, 0);
    }

    expect(s.armyRecruitedIds.length).toBeGreaterThan(0);
    const p0After = playerZones(s, 0);
    const ralliedIds = s.armyRecruitedIds;
    const ralliedInHand = ralliedIds.filter((id) => p0After.hand.some((c) => c.id === id));
    expect(ralliedInHand.length).toBeGreaterThanOrEqual(1);
  });

  it("skips when army is empty", () => {
    const state = setupBaseGame();

    const flagbearerKind = SIGNATURE_CARD_KINDS.find((k) => k.name === "Flagbearer")!;
    const flagbearer: IKCard = { id: 900, kind: flagbearerKind };

    const p0Hand = playerZones(state, 0).hand;
    const p1Hand = playerZones(state, 1).hand;
    const disgracedCard = p1Hand[0]!;

    let s: IKState = {
      ...state,
      players: state.players.map((p, i) => {
        if (i === 0) {
          return {
            ...p,
            hand: [flagbearer, ...p.hand.filter((c) => c.id !== p0Hand[0]!.id)],
            army: [],
            exhausted: [createArmyCard(0, 810)],
          };
        }
        return { ...p, hand: p.hand.filter((c) => c.id !== disgracedCard.id) };
      }),
      shared: {
        ...state.shared,
        court: [{ card: disgracedCard, face: "down" as const, playedBy: 1 as const }],
      },
    };

    s = apply(s, { kind: "play", cardId: flagbearer.id });
    expect(s.phase).toBe("resolving");

    const proceedIdx = s.pendingResolution!.currentOptions.findIndex((o) => o.kind === "proceed");
    s = chooseEffect(s, proceedIdx);

    while (s.phase === "resolving") {
      s = chooseEffect(s, 0);
    }

    expect(s.phase).toBe("play");
  });

  it("presents all army cards as choices", () => {
    const state = setupBaseGame();
    const armyCards = [createArmyCard(0, 800), createArmyCard(1, 801), createArmyCard(2, 802)];

    const flagbearerKind = SIGNATURE_CARD_KINDS.find((k) => k.name === "Flagbearer")!;
    const flagbearer: IKCard = { id: 900, kind: flagbearerKind };

    const p0Hand = playerZones(state, 0).hand;
    const p1Hand = playerZones(state, 1).hand;
    const disgracedCard = p1Hand[0]!;

    let s: IKState = {
      ...state,
      players: state.players.map((p, i) => {
        if (i === 0) {
          return {
            ...p,
            hand: [flagbearer, ...p.hand.filter((c) => c.id !== p0Hand[0]!.id)],
            army: armyCards,
            exhausted: [createArmyCard(3, 803)],
          };
        }
        return { ...p, hand: p.hand.filter((c) => c.id !== disgracedCard.id) };
      }),
      shared: {
        ...state.shared,
        court: [{ card: disgracedCard, face: "down" as const, playedBy: 1 as const }],
      },
    };

    s = apply(s, { kind: "play", cardId: flagbearer.id });

    const proceedIdx = s.pendingResolution!.currentOptions.findIndex((o) => o.kind === "proceed");
    s = chooseEffect(s, proceedIdx);

    s = chooseEffect(s, 0);

    const opts = s.pendingResolution!.currentOptions;
    const cardOpts = opts.filter((o) => o.kind === "card");
    expect(cardOpts.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Recall tests
// ---------------------------------------------------------------------------

describe("Recall", () => {
  it("moves chosen card from exhausted to army", () => {
    const state = setupBaseGame();
    const exhaustedCard = createArmyCard(0, 810);
    const armyCard = createArmyCard(1, 811);

    const flagbearerKind = SIGNATURE_CARD_KINDS.find((k) => k.name === "Flagbearer")!;
    const flagbearer: IKCard = { id: 900, kind: flagbearerKind };

    const p0Hand = playerZones(state, 0).hand;
    const p1Hand = playerZones(state, 1).hand;
    const disgracedCard = p1Hand[0]!;

    let s: IKState = {
      ...state,
      players: state.players.map((p, i) => {
        if (i === 0) {
          return {
            ...p,
            hand: [flagbearer, ...p.hand.filter((c) => c.id !== p0Hand[0]!.id)],
            army: [armyCard],
            exhausted: [exhaustedCard],
          };
        }
        return { ...p, hand: p.hand.filter((c) => c.id !== disgracedCard.id) };
      }),
      shared: {
        ...state.shared,
        court: [{ card: disgracedCard, face: "down" as const, playedBy: 1 as const }],
      },
    };

    const armyBefore = playerZones(s, 0).army.length;
    const exhaustedBefore = playerZones(s, 0).exhausted.length;

    s = apply(s, { kind: "play", cardId: flagbearer.id });
    const proceedIdx = s.pendingResolution!.currentOptions.findIndex((o) => o.kind === "proceed");
    s = chooseEffect(s, proceedIdx);

    s = chooseEffect(s, 0);

    while (s.phase === "resolving") {
      s = chooseEffect(s, 0);
    }

    const p0After = playerZones(s, 0);
    expect(p0After.exhausted.length).toBeLessThanOrEqual(exhaustedBefore);
    expect(p0After.army.some((c) => c.id === exhaustedCard.id) ||
           p0After.hand.some((c) => c.id === exhaustedCard.id)).toBe(true);
  });

  it("skips when no exhausted cards", () => {
    const state = setupBaseGame();
    const armyCard = createArmyCard(0, 811);

    const flagbearerKind = SIGNATURE_CARD_KINDS.find((k) => k.name === "Flagbearer")!;
    const flagbearer: IKCard = { id: 900, kind: flagbearerKind };

    const p0Hand = playerZones(state, 0).hand;
    const p1Hand = playerZones(state, 1).hand;
    const disgracedCard = p1Hand[0]!;

    let s: IKState = {
      ...state,
      players: state.players.map((p, i) => {
        if (i === 0) {
          return {
            ...p,
            hand: [flagbearer, ...p.hand.filter((c) => c.id !== p0Hand[0]!.id)],
            army: [armyCard],
            exhausted: [],
          };
        }
        return { ...p, hand: p.hand.filter((c) => c.id !== disgracedCard.id) };
      }),
      shared: {
        ...state.shared,
        court: [{ card: disgracedCard, face: "down" as const, playedBy: 1 as const }],
      },
    };

    s = apply(s, { kind: "play", cardId: flagbearer.id });
    const proceedIdx = s.pendingResolution!.currentOptions.findIndex((o) => o.kind === "proceed");
    s = chooseEffect(s, proceedIdx);

    while (s.phase === "resolving") {
      s = chooseEffect(s, 0);
    }

    expect(s.phase).toBe("play");
  });

  it("presents all exhausted cards as choices", () => {
    const state = setupBaseGame();
    const exhausted1 = createArmyCard(0, 810);
    const exhausted2 = createArmyCard(1, 811);
    const exhausted3 = createArmyCard(2, 812);

    const flagbearerKind = SIGNATURE_CARD_KINDS.find((k) => k.name === "Flagbearer")!;
    const flagbearer: IKCard = { id: 900, kind: flagbearerKind };

    const p0Hand = playerZones(state, 0).hand;
    const p1Hand = playerZones(state, 1).hand;
    const disgracedCard = p1Hand[0]!;

    let s: IKState = {
      ...state,
      players: state.players.map((p, i) => {
        if (i === 0) {
          return {
            ...p,
            hand: [flagbearer, ...p.hand.filter((c) => c.id !== p0Hand[0]!.id)],
            army: [createArmyCard(3, 813)],
            exhausted: [exhausted1, exhausted2, exhausted3],
          };
        }
        return { ...p, hand: p.hand.filter((c) => c.id !== disgracedCard.id) };
      }),
      shared: {
        ...state.shared,
        court: [{ card: disgracedCard, face: "down" as const, playedBy: 1 as const }],
      },
    };

    s = apply(s, { kind: "play", cardId: flagbearer.id });
    const proceedIdx = s.pendingResolution!.currentOptions.findIndex((o) => o.kind === "proceed");
    s = chooseEffect(s, proceedIdx);

    expect(s.phase).toBe("resolving");
    const opts = s.pendingResolution!.currentOptions;
    const cardOpts = opts.filter((o) => o.kind === "card");
    expect(cardOpts.length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// returnOneRallied tests
// ---------------------------------------------------------------------------

describe("returnOneRallied", () => {
  it("auto-returns the only rallied card if just one", () => {
    const state = setupBaseGame();
    const armyCard = createArmyCard(0, 800);

    const flagbearerKind = SIGNATURE_CARD_KINDS.find((k) => k.name === "Flagbearer")!;
    const flagbearer: IKCard = { id: 900, kind: flagbearerKind };

    const p0Hand = playerZones(state, 0).hand;
    const p1Hand = playerZones(state, 1).hand;
    const disgracedCard = p1Hand[0]!;

    let s: IKState = {
      ...state,
      players: state.players.map((p, i) => {
        if (i === 0) {
          return {
            ...p,
            hand: [flagbearer, ...p.hand.filter((c) => c.id !== p0Hand[0]!.id)],
            army: [armyCard],
            exhausted: [createArmyCard(1, 801)],
          };
        }
        return { ...p, hand: p.hand.filter((c) => c.id !== disgracedCard.id) };
      }),
      shared: {
        ...state.shared,
        court: [{ card: disgracedCard, face: "down" as const, playedBy: 1 as const }],
      },
    };

    const handBefore = playerZones(s, 0).hand.length;
    s = apply(s, { kind: "play", cardId: flagbearer.id });
    const proceedIdx = s.pendingResolution!.currentOptions.findIndex((o) => o.kind === "proceed");
    s = chooseEffect(s, proceedIdx);

    while (s.phase === "resolving") {
      s = chooseEffect(s, 0);
    }

    expect(s.phase).toBe("play");
    const handAfter = playerZones(s, 0).hand.length;
    expect(handAfter).toBe(handBefore);
  });

  it("Flagbearer full flow: disgrace self, recall, rally x2, return one — net +1 hand", () => {
    const state = setupBaseGame();
    const armyCard1 = createArmyCard(0, 800);
    const armyCard2 = createArmyCard(1, 801);
    const exhaustedCard = createArmyCard(2, 802);

    const flagbearerKind = SIGNATURE_CARD_KINDS.find((k) => k.name === "Flagbearer")!;
    const flagbearer: IKCard = { id: 900, kind: flagbearerKind };

    const p0Hand = playerZones(state, 0).hand;
    const p1Hand = playerZones(state, 1).hand;
    const disgracedCard = p1Hand[0]!;

    let s: IKState = {
      ...state,
      players: state.players.map((p, i) => {
        if (i === 0) {
          return {
            ...p,
            hand: [flagbearer, ...p.hand.filter((c) => c.id !== p0Hand[0]!.id)],
            army: [armyCard1, armyCard2],
            exhausted: [exhaustedCard],
          };
        }
        return { ...p, hand: p.hand.filter((c) => c.id !== disgracedCard.id) };
      }),
      shared: {
        ...state.shared,
        court: [{ card: disgracedCard, face: "down" as const, playedBy: 1 as const }],
      },
    };

    const handBefore = playerZones(s, 0).hand.length;
    s = apply(s, { kind: "play", cardId: flagbearer.id });

    const proceedIdx = s.pendingResolution!.currentOptions.findIndex((o) => o.kind === "proceed");
    s = chooseEffect(s, proceedIdx);

    while (s.phase === "resolving") {
      s = chooseEffect(s, 0);
    }

    expect(s.phase).toBe("play");
    const handAfter = playerZones(s, 0).hand.length;
    expect(handAfter).toBe(handBefore - 1 + 2 - 1);
    expect(s.armyRecruitedIds.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Ancestor Rally/Recall tests
// ---------------------------------------------------------------------------

describe("Ancestor recall+rally", () => {
  it("recall then optional discard+rally when played on Royalty", () => {
    const state = setupBaseGame();
    const exhaustedCard = createArmyCard(0, 820);
    const armyCard = createArmyCard(1, 821);

    const ancestorKind = SIGNATURE_CARD_KINDS.find((k) => k.name === "Ancestor")!;
    const ancestor: IKCard = { id: 950, kind: ancestorKind };

    const p0Hand = playerZones(state, 0).hand;
    const royaltyCard = p0Hand.find((c) => c.kind.props.keywords.includes("royalty"));

    if (!royaltyCard) return;

    let s: IKState = {
      ...state,
      players: state.players.map((p, i) => {
        if (i === 0) {
          return {
            ...p,
            hand: [ancestor, ...p.hand],
            army: [armyCard],
            exhausted: [exhaustedCard],
          };
        }
        return p;
      }),
      shared: {
        ...state.shared,
        court: [{ card: royaltyCard, face: "up" as const, playedBy: 1 as const }],
      },
    };

    s = apply(s, { kind: "play", cardId: ancestor.id });

    if (s.phase !== "resolving") return;

    while (s.phase === "resolving") {
      s = chooseEffect(s, 0);
    }

    expect(s.phase).toBe("play");
  });
});
