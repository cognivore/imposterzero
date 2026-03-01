import type { IKState } from "./state.js";

const collectAllCardIds = (state: IKState): number[] => {
  const ids: number[] = [];
  for (const p of state.players) {
    ids.push(...p.hand.map((c) => c.id));
    ids.push(p.king.card.id);
    if (p.successor) ids.push(p.successor.card.id);
    if (p.dungeon) ids.push(p.dungeon.card.id);
  }
  for (const e of state.shared.court) ids.push(e.card.id);
  if (state.shared.accused) ids.push(state.shared.accused.id);
  if (state.shared.forgotten) ids.push(state.shared.forgotten.card.id);
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
    if (hasSuccessor !== hasDungeon) {
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

  return violations;
};
