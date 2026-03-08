import { useState, useEffect, useRef } from "react";

interface Props {
  readonly turnDeadline: number;
  readonly isMyTurn: boolean;
}

const formatTime = (ms: number): string => {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return min > 0 ? `${min}:${String(sec).padStart(2, "0")}` : String(sec);
};

export const CountdownTimer: React.FC<Props> = ({ turnDeadline, isMyTurn }) => {
  const [remaining, setRemaining] = useState(() => turnDeadline - Date.now());
  const startRef = useRef(turnDeadline);
  const totalRef = useRef(turnDeadline - Date.now());

  useEffect(() => {
    startRef.current = turnDeadline;
    totalRef.current = Math.max(1, turnDeadline - Date.now());
  }, [turnDeadline]);

  useEffect(() => {
    let raf: number;
    const tick = () => {
      setRemaining(startRef.current - Date.now());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const ms = Math.max(0, remaining);
  const fraction = Math.min(1, ms / totalRef.current);
  const urgent = ms < 10_000;
  const expired = ms <= 0;

  const barClass = [
    "countdown-timer__bar",
    isMyTurn ? "countdown-timer__bar--mine" : "countdown-timer__bar--theirs",
    urgent && !expired ? "countdown-timer__bar--urgent" : "",
    expired ? "countdown-timer__bar--expired" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={`countdown-timer ${isMyTurn ? "" : "countdown-timer--dim"}`}>
      <div className="countdown-timer__track">
        <div
          className={barClass}
          style={{ width: `${fraction * 100}%` }}
        />
      </div>
      <span className={`countdown-timer__label ${urgent && !expired ? "countdown-timer__label--urgent" : ""}`}>
        {formatTime(ms)}
      </span>
    </div>
  );
};
