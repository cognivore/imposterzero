import { useRef, useEffect } from "react";
import { useSpring, animated } from "@react-spring/web";
import { useGameLogStore } from "../stores/game-log.js";

export const GameLogPanel: React.FC = () => {
  const entries = useGameLogStore((s) => s.entries);
  const isOpen = useGameLogStore((s) => s.isOpen);
  const toggle = useGameLogStore((s) => s.toggle);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { x } = useSpring({
    x: isOpen ? 0 : 280,
    config: { tension: 450, friction: 32 },
  });

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries.length]);

  return (
    <>
      <button className="game-log-toggle" onClick={toggle}>
        {isOpen ? "\u2715" : "Log"}
      </button>
      <animated.div
        className="game-log-panel"
        style={{ transform: x.to((v) => `translateX(${v}px)`) }}
      >
        <div className="game-log-header">
          <h3>Game Log</h3>
        </div>
        <div className="game-log-entries" ref={scrollRef}>
          {entries.map((entry) => (
            <div
              key={entry.id}
              className={`game-log-entry game-log-entry--${entry.kind}`}
            >
              {entry.kind === "round_start" || entry.kind === "round_end" ? (
                <span className="game-log-system">{entry.description}</span>
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
      </animated.div>
    </>
  );
};
