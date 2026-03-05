"""
Imposter Zero — OpenSpiel game definition.

Faithful port of the TypeScript engine (packages/engine/src/imposter-kings).
Phases: crown (select first player) -> setup (commit successor + dungeon) -> play.
Terminal: active player has no legal play actions during play phase.

Registers two game variants:
  - imposter_zero      (2-player, ZERO_SUM)
  - imposter_zero_3p   (3-player, GENERAL_SUM)

Action codec layout (matches TS encodeAction/decodeAction):
  0                            -> disgrace
  [1, maxCardId+1]            -> play(cardId = encoded - 1)
  [maxCardId+2, ...]          -> commit(succ, dung) as 2D grid
  [crownBase, ...]            -> crown(firstPlayer)
"""

import random

import pyspiel

# ---------------------------------------------------------------------------
# Card definitions — mirrors card.ts
# ---------------------------------------------------------------------------

_BASE_DECK = [
    ("Fool", 1),
    ("Assassin", 2),
    ("Elder", 3), ("Elder", 3),
    ("Zealot", 3),
    ("Inquisitor", 4), ("Inquisitor", 4),
    ("Soldier", 5), ("Soldier", 5),
    ("Judge", 5),
    ("Oathbound", 6), ("Oathbound", 6),
    ("Immortal", 6),
    ("Warlord", 7),
    ("Mystic", 7),
    ("Warden", 7),
    ("Sentry", 8),
    ("King's Hand", 8),
    ("Princess", 9),
    ("Queen", 9),
]

_THREE_PLAYER_EXTRAS = [
    ("Executioner", 4),
    ("Bard", 4), ("Bard", 4),
    ("Herald", 6),
    ("Spy", 8),
]

_FOUR_PLAYER_EXTRAS = [
    ("Fool", 1),
    ("Assassin", 2),
    ("Executioner", 4),
    ("Arbiter", 5),
]


def _regulation_deck(num_players):
    if num_players == 2:
        return list(_BASE_DECK)
    if num_players == 3:
        return list(_BASE_DECK) + list(_THREE_PLAYER_EXTRAS)
    return list(_BASE_DECK) + list(_THREE_PLAYER_EXTRAS) + list(_FOUR_PLAYER_EXTRAS)


def _reserve_count(num_players):
    return 1 if num_players == 4 else 2


# ---------------------------------------------------------------------------
# Action codec — mirrors actions.ts
# ---------------------------------------------------------------------------

_DISGRACE_SLOT = 0
_PLAY_OFFSET = 1


def _max_card_id(deck_size, num_players):
    return deck_size + num_players - 1


def _span(max_card_id):
    return max_card_id + 1


def _commit_base(max_card_id):
    return _PLAY_OFFSET + max_card_id + 1


def _crown_base(max_card_id):
    s = _span(max_card_id)
    return _commit_base(max_card_id) + s * s


def _num_distinct_actions(max_card_id, num_players):
    return _crown_base(max_card_id) + num_players


def _encode_play(card_id):
    return _PLAY_OFFSET + card_id


def _encode_disgrace():
    return _DISGRACE_SLOT


def _encode_commit(successor_id, dungeon_id, max_card_id):
    stride = _span(max_card_id)
    return _commit_base(max_card_id) + successor_id * stride + dungeon_id


def _encode_crown_action(first_player, max_card_id):
    return _crown_base(max_card_id) + first_player


def _decode_action(encoded, max_card_id, num_players):
    """Returns (kind, *args): ('disgrace',) | ('play', cardId) | ('commit', s, d) | ('crown', p)."""
    if encoded == _DISGRACE_SLOT:
        return ("disgrace",)

    s = _span(max_card_id)
    play_max = _PLAY_OFFSET + max_card_id
    if encoded <= play_max:
        return ("play", encoded - _PLAY_OFFSET)

    cb = _commit_base(max_card_id)
    commit_slots = s * s
    commit_max = cb + commit_slots - 1
    if encoded <= commit_max:
        offset = encoded - cb
        successor_id = offset // s
        dungeon_id = offset % s
        return ("commit", successor_id, dungeon_id)

    crb = _crown_base(max_card_id)
    crown_player = encoded - crb
    if 0 <= crown_player < num_players:
        return ("crown", crown_player)

    raise ValueError(f"Cannot decode action {encoded} (maxCardId={max_card_id}, numPlayers={num_players})")


# ---------------------------------------------------------------------------
# Per-variant dimension helpers
# ---------------------------------------------------------------------------

def _game_dims(num_players):
    deck = _regulation_deck(num_players)
    deck_size = len(deck)
    max_cid = _max_card_id(deck_size, num_players)
    max_hand = (deck_size - _reserve_count(num_players)) // num_players
    max_setup = num_players
    max_play = 2 * max_hand + num_players
    max_length = 1 + max_setup + max_play
    return {
        "deck_size": deck_size,
        "max_card_id": max_cid,
        "num_actions": _num_distinct_actions(max_cid, num_players),
        "max_game_length": max_length,
    }


_DIMS_2P = _game_dims(2)
_DIMS_3P = _game_dims(3)

# ---------------------------------------------------------------------------
# 2-player registration (ZERO_SUM)
# ---------------------------------------------------------------------------

_GAME_TYPE_2P = pyspiel.GameType(
    short_name="imposter_zero",
    long_name="Imposter Zero",
    dynamics=pyspiel.GameType.Dynamics.SEQUENTIAL,
    chance_mode=pyspiel.GameType.ChanceMode.SAMPLED_STOCHASTIC,
    information=pyspiel.GameType.Information.IMPERFECT_INFORMATION,
    utility=pyspiel.GameType.Utility.ZERO_SUM,
    reward_model=pyspiel.GameType.RewardModel.TERMINAL,
    max_num_players=2,
    min_num_players=2,
    provides_information_state_string=True,
    provides_information_state_tensor=True,
    provides_observation_string=True,
    provides_observation_tensor=True,
)

_GAME_INFO_2P = pyspiel.GameInfo(
    num_distinct_actions=_DIMS_2P["num_actions"],
    max_chance_outcomes=0,
    num_players=2,
    min_utility=-1.0,
    max_utility=1.0,
    utility_sum=0.0,
    max_game_length=_DIMS_2P["max_game_length"],
)

# ---------------------------------------------------------------------------
# 3-player registration (GENERAL_SUM — returns {-1, 0, +1}, not zero-sum)
# ---------------------------------------------------------------------------

_GAME_TYPE_3P = pyspiel.GameType(
    short_name="imposter_zero_3p",
    long_name="Imposter Zero (3 players)",
    dynamics=pyspiel.GameType.Dynamics.SEQUENTIAL,
    chance_mode=pyspiel.GameType.ChanceMode.SAMPLED_STOCHASTIC,
    information=pyspiel.GameType.Information.IMPERFECT_INFORMATION,
    utility=pyspiel.GameType.Utility.GENERAL_SUM,
    reward_model=pyspiel.GameType.RewardModel.TERMINAL,
    max_num_players=3,
    min_num_players=3,
    provides_information_state_string=True,
    provides_information_state_tensor=True,
    provides_observation_string=True,
    provides_observation_tensor=True,
)

_GAME_INFO_3P = pyspiel.GameInfo(
    num_distinct_actions=_DIMS_3P["num_actions"],
    max_chance_outcomes=0,
    num_players=3,
    min_utility=-1.0,
    max_utility=1.0,
    max_game_length=_DIMS_3P["max_game_length"],
)


# ---------------------------------------------------------------------------
# Game and State
# ---------------------------------------------------------------------------

class ImposterZeroGame(pyspiel.Game):
    def __init__(self, params=None):
        game_type = self._resolve_game_type()
        game_info = self._resolve_game_info()
        super().__init__(game_type, game_info, params or {})
        self._seed = int(params.get("seed", -1)) if params else -1
        self._np = game_info.num_players

    @classmethod
    def _resolve_game_type(cls):
        return _GAME_TYPE_2P

    @classmethod
    def _resolve_game_info(cls):
        return _GAME_INFO_2P

    def new_initial_state(self):
        return ImposterZeroState(self, num_players=self._np, seed=self._seed)

    def observation_tensor_size(self):
        return self._np + 12

    def information_state_tensor_size(self):
        return self._np + 12


class ImposterZeroGame3P(ImposterZeroGame):
    @classmethod
    def _resolve_game_type(cls):
        return _GAME_TYPE_3P

    @classmethod
    def _resolve_game_info(cls):
        return _GAME_INFO_3P


class ImposterZeroState(pyspiel.State):
    def __init__(self, game, num_players=2, seed=-1):
        super().__init__(game)
        self._num_players = num_players

        deck_kinds = _regulation_deck(self._num_players)
        self._deck_size = len(deck_kinds)
        self._max_card_id = _max_card_id(self._deck_size, self._num_players)

        rng = random.Random(seed) if seed >= 0 else random.Random()
        self._deal(deck_kinds, rng)

    def _deal(self, deck_kinds, rng):
        self._first_player = rng.randint(0, self._num_players - 1)

        cards = list(range(self._deck_size))
        rng.shuffle(cards)

        self._card_values = {}
        self._card_names = {}
        for card_id in range(self._deck_size):
            name, value = deck_kinds[card_id]
            self._card_values[card_id] = value
            self._card_names[card_id] = name

        king_base = self._deck_size
        for p in range(self._num_players):
            kid = king_base + p
            self._card_values[kid] = 0
            self._card_names[kid] = "King"

        reserved = _reserve_count(self._num_players)
        if self._num_players == 4:
            self._accused = cards[-1]
            self._forgotten = None
        else:
            self._accused = cards[-2]
            self._forgotten = cards[-1]

        playable = cards[:len(cards) - reserved]
        self._hands = [[] for _ in range(self._num_players)]
        for i, card_id in enumerate(playable):
            self._hands[i % self._num_players].append(card_id)

        self._king_face_up = [True] * self._num_players
        self._successors = [None] * self._num_players
        self._dungeons = [None] * self._num_players
        self._court = []
        self._phase = "crown"
        self._active_player = self._first_player
        self._turn_count = 0

    # -- Cloning --

    def _clone_impl(self):
        cloned = ImposterZeroState.__new__(ImposterZeroState)
        pyspiel.State.__init__(cloned, self.get_game())

        cloned._num_players = self._num_players
        cloned._deck_size = self._deck_size
        cloned._max_card_id = self._max_card_id
        cloned._first_player = self._first_player
        cloned._card_values = self._card_values
        cloned._card_names = self._card_names
        cloned._accused = self._accused
        cloned._forgotten = self._forgotten
        cloned._hands = [list(h) for h in self._hands]
        cloned._king_face_up = list(self._king_face_up)
        cloned._successors = list(self._successors)
        cloned._dungeons = list(self._dungeons)
        cloned._court = list(self._court)
        cloned._phase = self._phase
        cloned._active_player = self._active_player
        cloned._turn_count = self._turn_count

        return cloned

    # -- OpenSpiel interface --

    def current_player(self):
        if self._phase == "play" and not self._legal_actions_internal():
            return pyspiel.PlayerId.TERMINAL
        return self._active_player

    def _legal_actions_internal(self):
        p = self._active_player

        if self._phase == "crown":
            return sorted(
                _encode_crown_action(fp, self._max_card_id)
                for fp in range(self._num_players)
            )

        if self._phase == "setup":
            if self._successors[p] is not None:
                return []
            hand = self._hands[p]
            actions = []
            for s in hand:
                for d in hand:
                    if s != d:
                        actions.append(_encode_commit(s, d, self._max_card_id))
            return sorted(actions)

        threshold = self._throne_value()
        hand = self._hands[p]
        actions = []
        for card_id in hand:
            if self._card_values[card_id] >= threshold:
                actions.append(_encode_play(card_id))

        if self._king_face_up[p] and len(self._court) > 0:
            actions.append(_encode_disgrace())

        return sorted(actions)

    def legal_actions(self, player=None):
        if self.is_terminal():
            return []
        return self._legal_actions_internal()

    def _apply_action(self, action):
        decoded = _decode_action(action, self._max_card_id, self._num_players)

        if decoded[0] == "crown":
            self._apply_crown(decoded[1])
        elif decoded[0] == "commit":
            self._apply_commit(decoded[1], decoded[2])
        elif decoded[0] == "play":
            self._apply_play(decoded[1])
        else:
            self._apply_disgrace()

    def _apply_crown(self, first_player):
        self._first_player = first_player
        self._active_player = first_player
        self._phase = "setup"
        self._turn_count += 1

    def _apply_commit(self, successor_id, dungeon_id):
        p = self._active_player
        self._hands[p] = [c for c in self._hands[p] if c not in (successor_id, dungeon_id)]
        self._successors[p] = successor_id
        self._dungeons[p] = dungeon_id
        self._active_player = (self._active_player + 1) % self._num_players
        self._turn_count += 1

        if all(s is not None for s in self._successors):
            self._phase = "play"
            self._active_player = self._first_player

    def _apply_play(self, card_id):
        p = self._active_player
        self._hands[p] = [c for c in self._hands[p] if c != card_id]
        self._court.append((card_id, True, p))
        self._active_player = (self._active_player + 1) % self._num_players
        self._turn_count += 1

    def _apply_disgrace(self):
        p = self._active_player
        self._king_face_up[p] = False

        if self._court:
            card_id, _, played_by = self._court[-1]
            self._court[-1] = (card_id, False, played_by)

        self._active_player = (self._active_player + 1) % self._num_players
        self._turn_count += 1

    def _throne_value(self):
        if not self._court:
            return 0
        card_id, face_up, _ = self._court[-1]
        return self._card_values[card_id] if face_up else 1

    def is_terminal(self):
        if self._phase != "play":
            return False
        return len(self._legal_actions_internal()) == 0

    def returns(self):
        if not self.is_terminal():
            return [0.0] * self._num_players

        stuck = self._active_player
        winner = (stuck - 1 + self._num_players) % self._num_players
        result = [0.0] * self._num_players
        result[winner] = 1.0
        result[stuck] = -1.0
        return result

    def _action_to_string(self, player, action):
        decoded = _decode_action(action, self._max_card_id, self._num_players)
        if decoded[0] == "crown":
            return f"p{player}:crown({decoded[1]})"
        if decoded[0] == "commit":
            s_name = self._card_names.get(decoded[1], f"?{decoded[1]}")
            d_name = self._card_names.get(decoded[2], f"?{decoded[2]}")
            return f"p{player}:commit({s_name},{d_name})"
        if decoded[0] == "play":
            c_name = self._card_names.get(decoded[1], f"?{decoded[1]}")
            return f"p{player}:play({c_name})"
        return f"p{player}:disgrace"

    def information_state_string(self, player=None):
        if player is None:
            player = self._active_player
        hand = self._hands[player]
        hand_str = ",".join(
            f"{self._card_names[c]}:{self._card_values[c]}" for c in hand
        )
        throne_str = "none"
        if self._court:
            cid, face_up, _ = self._court[-1]
            val = self._card_values[cid] if face_up else 1
            throne_str = f"{self._card_names[cid]}:{val}:{'up' if face_up else 'down'}"

        return ";".join([
            f"phase={self._phase}",
            f"active={self._active_player}",
            f"firstPlayer={self._first_player}",
            f"player={player}",
            f"hand=[{hand_str}]",
            f"kingFace={'up' if self._king_face_up[player] else 'down'}",
            f"successor={'set' if self._successors[player] is not None else 'none'}",
            f"dungeon={'set' if self._dungeons[player] is not None else 'none'}",
            f"throne={throne_str}",
            f"courtSize={len(self._court)}",
            f"accused={'none' if self._accused is None else self._card_names[self._accused]}",
            f"forgotten={'none' if self._forgotten is None else 'set'}",
        ])

    def observation_string(self, player=None):
        return self.information_state_string(player)

    def information_state_tensor(self, player=None):
        if player is None:
            player = self._active_player
        hand = self._hands[player]
        active_one_hot = [1.0 if p == self._active_player else 0.0 for p in range(self._num_players)]
        phase_one_hot = [
            1.0 if self._phase == "crown" else 0.0,
            1.0 if self._phase == "setup" else 0.0,
            1.0 if self._phase == "play" else 0.0,
        ]
        return active_one_hot + phase_one_hot + [
            float(len(hand)),
            1.0 if self._king_face_up[player] else 0.0,
            1.0 if self._successors[player] is not None else 0.0,
            1.0 if self._dungeons[player] is not None else 0.0,
            float(self._throne_value()),
            float(len(self._court)),
            float(self._card_values[self._accused]) if self._accused is not None else 0.0,
            1.0 if self._forgotten is not None else 0.0,
            float(self._first_player),
        ]

    def observation_tensor(self, player=None):
        return self.information_state_tensor(player)

    def __str__(self):
        return (
            f"ImposterZero(phase={self._phase}, player={self._active_player}, "
            f"firstPlayer={self._first_player}, turn={self._turn_count}, "
            f"court={len(self._court)}, terminal={self.is_terminal()})"
        )


# Keep module-level constants for backward compatibility with train.py / tests
_NUM_PLAYERS = 2
_DECK_2P = _regulation_deck(2)
_MAX_CARD_ID_2P = _max_card_id(len(_DECK_2P), _NUM_PLAYERS)

pyspiel.register_game(_GAME_TYPE_2P, ImposterZeroGame)
pyspiel.register_game(_GAME_TYPE_3P, ImposterZeroGame3P)
