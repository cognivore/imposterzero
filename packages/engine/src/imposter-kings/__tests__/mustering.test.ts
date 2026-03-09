import { describe, it, expect } from "vitest";

import {
  BASE_ARMY_KINDS,
  type IKState,
  type IKAction,
  type IKSetupAction,
  legalActions,
  apply,
  playerZones,
} from "../index.js";
import { createExpansionRound, type PlayerArmy } from "../expansion-match.js";
import { REGULATION_2P_EXPANSION } from "../config.js";

const seededRng = (seed: number) => {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
};

const makeArmies = (): ReadonlyArray<PlayerArmy> => [
  { available: BASE_ARMY_KINDS.slice(0, 3), exhausted: [] },
  { available: BASE_ARMY_KINDS.slice(0, 3), exhausted: [] },
];

describe("Mustering Phase", () => {
  it("crown transitions to mustering when players have army cards", () => {
    const armies = makeArmies();
    const state = createExpansionRound(REGULATION_2P_EXPANSION, armies, 0, seededRng(42));

    expect(state.phase).toBe("crown");
    expect(state.players[0]!.army.length).toBe(3);
    expect(state.players[1]!.army.length).toBe(3);

    const legal = legalActions(state);
    const crownAction = legal.find((a) => a.kind === "crown" && a.firstPlayer === 0);
    expect(crownAction).toBeDefined();

    const afterCrown = apply(state, crownAction!);
    expect(afterCrown.phase).toBe("mustering");
    expect(afterCrown.firstPlayer).toBe(0);
    expect(afterCrown.activePlayer).toBe(1);
  });

  it("crown transitions to setup when no army cards", () => {
    const noArmies: ReadonlyArray<PlayerArmy> = [
      { available: [], exhausted: [] },
      { available: [], exhausted: [] },
    ];
    const state = createExpansionRound(REGULATION_2P_EXPANSION, noArmies, 0, seededRng(42));

    const afterCrown = apply(state, { kind: "crown", firstPlayer: 0 });
    expect(afterCrown.phase).toBe("setup");
  });

  it("end_mustering by both players transitions to setup", () => {
    const armies = makeArmies();
    const state = createExpansionRound(REGULATION_2P_EXPANSION, armies, 0, seededRng(42));

    let s = apply(state, { kind: "crown", firstPlayer: 0 });
    expect(s.phase).toBe("mustering");

    const legal1 = legalActions(s);
    expect(legal1.some((a) => a.kind === "end_mustering")).toBe(true);

    s = apply(s, { kind: "end_mustering" });
    expect(s.phase).toBe("mustering");
    expect(s.activePlayer).toBe(0);

    s = apply(s, { kind: "end_mustering" });
    expect(s.phase).toBe("setup");
  });

  it("offers optional king selection during mustering", () => {
    const armies = makeArmies();
    const state = createExpansionRound(REGULATION_2P_EXPANSION, armies, 0, seededRng(42));
    const s = apply(state, { kind: "crown", firstPlayer: 0 });

    const legal = legalActions(s);
    expect(legal).toContainEqual({ kind: "select_king", facet: "charismatic" });
    expect(legal).toContainEqual({ kind: "select_king", facet: "masterTactician" });
    expect(legal).toContainEqual({ kind: "end_mustering" });
  });

  it("select_king updates the king facet and remains in mustering", () => {
    const armies = makeArmies();
    const state = createExpansionRound(REGULATION_2P_EXPANSION, armies, 0, seededRng(42));
    let s = apply(state, { kind: "crown", firstPlayer: 0 });

    expect(playerZones(s, 1).king.facet).toBe("default");
    s = apply(s, { kind: "select_king", facet: "charismatic" });

    expect(s.phase).toBe("mustering");
    expect(playerZones(s, 1).king.facet).toBe("charismatic");
    expect(playerZones(s, 1).king.card.kind.props.shortText).toContain("Revealed Successor");
    expect(legalActions(s).some((a) => a.kind === "select_king")).toBe(false);
    expect(legalActions(s).some((a) => a.kind === "end_mustering")).toBe(true);
  });

  it("players may skip special king selection and keep the default king", () => {
    const armies = makeArmies();
    const state = createExpansionRound(REGULATION_2P_EXPANSION, armies, 0, seededRng(42));

    let s = apply(state, { kind: "crown", firstPlayer: 0 });
    s = apply(s, { kind: "end_mustering" });
    s = apply(s, { kind: "end_mustering" });

    expect(s.phase).toBe("setup");
    expect(playerZones(s, 0).king.facet).toBe("default");
    expect(playerZones(s, 1).king.facet).toBe("default");
  });

  it("selecting Master Tactician changes setup commits to require a squire", () => {
    const armies = makeArmies();
    const state = createExpansionRound(REGULATION_2P_EXPANSION, armies, 0, seededRng(42));

    let s = apply(state, { kind: "crown", firstPlayer: 0 });
    s = apply(s, { kind: "end_mustering" });
    s = apply(s, { kind: "select_king", facet: "masterTactician" });
    s = apply(s, { kind: "end_mustering" });

    expect(s.phase).toBe("setup");
    expect(s.activePlayer).toBe(0);

    const commits = legalActions(s).filter(
      (a): a is IKSetupAction => a.kind === "commit",
    );
    expect(commits.length).toBeGreaterThan(0);
    expect(commits.every((a) => a.squireId !== undefined)).toBe(true);
  });

  it("begin_recruit exhausts an army card, then recruit swaps hand for army", () => {
    const armies = makeArmies();
    const state = createExpansionRound(REGULATION_2P_EXPANSION, armies, 0, seededRng(42));
    let s = apply(state, { kind: "crown", firstPlayer: 0 });
    expect(s.activePlayer).toBe(1);

    const p1 = playerZones(s, 1);
    const exhaustCard = p1.army[0]!;

    const legal0 = legalActions(s);
    expect(legal0.some((a) => a.kind === "begin_recruit")).toBe(true);
    expect(legal0.some((a) => a.kind === "recruit")).toBe(false);

    s = apply(s, { kind: "begin_recruit", exhaustCardId: exhaustCard.id });
    expect(s.hasExhaustedThisMustering).toBe(true);

    const p1AfterExhaust = playerZones(s, 1);
    expect(p1AfterExhaust.army.some((c) => c.id === exhaustCard.id)).toBe(false);
    expect(p1AfterExhaust.exhausted.some((c) => c.id === exhaustCard.id)).toBe(true);

    const legalAfterBegin = legalActions(s);
    expect(legalAfterBegin.some((a) => a.kind === "recruit")).toBe(true);
    expect(legalAfterBegin.some((a) => a.kind === "begin_recruit")).toBe(false);

    const handCard = p1AfterExhaust.hand[0]!;
    const armyCard = p1AfterExhaust.army[0]!;

    s = apply(s, {
      kind: "recruit",
      discardFromHandId: handCard.id,
      takeFromArmyId: armyCard.id,
    });

    const p1Final = playerZones(s, 1);
    expect(p1Final.hand.some((c) => c.id === armyCard.id)).toBe(true);
    expect(p1Final.hand.some((c) => c.id === handCard.id)).toBe(false);
    expect(p1Final.army.some((c) => c.id === armyCard.id)).toBe(false);
    expect(p1Final.recruitDiscard.some((c) => c.id === handCard.id)).toBe(true);
    expect(s.armyRecruitedIds).toContain(armyCard.id);
  });

  it("second recruit does not require begin_recruit again", () => {
    const armies = makeArmies();
    const state = createExpansionRound(REGULATION_2P_EXPANSION, armies, 0, seededRng(42));
    let s = apply(state, { kind: "crown", firstPlayer: 0 });

    const p1 = playerZones(s, 1);

    s = apply(s, { kind: "begin_recruit", exhaustCardId: p1.army[0]!.id });

    const p1b = playerZones(s, 1);
    s = apply(s, {
      kind: "recruit",
      discardFromHandId: p1b.hand[0]!.id,
      takeFromArmyId: p1b.army[0]!.id,
    });

    const legal = legalActions(s);
    const recruits = legal.filter((a) => a.kind === "recruit");
    expect(recruits.length).toBeGreaterThan(0);
    expect(legal.some((a) => a.kind === "begin_recruit")).toBe(false);
  });

  it("recommission exhausts 2 and recovers 1", () => {
    const armies: ReadonlyArray<PlayerArmy> = [
      { available: BASE_ARMY_KINDS.slice(0, 3), exhausted: BASE_ARMY_KINDS.slice(3, 5) },
      { available: BASE_ARMY_KINDS.slice(0, 3), exhausted: BASE_ARMY_KINDS.slice(3, 5) },
    ];
    const state = createExpansionRound(REGULATION_2P_EXPANSION, armies, 0, seededRng(42));
    let s = apply(state, { kind: "crown", firstPlayer: 0 });

    const p1 = playerZones(s, 1);
    expect(p1.army.length).toBe(3);
    expect(p1.exhausted.length).toBe(2);

    const legal = legalActions(s);
    const recommissions = legal.filter((a) => a.kind === "recommission");
    expect(recommissions.length).toBeGreaterThan(0);

    const rec = recommissions[0] as {
      kind: "recommission";
      exhaust1Id: number;
      exhaust2Id: number;
      recoverFromExhaustId: number;
    };
    s = apply(s, rec);

    const p1After = playerZones(s, 1);
    expect(p1After.army.length).toBe(2);
    expect(p1After.exhausted.length).toBe(3);
    expect(p1After.army.some((c) => c.id === rec.recoverFromExhaustId)).toBe(true);
  });

  it("recommission then recruit works without begin_recruit", () => {
    const armies: ReadonlyArray<PlayerArmy> = [
      { available: BASE_ARMY_KINDS.slice(0, 3), exhausted: BASE_ARMY_KINDS.slice(3, 5) },
      { available: BASE_ARMY_KINDS.slice(0, 3), exhausted: BASE_ARMY_KINDS.slice(3, 5) },
    ];
    const state = createExpansionRound(REGULATION_2P_EXPANSION, armies, 0, seededRng(42));
    let s = apply(state, { kind: "crown", firstPlayer: 0 });

    const legal = legalActions(s);
    const rec = legal.find((a) => a.kind === "recommission")!;
    s = apply(s, rec);

    expect(s.hasExhaustedThisMustering).toBe(true);

    const legalAfter = legalActions(s);
    expect(legalAfter.some((a) => a.kind === "recruit")).toBe(true);
    expect(legalAfter.some((a) => a.kind === "begin_recruit")).toBe(false);
  });
});
