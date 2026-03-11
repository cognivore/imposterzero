"""
Shared strategic abstraction for Imposter Zero training and inference.

Supports both round-only (imposter_zero) and match (imposter_zero_match) games.
Match abstractions add draft, mustering, and match-score context.
"""

from . import game as ig

# ---------------------------------------------------------------------------
# Abstract action keys (shared vocabulary across all variants)
# ---------------------------------------------------------------------------

ABSTRACT_ACTIONS = [
    "L", "M", "H", "D",
    "LL", "LH", "HH",
    "K0", "K1", "K2",
    "SK_C", "SK_T", "EM",
    "BR", "RC_P", "RC_N",
    "DS0", "DS1", "DS2", "DS3", "DS4", "DS5", "DS6", "DS7", "DS8",
    "DO_F", "DO_S",
    "DP0", "DP1", "DP2", "DP3", "DP4", "DP5", "DP6", "DP7", "DP8",
]

# ---------------------------------------------------------------------------
# Enriched observation (match-aware, 42 dims)
# ---------------------------------------------------------------------------

_ENRICHED_SIZE = 43


def enriched_obs(state, player):
    """42-dim feature vector for neural training (match-aware)."""
    n = state._num_players
    opp = (player + 1) % n

    active_oh = [0.0] * 3
    if state._active_player < 3:
        active_oh[state._active_player] = 1.0

    phase = getattr(state, "_phase", "play")
    phase_oh = [float(phase == ph) for ph in (
        "crown", "setup", "play", "mustering",
        "draft_select", "draft_order", "draft_pick",
    )]

    hand = getattr(state, "_hands", [[], []])[player]
    hist = [0.0] * 9
    for c in hand:
        v = state._card_values.get(c, 0) if hasattr(state, "_card_values") else 0
        if 1 <= v <= 9:
            hist[v - 1] += 1.0

    king_up = float(getattr(state, "_king_face_up", [True, True])[player])
    succ = float(getattr(state, "_successors", [None, None])[player] is not None)
    dung = float(getattr(state, "_dungeons", [None, None])[player] is not None)
    throne = state._throne_value() / 9.0 if hasattr(state, "_throne_value") else 0.0
    court_sz = len(getattr(state, "_court", [])) / 15.0

    accused_val = 0.0
    accused = getattr(state, "_accused", None)
    if accused is not None and hasattr(state, "_card_values"):
        accused_val = state._card_values.get(accused, 0) / 9.0
    forgotten = float(getattr(state, "_forgotten", None) is not None)

    fp_oh = [0.0] * 3
    fp = getattr(state, "_first_player", 0)
    if fp < 3:
        fp_oh[fp] = 1.0

    opp_hand = len(getattr(state, "_hands", [[], []])[opp]) / 9.0
    opp_king = float(getattr(state, "_king_face_up", [True, True])[opp])

    ante = len(getattr(state, "_antechamber", [[], []])[player]) / 5.0
    condemned = len(getattr(state, "_condemned", [])) / 10.0
    disgraced = sum(1 for _, fu, _ in getattr(state, "_court", []) if not fu) / 7.0
    parting = len(getattr(state, "_parting", [[], []])[player]) / 3.0

    my_score = getattr(state, "_match_scores", [0, 0])[player] / 7.0
    opp_score = getattr(state, "_match_scores", [0, 0])[opp] / 7.0
    rounds = getattr(state, "_rounds_played", 0) / 14.0
    army_avail = len(getattr(state, "_army_ids", [[], []])[player]) / 8.0
    army_exh = len(getattr(state, "_exhausted_ids", [[], []])[player]) / 8.0

    facets = getattr(state, "_king_facets", ["default", "default"])
    facet_oh = [
        float(facets[player] == "default"),
        float(facets[player] == "masterTactician"),
        float(facets[player] == "charismatic"),
    ]

    return (
        active_oh + phase_oh + hist +
        [king_up, succ, dung, throne, court_sz, accused_val, forgotten] +
        fp_oh + [opp_hand, opp_king] +
        [ante, condemned, disgraced, parting] +
        [my_score, opp_score, rounds, army_avail, army_exh] +
        facet_oh
    )


def enriched_obs_size():
    return _ENRICHED_SIZE


# ---------------------------------------------------------------------------
# Bucketed state abstraction
# ---------------------------------------------------------------------------

def _bucket_threshold(tv):
    if tv <= 1: return 0
    if tv <= 3: return 1
    if tv <= 5: return 2
    if tv <= 7: return 3
    return 4

def _bucket_playable(n):
    if n == 0: return 0
    if n <= 2: return 1
    if n <= 4: return 2
    return 3

def _bucket_hand(n):
    if n <= 2: return 0
    if n <= 4: return 1
    if n <= 6: return 2
    return 3

def _bucket_score(s):
    if s <= 2: return 0
    if s <= 4: return 1
    return 2


def abstract_state(state, player):
    phase = getattr(state, "_phase", "play")
    n = state._num_players

    if phase in ("draft_select", "draft_order", "draft_pick"):
        sel_count = len(getattr(state, "_draft_selections", [[], []])[player])
        fu_count = len(getattr(state, "_draft_face_up", []))
        return f"DR_{phase[6:]}_{sel_count}_{fu_count}"

    scores = getattr(state, "_match_scores", [0, 0])
    opp = (player + 1) % n
    score_ctx = f"{_bucket_score(scores[player])}{_bucket_score(scores[opp])}"

    if phase == "crown":
        return f"CR{score_ctx}"

    hand = state._hands[player]
    hand_vals = sorted((state._card_values.get(c, 0) for c in hand), reverse=True)
    hand_size = len(hand)

    if phase == "mustering":
        army_n = len(getattr(state, "_army_ids", [[], []])[player])
        facet = getattr(state, "_king_facets", ["default", "default"])[player]
        exh = "E" if getattr(state, "_has_exhausted_this_mustering", False) else "_"
        return f"MUS{_bucket_hand(hand_size)}{army_n}{exh}{facet[0]}{score_ctx}"

    if phase == "setup":
        low = sum(1 for v in hand_vals if v <= 4)
        high = sum(1 for v in hand_vals if v >= 7)
        return f"S{_bucket_hand(hand_size)}{min(low, 5)}{min(high, 5)}{score_ctx}"

    parting = getattr(state, "_parting", [[], []])
    antechamber = getattr(state, "_antechamber", [[], []])
    if parting[player]:
        return f"FP{score_ctx}"
    if antechamber[player]:
        return f"FA{score_ctx}"

    threshold = state._throne_value()
    n_playable = sum(1 for c in hand if state._can_play_card(c, threshold))
    can_disgrace = state._king_face_up[player] and len(state._court) > 0
    opp_hands = [len(state._hands[(player + 1 + i) % n]) for i in range(n - 1)]
    min_opp = _bucket_hand(min(opp_hands))
    court_sz = min(len(state._court), 7)
    disgraced = min(sum(1 for _, fu, _ in state._court if not fu), 3)

    return (
        f"P{_bucket_playable(n_playable)}"
        f"{_bucket_threshold(threshold)}"
        f"{_bucket_hand(hand_size)}"
        f"{min_opp}"
        f"{'D' if can_disgrace else '_'}"
        f"{court_sz}{disgraced}"
        f"{score_ctx}"
    )


# ---------------------------------------------------------------------------
# Abstract action mapping
# ---------------------------------------------------------------------------

def abstract_action(state, encoded_action, player):
    mcid = state._max_card_id
    np = state._num_players

    crb = ig._crown_base(mcid)
    if encoded_action < crb + np:
        decoded = ig._decode_action(encoded_action, mcid, np)
        if decoded[0] == "disgrace":
            return "D"
        if decoded[0] == "crown":
            return f"K{decoded[1]}"
        if decoded[0] == "play":
            card_id = decoded[1]
            parting = getattr(state, "_parting", [[], []])
            antechamber = getattr(state, "_antechamber", [[], []])
            if card_id in parting[player] or card_id in antechamber[player]:
                return "L"
            value = state._card_values.get(card_id, 0)
            threshold = state._throne_value()
            playable_vals = sorted(
                state._card_values.get(c, 0) for c in state._hands[player]
                if state._can_play_card(c, threshold)
            )
            if len(playable_vals) <= 1:
                return "L"
            third = len(playable_vals) // 3
            if value <= playable_vals[third]:
                return "L"
            if value >= playable_vals[-(third + 1)]:
                return "H"
            return "M"
        sv = state._card_values.get(decoded[1], 0)
        dv = state._card_values.get(decoded[2], 0)
        avg = (sv + dv) / 2.0
        if avg <= 4.0: return "LL"
        if avg >= 6.0: return "HH"
        return "LH"

    decoded = ig._decode_match_action(encoded_action, mcid, np)
    kind = decoded[0]

    if kind == "select_king":
        return "SK_C" if decoded[1] == 0 else "SK_T"
    if kind == "end_mustering":
        return "EM"
    if kind == "begin_recruit":
        return "BR"
    if kind == "recruit":
        take_val = state._card_values.get(decoded[2], 0)
        disc_val = state._card_values.get(decoded[1], 0)
        return "RC_P" if take_val > disc_val else "RC_N"
    if kind == "draft_select":
        return f"DS{decoded[1]}"
    if kind == "draft_order":
        return "DO_F" if decoded[1] else "DO_S"
    if kind == "draft_pick":
        return f"DP{decoded[1]}"

    return "L"


def group_legal_by_abstract(state, legal_actions, player):
    groups = {}
    for enc in legal_actions:
        key = abstract_action(state, enc, player)
        groups.setdefault(key, []).append(enc)
    return groups
