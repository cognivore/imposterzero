"""
Hybrid PPO + IS-MCTS training for Imposter Kings.

This extends train_ppo.py with IS-MCTS action selection during episode generation.
The network learns via PPO from high-quality trajectories generated with MCTS lookahead.

Key differences from train_ppo.py:
- A fraction of episodes use IS-MCTS for action selection (mcts_fraction)
- Trivial decisions (1-2 legal actions) skip search for efficiency
- Search budget scales with action complexity

Usage:
  python train_mcts.py --max_time 28800 --mcts_fraction 0.2 --mcts_iterations 100
"""

from __future__ import annotations

import argparse
import gc
import json
import os
import pickle
import random
import time
from multiprocessing import Pool, set_start_method
from typing import List, Tuple

import torch
import torch.nn.functional as F
import pyspiel

import imposter_zero.game as ig  # noqa: F401 — registers games

# Import from train_ppo.py
from train_ppo import (
    ActorCritic,
    League,
    OpponentType,
    OBS_SIZE,
    NUM_ACTIONS,
    raw_observation,
    select_opponent,
    compute_gae,
    evaluate_vs_random,
    evaluate_vs_frozen,
    export_weights,
    generate_timestamped_output,
    check_output_path,
    rotate_checkpoints,
)

# Import MCTS components
from mcts.tree import ISMCTSNode
from mcts.search import ISMCTSConfig, ismcts_search, should_use_search
from mcts.determinizer import clone_and_randomize


def _worker_simulate_mcts(args):
    """
    Simulate episodes using IS-MCTS for action selection.

    This is the hybrid approach: use IS-MCTS to select actions (getting
    higher-quality decisions), but still learn via PPO.
    """
    (weights_bytes, opponent_weights_bytes, opponent_type, n_episodes, seed,
     input_size, hidden_size, num_layers, num_actions,
     mcts_iterations, mcts_c_puct, mcts_temperature, use_mcts) = args

    net = ActorCritic(input_size, hidden_size, num_actions, num_layers)
    net.load_state_dict(pickle.loads(weights_bytes))
    net.eval()

    # Load opponent network if needed
    opp_net = None
    if opponent_type == OpponentType.LEAGUE and opponent_weights_bytes is not None:
        opp_net = ActorCritic(input_size, hidden_size, num_actions, num_layers)
        opp_net.load_state_dict(pickle.loads(opponent_weights_bytes))
        opp_net.eval()

    mcts_config = ISMCTSConfig(
        num_iterations=mcts_iterations,
        c_puct=mcts_c_puct,
        temperature=mcts_temperature,
        device="cpu",  # Workers always use CPU
    )

    game = pyspiel.load_game("imposter_zero_match")
    rng = random.Random(seed)
    results = []

    for _ in range(n_episodes):
        state = game.new_initial_state()
        # Trajectory for player 0 (the learner)
        obs_list = []
        act_list = []
        log_prob_list = []
        value_list = []
        player_list = []
        legal_list = []

        while not state.is_terminal():
            player = state.current_player()
            if player < 0:
                break

            legal = state.legal_actions()
            if not legal:
                break

            obs = raw_observation(state, player)

            if player == 0:
                # Learner: decide whether to use MCTS or raw network
                use_search_here = (
                    use_mcts and
                    should_use_search(state, legal) and
                    len(legal) > 2
                )

                if use_search_here:
                    # IS-MCTS action selection
                    root, improved_policy = ismcts_search(
                        state, player, net, mcts_config
                    )

                    # Sample action from improved policy
                    action = _sample_from_policy(improved_policy, mcts_temperature)

                    # Get log_prob and value from network (for PPO)
                    with torch.no_grad():
                        obs_t = torch.tensor([obs], dtype=torch.float32)
                        logits, value = net(obs_t)
                        logits = logits.squeeze(0).clamp(-50, 50)
                        value = value.item()

                    mask = torch.full((num_actions,), -1e9)
                    for a in legal:
                        mask[a] = 0.0

                    masked_logits = logits + mask
                    log_probs = F.log_softmax(masked_logits, dim=0)
                    log_prob = log_probs[action].item()
                else:
                    # Raw network action selection (same as train_ppo)
                    with torch.no_grad():
                        obs_t = torch.tensor([obs], dtype=torch.float32)
                        logits, value = net(obs_t)
                        logits = logits.squeeze(0).clamp(-50, 50)
                        value = value.item()

                    mask = torch.full((num_actions,), -1e9)
                    for a in legal:
                        mask[a] = 0.0

                    masked_logits = logits + mask
                    probs = F.softmax(masked_logits, dim=0)
                    log_probs = F.log_softmax(masked_logits, dim=0)
                    action = torch.multinomial(probs, 1).item()
                    log_prob = log_probs[action].item()

                obs_list.append(obs)
                act_list.append(action)
                log_prob_list.append(log_prob)
                value_list.append(value)
                player_list.append(player)
                legal_list.append(legal)

            else:
                # Opponent selection (same as train_ppo)
                if opponent_type == OpponentType.RANDOM:
                    action = rng.choice(legal)
                elif opponent_type == OpponentType.LEAGUE and opp_net is not None:
                    with torch.no_grad():
                        obs_t = torch.tensor([obs], dtype=torch.float32)
                        logits = opp_net.policy(obs_t).squeeze(0).clamp(-50, 50)
                    mask = torch.full((num_actions,), -1e9)
                    for a in legal:
                        mask[a] = 0.0
                    probs = F.softmax(logits + mask, dim=0)
                    action = torch.multinomial(probs, 1).item()
                else:
                    # Self-play: same policy
                    with torch.no_grad():
                        obs_t = torch.tensor([obs], dtype=torch.float32)
                        logits = net.policy(obs_t).squeeze(0).clamp(-50, 50)
                    mask = torch.full((num_actions,), -1e9)
                    for a in legal:
                        mask[a] = 0.0
                    probs = F.softmax(logits + mask, dim=0)
                    action = torch.multinomial(probs, 1).item()

            state.apply_action(action)

        returns = state.returns() if state.is_terminal() else [0.0, 0.0]
        results.append((obs_list, act_list, log_prob_list, value_list,
                       player_list, legal_list, returns[0]))

    return results


def _sample_from_policy(policy: dict, temperature: float) -> int:
    """Sample action from IS-MCTS improved policy."""
    if not policy:
        raise ValueError("Empty policy")

    if temperature <= 0:
        return max(policy.keys(), key=lambda a: policy[a])

    actions = list(policy.keys())
    probs = [policy[a] ** (1.0 / temperature) for a in actions]
    total = sum(probs)
    probs = [p / total for p in probs]

    return random.choices(actions, weights=probs, k=1)[0]


def main():
    try:
        set_start_method("spawn")
    except RuntimeError:
        pass

    parser = argparse.ArgumentParser(description="Hybrid PPO + IS-MCTS trainer")

    # Training parameters (same as train_ppo)
    parser.add_argument("--episodes", type=int, default=5_000_000)
    parser.add_argument("--max_time", type=int, default=0)
    parser.add_argument("--num_workers", type=int, default=12)
    parser.add_argument("--episodes_per_worker", type=int, default=12)

    # Network architecture
    parser.add_argument("--hidden_size", type=int, default=512)
    parser.add_argument("--num_layers", type=int, default=4)

    # PPO hyperparameters
    parser.add_argument("--lr", type=float, default=3e-4)
    parser.add_argument("--entropy_coeff", type=float, default=0.05)
    parser.add_argument("--clip_ratio", type=float, default=0.2)
    parser.add_argument("--value_coeff", type=float, default=0.5)
    parser.add_argument("--gamma", type=float, default=0.99)
    parser.add_argument("--gae_lambda", type=float, default=0.95)
    parser.add_argument("--ppo_epochs", type=int, default=4)
    parser.add_argument("--minibatch_size", type=int, default=4096)

    # Curriculum parameters
    parser.add_argument("--curriculum_random_until", type=int, default=10_000)
    parser.add_argument("--curriculum_self_until", type=int, default=50_000)
    parser.add_argument("--league_size", type=int, default=20)
    parser.add_argument("--league_add_every", type=int, default=20_000)

    # IS-MCTS parameters
    parser.add_argument("--mcts_fraction", type=float, default=0.20,
                        help="Fraction of episodes using IS-MCTS (0.0-1.0)")
    parser.add_argument("--mcts_iterations", type=int, default=100,
                        help="IS-MCTS iterations per decision")
    parser.add_argument("--mcts_c_puct", type=float, default=1.5,
                        help="Exploration constant for PUCT")
    parser.add_argument("--mcts_temperature", type=float, default=1.0,
                        help="Temperature for action sampling")
    parser.add_argument("--mcts_start_after", type=int, default=10_000,
                        help="Start using MCTS after this many episodes")

    # Evaluation parameters
    parser.add_argument("--eval_every", type=int, default=10_000)
    parser.add_argument("--eval_games", type=int, default=500)
    parser.add_argument("--frozen_update_every", type=int, default=50_000)
    parser.add_argument("--abstract_policy", type=str,
                        default="./training/policy_match_neural.json")

    # Output
    parser.add_argument("--output", type=str, default=None)
    parser.add_argument("--output_prefix", type=str, default="policy_mcts")
    parser.add_argument("--keep_checkpoints", type=int, default=5)
    parser.add_argument("--seed", type=int, default=None)
    parser.add_argument("--patience", type=int, default=0)
    parser.add_argument("--resume", type=str, default=None)
    parser.add_argument("--max_batch_samples", type=int, default=50_000)
    parser.add_argument("--cleanup_every", type=int, default=100)

    args = parser.parse_args()

    # Generate timestamped output path if not specified
    if args.output is None:
        args.output = generate_timestamped_output("./training", args.output_prefix)
        print(f"  Using timestamped output: {args.output}")

    check_output_path(args.output, args.resume)

    if args.seed is not None:
        random.seed(args.seed)
        torch.manual_seed(args.seed)

    device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    game = pyspiel.load_game("imposter_zero_match")

    # Initialize networks
    net = ActorCritic(OBS_SIZE, args.hidden_size, NUM_ACTIONS, args.num_layers).to(device)
    frozen_net = ActorCritic(OBS_SIZE, args.hidden_size, NUM_ACTIONS, args.num_layers).to(device)

    # Initialize league
    league = League(max_size=args.league_size)

    if args.resume:
        with open(args.resume) as f:
            resume_data = json.load(f)
        rw = resume_data["weights"]
        sd = net.state_dict()
        linear_keys = [(k.rsplit(".", 1)[0], k) for k in sd if k.endswith(".weight")]
        linear_keys.sort(key=lambda t: t[1])
        for i, (prefix, wkey) in enumerate(linear_keys):
            sd[wkey] = torch.tensor(rw[f"w{i+1}"])
            bkey = prefix + ".bias"
            if bkey in sd and f"b{i+1}" in rw:
                sd[bkey] = torch.tensor(rw[f"b{i+1}"])
        net.load_state_dict(sd)
        net.to(device)
        reps = resume_data.get("metadata", {}).get("episodes", 0)
        rwr = resume_data.get("metadata", {}).get("win_rate_vs_random", 0)
        print(f"  Resumed from: {args.resume} ({reps:,} eps, wr={rwr:.1%})")
    else:
        reps = 0
        rwr = 0.0

    # Copy to frozen
    frozen_net.load_state_dict(net.state_dict())

    optimizer = torch.optim.Adam(net.parameters(), lr=args.lr)
    batch_size = args.num_workers * args.episodes_per_worker
    n_params = sum(p.numel() for p in net.parameters())

    print(f"Imposter Zero 2p Match — Hybrid PPO + IS-MCTS Training")
    print(f"  Device:      {device}")
    print(f"  Network:     {OBS_SIZE} -> {'x'.join([str(args.hidden_size)] * (args.num_layers - 1))} -> {NUM_ACTIONS} ({args.num_layers} layers)")
    print(f"  Parameters:  {n_params:,}")
    print(f"  Algorithm:   PPO (clip={args.clip_ratio}, ent={args.entropy_coeff})")
    print(f"  IS-MCTS:     {args.mcts_fraction:.0%} episodes, {args.mcts_iterations} iterations, c_puct={args.mcts_c_puct}")
    print(f"  Curriculum:  random<{args.curriculum_random_until}, self<{args.curriculum_self_until}, then league")
    print(f"  Workers:     {args.num_workers} x {args.episodes_per_worker} eps/worker")
    print(f"  LR:          {args.lr}")
    if args.max_time > 0:
        print(f"  Max time:    {args.max_time}s ({args.max_time // 3600}h {(args.max_time % 3600) // 60}m)")
    else:
        print(f"  Max time:    unlimited (max {args.episodes:,} episodes)")
    print(f"  Output:      {args.output}")
    print()

    start_time = time.time()
    last_report = start_time
    episode = reps
    best_wr_random = rwr
    best_wr_frozen = 0.5
    evals_without_improvement = 0
    stop_reason = "max_episodes"
    batch_count = 0
    last_frozen_update = 0
    last_league_add = 0
    mcts_episodes_total = 0
    raw_episodes_total = 0

    pool = Pool(processes=args.num_workers)

    try:
        while episode < args.episodes:
            if args.max_time > 0 and (time.time() - start_time) >= args.max_time:
                stop_reason = "time_limit"
                break

            # Select opponent type based on curriculum
            opponent_type = select_opponent(
                episode, args.curriculum_random_until,
                args.curriculum_self_until, league
            )

            # Get opponent weights if using league
            opponent_weights = None
            if opponent_type == OpponentType.LEAGUE:
                opponent_weights = league.sample()
                if opponent_weights is None:
                    opponent_type = OpponentType.SELF

            net.cpu()
            weights_bytes = pickle.dumps(net.state_dict())
            net.to(device)

            # Decide which workers use MCTS
            # MCTS is more expensive, so we only use it for a fraction of workers
            use_mcts_enabled = (
                episode >= args.mcts_start_after and
                args.mcts_fraction > 0
            )

            base_seed = random.randint(0, 2**31)
            worker_args = []
            for i in range(args.num_workers):
                # Each worker either uses MCTS or not (based on fraction)
                use_mcts = use_mcts_enabled and (random.random() < args.mcts_fraction)
                worker_args.append((
                    weights_bytes, opponent_weights, opponent_type,
                    args.episodes_per_worker, base_seed + i,
                    OBS_SIZE, args.hidden_size, args.num_layers, NUM_ACTIONS,
                    args.mcts_iterations, args.mcts_c_puct, args.mcts_temperature,
                    use_mcts
                ))

            all_results = pool.map(_worker_simulate_mcts, worker_args)

            # Track MCTS vs raw episode counts
            for i, wa in enumerate(worker_args):
                if wa[-1]:  # use_mcts flag
                    mcts_episodes_total += args.episodes_per_worker
                else:
                    raw_episodes_total += args.episodes_per_worker

            # Flatten trajectories (same as train_ppo)
            flat_obs = []
            flat_acts = []
            flat_old_log_probs = []
            flat_values = []
            flat_returns = []
            flat_advantages = []
            flat_legal = []

            for worker_eps in all_results:
                for (obs_list, act_list, log_prob_list, value_list,
                     player_list, legal_list, final_return) in worker_eps:
                    if not obs_list:
                        continue

                    advantages, returns = compute_gae(
                        final_return, value_list, args.gamma, args.gae_lambda
                    )

                    for i, (obs, act, lp, val, legal) in enumerate(
                        zip(obs_list, act_list, log_prob_list, value_list, legal_list)
                    ):
                        flat_obs.append(obs)
                        flat_acts.append(act)
                        flat_old_log_probs.append(lp)
                        flat_values.append(val)
                        flat_returns.append(returns[i] if i < len(returns) else final_return)
                        flat_advantages.append(advantages[i] if i < len(advantages) else 0.0)
                        flat_legal.append(legal)

            episode += batch_size
            if not flat_obs:
                continue

            # Truncate if needed
            n_samples = len(flat_obs)
            if args.max_batch_samples > 0 and n_samples > args.max_batch_samples:
                indices = list(range(n_samples))
                random.shuffle(indices)
                indices = indices[:args.max_batch_samples]
                flat_obs = [flat_obs[i] for i in indices]
                flat_acts = [flat_acts[i] for i in indices]
                flat_old_log_probs = [flat_old_log_probs[i] for i in indices]
                flat_returns = [flat_returns[i] for i in indices]
                flat_advantages = [flat_advantages[i] for i in indices]
                flat_legal = [flat_legal[i] for i in indices]
                n_samples = args.max_batch_samples

            # Convert to tensors
            try:
                obs_t = torch.tensor(flat_obs, dtype=torch.float32, device=device)
                acts_t = torch.tensor(flat_acts, dtype=torch.long, device=device)
                old_log_probs_t = torch.tensor(flat_old_log_probs, dtype=torch.float32, device=device)
                returns_t = torch.tensor(flat_returns, dtype=torch.float32, device=device)
                advantages_t = torch.tensor(flat_advantages, dtype=torch.float32, device=device)

                # Normalize advantages
                advantages_t = (advantages_t - advantages_t.mean()) / (advantages_t.std() + 1e-8)

                # Build masks
                masks_t = torch.full((n_samples, NUM_ACTIONS), -1e9, device=device)
                for i, legal in enumerate(flat_legal):
                    masks_t[i, legal] = 0.0

                # PPO update epochs
                total_policy_loss = 0.0
                total_value_loss = 0.0
                total_entropy = 0.0

                for _ in range(args.ppo_epochs):
                    indices = torch.randperm(n_samples, device=device)

                    for start in range(0, n_samples, args.minibatch_size):
                        end = min(start + args.minibatch_size, n_samples)
                        mb_idx = indices[start:end]

                        mb_obs = obs_t[mb_idx]
                        mb_acts = acts_t[mb_idx]
                        mb_old_lp = old_log_probs_t[mb_idx]
                        mb_returns = returns_t[mb_idx]
                        mb_adv = advantages_t[mb_idx]
                        mb_masks = masks_t[mb_idx]

                        logits, values = net(mb_obs)
                        logits = logits.clamp(-50, 50)

                        masked_logits = logits + mb_masks
                        log_probs = F.log_softmax(masked_logits, dim=1)
                        new_log_probs = log_probs.gather(1, mb_acts.unsqueeze(1)).squeeze(1)

                        ratio = torch.exp(new_log_probs - mb_old_lp)
                        surr1 = ratio * mb_adv
                        surr2 = torch.clamp(ratio, 1 - args.clip_ratio, 1 + args.clip_ratio) * mb_adv
                        policy_loss = -torch.min(surr1, surr2).mean()

                        value_loss = F.mse_loss(values, mb_returns)

                        probs = F.softmax(masked_logits, dim=1)
                        entropy_terms = probs * log_probs
                        entropy = -torch.nan_to_num(entropy_terms, nan=0.0).sum(dim=1).mean()

                        loss = (policy_loss
                                + args.value_coeff * value_loss
                                - args.entropy_coeff * entropy)

                        optimizer.zero_grad()
                        loss.backward()
                        torch.nn.utils.clip_grad_norm_(net.parameters(), 0.5)
                        optimizer.step()

                        total_policy_loss += policy_loss.item()
                        total_value_loss += value_loss.item()
                        total_entropy += entropy.item()

                n_updates = args.ppo_epochs * ((n_samples + args.minibatch_size - 1) // args.minibatch_size)
                avg_policy_loss = total_policy_loss / n_updates
                avg_value_loss = total_value_loss / n_updates
                avg_entropy = total_entropy / n_updates

            except Exception as e:
                print(f"  Warning: Batch failed ({e}), skipping")
                continue

            batch_count += 1

            # Periodic reporting
            now = time.time()
            if now - last_report >= 60:
                elapsed = now - start_time
                eps_per_sec = episode / elapsed if elapsed > 0 else 0
                mcts_pct = mcts_episodes_total / max(1, mcts_episodes_total + raw_episodes_total) * 100
                print(f"[{elapsed/60:.0f}m] {episode:,} eps ({eps_per_sec:.1f}/s) "
                      f"| MCTS: {mcts_pct:.0f}% | policy_loss={avg_policy_loss:.4f} "
                      f"| value_loss={avg_value_loss:.4f} | entropy={avg_entropy:.4f}")
                last_report = now

            # Cleanup
            if batch_count % args.cleanup_every == 0:
                gc.collect()

            # League management
            if episode - last_league_add >= args.league_add_every:
                wr_for_league = evaluate_vs_random(game, net, device, num_games=100)
                net.cpu()
                wb = pickle.dumps(net.state_dict())
                net.to(device)
                league.add(episode, wb, wr_for_league)
                last_league_add = episode

            # Frozen checkpoint update
            if episode - last_frozen_update >= args.frozen_update_every:
                wr_frozen = evaluate_vs_frozen(game, net, frozen_net, device, num_games=100)
                if wr_frozen >= 0.55:
                    frozen_net.load_state_dict(net.state_dict())
                    last_frozen_update = episode
                    print(f"  -> Updated frozen checkpoint (wr_frozen={wr_frozen:.1%})")

            # Evaluation
            if episode % args.eval_every < batch_size:
                wr_random = evaluate_vs_random(game, net, device, args.eval_games)
                wr_frozen = evaluate_vs_frozen(game, net, frozen_net, device, args.eval_games // 2)
                elapsed = time.time() - start_time
                mcts_pct = mcts_episodes_total / max(1, mcts_episodes_total + raw_episodes_total) * 100

                print(f"[Eval {episode:,}] vs-random={wr_random:.1%} vs-frozen={wr_frozen:.1%} "
                      f"| best={best_wr_random:.1%} | MCTS={mcts_pct:.0f}% | {elapsed/60:.0f}m elapsed")

                if wr_random > best_wr_random:
                    best_wr_random = wr_random
                    evals_without_improvement = 0
                    net.cpu()
                    meta = {
                        "algorithm": "ppo_ismcts_hybrid",
                        "action_space": "raw",
                        "num_players": 2,
                        "game": "imposter_zero_match",
                        "game_version": "3.0-match-mcts",
                        "input_size": OBS_SIZE,
                        "hidden_size": args.hidden_size,
                        "num_layers": args.num_layers,
                        "output_size": NUM_ACTIONS,
                        "num_actions": NUM_ACTIONS,
                        "episodes": episode,
                        "win_rate_vs_random": round(wr_random, 4),
                        "win_rate_vs_frozen": round(wr_frozen, 4),
                        "mcts_fraction": args.mcts_fraction,
                        "mcts_iterations": args.mcts_iterations,
                        "entropy_coeff": args.entropy_coeff,
                        "exported_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    }
                    export_weights(
                        net, args.output, meta,
                        rotate_prefix=args.output_prefix if args.keep_checkpoints > 0 else None,
                        rotate_dir="./training",
                        keep_checkpoints=args.keep_checkpoints
                    )
                    net.to(device)
                else:
                    evals_without_improvement += 1

                best_wr_frozen = max(best_wr_frozen, wr_frozen)

                if args.patience > 0 and evals_without_improvement >= args.patience:
                    stop_reason = f"early_stop ({evals_without_improvement} evals w/o improvement)"
                    break

    finally:
        pool.terminate()
        pool.join()

    elapsed = time.time() - start_time
    mcts_pct = mcts_episodes_total / max(1, mcts_episodes_total + raw_episodes_total) * 100
    print()
    print(f"Training finished: {episode:,} episodes in {elapsed:.1f}s ({stop_reason})")
    print(f"MCTS episodes: {mcts_episodes_total:,} ({mcts_pct:.0f}%)")

    net.cpu()
    wr = evaluate_vs_random(game, net, torch.device("cpu"), args.eval_games)
    print(f"Final win rate vs random: {wr:.1%}")
    print(f"Best win rate vs random: {best_wr_random:.1%}")
    print(f"Best win rate vs frozen: {best_wr_frozen:.1%}")

    if wr >= best_wr_random:
        meta = {
            "algorithm": "ppo_ismcts_hybrid",
            "action_space": "raw",
            "num_players": 2,
            "game": "imposter_zero_match",
            "game_version": "3.0-match-mcts",
            "input_size": OBS_SIZE,
            "hidden_size": args.hidden_size,
            "num_layers": args.num_layers,
            "output_size": NUM_ACTIONS,
            "num_actions": NUM_ACTIONS,
            "episodes": episode,
            "win_rate_vs_random": round(wr, 4),
            "mcts_fraction": args.mcts_fraction,
            "mcts_iterations": args.mcts_iterations,
            "entropy_coeff": args.entropy_coeff,
            "exported_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        export_weights(
            net, args.output, meta,
            rotate_prefix=args.output_prefix if args.keep_checkpoints > 0 else None,
            rotate_dir="./training",
            keep_checkpoints=args.keep_checkpoints
        )


if __name__ == "__main__":
    main()
