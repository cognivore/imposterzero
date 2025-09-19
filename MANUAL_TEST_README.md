# Manual Test Script: Human vs Bot

This script allows you to play a complete game of Imposter Kings from the CLI against a bot opponent.

## Quick Start

```bash
# Run the manual test script
pnpm play
```

## What It Does

The script will:

1. **Start a local game server** on port 3003
2. **Prompt you for your player name**
3. **Set up a game** with you as Player 1 and a bot as Player 2
4. **Launch the full CLI interface** where you can:
   - View your hand, court, army, and game state
   - Select from available actions when it's your turn
   - Watch the bot make its moves
   - Play through a complete game with scoring

## Features

- **Full CLI Interface**: Rich terminal display showing all game information
- **Interactive Prompts**: Choose your actions from available options
- **Bot Opponent**: The bot uses the same AI as the automated tests
- **Real-time Updates**: See the game state update as actions are taken
- **Complete Game Flow**: Plays through signature selection, mustering, regular play, and scoring
- **Game Logging**: Detailed logs are saved for debugging (timestamped files)

## Game Flow

1. **Setup Phase**: Choose your player name
2. **Signature Selection**: Pick your 3 signature cards
3. **Mustering Phase**: Build your initial army
4. **Regular Play**: Take turns playing cards and managing your army
5. **Scoring**: Game ends when victory conditions are met

## Controls

- Use arrow keys and Enter to navigate menus
- Follow the prompts for each action type
- Press Ctrl+C to quit gracefully at any time

## Logs

The script creates timestamped log files:
- `human-vs-bot-TIMESTAMP.log` - General test logging
- `human-vs-bot-game-TIMESTAMP.log` - Detailed game flow logging
- `bot-bot.log` - Bot decision logging

## Technical Details

- **Server Port**: 3003 (different from main game server)
- **Bot AI**: Uses `SimpleBot` class with basic strategy
- **Game Rules**: Full "Fragments of Nersetti" rules (Stage 4)
- **Player Assignment**: Human is always Player 1, Bot is Player 2

## Troubleshooting

If the script fails to start:
1. Make sure no other process is using port 3003
2. Check that all dependencies are installed (`pnpm install`)
3. Look at the log files for detailed error information

The script includes graceful shutdown handling and will clean up the server automatically.

