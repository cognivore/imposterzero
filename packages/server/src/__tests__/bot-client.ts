import WebSocket from "ws";
import type { IKAction } from "@imposter-zero/engine";
import type { OutboundMessage } from "../room.js";

export class BotClient {
  private ws: WebSocket | null = null;
  private messageQueue: OutboundMessage[] = [];
  private waiters: Array<(msg: OutboundMessage) => void> = [];
  readonly received: OutboundMessage[] = [];
  readonly id: string;
  token: string | null = null;
  playerId: string | null = null;

  constructor(
    private readonly url: string,
    id: string,
  ) {
    this.id = id;
  }

  private attachListeners(ws: WebSocket): void {
    ws.on("message", (raw: Buffer | string) => {
      const msg: OutboundMessage = JSON.parse(
        typeof raw === "string" ? raw : raw.toString("utf-8"),
      );
      this.received.push(msg);
      if (msg.type === "welcome") {
        const w = msg as OutboundMessage & { type: "welcome" };
        this.token = w.token;
        this.playerId = w.playerId;
      }
      const waiter = this.waiters.shift();
      if (waiter) {
        waiter(msg);
      } else {
        this.messageQueue.push(msg);
      }
    });
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);
      this.ws.on("open", () => {
        this.attachListeners(this.ws!);
        const consumeWelcome = (): void => {
          const queued = this.messageQueue.shift();
          if (queued && queued.type === "welcome") {
            resolve();
            return;
          }
          if (queued) {
            this.messageQueue.unshift(queued);
          }
          this.waiters.push((msg) => {
            if (msg.type === "welcome") {
              resolve();
            } else {
              this.messageQueue.push(msg);
              consumeWelcome();
            }
          });
        };
        consumeWelcome();
      });
      this.ws.on("error", reject);
    });
  }

  async reconnectToServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.messageQueue = [];
      this.waiters = [];
      this.ws = new WebSocket(this.url);
      this.ws.on("open", () => {
        this.attachListeners(this.ws!);
        const drainUntilWelcome = (): void => {
          this.waiters.push((msg) => {
            if (msg.type === "welcome") {
              resolve();
            } else {
              drainUntilWelcome();
            }
          });
        };
        this.ws!.send(JSON.stringify({ type: "reconnect", token: this.token }));
        drainUntilWelcome();
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

  private nextMessage(timeoutMs: number = 5000): Promise<OutboundMessage> {
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

  async join(): Promise<OutboundMessage> {
    this.send({ type: "join" });
    return this.nextMessage();
  }

  async ready(): Promise<OutboundMessage> {
    this.send({ type: "ready", ready: true });
    return this.nextMessage();
  }

  async sendAction(action: IKAction): Promise<OutboundMessage> {
    this.send({ type: "action", action });
    return this.nextMessage();
  }

  fireAction(action: IKAction): void {
    this.send({ type: "action", action });
  }

  fireJoin(): void {
    this.send({ type: "join" });
  }

  fireReady(): void {
    this.send({ type: "ready", ready: true });
  }

  async waitForMessage(timeoutMs: number = 5000): Promise<OutboundMessage> {
    return this.nextMessage(timeoutMs);
  }

  async drainMessages(count: number, timeoutMs: number = 5000): Promise<OutboundMessage[]> {
    const msgs: OutboundMessage[] = [];
    for (let i = 0; i < count; i++) {
      msgs.push(await this.nextMessage(timeoutMs));
    }
    return msgs;
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
    bots.push(bot);
  }
  return bots;
};

export const closeBots = (bots: BotClient[]): void => {
  for (const bot of bots) bot.close();
};

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const randomInRange = (min: number, max: number): number =>
  min + Math.random() * (max - min);
