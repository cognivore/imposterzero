import { useRef, useEffect } from "react";
import { useGameReducer, detectLogEvents, type ClientPhase } from "./state.js";
import { useWebSocket } from "./ws-client.js";
import { useGameLogStore } from "./stores/game-log.js";
import { useDisgracedTracker } from "./stores/disgraced-tracker.js";
import { useSeenCardsTracker } from "./stores/seen-cards.js";
import { traceResolution, type TraceEntry } from "@imposter-zero/engine";
import { useOrientation } from "./hooks/useOrientation.js";
import { BrowserView } from "./views/BrowserView.js";
import { LobbyView } from "./views/LobbyView.js";
import { CrownView } from "./views/CrownView.js";
import { SetupView } from "./views/SetupView.js";
import { GameLayout } from "./views/GameLayout.js";
import { ScoringView } from "./views/ScoringView.js";
import { MatchOverView } from "./views/MatchOverView.js";
import { LandscapeOverlay } from "./views/LandscapeOverlay.js";

const wsUrl: string = __WS_URL__;

const absurd = (_: never): never => {
  throw new Error("non-exhaustive match");
};

const GAME_PHASES = new Set(["crown", "setup", "play", "resolving", "scoring", "finished"]);

const renderPhase = (
  phase: ClientPhase,
  send: ReturnType<typeof useWebSocket>["send"],
): React.ReactNode => {
  switch (phase._tag) {
    case "connecting":
      return <div className="center-screen">Connecting...</div>;
    case "browser":
      return <BrowserView phase={phase} send={send} />;
    case "lobby":
      return <LobbyView phase={phase} send={send} />;
    case "crown":
      return <CrownView phase={phase} send={send} />;
    case "setup":
    case "play":
    case "resolving":
      return <GameLayout phase={phase} send={send} />;
    case "scoring":
      return <ScoringView phase={phase} send={send} />;
    case "finished":
      return <MatchOverView phase={phase} send={send} />;
    default:
      return absurd(phase);
  }
};

const DEPTH_INDENT = "\u2003";

const traceEntryToLogEntry = (
  entry: TraceEntry,
  turnNumber: number,
): Omit<import("./stores/game-log.js").GameLogEntry, "id"> => ({
  turnNumber,
  playerName: "",
  playerIndex: -1,
  description: DEPTH_INDENT.repeat(entry.depth) + (entry.tag === "choice" ? "→ " : "") + entry.description,
  timestamp: Date.now(),
  kind: "trace",
});

const useGameLogSync = (phase: ClientPhase): void => {
  const prevPhaseRef = useRef<ClientPhase>(phase);
  const traceCountRef = useRef(0);

  useEffect(() => {
    const prev = prevPhaseRef.current;
    prevPhaseRef.current = phase;

    const store = useGameLogStore.getState();

    if (prev._tag !== "crown" && phase._tag === "crown") {
      store.clear();
      traceCountRef.current = 0;
      useDisgracedTracker.getState().clear();
      useSeenCardsTracker.getState().clear();
    }

    const events = detectLogEvents(prev, phase);
    for (const event of events) {
      store.addEntry({ ...event, timestamp: Date.now() });
    }

    const isResolving = phase._tag === "resolving" || phase._tag === "play";
    const wasResolving = prev._tag === "resolving";
    const gameState = isResolving && "gameState" in phase ? phase.gameState : null;
    const prevGameState = wasResolving && "gameState" in prev ? prev.gameState : null;

    try {
      if (wasResolving && phase._tag !== "resolving" && prevGameState?.pendingResolution) {
        const fullTrace = traceResolution(prevGameState, true);
        const newEntries = fullTrace.slice(traceCountRef.current);
        const turn = prevGameState.turnCount;
        for (const entry of newEntries) {
          store.addEntry(traceEntryToLogEntry(entry, turn));
        }
        traceCountRef.current = 0;
      } else if (phase._tag === "resolving" && gameState?.pendingResolution) {
        const currentTrace = traceResolution(gameState);
        const newEntries = currentTrace.slice(traceCountRef.current);
        const turn = gameState.turnCount;
        for (const entry of newEntries) {
          store.addEntry(traceEntryToLogEntry(entry, turn));
        }
        traceCountRef.current = currentTrace.length;
      }
    } catch {
      /* tracing must never crash the app */
    }
  }, [phase]);
};

export const App: React.FC = () => {
  const { phase, dispatch } = useGameReducer();
  const { send } = useWebSocket(wsUrl, dispatch);
  const { requiresLandscape } = useOrientation();

  useGameLogSync(phase);

  const showLandscapeOverlay = requiresLandscape && GAME_PHASES.has(phase._tag);

  return (
    <div className="app">
      {showLandscapeOverlay && <LandscapeOverlay />}
      <div
        className="phase-container"
        style={showLandscapeOverlay ? { display: "none" } : undefined}
      >
        {renderPhase(phase, send)}
      </div>
    </div>
  );
};
