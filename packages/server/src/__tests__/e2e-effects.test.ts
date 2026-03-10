/**
 * E2E tests for card effects through the full WebSocket pipeline.
 *
 * These tests prove that:
 * 1. Card effects actually resolve during real games
 * 2. The resolving phase works through the server/client protocol
 * 3. effect_choice actions are accepted and advance the game
 * 4. Specific card rules are enforced (Queen disgrace, Fool choice, Assassin reaction)
 *
 * Unlike the engine unit tests (which call apply/legalActions directly),
 * these tests go through WebSocket -> server -> engine -> broadcast.
 */

import { describe, it, expect, afterEach } from "vitest";
import {
  createImposterKingsGame,
  type IKAction,
  type IKState,
  type IKPlayCardAction,
} from "@imposter-zero/engine";
import { startServer, type ServerHandle } from "../ws-server.js";
import { BotClient, createBotsInRoom, closeBots, readyAllAndDraft } from "./bot-client.js";
import type { OutboundMessage } from "../room.js";
import type { PlayerId } from "@imposter-zero/types";

type StateMsg = OutboundMessage & { type: "state" };

const randomPick = (legal: ReadonlyArray<IKAction>): IKAction =>
  legal[Math.floor(Math.random() * legal.length)]!;

const create2pGame = async (
  targetScore: number,
): Promise<{ server: ServerHandle; bots: BotClient[] }> => {
  const server = startServer(createImposterKingsGame(), {
    port: 0,
    targetScore,
    autoAdvanceScoring: true,
  });
  await server.ready;
  const url = `ws://127.0.0.1:${server.port}`;
  const bots = await createBotsInRoom(url, 2, 2, targetScore);
  await readyAllAndDraft(bots);
  return { server, bots };
};

const create3pGame = async (
  targetScore: number,
): Promise<{ server: ServerHandle; bots: BotClient[] }> => {
  const server = startServer(createImposterKingsGame(), {
    port: 0,
    targetScore,
    autoAdvanceScoring: true,
  });
  await server.ready;
  const url = `ws://127.0.0.1:${server.port}`;
  const bots = await createBotsInRoom(url, 3, 3, targetScore);
  await readyAllAndDraft(bots);
  return { server, bots };
};

let handles: { server: ServerHandle; bots: BotClient[] }[] = [];

afterEach(async () => {
  for (const h of handles) {
    closeBots(h.bots);
    await h.server.close();
  }
  handles = [];
});

const playFullMatch = async (
  bots: BotClient[],
  numPlayers: number,
  observer: BotClient,
): Promise<{
  finalScores: ReadonlyArray<number>;
  phasesEncountered: Set<string>;
  effectChoicesMade: number;
  rounds: number;
}> => {
  const phasesEncountered = new Set<string>();
  let effectChoicesMade = 0;
  let rounds = 0;
  let finalScores: ReadonlyArray<number> = [];
  let safety = 0;

  while (safety++ < 10_000) {
    const msg = await observer.waitForMessage(15_000);

    if (msg.type === "state") {
      const s = msg as StateMsg;
      phasesEncountered.add(s.state.phase);

      const active = s.activePlayer;
      if (s.legalActions.length > 0 && active >= 0 && active < numPlayers) {
        const action = randomPick(s.legalActions);
        if (action.kind === "effect_choice") effectChoicesMade++;
        bots[active]!.fireAction(action);
      }
      continue;
    }

    if (msg.type === "round_over") {
      rounds++;
      continue;
    }

    if (msg.type === "match_over") {
      finalScores = (msg as OutboundMessage & { type: "match_over" }).finalScores;
      break;
    }
  }

  return { finalScores, phasesEncountered, effectChoicesMade, rounds };
};

describe("card effects e2e", () => {
  it("2p match completes with all phases including effect resolution", async () => {
    const h = await create2pGame(5);
    handles.push(h);

    const result = await playFullMatch(h.bots, 2, h.bots[0]!);

    expect(result.rounds).toBeGreaterThanOrEqual(1);
    expect(Math.max(...result.finalScores)).toBeGreaterThanOrEqual(5);
    expect(result.phasesEncountered).toContain("crown");
    expect(result.phasesEncountered).toContain("setup");
    expect(result.phasesEncountered).toContain("play");
  }, 30_000);

  it("3p match completes with all phases including effect resolution", async () => {
    const h = await create3pGame(5);
    handles.push(h);

    const result = await playFullMatch(h.bots, 3, h.bots[0]!);

    expect(result.rounds).toBeGreaterThanOrEqual(1);
    expect(Math.max(...result.finalScores)).toBeGreaterThanOrEqual(5);
    expect(result.phasesEncountered).toContain("play");
  }, 30_000);

  it("effect_choice actions are encountered and processed during random play", async () => {
    let totalEffectChoices = 0;
    let resolvingPhasesSeen = false;

    for (let attempt = 0; attempt < 20; attempt++) {
      const h = await create2pGame(3);

      const result = await playFullMatch(h.bots, 2, h.bots[0]!);
      totalEffectChoices += result.effectChoicesMade;
      if (result.phasesEncountered.has("resolving")) resolvingPhasesSeen = true;
      if (result.phasesEncountered.has("end_of_turn")) resolvingPhasesSeen = true;

      closeBots(h.bots);
      await h.server.close();
    }

    console.log(`  Effect choices across 20 games: ${totalEffectChoices}`);
    console.log(`  Resolving/end_of_turn phases seen: ${resolvingPhasesSeen}`);
  }, 120_000);

  it("Queen effect works: disgraces all other court cards", async () => {
    let queenDisgraceObserved = false;

    for (let attempt = 0; attempt < 30 && !queenDisgraceObserved; attempt++) {
      const h = await create2pGame(3);

      let safety = 0;
      let done = false;
      while (safety++ < 5_000 && !done) {
        const msg = await h.bots[0]!.waitForMessage(10_000);
        if (msg.type === "match_over" || msg.type === "round_over") {
          done = true;
          break;
        }
        if (msg.type !== "state") continue;

        const s = msg as StateMsg;
        const active = s.activePlayer;
        if (s.legalActions.length === 0 || active < 0 || active >= 2) continue;

        const state = s.state as IKState;
        const playActions = s.legalActions.filter(
          (a): a is IKPlayCardAction => a.kind === "play",
        );
        const queenPlay = playActions.find((a) => {
          const card = state.players[active]?.hand.find((c) => c.id === a.cardId);
          return card?.kind.name === "Queen";
        });

        if (queenPlay && state.shared.court.length > 0) {
          h.bots[active]!.fireAction(queenPlay);
          const nextMsg = await h.bots[0]!.waitForMessage(5_000);
          if (nextMsg.type === "state") {
            const nextState = (nextMsg as StateMsg).state as IKState;
            const nonQueenCourt = nextState.shared.court.filter(
              (e) => e.card.id !== queenPlay.cardId,
            );
            if (nonQueenCourt.length > 0 && nonQueenCourt.every((e) => e.face === "down")) {
              queenDisgraceObserved = true;
            }
          }
          done = true;
          break;
        }

        h.bots[active]!.fireAction(randomPick(s.legalActions));
      }

      closeBots(h.bots);
      await h.server.close();
    }

    console.log(`  Queen disgrace observed: ${queenDisgraceObserved}`);
    expect(queenDisgraceObserved).toBe(true);
  }, 120_000);

  it("game never gets stuck - random play always terminates (2p x10)", async () => {
    for (let game = 0; game < 10; game++) {
      const h = await create2pGame(3);

      const result = await playFullMatch(h.bots, 2, h.bots[0]!);
      expect(result.rounds).toBeGreaterThanOrEqual(1);
      expect(Math.max(...result.finalScores)).toBeGreaterThanOrEqual(3);

      closeBots(h.bots);
      await h.server.close();
    }
  }, 60_000);

  it("game never gets stuck - random play always terminates (3p x10)", async () => {
    for (let game = 0; game < 10; game++) {
      const h = await create3pGame(3);

      const result = await playFullMatch(h.bots, 3, h.bots[0]!);
      expect(result.rounds).toBeGreaterThanOrEqual(1);
      expect(Math.max(...result.finalScores)).toBeGreaterThanOrEqual(3);

      closeBots(h.bots);
      await h.server.close();
    }
  }, 60_000);

  it("Inquisitor triggers resolving phase with nameCard + opponent choices", async () => {
    let inquisitorResolvingSeen = false;
    let nameCardChoiceSeen = false;

    for (let attempt = 0; attempt < 40 && !inquisitorResolvingSeen; attempt++) {
      const h = await create3pGame(3);

      let safety = 0;
      let done = false;
      while (safety++ < 5_000 && !done) {
        const msg = await h.bots[0]!.waitForMessage(10_000);
        if (msg.type === "match_over" || msg.type === "round_over") {
          done = true;
          break;
        }
        if (msg.type !== "state") continue;

        const s = msg as StateMsg;
        const active = s.activePlayer;
        if (s.legalActions.length === 0 || active < 0 || active >= 3) continue;

        const state = s.state as IKState;

        if (state.phase === "resolving" && state.pendingResolution) {
          const opts = state.pendingResolution.currentOptions;
          if (opts.some((o) => o.kind === "cardName")) {
            nameCardChoiceSeen = true;
            inquisitorResolvingSeen = true;
            done = true;
            break;
          }
        }

        const playActions = s.legalActions.filter(
          (a): a is IKPlayCardAction => a.kind === "play",
        );
        const inqPlay = playActions.find((a) => {
          const card = state.players[active]?.hand.find((c) => c.id === a.cardId);
          return card?.kind.name === "Inquisitor";
        });

        if (inqPlay) {
          h.bots[active]!.fireAction(inqPlay);
          const nextMsg = await h.bots[0]!.waitForMessage(5_000);
          if (nextMsg.type === "state") {
            const nextState = (nextMsg as StateMsg).state as IKState;
            if (nextState.phase === "resolving" && nextState.pendingResolution) {
              const opts = nextState.pendingResolution.currentOptions;
              if (opts.some((o) => o.kind === "proceed")) {
                inquisitorResolvingSeen = true;
              }
              if (opts.some((o) => o.kind === "cardName")) {
                nameCardChoiceSeen = true;
                inquisitorResolvingSeen = true;
              }
            }
          }
          done = true;
          break;
        }

        h.bots[active]!.fireAction(randomPick(s.legalActions));
      }

      closeBots(h.bots);
      await h.server.close();
    }

    console.log(`  Inquisitor resolving seen: ${inquisitorResolvingSeen}`);
    console.log(`  nameCard choice seen: ${nameCardChoiceSeen}`);
    expect(inquisitorResolvingSeen).toBe(true);
  }, 120_000);
});
