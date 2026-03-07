/**
 * Tests for expansion card effects: Flagbearer, Conspiracist, Nakturn, Informant.
 */

import { describe, it, expect } from "vitest";
import {
  createDeck,
  dealWithDeck,
  regulationDeck,
  SIGNATURE_CARD_KINDS,
  BASE_ARMY_KINDS,
  legalActions,
  apply,
  applySafe,
  playerZones,
  effectiveValue,
  type IKState,
  type IKCard,
} from "../index.js";

const chooseEffect = (state: IKState, idx: number): IKState => {
  const result = applySafe(state, { kind: "effect_choice", choice: idx });
  if (!result.ok) throw new Error(`effect_choice(${idx}) failed: ${JSON.stringify(result.error)}`);
  return result.value;
};

const setupBaseGame = (): IKState => {
  const kinds = regulationDeck(2);
  const deck = createDeck(kinds);
  let state = dealWithDeck(deck, 2, 0);
  state = apply(state, { kind: "crown", firstPlayer: 0 });
  const s1 = legalActions(state).find((a) => a.kind === "commit")!;
  state = apply(state, s1);
  const s2 = legalActions(state).find((a) => a.kind === "commit")!;
  state = apply(state, s2);
  return state;
};

const createArmyCard = (kindIndex: number, id: number): IKCard =>
  ({ id, kind: BASE_ARMY_KINDS[kindIndex]! }) as IKCard;

describe("Flagbearer", () => {
  it("proceed: disgrace self, recall, rally twice, return one — net +1 hand", () => {
    let state = setupBaseGame();
    const flagbearerKind = SIGNATURE_CARD_KINDS.find((k) => k.name === "Flagbearer")!;
    const flagbearer: IKCard = { id: 900, kind: flagbearerKind };

    const p0Hand = playerZones(state, 0).hand;
    const p1Hand = playerZones(state, 1).hand;
    const disgracedCard = p1Hand[0]!;
    const armyCard1 = createArmyCard(0, 901);
    const armyCard2 = createArmyCard(1, 902);
    const exhaustedCard = createArmyCard(2, 903);

    state = {
      ...state,
      players: state.players.map((p, i) => {
        if (i === 0) {
          const hand = [flagbearer, ...p.hand.filter((c) => c.id !== p0Hand[0]!.id)];
          return {
            ...p,
            hand,
            army: [armyCard1, armyCard2],
            exhausted: [exhaustedCard],
          };
        }
        return { ...p, hand: p.hand.filter((c) => c.id !== disgracedCard.id) };
      }),
      shared: {
        ...state.shared,
        court: [{ card: disgracedCard, face: "down" as const, playedBy: 1 as const }],
      },
    };

    const handBefore = playerZones(state, 0).hand.length;
    state = apply(state, { kind: "play", cardId: flagbearer.id });

    expect(state.phase).toBe("resolving");
    let opts = state.pendingResolution!.currentOptions;
    const proceedIdx = opts.findIndex((o) => o.kind === "proceed");
    expect(proceedIdx).not.toBe(-1);
    state = chooseEffect(state, proceedIdx);

    while (state.phase === "resolving") {
      opts = state.pendingResolution!.currentOptions;
      state = chooseEffect(state, 0);
    }

    expect(state.phase).toBe("play");
    const handAfter = playerZones(state, 0).hand.length;
    expect(handAfter).toBe(handBefore - 1 + 2 - 1);
    expect(state.armyRecruitedIds.length).toBeGreaterThan(0);
  });
});

describe("Conspiracist", () => {
  it("grants Steadfast +1 to hand; loses 1 value on Throne", () => {
    let state = setupBaseGame();
    const conspiracistKind = SIGNATURE_CARD_KINDS.find((k) => k.name === "Conspiracist")!;
    const conspiracist: IKCard = { id: 910, kind: conspiracistKind };

    const p0Hand = playerZones(state, 0).hand;
    state = {
      ...state,
      players: state.players.map((p, i) =>
        i === 0 ? { ...p, hand: [conspiracist, ...p.hand.filter((c) => c.id !== p0Hand[0]!.id)] } : p,
      ),
    };

    const handCard = playerZones(state, 0).hand.find((c) => c.id !== conspiracist.id)!;
    const baseVal = handCard.kind.props.value;
    expect(effectiveValue(state, handCard)).toBe(baseVal);

    state = apply(state, { kind: "play", cardId: conspiracist.id });
    expect(state.phase).toBe("play");

    expect(effectiveValue(state, handCard)).toBe(baseVal + 1);

    const conspiracistEntry = state.shared.court.find((e) => e.card.id === conspiracist.id)!;
    expect(effectiveValue(state, conspiracistEntry.card)).toBe(7);
  });
});

describe("Nakturn", () => {
  it("court value is 2 when in court; precondition triggers optional effect", () => {
    let state = setupBaseGame();
    const nakturnKind = SIGNATURE_CARD_KINDS.find((k) => k.name === "Nakturn")!;
    const nakturn: IKCard = { id: 920, kind: nakturnKind };

    const p0Hand = playerZones(state, 0).hand;
    const p1Hand = playerZones(state, 1).hand;
    const disgracedCard = p1Hand[0]!;

    state = {
      ...state,
      players: state.players.map((p, i) => {
        if (i === 0) {
          return { ...p, hand: [nakturn, ...p.hand.filter((c) => c.id !== p0Hand[0]!.id)] };
        }
        return { ...p, hand: p.hand.filter((c) => c.id !== disgracedCard.id) };
      }),
      shared: {
        ...state.shared,
        court: [{ card: disgracedCard, face: "down" as const, playedBy: 1 as const }],
      },
    };

    state = apply(state, { kind: "play", cardId: nakturn.id });
    expect(state.phase).toBe("resolving");

    const nakturnOpts = state.pendingResolution!.currentOptions;
    const passIdx = nakturnOpts.findIndex((o) => o.kind === "pass");
    expect(passIdx).not.toBe(-1);
    state = chooseEffect(state, passIdx);

    expect(state.phase).toBe("play");
    const nakturnEntry = state.shared.court.find((e) => e.card.id === nakturn.id)!;
    expect(effectiveValue(state, nakturnEntry.card)).toBe(2);
  });
});

describe("Informant", () => {
  it("names card, finds in opponent dungeon, resolution enters correct flow", () => {
    let state = setupBaseGame();
    const informantKind = SIGNATURE_CARD_KINDS.find((k) => k.name === "Informant")!;
    const informant: IKCard = { id: 930, kind: informantKind };

    const p0Hand = playerZones(state, 0).hand;
    const p1Hand = playerZones(state, 1).hand;
    const dungeonCard = p1Hand[0]!;

    state = {
      ...state,
      players: state.players.map((p, i) => {
        if (i === 0) {
          return { ...p, hand: [informant, ...p.hand.filter((c) => c.id !== p0Hand[0]!.id)] };
        }
        return {
          ...p,
          hand: p.hand.filter((c) => c.id !== dungeonCard.id),
          dungeon: { card: dungeonCard, face: "down" as const },
        };
      }),
    };

    state = apply(state, { kind: "play", cardId: informant.id });
    expect(state.phase).toBe("resolving");

    let opts = state.pendingResolution!.currentOptions;
    const nameIdx = opts.findIndex(
      (o) => o.kind === "cardName" && (o as { kind: "cardName"; name: string }).name === dungeonCard.kind.name,
    );
    expect(nameIdx).not.toBe(-1);
    state = chooseEffect(state, nameIdx);

    opts = state.pendingResolution!.currentOptions;
    const proceedIdx = opts.findIndex((o) => o.kind === "proceed");
    if (proceedIdx >= 0) state = chooseEffect(state, proceedIdx);

    expect(state.phase).toBe("play");
    expect(playerZones(state, 0).hand.some((c) => c.id === dungeonCard.id)).toBe(true);
  });

  it("names card not in dungeon — no effect, turn advances", () => {
    let state = setupBaseGame();
    const informantKind = SIGNATURE_CARD_KINDS.find((k) => k.name === "Informant")!;
    const informant: IKCard = { id: 931, kind: informantKind };

    const p0Hand = playerZones(state, 0).hand;
    const p1Hand = playerZones(state, 1).hand;
    const dungeonCard = p1Hand[0]!;

    state = {
      ...state,
      players: state.players.map((p, i) => {
        if (i === 0) {
          return { ...p, hand: [informant, ...p.hand.filter((c) => c.id !== p0Hand[0]!.id)] };
        }
        return {
          ...p,
          hand: p.hand.filter((c) => c.id !== dungeonCard.id),
          dungeon: { card: dungeonCard, face: "down" as const },
        };
      }),
    };

    state = apply(state, { kind: "play", cardId: informant.id });
    expect(state.phase).toBe("resolving");

    const opts = state.pendingResolution!.currentOptions;
    const wrongNameIdx = opts.findIndex(
      (o) => o.kind === "cardName" && (o as { kind: "cardName"; name: string }).name !== dungeonCard.kind.name,
    );
    expect(wrongNameIdx).not.toBe(-1);
    state = chooseEffect(state, wrongNameIdx);

    expect(state.phase).toBe("play");
    expect(state.activePlayer).toBe(1);
    expect(playerZones(state, 0).hand.some((c) => c.id === dungeonCard.id)).toBe(false);
  });
});
