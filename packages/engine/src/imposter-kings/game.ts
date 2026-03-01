import type { GameDef, GameType, Observer, PlayerId } from "@imposter-zero/types";

import type { IKAction } from "./actions.js";
import { regulationDeck } from "./card.js";
import { deal, type RandomSource } from "./deal.js";
import { apply, currentPlayer, isTerminal, legalActions, returns } from "./rules.js";
import { playerZones, throne, type IKState } from "./state.js";
import { throneValue } from "./selectors.js";

export const IMPOSTER_KINGS_GAME_TYPE: GameType = {
  name: "imposter_kings",
  dynamics: "sequential",
  chanceMode: "sampled_stochastic",
  information: "imperfect",
  minPlayers: 2,
  maxPlayers: 4,
};

export const createImposterKingsGame = (
  randomSource?: RandomSource,
): GameDef<IKState, IKAction> => ({
  gameType: IMPOSTER_KINGS_GAME_TYPE,
  create: (numPlayers) => deal(regulationDeck(numPlayers), numPlayers, randomSource),
  currentPlayer,
  legalActions,
  apply,
  isTerminal,
  returns,
});

export const ImposterKingsGame: GameDef<IKState, IKAction> = createImposterKingsGame();

export const ImposterKingsObserver: Observer<IKState> = {
  observationTensor: (state, player) => {
    const perspective = playerZones(state, player);
    const activeOneHot = Array.from({ length: state.numPlayers }, (_, p) =>
      p === state.activePlayer ? 1 : 0,
    );
    return [
      ...activeOneHot,
      perspective.hand.length,
      perspective.king.face === "up" ? 1 : 0,
      perspective.successor === null ? 0 : 1,
      perspective.dungeon === null ? 0 : 1,
      throneValue(state),
      state.shared.court.length,
      state.shared.accused === null ? 0 : state.shared.accused.kind.props.value,
      state.shared.forgotten === null ? 0 : 1,
    ];
  },
  informationStateString: (state, player: PlayerId) => {
    const perspective = playerZones(state, player);
    const top = throne(state);
    const hand = perspective.hand
      .map((card) => `${card.kind.name}:${card.kind.props.value}`)
      .join(",");
    const throneText =
      top === null
        ? "none"
        : `${top.card.kind.name}:${top.face === "down" ? 1 : top.card.kind.props.value}:${top.face}`;
    return [
      `phase=${state.phase}`,
      `active=${state.activePlayer}`,
      `player=${player}`,
      `hand=[${hand}]`,
      `kingFace=${perspective.king.face}`,
      `successor=${perspective.successor === null ? "none" : "set"}`,
      `dungeon=${perspective.dungeon === null ? "none" : "set"}`,
      `throne=${throneText}`,
      `courtSize=${state.shared.court.length}`,
      `accused=${state.shared.accused === null ? "none" : state.shared.accused.kind.name}`,
      `forgotten=${state.shared.forgotten === null ? "none" : "set"}`,
    ].join(";");
  },
};
