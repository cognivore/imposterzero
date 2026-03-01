"""
Imposter Zero — OpenSpiel game definition.

Mirrors the TypeScript GameDef<S, A> protocol:
  - create(n)          -> initial state
  - currentPlayer(s)   -> active player
  - legalActions(s)    -> available actions
  - apply(s, a)        -> next state
  - isTerminal(s)      -> bool
  - returns(s)         -> per-player utilities

Populate this file as game rules are defined.
"""

import numpy as np
import pyspiel

_NUM_PLAYERS = 2

_GAME_TYPE = pyspiel.GameType(
    short_name="imposter_zero",
    long_name="Imposter Zero",
    dynamics=pyspiel.GameType.Dynamics.SEQUENTIAL,
    chance_mode=pyspiel.GameType.ChanceMode.EXPLICIT_STOCHASTIC,
    information=pyspiel.GameType.Information.IMPERFECT_INFORMATION,
    utility=pyspiel.GameType.Utility.ZERO_SUM,
    reward_model=pyspiel.GameType.RewardModel.TERMINAL,
    max_num_players=_NUM_PLAYERS,
    min_num_players=_NUM_PLAYERS,
    provides_information_state_string=True,
    provides_information_state_tensor=True,
    provides_observation_string=True,
    provides_observation_tensor=True,
)

_GAME_INFO = pyspiel.GameInfo(
    num_distinct_actions=1,  # placeholder
    max_chance_outcomes=0,   # placeholder
    num_players=_NUM_PLAYERS,
    min_utility=-1.0,
    max_utility=1.0,
    utility_sum=0.0,
    max_game_length=1,       # placeholder
)


class ImposterZeroGame(pyspiel.Game):
    def __init__(self, params=None):
        super().__init__(_GAME_TYPE, _GAME_INFO, params or {})

    def new_initial_state(self):
        return ImposterZeroState(self)


class ImposterZeroState(pyspiel.State):
    def __init__(self, game):
        super().__init__(game)
        self._game_over = False
        self._current_player = 0

    def current_player(self):
        if self._game_over:
            return pyspiel.PlayerId.TERMINAL
        return self._current_player

    def legal_actions(self, player=None):
        if self._game_over:
            return []
        return [0]

    def _apply_action(self, action):
        self._game_over = True

    def _action_to_string(self, player, action):
        return f"p{player}:a{action}"

    def is_terminal(self):
        return self._game_over

    def returns(self):
        return [0.0] * self.get_game().num_players()

    def __str__(self):
        return f"ImposterZero(player={self._current_player}, terminal={self._game_over})"


pyspiel.register_game(_GAME_TYPE, ImposterZeroGame)
