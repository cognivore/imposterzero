import { randomBytes } from "node:crypto";
import type { WebSocket } from "ws";

export interface RegistryEntry {
  readonly playerId: string;
  readonly token: string;
  name: string | null;
  ws: WebSocket | null;
  connectedAt: number;
  disconnectedAt: number | null;
}

export interface RegistryOptions {
  readonly reconnectWindowMs?: number;
}

const generateToken = (): string => randomBytes(16).toString("hex");

export class ConnectionRegistry {
  private readonly entries = new Map<string, RegistryEntry>();
  private readonly byPlayerId = new Map<string, string>();
  private readonly reconnectWindowMs: number;
  private playerCounter = 0;

  constructor(options: RegistryOptions = {}) {
    this.reconnectWindowMs = options.reconnectWindowMs ?? 60_000;
  }

  register(ws: WebSocket, now: number): RegistryEntry {
    const token = generateToken();
    const playerId = `player-${this.playerCounter++}`;
    const entry: RegistryEntry = {
      playerId,
      token,
      name: null,
      ws,
      connectedAt: now,
      disconnectedAt: null,
    };
    this.entries.set(token, entry);
    this.byPlayerId.set(playerId, token);
    return entry;
  }

  reconnect(ws: WebSocket, token: string, now: number): RegistryEntry | null {
    this.pruneExpired(now);
    const entry = this.entries.get(token);
    if (!entry) return null;
    entry.ws = ws;
    entry.connectedAt = now;
    entry.disconnectedAt = null;
    return entry;
  }

  disconnect(token: string, now: number): void {
    const entry = this.entries.get(token);
    if (!entry) return;
    entry.ws = null;
    entry.disconnectedAt = now;
  }

  disconnectByPlayerId(playerId: string, now: number): void {
    const token = this.byPlayerId.get(playerId);
    if (token) this.disconnect(token, now);
  }

  isConnected(token: string): boolean {
    const entry = this.entries.get(token);
    if (!entry || !entry.ws) return false;
    return entry.ws.readyState === 1; // WebSocket.OPEN
  }

  findByPlayerId(playerId: string): RegistryEntry | undefined {
    const token = this.byPlayerId.get(playerId);
    return token ? this.entries.get(token) : undefined;
  }

  findByToken(token: string): RegistryEntry | undefined {
    return this.entries.get(token);
  }

  allConnected(): RegistryEntry[] {
    return [...this.entries.values()].filter(
      (e) => e.ws !== null && e.ws.readyState === 1,
    );
  }

  isNameTaken(name: string): boolean {
    for (const entry of this.entries.values()) {
      if (entry.name !== null && entry.name.toLowerCase() === name.toLowerCase()) return true;
    }
    return false;
  }

  setName(token: string, name: string): boolean {
    const entry = this.entries.get(token);
    if (!entry) return false;
    if (entry.name !== null && entry.name.toLowerCase() === name.toLowerCase()) return true;
    if (this.isNameTaken(name)) return false;
    entry.name = name;
    return true;
  }

  remove(token: string): void {
    const entry = this.entries.get(token);
    if (!entry) return;
    this.entries.delete(token);
    this.byPlayerId.delete(entry.playerId);
  }

  private pruneExpired(now: number): void {
    for (const [token, entry] of this.entries) {
      if (
        entry.disconnectedAt !== null &&
        now - entry.disconnectedAt > this.reconnectWindowMs
      ) {
        this.entries.delete(token);
        this.byPlayerId.delete(entry.playerId);
      }
    }
  }
}
