/**
 * Seeded deterministic tests for the Stranger card copy mechanics.
 *
 * Stranger (value 2, immune_to_kings_hand):
 *   On play: Optional — choose a non-disgraced Court card to copy. Stranger
 *   adopts that card's name and executes its onPlay effect. The copied card
 *   is removed from the round.
 *   In hand: Can copy any Reaction card in Court (not on Throne) to use as a
 *   reaction.
 *
 * Scenarios:
 *   1. On-play copy basic: Stranger copies Inquisitor -> copiedName set,
 *      Inquisitor removed, Inquisitor's nameCard effect triggers.
 *   2. On-play skip copy: Stranger played, pass -> no copied name, no removal.
 *   3. Stranger copies Assassin reaction: P0 disgraces, P1 reacts with Stranger
 *      (copying Assassin) -> Stranger to P1's parting zone, P0 forced to lose.
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
  type IKState,
  type IKCard,
} from "../index.js";

const chooseEffect = (state: IKState, idx: number): IKState => {
  const result = applySafe(state, { kind: "effect_choice", choice: idx });
  if (!result.ok) throw new Error(`effect_choice(${idx}) failed: ${JSON.stringify(result.error)}`);
  return result.value;
};

/**
 * Builds a 2-player game with Stranger in P0's hand and [Zealot, Inquisitor] in
 * court. Zealot (value 2) on throne so Stranger (value 2) can play.
 */
const setupStrangerCopyGame = (): IKState => {
  const kinds = regulationDeck(2);
  const deck = createDeck(kinds);

  const assassin = deck.find((c) => c.kind.name === "Assassin")!;
  const inquisitor = deck.find((c) => c.kind.name === "Inquisitor")!;
  const strangerKind = SIGNATURE_CARD_KINDS.find((k) => k.name === "Stranger")!;
  const strangerCard: IKCard = { id: 900, kind: strangerKind };

  const otherCards = deck.filter((c) => c.id !== assassin.id && c.id !== inquisitor.id);
  const customDeck: typeof deck[number][] = [];
  const p0Cards = [otherCards[0]!, otherCards[1]!, strangerCard, otherCards[2]!, otherCards[3]!, otherCards[4]!, otherCards[5]!];
  const p1Cards = [otherCards[6]!, otherCards[7]!, otherCards[8]!, otherCards[9]!, otherCards[10]!, otherCards[11]!, otherCards[12]!];
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

  // Court: [Inquisitor, Assassin] — Assassin on throne (value 2), Stranger can play
  state = {
    ...state,
    players: state.players.map((p, i) => {
      if (i === 0) return { ...p, hand: p.hand.filter((c) => c.id !== assassin.id && c.id !== inquisitor.id) };
      return p;
    }),
    shared: {
      ...state.shared,
      court: [
        { card: inquisitor, face: "up" as const, playedBy: 0 as const },
        { card: assassin, face: "up" as const, playedBy: 0 as const },
      ],
    },
  };

  return state;
};

describe("Stranger card effect", () => {
  it("on-play copy basic: Stranger copies Inquisitor, copiedName set, Inquisitor removed, nameCard triggers", () => {
    let state = setupStrangerCopyGame();
    expect(state.phase).toBe("play");
    expect(state.activePlayer).toBe(0);

    const stranger = playerZones(state, 0).hand.find((c) => c.kind.name === "Stranger")!;
    const inquisitor = state.shared.court.find((e) => e.card.kind.name === "Inquisitor")!.card;

    state = apply(state, { kind: "play", cardId: stranger.id });

    // optional: proceed (choice 1)
    expect(state.phase).toBe("resolving");
    let opts = state.pendingResolution!.currentOptions;
    state = chooseEffect(state, opts.findIndex((o) => o.kind === "proceed"));

    // chooseCard: select Inquisitor
    expect(state.phase).toBe("resolving");
    opts = state.pendingResolution!.currentOptions;
    const inquisitorIdx = opts.findIndex(
      (o) => o.kind === "card" && (o as { kind: "card"; cardId: number }).cardId === inquisitor.id,
    );
    expect(inquisitorIdx).not.toBe(-1);
    state = chooseEffect(state, inquisitorIdx);

    // Inquisitor's onPlay is optional: proceed to use nameCard
    expect(state.phase).toBe("resolving");
    opts = state.pendingResolution!.currentOptions;
    state = chooseEffect(state, opts.findIndex((o) => o.kind === "proceed"));

    // nameCard: choose card name
    expect(state.phase).toBe("resolving");
    opts = state.pendingResolution!.currentOptions;
    expect(opts.some((o) => o.kind === "cardName")).toBe(true);
    const elderIdx = opts.findIndex((o) => o.kind === "cardName" && o.name === "Elder");
    expect(elderIdx).not.toBe(-1);
    state = chooseEffect(state, elderIdx);

    // done -> endOfTurn
    expect(state.phase).toBe("play");
    expect(state.activePlayer).toBe(1);

    const strangerEntry = state.shared.court.find((e) => e.card.kind.name === "Stranger");
    expect(strangerEntry).toBeDefined();
    expect(strangerEntry!.copiedName).toBe("Inquisitor");

    expect(state.shared.court.some((e) => e.card.id === inquisitor.id)).toBe(false);
    expect(state.shared.court.some((e) => e.card.kind.name === "Inquisitor")).toBe(false);
  });

  it("on-play skip copy: Stranger enters court with no copied name, no card removed", () => {
    let state = setupStrangerCopyGame();
    const stranger = playerZones(state, 0).hand.find((c) => c.kind.name === "Stranger")!;
    const inquisitor = state.shared.court.find((e) => e.card.kind.name === "Inquisitor")!.card;

    state = apply(state, { kind: "play", cardId: stranger.id });

    // optional: pass (choice 0)
    expect(state.phase).toBe("resolving");
    const opts = state.pendingResolution!.currentOptions;
    state = chooseEffect(state, opts.findIndex((o) => o.kind === "pass"));

    expect(state.phase).toBe("play");
    expect(state.activePlayer).toBe(1);

    const strangerEntry = state.shared.court.find((e) => e.card.kind.name === "Stranger");
    expect(strangerEntry).toBeDefined();
    expect(strangerEntry!.copiedName).toBeUndefined();

    expect(state.shared.court.some((e) => e.card.id === inquisitor.id)).toBe(true);
  });

  it("Stranger copies Assassin reaction: P0 disgraces, P1 reacts with Stranger, P0 forced to lose", () => {
    const kinds = regulationDeck(2);
    const deck = createDeck(kinds);

    const assassin = deck.find((c) => c.kind.name === "Assassin")!;
    const strangerKind = SIGNATURE_CARD_KINDS.find((k) => k.name === "Stranger")!;
    const strangerCard: IKCard = { id: 900, kind: strangerKind };

    const otherCards = deck.filter((c) => c.id !== assassin.id);
    const customDeck: typeof deck[number][] = [];
    const p0Cards = [otherCards[0]!, otherCards[1]!, otherCards[2]!, otherCards[3]!, otherCards[4]!, otherCards[5]!, otherCards[6]!];
    const p1Cards = [otherCards[7]!, otherCards[8]!, strangerCard, otherCards[9]!, otherCards[10]!, otherCards[11]!, otherCards[12]!];
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

    // Court: [Assassin, SomeCard] so Assassin is face-up but not on throne
    const throneCard = otherCards[14]!;
    state = {
      ...state,
      players: state.players.map((p, i) => {
        if (i === 0) return { ...p, hand: p.hand.filter((c) => c.id !== throneCard.id) };
        if (i === 1) return { ...p, hand: p.hand.filter((c) => c.id !== assassin.id) };
        return p;
      }),
      shared: {
        ...state.shared,
        court: [
          { card: assassin, face: "up" as const, playedBy: 1 as const },
          { card: throneCard, face: "up" as const, playedBy: 0 as const },
        ],
      },
    };

    expect(state.phase).toBe("play");
    expect(state.activePlayer).toBe(0);
    expect(playerZones(state, 0).king.face).toBe("up");
    expect(playerZones(state, 1).hand.some((c) => c.kind.name === "Stranger")).toBe(true);

    const disgraceAction = legalActions(state).find((a) => a.kind === "disgrace");
    expect(disgraceAction).toBeDefined();
    state = apply(state, disgraceAction!);

    // king_flip reaction: P1 may react with Stranger (copying Assassin)
    expect(state.phase).toBe("resolving");
    let opts = state.pendingResolution!.currentOptions;
    expect(opts.every((o) => o.kind === "pass" || o.kind === "proceed")).toBe(true);
    state = chooseEffect(state, opts.findIndex((o) => o.kind === "proceed"));

    // Resolution done: P0 forced to lose
    expect(state.phase).toBe("play");
    expect(state.forcedLoser).toBe(0);

    expect(playerZones(state, 1).hand.some((c) => c.kind.name === "Stranger")).toBe(false);
    expect(playerZones(state, 1).parting.some((c) => c.kind.name === "Stranger")).toBe(true);
  });
});
