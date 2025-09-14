import fetch from 'node-fetch';
import { Logger } from '../utils/logger.js';
import type {
  GameEvent,
  GameAction,
  GameStatusResponse,
  CreateGameRequest,
  CreateGameResponse,
  JoinGameRequest,
  JoinGameResponse
} from '../types/game.js';

export class ImposterKingsAPIClient {
  private baseUrl = 'https://play.theimposterkings.com';
  private logger: Logger;

  constructor(baseUrl?: string) {
    this.logger = new Logger('api-client.log');

    if (baseUrl) {
      this.baseUrl = baseUrl;
    }
  }

  async createGame(request: CreateGameRequest): Promise<CreateGameResponse> {
    const response = await fetch(`${this.baseUrl}/new_game`, {
      method: 'POST',
      redirect: 'manual', // Don't follow redirects automatically
    });

    if (response.status !== 303) {
      throw new Error(`Failed to create game: ${response.status} ${response.statusText}`);
    }

    const location = response.headers.get('location');
    if (!location) {
      throw new Error('No location header in create game response');
    }

    // Parse location like "/join/2255/647265405525"
    const match = location.match(/\/join\/(\d+)\/(\w+)/);
    if (!match) {
      throw new Error(`Invalid location format: ${location}`);
    }

    const gameId = parseInt(match[1]);
    const joinToken = match[2];

    // The player token for the creator is the same as the join token initially
    return {
      game_id: gameId,
      player_token: joinToken,
    };
  }

  async joinGame(request: JoinGameRequest): Promise<JoinGameResponse> {
    // The API expects an array format: [gameId, joinToken, playerName]
    const requestArray = [request.game_id, request.join_token, request.player_name];

    const response = await fetch(`${this.baseUrl}/rpc/join_game`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestArray),
    });

    if (!response.ok) {
      throw new Error(`Failed to join game: ${response.status} ${response.statusText}`);
    }

    // The response should be the player token
    const playerToken = await response.json() as string;
    return { player_token: playerToken };
  }

  async addBot(gameId: number, playerToken: string): Promise<void> {
    // The API expects an array format: [gameId, playerToken]
    const response = await fetch(`${this.baseUrl}/rpc/add_bot`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([gameId, playerToken]),
    });

    if (!response.ok) {
      throw new Error(`Failed to add bot: ${response.status} ${response.statusText}`);
    }
  }

  async getGameStatus(gameId: number, playerToken: string, versionNumber?: number): Promise<GameStatusResponse | null> {
    // The API expects an object format for this endpoint
    const response = await fetch(`${this.baseUrl}/rpc/get_game_status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        game_id: gameId,
        token: playerToken,
        version_number: versionNumber || null,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to get game status: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    return result === null ? null : result as GameStatusResponse;
  }

  async getEvents(gameId: number, playerToken: string, startIndex: number = 0): Promise<GameEvent[]> {
    const response = await fetch(`${this.baseUrl}/events/${gameId}/${playerToken}?start=${startIndex}`, {
      method: 'GET',
      headers: {
        'Accept': '*/*',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get events: ${response.status} ${response.statusText}`);
    }

    const text = await response.text();
    return JSON.parse(text) as GameEvent[];
  }

  async sendAction(gameId: number, playerToken: string, eventCount: number, action: GameAction): Promise<void> {
    const url = `${this.baseUrl}/action/${gameId}/${playerToken}`;
    const payload = [eventCount, action];
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    // Read raw text always to capture error bodies
    const responseText = await response.text();

    if (!response.ok) {
      // Try to parse JSON error details from server
      let details: any = null;
      try {
        details = JSON.parse(responseText);
      } catch (_e) {
        // leave as text
      }

      const errorSummary = {
        url,
        status: `${response.status} ${response.statusText}`,
        request_body: payload,
        response_body: details ?? responseText,
      };

      this.logger.error('Failed to send action', new Error(JSON.stringify(errorSummary)));
      throw new Error(`Failed to send action: ${response.status} ${response.statusText}`);
    }

    // Log the success response for debugging
    this.logger.debug('Action sent successfully', {
      url,
      request_body: payload,
      response_body: (() => { try { return JSON.parse(responseText); } catch { return responseText; } })(),
    });
  }

  async getPublicObserverLink(gameId: number): Promise<string> {
    const response = await fetch(`${this.baseUrl}/rpc/get_public_observer_link`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(gameId),
    });

    if (!response.ok) {
      throw new Error(`Failed to get observer link: ${response.status} ${response.statusText}`);
    }

    return await response.text();
  }
}
