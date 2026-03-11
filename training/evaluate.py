"""
Evaluate bot strategies head-to-head over large sample sizes.

Matchups:
  - Trained MCCFR policy vs Random
  - Heuristic (rule-based) vs Random
  - Trained MCCFR policy vs Heuristic
  - Trained MCCFR (seat-swapped) — both seats to check symmetry
  - Self-play baselines

Usage:
  python evaluate.py --policy ./policy.json --games 10000
  python evaluate.py --policy ./policy_2p_8h.json --games 20000
"""

import argparse
import json
import math
import random
import time

import pyspiel

import imposter_zero.game as ig
from imposter_zero.abstraction import (
    abstract_state,
    abstract_action,
    group_legal_by_abstract,
)


# ---------------------------------------------------------------------------
# Strategy implementations
# ---------------------------------------------------------------------------

def random_action(state, player):
    return random.choice(state.legal_actions())


def heuristic_action(state, player):
    """Conservative strategy: play lowest playable card, save high cards.

    Disgraces only when opponent is about to run out of cards (2 or fewer)
    and we have a comfortable hand-size lead.
    Setup: commit the two lowest cards to maximise hand strength.
    """
    legal = state.legal_actions()
    if len(legal) == 1:
        return legal[0]

    decoded = [ig._decode_action(a, state._max_card_id, state._num_players) for a in legal]

    if state._phase == "crown":
        return legal[0]

    if state._phase == "setup":
        best = None
        best_keep = -1
        for a, d in zip(legal, decoded):
            if d[0] != "commit":
                continue
            sv = state._card_values[d[1]]
            dv = state._card_values[d[2]]
            keep_val = sum(state._card_values[c] for c in state._hands[player]) - sv - dv
            if keep_val > best_keep:
                best_keep = keep_val
                best = a
        return best if best is not None else legal[0]

    play_actions = [(a, d) for a, d in zip(legal, decoded) if d[0] == "play"]
    disgrace_actions = [a for a, d in zip(legal, decoded) if d[0] == "disgrace"]

    if not play_actions and disgrace_actions:
        return disgrace_actions[0]

    if play_actions:
        opp_hands = [
            len(state._hands[(player + 1 + i) % state._num_players])
            for i in range(state._num_players - 1)
        ]
        min_opp = min(opp_hands) if opp_hands else 99

        if disgrace_actions and min_opp <= 2 and len(state._hands[player]) > min_opp + 2:
            return disgrace_actions[0]

        best_a = None
        best_val = float("inf")
        for a, d in play_actions:
            val = state._card_values[d[1]]
            if val < best_val:
                best_val = val
                best_a = a
        return best_a if best_a is not None else play_actions[0][0]

    return legal[0]


def greedy_action(state, player):
    """Greedy strategy: always play highest value card."""
    legal = state.legal_actions()
    if len(legal) == 1:
        return legal[0]

    decoded = [ig._decode_action(a, state._max_card_id, state._num_players) for a in legal]

    if state._phase in ("crown", "setup"):
        return heuristic_action(state, player)

    play_actions = [(a, d) for a, d in zip(legal, decoded) if d[0] == "play"]
    disgrace_actions = [a for a, d in zip(legal, decoded) if d[0] == "disgrace"]

    if not play_actions and disgrace_actions:
        return disgrace_actions[0]

    if play_actions:
        best_a = None
        best_val = -1
        for a, d in play_actions:
            val = state._card_values[d[1]]
            if val > best_val:
                best_val = val
                best_a = a
        return best_a if best_a is not None else play_actions[0][0]

    return legal[0]


def make_policy_action(policy_table):
    """Create a strategy function from a loaded MCCFR tabular policy."""
    def policy_action(state, player):
        legal = state.legal_actions()
        groups = group_legal_by_abstract(state, legal, player)
        abs_actions = list(groups.keys())
        info = abstract_state(state, player)

        entry = policy_table.get(info)
        if entry:
            probs = [entry.get(a, 0.0) for a in abs_actions]
            total = sum(probs)
            if total > 0:
                probs = [p / total for p in probs]
                idx = random.choices(range(len(abs_actions)), weights=probs, k=1)[0]
                return random.choice(groups[abs_actions[idx]])

        return random.choice(legal)
    return policy_action


# ---------------------------------------------------------------------------
# Evaluation engine
# ---------------------------------------------------------------------------

def play_match(game, strategy_p0, strategy_p1, num_games):
    """Play num_games between two strategies. Returns (p0_wins, p1_wins, draws)."""
    wins = [0, 0]
    for _ in range(num_games):
        state = game.new_initial_state()
        steps = 0
        while not state.is_terminal() and steps < 300:
            player = state.current_player()
            if player == 0:
                action = strategy_p0(state, 0)
            else:
                action = strategy_p1(state, 1)
            state.apply_action(action)
            steps += 1
        if not state.is_terminal():
            continue
        r = state.returns()
        if r[0] > 0:
            wins[0] += 1
        elif r[1] > 0:
            wins[1] += 1
    total = wins[0] + wins[1]
    return wins[0], wins[1], num_games - total


def wilson_ci(wins, total, z=1.96):
    """Wilson score 95% confidence interval."""
    if total == 0:
        return 0.0, 0.0, 0.0
    p = wins / total
    denom = 1 + z * z / total
    centre = (p + z * z / (2 * total)) / denom
    spread = z * math.sqrt((p * (1 - p) + z * z / (4 * total)) / total) / denom
    return p, max(0, centre - spread), min(1, centre + spread)


def report_matchup(label, p0_wins, p1_wins, draws, total):
    wr, lo, hi = wilson_ci(p0_wins, p0_wins + p1_wins)
    print(f"  {label}")
    print(f"    P0 wins: {p0_wins:>6,}  ({p0_wins/total:6.1%})")
    print(f"    P1 wins: {p1_wins:>6,}  ({p1_wins/total:6.1%})")
    if draws:
        print(f"    Draws:   {draws:>6,}  ({draws/total:6.1%})")
    print(f"    P0 win rate: {wr:.1%}  (95% CI: {lo:.1%} – {hi:.1%})")
    print()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def symmetric_winrate(game, strategy_a, strategy_b, n):
    """Play n games each way (A as P0, A as P1) and return A's overall win rate."""
    w0, l0, _ = play_match(game, strategy_a, strategy_b, n)
    w1_opp, w1_me, _ = play_match(game, strategy_b, strategy_a, n)
    total_wins = w0 + w1_me
    total_games = 2 * n
    return total_wins, total_games


def main():
    parser = argparse.ArgumentParser(description="Evaluate Imposter Zero bot matchups")
    parser.add_argument("--policy", type=str, default="./policy.json")
    parser.add_argument("--games", type=int, default=10000,
                        help="Games PER SEAT per matchup (total = 2x this)")
    parser.add_argument("--seed", type=int, default=0)
    args = parser.parse_args()

    random.seed(args.seed)
    game = pyspiel.load_game("imposter_zero")
    n = args.games

    with open(args.policy) as f:
        policy_data = json.load(f)
    meta = policy_data.get("metadata", {})
    policy_table = policy_data["policy"]
    trained = make_policy_action(policy_table)

    print("=" * 70)
    print("  Imposter Zero — 2-Player Bot Evaluation")
    print("=" * 70)
    print(f"  Policy:        {args.policy}")
    print(f"  Algorithm:     {meta.get('algorithm', '?')}")
    print(f"  Game version:  {meta.get('game_version', '?')}")
    print(f"  Iterations:    {meta.get('iterations', '?'):,}")
    print(f"  Info states:   {meta.get('info_states', '?'):,}")
    print(f"  Games/seat:    {n:,}  (x2 for seat symmetry = {2*n:,} per matchup)")
    print("=" * 70)
    print()

    strategies = {
        "MCCFR":     trained,
        "Heuristic": heuristic_action,
        "Greedy":    greedy_action,
        "Random":    random_action,
    }

    matchups = [
        ("MCCFR",     "Random"),
        ("MCCFR",     "Heuristic"),
        ("MCCFR",     "Greedy"),
        ("Heuristic", "Random"),
        ("Greedy",    "Random"),
        ("Heuristic", "Greedy"),
    ]

    t0 = time.time()
    rows = []

    for i, (a_name, b_name) in enumerate(matchups):
        label = f"[{i+1}/{len(matchups)}] {a_name} vs {b_name}"
        print(f"{label} ...")
        a_wins, total = symmetric_winrate(
            game, strategies[a_name], strategies[b_name], n,
        )
        wr, lo, hi = wilson_ci(a_wins, total)
        rows.append((a_name, b_name, a_wins, total - a_wins, total, wr, lo, hi))
        print(f"  => {a_name} wins {wr:.1%}  (95% CI: {lo:.1%} – {hi:.1%})")
        print()

    elapsed = time.time() - t0
    total_games = sum(r[4] for r in rows)

    print()
    print("=" * 70)
    print("  RESULTS  (seat-symmetric, Wilson 95% CI)")
    print("=" * 70)
    print()
    print(f"  {'Matchup':<28s}  {'Wins':>6s} / {'Total':>6s}  {'Win%':>6s}  {'95% CI':>17s}")
    print(f"  {'—' * 28}  {'—' * 6}   {'—' * 6}  {'—' * 6}  {'—' * 17}")
    for a, b, w, l, t, wr, lo, hi in rows:
        label = f"{a} vs {b}"
        print(f"  {label:<28s}  {w:>6,} / {t:>6,}  {wr:>5.1%}  ({lo:>5.1%} – {hi:>5.1%})")
    print()
    print(f"  Total games:  {total_games:,}")
    print(f"  Wall time:    {elapsed:.1f}s  ({total_games/elapsed:,.0f} games/s)")
    print("=" * 70)


if __name__ == "__main__":
    main()
