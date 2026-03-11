"""
Cross-language parity tests and Python game verification.

Tests cover both round-only (imposter_zero) and match (imposter_zero_match).
"""

import json
import random
from pathlib import Path

import pytest
import pyspiel

import imposter_zero.game as ig
from imposter_zero.abstraction import (
    enriched_obs, enriched_obs_size, abstract_state, ABSTRACT_ACTIONS,
    group_legal_by_abstract,
)

FIXTURES = Path(__file__).parent / "fixtures"


def load_trace(filename):
    with open(FIXTURES / filename) as f:
        return json.load(f)


def trace_fixtures():
    return sorted(f.name for f in FIXTURES.glob("trace_*.json"))


# ---------------------------------------------------------------------------
# Legacy trace-based parity (xfail: effects auto-resolved)
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("fixture", trace_fixtures())
@pytest.mark.xfail(reason="Python auto-resolves effects; TS traces include effect_choice steps.", strict=False)
def test_parity_replay(fixture):
    trace = load_trace(fixture)
    game = pyspiel.load_game("imposter_zero" if trace["numPlayers"] == 2 else "imposter_zero_3p")
    state = game.new_initial_state()
    state._hands = [list(h) for h in trace["initialHands"]]
    state._first_player = trace["firstPlayer"]
    state._active_player = trace["firstPlayer"]
    state._accused = trace["accused"]
    state._forgotten = trace["forgotten"]
    for step in trace["steps"]:
        if state.is_terminal():
            break
        state.apply_action(step["encodedAction"])
    assert state.is_terminal()


# ---------------------------------------------------------------------------
# Round-only game tests
# ---------------------------------------------------------------------------

def test_game_registration():
    game = pyspiel.load_game("imposter_zero")
    assert game.num_players() == 2
    state = game.new_initial_state()
    assert state._phase == "crown"
    assert len(state.legal_actions()) == 2


def test_random_playout_terminates():
    game = pyspiel.load_game("imposter_zero")
    for seed in range(20):
        rng = random.Random(seed)
        state = game.new_initial_state()
        steps = 0
        while not state.is_terminal() and steps < 200:
            state.apply_action(rng.choice(state.legal_actions()))
            steps += 1
        assert state.is_terminal()
        assert abs(sum(state.returns())) < 1e-9


def test_clone_produces_independent_copy():
    game = pyspiel.load_game("imposter_zero")
    state = game.new_initial_state()
    state.apply_action(state.legal_actions()[0])
    cloned = state.clone()
    cloned.apply_action(cloned.legal_actions()[0])
    assert state._turn_count != cloned._turn_count


def test_action_codec_round_trip():
    max_card_id = ig._MAX_CARD_ID_2P
    assert ig._decode_action(ig._DISGRACE_SLOT, max_card_id, 2) == ("disgrace",)
    for card_id in range(max_card_id + 1):
        enc = ig._encode_play(card_id)
        assert ig._decode_action(enc, max_card_id, 2) == ("play", card_id)
    for fp in range(2):
        enc = ig._encode_crown_action(fp, max_card_id)
        assert ig._decode_action(enc, max_card_id, 2) == ("crown", fp)


# ---------------------------------------------------------------------------
# Match game tests
# ---------------------------------------------------------------------------

def test_match_registration():
    game = pyspiel.load_game("imposter_zero_match")
    assert game.num_players() == 2
    state = game.new_initial_state()
    assert state._phase == "draft_select"
    legal = state.legal_actions()
    assert len(legal) == 9


def test_match_random_playout_terminates():
    game = pyspiel.load_game("imposter_zero_match")
    for seed in range(10):
        rng = random.Random(seed)
        state = game.new_initial_state()
        steps = 0
        while not state.is_terminal() and steps < 800:
            state.apply_action(rng.choice(state.legal_actions()))
            steps += 1
        assert state.is_terminal(), f"Seed {seed}: not terminal after {steps} steps"
        r = state.returns()
        assert abs(sum(r)) < 1e-9, f"Seed {seed}: returns not zero-sum: {r}"
        assert max(state._match_scores) >= 7, f"Seed {seed}: no player reached 7"


def test_match_draft_flow():
    game = pyspiel.load_game("imposter_zero_match")
    state = game.new_initial_state()
    assert state._phase == "draft_select"

    state.apply_action(state.legal_actions()[0])
    assert state._phase == "draft_select"

    state.apply_action(state.legal_actions()[0])
    assert state._phase == "draft_order"

    state.apply_action(state.legal_actions()[0])
    assert state._phase == "draft_pick"

    while state._phase == "draft_pick":
        state.apply_action(state.legal_actions()[0])

    assert state._phase == "crown"
    assert sum(len(s) for s in state._draft_selections) == 6


def test_match_mustering_flow():
    game = pyspiel.load_game("imposter_zero_match")
    rng = random.Random(42)
    state = game.new_initial_state()

    while state._phase != "mustering" and not state.is_terminal():
        state.apply_action(rng.choice(state.legal_actions()))

    if state._phase != "mustering":
        pytest.skip("Game ended before mustering")

    has_select_king = any(
        ig._decode_match_action(a, state._max_card_id, 2)[0] == "select_king"
        for a in state.legal_actions()
    )
    has_end = any(
        ig._decode_match_action(a, state._max_card_id, 2)[0] == "end_mustering"
        for a in state.legal_actions()
    )
    assert has_end
    assert has_select_king


def test_match_multi_round_scoring():
    game = pyspiel.load_game("imposter_zero_match")
    rng = random.Random(99)
    state = game.new_initial_state()

    while not state.is_terminal():
        state.apply_action(rng.choice(state.legal_actions()))

    assert state._rounds_played >= 3
    assert max(state._match_scores) >= 7


def test_match_clone():
    game = pyspiel.load_game("imposter_zero_match")
    rng = random.Random(7)
    state = game.new_initial_state()
    for _ in range(30):
        if state.is_terminal():
            break
        state.apply_action(rng.choice(state.legal_actions()))
    c = state.clone()
    if not state.is_terminal():
        c.apply_action(c.legal_actions()[0])
        assert state._turn_count != c._turn_count
    assert c._match_scores == state._match_scores or c._turn_count != state._turn_count


def test_match_action_codec_round_trip():
    mcid = ig._DIMS_MATCH["max_card_id"]
    np = 2

    for facet in (0, 1):
        enc = ig._encode_select_king(facet, mcid, np)
        dec = ig._decode_match_action(enc, mcid, np)
        assert dec == ("select_king", facet)

    enc = ig._encode_end_mustering(mcid, np)
    assert ig._decode_match_action(enc, mcid, np) == ("end_mustering",)

    for cid in (22, 30):
        enc = ig._encode_begin_recruit(cid, mcid, np)
        assert ig._decode_match_action(enc, mcid, np) == ("begin_recruit", cid)

    enc = ig._encode_recruit(5, 25, mcid, np)
    assert ig._decode_match_action(enc, mcid, np) == ("recruit", 5, 25)

    for idx in range(9):
        enc = ig._encode_draft_select(idx, mcid, np)
        assert ig._decode_match_action(enc, mcid, np) == ("draft_select", idx)

    for gf in (True, False):
        enc = ig._encode_draft_order(gf, mcid, np)
        assert ig._decode_match_action(enc, mcid, np) == ("draft_order", gf)

    for idx in range(9):
        enc = ig._encode_draft_pick(idx, mcid, np)
        assert ig._decode_match_action(enc, mcid, np) == ("draft_pick", idx)


def test_match_enriched_obs_dimensions():
    game = pyspiel.load_game("imposter_zero_match")
    for seed in range(3):
        rng = random.Random(seed)
        state = game.new_initial_state()
        for _ in range(50):
            if state.is_terminal():
                break
            obs = enriched_obs(state, state._active_player)
            assert len(obs) == enriched_obs_size()
            astate = abstract_state(state, state._active_player)
            assert isinstance(astate, str)
            groups = group_legal_by_abstract(state, state.legal_actions(), state._active_player)
            for key in groups:
                assert key in ABSTRACT_ACTIONS, f"Unknown abstract action: {key!r}"
            state.apply_action(rng.choice(state.legal_actions()))
