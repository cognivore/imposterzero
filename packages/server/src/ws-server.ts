import { WebSocketServer, WebSocket } from "ws";
import type { GameDef, PlayerId } from "@imposter-zero/types";
import type { IKState, IKAction } from "@imposter-zero/engine";
import {
  type Room,
  type PlayingRoom,
  type ScoringRoom,
  type FinishedRoom,
  type OutboundMessage,
  createRoom,
  roomTransition,
  continueAfterScoring,
} from "./room.js";
import { ConnectionRegistry } from "./connection-registry.js";

export interface ServerOptions {
  readonly port?: number;
  readonly targetScore?: number;
  readonly turnDuration?: number;
  readonly autoAdvanceScoring?: boolean;
  readonly reconnectWindowMs?: number;
}

export interface ServerHandle {
  readonly port: number;
  readonly close: () => Promise<void>;
}

const serializeMessage = (msg: OutboundMessage): string => JSON.stringify(msg);

const sendToWs = (ws: WebSocket, msg: OutboundMessage): void => {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(serializeMessage(msg));
  }
};

export const startServer = (
  game: GameDef<IKState, IKAction>,
  options: ServerOptions = {},
): ServerHandle => {
  const {
    port = 0,
    targetScore = 7,
    turnDuration = 30_000,
    autoAdvanceScoring = true,
    reconnectWindowMs = 60_000,
  } = options;

  let room: Room = createRoom(game, targetScore, turnDuration);
  const registry = new ConnectionRegistry({ reconnectWindowMs });
  let turnTimer: ReturnType<typeof setTimeout> | null = null;

  const wss = new WebSocketServer({ port });

  const actualPort = (): number =>
    (wss.address() as { port: number }).port;

  const broadcastAll = (messages: ReadonlyArray<OutboundMessage>): void => {
    for (const msg of messages) {
      const data = serializeMessage(msg);
      for (const entry of registry.allConnected()) {
        entry.ws!.send(data);
      }
    }
  };

  const clearTurnTimer = (): void => {
    if (turnTimer !== null) {
      clearTimeout(turnTimer);
      turnTimer = null;
    }
  };

  const scheduleTurnTimer = (): void => {
    clearTurnTimer();
    if (room.phase !== "playing") return;
    const playing = room as PlayingRoom;
    const delay = Math.max(1, playing.session.turnDeadline - Date.now() + 1);
    turnTimer = setTimeout(() => {
      const now = Date.now();
      const result = roomTransition(room, { kind: "timeout", now }, now);
      if (!result.ok) return;
      room = result.value.room;
      broadcastAll(result.value.messages);
      advanceIfScoring(now);
      scheduleTurnTimer();
    }, delay);
  };

  const advanceIfScoring = (now: number): void => {
    if (autoAdvanceScoring && room.phase === "scoring") {
      const nextResult = continueAfterScoring(room, now);
      room = nextResult.room;
      broadcastAll(nextResult.messages);
    }
  };

  const sendStateSnapshot = (ws: WebSocket): void => {
    if (room.phase === "playing") {
      const playing = room as PlayingRoom;
      const legalActions = playing.game.legalActions(playing.session.state);
      const activePlayer = playing.game.currentPlayer(playing.session.state) as PlayerId;
      sendToWs(ws, { type: "state", state: playing.session.state, legalActions, activePlayer });
    } else if (room.phase === "finished") {
      const finished = room as FinishedRoom;
      sendToWs(ws, { type: "match_over", winners: finished.winners, finalScores: [...finished.match.scores] });
    } else if (room.phase === "scoring") {
      const scoring = room as ScoringRoom;
      sendToWs(ws, {
        type: "round_over",
        scores: scoring.lastRoundScores,
        matchScores: [...scoring.match.scores],
        roundsPlayed: scoring.match.roundsPlayed,
      });
    } else {
      sendToWs(ws, { type: "lobby_state", lobby: room.lobby });
    }
  };

  wss.on("connection", (ws: WebSocket) => {
    const now = Date.now();
    const initialEntry = registry.register(ws, now);
    let activeEntry = initialEntry;

    sendToWs(ws, { type: "welcome", token: initialEntry.token, playerId: initialEntry.playerId });
    sendToWs(ws, { type: "lobby_state", lobby: room.lobby });

    ws.on("message", (raw: Buffer | string) => {
      const msgNow = Date.now();
      let msg: { type: string; [key: string]: unknown };
      try {
        msg = JSON.parse(typeof raw === "string" ? raw : raw.toString("utf-8"));
      } catch {
        sendToWs(ws, { type: "error", message: "Invalid JSON" });
        return;
      }

      if (msg.type === "reconnect") {
        const token = msg.token as string;
        const reconnected = registry.reconnect(ws, token, msgNow);
        if (!reconnected) {
          sendToWs(ws, { type: "error", message: "invalid_token" });
          return;
        }
        if (activeEntry !== reconnected) {
          registry.remove(activeEntry.token);
        }
        activeEntry = reconnected;
        sendToWs(ws, { type: "welcome", token: reconnected.token, playerId: reconnected.playerId });
        sendStateSnapshot(ws);
        return;
      }

      const playerId = activeEntry.playerId;

      if (msg.type === "join") {
        const result = roomTransition(room, { kind: "join", playerId }, msgNow);
        if (!result.ok) {
          sendToWs(ws, { type: "error", message: result.error.kind });
          return;
        }
        room = result.value.room;
        broadcastAll(result.value.messages);
        scheduleTurnTimer();
        return;
      }

      if (msg.type === "ready") {
        const result = roomTransition(room, { kind: "ready", playerId, now: msgNow }, msgNow);
        if (!result.ok) {
          sendToWs(ws, { type: "error", message: result.error.kind });
          return;
        }
        room = result.value.room;
        broadcastAll(result.value.messages);
        advanceIfScoring(msgNow);
        scheduleTurnTimer();
        return;
      }

      if (msg.type === "action") {
        if (room.phase !== "playing") {
          sendToWs(ws, { type: "error", message: "not_in_game" });
          return;
        }

        const action = msg.action as IKAction;
        const result = roomTransition(room, { kind: "action", playerId, action, now: msgNow }, msgNow);
        if (!result.ok) {
          sendToWs(ws, { type: "error", message: result.error.kind });
          return;
        }
        room = result.value.room;
        broadcastAll(result.value.messages);
        advanceIfScoring(msgNow);
        scheduleTurnTimer();
        return;
      }

      sendToWs(ws, { type: "error", message: `Unknown message type: ${msg.type}` });
    });

    ws.on("close", () => {
      registry.disconnect(activeEntry.token, Date.now());
    });
  });

  return {
    get port() {
      return actualPort();
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        clearTurnTimer();
        for (const entry of registry.allConnected()) {
          entry.ws!.close();
        }
        wss.close((err) => (err ? reject(err) : resolve()));
      }),
  };
};
