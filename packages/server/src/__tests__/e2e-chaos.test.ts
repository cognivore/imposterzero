import { describe, it, expect, afterEach } from "vitest";
import { createImposterKingsGame } from "@imposter-zero/engine";
import { startServer, type ServerHandle } from "../ws-server.js";
import {
  BotClient,
  createBots,
  createBotsInRoom,
  closeBots,
  sleep,
  randomInRange,
  type ChaosPolicy,
} from "./bot-client.js";
import type { OutboundMessage } from "../room.js";
import type { PlayerId } from "@imposter-zero/types";

let server: ServerHandle;
let bots: BotClient[];

afterEach(async () => {
  if (bots) closeBots(bots);
  if (server) await server.close();
});

interface ChaosMatchResult {
  readonly finalScores: ReadonlyArray<number>;
  readonly winners: ReadonlyArray<PlayerId>;
  readonly roundScores: ReadonlyArray<ReadonlyArray<number>>;
  readonly roundsPlayed: number;
  readonly disconnectCount: number;
  readonly reconnectCount: number;
  readonly timeoutCount: number;
}

const setupAndStart = async (
  numPlayers: number,
  targetScore: number,
  turnDuration: number,
  reconnectWindowMs: number = 60_000,
): Promise<void> => {
  server = startServer(createImposterKingsGame(), {
    port: 0,
    targetScore,
    autoAdvanceScoring: true,
    turnDuration,
    reconnectWindowMs,
  });
  const url = `ws://127.0.0.1:${server.port}`;
  bots = await createBotsInRoom(url, numPlayers, numPlayers, targetScore);

  // All ready
  for (let i = 0; i < numPlayers; i++) bots[i]!.fireReady();
  for (const bot of bots) await bot.drainMessages(numPlayers + 1);
};

const playChaosMatch = async (
  numPlayers: number,
  policy: ChaosPolicy,
  overallTimeoutMs: number = 60_000,
): Promise<ChaosMatchResult> => {
  const roundScores: Array<ReadonlyArray<number>> = [];
  const seenRounds = new Set<number>();
  let finalScores: ReadonlyArray<number> = [];
  let winners: ReadonlyArray<PlayerId> = [];
  let roundsPlayed = 0;
  let disconnectCount = 0;
  let reconnectCount = 0;
  let timeoutCount = 0;
  let matchOver = false;

  const pendingReconnects = new Map<number, ReturnType<typeof setTimeout>>();
  const deadline = Date.now() + overallTimeoutMs;

  const findObserver = (): BotClient | null =>
    bots.find((b) => b.isConnected) ?? null;

  const scheduleReconnect = (botIdx: number): void => {
    const delayMs = randomInRange(policy.reconnectDelayMs[0], policy.reconnectDelayMs[1]);
    const timer = setTimeout(async () => {
      pendingReconnects.delete(botIdx);
      const bot = bots[botIdx]!;
      if (!bot.isConnected && !matchOver) {
        try {
          await bot.connect(bot.token);
          reconnectCount++;
        } catch {
          // server may have closed during teardown
        }
      }
    }, delayMs);
    pendingReconnects.set(botIdx, timer);
  };

  const maybeDisconnect = (): void => {
    if (Math.random() >= policy.disconnectProbability) return;
    const connected = bots
      .map((b, i) => ({ bot: b, idx: i }))
      .filter(({ bot }) => bot.isConnected);
    if (connected.length === 0) return;
    const target = connected[Math.floor(Math.random() * connected.length)]!;
    target.bot.simulateDisconnect();
    disconnectCount++;
    scheduleReconnect(target.idx);
  };

  while (!matchOver && Date.now() < deadline) {
    const observer = findObserver();
    if (!observer) {
      await sleep(50);
      continue;
    }

    let msg: OutboundMessage | { type: string; [k: string]: unknown };
    try {
      msg = await observer.waitForMessage(500);
    } catch {
      continue;
    }

    if (msg.type === "room_list" || msg.type === "room_joined" || msg.type === "room_created" || msg.type === "room_settings" || msg.type === "lobby_state" || msg.type === "welcome" || msg.type === "name_accepted") {
      continue;
    }

    if (msg.type === "state") {
      const stateMsg = msg as OutboundMessage & { type: "state" };
      const active = stateMsg.activePlayer;
      const legal = stateMsg.legalActions;
      const activeBotIdx = active as number;
      const activeBot = bots[activeBotIdx];

      if (legal.length > 0 && activeBot && activeBot.isConnected) {
        if (Math.random() < policy.dropMessageProbability) {
          timeoutCount++;
        } else {
          const delayMs = randomInRange(policy.actionDelayMs[0], policy.actionDelayMs[1]);
          if (delayMs > 0) await sleep(delayMs);
          activeBot.fireAction(legal[Math.floor(Math.random() * legal.length)]!);
        }
      } else {
        timeoutCount++;
      }
      maybeDisconnect();
      continue;
    }

    if (msg.type === "round_over") {
      const roundMsg = msg as OutboundMessage & { type: "round_over" };
      if (!seenRounds.has(roundMsg.roundsPlayed)) {
        seenRounds.add(roundMsg.roundsPlayed);
        roundScores.push(roundMsg.scores);
      }
      roundsPlayed = roundMsg.roundsPlayed;
      continue;
    }

    if (msg.type === "match_over") {
      const matchMsg = msg as OutboundMessage & { type: "match_over" };
      finalScores = matchMsg.finalScores;
      winners = matchMsg.winners;
      matchOver = true;
      break;
    }
  }

  for (const timer of pendingReconnects.values()) clearTimeout(timer);

  return {
    finalScores,
    winners,
    roundScores,
    roundsPlayed,
    disconnectCount,
    reconnectCount,
    timeoutCount,
  };
};

const assertMatchInvariants = (
  result: ChaosMatchResult,
  numPlayers: number,
  targetScore: number,
): void => {
  expect(result.winners.length).toBeGreaterThanOrEqual(1);
  expect(Math.max(...result.finalScores)).toBeGreaterThanOrEqual(targetScore);
  expect(result.roundsPlayed).toBeGreaterThanOrEqual(1);

  expect(result.roundScores.length).toBeLessThanOrEqual(result.roundsPlayed);

  for (const round of result.roundScores) {
    expect(round).toHaveLength(numPlayers);
    for (const s of round) {
      expect(s).toBeGreaterThanOrEqual(0);
    }
  }

  expect(result.finalScores).toHaveLength(numPlayers);
  for (const s of result.finalScores) {
    expect(s).toBeGreaterThanOrEqual(0);
  }

  if (numPlayers === 4) {
    expect(result.finalScores[0]).toBe(result.finalScores[2]);
    expect(result.finalScores[1]).toBe(result.finalScores[3]);
  }
};

describe("Chaos Monkey E2E", () => {
  it.skip("random disconnects during 2p match to 3", async () => {
    await setupAndStart(2, 3, 150);
    const result = await playChaosMatch(2, {
      disconnectProbability: 0.15,
      reconnectDelayMs: [30, 100],
      actionDelayMs: [0, 10],
      dropMessageProbability: 0,
    });

    assertMatchInvariants(result, 2, 3);
    expect(result.disconnectCount).toBeGreaterThan(0);
  }, 60_000);

  it.skip("random disconnects during 4p match to 3", async () => {
    await setupAndStart(4, 3, 150);
    const result = await playChaosMatch(4, {
      disconnectProbability: 0.12,
      reconnectDelayMs: [30, 100],
      actionDelayMs: [0, 10],
      dropMessageProbability: 0,
    });

    assertMatchInvariants(result, 4, 3);
    expect(result.disconnectCount).toBeGreaterThan(0);
  }, 60_000);

  it("all bots disconnect simultaneously", async () => {
    await setupAndStart(2, 3, 100);

    let initialStateSeen = false;
    const observer = bots[0]!;
    while (!initialStateSeen) {
      const msg = await observer.waitForMessage(2000);
      if (msg.type === "state") {
        initialStateSeen = true;
        const stateMsg = msg as OutboundMessage & { type: "state" };
        if (stateMsg.legalActions.length > 0) {
          bots[stateMsg.activePlayer as number]!.fireAction(stateMsg.legalActions[0]!);
        }
      }
    }

    await sleep(50);
    for (const bot of bots) bot.simulateDisconnect();
    await sleep(150);
    for (const bot of bots) await bot.connect(bot.token);

    const result = await playChaosMatch(2, {
      disconnectProbability: 0,
      reconnectDelayMs: [50, 100],
      actionDelayMs: [0, 0],
      dropMessageProbability: 0,
    });

    assertMatchInvariants(result, 2, 3);
  }, 60_000);

  it("rapid disconnect/reconnect flapping", async () => {
    await setupAndStart(2, 3, 200);
    const flapper = bots[1]!;

    for (let i = 0; i < 5; i++) {
      flapper.simulateDisconnect();
      await sleep(10);
      await flapper.connect(flapper.token);
      await sleep(10);
    }

    expect(flapper.isConnected).toBe(true);

    const result = await playChaosMatch(2, {
      disconnectProbability: 0,
      reconnectDelayMs: [50, 100],
      actionDelayMs: [0, 0],
      dropMessageProbability: 0,
    });

    assertMatchInvariants(result, 2, 3);
  }, 60_000);

  it("token expiry rejects stale reconnect", async () => {
    server = startServer(createImposterKingsGame(), {
      port: 0,
      targetScore: 7,
      turnDuration: 30_000,
      reconnectWindowMs: 200,
    });
    const url = `ws://127.0.0.1:${server.port}`;
    bots = await createBots(url, 1);

    await bots[0]!.createRoom();
    await bots[0]!.drainUntil((m) => m.type === "lobby_state");

    const savedToken = bots[0]!.token;
    bots[0]!.simulateDisconnect();
    await sleep(350);

    const staleBot = new BotClient(url, "stale");
    await staleBot.connect(savedToken);
    bots.push(staleBot);

    expect(staleBot.token).not.toBe(savedToken);
  }, 15_000);

  it.skip("message drop simulation — timeouts fill in", async () => {
    await setupAndStart(2, 3, 100);
    const result = await playChaosMatch(2, {
      disconnectProbability: 0,
      reconnectDelayMs: [50, 100],
      actionDelayMs: [0, 0],
      dropMessageProbability: 0.2,
    });

    assertMatchInvariants(result, 2, 3);
    expect(result.timeoutCount).toBeGreaterThan(0);
  }, 60_000);

  it("staggered reconnect timing in 3p game", async () => {
    await setupAndStart(3, 3, 150);
    const observer = bots[0]!;

    let firstStateSeen = false;
    while (!firstStateSeen) {
      const msg = await observer.waitForMessage(2000);
      if (msg.type === "state") {
        firstStateSeen = true;
        const stateMsg = msg as OutboundMessage & { type: "state" };
        if (stateMsg.legalActions.length > 0) {
          bots[stateMsg.activePlayer as number]!.fireAction(stateMsg.legalActions[0]!);
        }
      }
    }

    await sleep(20);
    bots[1]!.simulateDisconnect();
    await sleep(30);
    bots[2]!.simulateDisconnect();

    await sleep(200);
    await bots[2]!.connect(bots[2]!.token);
    await sleep(100);
    await bots[1]!.connect(bots[1]!.token);

    expect(bots[1]!.isConnected).toBe(true);
    expect(bots[2]!.isConnected).toBe(true);

    const result = await playChaosMatch(3, {
      disconnectProbability: 0,
      reconnectDelayMs: [50, 100],
      actionDelayMs: [0, 0],
      dropMessageProbability: 0,
    });

    assertMatchInvariants(result, 3, 3);
  }, 60_000);
});
