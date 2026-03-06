/**
 * Seeded deterministic tests for the Mystic card effect.
 *
 * Mystic: "If there are any Disgraced cards in Court, you may Disgrace this
 * card after playing it to choose a number between 1-8. Cards of that base
 * value lose their card text and have a value of 3 after being played for
 * this round."
 *
 * Scenarios:
 *   1. Precondition met, use ability: court has disgraced card + face-up
 *      Inquisitor (value 4). Play Mystic -> proceed -> self-disgrace + name
 *      value 4 -> Inquisitor effectiveValue = 3.
 *   2. Precondition not met: empty court, no disgraced cards. Play Mystic ->
 *      effect skips entirely, no resolving phase.
 *   3. Precondition met, skip ability: court has disgraced card. Play Mystic
 *      -> pass -> Mystic stays face-up, no modifiers.
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
  effectiveValue,
  type IKState,
} from "../index.js";
import type { CourtEntry } from "../zones.js";
import type { IKCard } from "../card.js";

const chooseEffect = (state: IKState, idx: number): IKState => {
  const result = applySafe(state, { kind: "effect_choice", choice: idx });
  if (!result.ok) throw new Error(`effect_choice(${idx}) failed: ${JSON.stringify(result.error)}`);
  return result.value;
};

/**
 * Builds a 2-player game with deterministic hands:
 *   P0 hand (after setup): Mystic, Elder, Elder, Zealot, Inquisitor
 *   P1 hand (after setup): Soldier, Judge, Oathbound, Oathbound, Immortal
 *
 * If withCourt is true, takes Inquisitor from P0 (face-up) and Soldier
 * from P1 (face-down) and places them in court to satisfy the
 * courtHasDisgraced precondition.
 */
const setupMysticGame = (withCourt: boolean): IKState => {
  const kinds = regulationDeck(2);
  const deck = createDeck(kinds);

  const mysticCards = deck.filter((c) => c.kind.name === "Mystic");
  const otherCards = deck.filter((c) => c.kind.name !== "Mystic");

  const customDeck: typeof deck[number][] = [];
  const p0Cards = [
    otherCards[0]!, otherCards[1]!,
    mysticCards[0]!, otherCards[2]!, otherCards[3]!, otherCards[4]!, otherCards[5]!,
  ];
  const p1Cards = [
    otherCards[6]!, otherCards[7]!,
    otherCards[8]!, otherCards[9]!, otherCards[10]!, otherCards[11]!, otherCards[12]!,
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
    const inqCard = playerZones(state, 0).hand.find((c) => c.kind.name === "Inquisitor")!;
    const soldierCard = playerZones(state, 1).hand.find((c) => c.kind.name === "Soldier")!;
    state = {
      ...state,
      players: state.players.map((p, i) => {
        if (i === 0) return { ...p, hand: p.hand.filter((c) => c.id !== inqCard.id) };
        if (i === 1) return { ...p, hand: p.hand.filter((c) => c.id !== soldierCard.id) };
        return p;
      }),
      shared: {
        ...state.shared,
        court: [
          { card: inqCard, face: "up" as const, playedBy: 0 as const },
          { card: soldierCard, face: "down" as const, playedBy: 1 as const },
        ],
      },
    };
  }

  return state;
};

describe("Mystic card effect", () => {
  it("precondition met, use ability: mutes cards of chosen base value", () => {
    let state = setupMysticGame(true);
    expect(state.phase).toBe("play");
    expect(state.activePlayer).toBe(0);
    expect(state.shared.court.some((e) => e.face === "down")).toBe(true);

    const mysticCard = playerZones(state, 0).hand.find((c) => c.kind.name === "Mystic")!;
    const inqEntry = state.shared.court.find((e) => e.card.kind.name === "Inquisitor")!;
    expect(effectiveValue(state, inqEntry.card)).toBe(4);

    state = apply(state, { kind: "play", cardId: mysticCard.id });

    // --- optional: pass/proceed (courtHasDisgraced succeeded) ---
    expect(state.phase).toBe("resolving");
    let opts = state.pendingResolution!.currentOptions;
    const proceedIdx = opts.findIndex((o) => o.kind === "proceed");
    expect(proceedIdx).not.toBe(-1);
    state = chooseEffect(state, proceedIdx);

    // --- seq ran disgrace(played) silently, now nameValue(1,8) ---
    expect(state.phase).toBe("resolving");
    opts = state.pendingResolution!.currentOptions;
    expect(opts.every((o) => o.kind === "value")).toBe(true);
    expect(opts).toHaveLength(8);
    const val4Idx = opts.findIndex(
      (o) => o.kind === "value" && o.value === 4,
    );
    expect(val4Idx).not.toBe(-1);
    state = chooseEffect(state, val4Idx);

    // --- done -> end-of-turn -> P1's turn ---
    expect(state.phase).toBe("play");
    expect(state.activePlayer).toBe(1);

    const mysticEntry = state.shared.court.find((e) => e.card.id === mysticCard.id)!;
    expect(mysticEntry.face).toBe("down");

    expect(state.roundModifiers).toHaveLength(1);

    const inqInCourt = state.shared.court.find(
      (e) => e.card.kind.name === "Inquisitor",
    )!;
    expect(effectiveValue(state, inqInCourt.card)).toBe(3);

    console.log("  Precondition met, use ability: Inquisitor muted to value 3");
  });

  it("precondition not met: effect skips entirely, no resolving phase", () => {
    let state = setupMysticGame(false);
    expect(state.shared.court).toHaveLength(0);

    const mysticCard = playerZones(state, 0).hand.find((c) => c.kind.name === "Mystic")!;
    state = apply(state, { kind: "play", cardId: mysticCard.id });

    expect(state.phase).toBe("play");
    expect(state.activePlayer).toBe(1);

    const mysticEntry = state.shared.court.find((e) => e.card.id === mysticCard.id)!;
    expect(mysticEntry.face).toBe("up");
    expect(state.roundModifiers).toHaveLength(0);

    console.log("  Precondition not met: effect skipped, Mystic face-up");
  });

  it("precondition met, skip ability: Mystic stays face-up, no modifiers", () => {
    let state = setupMysticGame(true);
    expect(state.shared.court.some((e) => e.face === "down")).toBe(true);

    const mysticCard = playerZones(state, 0).hand.find((c) => c.kind.name === "Mystic")!;
    state = apply(state, { kind: "play", cardId: mysticCard.id });

    // --- optional: pass ---
    expect(state.phase).toBe("resolving");
    const opts = state.pendingResolution!.currentOptions;
    const passIdx = opts.findIndex((o) => o.kind === "pass");
    expect(passIdx).not.toBe(-1);
    state = chooseEffect(state, passIdx);

    expect(state.phase).toBe("play");
    expect(state.activePlayer).toBe(1);

    const mysticEntry = state.shared.court.find((e) => e.card.id === mysticCard.id)!;
    expect(mysticEntry.face).toBe("up");
    expect(state.roundModifiers).toHaveLength(0);

    console.log("  Precondition met, skip: Mystic face-up, no modifiers");
  });
});
