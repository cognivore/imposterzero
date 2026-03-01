/**
 * Generic game runtime — pure functions over any GameDef.
 * No game-specific logic lives here.
 */

import type { GameDef, ActivePlayer } from "@imposter-zero/types";

export const step = <S, A>(game: GameDef<S, A>, state: S, action: A): S =>
  game.apply(state, action);

export type ActionSelector<S, A> = (
  state: S,
  legal: ReadonlyArray<A>,
  player: ActivePlayer,
) => A;

export interface GameTrace<S, A> {
  readonly history: ReadonlyArray<{
    readonly state: S;
    readonly action: A;
  }>;
  readonly finalState: S;
  readonly returns: ReadonlyArray<number>;
}

export const playGame = <S, A>(
  game: GameDef<S, A>,
  numPlayers: number,
  select: ActionSelector<S, A>,
): GameTrace<S, A> => {
  const history: Array<{ state: S; action: A }> = [];
  let state = game.create(numPlayers);

  while (!game.isTerminal(state)) {
    const player = game.currentPlayer(state);
    const legal = game.legalActions(state);
    const action = select(state, legal, player);
    history.push({ state, action });
    state = game.apply(state, action);
  }

  return { history, finalState: state, returns: game.returns(state) };
};

export const randomSelector =
  <S, A>(): ActionSelector<S, A> =>
  (_state, legal, _player) =>
    legal[Math.floor(Math.random() * legal.length)]!;
