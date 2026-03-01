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
    print(f"State:   {state}")
    print(f"Player:  {state.current_player()}")
    print(f"Actions: {state.legal_actions()}")

    # TODO: add training loops (tabular, DQN, PPO, etc.)
    # See collapsization/training/train.py for reference.


if __name__ == "__main__":
    main()
