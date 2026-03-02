import { WebSocketServer, WebSocket } from "ws";
import type { GameDef } from "@imposter-zero/types";
import type { IKState, IKAction } from "@imposter-zero/engine";
import {
  type Room,
  type OutboundMessage,
  createRoom,
  roomTransition,
  continueAfterScoring,
} from "./room.js";
import type http from "node:http";

export interface ServerOptions {
  readonly port?: number;
  readonly targetScore?: number;
  readonly turnDuration?: number;
  readonly autoAdvanceScoring?: boolean;
}

export interface ServerHandle {
  readonly port: number;
  readonly close: () => Promise<void>;
}

interface Connection {
  readonly ws: WebSocket;
  readonly playerId: string;
}

const serializeMessage = (msg: OutboundMessage): string => JSON.stringify(msg);

const broadcast = (connections: ReadonlyArray<Connection>, messages: ReadonlyArray<OutboundMessage>): void => {
  for (const msg of messages) {
    const data = serializeMessage(msg);
    for (const conn of connections) {
      if (conn.ws.readyState === WebSocket.OPEN) {
        conn.ws.send(data);
      }
    }
  }
};

const sendTo = (conn: Connection, msg: OutboundMessage): void => {
  if (conn.ws.readyState === WebSocket.OPEN) {
    conn.ws.send(serializeMessage(msg));
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
  } = options;

  let room: Room = createRoom(game, targetScore, turnDuration);
  const connections: Connection[] = [];
  let connectionCounter = 0;

  const wss = new WebSocketServer({ port });

  const actualPort = (): number =>
    (wss.address() as { port: number }).port;

  wss.on("connection", (ws: WebSocket) => {
    const playerId = `player-${connectionCounter++}`;
    const conn: Connection = { ws, playerId };
    connections.push(conn);

    sendTo(conn, { type: "lobby_state", lobby: room.lobby });

    ws.on("message", (raw: Buffer | string) => {
      const now = Date.now();
      let msg: { type: string; [key: string]: unknown };
      try {
        msg = JSON.parse(typeof raw === "string" ? raw : raw.toString("utf-8"));
      } catch {
        sendTo(conn, { type: "error", message: "Invalid JSON" });
        return;
      }

      if (msg.type === "join") {
        const result = roomTransition(room, { kind: "join", playerId }, now);
        if (!result.ok) {
          sendTo(conn, { type: "error", message: result.error.kind });
          return;
        }
        room = result.value.room;
        broadcast(connections, result.value.messages);
        return;
      }

      if (msg.type === "ready") {
        const result = roomTransition(room, { kind: "ready", playerId, now }, now);
        if (!result.ok) {
          sendTo(conn, { type: "error", message: result.error.kind });
          return;
        }
        room = result.value.room;
        broadcast(connections, result.value.messages);

        if (autoAdvanceScoring && room.phase === "scoring") {
          const nextResult = continueAfterScoring(room, now);
          room = nextResult.room;
          broadcast(connections, nextResult.messages);
        }
        return;
      }

      if (msg.type === "action") {
        if (room.phase !== "playing") {
          sendTo(conn, { type: "error", message: "not_in_game" });
          return;
        }

        const action = msg.action as IKAction;
        const result = roomTransition(room, { kind: "action", playerId, action, now }, now);
        if (!result.ok) {
          sendTo(conn, { type: "error", message: result.error.kind });
          return;
        }
        room = result.value.room;
        broadcast(connections, result.value.messages);

        if (autoAdvanceScoring && room.phase === "scoring") {
          const nextResult = continueAfterScoring(room, now);
          room = nextResult.room;
          broadcast(connections, nextResult.messages);
        }
        return;
      }

      sendTo(conn, { type: "error", message: `Unknown message type: ${msg.type}` });
    });

    ws.on("close", () => {
      const idx = connections.findIndex((c) => c === conn);
      if (idx >= 0) connections.splice(idx, 1);
    });
  });

  return {
    get port() {
      return actualPort();
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        for (const conn of connections) {
          conn.ws.close();
        }
        wss.close((err) => (err ? reject(err) : resolve()));
      }),
  };
};
