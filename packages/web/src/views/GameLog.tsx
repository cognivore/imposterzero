/**
 * Legacy GameLogPanel — kept for backward compatibility with old views.
 * The new editorial layout uses LeftRail instead.
 */
import { useRef, useEffect } from "react";
import { useGameLogStore } from "../stores/game-log.js";

export const GameLogPanel: React.FC = () => {
  const entries = useGameLogStore((s) => s.entries);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries.length]);

  return (
    <div className="game-log-panel" style={{ position: "static", width: "100%", height: "auto", boxShadow: "none" }}>
      <div className="game-log-header">
        <span style={{ fontSize: "0.9rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Game Log
        </span>
      </div>
      <div className="game-log-entries" ref={scrollRef}>
        {entries.map((entry) => (
          <div
            key={entry.id}
            className={`game-log-entry game-log-entry--${entry.kind}`}
          >
            {entry.kind === "round_start" || entry.kind === "round_end" ? (
              <span className="game-log-system">{entry.description}</span>
            ) : entry.kind === "trace" ? (
              <span className="left-rail__trace">{entry.description}</span>
            ) : (
              <>
                <span className="game-log-turn">T{entry.turnNumber}</span>
                <span className="game-log-player">{entry.playerName}</span>
                <span className="game-log-desc">{entry.description}</span>
              </>
            )}
          </div>
        ))}
        {entries.length === 0 && (
          <div className="game-log-empty">No actions yet</div>
        )}
      </div>
    </div>
  );
};
