/**
 * Seeded deterministic tests for the Executioner card effect.
 *
 * Executioner (value 4, 3p-only): "You may say any number equal to or less
 * than the highest base value card in Court. All players must Condemn a card
 * in their hand with that base value."
 *
 * Scenarios:
 *   1. Use ability, condemn cards: Court has face-up Elder (value 3). Play
 *      Executioner → proceed → choose value 3 → P0 condemns Elder from hand →
 *      P1 condemns a card with value 3 if they have one → verify condemned.
 *   2. Skip ability: Play Executioner → pass → no condemn, turn advances.
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
 * Builds a 2-player game using regulationDeck(3) to include Executioner.
 *   P0 hand (after setup): Executioner, Elder, Elder, Inquisitor, Soldier
 *   P1 hand (after setup): Zealot, Judge, Oathbound, Oathbound, Immortal
 *
 * Court seed: takes Elder from P0's hand, places face-up to establish max
 * value 3 for nameValueUpToCourtMax.
 *
 * Use bothCondemn=true so P1 has Zealot (value 3) and both players condemn.
 */
const setupExecutionerGame = (withCourt: boolean, bothCondemn = false): IKState => {
  const kinds = regulationDeck(3);
  const deck = createDeck(kinds);

  const executioner = deck.find((c) => c.kind.name === "Executioner")!;
  const elders = deck.filter((c) => c.kind.name === "Elder");
  const zealot = deck.find((c) => c.kind.name === "Zealot")!;
  const inquisitors = deck.filter((c) => c.kind.name === "Inquisitor");
  const soldiers = deck.filter((c) => c.kind.name === "Soldier");
  const judge = deck.find((c) => c.kind.name === "Judge")!;
  const oathbounds = deck.filter((c) => c.kind.name === "Oathbound");
  const immortal = deck.find((c) => c.kind.name === "Immortal")!;
  const fool = deck.find((c) => c.kind.name === "Fool")!;
  const assassin = deck.find((c) => c.kind.name === "Assassin")!;

  const warlord = deck.find((c) => c.kind.name === "Warlord")!;
  const mystic = deck.find((c) => c.kind.name === "Mystic")!;
  const warden = deck.find((c) => c.kind.name === "Warden")!;

  const customDeck: typeof deck[number][] = [];
  const p0Cards = bothCondemn
    ? [fool, assassin, executioner, elders[0]!, elders[1]!, inquisitors[0]!, soldiers[0]!]
    : [fool, assassin, executioner, elders[0]!, elders[1]!, zealot, inquisitors[0]!];
  const p1Cards = bothCondemn
    ? [judge, oathbounds[0]!, zealot, oathbounds[1]!, immortal, warlord, mystic]
    : [soldiers[0]!, judge, oathbounds[0]!, oathbounds[1]!, immortal, warlord, mystic];
  for (let i = 0; i < 7; i++) {
    customDeck.push(p0Cards[i]!);
    customDeck.push(p1Cards[i]!);
  }
  customDeck.push(soldiers[1]!);
  customDeck.push(warden);

  let state = dealWithDeck(customDeck, 2, 0);
  state = apply(state, { kind: "crown", firstPlayer: 0 });
  const setup1 = legalActions(state).find((a) => a.kind === "commit")!;
  state = apply(state, setup1);
  const setup2 = legalActions(state).find((a) => a.kind === "commit")!;
  state = apply(state, setup2);

  if (withCourt) {
    const elderForCourt = playerZones(state, 0).hand.find(
      (c) => c.kind.name === "Elder",
    )!;
    state = {
      ...state,
      players: state.players.map((p, i) =>
        i === 0 ? { ...p, hand: p.hand.filter((c) => c.id !== elderForCourt.id) } : p,
      ),
      shared: {
        ...state.shared,
        court: [
          {
            card: elderForCourt,
            face: "up" as const,
            playedBy: 0 as const,
          },
        ],
      },
    };
  }

  return state;
};

describe("Executioner card effect", () => {
  it("use ability, condemn cards: court has Elder, all condemn value-3 cards", () => {
    let state = setupExecutionerGame(true);
    expect(state.phase).toBe("play");
    expect(state.activePlayer).toBe(0);
    expect(state.shared.court).toHaveLength(1);
    expect(state.shared.court[0]!.card.kind.props.value).toBe(3);
    expect(state.shared.court[0]!.face).toBe("up");

    const executioner = playerZones(state, 0).hand.find(
      (c) => c.kind.name === "Executioner",
    )!;
    const p0Elder = playerZones(state, 0).hand.find(
      (c) => c.kind.name === "Elder",
    )!;
    state = apply(state, { kind: "play", cardId: executioner.id });

    // --- optional: proceed ---
    expect(state.phase).toBe("resolving");
    let opts = state.pendingResolution!.currentOptions;
    state = chooseEffect(state, opts.findIndex((o) => o.kind === "proceed"));

    // --- nameValueUpToCourtMax: choose value 3 ---
    expect(state.phase).toBe("resolving");
    opts = state.pendingResolution!.currentOptions;
    expect(opts.every((o) => o.kind === "value")).toBe(true);
    const val3Idx = opts.findIndex(
      (o) => o.kind === "value" && (o as { kind: "value"; value: number }).value === 3,
    );
    expect(val3Idx).not.toBe(-1);
    state = chooseEffect(state, val3Idx);

    // --- P0 chooseCard: condemn Elder from hand ---
    expect(state.phase).toBe("resolving");
    opts = state.pendingResolution!.currentOptions;
    expect(opts.every((o) => o.kind === "card")).toBe(true);
    const p0CondemnIdx = opts.findIndex(
      (o) => o.kind === "card" && (o as { kind: "card"; cardId: number }).cardId === p0Elder.id,
    );
    expect(p0CondemnIdx).not.toBe(-1);
    state = chooseEffect(state, p0CondemnIdx);

    // --- P1 has no value-3 card; forEachOpponent's chooseCard skips (done) ---

    // --- done -> endOfTurn -> P1's turn ---
    expect(state.phase).toBe("play");
    expect(state.activePlayer).toBe(1);

    expect(state.shared.condemned.length).toBeGreaterThanOrEqual(1);
    expect(state.shared.condemned.every((e) => e.face === "up")).toBe(true);
    expect(state.shared.condemned.some((e) => e.card.id === p0Elder.id)).toBe(true);
    expect(playerZones(state, 0).hand.every((c) => c.id !== p0Elder.id)).toBe(true);

    console.log(
      "  Use ability: P0 condemned Elder; cards in condemned zone face-up",
    );
  });

  it("use ability, both players condemn when both have value-3 cards", () => {
    let state = setupExecutionerGame(true, true);
    expect(state.phase).toBe("play");
    expect(state.activePlayer).toBe(0);
    expect(state.shared.court).toHaveLength(1);
    expect(state.shared.court[0]!.card.kind.props.value).toBe(3);

    const executioner = playerZones(state, 0).hand.find(
      (c) => c.kind.name === "Executioner",
    )!;
    const p0Elder = playerZones(state, 0).hand.find(
      (c) => c.kind.name === "Elder",
    )!;
    const p1Zealot = playerZones(state, 1).hand.find(
      (c) => c.kind.name === "Zealot",
    )!;
    state = apply(state, { kind: "play", cardId: executioner.id });

    state = chooseEffect(state, state.pendingResolution!.currentOptions.findIndex((o) => o.kind === "proceed"));

    const val3Idx = state.pendingResolution!.currentOptions.findIndex(
      (o) => o.kind === "value" && (o as { kind: "value"; value: number }).value === 3,
    );
    expect(val3Idx).not.toBe(-1);
    state = chooseEffect(state, val3Idx);

    const p0CondemnIdx = state.pendingResolution!.currentOptions.findIndex(
      (o) => o.kind === "card" && (o as { kind: "card"; cardId: number }).cardId === p0Elder.id,
    );
    expect(p0CondemnIdx).not.toBe(-1);
    state = chooseEffect(state, p0CondemnIdx);

    const p1CondemnIdx = state.pendingResolution!.currentOptions.findIndex(
      (o) => o.kind === "card" && (o as { kind: "card"; cardId: number }).cardId === p1Zealot.id,
    );
    expect(p1CondemnIdx).not.toBe(-1);
    state = chooseEffect(state, p1CondemnIdx);

    expect(state.phase).toBe("play");
    expect(state.activePlayer).toBe(1);
    expect(state.shared.condemned).toHaveLength(2);
    expect(state.shared.condemned.every((e) => e.face === "up")).toBe(true);
    expect(state.shared.condemned.some((e) => e.card.id === p0Elder.id)).toBe(true);
    expect(state.shared.condemned.some((e) => e.card.id === p1Zealot.id)).toBe(true);

    console.log(
      "  Use ability: P0 condemned Elder, P1 condemned Zealot; both in condemned zone face-up",
    );
  });

  it("skip ability: no condemn, turn advances", () => {
    let state = setupExecutionerGame(true);

    const executioner = playerZones(state, 0).hand.find(
      (c) => c.kind.name === "Executioner",
    )!;
    const condemnedBefore = state.shared.condemned.length;

    state = apply(state, { kind: "play", cardId: executioner.id });

    // --- optional: pass ---
    expect(state.phase).toBe("resolving");
    const opts = state.pendingResolution!.currentOptions;
    state = chooseEffect(state, opts.findIndex((o) => o.kind === "pass"));

    expect(state.phase).toBe("play");
    expect(state.activePlayer).toBe(1);
    expect(state.shared.condemned).toHaveLength(condemnedBefore);

    console.log("  Skip ability: no condemn, turn advanced");
  });
});
