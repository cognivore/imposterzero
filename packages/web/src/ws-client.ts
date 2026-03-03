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
      if (result.ok) {
        dispatch({ _tag: "server_message", message: result.value });
      }
    });

    ws.addEventListener("open", () => {
      if (!active) return;
      dispatch({ _tag: "connected" });
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
