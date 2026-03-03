import { useState } from "react";
import type { ClientPhase } from "../state.js";
import type { IKClientMessage } from "../ws-client.js";

type BrowserPhase = Extract<ClientPhase, { readonly _tag: "browser" }>;

interface Props {
  readonly phase: BrowserPhase;
  readonly send: (msg: IKClientMessage) => void;
}

const PLAYER_OPTIONS = [2, 3, 4] as const;
const DEFAULT_TARGET = 7;

export const BrowserView: React.FC<Props> = ({ phase, send }) => {
  const [maxPlayers, setMaxPlayers] = useState<number>(4);
  const [targetScore, setTargetScore] = useState<number>(DEFAULT_TARGET);

  const handleCreate = () => {
    send({ type: "create_room", maxPlayers, targetScore });
  };

  const handleJoin = (roomId: string) => {
    send({ type: "join_room", roomId });
  };

  const handleRefresh = () => {
    send({ type: "list_rooms" });
  };

  const joinableRooms = phase.rooms.filter((r) => r.phase === "lobby" && r.playerCount < r.maxPlayers);
  const activeRooms = phase.rooms.filter((r) => r.phase !== "lobby" || r.playerCount >= r.maxPlayers);

  return (
    <div className="browser">
      <h1 className="browser-title">Imposter Kings</h1>
      <p className="browser-subtitle">A card game of deception and strategy</p>

      <div className="browser-layout">
        <div className="browser-card create-card">
          <h2>Create Room</h2>

          <div className="create-field">
            <label className="create-label">Players</label>
            <div className="player-selector">
              {PLAYER_OPTIONS.map((n) => (
                <button
                  key={n}
                  className={`btn btn-selector ${maxPlayers === n ? "selected" : ""}`}
                  onClick={() => setMaxPlayers(n)}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          <div className="create-field">
            <label className="create-label">Play to</label>
            <div className="score-input-row">
              <button
                className="btn btn-selector"
                onClick={() => setTargetScore((s) => Math.max(1, s - 1))}
                disabled={targetScore <= 1}
              >
                &minus;
              </button>
              <span className="score-value">{targetScore}</span>
              <button
                className="btn btn-selector"
                onClick={() => setTargetScore((s) => Math.min(99, s + 1))}
                disabled={targetScore >= 99}
              >
                +
              </button>
            </div>
          </div>

          <button className="btn btn-primary btn-large create-btn" onClick={handleCreate}>
            Create Room
          </button>
        </div>

        <div className="browser-card rooms-card">
          <div className="rooms-header">
            <h2>Open Rooms</h2>
            <button className="btn btn-ghost" onClick={handleRefresh}>
              Refresh
            </button>
          </div>

          {joinableRooms.length === 0 && activeRooms.length === 0 && (
            <p className="rooms-empty">No rooms yet. Create one to get started!</p>
          )}

          {joinableRooms.length > 0 && (
            <ul className="room-list">
              {joinableRooms.map((room) => (
                <li key={room.id} className="room-entry">
                  <div className="room-info">
                    <span className="room-id">Room {room.id}</span>
                    <span className="room-meta">
                      {room.playerCount}/{room.maxPlayers} players &middot; first to {room.targetScore}
                    </span>
                  </div>
                  <button className="btn btn-primary" onClick={() => handleJoin(room.id)}>
                    Join
                  </button>
                </li>
              ))}
            </ul>
          )}

          {activeRooms.length > 0 && (
            <>
              <h3 className="rooms-section-label">In Progress</h3>
              <ul className="room-list">
                {activeRooms.map((room) => (
                  <li key={room.id} className="room-entry room-active">
                    <div className="room-info">
                      <span className="room-id">Room {room.id}</span>
                      <span className="room-meta">
                        {room.playerCount}/{room.maxPlayers} players &middot; {room.phase}
                      </span>
                    </div>
                    <span className="room-status-badge">{room.phase}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>

      <p className="browser-footer">Signed in as <strong>{phase.me}</strong></p>
    </div>
  );
};
