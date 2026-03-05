"""
Shared strategic abstraction for Imposter Zero training and inference.

Provides:
  - enriched_obs(state, player)  -- 30-dim feature vector for neural training
  - abstract_state(state, player) -- bucketed state key for tabular MCCFR
  - abstract_action(state, encoded, player) -- bucketed action key
  - group_legal_by_abstract(state, legal, player) -- group concrete -> abstract
  - ABSTRACT_ACTIONS -- canonical list of abstract action keys

All functions work for 2p and 3p (and 4p) by using state._num_players.
"""

from . import game as ig

# ---------------------------------------------------------------------------
# Abstract action keys (shared vocabulary across player counts)
# ---------------------------------------------------------------------------

ABSTRACT_ACTIONS = ["L", "M", "H", "D", "LL", "LH", "HH", "K0", "K1", "K2"]

# ---------------------------------------------------------------------------
# Enriched observation tensor (30 dims for 3p, padded for consistency)
# ---------------------------------------------------------------------------

_ENRICHED_SIZE = 30


def enriched_obs(state, player):
    """30-dim feature vector suitable for neural network input.

    Layout (3p):
      [0..2]   active_player one-hot (3)
      [3..5]   phase one-hot: crown, setup, play (3)
      [6..14]  hand value histogram: count of cards with values 1-9 (9)
      [15]     my king face up (0/1)
      [16]     successor set (0/1)
      [17]     dungeon set (0/1)
      [18]     throne value / 9.0
      [19]     court size / 15.0
      [20]     accused value / 9.0
      [21]     forgotten exists (0/1)
      [22..24] first player one-hot (3)
      [25]     opponent 1 hand size / 9.0
      [26]     opponent 1 king face up (0/1)
      [27]     opponent 2 hand size / 9.0
      [28]     opponent 2 king face up (0/1)
      [29]     (reserved, 0.0)
    """
    n = state._num_players
    hand = state._hands[player]

    active_oh = [0.0] * 3
    if state._active_player < 3:
        active_oh[state._active_player] = 1.0

    phase_oh = [
        1.0 if state._phase == "crown" else 0.0,
        1.0 if state._phase == "setup" else 0.0,
        1.0 if state._phase == "play" else 0.0,
    ]

    hist = [0.0] * 9
    for c in hand:
        v = state._card_values[c]
        if 1 <= v <= 9:
            hist[v - 1] += 1.0

    my_king = 1.0 if state._king_face_up[player] else 0.0
    succ = 1.0 if state._successors[player] is not None else 0.0
    dung = 1.0 if state._dungeons[player] is not None else 0.0
    throne = state._throne_value() / 9.0
    court = len(state._court) / 15.0
    accused = (state._card_values[state._accused] / 9.0) if state._accused is not None else 0.0
    forgotten = 1.0 if state._forgotten is not None else 0.0

    fp_oh = [0.0] * 3
    if state._first_player < 3:
        fp_oh[state._first_player] = 1.0

    opponents = [(player + 1 + i) % n for i in range(n - 1)]
    opp_features = []
    for opp in opponents:
        opp_features.append(len(state._hands[opp]) / 9.0)
        opp_features.append(1.0 if state._king_face_up[opp] else 0.0)
    while len(opp_features) < 4:
        opp_features.append(0.0)

    reserved = 0.0

    return (
        active_oh + phase_oh + hist +
        [my_king, succ, dung, throne, court, accused, forgotten] +
        fp_oh + opp_features + [reserved]
    )


def enriched_obs_size():
    return _ENRICHED_SIZE


# ---------------------------------------------------------------------------
# Bucketed state abstraction
# ---------------------------------------------------------------------------

def _bucket_threshold(tv):
    if tv <= 1:
        return 0
    if tv <= 3:
        return 1
    if tv <= 5:
        return 2
    if tv <= 7:
        return 3
    return 4


def _bucket_playable(n):
    if n == 0:
        return 0
    if n <= 2:
        return 1
    if n <= 4:
        return 2
    return 3


def _bucket_hand(n):
    if n <= 2:
        return 0
    if n <= 4:
        return 1
    if n <= 6:
        return 2
    return 3


def abstract_state(state, player):
    """Bucketed strategic abstraction of the game state.

    Works for any player count. For play phase, encodes minimum opponent
    hand size (worst-case opponent) rather than a single opponent.
    """
    hand = state._hands[player]
    hand_vals = sorted((state._card_values[c] for c in hand), reverse=True)
    hand_size = len(hand)
    n = state._num_players

    if state._phase == "crown":
        return "CR"

    if state._phase == "setup":
        low = sum(1 for v in hand_vals if v <= 4)
        high = sum(1 for v in hand_vals if v >= 7)
        return f"S{_bucket_hand(hand_size)}{min(low, 5)}{min(high, 5)}"

    threshold = state._throne_value()
    n_playable = sum(1 for v in hand_vals if v >= threshold)
    can_disgrace = state._king_face_up[player] and len(state._court) > 0

    opp_hands = [len(state._hands[(player + 1 + i) % n]) for i in range(n - 1)]
    min_opp = _bucket_hand(min(opp_hands))
    court_sz = min(len(state._court), 7)

    return (
        f"P{_bucket_playable(n_playable)}"
        f"{_bucket_threshold(threshold)}"
        f"{_bucket_hand(hand_size)}"
        f"{min_opp}"
        f"{'D' if can_disgrace else '_'}"
        f"{court_sz}"
    )


# ---------------------------------------------------------------------------
# Abstract action mapping
# ---------------------------------------------------------------------------

def abstract_action(state, encoded_action, player):
    """Map a concrete encoded action to an abstract action key.

    Play:  L (lowest third), M (middle), H (highest third), D (disgrace)
    Setup: LL (commit 2 low), LH (mixed), HH (commit 2 high)
    Crown: K0, K1, K2
    """
    decoded = ig._decode_action(encoded_action, state._max_card_id, state._num_players)

    if decoded[0] == "disgrace":
        return "D"

    if decoded[0] == "crown":
        return f"K{decoded[1]}"

    if decoded[0] == "play":
        card_id = decoded[1]
        value = state._card_values[card_id]
        hand = state._hands[player]
        threshold = state._throne_value()
        playable_vals = sorted(state._card_values[c] for c in hand if state._card_values[c] >= threshold)

        if len(playable_vals) <= 1:
            return "L"
        third = len(playable_vals) // 3
        if value <= playable_vals[third]:
            return "L"
        if value >= playable_vals[-(third + 1)]:
            return "H"
        return "M"

    sv = state._card_values[decoded[1]]
    dv = state._card_values[decoded[2]]
    avg = (sv + dv) / 2.0
    if avg <= 4.0:
        return "LL"
    if avg >= 6.0:
        return "HH"
    return "LH"


def group_legal_by_abstract(state, legal_actions, player):
    """Group concrete encoded actions by abstract action key."""
    groups = {}
    for enc in legal_actions:
        key = abstract_action(state, enc, player)
        groups.setdefault(key, []).append(enc)
    return groups
