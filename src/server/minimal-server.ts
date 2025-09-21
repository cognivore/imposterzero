import { createServer, IncomingMessage, ServerResponse } from 'http';
import { URL } from 'url';
import { Logger } from '../utils/logger.js';
import type { GameAction, GameEvent, GameBoard, GameStatus, HandCard, CourtCard, CardName } from '../types/game.js';

interface Game {
  id: number;
  players: Array<{ name: string; token: string } | null>;
  events: GameEvent[];
  currentPlayer: number;
  state: 'waiting' | 'signature_selection' | 'playing' | 'game_over';
}

export class MinimalGameServer {
  private server;
  private logger: Logger;
  private port: number;
  private games: Map<number, Game> = new Map();
  private nextGameId = 1;
  private nextToken = 1000;

  constructor(port: number = 0) { // Use 0 for random available port
    this.port = port;
    this.logger = new Logger('minimal-server.log');

    this.server = createServer((req, res) => {
      this.handleRequest(req, res);
    });
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.listen(this.port, () => {
        const address = this.server.address();
        if (typeof address === 'object' && address !== null) {
          this.port = address.port;
          this.logger.log(`Minimal server started on port ${this.port}`);
          resolve();
        } else {
          reject(new Error('Failed to get server address'));
        }
      });

      this.server.on('error', (error) => {
        this.logger.error('Server error', error as Error);
        reject(error);
      });
    });
  }

  getPort(): number {
    return this.port;
  }

  stop(): void {
    this.server.close();
    this.logger.close();
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url || '', `http://localhost:${this.port}`);
    const method = req.method || 'GET';

    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    try {
      this.logger.log(`${method} ${url.pathname} (port: ${this.port})`);

      if (method === 'POST' && url.pathname === '/new_game') {
        await this.handleCreateGame(req, res);
      } else if (method === 'POST' && url.pathname === '/rpc/join_game') {
        await this.handleJoinGame(req, res);
      } else if (method === 'GET' && url.pathname.startsWith('/events/')) {
        await this.handleGetEvents(req, res, url);
      } else if (method === 'POST' && url.pathname.startsWith('/action/')) {
        await this.handleSendAction(req, res, url);
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
      }
    } catch (error) {
      this.logger.error('Request error', error as Error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  }

  private async handleCreateGame(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await this.readBody(req);

    // Handle empty body or missing JSON
    let player_name = 'Player';
    if (body.trim()) {
      try {
        const requestData = JSON.parse(body);
        player_name = requestData.player_name || 'Player';
      } catch (error) {
        // If JSON parsing fails, use default name
        this.logger.log(`Failed to parse JSON body: ${body}`);
        player_name = 'Player';
      }
    }

    const gameId = this.nextGameId++;
    const playerToken = `token_${this.nextToken++}`;

    const game: Game = {
      id: gameId,
      players: [{ name: player_name, token: playerToken }, null],
      events: [],
      currentPlayer: 0,
      state: 'waiting'
    };

    this.games.set(gameId, game);

    // Add initial game state event
    this.addGameStateEvent(game);

    res.writeHead(303, {
      'Content-Type': 'application/json',
      'Location': `/join/${gameId}/${playerToken}`
    });
    res.end(JSON.stringify({
      game_id: gameId,
      player_token: playerToken
    }));
  }

  private async handleJoinGame(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await this.readBody(req);

    // Handle empty body or missing JSON - try to extract from URL first
    const url = new URL(req.url || '', `http://localhost:${this.port}`);
    let game_id = parseInt(url.searchParams.get('game_id') || '0');
    let join_token = url.searchParams.get('join_token') || '';
    let player_name = url.searchParams.get('player_name') || 'Player2';

    if (body.trim()) {
      try {
        const requestData = JSON.parse(body);
        // Handle both object format and array format
        if (Array.isArray(requestData)) {
          // Array format: [gameId, joinToken, playerName]
          game_id = requestData[0] || game_id;
          join_token = requestData[1] || join_token;
          player_name = requestData[2] || player_name;
        } else {
          // Object format: {game_id, join_token, player_name}
          game_id = requestData.game_id || game_id;
          join_token = requestData.join_token || join_token;
          player_name = requestData.player_name || player_name;
        }
      } catch (error) {
        // If JSON parsing fails, use URL parameters
        this.logger.log(`Failed to parse JSON body: ${body}`);
      }
    }

    this.logger.log(`Joining game - game_id: ${game_id}, join_token: ${join_token}, player_name: ${player_name}`);
    this.logger.log(`Available games: ${Array.from(this.games.keys()).join(', ')}`);

    const game = this.games.get(game_id);
    if (!game) {
      this.logger.log(`Game not found: ${game_id}`);
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Game not found' }));
      return;
    }

    const playerToken = `token_${this.nextToken++}`;

    // Add second player
    if (!game.players[1]) {
      game.players[1] = { name: player_name, token: playerToken };
      game.state = 'signature_selection';

      // Add signature selection state
      this.addSignatureSelectionEvent(game);
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      player_token: playerToken
    }));
  }

  private async handleGetEvents(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const pathParts = url.pathname.split('/');
    const gameId = parseInt(pathParts[2]);
    const playerToken = pathParts[3];
    const startIndex = parseInt(url.searchParams.get('start') || '0');

    const game = this.games.get(gameId);
    if (!game) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Game not found' }));
      return;
    }

    const events = game.events.slice(startIndex);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(events));
  }

  private async handleSendAction(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const body = await this.readBody(req);
    const [eventCount, action] = JSON.parse(body);

    const pathParts = url.pathname.split('/');
    const gameId = parseInt(pathParts[2]);
    const playerToken = pathParts[3];

    const game = this.games.get(gameId);
    if (!game) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Game not found' }));
      return;
    }

    this.logger.log(`Action received: ${JSON.stringify(action)}`);

    // Process the action and update game state
    this.processAction(game, action, playerToken);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{}');
  }

  private processAction(game: Game, action: GameAction, playerToken: string): void {
    // Find which player sent this action
    const playerIndex = game.players.findIndex(p => p?.token === playerToken);
    if (playerIndex === -1) return;

    this.logger.log(`Processing action from player ${playerIndex}: ${action.type}`);

    // Simple action processing for demo purposes
    switch (action.type) {
      case 'ChooseSignatureCards':
        // Move to playing state after signature cards
        game.state = 'playing';
        this.addPlayingStateEvent(game, playerIndex);
        break;

      case 'PlayCard':
        // Simulate card play
        this.addCardPlayEvent(game, playerIndex, action.card);
        // Switch to other player
        game.currentPlayer = 1 - game.currentPlayer;
        this.addPlayingStateEvent(game, game.currentPlayer);
        break;

      case 'FlipKing':
        // End the game
        game.state = 'game_over';
        this.addGameOverEvent(game);
        break;

      default:
        // For other actions, just switch player
        game.currentPlayer = 1 - game.currentPlayer;
        this.addPlayingStateEvent(game, game.currentPlayer);
        break;
    }
  }

  private addGameStateEvent(game: Game): void {
    const board = this.createMockBoard(game);
    const status: GameStatus = { type: 'Waiting', reason: 'Other' };
    const actions: GameAction[] = [];

    game.events.push({
      type: 'NewState',
      board,
      status,
      actions,
      reset_ui: false
    });
  }

  private addSignatureSelectionEvent(game: Game): void {
    const board = this.createMockBoard(game);
    const status: GameStatus = { type: 'SelectSignatureCards' };
    const actions: GameAction[] = [
      {
        type: 'ChooseSignatureCards',
        cards: [[0, 'Aegis'], [1, 'Ancestor'], [2, 'Exile']],
        for_player: 0
      }
    ];

    game.events.push({
      type: 'NewState',
      board,
      status,
      actions,
      reset_ui: true
    });
  }

  private addPlayingStateEvent(game: Game, currentPlayer: number): void {
    const board = this.createMockBoard(game);
    const status: GameStatus = { type: 'RegularMove' };

    // Create some sample actions
    const actions: GameAction[] = [
      {
        type: 'PlayCard',
        card_idx: { type: 'Hand', idx: 0 },
        card: 'Fool',
        ability: null,
        for_player: currentPlayer as 0 | 1
      },
      {
        type: 'FlipKing',
        for_player: currentPlayer as 0 | 1
      }
    ];

    game.events.push({
      type: 'NewState',
      board,
      status,
      actions,
      reset_ui: false
    });
  }

  private addCardPlayEvent(game: Game, playerIndex: number, card: CardName): void {
    game.events.push({
      type: 'Message',
      message: {
        type: 'CardPlayed',
        player_idx: playerIndex,
        card,
        ability: null
      }
    });
  }

  private addGameOverEvent(game: Game): void {
    game.events.push({
      type: 'Message',
      message: {
        type: 'GameOver',
        points: [5, 3]
      }
    });
  }

  private createMockBoard(game: Game): GameBoard {
    const mockHandCard = (card: CardName): HandCard => ({
      card: { card, flavor: 0 },
      modifiers: {}
    });

    const mockCourtCard = (card: CardName, disgraced: boolean = false): CourtCard => ({
      card: { card, flavor: 0 },
      disgraced,
      modifiers: {},
      sentry_swap: false,
      conspiracist_effect: false
    });

    return {
      fake: false,
      reveal_everything: true,
      player_idx: game.currentPlayer,
      points: [2, 1],
      accused: [mockHandCard('Assassin')],
      randomly_discarded: [],
      dungeons: [[], []],
      court: [
        mockCourtCard('Soldier'),
        mockCourtCard('Judge'),
        mockCourtCard('Queen'), // throne
      ],
      true_king_idx: 0,
      first_player_idx: 0,
      armies: [[], []],
      replaced_by_army: [[], []],
      hand: [
        mockHandCard('Fool'),
        mockHandCard('Princess'),
        mockHandCard('Mystic'),
      ],
      antechamber: [],
      king_facets: ['Regular', 'Regular'],
      kings_flipped: [false, false],
      antechambers: [[], []],
      hands: [
        [
          mockHandCard('Fool'),
          mockHandCard('Princess'),
          mockHandCard('Mystic'),
        ],
        [
          mockHandCard('Warden'),
          mockHandCard('Sentry'),
          mockHandCard('Immortal'),
        ]
      ],
      successors: [null, null],
      successors_revealed: [false, false],
      squires: [null, null],
      squires_revealed: [false, false],
      khed: null,
      thrown_assassins: [null, null],
      unseen_cards: [],
      unseen_army_card_counts: [0, 0],
      change_king_facet: null,
      choose_signature_cards: null,
      new_round: false,
      choose_whos_first: false,
      flip_king: false,
      fake_reaction: null,
      move_nothing_to_ante: false,
      sentry_swap: false,
      disgrace_court_cards: null,
      free_mulligan: false,
      mulligan: false,
      end_muster: false,
      skip_rally: false,
      take_dungeon: null,
      card_in_hand_guess: null,
      take_successor: false,
      take_squire: false,
      choose_to_take_one_or_two: false,
      condemn_opponent_hand_card: false,
    };
  }

  private async readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', chunk => {
        body += chunk.toString();
      });
      req.on('end', () => {
        resolve(body);
      });
      req.on('error', reject);
    });
  }
}
