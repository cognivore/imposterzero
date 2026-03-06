/**
 * Seeded deterministic tests for the Sentry card effect.
 *
 * Sentry (value 8): "You may Disgrace this card after playing it to choose a
 * card from the Court that is not Disgraced or Royalty. Exchange a card from
 * your hand with the chosen card."
 *
 * Scenarios:
 *   1. Use ability, swap: Court has Inquisitor face-up. Play Sentry →
 *      proceed → Sentry disgraced → choose Inquisitor from court → choose
 *      hand card → Inquisitor in hand, hand card in court.
 *   2. Skip ability: Play Sentry → pass → Sentry stays face-up, no swap.
 */

import { describe, it, expect } from "vitest";

import {
  createDeck,
  dealWithDeck,
  regulationDeck,
  legalActions,
  apply,
  applySafe,
  playerZones,
  type IKState,
} from "../index.js";

const chooseEffect = (state: IKState, idx: number): IKState => {
  const result = applySafe(state, { kind: "effect_choice", choice: idx });
  if (!result.ok) throw new Error(`effect_choice(${idx}) failed: ${JSON.stringify(result.error)}`);
  return result.value;
};

/**
 * Builds a 2-player game with deterministic hands:
 *   P0 hand (after setup): Sentry, Elder, Zealot, Inquisitor, Soldier
 *   P1 hand (after setup): Judge, Oathbound, Oathbound, Immortal, Warlord
 *
 * If withCourt is true, takes Inquisitor from P1's hand and places it face-up
 * in court so Sentry has something to swap with.
 */
const setupSentryGame = (withCourt: boolean): IKState => {
  const kinds = regulationDeck(2);
  const deck = createDeck(kinds);

  const sentry = deck.find((c) => c.kind.name === "Sentry")!;
  const inquisitors = deck.filter((c) => c.kind.name === "Inquisitor");
  const elders = deck.filter((c) => c.kind.name === "Elder");
  const zealot = deck.find((c) => c.kind.name === "Zealot")!;
  const soldiers = deck.filter((c) => c.kind.name === "Soldier");
  const judge = deck.find((c) => c.kind.name === "Judge")!;
  const oathbounds = deck.filter((c) => c.kind.name === "Oathbound");
  const immortal = deck.find((c) => c.kind.name === "Immortal")!;
  const warlord = deck.find((c) => c.kind.name === "Warlord")!;
  const fool = deck.find((c) => c.kind.name === "Fool")!;
  const assassin = deck.find((c) => c.kind.name === "Assassin")!;

  const customDeck: typeof deck[number][] = [];
  const p0Cards = [
    fool,
    assassin,
    sentry,
    elders[0]!,
    zealot,
    inquisitors[0]!,
    soldiers[0]!,
  ];
  const p1Cards = [
    elders[1]!,
    judge,
    inquisitors[1]!,
    oathbounds[0]!,
    oathbounds[1]!,
    immortal,
    warlord,
  ];
  for (let i = 0; i < 7; i++) {
    customDeck.push(p0Cards[i]!);
    customDeck.push(p1Cards[i]!);
  }
  customDeck.push(deck.find((c) => c.kind.name === "Mystic")!);
  customDeck.push(deck.find((c) => c.kind.name === "Warden")!);

  let state = dealWithDeck(customDeck, 2, 0);
  state = apply(state, { kind: "crown", firstPlayer: 0 });
  const setup1 = legalActions(state).find((a) => a.kind === "commit")!;
  state = apply(state, setup1);
  const setup2 = legalActions(state).find((a) => a.kind === "commit")!;
  state = apply(state, setup2);

  if (withCourt) {
    const inqForCourt = playerZones(state, 1).hand.find(
      (c) => c.kind.name === "Inquisitor",
    )!;
    state = {
      ...state,
      players: state.players.map((p, i) =>
        i === 1 ? { ...p, hand: p.hand.filter((c) => c.id !== inqForCourt.id) } : p,
      ),
      shared: {
        ...state.shared,
        court: [
          {
            card: inqForCourt,
            face: "up" as const,
            playedBy: 1 as const,
          },
        ],
      },
    };
  }

  return state;
};

describe("Sentry card effect", () => {
  it("use ability, swap: Inquisitor to hand, hand card to court", () => {
    let state = setupSentryGame(true);
    expect(state.phase).toBe("play");
    expect(state.activePlayer).toBe(0);
    expect(state.shared.court).toHaveLength(1);
    expect(state.shared.court[0]!.card.kind.name).toBe("Inquisitor");
    expect(state.shared.court[0]!.face).toBe("up");

    const sentry = playerZones(state, 0).hand.find((c) => c.kind.name === "Sentry")!;
    const inqInCourt = state.shared.court[0]!.card;
    const p0HandCard = playerZones(state, 0).hand.find(
      (c) => c.kind.name === "Elder",
    )!;

    state = apply(state, { kind: "play", cardId: sentry.id });

    // --- optional: proceed ---
    expect(state.phase).toBe("resolving");
    let opts = state.pendingResolution!.currentOptions;
    state = chooseEffect(state, opts.findIndex((o) => o.kind === "proceed"));

    // --- disgrace(played) runs, then chooseCard from court (notDisgracedOrRoyalty) ---
    expect(state.phase).toBe("resolving");
    opts = state.pendingResolution!.currentOptions;
    expect(opts.every((o) => o.kind === "card")).toBe(true);
    const courtCardIdx = opts.findIndex(
      (o) => o.kind === "card" && (o as { kind: "card"; cardId: number }).cardId === inqInCourt.id,
    );
    expect(courtCardIdx).not.toBe(-1);
    state = chooseEffect(state, courtCardIdx);

    // --- chooseCard from hand ---
    expect(state.phase).toBe("resolving");
    opts = state.pendingResolution!.currentOptions;
    expect(opts.every((o) => o.kind === "card")).toBe(true);
    const handCardIdx = opts.findIndex(
      (o) => o.kind === "card" && (o as { kind: "card"; cardId: number }).cardId === p0HandCard.id,
    );
    expect(handCardIdx).not.toBe(-1);
    state = chooseEffect(state, handCardIdx);

    // --- done -> endOfTurn -> P1's turn ---
    expect(state.phase).toBe("play");
    expect(state.activePlayer).toBe(1);

    expect(playerZones(state, 0).hand.some((c) => c.id === inqInCourt.id)).toBe(true);
    expect(state.shared.court.some((e) => e.card.id === p0HandCard.id)).toBe(true);
    expect(state.shared.court.some((e) => e.card.id === sentry.id)).toBe(true);
    const sentryEntry = state.shared.court.find((e) => e.card.id === sentry.id)!;
    expect(sentryEntry.face).toBe("down");

    console.log(
      "  Use ability: Inquisitor moved to P0 hand, Elder moved to court; Sentry disgraced",
    );
  });

  it("skip ability: Sentry stays face-up, no swap", () => {
    let state = setupSentryGame(true);

    const sentry = playerZones(state, 0).hand.find((c) => c.kind.name === "Sentry")!;
    const inqInCourt = state.shared.court[0]!.card;
    const p0HandIdsBefore = playerZones(state, 0).hand
      .filter((c) => c.id !== sentry.id)
      .map((c) => c.id)
      .sort();

    state = apply(state, { kind: "play", cardId: sentry.id });

    // --- optional: pass ---
    expect(state.phase).toBe("resolving");
    const opts = state.pendingResolution!.currentOptions;
    state = chooseEffect(state, opts.findIndex((o) => o.kind === "pass"));

    expect(state.phase).toBe("play");
    expect(state.activePlayer).toBe(1);

    const sentryEntry = state.shared.court.find((e) => e.card.id === sentry.id)!;
    expect(sentryEntry.face).toBe("up");
    expect(state.shared.court.some((e) => e.card.id === inqInCourt.id)).toBe(true);
    expect(playerZones(state, 0).hand.every((c) => c.id !== inqInCourt.id)).toBe(true);
    expect(playerZones(state, 0).hand.map((c) => c.id).sort()).toEqual(p0HandIdsBefore);

    console.log("  Skip ability: Sentry face-up, no swap");
  });
});
