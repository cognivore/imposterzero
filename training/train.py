"""
Training entry point for Imposter Zero.
Uses OpenSpiel algorithms to train agents against each other.
"""

import pyspiel

import imposter_zero.game  # noqa: F401  — registers the game


def main():
    game = pyspiel.load_game("imposter_zero")
    state = game.new_initial_state()

    print(f"Game:    {game}")
    print(f"Players: {game.num_players()}")
    print(f"Actions: {game.num_distinct_actions()}")

    step = 0
    while not state.is_terminal():
        player = state.current_player()
        actions = state.legal_actions()
        action = actions[0]
        print(f"  Step {step}: player={player}, legal={len(actions)}, "
              f"action={state.action_to_string(player, action)}")
        state.apply_action(action)
        step += 1

    print(f"Terminal after {step} steps")
    print(f"Returns: {state.returns()}")


if __name__ == "__main__":
    main()
