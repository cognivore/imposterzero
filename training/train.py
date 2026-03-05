"""
Outcome Sampling MCCFR with bucketed strategic abstraction for Imposter Zero.

Uses an aggressive state abstraction that captures the features which matter
for strategy: number of playable cards, threshold bucket, hand sizes, and
whether disgrace is available. This shrinks the state space to ~5K unique
states, enabling rapid MCCFR convergence.

Actions are abstracted to: play_low, play_mid, play_high, disgrace (play phase)
and commit_remove_low, commit_remove_mixed, commit_remove_high (setup phase).

Usage:
  python train.py --iterations 2000000 --output ./training/policy.json
"""

import argparse
import json
import math
import os
import random
import time

import pyspiel

import imposter_zero.game as ig


# ---------------------------------------------------------------------------
# Strategic abstraction: state bucketing
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
    """Bucketed strategic abstraction of the game state."""
    hand = state._hands[player]
    hand_vals = sorted((state._card_values[c] for c in hand), reverse=True)
    hand_size = len(hand)

    if state._phase == "crown":
        return "CR"

    if state._phase == "setup":
        low = sum(1 for v in hand_vals if v <= 4)
        high = sum(1 for v in hand_vals if v >= 7)
        return f"S{_bucket_hand(hand_size)}{min(low, 5)}{min(high, 5)}"

    threshold = state._throne_value()
    n_playable = sum(1 for v in hand_vals if v >= threshold)
    can_disgrace = state._king_face_up[player] and len(state._court) > 0
    opp = 1 - player
    opp_hand = _bucket_hand(len(state._hands[opp]))
    court_sz = min(len(state._court), 7)

    return (
        f"P{_bucket_playable(n_playable)}"
        f"{_bucket_threshold(threshold)}"
        f"{_bucket_hand(hand_size)}"
        f"{opp_hand}"
        f"{'D' if can_disgrace else '_'}"
        f"{court_sz}"
    )


def abstract_action(state, encoded_action, player):
    """Map a concrete action to an abstract action key.

    Play:  L (lowest-value playable), M (middle), H (highest), D (disgrace)
    Setup: LL (commit 2 lowest), HH (commit 2 highest), LH (one low, one high)
    Crown: K0, K1
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
        if value <= playable_vals[len(playable_vals) // 3]:
            return "L"
        if value >= playable_vals[-(len(playable_vals) // 3 + 1)]:
            return "H"
        return "M"

    # commit(successor_id, dungeon_id)
    sv = state._card_values[decoded[1]]
    dv = state._card_values[decoded[2]]
    avg = (sv + dv) / 2.0
    if avg <= 4.0:
        return "LL"
    if avg >= 6.0:
        return "HH"
    return "LH"


def group_legal_by_abstract(state, legal_actions, player):
    groups = {}
    for enc in legal_actions:
        key = abstract_action(state, enc, player)
        groups.setdefault(key, []).append(enc)
    return groups


# ---------------------------------------------------------------------------
# MCCFR Solver
# ---------------------------------------------------------------------------

class OutcomeSamplingMCCFR:
    def __init__(self, game, epsilon=0.3):
        self.game = game
        self.num_players = game.num_players()
        self.epsilon = epsilon
        self.regret_sum = {}
        self.strategy_sum = {}
        self.iterations = 0

    def _regret_matching(self, info, actions):
        n = len(actions)
        regrets = self.regret_sum.get(info)
        if regrets is None:
            return [1.0 / n] * n
        positive = [max(regrets.get(a, 0.0), 0.0) for a in actions]
        total = sum(positive)
        if total > 0:
            return [p / total for p in positive]
        return [1.0 / n] * n

    def _play_and_update(self, update_player):
        state = self.game.new_initial_state()
        trajectory = []

        while not state.is_terminal():
            player = state.current_player()
            legal = state.legal_actions()
            groups = group_legal_by_abstract(state, legal, player)
            abs_actions = list(groups.keys())
            n = len(abs_actions)

            info = abstract_state(state, player)
            strategy = self._regret_matching(info, abs_actions)

            eps = self.epsilon
            probs = [eps / n + (1 - eps) * strategy[i] for i in range(n)]
            idx = random.choices(range(n), weights=probs, k=1)[0]

            chosen_abs = abs_actions[idx]
            concrete = random.choice(groups[chosen_abs])

            trajectory.append((player, info, abs_actions, strategy, idx))
            state.apply_action(concrete)

        utility = state.returns()[update_player]

        for player, info, abs_actions, strategy, idx in trajectory:
            if player != update_player:
                continue

            regret_map = self.regret_sum.setdefault(info, {})
            strat_map = self.strategy_sum.setdefault(info, {})

            for i, a in enumerate(abs_actions):
                indicator = 1.0 if i == idx else 0.0
                regret_map[a] = regret_map.get(a, 0.0) + utility * (indicator - strategy[i])
                strat_map[a] = strat_map.get(a, 0.0) + strategy[i]

    def iteration(self):
        for up in range(self.num_players):
            self._play_and_update(up)
        self.iterations += 1

    def average_policy(self):
        policy = {}
        for info, action_sums in self.strategy_sum.items():
            total = sum(action_sums.values())
            if total > 0:
                policy[info] = {a: v / total for a, v in action_sums.items()}
            else:
                n = len(action_sums)
                policy[info] = {a: 1.0 / n for a in action_sums}
        return policy


# ---------------------------------------------------------------------------
# Policy application (for evaluation)
# ---------------------------------------------------------------------------

def select_action_from_policy(state, player, policy):
    """Use the trained policy to pick an action, falling back to random."""
    legal = state.legal_actions()
    groups = group_legal_by_abstract(state, legal, player)
    abs_actions = list(groups.keys())
    info = abstract_state(state, player)

    entry = policy.get(info)
    if entry:
        probs = [entry.get(a, 0.0) for a in abs_actions]
        total = sum(probs)
        if total > 0:
            probs = [p / total for p in probs]
            idx = random.choices(range(len(abs_actions)), weights=probs, k=1)[0]
            return random.choice(groups[abs_actions[idx]])

    return random.choice(legal)


def evaluate_vs_random(game, policy, num_games=3000):
    wins = 0
    for _ in range(num_games):
        state = game.new_initial_state()
        while not state.is_terminal():
            player = state.current_player()
            if player == 0:
                state.apply_action(select_action_from_policy(state, 0, policy))
            else:
                state.apply_action(random.choice(state.legal_actions()))
        if state.returns()[0] > 0:
            wins += 1
    return wins / num_games


def evaluate_policy_vs_policy(game, p0_policy, p1_policy, num_games=3000):
    """Evaluate two policies against each other."""
    wins = [0, 0]
    for _ in range(num_games):
        state = game.new_initial_state()
        while not state.is_terminal():
            player = state.current_player()
            state.apply_action(select_action_from_policy(
                state, player, p0_policy if player == 0 else p1_policy
            ))
        r = state.returns()
        if r[0] > 0:
            wins[0] += 1
        elif r[1] > 0:
            wins[1] += 1
    return wins[0] / num_games


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------

def export_policy(solver, output_path):
    policy = solver.average_policy()
    payload = {
        "metadata": {
            "algorithm": "outcome_sampling_mccfr",
            "abstraction": "bucketed_strategic",
            "iterations": solver.iterations,
            "num_players": solver.num_players,
            "game_version": "1.0",
            "info_states": len(policy),
            "exported_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        },
        "policy": policy,
    }
    os.makedirs(os.path.dirname(os.path.abspath(output_path)) or ".", exist_ok=True)
    with open(output_path, "w") as f:
        json.dump(payload, f, indent=2)
    size_kb = os.path.getsize(output_path) / 1024
    print(f"  -> Exported: {len(policy)} info states, {size_kb:.1f} KB -> {output_path}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Train Imposter Zero via MCCFR")
    parser.add_argument("--iterations", type=int, default=2_000_000)
    parser.add_argument("--epsilon", type=float, default=0.3)
    parser.add_argument("--checkpoint_dir", type=str, default="./training/checkpoints")
    parser.add_argument("--checkpoint_every", type=int, default=500_000)
    parser.add_argument("--output", type=str, default="./training/policy.json")
    parser.add_argument("--eval_every", type=int, default=200_000)
    parser.add_argument("--eval_games", type=int, default=3000)
    parser.add_argument("--seed", type=int, default=None)
    args = parser.parse_args()

    if args.seed is not None:
        random.seed(args.seed)

    game = pyspiel.load_game("imposter_zero")
    solver = OutcomeSamplingMCCFR(game, epsilon=args.epsilon)

    print(f"Imposter Zero — Outcome Sampling MCCFR (bucketed abstraction)")
    print(f"  Players:    {game.num_players()}")
    print(f"  Epsilon:    {args.epsilon}")
    print(f"  Iterations: {args.iterations:,}")
    print()

    start_time = time.time()
    last_report = start_time

    for t in range(1, args.iterations + 1):
        solver.iteration()

        now = time.time()
        if now - last_report >= 5.0 or t == args.iterations:
            elapsed = now - start_time
            rate = t / elapsed
            eta = (args.iterations - t) / rate if rate > 0 else 0
            n_states = len(solver.strategy_sum)
            print(
                f"  iter {t:>10,} / {args.iterations:,}"
                f"  |  {rate:,.0f} it/s"
                f"  |  states: {n_states:,}"
                f"  |  elapsed: {elapsed:.0f}s"
                f"  |  ETA: {eta:.0f}s"
            )
            last_report = now

        if t % args.eval_every == 0:
            policy = solver.average_policy()
            wr = evaluate_vs_random(game, policy, args.eval_games)
            print(f"  ** eval @ {t:,}: win rate vs random = {wr:.1%}")

        if t % args.checkpoint_every == 0:
            ckpt = os.path.join(args.checkpoint_dir, f"policy_iter{t}.json")
            export_policy(solver, ckpt)

    print()
    elapsed = time.time() - start_time
    print(f"Training complete: {solver.iterations:,} iterations in {elapsed:.1f}s")

    policy = solver.average_policy()
    wr = evaluate_vs_random(game, policy, args.eval_games)
    print(f"Final win rate vs random: {wr:.1%}")

    mirror_wr = evaluate_policy_vs_policy(game, policy, policy, args.eval_games)
    print(f"Self-play win rate (should be ~50%%): {mirror_wr:.1%}")
    print()

    export_policy(solver, args.output)


if __name__ == "__main__":
    main()
