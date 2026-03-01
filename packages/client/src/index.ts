import type { ClientMessage, ServerMessage } from "@imposter-zero/types";
import type { ActionSelector } from "@imposter-zero/engine";

/**
 * Placeholder — game client will live here.
 * Responsibilities:
 *   - Connect to server over WebSocket
 *   - Render game state
 *   - Collect player input and send actions
 */
export type ClientConfig = {
  readonly serverUrl: string;
};

export type { ClientMessage, ServerMessage, ActionSelector };
