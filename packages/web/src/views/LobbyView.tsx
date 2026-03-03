import type { ClientPhase } from "../state.js";
import type { IKClientMessage } from "../ws-client.js";

type LobbyPhase = Extract<ClientPhase, { readonly _tag: "lobby" }>;

interface Props {
  readonly phase: LobbyPhase;
  readonly send: (msg: IKClientMessage) => void;
}

export const LobbyView: React.FC<Props> = ({ phase, send }) => {
  const { lobby, me } = phase;
  const isMeInLobby = lobby.players.some((p) => p.id === me);
  const amIReady = lobby.players.find((p) => p.id === me)?.ready ?? false;
  const isFull = lobby.players.length >= lobby.maxPlayers;

  const handleJoin = () => send({ type: "join", gameId: "default" });
  const handleReady = () => send({ type: "ready", ready: !amIReady });
  const handleAddBot = () => send({ type: "add_bot" });
  const handleLeave = () => send({ type: "leave_room" });

  return (
    <div className="lobby">
      <h1 className="lobby-title">Imposter Kings</h1>
      <p className="lobby-subtitle">A card game of deception and strategy</p>

      <div className="lobby-card">
        <div className="lobby-header">
          <h2>Lobby</h2>
          <span className="player-count">
            {lobby.players.length} / {lobby.maxPlayers} players
          </span>
        </div>

        <div className="lobby-settings">
          <span className="setting-pill">First to {phase.lobby.maxPlayers} players max</span>
        </div>

        <ul className="player-list">
          {lobby.players.map((p) => (
            <li key={p.id} className={`player-entry ${p.id === me ? "is-me" : ""}`}>
              <span className="player-name">
                {p.id === me ? `${p.id} (you)` : p.id}
              </span>
              <span className={`ready-badge ${p.ready ? "ready" : "not-ready"}`}>
                {p.ready ? "Ready" : "Waiting"}
              </span>
            </li>
          ))}
          {lobby.players.length === 0 && (
            <li className="player-entry empty">No players yet</li>
          )}
        </ul>

        <div className="lobby-actions">
          {!isMeInLobby && (
            <button className="btn btn-primary" onClick={handleJoin}>
              Join Game
            </button>
          )}
          {isMeInLobby && (
            <button
              className={`btn ${amIReady ? "btn-secondary" : "btn-primary"}`}
              onClick={handleReady}
            >
              {amIReady ? "Unready" : "Ready"}
            </button>
          )}
          <button
            className="btn btn-ghost"
            onClick={handleAddBot}
            disabled={isFull}
            title={isFull ? "Lobby is full" : "Add a bot player"}
          >
            + Add Bot
          </button>
          <button className="btn btn-danger" onClick={handleLeave}>
            Leave Room
          </button>
        </div>

        <p className="lobby-hint">
          {lobby.players.length < lobby.minPlayers
            ? `Need at least ${lobby.minPlayers} players to start`
            : "All players must be ready to begin"}
        </p>
      </div>
    </div>
  );
};
