import { useGameReducer, type ClientPhase } from "./state.js";
import { useWebSocket } from "./ws-client.js";
import { BrowserView } from "./views/BrowserView.js";
import { LobbyView } from "./views/LobbyView.js";
import { SetupView } from "./views/SetupView.js";
import { PlayView } from "./views/PlayView.js";
import { ScoringView } from "./views/ScoringView.js";
import { MatchOverView } from "./views/MatchOverView.js";

const wsUrl: string = __WS_URL__;

const absurd = (_: never): never => {
  throw new Error("non-exhaustive match");
};

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
    case "setup":
      return <SetupView phase={phase} send={send} />;
    case "play":
      return <PlayView phase={phase} send={send} />;
    case "scoring":
      return <ScoringView phase={phase} />;
    case "finished":
      return <MatchOverView phase={phase} send={send} />;
    default:
      return absurd(phase);
  }
};

export const App: React.FC = () => {
  const { phase, dispatch } = useGameReducer();
  const { send } = useWebSocket(wsUrl, dispatch);

  return <div className="app">{renderPhase(phase, send)}</div>;
};
