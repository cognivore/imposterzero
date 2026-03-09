/**
 * Reaction-window information hiding tests.
 *
 * Covers:
 *   1. KH holder reacts to Inquisitor — both cards condemned, effect prevented
 *   2. Hidden KH elsewhere still prompts with pass-only legal actions
 *   3. 3-player priority order — players prompted in turn order after active
 *   4. allKHPubliclyLocated skip — KH in court means no reaction window
 *   5. Assassin king-flip prompts obey the same knowledge rules
 *   6. immune_to_kings_hand — Oathbound's forced-play doesn't trigger window
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
  traceResolution,
  type IKState,
} from "../index.js";
import type { PlayerId } from "@imposter-zero/types";

const chooseEffect = (state: IKState, idx: number): IKState => {
  const result = applySafe(state, { kind: "effect_choice", choice: idx });
  if (!result.ok) throw new Error(`effect_choice(${idx}) failed: ${JSON.stringify(result.error)}`);
  return result.value;
};

const setupTwoPlayerGame = (
  p0CardNames: readonly string[],
  p1CardNames: readonly string[],
): IKState => {
  const kinds = regulationDeck(2);
  const deck = createDeck(kinds);

  const findCards = (names: readonly string[]): typeof deck[number][] => {
    const used = new Set<number>();
    return names.map((name) => {
      const card = deck.find((c) => c.kind.name === name && !used.has(c.id));
      if (!card) throw new Error(`Card ${name} not found in deck`);
      used.add(card.id);
      return card;
    });
  };

  const p0Cards = findCards(p0CardNames);
  const p1Cards = findCards(p1CardNames);

  const usedIds = new Set([...p0Cards.map((c) => c.id), ...p1Cards.map((c) => c.id)]);
  const filler = deck.filter((c) => !usedIds.has(c.id));

  while (p0Cards.length < 7) p0Cards.push(filler.shift()!);
  while (p1Cards.length < 7) p1Cards.push(filler.shift()!);

  const customDeck: typeof deck[number][] = [];
  for (let i = 0; i < 7; i++) {
    customDeck.push(p0Cards[i]!);
    customDeck.push(p1Cards[i]!);
  }
  customDeck.push(filler.shift()!);
  customDeck.push(filler.shift()!);

  let state = dealWithDeck(customDeck, 2, 0);
  state = apply(state, { kind: "crown", firstPlayer: 0 });
  const s1 = legalActions(state).find((a) => a.kind === "commit")!;
  state = apply(state, s1);
  const s2 = legalActions(state).find((a) => a.kind === "commit")!;
  state = apply(state, s2);
  return state;
};

const setupThreePlayerGame = (
  p0CardNames: readonly string[],
  p1CardNames: readonly string[],
  p2CardNames: readonly string[],
): IKState => {
  const kinds = regulationDeck(3);
  const deck = createDeck(kinds);

  const findCards = (names: readonly string[]): typeof deck[number][] => {
    const used = new Set<number>();
    return names.map((name) => {
      const card = deck.find((c) => c.kind.name === name && !used.has(c.id));
      if (!card) throw new Error(`Card ${name} not found in deck`);
      used.add(card.id);
      return card;
    });
  };

  const p0Cards = findCards(p0CardNames);
  const p1Cards = findCards(p1CardNames);
  const p2Cards = findCards(p2CardNames);

  const usedIds = new Set([
    ...p0Cards.map((c) => c.id),
    ...p1Cards.map((c) => c.id),
    ...p2Cards.map((c) => c.id),
  ]);
  const filler = deck.filter((c) => !usedIds.has(c.id));

  while (p0Cards.length < 7) p0Cards.push(filler.shift()!);
  while (p1Cards.length < 7) p1Cards.push(filler.shift()!);
  while (p2Cards.length < 7) p2Cards.push(filler.shift()!);

  const customDeck: typeof deck[number][] = [];
  for (let i = 0; i < 7; i++) {
    customDeck.push(p0Cards[i]!);
    customDeck.push(p1Cards[i]!);
    customDeck.push(p2Cards[i]!);
  }
  customDeck.push(filler.shift()!);
  customDeck.push(filler.shift()!);

  let state = dealWithDeck(customDeck, 3, 0);
  state = apply(state, { kind: "crown", firstPlayer: 0 });
  for (let i = 0; i < 3; i++) {
    const s = legalActions(state).find((a) => a.kind === "commit")!;
    state = apply(state, s);
  }
  return state;
};

const moveHandCardToPublicCondemned = (
  state: IKState,
  player: PlayerId,
  name: string,
): IKState => {
  const card = playerZones(state, player).hand.find((entry) => entry.kind.name === name);
  if (!card) throw new Error(`Missing ${name} in player ${player} hand`);
  return {
    ...state,
    players: state.players.map((zones, idx) =>
      idx === player
        ? { ...zones, hand: zones.hand.filter((entry) => entry.id !== card.id) }
        : zones,
    ),
    shared: {
      ...state.shared,
      condemned: [
        ...state.shared.condemned,
        { card, face: "down" as const, knownBy: [0, 1] as const },
      ],
    },
  };
};

const moveHandCardToCourt = (
  state: IKState,
  player: PlayerId,
  name: string,
): IKState => {
  const card = playerZones(state, player).hand.find((entry) => entry.kind.name === name);
  if (!card) throw new Error(`Missing ${name} in player ${player} hand`);
  return {
    ...state,
    players: state.players.map((zones, idx) =>
      idx === player
        ? { ...zones, hand: zones.hand.filter((entry) => entry.id !== card.id) }
        : zones,
    ),
    shared: {
      ...state.shared,
      court: [{ card, face: "up" as const, playedBy: player }],
    },
  };
};

describe("King's Hand reaction windows", () => {
  it("KH holder reacts to Inquisitor: both cards condemned, effect prevented", () => {
    // P0 hand (after setup): Inquisitor, + fillers
    // P1 hand (after setup): King's Hand, Fool, + fillers
    // KH is in P1's hand → hidden → reaction window fires
    let state = setupTwoPlayerGame(
      ["Elder", "Zealot", "Inquisitor", "Soldier", "Soldier"],
      ["Elder", "Oathbound", "King's Hand", "Fool", "Oathbound"],
    );

    expect(state.phase).toBe("play");
    expect(state.activePlayer).toBe(0);

    const inq = playerZones(state, 0).hand.find((c) => c.kind.name === "Inquisitor")!;
    expect(inq).toBeDefined();
    const kh = playerZones(state, 1).hand.find((c) => c.kind.name === "King's Hand")!;
    expect(kh).toBeDefined();

    // Play Inquisitor
    state = apply(state, { kind: "play", cardId: inq.id });
    expect(state.phase).toBe("resolving");

    // optional: proceed
    let opts = state.pendingResolution!.currentOptions;
    state = chooseEffect(state, opts.findIndex((o) => o.kind === "proceed"));

    // nameCard: name "Fool"
    opts = state.pendingResolution!.currentOptions;
    const foolIdx = opts.findIndex((o) => o.kind === "cardName" && o.name === "Fool");
    state = chooseEffect(state, foolIdx);

    // --- KH REACTION WINDOW ---
    expect(state.phase).toBe("resolving");
    expect(state.pendingResolution!.isReactionWindow).toBe(true);
    expect(state.pendingResolution!.choosingPlayer).toBe(1);
    opts = state.pendingResolution!.currentOptions;
    expect(opts).toHaveLength(2);
    expect(opts[0]!.kind).toBe("pass");
    expect(opts[1]!.kind).toBe("proceed");

    // P1 has KH → both pass and react are legal
    const legal = legalActions(state);
    expect(legal.some((a) => a.kind === "effect_choice" && a.choice === 0)).toBe(true);
    expect(legal.some((a) => a.kind === "effect_choice" && a.choice === 1)).toBe(true);

    // P1 reacts with KH
    state = chooseEffect(state, 1);

    // Parting auto-flushed: both cards go directly to condemned
    expect(playerZones(state, 1).parting).toHaveLength(0);
    expect(playerZones(state, 0).parting).toHaveLength(0);
    expect(state.shared.condemned.some((e) => e.card.id === kh.id)).toBe(true);
    expect(state.shared.condemned.some((e) => e.card.id === inq.id)).toBe(true);

    // Inquisitor no longer in court
    expect(state.shared.court.every((e) => e.card.id !== inq.id)).toBe(true);

    // Effect was prevented — Fool stays in P1's hand (not moved to antechamber)
    expect(playerZones(state, 1).hand.some((c) => c.kind.name === "Fool")).toBe(true);
    expect(playerZones(state, 1).antechamber).toHaveLength(0);

    // P0's turn — parting already flushed, can play normally
    expect(state.phase).toBe("play");
    expect(state.activePlayer).toBe(0);
  });

  it("hidden KH in the active player's hand still prompts the opponent with pass only", () => {
    // P0 hand: Inquisitor, King's Hand, + fillers (P0 holds KH, not P1)
    // P1 hand: Fool, + fillers (no KH)
    // Even though P0 knows where KH is, P1 does not, so the window must still open.
    let state = setupTwoPlayerGame(
      ["Elder", "Zealot", "Inquisitor", "King's Hand", "Soldier"],
      ["Elder", "Oathbound", "Fool", "Oathbound", "Soldier"],
    );

    expect(state.phase).toBe("play");
    const inq = playerZones(state, 0).hand.find((c) => c.kind.name === "Inquisitor")!;

    // Play Inquisitor
    state = apply(state, { kind: "play", cardId: inq.id });

    // optional: proceed
    let opts = state.pendingResolution!.currentOptions;
    state = chooseEffect(state, opts.findIndex((o) => o.kind === "proceed"));

    // nameCard: name "Fool"
    opts = state.pendingResolution!.currentOptions;
    state = chooseEffect(state, opts.findIndex((o) => o.kind === "cardName" && o.name === "Fool"));

    // The prompt must still appear for information hiding.
    expect(state.phase).toBe("resolving");
    expect(state.pendingResolution!.isReactionWindow).toBe(true);
    expect(state.pendingResolution!.choosingPlayer).toBe(1);

    opts = state.pendingResolution!.currentOptions;
    expect(opts).toHaveLength(2);
    expect(opts[0]!.kind).toBe("pass");
    expect(opts[1]!.kind).toBe("proceed");

    const legal = legalActions(state);
    expect(legal).toHaveLength(1);
    expect(legal[0]!).toEqual({ kind: "effect_choice", choice: 0 });

    state = chooseEffect(state, 0);

    // The effect proceeds directly and should still move Fool to P1's antechamber.
    if (state.phase === "resolving" && state.pendingResolution) {
      const cardOpts = state.pendingResolution.currentOptions;
      if (cardOpts.length > 0 && cardOpts[0]!.kind === "card") {
        state = chooseEffect(state, 0);
      }
    }

    // Resolve remaining
    let safety = 0;
    while (state.phase === "resolving" && safety++ < 50) {
      const la = legalActions(state);
      if (la.length === 0) break;
      state = apply(state, la[0]!);
    }

    // Fool should be in P1's antechamber (effect was NOT prevented)
    expect(playerZones(state, 1).antechamber.some((c) => c.kind.name === "Fool")).toBe(true);

    // Inquisitor still in court
    expect(state.shared.court.some((e) => e.card.kind.name === "Inquisitor")).toBe(true);
  });

  it("skips the KH reaction window only when all KH copies are publicly located", () => {
    let state = setupTwoPlayerGame(
      ["Elder", "Zealot", "Inquisitor", "King's Hand", "Soldier"],
      ["Elder", "Oathbound", "Fool", "Oathbound", "Warden"],
    );

    state = moveHandCardToPublicCondemned(state, 0 as PlayerId, "King's Hand");

    const inq = playerZones(state, 0).hand.find((c) => c.kind.name === "Inquisitor")!;
    state = apply(state, { kind: "play", cardId: inq.id });

    // optional: proceed
    let opts = state.pendingResolution!.currentOptions;
    state = chooseEffect(state, opts.findIndex((o) => o.kind === "proceed"));

    // nameCard: name "Fool"
    opts = state.pendingResolution!.currentOptions;
    state = chooseEffect(state, opts.findIndex((o) => o.kind === "cardName" && o.name === "Fool"));

    // NO reaction window — should go straight to forEachOpponent/card choice
    // (either done or card choice, NOT a pass/proceed reaction window)
    if (state.phase === "resolving" && state.pendingResolution) {
      expect(state.pendingResolution.isReactionWindow).toBe(false);
    }
  });

  it("hidden Assassin in the active player's hand still prompts a king-flip reaction window", () => {
    let state = setupTwoPlayerGame(
      ["Elder", "Zealot", "Assassin", "Soldier", "Soldier"],
      ["Elder", "Oathbound", "Inquisitor", "Fool", "Soldier"],
    );

    state = moveHandCardToCourt(state, 1 as PlayerId, "Inquisitor");
    state = apply(state, { kind: "disgrace" });

    expect(state.phase).toBe("resolving");
    expect(state.pendingResolution!.isReactionWindow).toBe(true);
    expect(state.pendingResolution!.choosingPlayer).toBe(1);

    const legal = legalActions(state);
    expect(legal).toHaveLength(1);
    expect(legal[0]!).toEqual({ kind: "effect_choice", choice: 0 });
  });

  it("skips the Assassin king-flip prompt only when all Assassins are publicly located", () => {
    let state = setupTwoPlayerGame(
      ["Elder", "Zealot", "Assassin", "Soldier", "Soldier"],
      ["Elder", "Oathbound", "Inquisitor", "Fool", "Soldier"],
    );

    state = moveHandCardToPublicCondemned(state, 0 as PlayerId, "Assassin");
    state = moveHandCardToCourt(state, 1 as PlayerId, "Inquisitor");
    state = apply(state, { kind: "disgrace" });

    if (state.phase === "resolving" && state.pendingResolution) {
      expect(state.pendingResolution.isReactionWindow).toBe(false);
    }
  });

  it("3-player priority: P1 prompted first, then P2, in play order", () => {
    // P0 plays Soldier, P1 has KH, P2 does not
    // Both P1 and P2 are prompted in order
    let state = setupThreePlayerGame(
      ["Elder", "Zealot", "Soldier", "Inquisitor", "Fool"],
      ["Elder", "Oathbound", "King's Hand", "Oathbound", "Warden"],
      ["Zealot", "Executioner", "Bard", "Bard", "Spy"],
    );

    expect(state.phase).toBe("play");
    expect(state.activePlayer).toBe(0);

    const soldier = playerZones(state, 0).hand.find((c) => c.kind.name === "Soldier")!;
    state = apply(state, { kind: "play", cardId: soldier.id });

    // Soldier is non-optional → nameCard is the first choice
    expect(state.phase).toBe("resolving");
    let opts = state.pendingResolution!.currentOptions;
    expect(opts.some((o) => o.kind === "cardName")).toBe(true);

    // Name "Warden"
    const wardenIdx = opts.findIndex((o) => o.kind === "cardName" && o.name === "Warden");
    state = chooseEffect(state, wardenIdx);

    // --- KH reaction window: P1 first (in play order after P0) ---
    expect(state.phase).toBe("resolving");
    expect(state.pendingResolution!.isReactionWindow).toBe(true);
    expect(state.pendingResolution!.choosingPlayer).toBe(1 as PlayerId);

    // P1 has KH → can pass or react; P1 passes
    state = chooseEffect(state, 0);

    // --- KH reaction window: P2 next ---
    expect(state.phase).toBe("resolving");
    expect(state.pendingResolution!.isReactionWindow).toBe(true);
    expect(state.pendingResolution!.choosingPlayer).toBe(2 as PlayerId);

    // P2 doesn't have KH → only pass is legal
    const p2Legal = legalActions(state);
    expect(p2Legal).toHaveLength(1);
    expect(p2Legal[0]!).toEqual({ kind: "effect_choice", choice: 0 });

    // P2 passes
    state = chooseEffect(state, 0);

    // Reaction window complete, effect continues
    expect(state.pendingResolution?.isReactionWindow ?? false).toBe(false);
  });

  it("trace redacts hidden 3-player Assassin picks for non-choosers", () => {
    let state = setupThreePlayerGame(
      ["Elder", "Zealot", "Soldier", "Inquisitor", "Fool"],
      ["Elder", "Oathbound", "Warden", "Mystic", "Spy"],
      ["Executioner", "Bard", "Assassin", "Bard", "Herald"],
    );

    const throneCard = playerZones(state, 1).hand.find((card) => card.kind.name === "Warden")!;
    state = {
      ...state,
      players: state.players.map((zones, idx) =>
        idx === 1 ? { ...zones, hand: zones.hand.filter((card) => card.id !== throneCard.id) } : zones,
      ),
      shared: {
        ...state.shared,
        court: [{ card: throneCard, face: "up" as const, playedBy: 1 as PlayerId }],
      },
      activePlayer: 0 as PlayerId,
      phase: "play" as const,
    };

    state = apply(state, { kind: "disgrace" });

    expect(state.phase).toBe("resolving");
    expect(state.pendingResolution?.isReactionWindow).toBe(true);
    expect(state.pendingResolution?.choosingPlayer).toBe(1 as PlayerId);

    state = chooseEffect(state, 0);

    expect(state.phase).toBe("resolving");
    expect(state.pendingResolution?.isReactionWindow).toBe(true);
    expect(state.pendingResolution?.choosingPlayer).toBe(2 as PlayerId);

    const proceedIdx = state.pendingResolution!.currentOptions.findIndex((option) => option.kind === "proceed");
    state = chooseEffect(state, proceedIdx);

    expect(state.phase).toBe("resolving");
    expect(state.pendingResolution?.isReactionWindow).toBe(false);
    expect(state.pendingResolution!.currentOptions.every((option) => option.kind === "card")).toBe(true);

    const trace = traceResolution(state, true);
    const hiddenPick = [...trace].reverse().find((entry) =>
      entry.tag === "choice" && entry.privateToPlayer === (2 as PlayerId),
    );

    expect(hiddenPick?.description).toMatch(/^Player 2 chose /);
    expect(hiddenPick?.redactedDescription).toBe("Player 2 chose a card.");
    expect(hiddenPick?.description.includes("Player Player")).toBe(false);
  });

  it("immune_to_kings_hand: Oathbound's effect skips reaction window", () => {
    let state = setupTwoPlayerGame(
      ["Elder", "Zealot", "Oathbound", "Inquisitor", "Soldier"],
      ["Elder", "Oathbound", "King's Hand", "Fool", "Warlord"],
    );

    const warlord = playerZones(state, 1).hand.find((c) => c.kind.name === "Warlord")!;
    state = {
      ...state,
      players: state.players.map((p, i) =>
        i === 1 ? { ...p, hand: p.hand.filter((c) => c.id !== warlord.id) } : p,
      ),
      shared: {
        ...state.shared,
        court: [{ card: warlord, face: "up" as const, playedBy: 1 as PlayerId }],
      },
    };

    const oathbound = playerZones(state, 0).hand.find((c) => c.kind.name === "Oathbound")!;
    state = apply(state, { kind: "play", cardId: oathbound.id });

    expect(state.phase).toBe("resolving");
    expect(state.pendingResolution!.isReactionWindow).toBe(false);
    expect(state.pendingResolution!.currentOptions.every((o) => o.kind === "card")).toBe(true);
  });

  it("KH as accused in 3p: no reaction windows fire (publicly located)", () => {
    let state = setupThreePlayerGame(
      ["Elder", "Zealot", "Inquisitor", "Soldier", "Fool"],
      ["Elder", "Oathbound", "Oathbound", "Warden", "Mystic"],
      ["Zealot", "Executioner", "Bard", "Bard", "Spy"],
    );

    // Ensure KH is the accused card (publicly visible shared zone)
    const khKind = createDeck(regulationDeck(3)).find((c) => c.kind.name === "King's Hand")!;
    state = {
      ...state,
      shared: { ...state.shared, accused: khKind },
      publiclyTrackedKH: [],
    };

    const inq = playerZones(state, 0).hand.find((c) => c.kind.name === "Inquisitor")!;
    state = apply(state, { kind: "play", cardId: inq.id });

    // optional: proceed
    let opts = state.pendingResolution!.currentOptions;
    state = chooseEffect(state, opts.findIndex((o) => o.kind === "proceed"));

    // nameCard: name "Warden"
    opts = state.pendingResolution!.currentOptions;
    state = chooseEffect(state, opts.findIndex((o) => o.kind === "cardName" && o.name === "Warden"));

    // KH is accused (public) → no reaction window
    if (state.phase === "resolving" && state.pendingResolution) {
      expect(state.pendingResolution.isReactionWindow).toBe(false);
    }
  });

  it("KH publicly picked up from court by Fool: no window when that player plays Inquisitor", () => {
    // Simulate: KH was in court, P1 picked it up with Fool (publicly visible).
    // Now P1 plays Inquisitor and names Princess.
    // Since KH's move from court → P1's hand was public (tracked), no window fires.
    let state = setupTwoPlayerGame(
      ["Elder", "Zealot", "Princess", "Soldier", "Soldier"],
      ["Elder", "Oathbound", "Inquisitor", "Oathbound", "Soldier"],
    );

    const deck = createDeck(regulationDeck(2));
    const kh = deck.find((c) => c.kind.name === "King's Hand")!;

    // Give P1 KH in hand (as if Fool picked it up from court) and mark tracked
    // Empty court so Inquisitor (value 4) can play on threshold 0
    state = {
      ...state,
      players: state.players.map((p, i) =>
        i === 1 ? { ...p, hand: [...p.hand, kh] } : p,
      ),
      activePlayer: 1 as PlayerId,
      publiclyTrackedKH: [kh.id],
    };

    // P1 plays Inquisitor (value 4 >= 3 Elder threshold)
    const inq = playerZones(state, 1).hand.find((c) => c.kind.name === "Inquisitor")!;
    state = apply(state, { kind: "play", cardId: inq.id });

    // optional: proceed
    let opts = state.pendingResolution!.currentOptions;
    state = chooseEffect(state, opts.findIndex((o) => o.kind === "proceed"));

    // nameCard: name "Princess"
    opts = state.pendingResolution!.currentOptions;
    state = chooseEffect(state, opts.findIndex((o) => o.kind === "cardName" && o.name === "Princess"));

    // KH is in P1's hand (active player) AND publicly tracked → no reaction window
    if (state.phase === "resolving" && state.pendingResolution) {
      expect(state.pendingResolution.isReactionWindow).toBe(false);
    }

    // Resolve remainder — Princess should go to P0's antechamber
    let safety = 0;
    while ((state.phase === "resolving" || state.phase === "end_of_turn") && safety++ < 50) {
      const la = legalActions(state);
      if (la.length === 0) break;
      state = apply(state, la[0]!);
    }

    // Princess is P0's only matching card → should be in antechamber
    expect(playerZones(state, 0).antechamber.some((c) => c.kind.name === "Princess")).toBe(true);
  });

  it("Princess from antechamber: cannot swap when opponent has 0 cards in hand", () => {
    // P0's last card is Princess, moved to antechamber by Inquisitor
    // When Princess plays from antechamber, P0 has 0 cards → chooseCard returns done
    let state = setupTwoPlayerGame(
      ["Elder", "Zealot", "Princess", "Soldier", "Soldier"],
      ["Elder", "Oathbound", "Inquisitor", "Oathbound", "Soldier"],
    );

    // Trim P0's hand to just Princess
    const princess = playerZones(state, 0).hand.find((c) => c.kind.name === "Princess")!;
    state = {
      ...state,
      players: state.players.map((p, i) =>
        i === 0 ? { ...p, hand: [princess] } : p,
      ),
    };

    // Manually place Princess in P0's antechamber (as if Inquisitor moved it there)
    state = {
      ...state,
      players: state.players.map((p, i) =>
        i === 0 ? { ...p, hand: [], antechamber: [princess] } : p,
      ),
      // Put some cards in court so the game isn't trivially over
      shared: {
        ...state.shared,
        court: [
          { card: createDeck(regulationDeck(2)).find((c) => c.kind.name === "Soldier")!, face: "up" as const, playedBy: 0 as PlayerId },
        ],
      },
      activePlayer: 0 as PlayerId,
      phase: "play" as const,
    };

    // P0 has no hand cards but has Princess in antechamber
    expect(playerZones(state, 0).hand).toHaveLength(0);
    expect(playerZones(state, 0).antechamber).toHaveLength(1);

    // P0 plays Princess from antechamber
    state = apply(state, { kind: "play", cardId: princess.id });

    // Princess's effect: optional(choosePlayer(...) → khWindow(chooseCard(active, hand, ...)))
    // If it enters resolving, the optional fires.
    if (state.phase === "resolving" && state.pendingResolution) {
      const opts2 = state.pendingResolution.currentOptions;
      // If it's optional pass/proceed, choose proceed
      if (opts2.some((o) => o.kind === "proceed")) {
        state = chooseEffect(state, opts2.findIndex((o) => o.kind === "proceed"));

        // choosePlayer → choose P1
        if (state.phase === "resolving" && state.pendingResolution) {
          const playerOpts = state.pendingResolution.currentOptions;
          if (playerOpts.some((o) => o.kind === "player")) {
            state = chooseEffect(state, 0);
          }
        }
      }
    }

    // Resolve any remaining
    let safety2 = 0;
    while ((state.phase === "resolving" || state.phase === "end_of_turn") && safety2++ < 50) {
      const la = legalActions(state);
      if (la.length === 0) break;
      state = apply(state, la[0]!);
    }

    // Princess should be in court (played from antechamber)
    expect(state.shared.court.some((e) => e.card.kind.name === "Princess")).toBe(true);

    // P0's hand should still be empty — no swap happened because P0 had 0 cards
    // (chooseCard with null filter on empty hand returns done)
    expect(playerZones(state, 0).hand.every((c) => c.kind.name !== "Princess")).toBe(true);
  });
});
