import { useEffect, useRef, useCallback } from "react";
import type { ClientMessage, ServerMessage } from "@imposter-zero/types";
import { parseServerMessage } from "@imposter-zero/types";
import type { IKState, IKAction } from "@imposter-zero/engine";
import type { LobbyState } from "./lobby-types.js";
import type { GameAction } from "./state.js";

export type IKServerMessage = ServerMessage<IKState, IKAction, LobbyState>;
export type IKClientMessage = ClientMessage<IKAction>;

export interface WebSocketHandle {
  readonly send: (msg: IKClientMessage) => void;
}

const STORAGE_KEY = "imposter-zero-identity";

interface StoredIdentity {
  readonly token: string;
  readonly name: string | null;
}

const loadIdentity = (): StoredIdentity | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) as StoredIdentity : null;
  } catch { return null; }
};

export const saveIdentity = (token: string, name: string | null): void => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ token, name }));
};

export const clearIdentity = (): void => {
  localStorage.removeItem(STORAGE_KEY);
};

export const useWebSocket = (
  url: string,
  dispatch: (action: GameAction) => void,
): WebSocketHandle => {
  const wsRef = useRef<WebSocket | null>(null);

  const send = useCallback((msg: IKClientMessage): void => {
    const ws = wsRef.current;
    if (ws !== null && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }, []);

  useEffect(() => {
    let active = true;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.addEventListener("message", (event: MessageEvent) => {
      if (!active) return;
      const raw = typeof event.data === "string" ? event.data : String(event.data);
      const result = parseServerMessage<IKState, IKAction, LobbyState>(raw);
      if (!result.ok) return;
      const msg = result.value;
      if (msg.type === "welcome") saveIdentity(msg.token, msg.name);
      if (msg.type === "name_accepted") {
        const stored = loadIdentity();
        if (stored) saveIdentity(stored.token, msg.name);
      }
      dispatch({ _tag: "server_message", message: msg });
    });

    ws.addEventListener("open", () => {
      if (!active) return;
      const id = loadIdentity();
      const authMsg: Record<string, unknown> = { type: "auth" };
      if (id?.token) authMsg.token = id.token;
      if (id?.name) authMsg.name = id.name;
      ws.send(JSON.stringify(authMsg));
    });

    ws.addEventListener("close", () => {
      if (!active) return;
      dispatch({ _tag: "disconnected" });
    });

    return () => {
      active = false;
      ws.close();
    };
  }, [url, dispatch]);

  return { send };
};
