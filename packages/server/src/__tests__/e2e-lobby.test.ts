import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createImposterKingsGame } from "@imposter-zero/engine";
import { startServer, type ServerHandle } from "../ws-server.js";
import { BotClient, createBots, closeBots } from "./bot-client.js";

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
  it("2 bots connect, join, and receive lobby updates", async () => {
    server = startServer(createImposterKingsGame(), { port: 0 });
    bots = await createBots(url(), 2);

    // Each bot receives initial lobby_state on connect
    const init0 = await bots[0]!.waitForMessage();
    const init1 = await bots[1]!.waitForMessage();
    expect(init0.type).toBe("lobby_state");
    expect(init1.type).toBe("lobby_state");

    // Bot 0 joins
    const join0 = await bots[0]!.join();
    expect(join0.type).toBe("lobby_state");

    // Bot 1 also sees that join broadcast
    const join0Broadcast = await bots[1]!.waitForMessage();
    expect(join0Broadcast.type).toBe("lobby_state");

    // Bot 1 joins
    const join1 = await bots[1]!.join();
    expect(join1.type).toBe("lobby_state");
  });

  it("late joiner receives updated lobby state", async () => {
    server = startServer(createImposterKingsGame(), { port: 0 });
    bots = await createBots(url(), 1);
    await bots[0]!.waitForMessage(); // initial lobby
    await bots[0]!.join();

    // Late joiner connects and sees existing players
    const late = new BotClient(url(), "late");
    await late.connect();
    bots.push(late);

    const lateInit = await late.waitForMessage();
    expect(lateInit.type).toBe("lobby_state");
    if (lateInit.type === "lobby_state") {
      expect(lateInit.lobby.players.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("player leave before start resets to waiting", async () => {
    server = startServer(createImposterKingsGame(), { port: 0 });
    bots = await createBots(url(), 2);
    await bots[0]!.waitForMessage();
    await bots[1]!.waitForMessage();

    await bots[0]!.join();
    await bots[1]!.waitForMessage();
    await bots[1]!.join();

    // Bot 0 sees the join broadcast from bot 1
    await bots[0]!.waitForMessage();

    // Bot 0 disconnects — server handles the leave
    bots[0]!.close();

    // Bot 1 should still be able to interact
    const msg = await bots[1]!.ready();
    expect(msg.type).toBe("lobby_state");
  });

  it("lobby full rejection for > maxPlayers", async () => {
    server = startServer(createImposterKingsGame(), { port: 0 });
    bots = await createBots(url(), 5);

    // Drain initial lobby state from each
    for (const bot of bots) {
      await bot.waitForMessage();
    }

    // Join first 4 (max for IK)
    for (let i = 0; i < 4; i++) {
      await bots[i]!.join();
      // Drain broadcasts to all already-connected bots
      for (let j = 0; j < 5; j++) {
        if (j !== i) {
          await bots[j]!.waitForMessage();
        }
      }
    }

    // 5th bot tries to join — should get error
    const errorMsg = await bots[4]!.join();
    expect(errorMsg.type).toBe("error");
  });

  it("2 bots ready up and game starts", async () => {
    server = startServer(createImposterKingsGame(), { port: 0 });
    bots = await createBots(url(), 2);
    await bots[0]!.waitForMessage();
    await bots[1]!.waitForMessage();

    await bots[0]!.join();
    await bots[1]!.waitForMessage();
    await bots[1]!.join();
    await bots[0]!.waitForMessage();

    // Bot 0 readies — lobby stays waiting
    await bots[0]!.ready();
    await bots[1]!.waitForMessage();

    // Bot 1 readies — game should start (both ready + quorum met)
    // Bot 1's ready() consumes 1 message; bot 0 gets all 3 broadcast messages
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
    bots = await createBots(url(), 3);

    for (const bot of bots) await bot.waitForMessage();

    // All join
    for (let i = 0; i < 3; i++) {
      await bots[i]!.join();
      for (let j = 0; j < 3; j++) {
        if (j !== i) await bots[j]!.waitForMessage();
      }
    }

    // First 2 ready — no start yet
    for (let i = 0; i < 2; i++) {
      await bots[i]!.ready();
      for (let j = 0; j < 3; j++) {
        if (j !== i) await bots[j]!.waitForMessage();
      }
    }

    // Third ready triggers start
    await bots[2]!.ready();

    // Drain messages from all bots: lobby(starting), game_start, state
    for (const bot of bots) {
      const msgs = await bot.drainMessages(2);
      expect(msgs.some((m) => m.type === "game_start")).toBe(true);
    }
  });

  it("4-player lobby fills and starts", async () => {
    server = startServer(createImposterKingsGame(), { port: 0 });
    bots = await createBots(url(), 4);

    for (const bot of bots) await bot.waitForMessage();

    for (let i = 0; i < 4; i++) {
      await bots[i]!.join();
      for (let j = 0; j < 4; j++) {
        if (j !== i) await bots[j]!.waitForMessage();
      }
    }

    for (let i = 0; i < 3; i++) {
      await bots[i]!.ready();
      for (let j = 0; j < 4; j++) {
        if (j !== i) await bots[j]!.waitForMessage();
      }
    }

    await bots[3]!.ready();

    for (const bot of bots) {
      const msgs = await bot.drainMessages(2);
      expect(msgs.some((m) => m.type === "game_start")).toBe(true);
    }
  });
});
