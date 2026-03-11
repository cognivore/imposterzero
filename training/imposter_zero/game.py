"""
Imposter Zero — OpenSpiel game definition (effects-enabled).

Faithful port of the TypeScript engine (packages/engine/src/imposter-kings).
Phases: crown (select first player) -> setup (commit successor + dungeon) -> play.
Terminal: active player has no legal play actions during play phase.

Card effects are auto-resolved inside _apply_action using heuristic choices.
This keeps the OpenSpiel action space identical (no effect_choice actions)
while approximating the full game's strategic dynamics.

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

_ROYALTY_NAMES = frozenset({"Princess", "Queen"})
_ANTECHAMBER_SUPPRESSED = frozenset({"Herald"})


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
        return self._np + 15

    def information_state_tensor_size(self):
        return self._np + 15


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

        self._antechamber = [[] for _ in range(self._num_players)]
        self._parting = [[] for _ in range(self._num_players)]
        self._condemned = []
        self._soldier_bonus = {}
        self._eliminated = set()

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

        cloned._antechamber = [list(a) for a in self._antechamber]
        cloned._parting = [list(p) for p in self._parting]
        cloned._condemned = list(self._condemned)
        cloned._soldier_bonus = dict(self._soldier_bonus)
        cloned._eliminated = set(self._eliminated)

        return cloned

    # -- Continuous modifier helpers --

    def _immortal_in_court(self):
        return any(
            self._card_names[cid] == "Immortal" and fu
            for cid, fu, _ in self._court
        )

    def _is_royalty(self, card_id):
        name = self._card_names[card_id]
        if name in _ROYALTY_NAMES:
            return True
        if name == "Warlord" and self._immortal_in_court():
            return True
        return False

    def _court_has_royalty(self):
        return any(fu and self._is_royalty(cid) for cid, fu, _ in self._court)

    def _throne_is_royalty(self):
        if not self._court:
            return False
        cid, fu, _ = self._court[-1]
        return fu and self._is_royalty(cid)

    def _court_has_disgraced(self):
        return any(not fu for _, fu, _ in self._court)

    def _faceup_court_count(self):
        return sum(1 for _, fu, _ in self._court if fu)

    def _effective_court_value(self, card_id):
        name = self._card_names[card_id]
        base = self._card_values[card_id]
        if name == "Immortal":
            base = 5
        if name == "Warlord" and self._court_has_royalty():
            base += 2
        if name != "Immortal" and self._immortal_in_court():
            if self._is_royalty(card_id) or name == "Elder":
                base -= 1
        base += self._soldier_bonus.get(card_id, 0)
        return max(base, 0)

    def _throne_value(self):
        if not self._court:
            return 0
        card_id, face_up, _ = self._court[-1]
        if not face_up:
            return 1
        return self._effective_court_value(card_id)

    # -- Play legality --

    def _can_play_card(self, card_id, threshold):
        val = self._card_values[card_id]
        name = self._card_names[card_id]
        if val >= threshold:
            return True
        if name == "Elder" and self._throne_is_royalty():
            return True
        if name == "Zealot" and not self._king_face_up[self._active_player]:
            if self._court and not self._throne_is_royalty():
                return True
        if name == "Oathbound" and self._court:
            top_cid, top_fu, _ = self._court[-1]
            top_val = self._effective_court_value(top_cid) if top_fu else 1
            if top_fu and top_val > val and len(self._hands[self._active_player]) >= 2:
                return True
        return False

    # -- Heuristic helpers for auto-resolving effects --

    def _opponents(self, player):
        return [(player + 1 + i) % self._num_players for i in range(self._num_players - 1)]

    def _heuristic_name_card(self, player):
        """Pick the card name most likely in opponent hands."""
        deck = _regulation_deck(self._num_players)
        counts = {}
        for name, _ in deck:
            counts[name] = counts.get(name, 0) + 1
        for c in self._hands[player]:
            n = self._card_names[c]
            counts[n] = counts.get(n, 0) - 1
        for cid, fu, _ in self._court:
            if fu:
                n = self._card_names[cid]
                counts[n] = counts.get(n, 0) - 1
        candidates = {n: c for n, c in counts.items() if c > 0 and n != "King"}
        if not candidates:
            return "Soldier"
        return max(candidates, key=lambda n: (candidates[n], n))

    def _heuristic_name_value(self, player, max_val):
        """Pick the value most likely in opponent hands, up to max_val."""
        deck = _regulation_deck(self._num_players)
        counts = {}
        for _, val in deck:
            if val <= max_val:
                counts[val] = counts.get(val, 0) + 1
        for c in self._hands[player]:
            v = self._card_values[c]
            if v in counts:
                counts[v] -= 1
        for cid, fu, _ in self._court:
            if fu:
                v = self._card_values[cid]
                if v in counts:
                    counts[v] -= 1
        candidates = {v: c for v, c in counts.items() if c > 0}
        if not candidates:
            return min(max_val, 5)
        return max(candidates, key=lambda v: (candidates[v], v))

    # -- Auto-resolved card effects --

    def _resolve_on_play(self, card_id, player, source):
        name = self._card_names[card_id]
        if source == "antechamber" and name in _ANTECHAMBER_SUPPRESSED:
            return
        resolver = _EFFECT_DISPATCH.get(name)
        if resolver:
            resolver(self, card_id, player)

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

        # Play phase — forced actions first
        if self._parting[p]:
            return sorted(_encode_play(c) for c in self._parting[p])

        if self._antechamber[p]:
            return sorted(_encode_play(c) for c in self._antechamber[p])

        threshold = self._throne_value()
        hand = self._hands[p]
        actions = []
        for card_id in hand:
            if self._can_play_card(card_id, threshold):
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

        if card_id in self._parting[p]:
            self._parting[p].remove(card_id)
            self._condemned.append(card_id)
            self._advance_turn()
            return

        source = "hand"
        if card_id in self._antechamber[p]:
            self._antechamber[p].remove(card_id)
            source = "antechamber"
        else:
            self._hands[p] = [c for c in self._hands[p] if c != card_id]

        self._court.append((card_id, True, p))
        self._resolve_on_play(card_id, p, source)
        self._end_of_turn()

    def _apply_disgrace(self):
        p = self._active_player
        self._king_face_up[p] = False

        if self._court:
            card_id, _, played_by = self._court[-1]
            self._court[-1] = (card_id, False, played_by)

        if self._successors[p] is not None:
            self._hands[p].append(self._successors[p])
            self._successors[p] = None

        self._end_of_turn()

    def _end_of_turn(self):
        """Auto-play active player's antechamber, then advance."""
        p = self._active_player
        while self._antechamber[p]:
            best = max(self._antechamber[p], key=lambda c: self._card_values[c])
            self._antechamber[p] = [c for c in self._antechamber[p] if c != best]
            self._court.append((best, True, p))
            name = self._card_names[best]
            if name not in _ANTECHAMBER_SUPPRESSED:
                self._resolve_on_play(best, p, "antechamber")
        self._advance_turn()

    def _advance_turn(self):
        self._active_player = (self._active_player + 1) % self._num_players
        self._turn_count += 1
        self._soldier_bonus.clear()

        if self._num_players > 2:
            attempts = 0
            while (
                self._active_player in self._eliminated
                and attempts < self._num_players
            ):
                self._active_player = (self._active_player + 1) % self._num_players
                attempts += 1

            remaining = self._num_players - len(self._eliminated)
            if remaining > 2 and not self._legal_actions_internal():
                self._eliminated.add(self._active_player)
                self._advance_turn()

    def is_terminal(self):
        if self._phase != "play":
            return False
        return len(self._legal_actions_internal()) == 0

    def returns(self):
        if not self.is_terminal():
            return [0.0] * self._num_players

        stuck = self._active_player
        winner = (stuck - 1 + self._num_players) % self._num_players
        while winner in self._eliminated:
            winner = (winner - 1 + self._num_players) % self._num_players
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
            val = self._effective_court_value(cid) if face_up else 1
            throne_str = f"{self._card_names[cid]}:{val}:{'up' if face_up else 'down'}"

        ante_count = len(self._antechamber[player])
        parting_count = len(self._parting[player])
        condemned_count = len(self._condemned)

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
            f"ante={ante_count}",
            f"parting={parting_count}",
            f"condemned={condemned_count}",
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
        ante_count = len(self._antechamber[player])
        condemned_count = len(self._condemned)
        disgraced_count = sum(1 for _, fu, _ in self._court if not fu)
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
            float(ante_count),
            float(condemned_count),
            float(disgraced_count),
        ]

    def observation_tensor(self, player=None):
        return self.information_state_tensor(player)

    def __str__(self):
        return (
            f"ImposterZero(phase={self._phase}, player={self._active_player}, "
            f"firstPlayer={self._first_player}, turn={self._turn_count}, "
            f"court={len(self._court)}, terminal={self.is_terminal()})"
        )


# ---------------------------------------------------------------------------
# Auto-resolved card effects
# ---------------------------------------------------------------------------

def _effect_queen(state, card_id, _player):
    """Disgrace all other face-up court cards."""
    state._court = [
        (cid, False if cid != card_id and fu else fu, pb)
        for cid, fu, pb in state._court
    ]


def _effect_fool(state, card_id, player):
    """Take the highest-value face-up court card (not self)."""
    best_idx = -1
    best_val = -1
    for i, (cid, fu, _) in enumerate(state._court):
        if cid != card_id and fu:
            val = state._effective_court_value(cid)
            if val > best_val:
                best_val = val
                best_idx = i
    if best_idx >= 0:
        taken_cid = state._court[best_idx][0]
        state._court.pop(best_idx)
        state._hands[player].append(taken_cid)


def _effect_inquisitor(state, card_id, player):
    """Name a card; opponents with it play to antechamber."""
    name = state._heuristic_name_card(player)
    for opp in state._opponents(player):
        matching = [c for c in state._hands[opp] if state._card_names[c] == name]
        if matching:
            target = matching[0]
            state._hands[opp] = [c for c in state._hands[opp] if c != target]
            state._antechamber[opp].append(target)


def _effect_soldier(state, card_id, player):
    """Name a card; if opponent has it, +2 value and disgrace up to 3."""
    name = state._heuristic_name_card(player)
    hit = any(
        any(state._card_names[c] == name for c in state._hands[opp])
        for opp in state._opponents(player)
    )
    if hit:
        state._soldier_bonus[card_id] = 2
        targets = [
            (i, cid) for i, (cid, fu, _) in enumerate(state._court)
            if cid != card_id and fu
        ]
        targets.sort(key=lambda t: state._card_values[t[1]])
        for idx, _ in targets[:3]:
            cid_t, _, pb_t = state._court[idx]
            state._court[idx] = (cid_t, False, pb_t)


def _effect_judge(state, card_id, player):
    """Guess opponent's card for bonus play to antechamber."""
    opps = state._opponents(player)
    if not opps:
        return
    opp = opps[0]
    name = state._heuristic_name_card(player)
    if any(state._card_names[c] == name for c in state._hands[opp]):
        eligible = [c for c in state._hands[player] if state._card_values[c] >= 2]
        if eligible:
            target = min(eligible, key=lambda c: state._card_values[c])
            state._hands[player] = [c for c in state._hands[player] if c != target]
            state._antechamber[player].append(target)


def _effect_oathbound(state, card_id, player):
    """If played on higher value, disgrace below and force play lowest hand card."""
    if len(state._court) < 2:
        return
    below_cid, below_fu, below_pb = state._court[-2]
    my_val = state._card_values[card_id]
    below_val = state._effective_court_value(below_cid) if below_fu else 1
    if below_val <= my_val:
        return
    idx = len(state._court) - 2
    state._court[idx] = (below_cid, False, below_pb)
    if state._hands[player]:
        forced = min(state._hands[player], key=lambda c: state._card_values[c])
        state._hands[player] = [c for c in state._hands[player] if c != forced]
        state._court.append((forced, True, player))
        state._resolve_on_play(forced, player, "hand")


def _effect_mystic(state, card_id, player):
    """If disgraced in court, disgrace self."""
    if not state._court_has_disgraced():
        return
    for i, (cid, fu, pb) in enumerate(state._court):
        if cid == card_id:
            state._court[i] = (cid, False, pb)
            break


def _effect_warden(state, card_id, player):
    """If 4+ faceup in court, swap lowest hand card with accused."""
    if state._faceup_court_count() < 4 or state._accused is None:
        return
    if not state._hands[player]:
        return
    lowest = min(state._hands[player], key=lambda c: state._card_values[c])
    state._hands[player] = [c for c in state._hands[player] if c != lowest]
    state._hands[player].append(state._accused)
    state._accused = lowest


def _effect_sentry(state, card_id, player):
    """Disgrace self, swap lowest hand card with best non-royalty court card."""
    for i, (cid, fu, pb) in enumerate(state._court):
        if cid == card_id:
            state._court[i] = (cid, False, pb)
            break
    candidates = [
        (i, cid) for i, (cid, fu, _) in enumerate(state._court)
        if cid != card_id and fu and not state._is_royalty(cid)
    ]
    if not candidates or not state._hands[player]:
        return
    best_idx, best_cid = max(
        candidates, key=lambda t: state._effective_court_value(t[1])
    )
    lowest = min(state._hands[player], key=lambda c: state._card_values[c])
    state._hands[player] = [c for c in state._hands[player] if c != lowest]
    state._hands[player].append(best_cid)
    _, _, best_pb = state._court[best_idx]
    state._court[best_idx] = (lowest, True, best_pb)


def _effect_princess(state, card_id, player):
    """Swap lowest hand card with a card from the weakest opponent."""
    opps = state._opponents(player)
    if not opps or not state._hands[player]:
        return
    opp = min(opps, key=lambda o: len(state._hands[o]))
    if not state._hands[opp]:
        return
    give = min(state._hands[player], key=lambda c: state._card_values[c])
    take = state._hands[opp][0]
    state._hands[player] = [c for c in state._hands[player] if c != give]
    state._hands[player].append(take)
    state._hands[opp] = [c for c in state._hands[opp] if c != take]
    state._hands[opp].append(give)


def _effect_executioner(state, card_id, player):
    """Name a value; all condemn a card of that value."""
    max_court_val = max(
        (state._card_values[cid] for cid, fu, _ in state._court if fu),
        default=0,
    )
    if max_court_val < 1:
        return
    target_val = state._heuristic_name_value(player, max_court_val)
    for p in range(state._num_players):
        matching = [c for c in state._hands[p] if state._card_values[c] == target_val]
        if matching:
            victim = matching[0]
            state._hands[p] = [c for c in state._hands[p] if c != victim]
            state._condemned.append(victim)


def _effect_herald(state, card_id, player):
    """Swap successor into hand, place new lowest card as successor."""
    if state._successors[player] is None:
        return
    succ = state._successors[player]
    state._hands[player].append(succ)
    if state._hands[player]:
        new_succ = min(state._hands[player], key=lambda c: state._card_values[c])
        state._hands[player] = [c for c in state._hands[player] if c != new_succ]
        state._successors[player] = new_succ


def _effect_spy(state, card_id, player):
    """Disgrace self (conservative: skip successor swap)."""
    for i, (cid, fu, pb) in enumerate(state._court):
        if cid == card_id:
            state._court[i] = (cid, False, pb)
            break


_EFFECT_DISPATCH = {
    "Queen": _effect_queen,
    "Fool": _effect_fool,
    "Inquisitor": _effect_inquisitor,
    "Soldier": _effect_soldier,
    "Judge": _effect_judge,
    "Oathbound": _effect_oathbound,
    "Mystic": _effect_mystic,
    "Warden": _effect_warden,
    "Sentry": _effect_sentry,
    "Princess": _effect_princess,
    "Executioner": _effect_executioner,
    "Herald": _effect_herald,
    "Spy": _effect_spy,
}

# Keep module-level constants for backward compatibility with train.py / tests
_NUM_PLAYERS = 2
_DECK_2P = _regulation_deck(2)
_MAX_CARD_ID_2P = _max_card_id(len(_DECK_2P), _NUM_PLAYERS)

pyspiel.register_game(_GAME_TYPE_2P, ImposterZeroGame)
pyspiel.register_game(_GAME_TYPE_3P, ImposterZeroGame3P)
