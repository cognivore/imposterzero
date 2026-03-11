"""
Imposter Zero — OpenSpiel game definitions.

Three game variants:
  - imposter_zero       (2p single round, ZERO_SUM)
  - imposter_zero_3p    (3p single round, GENERAL_SUM)
  - imposter_zero_match (2p full expansion match: draft+mustering+multi-round)

Card effects are auto-resolved inside _apply_action using heuristic choices.
Recommission and squire selection are auto-resolved heuristics.

Match action codec (extends base):
  0                            -> disgrace
  [1, maxCardId+1]            -> play(cardId)
  [commitBase, ...]           -> commit(succ, dung) as 2D grid
  [crownBase, ...]            -> crown(firstPlayer)
  [selectKingBase, +2]        -> select_king(0=charismatic, 1=tactician)
  [endMusteringSlot]          -> end_mustering
  [beginRecruitBase, +span]   -> begin_recruit(cardId)
  [recruitBase, +span^2]      -> recruit(discardId, takeId) grid
  [draftSelectBase, +9]       -> draft_select(sigIdx)
  [draftOrderBase, +2]        -> draft_order(goFirst)
  [draftPickBase, +9]         -> draft_pick(sigIdx)
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

_BASE_ARMY = [
    ("Elder", 3),
    ("Inquisitor", 4),
    ("Soldier", 5),
    ("Judge", 5),
    ("Oathbound", 6),
]

_SIGNATURE_POOL = [
    ("Flagbearer", 1),
    ("Stranger", 2),
    ("Aegis", 3),
    ("Ancestor", 4),
    ("Informant", 4),
    ("Nakturn", 4),
    ("Lockshift", 5),
    ("Conspiracist", 6),
    ("Exile", 8),
]

_SIGNATURE_NAMES = [name for name, _ in _SIGNATURE_POOL]
_N_SIGNATURES = len(_SIGNATURE_NAMES)
_SIGS_PER_PLAYER = 3

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
# Base action codec — shared between round and match variants
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
    if encoded == _DISGRACE_SLOT:
        return ("disgrace",)
    s = _span(max_card_id)
    play_max = _PLAY_OFFSET + max_card_id
    if encoded <= play_max:
        return ("play", encoded - _PLAY_OFFSET)
    cb = _commit_base(max_card_id)
    if encoded < cb + s * s:
        offset = encoded - cb
        return ("commit", offset // s, offset % s)
    crb = _crown_base(max_card_id)
    if encoded < crb + num_players:
        return ("crown", encoded - crb)
    raise ValueError(f"Cannot decode action {encoded}")


# ---------------------------------------------------------------------------
# Match action codec extensions
# ---------------------------------------------------------------------------

def _select_king_base(max_card_id, num_players):
    return _crown_base(max_card_id) + num_players


def _end_mustering_slot(max_card_id, num_players):
    return _select_king_base(max_card_id, num_players) + 2


def _begin_recruit_base(max_card_id, num_players):
    return _end_mustering_slot(max_card_id, num_players) + 1


def _recruit_base(max_card_id, num_players):
    return _begin_recruit_base(max_card_id, num_players) + _span(max_card_id)


def _draft_select_base(max_card_id, num_players):
    s = _span(max_card_id)
    return _recruit_base(max_card_id, num_players) + s * s


def _draft_order_base(max_card_id, num_players):
    return _draft_select_base(max_card_id, num_players) + _N_SIGNATURES


def _draft_pick_base(max_card_id, num_players):
    return _draft_order_base(max_card_id, num_players) + 2


def _num_match_actions(max_card_id, num_players):
    return _draft_pick_base(max_card_id, num_players) + _N_SIGNATURES


def _encode_select_king(facet_idx, max_card_id, num_players):
    return _select_king_base(max_card_id, num_players) + facet_idx


def _encode_end_mustering(max_card_id, num_players):
    return _end_mustering_slot(max_card_id, num_players)


def _encode_begin_recruit(card_id, max_card_id, num_players):
    return _begin_recruit_base(max_card_id, num_players) + card_id


def _encode_recruit(discard_id, take_id, max_card_id, num_players):
    s = _span(max_card_id)
    return _recruit_base(max_card_id, num_players) + discard_id * s + take_id


def _encode_draft_select(sig_idx, max_card_id, num_players):
    return _draft_select_base(max_card_id, num_players) + sig_idx


def _encode_draft_order(go_first, max_card_id, num_players):
    return _draft_order_base(max_card_id, num_players) + (0 if go_first else 1)


def _encode_draft_pick(sig_idx, max_card_id, num_players):
    return _draft_pick_base(max_card_id, num_players) + sig_idx


def _decode_match_action(encoded, max_card_id, num_players):
    crb = _crown_base(max_card_id)
    if encoded < crb + num_players:
        return _decode_action(encoded, max_card_id, num_players)

    skb = _select_king_base(max_card_id, num_players)
    if encoded < skb + 2:
        return ("select_king", encoded - skb)

    ems = _end_mustering_slot(max_card_id, num_players)
    if encoded == ems:
        return ("end_mustering",)

    brb = _begin_recruit_base(max_card_id, num_players)
    s = _span(max_card_id)
    if encoded < brb + s:
        return ("begin_recruit", encoded - brb)

    rcb = _recruit_base(max_card_id, num_players)
    if encoded < rcb + s * s:
        offset = encoded - rcb
        return ("recruit", offset // s, offset % s)

    dsb = _draft_select_base(max_card_id, num_players)
    if encoded < dsb + _N_SIGNATURES:
        return ("draft_select", encoded - dsb)

    dob = _draft_order_base(max_card_id, num_players)
    if encoded < dob + 2:
        return ("draft_order", encoded - dob == 0)

    dpb = _draft_pick_base(max_card_id, num_players)
    if encoded < dpb + _N_SIGNATURES:
        return ("draft_pick", encoded - dpb)

    raise ValueError(f"Cannot decode match action {encoded}")


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


def _match_dims(num_players):
    deck = _regulation_deck(num_players)
    deck_size = len(deck)
    max_army_per_player = len(_BASE_ARMY) + _SIGS_PER_PLAYER
    total_army = max_army_per_player * num_players
    max_cid = deck_size + num_players + total_army - 1
    return {
        "deck_size": deck_size,
        "max_card_id": max_cid,
        "num_actions": _num_match_actions(max_cid, num_players),
        "max_game_length": 800,
    }


_DIMS_2P = _game_dims(2)
_DIMS_3P = _game_dims(3)
_DIMS_MATCH = _match_dims(2)

# ---------------------------------------------------------------------------
# Game registrations (types)
# ---------------------------------------------------------------------------

_GAME_TYPE_2P = pyspiel.GameType(
    short_name="imposter_zero",
    long_name="Imposter Zero",
    dynamics=pyspiel.GameType.Dynamics.SEQUENTIAL,
    chance_mode=pyspiel.GameType.ChanceMode.SAMPLED_STOCHASTIC,
    information=pyspiel.GameType.Information.IMPERFECT_INFORMATION,
    utility=pyspiel.GameType.Utility.ZERO_SUM,
    reward_model=pyspiel.GameType.RewardModel.TERMINAL,
    max_num_players=2, min_num_players=2,
    provides_information_state_string=True,
    provides_information_state_tensor=True,
    provides_observation_string=True,
    provides_observation_tensor=True,
)

_GAME_INFO_2P = pyspiel.GameInfo(
    num_distinct_actions=_DIMS_2P["num_actions"],
    max_chance_outcomes=0, num_players=2,
    min_utility=-1.0, max_utility=1.0, utility_sum=0.0,
    max_game_length=_DIMS_2P["max_game_length"],
)

_GAME_TYPE_3P = pyspiel.GameType(
    short_name="imposter_zero_3p",
    long_name="Imposter Zero (3 players)",
    dynamics=pyspiel.GameType.Dynamics.SEQUENTIAL,
    chance_mode=pyspiel.GameType.ChanceMode.SAMPLED_STOCHASTIC,
    information=pyspiel.GameType.Information.IMPERFECT_INFORMATION,
    utility=pyspiel.GameType.Utility.GENERAL_SUM,
    reward_model=pyspiel.GameType.RewardModel.TERMINAL,
    max_num_players=3, min_num_players=3,
    provides_information_state_string=True,
    provides_information_state_tensor=True,
    provides_observation_string=True,
    provides_observation_tensor=True,
)

_GAME_INFO_3P = pyspiel.GameInfo(
    num_distinct_actions=_DIMS_3P["num_actions"],
    max_chance_outcomes=0, num_players=3,
    min_utility=-1.0, max_utility=1.0,
    max_game_length=_DIMS_3P["max_game_length"],
)

_GAME_TYPE_MATCH = pyspiel.GameType(
    short_name="imposter_zero_match",
    long_name="Imposter Zero (2p expansion match)",
    dynamics=pyspiel.GameType.Dynamics.SEQUENTIAL,
    chance_mode=pyspiel.GameType.ChanceMode.SAMPLED_STOCHASTIC,
    information=pyspiel.GameType.Information.IMPERFECT_INFORMATION,
    utility=pyspiel.GameType.Utility.ZERO_SUM,
    reward_model=pyspiel.GameType.RewardModel.TERMINAL,
    max_num_players=2, min_num_players=2,
    provides_information_state_string=True,
    provides_information_state_tensor=True,
    provides_observation_string=True,
    provides_observation_tensor=True,
)

_GAME_INFO_MATCH = pyspiel.GameInfo(
    num_distinct_actions=_DIMS_MATCH["num_actions"],
    max_chance_outcomes=0, num_players=2,
    min_utility=-1.0, max_utility=1.0, utility_sum=0.0,
    max_game_length=_DIMS_MATCH["max_game_length"],
)


# ---------------------------------------------------------------------------
# Round-only game classes (backward compat — imposter_zero / imposter_zero_3p)
# ---------------------------------------------------------------------------

class ImposterZeroGame(pyspiel.Game):
    def __init__(self, params=None):
        gt = self._resolve_game_type()
        gi = self._resolve_game_info()
        super().__init__(gt, gi, params or {})
        self._seed = int(params.get("seed", -1)) if params else -1
        self._np = gi.num_players

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
    """Single-round game state (backward compat)."""

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

    def _clone_impl(self):
        c = ImposterZeroState.__new__(ImposterZeroState)
        pyspiel.State.__init__(c, self.get_game())
        for attr in (
            "_num_players", "_deck_size", "_max_card_id", "_first_player",
            "_card_values", "_card_names", "_accused", "_forgotten",
            "_phase", "_active_player", "_turn_count",
        ):
            setattr(c, attr, getattr(self, attr))
        c._hands = [list(h) for h in self._hands]
        c._king_face_up = list(self._king_face_up)
        c._successors = list(self._successors)
        c._dungeons = list(self._dungeons)
        c._court = list(self._court)
        c._antechamber = [list(a) for a in self._antechamber]
        c._parting = [list(p) for p in self._parting]
        c._condemned = list(self._condemned)
        c._soldier_bonus = dict(self._soldier_bonus)
        c._eliminated = set(self._eliminated)
        return c

    def _immortal_in_court(self):
        return any(self._card_names[cid] == "Immortal" and fu for cid, fu, _ in self._court)

    def _is_royalty(self, card_id):
        name = self._card_names[card_id]
        if name in _ROYALTY_NAMES:
            return True
        return name == "Warlord" and self._immortal_in_court()

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
        return 1 if not face_up else self._effective_court_value(card_id)

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

    def _opponents(self, player):
        return [(player + 1 + i) % self._num_players for i in range(self._num_players - 1)]

    def _heuristic_name_card(self, player):
        deck = _regulation_deck(self._num_players)
        counts = {}
        for name, _ in deck:
            counts[name] = counts.get(name, 0) + 1
        for c in self._hands[player]:
            counts[self._card_names[c]] = counts.get(self._card_names[c], 0) - 1
        for cid, fu, _ in self._court:
            if fu:
                counts[self._card_names[cid]] = counts.get(self._card_names[cid], 0) - 1
        candidates = {n: v for n, v in counts.items() if v > 0 and n != "King"}
        return max(candidates, key=lambda n: (candidates[n], n)) if candidates else "Soldier"

    def _heuristic_name_value(self, player, max_val):
        deck = _regulation_deck(self._num_players)
        counts = {}
        for _, val in deck:
            if val <= max_val:
                counts[val] = counts.get(val, 0) + 1
        for c in self._hands[player]:
            v = self._card_values[c]
            if v in counts:
                counts[v] -= 1
        candidates = {v: ct for v, ct in counts.items() if ct > 0}
        return max(candidates, key=lambda v: (candidates[v], v)) if candidates else min(max_val, 5)

    def _resolve_on_play(self, card_id, player, source):
        name = self._card_names[card_id]
        if source == "antechamber" and name in _ANTECHAMBER_SUPPRESSED:
            return
        resolver = _EFFECT_DISPATCH.get(name)
        if resolver:
            resolver(self, card_id, player)

    def current_player(self):
        if self._phase == "play" and not self._legal_actions_internal():
            return pyspiel.PlayerId.TERMINAL
        return self._active_player

    def _legal_actions_internal(self):
        p = self._active_player
        if self._phase == "crown":
            return sorted(_encode_crown_action(fp, self._max_card_id) for fp in range(self._num_players))
        if self._phase == "setup":
            if self._successors[p] is not None:
                return []
            return sorted(_encode_commit(s, d, self._max_card_id) for s in self._hands[p] for d in self._hands[p] if s != d)
        if self._parting[p]:
            return sorted(_encode_play(c) for c in self._parting[p])
        if self._antechamber[p]:
            return sorted(_encode_play(c) for c in self._antechamber[p])
        threshold = self._throne_value()
        actions = [_encode_play(c) for c in self._hands[p] if self._can_play_card(c, threshold)]
        if self._king_face_up[p] and self._court:
            actions.append(_encode_disgrace())
        return sorted(actions)

    def legal_actions(self, player=None):
        return [] if self.is_terminal() else self._legal_actions_internal()

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
        self._active_player = (p + 1) % self._num_players
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
            cid, _, pb = self._court[-1]
            self._court[-1] = (cid, False, pb)
        if self._successors[p] is not None:
            self._hands[p].append(self._successors[p])
            self._successors[p] = None
        self._end_of_turn()

    def _end_of_turn(self):
        p = self._active_player
        while self._antechamber[p]:
            best = max(self._antechamber[p], key=lambda c: self._card_values[c])
            self._antechamber[p] = [c for c in self._antechamber[p] if c != best]
            self._court.append((best, True, p))
            if self._card_names[best] not in _ANTECHAMBER_SUPPRESSED:
                self._resolve_on_play(best, p, "antechamber")
        self._advance_turn()

    def _advance_turn(self):
        self._active_player = (self._active_player + 1) % self._num_players
        self._turn_count += 1
        self._soldier_bonus.clear()
        if self._num_players > 2:
            attempts = 0
            while self._active_player in self._eliminated and attempts < self._num_players:
                self._active_player = (self._active_player + 1) % self._num_players
                attempts += 1
            remaining = self._num_players - len(self._eliminated)
            if remaining > 2 and not self._legal_actions_internal():
                self._eliminated.add(self._active_player)
                self._advance_turn()

    def is_terminal(self):
        return self._phase == "play" and not self._legal_actions_internal()

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
        d = _decode_action(action, self._max_card_id, self._num_players)
        if d[0] == "crown":
            return f"p{player}:crown({d[1]})"
        if d[0] == "commit":
            return f"p{player}:commit({self._card_names.get(d[1],'?')},{self._card_names.get(d[2],'?')})"
        if d[0] == "play":
            return f"p{player}:play({self._card_names.get(d[1],'?')})"
        return f"p{player}:disgrace"

    def information_state_string(self, player=None):
        if player is None:
            player = self._active_player
        hand_str = ",".join(f"{self._card_names[c]}:{self._card_values[c]}" for c in self._hands[player])
        throne_str = "none"
        if self._court:
            cid, fu, _ = self._court[-1]
            val = self._effective_court_value(cid) if fu else 1
            throne_str = f"{self._card_names[cid]}:{val}:{'up' if fu else 'down'}"
        return ";".join([
            f"phase={self._phase}", f"active={self._active_player}",
            f"player={player}", f"hand=[{hand_str}]",
            f"kingFace={'up' if self._king_face_up[player] else 'down'}",
            f"throne={throne_str}", f"courtSize={len(self._court)}",
        ])

    def observation_string(self, player=None):
        return self.information_state_string(player)

    def information_state_tensor(self, player=None):
        if player is None:
            player = self._active_player
        hand = self._hands[player]
        active_oh = [1.0 if p == self._active_player else 0.0 for p in range(self._num_players)]
        phase_oh = [float(self._phase == ph) for ph in ("crown", "setup", "play")]
        return active_oh + phase_oh + [
            float(len(hand)),
            float(self._king_face_up[player]),
            float(self._successors[player] is not None),
            float(self._dungeons[player] is not None),
            float(self._throne_value()),
            float(len(self._court)),
            float(self._card_values[self._accused]) if self._accused is not None else 0.0,
            float(self._forgotten is not None),
            float(self._first_player),
            float(len(self._antechamber[player])),
            float(len(self._condemned)),
            float(sum(1 for _, fu, _ in self._court if not fu)),
        ]

    def observation_tensor(self, player=None):
        return self.information_state_tensor(player)

    def __str__(self):
        return f"ImposterZero(phase={self._phase}, player={self._active_player}, court={len(self._court)})"


# ---------------------------------------------------------------------------
# Full expansion match game — imposter_zero_match
# ---------------------------------------------------------------------------

_TARGET_SCORE = 7


class ImposterZeroMatchGame(pyspiel.Game):
    def __init__(self, params=None):
        super().__init__(_GAME_TYPE_MATCH, _GAME_INFO_MATCH, params or {})
        self._seed = int(params.get("seed", -1)) if params else -1

    def new_initial_state(self):
        return ImposterZeroMatchState(self, seed=self._seed)

    def observation_tensor_size(self):
        return 25

    def information_state_tensor_size(self):
        return 25


class ImposterZeroMatchState(pyspiel.State):
    """Full expansion match: draft -> (crown -> mustering -> setup -> play) x rounds."""

    def __init__(self, game, seed=-1):
        super().__init__(game)
        self._num_players = 2
        self._rng = random.Random(seed) if seed >= 0 else random.Random()

        deck_kinds = _regulation_deck(2)
        self._deck_size = len(deck_kinds)
        self._deck_kinds = deck_kinds
        max_army = (len(_BASE_ARMY) + _SIGS_PER_PLAYER) * 2
        self._max_card_id = self._deck_size + self._num_players + max_army - 1

        self._match_scores = [0, 0]
        self._rounds_played = 0
        self._true_king = self._rng.randint(0, 1)

        self._draft_phase = "select"
        self._draft_selections = [[], []]
        self._draft_face_up = []
        self._draft_picker_order = []
        self._draft_picks_remaining = []
        self._draft_current_picker_idx = 0

        self._army_kinds = [[], []]
        self._army_exhausted_kinds = [[], []]

        self._phase = "draft_select"
        self._active_player = 0
        self._turn_count = 0

        self._card_values = {}
        self._card_names = {}
        self._hands = [[], []]
        self._king_face_up = [True, True]
        self._king_facets = ["default", "default"]
        self._successors = [None, None]
        self._dungeons = [None, None]
        self._court = []
        self._accused = None
        self._forgotten = None
        self._antechamber = [[], []]
        self._parting = [[], []]
        self._condemned = []
        self._soldier_bonus = {}
        self._eliminated = set()

        self._army_ids = [[], []]
        self._exhausted_ids = [[], []]
        self._has_exhausted_this_mustering = False
        self._mustering_players_done = 0
        self._army_recruited_ids = []
        self._recruit_discard_ids = [[], []]
        self._first_player = self._true_king

    def _build_armies(self):
        base = list(_BASE_ARMY)
        for p in range(2):
            kinds = list(base)
            for sig_name in self._draft_selections[p]:
                entry = next((n, v) for n, v in _SIGNATURE_POOL if n == sig_name)
                kinds.append(entry)
            self._army_kinds[p] = kinds
            self._army_exhausted_kinds[p] = []

    def _deal_round(self):
        cards = list(range(self._deck_size))
        self._rng.shuffle(cards)

        self._card_values = {}
        self._card_names = {}
        for card_id in range(self._deck_size):
            name, value = self._deck_kinds[card_id]
            self._card_values[card_id] = value
            self._card_names[card_id] = name

        king_base = self._deck_size
        for p in range(2):
            kid = king_base + p
            self._card_values[kid] = 0
            self._card_names[kid] = "King"

        self._accused = cards[-2]
        self._forgotten = cards[-1]
        playable = cards[:-2]
        self._hands = [[], []]
        for i, cid in enumerate(playable):
            self._hands[i % 2].append(cid)

        next_id = self._deck_size + 2
        self._army_ids = [[], []]
        self._exhausted_ids = [[], []]
        for p in range(2):
            for name, value in self._army_kinds[p]:
                self._card_values[next_id] = value
                self._card_names[next_id] = name
                self._army_ids[p].append(next_id)
                next_id += 1
            for name, value in self._army_exhausted_kinds[p]:
                self._card_values[next_id] = value
                self._card_names[next_id] = name
                self._exhausted_ids[p].append(next_id)
                next_id += 1

        self._king_face_up = [True, True]
        self._king_facets = ["default", "default"]
        self._successors = [None, None]
        self._dungeons = [None, None]
        self._court = []
        self._antechamber = [[], []]
        self._parting = [[], []]
        self._condemned = []
        self._soldier_bonus = {}
        self._eliminated = set()
        self._has_exhausted_this_mustering = False
        self._mustering_players_done = 0
        self._army_recruited_ids = []
        self._recruit_discard_ids = [[], []]

        self._phase = "crown"
        self._active_player = self._true_king
        self._first_player = self._true_king

    def _round_score(self):
        stuck = self._active_player
        winner = 1 - stuck
        scores = [0, 0]
        scores[winner] += 1
        if self._king_face_up[winner]:
            scores[winner] += 1
        has_resources = len(self._hands[stuck]) > 0 or self._successors[stuck] is not None
        if has_resources:
            scores[winner] += 1
        return scores

    def _exhaust_army_post_round(self):
        for p in range(2):
            new_available = []
            new_exhausted = list(self._army_exhausted_kinds[p])
            recruited_set = set(self._army_recruited_ids)
            for i, cid in enumerate(self._army_ids[p]):
                kind = (self._card_names[cid], self._card_values[cid])
                if cid in recruited_set:
                    new_exhausted.append(kind)
                else:
                    new_available.append(kind)
            for cid in self._recruit_discard_ids[p]:
                kind = (self._card_names[cid], self._card_values[cid])
                new_available.append(kind)
            self._army_kinds[p] = new_available
            self._army_exhausted_kinds[p] = new_exhausted

    def _finish_round(self):
        rs = self._round_score()
        self._match_scores[0] += rs[0]
        self._match_scores[1] += rs[1]
        self._rounds_played += 1
        stuck = self._active_player
        self._true_king = stuck
        self._exhaust_army_post_round()

        if max(self._match_scores) >= _TARGET_SCORE:
            self._phase = "match_over"
            return

        self._deal_round()

    # -- Shared helpers (same interface as round state for effects) --

    def _immortal_in_court(self):
        return any(self._card_names.get(cid) == "Immortal" and fu for cid, fu, _ in self._court)

    def _is_royalty(self, card_id):
        name = self._card_names.get(card_id, "")
        if name in _ROYALTY_NAMES:
            return True
        return name == "Warlord" and self._immortal_in_court()

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
        name = self._card_names.get(card_id, "")
        base = self._card_values.get(card_id, 0)
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
        cid, fu, _ = self._court[-1]
        return 1 if not fu else self._effective_court_value(cid)

    def _can_play_card(self, card_id, threshold):
        val = self._card_values.get(card_id, 0)
        name = self._card_names.get(card_id, "")
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

    def _opponents(self, player):
        return [(player + 1 + i) % self._num_players for i in range(self._num_players - 1)]

    def _heuristic_name_card(self, player):
        deck = _regulation_deck(2)
        counts = {}
        for name, _ in deck:
            counts[name] = counts.get(name, 0) + 1
        for c in self._hands[player]:
            counts[self._card_names.get(c, "")] = counts.get(self._card_names.get(c, ""), 0) - 1
        for cid, fu, _ in self._court:
            if fu:
                counts[self._card_names.get(cid, "")] = counts.get(self._card_names.get(cid, ""), 0) - 1
        candidates = {n: v for n, v in counts.items() if v > 0 and n != "King" and n}
        return max(candidates, key=lambda n: (candidates[n], n)) if candidates else "Soldier"

    def _heuristic_name_value(self, player, max_val):
        deck = _regulation_deck(2)
        counts = {}
        for _, val in deck:
            if val <= max_val:
                counts[val] = counts.get(val, 0) + 1
        for c in self._hands[player]:
            v = self._card_values.get(c, 0)
            if v in counts:
                counts[v] -= 1
        candidates = {v: ct for v, ct in counts.items() if ct > 0}
        return max(candidates, key=lambda v: (candidates[v], v)) if candidates else min(max_val, 5)

    def _resolve_on_play(self, card_id, player, source):
        name = self._card_names.get(card_id, "")
        if source == "antechamber" and name in _ANTECHAMBER_SUPPRESSED:
            return
        resolver = _EFFECT_DISPATCH.get(name)
        if resolver:
            resolver(self, card_id, player)

    # -- OpenSpiel interface --

    def current_player(self):
        if self._phase == "match_over":
            return pyspiel.PlayerId.TERMINAL
        if self._phase == "play" and not self._play_legal_actions():
            return pyspiel.PlayerId.TERMINAL
        return self._active_player

    def _play_legal_actions(self):
        p = self._active_player
        if self._parting[p]:
            return sorted(_encode_play(c) for c in self._parting[p])
        if self._antechamber[p]:
            return sorted(_encode_play(c) for c in self._antechamber[p])
        threshold = self._throne_value()
        actions = [_encode_play(c) for c in self._hands[p] if self._can_play_card(c, threshold)]
        if self._king_face_up[p] and self._court:
            actions.append(_encode_disgrace())
        return sorted(actions)

    def _legal_actions_internal(self):
        p = self._active_player
        mcid = self._max_card_id
        np = self._num_players

        if self._phase == "draft_select":
            taken = set(self._draft_selections[0] + self._draft_selections[1])
            return sorted(
                _encode_draft_select(i, mcid, np)
                for i, name in enumerate(_SIGNATURE_NAMES)
                if name not in taken
            )

        if self._phase == "draft_order":
            return [
                _encode_draft_order(True, mcid, np),
                _encode_draft_order(False, mcid, np),
            ]

        if self._phase == "draft_pick":
            return sorted(
                _encode_draft_pick(i, mcid, np)
                for i, name in enumerate(_SIGNATURE_NAMES)
                if name in self._draft_face_up
            )

        if self._phase == "crown":
            return sorted(_encode_crown_action(fp, mcid) for fp in range(np))

        if self._phase == "mustering":
            actions = []
            if self._king_facets[p] == "default":
                actions.append(_encode_select_king(0, mcid, np))
                actions.append(_encode_select_king(1, mcid, np))
            actions.append(_encode_end_mustering(mcid, np))
            if not self._has_exhausted_this_mustering and self._army_ids[p]:
                for cid in self._army_ids[p]:
                    actions.append(_encode_begin_recruit(cid, mcid, np))
            if self._has_exhausted_this_mustering and self._army_ids[p] and self._hands[p]:
                for hid in self._hands[p]:
                    for aid in self._army_ids[p]:
                        actions.append(_encode_recruit(hid, aid, mcid, np))
            return sorted(actions)

        if self._phase == "setup":
            if self._successors[p] is not None:
                return []
            return sorted(
                _encode_commit(s, d, mcid)
                for s in self._hands[p] for d in self._hands[p] if s != d
            )

        if self._phase == "play":
            return self._play_legal_actions()

        return []

    def legal_actions(self, player=None):
        return [] if self.is_terminal() else self._legal_actions_internal()

    def _apply_action(self, action):
        d = _decode_match_action(action, self._max_card_id, self._num_players)
        kind = d[0]

        if kind == "draft_select":
            self._apply_draft_select(d[1])
        elif kind == "draft_order":
            self._apply_draft_order(d[1])
        elif kind == "draft_pick":
            self._apply_draft_pick(d[1])
        elif kind == "crown":
            self._apply_crown(d[1])
        elif kind == "select_king":
            self._apply_select_king(d[1])
        elif kind == "end_mustering":
            self._apply_end_mustering()
        elif kind == "begin_recruit":
            self._apply_begin_recruit(d[1])
        elif kind == "recruit":
            self._apply_recruit(d[1], d[2])
        elif kind == "commit":
            self._apply_commit(d[1], d[2])
        elif kind == "play":
            self._apply_play(d[1])
        elif kind == "disgrace":
            self._apply_disgrace()

    def _apply_draft_select(self, sig_idx):
        name = _SIGNATURE_NAMES[sig_idx]
        p = self._active_player
        self._draft_selections[p].append(name)
        self._turn_count += 1

        other = 1 - p
        needed = 1
        if len(self._draft_selections[other]) < needed:
            self._active_player = other
            return

        taken = set(self._draft_selections[0] + self._draft_selections[1])
        remaining = [n for n in _SIGNATURE_NAMES if n not in taken]
        self._rng.shuffle(remaining)
        self._draft_face_up = remaining[:5]
        non_true_king = 1 - self._true_king
        self._active_player = non_true_king
        self._phase = "draft_order"

    def _apply_draft_order(self, go_first):
        non_tk = 1 - self._true_king
        first_picker = non_tk if go_first else self._true_king
        second_picker = 1 - first_picker
        self._draft_picker_order = [first_picker, second_picker, first_picker]
        self._draft_picks_remaining = [1, 2, 1]
        self._draft_current_picker_idx = 0
        self._active_player = self._draft_picker_order[0]
        self._phase = "draft_pick"
        self._turn_count += 1

    def _apply_draft_pick(self, sig_idx):
        name = _SIGNATURE_NAMES[sig_idx]
        picker = self._draft_picker_order[self._draft_current_picker_idx]
        self._draft_selections[picker].append(name)
        self._draft_face_up = [n for n in self._draft_face_up if n != name]
        self._draft_picks_remaining[self._draft_current_picker_idx] -= 1
        self._turn_count += 1

        if self._draft_picks_remaining[self._draft_current_picker_idx] <= 0:
            self._draft_current_picker_idx += 1

        if self._draft_current_picker_idx >= len(self._draft_picker_order):
            self._build_armies()
            self._deal_round()
            return

        self._active_player = self._draft_picker_order[self._draft_current_picker_idx]

    def _apply_crown(self, first_player):
        self._first_player = first_player
        has_army = any(len(a) > 0 for a in self._army_ids)
        if has_army:
            self._phase = "mustering"
            self._active_player = (first_player - 1 + 2) % 2
            self._has_exhausted_this_mustering = False
            self._mustering_players_done = 0
        else:
            self._phase = "setup"
            self._active_player = first_player
        self._turn_count += 1

    def _apply_select_king(self, facet_idx):
        facets = ["charismatic", "masterTactician"]
        self._king_facets[self._active_player] = facets[facet_idx]
        self._turn_count += 1

    def _apply_end_mustering(self):
        self._mustering_players_done += 1
        self._has_exhausted_this_mustering = False
        self._turn_count += 1
        if self._mustering_players_done >= self._num_players:
            self._phase = "setup"
            self._active_player = self._first_player
            if self._king_facets[self._first_player] == "masterTactician":
                self._auto_assign_squire(self._first_player)
            other = 1 - self._first_player
            if self._king_facets[other] == "masterTactician":
                self._auto_assign_squire(other)
        else:
            self._active_player = (self._active_player - 1 + 2) % 2

    def _auto_assign_squire(self, player):
        pass

    def _apply_begin_recruit(self, card_id):
        p = self._active_player
        if card_id in self._army_ids[p]:
            self._army_ids[p] = [c for c in self._army_ids[p] if c != card_id]
            self._exhausted_ids[p].append(card_id)
            self._has_exhausted_this_mustering = True
        self._turn_count += 1

    def _apply_recruit(self, discard_id, take_id):
        p = self._active_player
        if discard_id in self._hands[p] and take_id in self._army_ids[p]:
            self._hands[p] = [c for c in self._hands[p] if c != discard_id]
            self._recruit_discard_ids[p].append(discard_id)
            self._army_ids[p] = [c for c in self._army_ids[p] if c != take_id]
            self._hands[p].append(take_id)
            self._army_recruited_ids.append(take_id)
        self._turn_count += 1

    def _apply_commit(self, successor_id, dungeon_id):
        p = self._active_player
        self._hands[p] = [c for c in self._hands[p] if c not in (successor_id, dungeon_id)]
        self._successors[p] = successor_id
        self._dungeons[p] = dungeon_id
        self._active_player = (p + 1) % 2
        self._turn_count += 1
        if all(s is not None for s in self._successors):
            self._phase = "play"
            self._active_player = self._first_player

    def _apply_play(self, card_id):
        p = self._active_player
        if card_id in self._parting[p]:
            self._parting[p].remove(card_id)
            self._condemned.append(card_id)
            self._advance_play_turn()
            return
        source = "hand"
        if card_id in self._antechamber[p]:
            self._antechamber[p].remove(card_id)
            source = "antechamber"
        else:
            self._hands[p] = [c for c in self._hands[p] if c != card_id]
        self._court.append((card_id, True, p))
        self._resolve_on_play(card_id, p, source)
        self._end_of_play_turn()

    def _apply_disgrace(self):
        p = self._active_player
        self._king_face_up[p] = False
        if self._court:
            cid, _, pb = self._court[-1]
            self._court[-1] = (cid, False, pb)
        if self._successors[p] is not None:
            self._hands[p].append(self._successors[p])
            self._successors[p] = None
        self._end_of_play_turn()

    def _end_of_play_turn(self):
        p = self._active_player
        while self._antechamber[p]:
            best = max(self._antechamber[p], key=lambda c: self._card_values.get(c, 0))
            self._antechamber[p] = [c for c in self._antechamber[p] if c != best]
            self._court.append((best, True, p))
            if self._card_names.get(best, "") not in _ANTECHAMBER_SUPPRESSED:
                self._resolve_on_play(best, p, "antechamber")
        self._advance_play_turn()

    def _advance_play_turn(self):
        self._active_player = (self._active_player + 1) % 2
        self._turn_count += 1
        self._soldier_bonus.clear()

        if self._phase == "play" and not self._play_legal_actions():
            self._finish_round()

    def is_terminal(self):
        if self._phase == "match_over":
            return True
        if self._phase == "play" and not self._play_legal_actions():
            return True
        return False

    def returns(self):
        if not self.is_terminal():
            return [0.0, 0.0]
        if self._phase != "match_over":
            self._finish_round()
        s0, s1 = self._match_scores
        if s0 > s1:
            return [1.0, -1.0]
        if s1 > s0:
            return [-1.0, 1.0]
        return [0.0, 0.0]

    def _action_to_string(self, player, action):
        d = _decode_match_action(action, self._max_card_id, self._num_players)
        kind = d[0]
        if kind == "draft_select":
            return f"p{player}:draft_select({_SIGNATURE_NAMES[d[1]]})"
        if kind == "draft_order":
            return f"p{player}:draft_order({'first' if d[1] else 'second'})"
        if kind == "draft_pick":
            return f"p{player}:draft_pick({_SIGNATURE_NAMES[d[1]]})"
        if kind == "select_king":
            return f"p{player}:select_king({'charismatic' if d[1]==0 else 'tactician'})"
        if kind == "end_mustering":
            return f"p{player}:end_mustering"
        if kind == "begin_recruit":
            return f"p{player}:begin_recruit({self._card_names.get(d[1],'?')})"
        if kind == "recruit":
            return f"p{player}:recruit({self._card_names.get(d[1],'?')},{self._card_names.get(d[2],'?')})"
        if kind == "crown":
            return f"p{player}:crown({d[1]})"
        if kind == "commit":
            return f"p{player}:commit({self._card_names.get(d[1],'?')},{self._card_names.get(d[2],'?')})"
        if kind == "play":
            return f"p{player}:play({self._card_names.get(d[1],'?')})"
        return f"p{player}:disgrace"

    def information_state_string(self, player=None):
        if player is None:
            player = self._active_player
        parts = [
            f"phase={self._phase}",
            f"active={self._active_player}",
            f"player={player}",
            f"scores={self._match_scores[0]},{self._match_scores[1]}",
            f"round={self._rounds_played}",
        ]
        if self._phase.startswith("draft"):
            parts.append(f"dsel={','.join(self._draft_selections[player])}")
            if self._draft_face_up:
                parts.append(f"faceUp={','.join(self._draft_face_up)}")
        elif self._phase in ("crown", "mustering", "setup", "play"):
            hand_str = ",".join(f"{self._card_names.get(c,'?')}:{self._card_values.get(c,0)}" for c in self._hands[player])
            parts.append(f"hand=[{hand_str}]")
            parts.append(f"kingFace={'up' if self._king_face_up[player] else 'down'}")
            parts.append(f"facet={self._king_facets[player]}")
            parts.append(f"army={len(self._army_ids[player])}")
            if self._court:
                cid, fu, _ = self._court[-1]
                val = self._effective_court_value(cid) if fu else 1
                parts.append(f"throne={self._card_names.get(cid,'?')}:{val}")
            parts.append(f"courtSize={len(self._court)}")
        return ";".join(parts)

    def observation_string(self, player=None):
        return self.information_state_string(player)

    def information_state_tensor(self, player=None):
        if player is None:
            player = self._active_player
        opp = 1 - player
        active_oh = [float(player == self._active_player), float(opp == self._active_player)]
        phase_oh = [float(self._phase == ph) for ph in ("draft_select", "draft_order", "draft_pick", "crown", "mustering", "setup", "play")]
        hand_size = float(len(self._hands[player])) / 9.0
        king_up = float(self._king_face_up[player])
        succ_set = float(self._successors[player] is not None)
        dung_set = float(self._dungeons[player] is not None)
        throne = float(self._throne_value()) / 9.0
        court_sz = float(len(self._court)) / 15.0
        my_score = float(self._match_scores[player]) / 7.0
        opp_score = float(self._match_scores[opp]) / 7.0
        rounds = float(self._rounds_played) / 14.0
        army_avail = float(len(self._army_ids[player])) / 8.0
        army_exh = float(len(self._exhausted_ids[player])) / 8.0
        facet_oh = [
            float(self._king_facets[player] == "default"),
            float(self._king_facets[player] == "masterTactician"),
            float(self._king_facets[player] == "charismatic"),
        ]
        opp_hand = float(len(self._hands[opp])) / 9.0
        opp_king = float(self._king_face_up[opp])
        return (
            active_oh + phase_oh +
            [hand_size, king_up, succ_set, dung_set, throne, court_sz] +
            [my_score, opp_score, rounds, army_avail, army_exh] +
            facet_oh + [opp_hand, opp_king]
        )

    def observation_tensor(self, player=None):
        return self.information_state_tensor(player)

    def _clone_impl(self):
        c = ImposterZeroMatchState.__new__(ImposterZeroMatchState)
        pyspiel.State.__init__(c, self.get_game())
        c._num_players = 2
        c._rng = random.Random()
        c._rng.setstate(self._rng.getstate())
        c._deck_size = self._deck_size
        c._deck_kinds = self._deck_kinds
        c._max_card_id = self._max_card_id
        c._match_scores = list(self._match_scores)
        c._rounds_played = self._rounds_played
        c._true_king = self._true_king
        c._draft_phase = self._draft_phase
        c._draft_selections = [list(s) for s in self._draft_selections]
        c._draft_face_up = list(self._draft_face_up)
        c._draft_picker_order = list(self._draft_picker_order)
        c._draft_picks_remaining = list(self._draft_picks_remaining)
        c._draft_current_picker_idx = self._draft_current_picker_idx
        c._army_kinds = [list(a) for a in self._army_kinds]
        c._army_exhausted_kinds = [list(a) for a in self._army_exhausted_kinds]
        c._phase = self._phase
        c._active_player = self._active_player
        c._turn_count = self._turn_count
        c._card_values = dict(self._card_values)
        c._card_names = dict(self._card_names)
        c._hands = [list(h) for h in self._hands]
        c._king_face_up = list(self._king_face_up)
        c._king_facets = list(self._king_facets)
        c._successors = list(self._successors)
        c._dungeons = list(self._dungeons)
        c._court = list(self._court)
        c._accused = self._accused
        c._forgotten = self._forgotten
        c._antechamber = [list(a) for a in self._antechamber]
        c._parting = [list(p) for p in self._parting]
        c._condemned = list(self._condemned)
        c._soldier_bonus = dict(self._soldier_bonus)
        c._eliminated = set(self._eliminated)
        c._army_ids = [list(a) for a in self._army_ids]
        c._exhausted_ids = [list(a) for a in self._exhausted_ids]
        c._has_exhausted_this_mustering = self._has_exhausted_this_mustering
        c._mustering_players_done = self._mustering_players_done
        c._army_recruited_ids = list(self._army_recruited_ids)
        c._recruit_discard_ids = [list(r) for r in self._recruit_discard_ids]
        c._first_player = self._first_player
        return c

    def __str__(self):
        return (
            f"ImposterZeroMatch(phase={self._phase}, player={self._active_player}, "
            f"scores={self._match_scores}, round={self._rounds_played})"
        )


# ---------------------------------------------------------------------------
# Auto-resolved card effects (shared by both game variants)
# ---------------------------------------------------------------------------

def _effect_queen(state, card_id, _player):
    state._court = [(cid, False if cid != card_id and fu else fu, pb) for cid, fu, pb in state._court]

def _effect_fool(state, card_id, player):
    best_idx, best_val = -1, -1
    for i, (cid, fu, _) in enumerate(state._court):
        if cid != card_id and fu:
            val = state._effective_court_value(cid)
            if val > best_val:
                best_val, best_idx = val, i
    if best_idx >= 0:
        state._hands[player].append(state._court[best_idx][0])
        state._court.pop(best_idx)

def _effect_inquisitor(state, card_id, player):
    name = state._heuristic_name_card(player)
    for opp in state._opponents(player):
        matching = [c for c in state._hands[opp] if state._card_names.get(c) == name]
        if matching:
            t = matching[0]
            state._hands[opp] = [c for c in state._hands[opp] if c != t]
            state._antechamber[opp].append(t)

def _effect_soldier(state, card_id, player):
    name = state._heuristic_name_card(player)
    hit = any(any(state._card_names.get(c) == name for c in state._hands[opp]) for opp in state._opponents(player))
    if hit:
        state._soldier_bonus[card_id] = 2
        targets = [(i, cid) for i, (cid, fu, _) in enumerate(state._court) if cid != card_id and fu]
        targets.sort(key=lambda t: state._card_values.get(t[1], 0))
        for idx, _ in targets[:3]:
            cid_t, _, pb_t = state._court[idx]
            state._court[idx] = (cid_t, False, pb_t)

def _effect_judge(state, card_id, player):
    opps = state._opponents(player)
    if not opps:
        return
    name = state._heuristic_name_card(player)
    if any(state._card_names.get(c) == name for c in state._hands[opps[0]]):
        eligible = [c for c in state._hands[player] if state._card_values.get(c, 0) >= 2]
        if eligible:
            t = min(eligible, key=lambda c: state._card_values.get(c, 0))
            state._hands[player] = [c for c in state._hands[player] if c != t]
            state._antechamber[player].append(t)

def _effect_oathbound(state, card_id, player):
    if len(state._court) < 2:
        return
    below_cid, below_fu, below_pb = state._court[-2]
    my_val = state._card_values.get(card_id, 0)
    below_val = state._effective_court_value(below_cid) if below_fu else 1
    if below_val <= my_val:
        return
    state._court[-2] = (below_cid, False, below_pb)
    if state._hands[player]:
        forced = min(state._hands[player], key=lambda c: state._card_values.get(c, 0))
        state._hands[player] = [c for c in state._hands[player] if c != forced]
        state._court.append((forced, True, player))
        state._resolve_on_play(forced, player, "hand")

def _effect_mystic(state, card_id, player):
    if not state._court_has_disgraced():
        return
    for i, (cid, fu, pb) in enumerate(state._court):
        if cid == card_id:
            state._court[i] = (cid, False, pb)
            break

def _effect_warden(state, card_id, player):
    if state._faceup_court_count() < 4 or state._accused is None or not state._hands[player]:
        return
    lowest = min(state._hands[player], key=lambda c: state._card_values.get(c, 0))
    state._hands[player] = [c for c in state._hands[player] if c != lowest]
    state._hands[player].append(state._accused)
    state._accused = lowest

def _effect_sentry(state, card_id, player):
    for i, (cid, fu, pb) in enumerate(state._court):
        if cid == card_id:
            state._court[i] = (cid, False, pb)
            break
    candidates = [(i, cid) for i, (cid, fu, _) in enumerate(state._court) if cid != card_id and fu and not state._is_royalty(cid)]
    if not candidates or not state._hands[player]:
        return
    best_idx, best_cid = max(candidates, key=lambda t: state._effective_court_value(t[1]))
    lowest = min(state._hands[player], key=lambda c: state._card_values.get(c, 0))
    state._hands[player] = [c for c in state._hands[player] if c != lowest]
    state._hands[player].append(best_cid)
    _, _, best_pb = state._court[best_idx]
    state._court[best_idx] = (lowest, True, best_pb)

def _effect_princess(state, card_id, player):
    opps = state._opponents(player)
    if not opps or not state._hands[player]:
        return
    opp = min(opps, key=lambda o: len(state._hands[o]))
    if not state._hands[opp]:
        return
    give = min(state._hands[player], key=lambda c: state._card_values.get(c, 0))
    take = state._hands[opp][0]
    state._hands[player] = [c for c in state._hands[player] if c != give]
    state._hands[player].append(take)
    state._hands[opp] = [c for c in state._hands[opp] if c != take]
    state._hands[opp].append(give)

def _effect_executioner(state, card_id, player):
    max_cv = max((state._card_values.get(cid, 0) for cid, fu, _ in state._court if fu), default=0)
    if max_cv < 1:
        return
    tv = state._heuristic_name_value(player, max_cv)
    for p in range(state._num_players):
        matching = [c for c in state._hands[p] if state._card_values.get(c, 0) == tv]
        if matching:
            v = matching[0]
            state._hands[p] = [c for c in state._hands[p] if c != v]
            state._condemned.append(v)

def _effect_herald(state, card_id, player):
    if state._successors[player] is None:
        return
    succ = state._successors[player]
    state._hands[player].append(succ)
    if state._hands[player]:
        ns = min(state._hands[player], key=lambda c: state._card_values.get(c, 0))
        state._hands[player] = [c for c in state._hands[player] if c != ns]
        state._successors[player] = ns

def _effect_spy(state, card_id, player):
    for i, (cid, fu, pb) in enumerate(state._court):
        if cid == card_id:
            state._court[i] = (cid, False, pb)
            break

_EFFECT_DISPATCH = {
    "Queen": _effect_queen, "Fool": _effect_fool, "Inquisitor": _effect_inquisitor,
    "Soldier": _effect_soldier, "Judge": _effect_judge, "Oathbound": _effect_oathbound,
    "Mystic": _effect_mystic, "Warden": _effect_warden, "Sentry": _effect_sentry,
    "Princess": _effect_princess, "Executioner": _effect_executioner,
    "Herald": _effect_herald, "Spy": _effect_spy,
}

# ---------------------------------------------------------------------------
# Backward-compat constants and registrations
# ---------------------------------------------------------------------------

_NUM_PLAYERS = 2
_DECK_2P = _regulation_deck(2)
_MAX_CARD_ID_2P = _max_card_id(len(_DECK_2P), _NUM_PLAYERS)

pyspiel.register_game(_GAME_TYPE_2P, ImposterZeroGame)
pyspiel.register_game(_GAME_TYPE_3P, ImposterZeroGame3P)
pyspiel.register_game(_GAME_TYPE_MATCH, ImposterZeroMatchGame)
