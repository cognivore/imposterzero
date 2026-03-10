import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createImposterKingsGame } from "@imposter-zero/engine";
import { startServer, type ServerHandle } from "../ws-server.js";
import { BotClient, createBots, createBotsInRoom, closeBots, readyAllAndDraft } from "./bot-client.js";

let server: ServerHandle;
let bots: BotClient[];

const url = () => `ws://127.0.0.1:${server.port}`;

beforeEach(() => {
  bots = [];
});

afterEach(async () => {
  closeBots(bots);
  if (server) await server.close();
});

describe("E2E lobby", () => {
  it("2 bots create/join room and receive lobby updates", async () => {
    server = startServer(createImposterKingsGame(), { port: 0 });
    bots = await createBotsInRoom(url(), 2);

    // Both bots are now in the room lobby. Bot 0 readies.
    const ready0 = await bots[0]!.ready();
    expect(ready0.type).toBe("lobby_state");

    // Bot 1 sees the ready broadcast
    const ready0Broadcast = await bots[1]!.waitForMessage();
    expect(ready0Broadcast.type).toBe("lobby_state");
  });

  it("late joiner receives updated lobby state", async () => {
    server = startServer(createImposterKingsGame(), { port: 0 });
    bots = await createBotsInRoom(url(), 1);

    const late = new BotClient(url(), "late");
    await late.connect();
    await late.setName("LateJoiner");
    bots.push(late);

    const roomId = bots[0]!.roomId!;
    const joined = await late.joinRoom(roomId);
    expect(joined.type).toBe("room_joined");

    const lobbyMsg = await late.drainUntil((m) => m.type === "lobby_state");
    if (lobbyMsg.type === "lobby_state") {
      expect((lobbyMsg as { lobby: { players: unknown[] } }).lobby.players.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("player leave before start resets to waiting", async () => {
    server = startServer(createImposterKingsGame(), { port: 0 });
    bots = await createBotsInRoom(url(), 2);

    // Bot 0 disconnects
    bots[0]!.close();

    // Bot 1 should still be able to interact
    const msg = await bots[1]!.ready();
    expect(msg.type).toBe("lobby_state");
  });

  it("lobby full rejection for > maxPlayers", async () => {
    server = startServer(createImposterKingsGame(), { port: 0 });
    bots = await createBotsInRoom(url(), 4, 4);

    const extra = new BotClient(url(), "extra");
    await extra.connect();
    await extra.setName("ExtraBot");
    bots.push(extra);

    const roomId = bots[0]!.roomId!;
    const errorMsg = await extra.joinRoom(roomId);
    expect(errorMsg.type).toBe("error");
  });

  it("2 bots ready up and game starts", async () => {
    server = startServer(createImposterKingsGame(), { port: 0 });
    bots = await createBotsInRoom(url(), 2);

    await readyAllAndDraft(bots);

    const received0 = bots[0]!.received;
    const received1 = bots[1]!.received;

    expect(received0.some((m) => m.type === "game_start")).toBe(true);
    expect(received1.some((m) => m.type === "game_start")).toBe(true);
    expect(received0.some((m) => m.type === "state")).toBe(true);
    expect(received1.some((m) => m.type === "state")).toBe(true);
  });

  it("3-player lobby fills and starts", async () => {
    server = startServer(createImposterKingsGame(), { port: 0 });
    bots = await createBotsInRoom(url(), 3);

    await readyAllAndDraft(bots);

    for (const bot of bots) {
      expect(bot.received.some((m) => m.type === "game_start")).toBe(true);
    }
  });

  it("4-player lobby fills and starts", async () => {
    server = startServer(createImposterKingsGame(), { port: 0 });
    bots = await createBotsInRoom(url(), 4, 4);

    await readyAllAndDraft(bots);

    for (const bot of bots) {
      expect(bot.received.some((m) => m.type === "game_start")).toBe(true);
    }
  });
});
