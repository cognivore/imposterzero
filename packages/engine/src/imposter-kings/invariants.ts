import type { IKState } from "./state.js";

const collectAllCardIds = (state: IKState): number[] => {
  const ids: number[] = [];
  for (const p of state.players) {
    ids.push(...p.hand.map((c) => c.id));
    ids.push(p.king.card.id);
    if (p.successor) ids.push(p.successor.card.id);
    if (p.dungeon) ids.push(p.dungeon.card.id);
    ids.push(...p.antechamber.map((c) => c.id));
    ids.push(...p.parting.map((c) => c.id));
    ids.push(...p.army.map((c) => c.id));
    ids.push(...p.exhausted.map((c) => c.id));
    ids.push(...p.recruitDiscard.map((c) => c.id));
  }
  for (const e of state.shared.court) ids.push(e.card.id);
  if (state.shared.accused) ids.push(state.shared.accused.id);
  if (state.shared.forgotten) ids.push(state.shared.forgotten.card.id);
  ids.push(...state.shared.army.map((c) => c.id));
  ids.push(...state.shared.condemned.map((e) => e.card.id));
  return ids;
};

export const validateState = (state: IKState): ReadonlyArray<string> => {
  const violations: string[] = [];

  const ids = collectAllCardIds(state);
  if (new Set(ids).size !== ids.length) {
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    violations.push(`Duplicate card IDs: [${[...new Set(dupes)].join(", ")}]`);
  }

  if (state.numPlayers !== state.players.length) {
    violations.push(
      `numPlayers (${state.numPlayers}) !== players.length (${state.players.length})`,
    );
  }

  for (let p = 0; p < state.numPlayers; p++) {
    const zones = state.players[p]!;

    if (zones.hand.length < 0) {
      violations.push(`Player ${p} has negative hand size`);
    }

    const hasSuccessor = zones.successor !== null;
    const hasDungeon = zones.dungeon !== null;
    if (hasSuccessor !== hasDungeon && state.phase !== "resolving" && state.phase !== "end_of_turn") {
      violations.push(
        `Player ${p}: successor/dungeon mismatch (successor=${hasSuccessor}, dungeon=${hasDungeon})`,
      );
    }
  }

  if (state.activePlayer < 0 || state.activePlayer >= state.numPlayers) {
    violations.push(
      `activePlayer ${state.activePlayer} is outside valid range [0, ${state.numPlayers})`,
    );
  }

  for (const mod of state.modifiers) {
    const sourceInCourt = state.shared.court.some(
      (e) => e.card.id === mod.sourceCardId && e.face === "up",
    );
    if (!sourceInCourt) {
      violations.push(
        `Modifier source card ${mod.sourceCardId} is not face-up in court`,
      );
    }
  }

  return violations;
};
