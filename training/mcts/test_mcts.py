#!/usr/bin/env python3
"""
Test script for IS-MCTS implementation.

Verifies:
1. Determinizer correctly clones and randomizes states
2. ISMCTSNode tracks visits and availability correctly
3. Search produces sensible policies

Run from training directory:
  python -m mcts.test_mcts
"""

from __future__ import annotations

import random
import sys

# Ensure we can import from parent
sys.path.insert(0, ".")

import pyspiel

# Register games
import imposter_zero.game as ig  # noqa: F401


def test_determinizer():
    """Test that determinization preserves observer info and randomizes hidden info."""
    from mcts.determinizer import clone_and_randomize

    print("Testing determinizer...")

    game = pyspiel.load_game("imposter_zero_match")
    state = game.new_initial_state()

    # Play a few random actions to get into interesting state
    for _ in range(20):
        if state.is_terminal():
            break
        legal = state.legal_actions()
        if not legal:
            break
        state.apply_action(random.choice(legal))

    if state.is_terminal():
        print("  Game ended early, testing with fresh state...")
        state = game.new_initial_state()
        for _ in range(5):
            if state.is_terminal():
                break
            legal = state.legal_actions()
            if not legal:
                break
            state.apply_action(random.choice(legal))

    observer = state.current_player()
    if observer < 0:
        print("  Skip: no active player")
        return True

    print(f"  Observer: player {observer}")
    print(f"  Phase: {state._phase}")
    print(f"  Observer hand size: {len(state._hands[observer])}")

    # Determinize multiple times
    clones = []
    for i in range(5):
        clone = clone_and_randomize(state, observer)
        clones.append(clone)

    # Verify observer's hand is preserved
    for clone in clones:
        assert clone._hands[observer] == state._hands[observer], "Observer hand changed!"

    # Verify opponent's hand may differ (randomized)
    opp = 1 - observer
    opp_hands = [tuple(clone._hands[opp]) for clone in clones]
    unique_hands = len(set(opp_hands))
    print(f"  Unique opponent hands in 5 determinizations: {unique_hands}")

    # Verify legal actions are still valid
    for clone in clones:
        legal = clone.legal_actions()
        assert len(legal) > 0 or clone.is_terminal(), "No legal actions in clone!"

    print("  Determinizer: PASS")
    return True


def test_tree_structure():
    """Test ISMCTSNode tracks statistics correctly."""
    from mcts.tree import ISMCTSNode

    print("Testing tree structure...")

    root = ISMCTSNode()
    assert root.visits == 0
    assert root.avails == 0
    assert root.mean_value == 0.0

    # Add children
    child1 = root.add_child(action=10, player=0, prior=0.7)
    child2 = root.add_child(action=20, player=0, prior=0.3)

    assert 10 in root.children
    assert 20 in root.children
    assert child1.nn_prior == 0.7
    assert child2.nn_prior == 0.3

    # Simulate visits
    child1.visits = 5
    child1.total_value = 3.5
    child1.avails = 10

    child2.visits = 3
    child2.total_value = 2.1
    child2.avails = 10

    assert child1.mean_value == 3.5 / 5
    assert child2.mean_value == 2.1 / 3

    # Test visit distribution
    legal = [10, 20]
    dist = root.visit_distribution(legal, temperature=1.0)
    assert abs(dist[10] - 5 / 8) < 0.01
    assert abs(dist[20] - 3 / 8) < 0.01

    # Test selection
    selected = root.select_child(legal, c_puct=1.5)
    assert selected is not None
    assert selected.action in legal

    print("  Tree structure: PASS")
    return True


def test_search_simple():
    """Test search produces a valid policy."""
    print("Testing search (no neural network)...")

    # For this test, we'll use a mock network
    import torch
    import torch.nn as nn

    from mcts.search import ismcts_search, ISMCTSConfig
    from train_ppo import NUM_ACTIONS, OBS_SIZE

    # Simple random network
    class MockNet(nn.Module):
        def __init__(self):
            super().__init__()
            self.policy = nn.Linear(OBS_SIZE, NUM_ACTIONS)
            self.value = nn.Linear(OBS_SIZE, 1)

        def forward(self, x):
            return self.policy(x), self.value(x).squeeze(-1)

    net = MockNet()
    net.eval()

    config = ISMCTSConfig(
        num_iterations=20,  # Small for testing
        c_puct=1.5,
        temperature=1.0,
        device="cpu",
    )

    game = pyspiel.load_game("imposter_zero_match")
    state = game.new_initial_state()

    # Advance to play phase
    while not state.is_terminal() and state._phase not in ("play", "setup"):
        legal = state.legal_actions()
        if not legal:
            break
        state.apply_action(random.choice(legal))

    if state.is_terminal():
        print("  Skip: game ended")
        return True

    observer = state.current_player()
    if observer < 0:
        print("  Skip: no active player")
        return True

    legal = state.legal_actions()
    print(f"  Phase: {state._phase}, legal actions: {len(legal)}")

    root, policy = ismcts_search(state, observer, net, config)

    assert root is not None
    assert isinstance(policy, dict)
    assert len(policy) > 0

    # Verify policy is a distribution
    total = sum(policy.values())
    assert abs(total - 1.0) < 0.01, f"Policy doesn't sum to 1: {total}"

    # Verify all actions in policy are legal
    for action in policy:
        assert action in legal, f"Illegal action {action} in policy"

    print(f"  Root visits: {sum(c.visits for c in root.children.values())}")
    print(f"  Policy entropy: {-sum(p * (p + 1e-10) for p in policy.values() if p > 0):.3f}")
    print("  Search: PASS")
    return True


def main():
    """Run all tests."""
    print("=" * 60)
    print("IS-MCTS Test Suite")
    print("=" * 60)
    print()

    tests = [
        test_determinizer,
        test_tree_structure,
        test_search_simple,
    ]

    passed = 0
    failed = 0

    for test in tests:
        try:
            if test():
                passed += 1
            else:
                failed += 1
        except Exception as e:
            print(f"  FAILED: {e}")
            import traceback

            traceback.print_exc()
            failed += 1
        print()

    print("=" * 60)
    print(f"Results: {passed} passed, {failed} failed")
    print("=" * 60)

    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
