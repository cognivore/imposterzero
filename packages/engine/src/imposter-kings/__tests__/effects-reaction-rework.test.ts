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
  roundScore,
  isTerminal,
  type IKState,
  type IKCard,
  type PlayerId,
} from "../index.js";

const chooseEffect = (state: IKState, idx: number): IKState => {
  const result = applySafe(state, { kind: "effect_choice", choice: idx });
  if (!result.ok) throw new Error(`effect_choice(${idx}) failed`);
  return result.value;
};

const setupTwoPlayerGame = (
  p0CardNames: readonly string[],
  p1CardNames: readonly string[],
): IKState => {
  const kinds = regulationDeck(2);
  const deck = createDeck(kinds);

  const findCards = (names: readonly string[]): IKCard[] => {
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

  const customDeck: IKCard[] = [];
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

describe("reaction system rework regressions", () => {
  describe("Soldier throne modifier drops when displaced", () => {
    it("effectiveValue reflects +2 on throne and reverts off throne", () => {
      const kinds = regulationDeck(2);
      const deck = createDeck(kinds);
      const soldier = deck.find((c) => c.kind.name === "Soldier")!;
      const elder = deck.find((c) => c.kind.name === "Elder")!;

      const baseState: IKState = {
        players: [
          {
            hand: [],
            king: { card: { id: 100, kind: { name: "King", props: { value: 0, keywords: [], shortText: "", fullText: "", flavorText: "", effects: [] } } }, face: "up" },
            successor: null,
            dungeon: null,
            antechamber: [],
            parting: [],
            army: [],
            exhausted: [],
            recruitDiscard: [],
          },
          {
            hand: [],
            king: { card: { id: 101, kind: { name: "King", props: { value: 0, keywords: [], shortText: "", fullText: "", flavorText: "", effects: [] } } }, face: "up" },
            successor: null,
            dungeon: null,
            antechamber: [],
            parting: [],
            army: [],
            exhausted: [],
            recruitDiscard: [],
          },
        ],
        shared: {
          court: [{ card: soldier, face: "up", playedBy: 0 as PlayerId }],
          accused: null,
          forgotten: null,
          condemned: [],
        },
        activePlayer: 0 as PlayerId,
        phase: "play",
        numPlayers: 2,
        turnCount: 1,
        firstPlayer: 0 as PlayerId,
        pendingResolution: null,
        forcedLoser: null,
        modifiers: [],
        roundModifiers: [
          {
            sourceCardId: soldier.id,
            spec: {
              tag: "conditionalValueChange",
              delta: 2,
              target: { tag: "self" },
              condition: { tag: "cardIsOnThrone" },
            },
          },
        ],
        crystallizedModifiers: [],
        publiclyTrackedKH: [],
        armyRecruitedIds: [],
        hasExhaustedThisMustering: false,
        musteringPlayersDone: 0,
        eliminatedPlayers: [],
      };

      expect(effectiveValue(baseState, soldier)).toBe(7);

      const displaced: IKState = {
        ...baseState,
        shared: {
          ...baseState.shared,
          court: [
            { card: soldier, face: "up", playedBy: 0 as PlayerId },
            { card: elder, face: "up", playedBy: 1 as PlayerId },
          ],
        },
      };

      expect(effectiveValue(displaced, soldier)).toBe(5);
    });
  });

  describe("2p Assassin scoring regression", () => {
    it("Assassin reaction on disgrace forces loser and awards correct score", () => {
      const kinds = regulationDeck(2);
      const deck = createDeck(kinds);
      const elder = deck.find((c) => c.kind.name === "Elder")!;
      const assassin = deck.find((c) => c.kind.name === "Assassin")!;
      const soldier = deck.find((c) => c.kind.name === "Soldier")!;

      const kingCard = (id: number): IKCard => ({
        id,
        kind: { name: "King", props: { value: 0, keywords: [], shortText: "", fullText: "", flavorText: "", effects: [] } },
      });

      let state: IKState = {
        players: [
          {
            hand: [soldier],
            king: { card: kingCard(200), face: "up" },
            successor: { card: deck.find((c) => c.kind.name === "Fool")!, face: "down" },
            dungeon: null,
            antechamber: [],
            parting: [],
            army: [],
            exhausted: [],
            recruitDiscard: [],
          },
          {
            hand: [assassin],
            king: { card: kingCard(201), face: "up" },
            successor: null,
            dungeon: null,
            antechamber: [],
            parting: [],
            army: [],
            exhausted: [],
            recruitDiscard: [],
          },
        ],
        shared: {
          court: [{ card: elder, face: "up", playedBy: 0 as PlayerId }],
          accused: null,
          forgotten: null,
          condemned: [],
        },
        activePlayer: 0 as PlayerId,
        phase: "play",
        numPlayers: 2,
        turnCount: 2,
        firstPlayer: 0 as PlayerId,
        pendingResolution: null,
        forcedLoser: null,
        modifiers: [],
        roundModifiers: [],
        crystallizedModifiers: [],
        publiclyTrackedKH: [],
        armyRecruitedIds: [],
        hasExhaustedThisMustering: false,
        musteringPlayersDone: 0,
        eliminatedPlayers: [],
      };

      state = apply(state, { kind: "disgrace" });

      expect(state.phase).toBe("resolving");
      expect(state.pendingResolution).not.toBeNull();
      expect(state.pendingResolution!.choosingPlayer).toBe(1);
      const opts = state.pendingResolution!.currentOptions;
      expect(opts).toHaveLength(2);
      expect(opts[0]!.kind).toBe("pass");
      expect(opts[1]!.kind).toBe("proceed");

      state = chooseEffect(state, 1);

      expect(state.forcedLoser).toBe(0);
      expect(isTerminal(state)).toBe(true);

      const scores = roundScore(state);
      expect(scores[1]).toBeGreaterThanOrEqual(2);

      expect(playerZones(state, 1).parting.some((c) => c.id === assassin.id)).toBe(true);
    });
  });

  describe("KH parting flow", () => {
    it("KH reaction condemns both cards through parting zone", () => {
      let state = setupTwoPlayerGame(
        ["Elder", "Zealot", "Inquisitor", "Soldier", "Soldier"],
        ["Elder", "Oathbound", "King's Hand", "Fool", "Oathbound"],
      );

      expect(state.phase).toBe("play");
      expect(state.activePlayer).toBe(0);

      const inq = playerZones(state, 0).hand.find((c) => c.kind.name === "Inquisitor")!;
      const kh = playerZones(state, 1).hand.find((c) => c.kind.name === "King's Hand")!;

      state = apply(state, { kind: "play", cardId: inq.id });
      expect(state.phase).toBe("resolving");

      let opts = state.pendingResolution!.currentOptions;
      state = chooseEffect(state, opts.findIndex((o) => o.kind === "proceed"));

      opts = state.pendingResolution!.currentOptions;
      const foolIdx = opts.findIndex((o) => o.kind === "cardName" && o.name === "Fool");
      state = chooseEffect(state, foolIdx);

      expect(state.pendingResolution!.isReactionWindow).toBe(true);
      expect(state.pendingResolution!.choosingPlayer).toBe(1);

      state = chooseEffect(state, 1);

      expect(playerZones(state, 0).parting.some((c) => c.id === inq.id)).toBe(true);
      expect(playerZones(state, 1).parting.some((c) => c.id === kh.id)).toBe(true);
      expect(state.shared.condemned.every((e) => e.card.id !== inq.id)).toBe(true);
      expect(state.shared.condemned.every((e) => e.card.id !== kh.id)).toBe(true);

      expect(state.phase).toBe("play");
      expect(state.activePlayer).toBe(0);

      const p0Legal = legalActions(state);
      expect(p0Legal.every((a) => a.kind === "play")).toBe(true);
      const condemnInqAction = p0Legal.find(
        (a) => a.kind === "play" && a.cardId === inq.id,
      );
      expect(condemnInqAction).toBeDefined();

      state = apply(state, condemnInqAction!);

      expect(state.activePlayer).toBe(1);

      const p1Legal = legalActions(state);
      const condemnKhAction = p1Legal.find(
        (a) => a.kind === "play" && a.cardId === kh.id,
      );
      expect(condemnKhAction).toBeDefined();

      state = apply(state, condemnKhAction!);

      expect(state.shared.condemned.some((e) => e.card.id === inq.id)).toBe(true);
      expect(state.shared.condemned.some((e) => e.card.id === kh.id)).toBe(true);
      expect(state.activePlayer).toBe(0);
      expect(state.phase).toBe("play");
    });
  });

  describe("condemned visibility", () => {
    it("condemned entries are face-down with knownBy containing all players", () => {
      let state = setupTwoPlayerGame(
        ["Elder", "Zealot", "Inquisitor", "Soldier", "Soldier"],
        ["Elder", "Oathbound", "King's Hand", "Fool", "Oathbound"],
      );

      const inq = playerZones(state, 0).hand.find((c) => c.kind.name === "Inquisitor")!;

      state = apply(state, { kind: "play", cardId: inq.id });

      let opts = state.pendingResolution!.currentOptions;
      state = chooseEffect(state, opts.findIndex((o) => o.kind === "proceed"));

      opts = state.pendingResolution!.currentOptions;
      state = chooseEffect(state, opts.findIndex((o) => o.kind === "cardName" && o.name === "Fool"));

      state = chooseEffect(state, 1);

      expect(state.phase).toBe("play");
      expect(playerZones(state, 0).parting.length).toBeGreaterThan(0);
      expect(playerZones(state, 1).parting.length).toBeGreaterThan(0);

      const p0PartingCard = playerZones(state, 0).parting[0]!;
      state = apply(state, { kind: "play", cardId: p0PartingCard.id });

      const p1PartingCard = playerZones(state, 1).parting[0]!;
      state = apply(state, { kind: "play", cardId: p1PartingCard.id });

      for (const entry of state.shared.condemned) {
        expect(entry.face).toBe("down");
        expect(entry.knownBy).toContain(0);
        expect(entry.knownBy).toContain(1);
      }

      expect(state.shared.condemned.length).toBeGreaterThanOrEqual(2);
    });
  });
});
