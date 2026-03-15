/**
 * Tests that Exile's mute modifier properly suppresses on-play effects
 * and that keyword-based filters respect effective (muted) keywords.
 */

import { describe, it, expect } from "vitest";

import {
  createDeck,
  dealWithDeck,
  regulationDeck,
  BASE_DECK,
  SIGNATURE_CARD_KINDS,
  legalActions,
  apply,
  applySafe,
  playerZones,
  effectiveKeywords,
  isMuted,
  refreshModifiers,
  type IKState,
  type IKCard,
} from "../index.js";

const chooseEffect = (state: IKState, idx: number): IKState => {
  const result = applySafe(state, { kind: "effect_choice", choice: idx });
  if (!result.ok) throw new Error(`effect_choice(${idx}) failed: ${JSON.stringify(result.error)}`);
  return result.value;
};

const mkCard = (name: string, id: number): IKCard => {
  const kind =
    SIGNATURE_CARD_KINDS.find((k) => k.name === name) ??
    BASE_DECK.find((k) => k.name === name);
  if (!kind) throw new Error(`Unknown card: ${name}`);
  return { id, kind } as IKCard;
};

/**
 * 2p game where P0 has Elder in hand and it's P0's turn.
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

/**
 * Setup: P0 plays Exile into a court containing `courtCards`.
 * Returns state after Exile is played (mute active, P1's turn).
 */
const playExileIntoCourt = (
  courtCards: ReadonlyArray<{ card: IKCard; face: "up" | "down"; playedBy: 0 | 1 }>,
): IKState => {
  let state = baseGame();
  const exile = mkCard("Exile", 200);

  const courtCardIds = new Set(courtCards.map((e) => e.card.id));
  state = {
    ...state,
    players: state.players.map((p, i) =>
      i === 0
        ? { ...p, hand: [...p.hand.filter((c) => !courtCardIds.has(c.id)), exile] }
        : { ...p, hand: p.hand.filter((c) => !courtCardIds.has(c.id)) },
    ),
    shared: { ...state.shared, court: [...courtCards] },
  };

  state = apply(state, { kind: "play", cardId: exile.id });
  expect(state.roundModifiers).toHaveLength(1);
  expect(state.roundModifiers[0]!.spec.tag).toBe("mute");
  expect(state.activePlayer).toBe(1);
  return state;
};

describe("Exile mute suppresses on-play effects", () => {
  it("Sentry on-play effect is suppressed when muted by Exile", () => {
    const sentry = mkCard("Sentry", 201);
    const elder = mkCard("Elder", 202);
    let state = playExileIntoCourt([
      { card: elder, face: "up", playedBy: 0 },
    ]);

    state = {
      ...state,
      players: state.players.map((p, i) =>
        i === 1 ? { ...p, hand: [...p.hand, sentry] } : p,
      ),
    };

    // Exile mutes all cards except itself (including cards in hand)
    expect(isMuted(state, sentry)).toBe(true);

    state = apply(state, { kind: "play", cardId: sentry.id });

    // Sentry is still muted after entering court
    expect(isMuted(state, sentry)).toBe(true);
    // Effect is suppressed, so no resolution
    expect(state.phase).toBe("play");
    expect(state.pendingResolution).toBeNull();

    const sentryInCourt = state.shared.court.find((e) => e.card.id === sentry.id)!;
    expect(sentryInCourt).toBeDefined();
    expect(sentryInCourt.face).toBe("up");
  });

  it("steadfast card's on-play effect is NOT suppressed by Exile mute", () => {
    const aegis = mkCard("Aegis", 203);
    const elder = mkCard("Elder", 204);
    let state = playExileIntoCourt([
      { card: elder, face: "up", playedBy: 0 },
    ]);

    expect(aegis.kind.props.keywords).toContain("steadfast");

    state = {
      ...state,
      players: state.players.map((p, i) =>
        i === 1 ? { ...p, hand: [...p.hand, aegis] } : p,
      ),
    };

    state = apply(state, { kind: "play", cardId: aegis.id });

    expect(isMuted(state, aegis)).toBe(false);
    expect(state.phase).toBe("resolving");
    expect(state.pendingResolution).not.toBeNull();
  });

  it("after round modifiers are cleared, Sentry on-play effect fires normally", () => {
    const sentry = mkCard("Sentry", 205);
    const elder = mkCard("Elder", 206);
    let state = playExileIntoCourt([
      { card: elder, face: "up", playedBy: 0 },
    ]);

    state = { ...state, roundModifiers: [] };

    state = {
      ...state,
      players: state.players.map((p, i) =>
        i === 1 ? { ...p, hand: [...p.hand, sentry] } : p,
      ),
    };

    state = apply(state, { kind: "play", cardId: sentry.id });

    expect(state.phase).toBe("resolving");
    expect(state.pendingResolution).not.toBeNull();
  });
});

describe("Exile mute affects keyword-based filters", () => {
  it("muted royalty loses royalty keyword via effectiveKeywords", () => {
    const princess = mkCard("Princess", 207);
    const elder = mkCard("Elder", 208);
    expect(princess.kind.props.keywords).toContain("royalty");

    const state = playExileIntoCourt([
      { card: princess, face: "up", playedBy: 0 },
      { card: elder, face: "up", playedBy: 0 },
    ]);

    expect(effectiveKeywords(state, princess)).not.toContain("royalty");
  });

  it("muted immune_to_kings_hand card loses immunity via effectiveKeywords", () => {
    const elder = mkCard("Elder", 209);
    expect(elder.kind.props.keywords).toContain("immune_to_kings_hand");

    const state = playExileIntoCourt([
      { card: elder, face: "up", playedBy: 0 },
    ]);

    expect(effectiveKeywords(state, elder)).not.toContain("immune_to_kings_hand");
  });
});

describe("Exile mute prevents Oathbound onHigherValue override", () => {
  it("Oathbound in hand is muted by Exile and cannot use onHigherValue override", () => {
    const oathbound = mkCard("Oathbound", 211);
    const sentry = mkCard("Sentry", 215);

    // Set up Exile in court (P0's turn -> plays Exile -> P1's turn)
    let state = playExileIntoCourt([]);

    // P1 plays Sentry (value 8)
    state = {
      ...state,
      players: state.players.map((p, i) =>
        i === 1 ? { ...p, hand: [...p.hand, sentry] } : p,
      ),
    };
    state = apply(state, { kind: "play", cardId: sentry.id });

    // Now it's P0's turn, Sentry (value 8) is on throne
    expect(state.activePlayer).toBe(0);

    // Give P0 the Oathbound card and another card (need 2 cards for onHigherValue)
    const zealot = mkCard("Zealot", 216);
    state = {
      ...state,
      players: state.players.map((p, i) =>
        i === 0 ? { ...p, hand: [...p.hand, oathbound, zealot] } : p,
      ),
    };

    // Oathbound in hand is muted by Exile (which mutes all cards)
    expect(isMuted(state, oathbound)).toBe(true);

    // P0 should NOT be able to play Oathbound via onHigherValue override
    // because Oathbound is muted
    const legal = legalActions(state);
    const oathboundPlay = legal.find(
      (a) => a.kind === "play" && a.cardId === oathbound.id,
    );

    // Oathbound (value 6) < throne threshold (Sentry value 8)
    // Oathbound would need the onHigherValue override, but it's muted so the override
    // is not available
    expect(oathboundPlay).toBeUndefined();
  });
});

describe("Exile mute applies to all zones", () => {
  it("Exile itself is NOT muted (steadfast immunity)", () => {
    const exile = mkCard("Exile", 300);
    expect(exile.kind.props.keywords).toContain("steadfast");

    let state = playExileIntoCourt([]);

    // Find Exile in court
    const exileInCourt = state.shared.court.find((e) => e.card.kind.name === "Exile");
    expect(exileInCourt).toBeDefined();

    // Exile is steadfast, so it is NOT muted
    expect(isMuted(state, exileInCourt!.card)).toBe(false);
  });

  it("cards in hand are muted", () => {
    const sentry = mkCard("Sentry", 301);
    let state = playExileIntoCourt([]);

    state = {
      ...state,
      players: state.players.map((p, i) =>
        i === 1 ? { ...p, hand: [...p.hand, sentry] } : p,
      ),
    };

    expect(isMuted(state, sentry)).toBe(true);
  });

  it("cards in army are muted", () => {
    const sentry = mkCard("Sentry", 302);
    let state = playExileIntoCourt([]);

    state = {
      ...state,
      players: state.players.map((p, i) =>
        i === 1 ? { ...p, army: [...p.army, sentry] } : p,
      ),
    };

    expect(isMuted(state, sentry)).toBe(true);
  });

  it("cards in dungeon are muted", () => {
    const sentry = mkCard("Sentry", 303);
    let state = playExileIntoCourt([]);

    state = {
      ...state,
      players: state.players.map((p, i) =>
        i === 1 ? { ...p, dungeon: { card: sentry, knownBy: [] } } : p,
      ),
    };

    expect(isMuted(state, sentry)).toBe(true);
  });

  it("cards in antechamber are muted", () => {
    const sentry = mkCard("Sentry", 304);
    let state = playExileIntoCourt([]);

    state = {
      ...state,
      players: state.players.map((p, i) =>
        i === 1 ? { ...p, antechamber: [...p.antechamber, sentry] } : p,
      ),
    };

    expect(isMuted(state, sentry)).toBe(true);
  });

  it("cards in exhausted zone are muted", () => {
    const sentry = mkCard("Sentry", 305);
    let state = playExileIntoCourt([]);

    state = {
      ...state,
      players: state.players.map((p, i) =>
        i === 1 ? { ...p, exhausted: [...p.exhausted, sentry] } : p,
      ),
    };

    expect(isMuted(state, sentry)).toBe(true);
  });

  it("cards in squire slot are muted", () => {
    const sentry = mkCard("Sentry", 306);
    let state = playExileIntoCourt([]);

    state = {
      ...state,
      players: state.players.map((p, i) =>
        i === 1 ? { ...p, squire: { card: sentry, knownBy: [] } } : p,
      ),
    };

    expect(isMuted(state, sentry)).toBe(true);
  });

  it("cards in parting zone are muted", () => {
    const sentry = mkCard("Sentry", 307);
    let state = playExileIntoCourt([]);

    state = {
      ...state,
      players: state.players.map((p, i) =>
        i === 1 ? { ...p, parting: [...p.parting, sentry] } : p,
      ),
    };

    expect(isMuted(state, sentry)).toBe(true);
  });

  it("cards in court are muted", () => {
    const sentry = mkCard("Sentry", 308);
    const state = playExileIntoCourt([
      { card: sentry, face: "up", playedBy: 0 },
    ]);

    expect(isMuted(state, sentry)).toBe(true);
  });

  it("cards in condemned pile are muted", () => {
    const sentry = mkCard("Sentry", 309);
    let state = playExileIntoCourt([]);

    state = {
      ...state,
      shared: {
        ...state.shared,
        condemned: [...state.shared.condemned, { card: sentry, knownBy: [] }],
      },
    };

    expect(isMuted(state, sentry)).toBe(true);
  });
});

describe("Exile mute respects steadfast in all zones", () => {
  it("steadfast card in hand is NOT muted", () => {
    const aegis = mkCard("Aegis", 310);
    expect(aegis.kind.props.keywords).toContain("steadfast");

    let state = playExileIntoCourt([]);

    state = {
      ...state,
      players: state.players.map((p, i) =>
        i === 1 ? { ...p, hand: [...p.hand, aegis] } : p,
      ),
    };

    expect(isMuted(state, aegis)).toBe(false);
  });

  it("steadfast card in army is NOT muted", () => {
    const aegis = mkCard("Aegis", 311);
    let state = playExileIntoCourt([]);

    state = {
      ...state,
      players: state.players.map((p, i) =>
        i === 1 ? { ...p, army: [...p.army, aegis] } : p,
      ),
    };

    expect(isMuted(state, aegis)).toBe(false);
  });

  it("steadfast card in court is NOT muted", () => {
    const aegis = mkCard("Aegis", 312);
    const state = playExileIntoCourt([
      { card: aegis, face: "up", playedBy: 0 },
    ]);

    expect(isMuted(state, aegis)).toBe(false);
  });

  it("steadfast card in dungeon is NOT muted", () => {
    const aegis = mkCard("Aegis", 313);
    let state = playExileIntoCourt([]);

    state = {
      ...state,
      players: state.players.map((p, i) =>
        i === 1 ? { ...p, dungeon: { card: aegis, knownBy: [] } } : p,
      ),
    };

    expect(isMuted(state, aegis)).toBe(false);
  });
});
