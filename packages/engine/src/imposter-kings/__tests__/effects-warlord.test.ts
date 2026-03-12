/**
 * Warlord value regression tests.
 *
 * Warlord (base 7): "If there are any Royalty in the Court, this card gains
 * +1 value in your hand and an additional +1 value after being played."
 *
 * Hand = 8, Court = 9 when Royalty is face-up in Court.
 *
 * Scenario 1 (Sentry throne):
 *   Court: [Queen(face-up), Elder, Sentry(throne)]. Throne value = 8.
 *   Warlord in hand = 8 (royalty present). 8 >= 8, playable.
 *   After playing, Warlord on throne = 9. P0 with KH (8) is stuck.
 *
 * Scenario 2 (Princess throne):
 *   Court: [Queen(face-up), Elder, Princess(throne)]. Throne value = 9.
 *   Warlord in hand = 8 (royalty present). 8 < 9, not playable. P1 stuck.
 */

import { describe, it, expect } from "vitest";

import {
  createDeck,
  dealWithDeck,
  regulationDeck,
  legalActions,
  apply,
  playerZones,
  effectiveValue,
  effectiveKeywords,
  refreshModifiers,
  throneValue,
  type IKState,
  type IKPlayCardAction,
  type PlayerId,
} from "../index.js";

const setupWithCourt = (
  courtCards: ReadonlyArray<{ name: string; face: "up" | "down"; playedBy: PlayerId }>,
  p0HandNames: ReadonlyArray<string>,
  p1HandNames: ReadonlyArray<string>,
): IKState => {
  const kinds = regulationDeck(2);
  const deck = createDeck(kinds);

  const used = new Set<number>();
  const findCard = (name: string) => {
    const c = deck.find((c) => c.kind.name === name && !used.has(c.id));
    if (!c) throw new Error(`Card ${name} not found`);
    used.add(c.id);
    return c;
  };

  const court = courtCards.map((spec) => ({
    card: findCard(spec.name),
    face: spec.face as "up" | "down",
    playedBy: spec.playedBy,
  }));

  const p0Hand = p0HandNames.map((n) => findCard(n));
  const p1Hand = p1HandNames.map((n) => findCard(n));

  const remaining = deck.filter((c) => !used.has(c.id));
  const custom: typeof deck[number][] = [];
  const p0Full = [...p0Hand];
  const p1Full = [...p1Hand];
  while (p0Full.length < 7) p0Full.push(remaining.shift()!);
  while (p1Full.length < 7) p1Full.push(remaining.shift()!);
  for (let i = 0; i < 7; i++) {
    custom.push(p0Full[i]!);
    custom.push(p1Full[i]!);
  }
  while (remaining.length > 0) custom.push(remaining.shift()!);

  let state = dealWithDeck(custom, 2, 0);
  state = apply(state, { kind: "crown", firstPlayer: 0 });
  const s1 = legalActions(state).find((a) => a.kind === "commit")!;
  state = apply(state, s1);
  const s2 = legalActions(state).find((a) => a.kind === "commit")!;
  state = apply(state, s2);

  state = {
    ...state,
    players: state.players.map((p, i) => ({
      ...p,
      hand: i === 0 ? p0Hand : p1Hand,
    })),
    shared: { ...state.shared, court },
    activePlayer: 1 as PlayerId,
  };

  return state;
};

describe("Warlord value with Royalty in Court", () => {
  it("Warlord is 8 in hand when Royalty is face-up in court", () => {
    const state = setupWithCourt(
      [{ name: "Queen", face: "up", playedBy: 0 as PlayerId }],
      ["King's Hand"],
      ["Warlord"],
    );

    const warlord = playerZones(state, 1).hand.find((c) => c.kind.name === "Warlord")!;
    expect(warlord).toBeDefined();
    expect(warlord.kind.props.value).toBe(7);
    expect(effectiveValue(state, warlord)).toBe(8);
  });

  it("Warlord is 7 in hand when no Royalty in court", () => {
    const state = setupWithCourt(
      [{ name: "Elder", face: "up", playedBy: 0 as PlayerId }],
      ["King's Hand"],
      ["Warlord"],
    );

    const warlord = playerZones(state, 1).hand.find((c) => c.kind.name === "Warlord")!;
    expect(effectiveValue(state, warlord)).toBe(7);
  });

  it("Warlord (8 in hand) can play on Sentry (8) throne, becomes 9 on throne", () => {
    const state = setupWithCourt(
      [
        { name: "Queen", face: "up", playedBy: 0 as PlayerId },
        { name: "Elder", face: "up", playedBy: 1 as PlayerId },
        { name: "Sentry", face: "up", playedBy: 0 as PlayerId },
      ],
      ["King's Hand"],
      ["Warlord"],
    );

    expect(throneValue(state)).toBe(8);

    const warlord = playerZones(state, 1).hand.find((c) => c.kind.name === "Warlord")!;
    expect(effectiveValue(state, warlord)).toBe(8);

    const legal = legalActions(state);
    const warlordPlay = legal.find(
      (a): a is IKPlayCardAction => a.kind === "play" && a.cardId === warlord.id,
    );
    expect(warlordPlay).toBeDefined();

    let after = apply(state, { kind: "play", cardId: warlord.id });
    while (after.phase === "resolving") {
      after = apply(after, { kind: "effect_choice", choice: 0 });
    }

    const warlordInCourt = after.shared.court.find(
      (e) => e.card.kind.name === "Warlord",
    )!;
    expect(warlordInCourt).toBeDefined();
    expect(effectiveValue(after, warlordInCourt.card)).toBe(9);
    expect(throneValue(after)).toBe(9);
  });

  it("Warlord (8 in hand) cannot play on Princess (9) throne — stuck", () => {
    const state = setupWithCourt(
      [
        { name: "Queen", face: "up", playedBy: 0 as PlayerId },
        { name: "Elder", face: "up", playedBy: 1 as PlayerId },
        { name: "Princess", face: "up", playedBy: 0 as PlayerId },
      ],
      ["King's Hand"],
      ["Warlord"],
    );

    expect(throneValue(state)).toBe(9);

    const warlord = playerZones(state, 1).hand.find((c) => c.kind.name === "Warlord")!;
    expect(effectiveValue(state, warlord)).toBe(8);

    const legal = legalActions(state);
    const warlordPlay = legal.find(
      (a): a is IKPlayCardAction => a.kind === "play" && a.cardId === warlord.id,
    );
    expect(warlordPlay).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Warlord + Immortal interaction regression
//
// Immortal grants Royalty to itself and Warlord via grantKeyword.  The
// courtHasRoyalty predicate must respect effective (granted) keywords, not
// just base keywords, otherwise Warlord's +2 court buff never fires when
// Immortal is the only source of Royalty.
// ---------------------------------------------------------------------------

describe("Warlord value with Immortal-granted Royalty", () => {
  const setupImmortalCourt = (
    extraCourt: ReadonlyArray<{ name: string; face: "up" | "down"; playedBy: PlayerId }>,
    p0HandNames: ReadonlyArray<string>,
    p1HandNames: ReadonlyArray<string>,
  ): IKState => {
    const base = setupWithCourt(
      [{ name: "Immortal", face: "up", playedBy: 1 as PlayerId }, ...extraCourt],
      p0HandNames,
      p1HandNames,
    );
    return refreshModifiers(base);
  };

  it("Immortal in court grants Royalty to itself", () => {
    const state = setupImmortalCourt([], ["King's Hand"], ["Warlord"]);
    const immortal = state.shared.court.find((e) => e.card.kind.name === "Immortal")!;
    expect(effectiveKeywords(state, immortal.card)).toContain("royalty");
  });

  it("Warlord is 8 in hand when Immortal provides Royalty in court", () => {
    const state = setupImmortalCourt([], ["King's Hand"], ["Warlord"]);
    const warlord = playerZones(state, 1).hand.find((c) => c.kind.name === "Warlord")!;
    expect(effectiveValue(state, warlord)).toBe(8);
  });

  it("Warlord becomes 9 in court when Immortal provides Royalty", () => {
    const state = setupImmortalCourt(
      [],
      ["Sentry"],
      ["Warlord"],
    );

    expect(throneValue(state)).toBe(5);

    const warlord = playerZones(state, 1).hand.find((c) => c.kind.name === "Warlord")!;
    expect(effectiveValue(state, warlord)).toBe(8);

    let after = apply(state, { kind: "play", cardId: warlord.id });
    while (after.phase === "resolving") {
      after = apply(after, { kind: "effect_choice", choice: 0 });
    }

    const warlordInCourt = after.shared.court.find(
      (e) => e.card.kind.name === "Warlord",
    )!;
    expect(effectiveValue(after, warlordInCourt.card)).toBe(9);
    expect(throneValue(after)).toBe(9);
  });

  it("Sentry (8) cannot play on Warlord (9) throne — Immortal Royalty makes it impossible", () => {
    const state = setupImmortalCourt(
      [],
      ["Sentry"],
      ["Warlord"],
    );

    let after = apply(state, { kind: "play", cardId: playerZones(state, 1).hand.find((c) => c.kind.name === "Warlord")!.id });
    while (after.phase === "resolving") {
      after = apply(after, { kind: "effect_choice", choice: 0 });
    }

    expect(throneValue(after)).toBe(9);

    const sentry = playerZones(after, after.activePlayer).hand.find((c) => c.kind.name === "Sentry");
    if (sentry) {
      const legal = legalActions(after);
      const sentryPlay = legal.find(
        (a): a is IKPlayCardAction => a.kind === "play" && a.cardId === sentry.id,
      );
      expect(sentryPlay).toBeUndefined();
    }
  });
});
