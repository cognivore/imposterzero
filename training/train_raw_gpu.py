"""
GPU-accelerated REINFORCE with raw action output for 2p expansion matches.

Unlike the abstract trainer, this network outputs a probability distribution
over all 2,990 concrete encoded actions. The observation includes card-identity
binary vectors so the network can learn card-specific strategies (e.g. "play
Fool when court has high-value face-up cards").

Uses multiprocessing for parallel game simulation and MPS for batched gradient
computation. Self-play: both players share the same network.

Does NOT import from imposter_zero.abstraction — fully self-contained.

Usage:
  python train_raw_gpu.py --max_time 28800 --output ./training/policy_raw_neural.json
"""

import argparse
import gc
import json
import os
import pickle
import random
import time
from multiprocessing import Pool, set_start_method

import torch
import torch.nn as nn
import torch.nn.functional as F
import pyspiel

import imposter_zero.game as ig  # noqa: F401 — registers games

NUM_ACTIONS = ig._DIMS_MATCH["num_actions"]
MAX_CARD_ID = ig._DIMS_MATCH["max_card_id"]
SPAN = MAX_CARD_ID + 1

# ---------------------------------------------------------------------------
# Observation: 110-dim with card-identity vectors
# ---------------------------------------------------------------------------

_OBS_SIZE = 3 + 7 + SPAN + SPAN + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 3 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 3
# = 3 + 7 + 38 + 38 + 17 + 3 = 106... let me compute exactly below


def _obs_size():
    return (
        3       # active_player one-hot
        + 7     # phase one-hot
        + SPAN  # hand binary
        + SPAN  # court face-up binary
        + 1     # king_face_up
        + 1     # successor_set
        + 1     # dungeon_set
        + 1     # throne_value / 9
        + 1     # court_size / 15
        + 1     # accused_value / 9
        + 1     # forgotten_exists
        + 3     # first_player one-hot
        + 1     # opp_hand_size / 9
        + 1     # opp_king_up
        + 1     # antechamber / 5
        + 1     # condemned / 10
        + 1     # disgraced / 7
        + 1     # my_score / 7
        + 1     # opp_score / 7
        + 1     # rounds / 14
        + 1     # army_avail / 8
        + 1     # army_exhausted / 8
        + 3     # facet one-hot
    )


OBS_SIZE = _obs_size()


def raw_observation(state, player):
    """Card-identity-aware observation for raw action output."""
    n = state._num_players
    opp = (player + 1) % n

    active_oh = [0.0] * 3
    if state._active_player < 3:
        active_oh[state._active_player] = 1.0

    phase = state._phase
    phase_oh = [float(phase == p) for p in (
        "crown", "setup", "play", "mustering",
        "draft_select", "draft_order", "draft_pick",
    )]

    hand_bin = [0.0] * SPAN
    for cid in state._hands[player]:
        if 0 <= cid < SPAN:
            hand_bin[cid] = 1.0

    court_up = [0.0] * SPAN
    for cid, fu, _ in state._court:
        if fu and 0 <= cid < SPAN:
            court_up[cid] = 1.0

    king_up = float(state._king_face_up[player])
    succ_set = float(state._successors[player] is not None)
    dung_set = float(state._dungeons[player] is not None)
    throne = state._throne_value() / 9.0
    court_sz = len(state._court) / 15.0
    accused_val = (state._card_values.get(state._accused, 0) / 9.0) if state._accused is not None else 0.0
    forgotten = float(state._forgotten is not None)

    fp_oh = [0.0] * 3
    fp = getattr(state, "_first_player", 0)
    if fp < 3:
        fp_oh[fp] = 1.0

    opp_hand = len(state._hands[opp]) / 9.0
    opp_king = float(state._king_face_up[opp])

    ante = len(state._antechamber[player]) / 5.0
    condemned = len(state._condemned) / 10.0
    disgraced = sum(1 for _, fu, _ in state._court if not fu) / 7.0

    scores = getattr(state, "_match_scores", [0, 0])
    my_score = scores[player] / 7.0
    opp_score = scores[opp] / 7.0
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
        active_oh + phase_oh + hand_bin + court_up +
        [king_up, succ_set, dung_set, throne, court_sz, accused_val, forgotten] +
        fp_oh + [opp_hand, opp_king] +
        [ante, condemned, disgraced] +
        [my_score, opp_score, rounds, army_avail, army_exh] +
        facet_oh
    )


# ---------------------------------------------------------------------------
# Policy network
# ---------------------------------------------------------------------------

class PolicyNet(nn.Module):
    def __init__(self, input_size=OBS_SIZE, hidden_size=512, output_size=NUM_ACTIONS, num_layers=4):
        super().__init__()
        layers = [nn.Linear(input_size, hidden_size), nn.ReLU()]
        for _ in range(num_layers - 2):
            layers += [nn.Linear(hidden_size, hidden_size), nn.ReLU()]
        layers.append(nn.Linear(hidden_size, output_size))
        self.net = nn.Sequential(*layers)

    def forward(self, x):
        return self.net(x)


# ---------------------------------------------------------------------------
# Worker: simulate episodes on CPU with raw actions
# ---------------------------------------------------------------------------

def _worker_simulate(args):
    weights_bytes, n_episodes, seed, input_size, hidden_size, num_layers, num_actions = args

    net = PolicyNet(input_size, hidden_size, num_actions, num_layers)
    net.load_state_dict(pickle.loads(weights_bytes))
    net.eval()

    game = pyspiel.load_game("imposter_zero_match")
    rng = random.Random(seed)
    results = []

    for _ in range(n_episodes):
        state = game.new_initial_state()
        obs_list = []
        act_list = []
        player_list = []
        legal_list = []  # Store legal action indices for entropy calculation

        while not state.is_terminal():
            player = state.current_player()
            if player < 0:
                break

            legal = state.legal_actions()
            if not legal:
                break  # No legal actions, terminal state

            obs = raw_observation(state, player)

            with torch.no_grad():
                obs_t = torch.tensor([obs], dtype=torch.float32)
                logits = net(obs_t).squeeze(0)

            # Clamp logits and use -1e9 (not -inf) for MPS gradient stability
            logits = logits.clamp(-50, 50)

            mask = torch.full((num_actions,), -1e9)
            for a in legal:
                mask[a] = 0.0

            probs = F.softmax(logits + mask, dim=0)
            action = torch.multinomial(probs, 1).item()

            obs_list.append(obs)
            act_list.append(action)
            player_list.append(player)
            legal_list.append(legal)
            state.apply_action(action)

        returns = state.returns() if state.is_terminal() else [0.0, 0.0]
        results.append((obs_list, act_list, player_list, legal_list, returns))

    return results


# ---------------------------------------------------------------------------
# Evaluation
# ---------------------------------------------------------------------------

def evaluate_vs_random(game, net, device, num_games=1000):
    wins = 0
    net.eval()
    with torch.no_grad():
        for _ in range(num_games):
            state = game.new_initial_state()
            steps = 0
            while not state.is_terminal() and steps < 800:
                player = state.current_player()
                if player < 0:
                    break
                if player == 0:
                    legal = state.legal_actions()
                    if not legal:
                        break
                    obs = raw_observation(state, player)
                    obs_t = torch.tensor([obs], dtype=torch.float32, device=device)
                    logits = net(obs_t).squeeze(0).clamp(-50, 50)
                    mask = torch.full((NUM_ACTIONS,), -1e9, device=device)
                    for a in legal:
                        mask[a] = 0.0
                    probs = F.softmax(logits + mask, dim=0)
                    action = torch.multinomial(probs, 1).item()
                    state.apply_action(action)
                else:
                    state.apply_action(random.choice(state.legal_actions()))
                steps += 1
            if state.is_terminal() and state.returns()[0] > 0:
                wins += 1
    net.train()
    return wins / num_games


# ---------------------------------------------------------------------------
# Memory management
# ---------------------------------------------------------------------------

def cleanup_memory(device):
    """Free unused memory to prevent OOM during long training runs."""
    gc.collect()
    if device.type == "mps":
        torch.mps.empty_cache()
    elif device.type == "cuda":
        torch.cuda.empty_cache()


# ---------------------------------------------------------------------------
# Export weights as JSON
# ---------------------------------------------------------------------------

def export_weights(net, output_path, metadata):
    sd = net.state_dict()
    weights = {}
    linear_keys = [(k.rsplit(".", 1)[0], k) for k in sd if k.endswith(".weight")]
    linear_keys.sort(key=lambda t: t[1])
    for i, (prefix, wkey) in enumerate(linear_keys):
        bkey = prefix + ".bias"
        weights[f"w{i + 1}"] = sd[wkey].cpu().tolist()
        if bkey in sd:
            weights[f"b{i + 1}"] = sd[bkey].cpu().tolist()
    payload = {"metadata": metadata, "weights": weights}
    os.makedirs(os.path.dirname(os.path.abspath(output_path)) or ".", exist_ok=True)
    with open(output_path, "w") as f:
        json.dump(payload, f)
    size_mb = os.path.getsize(output_path) / (1024 * 1024)
    print(f"  -> Exported: {size_mb:.1f} MB -> {output_path}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    try:
        set_start_method("spawn")
    except RuntimeError:
        pass

    parser = argparse.ArgumentParser(description="Raw-action GPU REINFORCE for 2p matches")
    parser.add_argument("--episodes", type=int, default=5_000_000)
    parser.add_argument("--max_time", type=int, default=0)
    parser.add_argument("--num_workers", type=int, default=12)
    parser.add_argument("--episodes_per_worker", type=int, default=12)
    parser.add_argument("--hidden_size", type=int, default=512)
    parser.add_argument("--num_layers", type=int, default=4)
    parser.add_argument("--lr", type=float, default=3e-4)
    parser.add_argument("--entropy_coeff", type=float, default=0.01)
    parser.add_argument("--eval_every", type=int, default=10_000)
    parser.add_argument("--eval_games", type=int, default=1000)
    parser.add_argument("--output", type=str, default="./training/policy_raw_neural.json")
    parser.add_argument("--seed", type=int, default=None)
    parser.add_argument("--patience", type=int, default=0)
    parser.add_argument("--resume", type=str, default=None)
    parser.add_argument("--max_batch_samples", type=int, default=50_000,
                        help="Max samples per batch to prevent OOM (0=unlimited)")
    parser.add_argument("--cleanup_every", type=int, default=100,
                        help="Run garbage collection every N batches")
    args = parser.parse_args()

    if args.seed is not None:
        random.seed(args.seed)
        torch.manual_seed(args.seed)

    if torch.backends.mps.is_available():
        device = torch.device("mps")
    else:
        device = torch.device("cpu")

    game = pyspiel.load_game("imposter_zero_match")
    net = PolicyNet(OBS_SIZE, args.hidden_size, NUM_ACTIONS, args.num_layers).to(device)

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

    optimizer = torch.optim.Adam(net.parameters(), lr=args.lr)
    batch_size = args.num_workers * args.episodes_per_worker
    n_params = sum(p.numel() for p in net.parameters())

    print(f"Imposter Zero 2p Match — Raw-Action GPU REINFORCE (self-play)")
    print(f"  Device:      {device}")
    print(f"  Network:     {OBS_SIZE} -> {'x'.join([str(args.hidden_size)] * (args.num_layers - 1))} -> {NUM_ACTIONS} ({args.num_layers} layers)")
    print(f"  Parameters:  {n_params:,}")
    print(f"  Actions:     {NUM_ACTIONS} (raw encoded)")
    print(f"  Obs dims:    {OBS_SIZE}")
    print(f"  Workers:     {args.num_workers}")
    print(f"  Batch:       {batch_size} episodes ({args.episodes_per_worker}/worker)")
    print(f"  LR:          {args.lr}")
    print(f"  Entropy:     {args.entropy_coeff}")
    print()

    start_time = time.time()
    last_report = start_time
    episode = 0
    best_wr = 0.0

    # Restore episode count and best_wr when resuming
    if args.resume:
        episode = reps
        best_wr = rwr

    evals_without_improvement = 0
    stop_reason = "max_episodes"
    batch_count = 0

    pool = Pool(processes=args.num_workers)

    try:
        while episode < args.episodes:
            if args.max_time > 0 and (time.time() - start_time) >= args.max_time:
                stop_reason = "time_limit"
                break

            net.cpu()
            weights_bytes = pickle.dumps(net.state_dict())
            net.to(device)

            base_seed = random.randint(0, 2**31)
            worker_args = [
                (weights_bytes, args.episodes_per_worker, base_seed + i,
                 OBS_SIZE, args.hidden_size, args.num_layers, NUM_ACTIONS)
                for i in range(args.num_workers)
            ]

            all_results = pool.map(_worker_simulate, worker_args)

            flat_obs = []
            flat_acts = []
            flat_rewards = []
            flat_legal = []

            for worker_eps in all_results:
                for obs_list, act_list, player_list, legal_list, returns in worker_eps:
                    for obs, act, plr, legal in zip(obs_list, act_list, player_list, legal_list):
                        flat_obs.append(obs)
                        flat_acts.append(act)
                        flat_rewards.append(returns[plr])
                        flat_legal.append(legal)

            episode += batch_size
            if not flat_obs:
                continue

            # Truncate batch if too large to prevent OOM
            n_samples = len(flat_obs)
            if args.max_batch_samples > 0 and n_samples > args.max_batch_samples:
                flat_obs = flat_obs[:args.max_batch_samples]
                flat_acts = flat_acts[:args.max_batch_samples]
                flat_rewards = flat_rewards[:args.max_batch_samples]
                flat_legal = flat_legal[:args.max_batch_samples]
                n_samples = args.max_batch_samples

            # GPU training step with OOM recovery
            try:
                obs_t = torch.tensor(flat_obs, dtype=torch.float32, device=device)
                acts_t = torch.tensor(flat_acts, dtype=torch.long, device=device)
                rewards_t = torch.tensor(flat_rewards, dtype=torch.float32, device=device)

                # Build legal action masks from sparse indices
                # Use large negative value instead of -inf to avoid MPS numerical issues
                n_samples = len(flat_obs)
                masks_t = torch.full((n_samples, NUM_ACTIONS), -1e9, device=device)
                for i, legal in enumerate(flat_legal):
                    masks_t[i, legal] = 0.0

                rewards_t = (rewards_t - rewards_t.mean()) / (rewards_t.std() + 1e-8)

                logits = net(obs_t).clamp(-50, 50)

                # Apply mask for correct log probabilities
                masked_logits = logits + masks_t
                log_probs = F.log_softmax(masked_logits, dim=1)
                selected_lp = log_probs.gather(1, acts_t.unsqueeze(1)).squeeze(1)

                policy_loss = -(selected_lp * rewards_t).mean()

                # Entropy over LEGAL actions only
                # Use nan_to_num to handle 0 * -inf = NaN for illegal actions
                masked_probs = F.softmax(masked_logits, dim=1)
                entropy_terms = masked_probs * log_probs
                entropy = -torch.nan_to_num(entropy_terms, nan=0.0).sum(dim=1).mean()
                total_loss = policy_loss - args.entropy_coeff * entropy

                optimizer.zero_grad()
                total_loss.backward()
                torch.nn.utils.clip_grad_norm_(net.parameters(), 1.0)
                optimizer.step()

            except RuntimeError as e:
                if "out of memory" in str(e).lower() or "MPS" in str(e):
                    print(f"  !! OOM at ep {episode} (batch {n_samples} samples), clearing memory and continuing...")
                    cleanup_memory(device)
                    continue
                raise

            # Periodic memory cleanup to prevent OOM during long runs
            batch_count += 1
            if batch_count % args.cleanup_every == 0:
                cleanup_memory(device)

            now = time.time()
            if now - last_report >= 10.0 or episode >= args.episodes:
                elapsed = now - start_time
                rate = episode / elapsed
                remaining = max(0, args.max_time - elapsed) if args.max_time > 0 else (args.episodes - episode) / rate if rate > 0 else 0
                tag = "remaining" if args.max_time > 0 else "ETA"
                print(
                    f"  ep {episode:>9,}"
                    f"  |  {rate:,.0f} ep/s"
                    f"  |  loss: {total_loss.item():.4f}"
                    f"  |  ent: {entropy.item():.3f}"
                    f"  |  best: {best_wr:.1%}"
                    f"  |  {tag}: {remaining:.0f}s"
                )
                last_report = now

            if episode % args.eval_every < batch_size:
                net.cpu()
                wr = evaluate_vs_random(game, net, torch.device("cpu"), args.eval_games)
                net.to(device)
                print(f"  ** eval @ {episode:,}: win rate vs random = {wr:.1%}")
                if wr > best_wr:
                    best_wr = wr
                    evals_without_improvement = 0
                    meta = {
                        "algorithm": "reinforce_raw_gpu_self_play",
                        "action_space": "raw",
                        "num_players": 2,
                        "game": "imposter_zero_match",
                        "game_version": "3.0-match-raw",
                        "input_size": OBS_SIZE,
                        "hidden_size": args.hidden_size,
                        "num_layers": args.num_layers,
                        "output_size": NUM_ACTIONS,
                        "num_actions": NUM_ACTIONS,
                        "episodes": episode,
                        "win_rate_vs_random": round(wr, 4),
                        "exported_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    }
                    net.cpu()
                    export_weights(net, args.output, meta)
                    net.to(device)
                else:
                    evals_without_improvement += 1
                if args.patience > 0 and evals_without_improvement >= args.patience:
                    stop_reason = f"early_stop ({evals_without_improvement} evals w/o improvement)"
                    break

    finally:
        pool.terminate()
        pool.join()

    elapsed = time.time() - start_time
    print()
    print(f"Training finished: {episode:,} episodes in {elapsed:.1f}s ({stop_reason})")

    net.cpu()
    wr = evaluate_vs_random(game, net, torch.device("cpu"), args.eval_games)
    print(f"Final win rate vs random: {wr:.1%}")
    print(f"Best win rate: {best_wr:.1%}")

    if wr >= best_wr:
        meta = {
            "algorithm": "reinforce_raw_gpu_self_play",
            "action_space": "raw",
            "num_players": 2,
            "game": "imposter_zero_match",
            "game_version": "3.0-match-raw",
            "input_size": OBS_SIZE,
            "hidden_size": args.hidden_size,
            "num_layers": args.num_layers,
            "output_size": NUM_ACTIONS,
            "num_actions": NUM_ACTIONS,
            "episodes": episode,
            "win_rate_vs_random": round(wr, 4),
            "exported_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        export_weights(net, args.output, meta)


if __name__ == "__main__":
    main()
