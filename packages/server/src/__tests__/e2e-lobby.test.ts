import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createImposterKingsGame } from "@imposter-zero/engine";
import { startServer, type ServerHandle } from "../ws-server.js";
import { BotClient, createBots, createBotsInRoom, closeBots } from "./bot-client.js";

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

    // Late joiner connects, gets room_list, then joins the room
    const late = new BotClient(url(), "late");
    await late.connect();
    bots.push(late);

    await late.drainUntil((m) => m.type === "room_list");
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
    // Create a room with maxPlayers=4 and 4 bots
    bots = await createBotsInRoom(url(), 4, 4);

    // 5th bot connects and tries to join the same room
    const extra = new BotClient(url(), "extra");
    await extra.connect();
    bots.push(extra);
    await extra.drainUntil((m) => m.type === "room_list");

    const roomId = bots[0]!.roomId!;
    const errorMsg = await extra.joinRoom(roomId);
    expect(errorMsg.type).toBe("error");
  });

  it("2 bots ready up and game starts", async () => {
    server = startServer(createImposterKingsGame(), { port: 0 });
    bots = await createBotsInRoom(url(), 2);

    // Bot 0 readies — lobby stays waiting
    await bots[0]!.ready();
    await bots[1]!.waitForMessage();

    // Bot 1 readies — game should start
    await bots[1]!.ready();

    // bot 0: lobby_state(starting), game_start, state
    const allMsgs0 = await bots[0]!.drainMessages(3);
    // bot 1: game_start, state (ready() already consumed lobby_state)
    const allMsgs1 = await bots[1]!.drainMessages(2);

    expect(allMsgs0.some((m) => m.type === "game_start")).toBe(true);
    expect(allMsgs1.some((m) => m.type === "game_start")).toBe(true);
    expect(allMsgs0.some((m) => m.type === "state")).toBe(true);
    expect(allMsgs1.some((m) => m.type === "state")).toBe(true);
  });

  it("3-player lobby fills and starts", async () => {
    server = startServer(createImposterKingsGame(), { port: 0 });
    bots = await createBotsInRoom(url(), 3);

    // First 2 ready — no start yet
    for (let i = 0; i < 2; i++) {
      await bots[i]!.ready();
      for (let j = 0; j < 3; j++) {
        if (j !== i) await bots[j]!.waitForMessage();
      }
    }

    // Third ready triggers start
    await bots[2]!.ready();

    // Drain messages: lobby(starting), game_start, state
    for (const bot of bots) {
      const msgs = await bot.drainMessages(2);
      expect(msgs.some((m) => m.type === "game_start")).toBe(true);
    }
  });

  it("4-player lobby fills and starts", async () => {
    server = startServer(createImposterKingsGame(), { port: 0 });
    bots = await createBotsInRoom(url(), 4, 4);

    // First 3 ready
    for (let i = 0; i < 3; i++) {
      await bots[i]!.ready();
      for (let j = 0; j < 4; j++) {
        if (j !== i) await bots[j]!.waitForMessage();
      }
    }

    // Fourth ready triggers start
    await bots[3]!.ready();

    for (const bot of bots) {
      const msgs = await bot.drainMessages(2);
      expect(msgs.some((m) => m.type === "game_start")).toBe(true);
    }
  });
});
