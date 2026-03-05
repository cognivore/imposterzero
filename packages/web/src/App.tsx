import { useRef, useEffect } from "react";
import { useGameReducer, detectLogEvents, type ClientPhase } from "./state.js";
import { useWebSocket } from "./ws-client.js";
import { useGameLogStore } from "./stores/game-log.js";
import { useOrientation } from "./hooks/useOrientation.js";
import { BrowserView } from "./views/BrowserView.js";
import { LobbyView } from "./views/LobbyView.js";
import { CrownView } from "./views/CrownView.js";
import { SetupView } from "./views/SetupView.js";
import { PlayView } from "./views/PlayView.js";
import { ResolvingView } from "./views/ResolvingView.js";
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
      return <SetupView phase={phase} send={send} />;
    case "play":
      return <PlayView phase={phase} send={send} />;
    case "resolving":
      return <ResolvingView phase={phase} send={send} />;
    case "scoring":
      return <ScoringView phase={phase} send={send} />;
    case "finished":
      return <MatchOverView phase={phase} send={send} />;
    default:
      return absurd(phase);
  }
};

const useGameLogSync = (phase: ClientPhase): void => {
  const prevPhaseRef = useRef<ClientPhase>(phase);

  useEffect(() => {
    const prev = prevPhaseRef.current;
    prevPhaseRef.current = phase;

    const store = useGameLogStore.getState();

    if (prev._tag !== "crown" && phase._tag === "crown") {
      store.clear();
    }

    const events = detectLogEvents(prev, phase);
    for (const event of events) {
      store.addEntry({ ...event, timestamp: Date.now() });
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
        key={phase._tag}
        className="phase-container"
        style={showLandscapeOverlay ? { display: "none" } : undefined}
      >
        {renderPhase(phase, send)}
      </div>
    </div>
  );
};
