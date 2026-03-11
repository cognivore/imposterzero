"""
Cross-language parity tests and Python game verification.

The step-by-step trace parity tests are xfail because the Python game
auto-resolves card effects inside _apply_action (no resolving/end_of_turn
phases or effect_choice actions), while the TS engine exposes those as
separate player decisions.

The remaining tests verify the Python game's internal consistency:
  - random playouts terminate with correct returns
  - action codec round-trips
  - clone produces independent copies
  - play overrides work (Elder, Zealot, Oathbound)
  - effect resolution changes game state
  - enriched observation tensor dimensions
"""

import json
import random
from pathlib import Path

import pytest
import pyspiel

import imposter_zero.game as ig
from imposter_zero.abstraction import enriched_obs, enriched_obs_size, abstract_state

FIXTURES = Path(__file__).parent / "fixtures"


def load_trace(filename):
    with open(FIXTURES / filename) as f:
        return json.load(f)


def _game_name(num_players):
    if num_players == 3:
        return "imposter_zero_3p"
    return "imposter_zero"


def make_state_from_trace(trace):
    """Construct an ImposterZeroState with the exact deal from a TS trace."""
    game = pyspiel.load_game(_game_name(trace["numPlayers"]))
    state = game.new_initial_state()

    deck_kinds = ig._regulation_deck(trace["numPlayers"])

    state._card_values = {}
    state._card_names = {}
    for card_id in range(trace["deckSize"]):
        name, value = deck_kinds[card_id]
        state._card_values[card_id] = value
        state._card_names[card_id] = name

    king_base = trace["deckSize"]
    for p in range(trace["numPlayers"]):
        kid = king_base + p
        state._card_values[kid] = 0
        state._card_names[kid] = "King"

    state._hands = [list(h) for h in trace["initialHands"]]
    state._king_face_up = [True] * trace["numPlayers"]
    state._successors = [None] * trace["numPlayers"]
    state._dungeons = [None] * trace["numPlayers"]
    state._court = []
    state._phase = "crown"
    state._active_player = trace["firstPlayer"]
    state._first_player = trace["firstPlayer"]
    state._turn_count = 0
    state._accused = trace["accused"]
    state._forgotten = trace["forgotten"]
    state._deck_size = trace["deckSize"]
    state._max_card_id = trace["maxCardId"]
    state._num_players = trace["numPlayers"]

    state._antechamber = [[] for _ in range(trace["numPlayers"])]
    state._parting = [[] for _ in range(trace["numPlayers"])]
    state._condemned = []
    state._soldier_bonus = {}
    state._eliminated = set()

    return state


def trace_fixtures():
    """List all trace fixture files."""
    return sorted(f.name for f in FIXTURES.glob("trace_*.json"))


# ---------------------------------------------------------------------------
# Trace-based parity tests (xfail: effects auto-resolved in Python)
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("fixture", trace_fixtures())
@pytest.mark.xfail(
    reason="Python game auto-resolves card effects inside _apply_action. "
    "TS traces include resolving/end_of_turn phases and effect_choice "
    "actions that don't exist in the Python action space.",
    strict=False,
)
def test_parity_replay(fixture):
    trace = load_trace(fixture)
    state = make_state_from_trace(trace)

    for i, step in enumerate(trace["steps"]):
        assert state.current_player() == step["activePlayer"], (
            f"Step {i}: active player mismatch"
        )
        assert state._phase == step["phase"], (
            f"Step {i}: phase mismatch (py={state._phase}, ts={step['phase']})"
        )
        assert state._first_player == step["firstPlayer"], (
            f"Step {i}: firstPlayer mismatch (py={state._first_player}, ts={step['firstPlayer']})"
        )

        legal = state.legal_actions()
        assert len(legal) == step["legalActionCount"], (
            f"Step {i}: legal action count mismatch "
            f"(py={len(legal)}, ts={step['legalActionCount']})"
        )

        py_throne = state._throne_value()
        assert py_throne == step["throneValue"], (
            f"Step {i}: throne value mismatch (py={py_throne}, ts={step['throneValue']})"
        )

        assert len(state._court) == step["courtSize"], (
            f"Step {i}: court size mismatch"
        )

        for p in range(trace["numPlayers"]):
            assert len(state._hands[p]) == step["handSizes"][p], (
                f"Step {i}: hand size mismatch for player {p}"
            )

        encoded = step["encodedAction"]
        assert encoded in legal, (
            f"Step {i}: TS-chosen action {encoded} not in Python legal actions {legal}"
        )

        state.apply_action(encoded)

    assert state.is_terminal(), "Expected terminal state after replaying all steps"

    py_returns = state.returns()
    for p in range(trace["numPlayers"]):
        assert py_returns[p] == pytest.approx(trace["terminalReturns"][p]), (
            f"Returns mismatch for player {p}: py={py_returns[p]}, ts={trace['terminalReturns'][p]}"
        )


@pytest.mark.parametrize("fixture", trace_fixtures())
@pytest.mark.xfail(
    reason="Python game auto-resolves effects and includes new info fields "
    "(ante, parting, condemned) in the information state string.",
    strict=False,
)
def test_information_state_string_parity(fixture):
    """Verify information state strings match between TS and Python at each step."""
    trace = load_trace(fixture)
    state = make_state_from_trace(trace)

    for i, step in enumerate(trace["steps"]):
        if "informationStateStrings" not in step:
            state.apply_action(step["encodedAction"])
            continue

        for p in range(trace["numPlayers"]):
            py_str = state.information_state_string(p)
            ts_str = step["informationStateStrings"][p]
            assert py_str == ts_str, (
                f"Step {i}, player {p}: info state string mismatch\n"
                f"  py: {py_str}\n"
                f"  ts: {ts_str}"
            )

        state.apply_action(step["encodedAction"])


@pytest.mark.parametrize("fixture", trace_fixtures())
@pytest.mark.xfail(
    reason="Python observation tensor includes 3 new effect-related dims "
    "(antechamber, condemned, disgraced).",
    strict=False,
)
def test_observation_tensor_parity(fixture):
    """Verify observation tensors match between TS and Python at each step."""
    trace = load_trace(fixture)
    state = make_state_from_trace(trace)

    for i, step in enumerate(trace["steps"]):
        if "observationTensors" not in step:
            state.apply_action(step["encodedAction"])
            continue

        for p in range(trace["numPlayers"]):
            py_tensor = state.observation_tensor(p)
            ts_tensor = step["observationTensors"][p]
            assert len(py_tensor) == len(ts_tensor), (
                f"Step {i}, player {p}: tensor length mismatch "
                f"(py={len(py_tensor)}, ts={len(ts_tensor)})"
            )
            for j, (pv, tv) in enumerate(zip(py_tensor, ts_tensor)):
                assert pv == pytest.approx(tv, abs=1e-6), (
                    f"Step {i}, player {p}: tensor[{j}] mismatch (py={pv}, ts={tv})"
                )

        state.apply_action(step["encodedAction"])


# ---------------------------------------------------------------------------
# Initial hand values — these still match since deal logic is unchanged
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("fixture", trace_fixtures())
def test_initial_hand_values_match(fixture):
    """Verify that card values in Python match the TS trace card values."""
    trace = load_trace(fixture)
    state = make_state_from_trace(trace)

    for p in range(trace["numPlayers"]):
        py_values = [state._card_values[cid] for cid in state._hands[p]]
        assert py_values == trace["initialHandValues"][p], (
            f"Player {p}: hand value mismatch"
        )

    if trace["accused"] is not None:
        assert state._card_values[trace["accused"]] == trace["accusedValue"]


# ---------------------------------------------------------------------------
# Game registration and structural tests
# ---------------------------------------------------------------------------

def test_game_registration():
    """Verify the game registers and produces valid states."""
    game = pyspiel.load_game("imposter_zero")
    assert game.num_players() == 2
    assert game.num_distinct_actions() > 0

    state = game.new_initial_state()
    assert not state.is_terminal()
    assert state._phase == "crown"
    assert len(state.legal_actions()) == 2


def test_game_registration_3p():
    """Verify the 3p game variant registers and works."""
    game = pyspiel.load_game("imposter_zero_3p")
    assert game.num_players() == 3
    assert game.num_distinct_actions() == 816

    state = game.new_initial_state()
    assert not state.is_terminal()
    assert state._phase == "crown"
    assert len(state.legal_actions()) == 3
    assert state._deck_size == 25
    assert state._max_card_id == 27


def test_random_playout_terminates():
    """A random playout should always terminate."""
    game = pyspiel.load_game("imposter_zero")

    for seed in range(20):
        rng = random.Random(seed)
        state = game.new_initial_state()
        steps = 0
        while not state.is_terminal() and steps < 200:
            legal = state.legal_actions()
            action = rng.choice(legal)
            state.apply_action(action)
            steps += 1

        assert state.is_terminal(), f"Seed {seed}: did not terminate in 200 steps"
        assert steps < 200

        r = state.returns()
        assert abs(sum(r)) < 1e-9, f"Seed {seed}: returns don't sum to zero: {r}"


def test_random_playout_terminates_3p():
    """3p random playouts should always terminate with correct returns."""
    game = pyspiel.load_game("imposter_zero_3p")

    for seed in range(20):
        rng = random.Random(seed)
        state = game.new_initial_state()
        steps = 0
        while not state.is_terminal() and steps < 300:
            legal = state.legal_actions()
            action = rng.choice(legal)
            state.apply_action(action)
            steps += 1

        assert state.is_terminal(), f"3p seed {seed}: did not terminate in 300 steps"
        r = state.returns()
        assert len(r) == 3
        winners = sum(1 for x in r if x > 0)
        losers = sum(1 for x in r if x < 0)
        assert winners == 1, f"3p seed {seed}: expected 1 winner, got {winners}"
        assert losers == 1, f"3p seed {seed}: expected 1 loser, got {losers}"


def test_clone_produces_independent_copy():
    """Verify that cloned states are independent."""
    game = pyspiel.load_game("imposter_zero")
    state = game.new_initial_state()

    legal = state.legal_actions()
    action = legal[0]

    cloned = state.clone()
    cloned.apply_action(action)

    assert state._phase == "crown"
    assert cloned._phase == "setup"
    assert state._turn_count == 0
    assert cloned._turn_count == 1


def test_action_codec_round_trip():
    """Verify encode-decode round-trip for all action types."""
    max_card_id = ig._MAX_CARD_ID_2P
    num_players = 2

    decoded = ig._decode_action(ig._DISGRACE_SLOT, max_card_id, num_players)
    assert decoded == ("disgrace",)

    for card_id in range(max_card_id + 1):
        encoded = ig._encode_play(card_id)
        decoded = ig._decode_action(encoded, max_card_id, num_players)
        assert decoded == ("play", card_id), f"play round-trip failed for card {card_id}"

    for s in [0, 5, max_card_id]:
        for d in [0, 5, max_card_id]:
            if s == d:
                continue
            encoded = ig._encode_commit(s, d, max_card_id)
            decoded = ig._decode_action(encoded, max_card_id, num_players)
            assert decoded == ("commit", s, d), f"commit round-trip failed for ({s},{d})"

    for fp in range(num_players):
        encoded = ig._encode_crown_action(fp, max_card_id)
        decoded = ig._decode_action(encoded, max_card_id, num_players)
        assert decoded == ("crown", fp), f"crown round-trip failed for player {fp}"


# ---------------------------------------------------------------------------
# Effect-specific tests
# ---------------------------------------------------------------------------

def _play_to_mid_game(game, rng, min_court=1):
    """Advance a fresh state into the play phase with cards in court."""
    state = game.new_initial_state()
    while state._phase != "play":
        legal = state.legal_actions()
        state.apply_action(rng.choice(legal))
    steps = 0
    while len(state._court) < min_court and not state.is_terminal() and steps < 10:
        legal = state.legal_actions()
        state.apply_action(rng.choice(legal))
        steps += 1
    return state


def test_effects_change_court_state():
    """Verify that Queen effect disgraces all other court cards."""
    game = pyspiel.load_game("imposter_zero")
    for seed in range(500):
        rng = random.Random(seed)
        state = _play_to_mid_game(game, rng, min_court=2)
        if state.is_terminal():
            continue

        queen_ids = [c for c in state._hands[state._active_player]
                     if state._card_names[c] == "Queen"]
        if not queen_ids:
            continue

        encoded = ig._encode_play(queen_ids[0])
        if encoded not in state.legal_actions():
            continue

        state.apply_action(encoded)
        faceup_after = sum(
            1 for cid, fu, _ in state._court
            if fu and cid != queen_ids[0]
        )
        assert faceup_after == 0, (
            f"Seed {seed}: Queen should disgrace all others, "
            f"but {faceup_after} non-Queen cards remain face-up"
        )
        return

    pytest.skip("No seed produced a Queen playable on a non-empty court")


def test_play_overrides_elder():
    """Verify Elder can be played on Royalty regardless of value."""
    game = pyspiel.load_game("imposter_zero")

    for seed in range(500):
        rng = random.Random(seed)
        state = _play_to_mid_game(game, rng, min_court=2)
        if state.is_terminal():
            continue
        p = state._active_player

        elder_ids = [c for c in state._hands[p] if state._card_names[c] == "Elder"]
        if not elder_ids:
            continue

        top_cid, top_fu, _ = state._court[-1]
        if not top_fu or state._card_names[top_cid] not in ("Princess", "Queen"):
            continue

        throne_val = state._throne_value()
        elder_val = state._card_values[elder_ids[0]]
        if elder_val >= throne_val:
            continue

        encoded = ig._encode_play(elder_ids[0])
        assert encoded in state.legal_actions(), (
            f"Seed {seed}: Elder (val {elder_val}) should be playable on "
            f"Royalty throne (val {throne_val})"
        )
        return

    pytest.skip("No seed produced Elder below Royalty threshold")


def test_disgrace_returns_successor():
    """Verify disgrace returns successor to hand."""
    game = pyspiel.load_game("imposter_zero")
    for seed in range(200):
        rng = random.Random(seed)
        state = _play_to_mid_game(game, rng, min_court=1)
        if state.is_terminal():
            continue
        p = state._active_player

        if not state._king_face_up[p] or not state._court:
            continue
        if state._successors[p] is None:
            continue
        if ig._encode_disgrace() not in state.legal_actions():
            continue

        succ_id = state._successors[p]
        next_p = (p + 1) % state._num_players
        state.apply_action(ig._encode_disgrace())
        assert succ_id in state._hands[next_p] or succ_id in state._hands[p], \
            f"Seed {seed}: successor {succ_id} not found in any hand after disgrace"
        assert not state._king_face_up[p], f"Seed {seed}: king should be flipped"
        return

    pytest.skip("No seed produced a disgrace-eligible state with successor")


def test_enriched_obs_dimensions():
    """Verify enriched observation tensor has correct dimensions."""
    game = pyspiel.load_game("imposter_zero")

    for seed in range(5):
        rng = random.Random(seed)
        state = game.new_initial_state()
        steps = 0
        while not state.is_terminal() and steps < 100:
            obs = enriched_obs(state, state._active_player)
            assert len(obs) == enriched_obs_size(), (
                f"Seed {seed}, step {steps}: enriched_obs has {len(obs)} dims, "
                f"expected {enriched_obs_size()}"
            )
            astate = abstract_state(state, state._active_player)
            assert isinstance(astate, str) and len(astate) > 0, (
                f"Seed {seed}, step {steps}: abstract_state returned empty/non-string"
            )
            legal = state.legal_actions()
            state.apply_action(rng.choice(legal))
            steps += 1


def test_clone_preserves_effect_state():
    """Verify clone preserves antechamber, condemned, and soldier_bonus."""
    game = pyspiel.load_game("imposter_zero")
    for seed in range(50):
        rng = random.Random(seed)
        state = game.new_initial_state()
        steps = 0
        while not state.is_terminal() and steps < 50:
            legal = state.legal_actions()
            state.apply_action(rng.choice(legal))
            steps += 1

        cloned = state.clone()
        assert cloned._condemned == state._condemned
        for p in range(state._num_players):
            assert cloned._antechamber[p] == state._antechamber[p]
            assert cloned._parting[p] == state._parting[p]
        assert cloned._soldier_bonus == state._soldier_bonus
        assert cloned._eliminated == state._eliminated

        if not state.is_terminal():
            legal = state.legal_actions()
            cloned.apply_action(legal[0])
            assert state._turn_count != cloned._turn_count or state._phase != cloned._phase
        return
