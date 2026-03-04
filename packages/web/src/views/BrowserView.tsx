import { useState } from "react";
import type { ClientPhase } from "../state.js";
import type { IKClientMessage } from "../ws-client.js";
import { saveIdentity, clearIdentity } from "../ws-client.js";
import { hexToBase58, base58ToHex } from "../base58.js";

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
  const [nameInput, setNameInput] = useState<string>("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [importKey, setImportKey] = useState<string>("");
  const [importError, setImportError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const hasName = phase.name !== null;
  const backupKey = hexToBase58(phase.token);

  const handleSetName = () => {
    const trimmed = nameInput.trim();
    if (trimmed.length < 1 || trimmed.length > 20) {
      setNameError("Name must be 1-20 characters");
      return;
    }
    setNameError(null);
    send({ type: "set_name", name: trimmed });
  };

  const handleCreate = () => {
    send({ type: "create_room", maxPlayers, targetScore });
  };

  const handleJoin = (roomId: string) => {
    send({ type: "join_room", roomId });
  };

  const handleRefresh = () => {
    send({ type: "list_rooms" });
  };

  const handleCopyKey = () => {
    navigator.clipboard.writeText(backupKey).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleImportKey = () => {
    try {
      const hex = base58ToHex(importKey.trim());
      if (hex.length !== 32) throw new Error("bad length");
      saveIdentity(hex, null);
      clearIdentity();
      saveIdentity(hex, null);
      window.location.reload();
    } catch {
      setImportError("Invalid key");
    }
  };

  const joinableRooms = phase.rooms.filter((r) => r.phase === "lobby" && r.playerCount < r.maxPlayers);
  const activeRooms = phase.rooms.filter((r) => r.phase !== "lobby" || r.playerCount >= r.maxPlayers);

  return (
    <div className="browser">
      <h1 className="browser-title">Imposter Kings</h1>
      <p className="browser-subtitle">A card game of deception and strategy</p>

      {!hasName && (
        <div className="browser-card name-card">
          <h2>Choose Your Name</h2>
          <div className="name-input-row">
            <input
              className="name-input"
              type="text"
              placeholder="Enter a unique name..."
              maxLength={20}
              value={nameInput}
              onChange={(e) => { setNameInput(e.target.value); setNameError(null); }}
              onKeyDown={(e) => { if (e.key === "Enter") handleSetName(); }}
            />
            <button
              className="btn btn-primary"
              onClick={handleSetName}
              disabled={nameInput.trim().length === 0}
            >
              Set Name
            </button>
          </div>
          {nameError && <p className="name-error">{nameError}</p>}
          {phase.lastError && <p className="name-error">{phase.lastError}</p>}
        </div>
      )}

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

          <button
            className="btn btn-primary btn-large create-btn"
            onClick={handleCreate}
            disabled={!hasName}
            title={hasName ? undefined : "Set your name first"}
          >
            Create Room
          </button>
          {hasName && phase.lastError && <p className="name-error">{phase.lastError}</p>}
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
                  <button
                    className="btn btn-primary"
                    onClick={() => handleJoin(room.id)}
                    disabled={!hasName}
                    title={hasName ? undefined : "Set your name first"}
                  >
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

      <div className="browser-footer">
        {hasName
          ? <p>Playing as <strong>{phase.name}</strong></p>
          : <p>Connected as <strong>{phase.me}</strong></p>
        }
        <div className="backup-section">
          <span className="backup-label">Your key:</span>
          <code className="backup-key">{backupKey}</code>
          <button className="btn btn-ghost btn-copy" onClick={handleCopyKey}>
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
        <details className="import-section">
          <summary>Import key</summary>
          <div className="import-row">
            <input
              className="name-input"
              type="text"
              placeholder="Paste base58 key..."
              value={importKey}
              onChange={(e) => { setImportKey(e.target.value); setImportError(null); }}
              onKeyDown={(e) => { if (e.key === "Enter") handleImportKey(); }}
            />
            <button
              className="btn btn-secondary"
              onClick={handleImportKey}
              disabled={importKey.trim().length === 0}
            >
              Import
            </button>
          </div>
          {importError && <p className="name-error">{importError}</p>}
        </details>
      </div>
    </div>
  );
};
