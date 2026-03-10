import type { ClientPhase } from "../state.js";
import type { IKClientMessage } from "../ws-client.js";

type LobbyPhase = Extract<ClientPhase, { readonly _tag: "lobby" }>;

interface Props {
  readonly phase: LobbyPhase;
  readonly send: (msg: IKClientMessage) => void;
}

export const LobbyView: React.FC<Props> = ({ phase, send }) => {
  const { lobby, name } = phase;
  const isMeInLobby = lobby.players.some((p) => p.id === name);
  const amIReady = lobby.players.find((p) => p.id === name)?.ready ?? false;
  const isFull = lobby.players.length >= lobby.maxPlayers;
  const isHost = phase.hostId === name;

  const handleReady = () => send({ type: "ready", ready: !amIReady });
  const handleAddBot = () => send({ type: "add_bot" });
  const handleLeave = () => send({ type: "leave_room" });
  const handleTargetChange = (delta: number) => {
    const next = Math.min(99, Math.max(1, phase.targetScore + delta));
    if (next !== phase.targetScore) send({ type: "update_settings", targetScore: next });
  };

  const handleTournamentToggle = () => {
    send({ type: "update_settings", tournament: !phase.tournament });
  };

  return (
    <div className="lobby">
      <h1 className="lobby-title">Imposter Kings</h1>
      <p className="lobby-subtitle">A card game of deception and strategy</p>

      <div className="lobby-card">
        <div className="lobby-header">
          <h2>Lobby</h2>
          <span className="player-count">
            {lobby.players.length} / {phase.maxPlayers} players
          </span>
        </div>

        <div className="lobby-settings">
          <span className="setting-pill">{phase.maxPlayers} players max</span>
          {isHost ? (
            <>
              <div className="score-input-row compact">
                <span className="setting-label">First to</span>
                <button
                  className="btn btn-selector btn-sm"
                  onClick={() => handleTargetChange(-1)}
                  disabled={phase.targetScore <= 1}
                >
                  &minus;
                </button>
                <span className="score-value">{phase.targetScore}</span>
                <button
                  className="btn btn-selector btn-sm"
                  onClick={() => handleTargetChange(1)}
                  disabled={phase.targetScore >= 99}
                >
                  +
                </button>
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={phase.tournament}
                  onChange={handleTournamentToggle}
                  style={{ width: 16, height: 16 }}
                />
                <span className="setting-label">Tournament Draft</span>
              </label>
            </>
          ) : (
            <>
              <span className="setting-pill">First to {phase.targetScore}</span>
              <span className="setting-pill">{phase.tournament ? "Tournament" : "Standard"} Draft</span>
            </>
          )}
        </div>

        <ul className="player-list">
          {lobby.players.map((p) => (
            <li key={p.id} className={`player-entry ${p.id === name ? "is-me" : ""}`}>
              <span className="player-name">
                {p.id === name ? `${p.id} (you)` : p.id}
                {p.id === phase.hostId && <span className="host-badge">host</span>}
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
          {isMeInLobby && (
            <button
              className={`btn ${amIReady ? "btn-secondary" : "btn-primary"}`}
              onClick={handleReady}
            >
              {amIReady ? "Unready" : "Ready"}
            </button>
          )}
          {isHost && (
            <button
              className="btn btn-ghost"
              onClick={handleAddBot}
              disabled={isFull}
              title={isFull ? "Lobby is full" : "Add a bot player"}
            >
              + Add Bot
            </button>
          )}
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
