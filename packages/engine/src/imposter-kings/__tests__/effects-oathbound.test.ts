/**
 * Seeded deterministic tests for the Oathbound card effect.
 *
 * Oathbound: "You may play this on a higher value card to Disgrace that card,
 * then you must play another card of any value. That card is Immune to
 * King's Hand."
 *
 * Scenarios:
 *   1. Override play, simple follow-up: Oathbound on Warlord (val 7 > 6) ->
 *      Warlord disgraced -> choose Zealot -> Zealot in court (no effect).
 *   2. Override play, effect-bearing follow-up: choose Fool -> Fool's onPlay
 *      fires (optional chooseCard from court) -> resolving phase entered.
 *   3. Normal play: empty court, Oathbound plays normally -> no disgrace, no
 *      forced play, turn advances.
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
  type IKPlayCardAction,
} from "../index.js";

const chooseEffect = (state: IKState, idx: number): IKState => {
  const result = applySafe(state, { kind: "effect_choice", choice: idx });
  if (!result.ok) throw new Error(`effect_choice(${idx}) failed: ${JSON.stringify(result.error)}`);
  return result.value;
};

/**
 * Builds a 2-player game with deterministic hands:
 *   P0 hand (after setup): Oathbound, Fool, Zealot, Inquisitor, Assassin
 *   P1 hand (after setup): Warlord, Soldier, Judge, Immortal, Mystic
 *
 * If withCourt is true, takes Warlord from P1 (face-up, value 7) and
 * places it in court so Oathbound (value 6) can only play via onHigherValue
 * override.
 */
const setupOathboundGame = (withCourt: boolean): IKState => {
  const kinds = regulationDeck(2);
  const deck = createDeck(kinds);

  const oathboundCards = deck.filter((c) => c.kind.name === "Oathbound");
  const otherCards = deck.filter((c) => c.kind.name !== "Oathbound");

  const customDeck: typeof deck[number][] = [];
  const p0Cards = [
    otherCards[2]!, otherCards[3]!,
    oathboundCards[0]!, otherCards[0]!, otherCards[4]!, otherCards[5]!, otherCards[1]!,
  ];
  const p1Cards = [
    otherCards[6]!, otherCards[7]!,
    otherCards[11]!, otherCards[8]!, otherCards[9]!, otherCards[10]!, otherCards[12]!,
  ];
  for (let i = 0; i < 7; i++) {
    customDeck.push(p0Cards[i]!);
    customDeck.push(p1Cards[i]!);
  }
  customDeck.push(otherCards[13]!);
  customDeck.push(otherCards[14]!);

  let state = dealWithDeck(customDeck, 2, 0);
  state = apply(state, { kind: "crown", firstPlayer: 0 });
  const setup1 = legalActions(state).find((a) => a.kind === "commit")!;
  state = apply(state, setup1);
  const setup2 = legalActions(state).find((a) => a.kind === "commit")!;
  state = apply(state, setup2);

  if (withCourt) {
    const warlord = playerZones(state, 1).hand.find((c) => c.kind.name === "Warlord")!;
    state = {
      ...state,
      players: state.players.map((p, i) =>
        i === 1 ? { ...p, hand: p.hand.filter((c) => c.id !== warlord.id) } : p,
      ),
      shared: {
        ...state.shared,
        court: [{ card: warlord, face: "up" as const, playedBy: 1 as const }],
      },
    };
  }

  return state;
};

describe("Oathbound card effect", () => {
  it("override play, simple follow-up: Warlord disgraced, Zealot placed in court", () => {
    let state = setupOathboundGame(true);
    expect(state.phase).toBe("play");
    expect(state.activePlayer).toBe(0);

    const oathbound = playerZones(state, 0).hand.find((c) => c.kind.name === "Oathbound")!;
    const legal = legalActions(state);
    const oathboundPlay = legal.find(
      (a): a is IKPlayCardAction => a.kind === "play" && a.cardId === oathbound.id,
    );
    expect(oathboundPlay).toBeDefined();

    state = apply(state, { kind: "play", cardId: oathbound.id });

    // --- forced chooseCard from hand (disgrace already happened silently in seq) ---
    expect(state.phase).toBe("resolving");
    let opts = state.pendingResolution!.currentOptions;
    expect(opts.every((o) => o.kind === "card")).toBe(true);

    const zealotIdx = opts.findIndex(
      (o) => o.kind === "card" && playerZones(state, 0).hand.some(
        (c) => c.id === (o as { kind: "card"; cardId: number }).cardId && c.kind.name === "Zealot",
      ),
    );
    expect(zealotIdx).not.toBe(-1);
    state = chooseEffect(state, zealotIdx);

    // --- forcePlay: Zealot has no onPlay -> done -> endOfTurn -> P1's turn ---
    expect(state.phase).toBe("play");
    expect(state.activePlayer).toBe(1);

    const warlordEntry = state.shared.court.find((e) => e.card.kind.name === "Warlord")!;
    expect(warlordEntry.face).toBe("down");

    expect(state.shared.court.some((e) => e.card.kind.name === "Oathbound" && e.face === "up")).toBe(true);
    expect(state.shared.court.some((e) => e.card.kind.name === "Zealot" && e.face === "up")).toBe(true);
    expect(state.shared.court).toHaveLength(3);

    console.log("  Override play (simple): Warlord disgraced, Zealot force-played");
  });

  it("override play, effect-bearing follow-up: Fool's onPlay fires", () => {
    let state = setupOathboundGame(true);

    const oathbound = playerZones(state, 0).hand.find((c) => c.kind.name === "Oathbound")!;
    state = apply(state, { kind: "play", cardId: oathbound.id });

    // --- choose Fool for forced play ---
    let opts = state.pendingResolution!.currentOptions;
    const foolIdx = opts.findIndex(
      (o) => o.kind === "card" && playerZones(state, 0).hand.some(
        (c) => c.id === (o as { kind: "card"; cardId: number }).cardId && c.kind.name === "Fool",
      ),
    );
    expect(foolIdx).not.toBe(-1);
    state = chooseEffect(state, foolIdx);

    // --- Fool's onPlay effect fires: optional pass/proceed ---
    expect(state.phase).toBe("resolving");
    opts = state.pendingResolution!.currentOptions;
    expect(opts.some((o) => o.kind === "pass")).toBe(true);
    expect(opts.some((o) => o.kind === "proceed")).toBe(true);

    state = chooseEffect(state, opts.findIndex((o) => o.kind === "pass"));

    // --- done -> endOfTurn -> P1's turn ---
    expect(state.phase).toBe("play");
    expect(state.activePlayer).toBe(1);

    expect(state.shared.court.some((e) => e.card.kind.name === "Fool" && e.face === "up")).toBe(true);
    expect(state.shared.court.find((e) => e.card.kind.name === "Warlord")!.face).toBe("down");

    console.log("  Override play (Fool skip): Fool's onPlay effect fired, skipped");
  });

  it("override play, Fool picks up Oathbound: full nested resolution", () => {
    let state = setupOathboundGame(true);

    const oathbound = playerZones(state, 0).hand.find((c) => c.kind.name === "Oathbound")!;
    state = apply(state, { kind: "play", cardId: oathbound.id });

    // --- choose Fool for forced play ---
    let opts = state.pendingResolution!.currentOptions;
    const foolIdx = opts.findIndex(
      (o) => o.kind === "card" && playerZones(state, 0).hand.some(
        (c) => c.id === (o as { kind: "card"; cardId: number }).cardId && c.kind.name === "Fool",
      ),
    );
    state = chooseEffect(state, foolIdx);

    // --- Fool's onPlay: proceed to use ability ---
    opts = state.pendingResolution!.currentOptions;
    state = chooseEffect(state, opts.findIndex((o) => o.kind === "proceed"));

    // --- Fool's chooseCard: non-disgraced court cards ---
    expect(state.phase).toBe("resolving");
    opts = state.pendingResolution!.currentOptions;
    expect(opts.every((o) => o.kind === "card")).toBe(true);

    const oathboundIdx = opts.findIndex(
      (o) => o.kind === "card" && (o as { kind: "card"; cardId: number }).cardId === oathbound.id,
    );
    expect(oathboundIdx).not.toBe(-1);
    state = chooseEffect(state, oathboundIdx);

    // --- done -> endOfTurn -> P1's turn ---
    expect(state.phase).toBe("play");
    expect(state.activePlayer).toBe(1);

    expect(playerZones(state, 0).hand.some((c) => c.id === oathbound.id)).toBe(true);
    expect(state.shared.court.every((e) => e.card.id !== oathbound.id)).toBe(true);
    expect(state.shared.court.some((e) => e.card.kind.name === "Fool" && e.face === "up")).toBe(true);
    expect(state.shared.court.find((e) => e.card.kind.name === "Warlord")!.face).toBe("down");

    console.log("  Override play (Fool proceed): Oathbound picked up back to hand");
  });

  it("normal play: no disgrace, no forced play, turn advances", () => {
    let state = setupOathboundGame(false);
    expect(state.shared.court).toHaveLength(0);

    const oathbound = playerZones(state, 0).hand.find((c) => c.kind.name === "Oathbound")!;
    state = apply(state, { kind: "play", cardId: oathbound.id });

    expect(state.phase).toBe("play");
    expect(state.activePlayer).toBe(1);
    expect(state.shared.court).toHaveLength(1);
    expect(state.shared.court[0]!.card.id).toBe(oathbound.id);
    expect(state.shared.court[0]!.face).toBe("up");

    console.log("  Normal play: no effect, turn advanced");
  });
});
