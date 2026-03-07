/**
 * Tests for expansion cards: Aegis, Ancestor, Exile, Lockshift.
 */

import { describe, it, expect } from "vitest";

import {
  createDeck,
  dealWithDeck,
  regulationDeck,
  SIGNATURE_CARD_KINDS,
  legalActions,
  apply,
  applySafe,
  playerZones,
  effectiveValue,
  effectiveKeywords,
  refreshModifiers,
  type IKState,
  type IKCard,
} from "../index.js";

const chooseEffect = (state: IKState, idx: number): IKState => {
  const result = applySafe(state, { kind: "effect_choice", choice: idx });
  if (!result.ok) throw new Error(`effect_choice(${idx}) failed: ${JSON.stringify(result.error)}`);
  return result.value;
};

const mkExpansionCard = (name: string, id: number): IKCard => {
  const kind = SIGNATURE_CARD_KINDS.find((k) => k.name === name)!;
  return { id, kind } as IKCard;
};

/**
 * Base 2p game after setup. Deck order ensures P0 commits Fool+Assassin first,
 * so P0 keeps Elder (immune_to_kings_hand) for court tests.
 */
const baseGame = (): IKState => {
  const kinds = regulationDeck(2);
  const deck = createDeck(kinds);

  const fool = deck.find((c) => c.kind.name === "Fool")!;
  const assassin = deck.find((c) => c.kind.name === "Assassin")!;
  const elder = deck.find((c) => c.kind.name === "Elder")!;
  const other = deck.filter(
    (c) => c.id !== fool.id && c.id !== assassin.id && c.id !== elder.id,
  );

  const customDeck: typeof deck[number][] = [];
  customDeck.push(fool, assassin);
  customDeck.push(other[0]!, other[1]!);
  customDeck.push(elder, other[2]!, other[3]!, other[4]!, other[5]!);
  customDeck.push(other[6]!, other[7]!, other[8]!, other[9]!, other[10]!, other[11]!, other[12]!);
  customDeck.push(other[13]!, other[14]!, other[15]!, other[16]!);

  let state = dealWithDeck(customDeck, 2, 0);
  state = apply(state, { kind: "crown", firstPlayer: 0 });
  state = apply(state, legalActions(state).find((a) => a.kind === "commit")!);
  state = apply(state, legalActions(state).find((a) => a.kind === "commit")!);
  return state;
};

describe("Aegis", () => {
  it("play on any card and optionally disgrace a court card", () => {
    let state = baseGame();
    const elder = playerZones(state, 0).hand.find((c) => c.kind.name === "Elder")!;
    state = {
      ...state,
      players: state.players.map((p, i) =>
        i === 0 ? { ...p, hand: p.hand.filter((c) => c.id !== elder.id) } : p,
      ),
      shared: {
        ...state.shared,
        court: [{ card: elder, face: "up" as const, playedBy: 0 as const }],
      },
    };

    const aegis = mkExpansionCard("Aegis", 100);
    state = {
      ...state,
      players: state.players.map((p, i) =>
        i === 0 ? { ...p, hand: [...p.hand, aegis] } : p,
      ),
    };

    state = apply(state, { kind: "play", cardId: aegis.id });

    expect(state.phase).toBe("resolving");
    const proceedIdx = state.pendingResolution!.currentOptions.findIndex((o) => o.kind === "proceed");
    expect(proceedIdx).not.toBe(-1);
    state = chooseEffect(state, proceedIdx);

    expect(state.phase).toBe("resolving");
    const opts = state.pendingResolution!.currentOptions;
    const elderIdx = opts.findIndex(
      (o) => o.kind === "card" && (o as { kind: "card"; cardId: number }).cardId === elder.id,
    );
    expect(elderIdx).not.toBe(-1);
    state = chooseEffect(state, elderIdx);

    expect(state.phase).toBe("play");
    expect(state.activePlayer).toBe(1);
    const elderEntry = state.shared.court.find((e) => e.card.id === elder.id)!;
    expect(elderEntry.face).toBe("down");
  });

  it("skip disgrace: Aegis plays, no court card disgraced", () => {
    let state = baseGame();
    const elder = playerZones(state, 0).hand.find((c) => c.kind.name === "Elder")!;
    state = {
      ...state,
      players: state.players.map((p, i) =>
        i === 0 ? { ...p, hand: p.hand.filter((c) => c.id !== elder.id) } : p,
      ),
      shared: {
        ...state.shared,
        court: [{ card: elder, face: "up" as const, playedBy: 0 as const }],
      },
    };

    const aegis = mkExpansionCard("Aegis", 100);
    state = {
      ...state,
      players: state.players.map((p, i) =>
        i === 0 ? { ...p, hand: [...p.hand, aegis] } : p,
      ),
    };

    state = apply(state, { kind: "play", cardId: aegis.id });

    const passIdx = state.pendingResolution!.currentOptions.findIndex((o) => o.kind === "pass");
    state = chooseEffect(state, passIdx);

    expect(state.phase).toBe("play");
    expect(state.shared.court.find((e) => e.card.id === elder.id)!.face).toBe("up");
  });
});

describe("Ancestor", () => {
  it("Elders in court gain Steadfast and +3 value when Ancestor is in court", () => {
    let state = baseGame();
    const elder = playerZones(state, 0).hand.find((c) => c.kind.name === "Elder")!;
    const ancestor = mkExpansionCard("Ancestor", 101);

    state = {
      ...state,
      players: state.players.map((p, i) =>
        i === 0
          ? {
              ...p,
              hand: p.hand.filter((c) => c.id !== elder.id),
            }
          : p,
      ),
      shared: {
        ...state.shared,
        court: [
          { card: elder, face: "up" as const, playedBy: 0 as const },
          { card: ancestor, face: "up" as const, playedBy: 0 as const },
        ],
      },
    };
    state = refreshModifiers(state);

    expect(effectiveKeywords(state, elder)).toContain("steadfast");
    expect(effectiveValue(state, elder)).toBe(6);
  });
});

describe("Exile", () => {
  it("on play: other court cards lose keywords (muted), base value unchanged", () => {
    let state = baseGame();
    const elder = playerZones(state, 0).hand.find((c) => c.kind.name === "Elder")!;
    const exile = mkExpansionCard("Exile", 102);

    state = {
      ...state,
      players: state.players.map((p, i) =>
        i === 0 ? { ...p, hand: p.hand.filter((c) => c.id !== elder.id) } : p,
      ),
      shared: {
        ...state.shared,
        court: [{ card: elder, face: "up" as const, playedBy: 0 as const }],
      },
    };

    expect(effectiveKeywords(state, elder)).toContain("immune_to_kings_hand");

    state = {
      ...state,
      players: state.players.map((p, i) =>
        i === 0 ? { ...p, hand: [...p.hand, exile] } : p,
      ),
    };

    state = apply(state, { kind: "play", cardId: exile.id });

    expect(state.phase).toBe("play");
    expect(state.roundModifiers).toHaveLength(1);
    expect(state.roundModifiers[0]!.spec.tag).toBe("mute");

    const elderInCourt = state.shared.court.find((e) => e.card.id === elder.id)!;
    expect(effectiveKeywords(state, elderInCourt.card)).not.toContain("immune_to_kings_hand");
    expect(effectiveValue(state, elderInCourt.card)).toBe(3);
  });
});

describe("Lockshift", () => {
  it("skip ability: dungeons unchanged", () => {
    let state = baseGame();
    const lockshift = mkExpansionCard("Lockshift", 103);
    state = {
      ...state,
      players: state.players.map((p, i) =>
        i === 0 ? { ...p, hand: [...p.hand, lockshift] } : p,
      ),
    };

    state = apply(state, { kind: "play", cardId: lockshift.id });

    const passIdx = state.pendingResolution!.currentOptions.findIndex((o) => o.kind === "pass");
    state = chooseEffect(state, passIdx);

    expect(state.players[0]!.dungeon).not.toBeNull();
    expect(state.players[1]!.dungeon).not.toBeNull();
  });
});
