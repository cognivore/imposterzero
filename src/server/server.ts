import { createServer, IncomingMessage, ServerResponse } from 'http';
import { URL } from 'url';
import { LocalGameService } from '../game/localService.js';
import { Logger } from '../utils/logger.js';
import type { GameAction } from '../types/game.js';

export class LocalGameServer {
  private server;
  private gameService: LocalGameService;
  private logger: Logger;
  private port: number;

  constructor(port: number = 3000) {
    this.port = port;
    this.gameService = new LocalGameService();
    this.logger = new Logger('server.log');

    this.server = createServer((req, res) => {
      this.handleRequest(req, res);
    });
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
      this.logger.log(`${method} ${url.pathname}`);

      if (method === 'POST' && url.pathname === '/new_game') {
        await this.handleCreateGame(req, res);
      } else if (method === 'POST' && url.pathname === '/rpc/join_game') {
        await this.handleJoinGame(req, res);
      } else if (method === 'POST' && url.pathname === '/rpc/add_bot') {
        await this.handleAddBot(req, res);
      } else if (method === 'POST' && url.pathname === '/rpc/get_game_status') {
        await this.handleGetGameStatus(req, res);
      } else if (method === 'GET' && url.pathname.startsWith('/events/')) {
        await this.handleGetEvents(req, res, url);
      } else if (method === 'POST' && url.pathname.startsWith('/action/')) {
        await this.handleSendAction(req, res, url);
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    } catch (error) {
      this.logger.error('Request error', error as Error);
      res.writeHead(500);
      res.end('Internal Server Error');
    }
  }

  private async handleCreateGame(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const { gameId, joinToken } = this.gameService.createGame();

    // Return 303 redirect like the real server
    res.writeHead(303, {
      'Location': `/join/${gameId}/${joinToken}`,
      'Cache-Control': 'no-store',
    });
    res.end();
  }

  private async handleJoinGame(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await this.readRequestBody(req);
    const [gameId, joinToken, playerName] = JSON.parse(body);

    const playerToken = this.gameService.joinGame(gameId, joinToken, playerName);

    if (!playerToken) {
      res.writeHead(400);
      res.end('Failed to join game');
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(playerToken));
  }

  private async handleAddBot(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await this.readRequestBody(req);
    const [gameId, playerToken] = JSON.parse(body);

    const success = this.gameService.addBot(gameId, playerToken);

    if (!success) {
      res.writeHead(400);
      res.end('Failed to add bot');
      return;
    }

    res.writeHead(200);
    res.end('Bot added');
  }

  private async handleGetGameStatus(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await this.readRequestBody(req);
    const { game_id, token, version_number } = JSON.parse(body);

    const status = this.gameService.getGameStatus(game_id, token);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(status));
  }

  private async handleGetEvents(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const pathParts = url.pathname.split('/');
    // /events/{gameId}/{playerToken}
    const gameId = parseInt(pathParts[2]);
    const playerToken = pathParts[3];
    const startIndex = parseInt(url.searchParams.get('start') || '0');

    const events = this.gameService.getEvents(gameId, playerToken, startIndex);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(events));
  }

  private async handleSendAction(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const pathParts = url.pathname.split('/');
    // /action/{gameId}/{playerToken}
    const gameId = parseInt(pathParts[2]);
    const playerToken = pathParts[3];

    const body = await this.readRequestBody(req);
    const [eventCount, action] = JSON.parse(body);

    const success = this.gameService.sendAction(gameId, playerToken, eventCount, action);

    if (!success) {
      res.writeHead(400);
      res.end('Action failed');
      return;
    }

    res.writeHead(200);
    res.end('Action processed');
  }

  private readRequestBody(req: IncomingMessage): Promise<string> {
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

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(this.port, () => {
        this.logger.log(`Local game server started on http://localhost:${this.port}`);
        console.log(`🎮 Local Imposter Kings server running on http://localhost:${this.port}`);
        console.log(`🔗 Use this as the base URL in your client`);
        resolve();
      });
    });
  }

  stop(): void {
    this.server.close();
    this.logger.close();
  }
}
