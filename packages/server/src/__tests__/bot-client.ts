import WebSocket from "ws";
import type { IKAction } from "@imposter-zero/engine";
import type { OutboundMessage } from "../room.js";

type AnyServerMessage = OutboundMessage | { readonly type: string; [k: string]: unknown };

export class BotClient {
  private ws: WebSocket | null = null;
  private messageQueue: AnyServerMessage[] = [];
  private waiters: Array<(msg: AnyServerMessage) => void> = [];
  readonly received: AnyServerMessage[] = [];
  readonly id: string;
  token: string | null = null;
  playerId: string | null = null;
  name: string | null = null;
  roomId: string | null = null;

  constructor(
    private readonly url: string,
    id: string,
  ) {
    this.id = id;
  }

  private attachListeners(ws: WebSocket): void {
    ws.on("message", (raw: Buffer | string) => {
      const msg: AnyServerMessage = JSON.parse(
        typeof raw === "string" ? raw : raw.toString("utf-8"),
      );
      this.received.push(msg);
      if (msg.type === "welcome") {
        const w = msg as { type: "welcome"; token: string; playerId: string };
        this.token = w.token;
        this.playerId = w.playerId;
      }
      if (msg.type === "name_accepted") {
        this.name = (msg as { name: string }).name;
      }
      if (msg.type === "room_created" || msg.type === "room_joined") {
        this.roomId = (msg as { roomId: string }).roomId;
      }
      const waiter = this.waiters.shift();
      if (waiter) {
        waiter(msg);
      } else {
        this.messageQueue.push(msg);
      }
    });
  }

  connect(token?: string | null): Promise<void> {
    return new Promise((resolve, reject) => {
      this.messageQueue = [];
      this.waiters = [];
      this.ws = new WebSocket(this.url);
      this.ws.on("open", () => {
        this.attachListeners(this.ws!);
        const authMsg: Record<string, unknown> = { type: "auth" };
        if (token) authMsg.token = token;
        this.ws!.send(JSON.stringify(authMsg));
        this.drainUntil((m) => m.type === "welcome").then(() => resolve(), reject);
      });
      this.ws.on("error", reject);
    });
  }

  simulateDisconnect(): void {
    this.ws?.close();
    this.ws = null;
    this.messageQueue = [];
    this.waiters = [];
  }

  get isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  private nextMessage(timeoutMs: number = 5000): Promise<AnyServerMessage> {
    const queued = this.messageQueue.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`BotClient ${this.id}: timed out waiting for message`)),
        timeoutMs,
      );
      this.waiters.push((msg) => {
        clearTimeout(timer);
        resolve(msg);
      });
    });
  }

  private send(msg: Record<string, unknown>): void {
    this.ws!.send(JSON.stringify(msg));
  }

  async createRoom(maxPlayers: number = 4, targetScore: number = 7): Promise<AnyServerMessage> {
    this.send({ type: "create_room", maxPlayers, targetScore });
    return this.drainUntil((m) => m.type === "room_created" || m.type === "error");
  }

  async joinRoom(roomId: string): Promise<AnyServerMessage> {
    this.send({ type: "join_room", roomId });
    return this.drainUntil((m) => m.type === "room_joined" || m.type === "error");
  }

  async setName(name: string): Promise<AnyServerMessage> {
    this.send({ type: "set_name", name });
    return this.drainUntil((m) => m.type === "name_accepted" || m.type === "error");
  }

  async join(): Promise<AnyServerMessage> {
    this.send({ type: "join" });
    return this.nextMessage();
  }

  async ready(): Promise<AnyServerMessage> {
    this.send({ type: "ready", ready: true });
    return this.nextMessage();
  }

  async sendAction(action: IKAction): Promise<AnyServerMessage> {
    this.send({ type: "action", action });
    return this.nextMessage();
  }

  fireAction(action: IKAction): void {
    this.send({ type: "action", action });
  }

  fireDraftSelect(cards: readonly string[]): void {
    this.send({ type: "draft_select", cards });
  }

  fireJoin(): void {
    this.send({ type: "join" });
  }

  fireReady(): void {
    this.send({ type: "ready", ready: true });
  }

  async waitForMessage(timeoutMs: number = 5000): Promise<AnyServerMessage> {
    return this.nextMessage(timeoutMs);
  }

  async drainMessages(count: number, timeoutMs: number = 5000): Promise<AnyServerMessage[]> {
    const msgs: AnyServerMessage[] = [];
    for (let i = 0; i < count; i++) {
      msgs.push(await this.nextMessage(timeoutMs));
    }
    return msgs;
  }

  async drainUntil(predicate: (msg: AnyServerMessage) => boolean, timeoutMs: number = 5000): Promise<AnyServerMessage> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const remaining = Math.max(1, deadline - Date.now());
      const msg = await this.nextMessage(remaining);
      if (predicate(msg)) return msg;
    }
    throw new Error(`BotClient ${this.id}: drainUntil timed out`);
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
  }
}

export interface ChaosPolicy {
  readonly disconnectProbability: number;
  readonly reconnectDelayMs: [number, number];
  readonly actionDelayMs: [number, number];
  readonly dropMessageProbability: number;
}

export const defaultChaosPolicy: ChaosPolicy = {
  disconnectProbability: 0,
  reconnectDelayMs: [50, 200],
  actionDelayMs: [0, 0],
  dropMessageProbability: 0,
};

export const createBots = async (
  url: string,
  count: number,
): Promise<BotClient[]> => {
  const bots: BotClient[] = [];
  for (let i = 0; i < count; i++) {
    const bot = new BotClient(url, `bot-${i}`);
    await bot.connect();
    await bot.setName(`Bot${i}`);
    bots.push(bot);
  }
  return bots;
};

/**
 * Create bots (with names set), have bot[0] create a room, and all others join.
 * Drains room_created/room_settings/room_joined/lobby_state messages.
 * After this, all bots are in the room lobby as named players.
 */
export const createBotsInRoom = async (
  url: string,
  count: number,
  maxPlayers: number = 4,
  targetScore: number = 7,
): Promise<BotClient[]> => {
  const bots = await createBots(url, count);

  // Bot[0] creates the room (auto-joins as lobby player)
  const created = await bots[0]!.createRoom(maxPlayers, targetScore);
  if (created.type !== "room_created") {
    throw new Error(`Expected room_created, got ${created.type}`);
  }
  const roomId = bots[0]!.roomId!;
  // Drain room_settings + lobby_state that follow room_created
  await bots[0]!.drainUntil((m) => m.type === "lobby_state");

  // Other bots join the same room sequentially.
  for (let i = 1; i < count; i++) {
    const joined = await bots[i]!.joinRoom(roomId);
    if (joined.type !== "room_joined") {
      throw new Error(`Bot ${i} expected room_joined, got ${joined.type}`);
    }
    // Drain room_settings + lobby_state for the joiner
    await bots[i]!.drainUntil((m) => m.type === "lobby_state");
    // Drain lobby_state broadcast to each already-joined member
    for (let j = 0; j < i; j++) {
      await bots[j]!.drainUntil((m) => m.type === "lobby_state");
    }
  }

  return bots;
};

/**
 * Ready all bots, complete the signature draft, and drain messages up through
 * `game_start`. After this call the next message each bot receives will be the
 * initial `state`.
 */
type DraftView = { tag: string; selectionsNeeded?: number; pool?: string[]; faceUp?: string[]; amChooser?: boolean; amCurrentPicker?: boolean; submitted?: boolean };

const extractDraftPhase = (m: AnyServerMessage): DraftView | null => {
  if (m.type !== "draft_state") return null;
  return (m as Record<string, unknown>).draftPhase as DraftView;
};

const respondToDraft = (bot: BotClient, dp: DraftView, picks: readonly string[]): void => {
  if (dp.tag === "selection" && dp.selectionsNeeded && !dp.submitted) {
    const pool = dp.pool ?? picks;
    bot.fireDraftSelect(pool.slice(0, dp.selectionsNeeded));
  } else if (dp.tag === "draft_order" && dp.amChooser) {
    bot.send({ type: "draft_order", goFirst: true });
  } else if (dp.tag === "drafting" && dp.amCurrentPicker && dp.faceUp && dp.faceUp.length > 0) {
    bot.send({ type: "draft_pick", card: dp.faceUp[0]! });
  }
};

export const readyAllAndDraft = async (
  bots: BotClient[],
  draftPicks: readonly string[] = ["Aegis", "Exile", "Ancestor"],
): Promise<void> => {
  for (const bot of bots) bot.fireReady();

  const draftLoop = async (bot: BotClient): Promise<void> => {
    for (let step = 0; step < 30; step++) {
      if (bot.received.some((m) => m.type === "game_start")) return;
      const msg = await bot.drainUntil((m) => m.type === "game_start" || m.type === "draft_state");
      if (msg.type === "game_start") return;
      const dp = extractDraftPhase(msg);
      if (dp) respondToDraft(bot, dp, draftPicks);
    }
  };

  await Promise.all(bots.map(draftLoop));
};

export const closeBots = (bots: BotClient[]): void => {
  for (const bot of bots) bot.close();
};

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const randomInRange = (min: number, max: number): number =>
  min + Math.random() * (max - min);
