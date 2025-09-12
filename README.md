# Imposter Kings CLI Client

A command-line interface client for playing [The Imposter Kings](https://theimposterkings.com/) card game.

## Features

- 🎮 **Full Game Support**: Play complete games of The Imposter Kings from your terminal
- 🤖 **Bot Support**: Add bots to fill empty game slots
- 🎨 **Rich CLI Interface**: Colorful, intuitive command-line interface with clear game state display
- ⚡ **Real-time Updates**: Live game updates and event streaming
- 🔄 **Action Validation**: Smart action prompts based on current game state
- 📊 **Game State Tracking**: Complete visibility into hand, court, army, and opponent information

## Installation

### Prerequisites

- Node.js 18+
- pnpm (recommended) or npm

### Install Dependencies

```bash
pnpm install
```

### Build

```bash
pnpm run build
```

### Development

```bash
pnpm run dev
```

## Usage

### Start the CLI

#### Option 1: Play Online
```bash
pnpm start
# or after building
node dist/index.js
```

#### Option 2: Local Client-Server (Fragments of Nersetti)

**Start the server:**
```bash
pnpm run dev:server
# or after building
pnpm run start:server
```

**Connect clients (in separate terminals):**
```bash
pnpm start
# Choose "Connect to localhost server"
```

### Game Flow

1. **Main Menu**: Choose between online, localhost, or quit
2. **Online Mode**:
   - Create or join games on the official server
   - Standard game rules
3. **Localhost Mode**:
   - Connect to local server running Fragments of Nersetti (Stage 4 rules)
   - Full army management, signature cards, and king facets
   - Separate client instances for each player
4. **Game Play**:
   - View your hand, court, army, and game state
   - Select from available actions when it's your turn
   - Watch real-time updates as the game progresses

### Game Display

The CLI shows:
- **Score**: Current points for both players
- **Your Hand**: Cards in your hand with modifiers
- **Antechamber**: Cards in your antechamber
- **Court**: All court cards (including the throne)
- **Your Army**: Your army cards and their states
- **Opponent Info**: Opponent's hand size and known cards
- **Recent Messages**: Game events and actions
- **Available Actions**: What you can do on your turn

### Action Types

The client handles all game actions including:
- **Signature Card Selection**: Choose your starting signature cards
- **Card Play**: Play cards from hand or antechamber
- **Army Management**: Recruit, rally, exhaust, and recall army cards
- **King Actions**: Flip king, change facets, take successor/squire
- **Special Actions**: Reactions, swaps, disgrace, and more

## API Integration

The client communicates with the official Imposter Kings server at `https://play.theimposterkings.com` using:

- **REST API**: For game management (create, join, status)
- **Event Streaming**: For real-time game updates
- **Action Submission**: For sending player actions

## Architecture

```
src/
├── api/           # API client for server communication
├── game/          # Game logic and client orchestration
├── types/         # TypeScript type definitions
├── ui/            # CLI display and user prompts
└── index.ts       # Main entry point
```

### Key Components

- **GameClient**: Main orchestrator handling game flow
- **GameState**: Manages current game state and history
- **ImposterKingsAPIClient**: Handles all server communication
- **GameDisplay**: Rich terminal UI for game visualization
- **GamePrompts**: Interactive prompts for user input

## Development

### Type Safety

The project uses comprehensive TypeScript types extracted from the original game code, ensuring type safety for:
- Game board state
- Card definitions and modifiers
- Action types and validation
- API requests and responses
- Game events and messages

### Code Style

- Modern ES modules
- Strict TypeScript configuration
- Functional programming patterns
- Error handling with graceful fallbacks

## Troubleshooting

### Connection Issues
- Check your internet connection
- Verify the game server is accessible
- Try creating a new game if joining fails

### Game State Issues
- The client automatically retries on connection errors
- Game state is rebuilt from event history
- Use Ctrl+C to exit gracefully

### Action Errors
- Ensure you select valid actions from the provided list
- Some actions may become invalid between display and selection
- The server will reject invalid actions safely

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes with proper TypeScript types
4. Test with real games
5. Submit a pull request

## License

MIT License - see LICENSE file for details

## Acknowledgments

- [The Imposter Kings](https://theimposterkings.com/) - Original game by [Game Designer]
- Built with TypeScript, Node.js, and Inquirer.js
- Inspired by the web client's elegant game mechanics
