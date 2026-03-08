import { useRef, useEffect, useState, useCallback } from "react";
import { useGameLogStore } from "../stores/game-log.js";

export const LeftRail: React.FC<{ readonly turnCount: number }> = ({ turnCount }) => {
  const entries = useGameLogStore((s) => s.entries);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [hasNew, setHasNew] = useState(false);

  const isNearBottom = useCallback((): boolean => {
    const el = scrollRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (isNearBottom()) {
      el.scrollTop = el.scrollHeight;
      setHasNew(false);
    } else {
      setHasNew(true);
    }
  }, [entries.length, isNearBottom]);

  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
      setHasNew(false);
    }
  };

  const handleScroll = () => {
    if (isNearBottom()) setHasNew(false);
  };

  return (
    <div className="left-rail" role="log" aria-live="polite">
      <div className="left-rail__header">
        <span className="left-rail__title">
          Game Log{turnCount > 0 ? ` · T${turnCount}` : ""}
        </span>
      </div>
      <div className="left-rail__entries" ref={scrollRef} onScroll={handleScroll}>
        {entries.map((entry) => (
          <div
            key={entry.id}
            className={`left-rail__entry left-rail__entry--${entry.kind}`}
          >
            {entry.kind === "round_start" || entry.kind === "round_end" ? (
              <span className="left-rail__system">{entry.description}</span>
            ) : entry.kind === "trace" ? (
              <span className="left-rail__trace">{entry.description}</span>
            ) : entry.kind === "mustering" ? (
              entry.playerIndex === -1 ? (
                <span className="left-rail__system">{entry.description}</span>
              ) : (
                <>
                  <span className="left-rail__player">{entry.playerName}</span>
                  <span className="left-rail__desc">{entry.description}</span>
                </>
              )
            ) : (
              <>
                <span className="left-rail__turn">T{entry.turnNumber}</span>
                <span className="left-rail__player">{entry.playerName}</span>
                <span className="left-rail__desc">{entry.description}</span>
              </>
            )}
          </div>
        ))}
        {entries.length === 0 && (
          <div className="left-rail__empty">No actions yet</div>
        )}
      </div>
      <div
        className={`left-rail__new-indicator ${hasNew ? "left-rail__new-indicator--visible" : ""}`}
        onClick={scrollToBottom}
        role="button"
        tabIndex={hasNew ? 0 : -1}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") scrollToBottom();
        }}
      >
        ↓ New entries
      </div>
    </div>
  );
};
