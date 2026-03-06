import { useState, useRef, useCallback } from "react";
import { useSpring, animated, to } from "@react-spring/web";
import type { CardVisual } from "./types.js";
import { CardFront } from "./CardFront.js";
import { CardBack } from "./CardBack.js";
import { usePreviewStore } from "../../stores/preview.js";
import { useTouchDevice } from "../../hooks/useTouchDevice.js";

interface Props {
  readonly visual: CardVisual;
  readonly size?: "normal" | "small" | "micro";
}

const PEEK_DELAY_MS = 200;
const LONG_PRESS_MS = 300;

export const DisgracedCard: React.FC<Props> = ({ visual, size = "small" }) => {
  const [isPeeking, setIsPeeking] = useState(false);
  const setHovered = usePreviewStore((s) => s.setHovered);
  const isTouch = useTouchDevice();
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flipSpring = useSpring({
    rotateY: isPeeking ? 0 : 180,
    config: { tension: 400, friction: 26 },
  });

  const startPeek = useCallback(() => {
    setIsPeeking(true);
    setHovered(visual, "court");
  }, [visual, setHovered]);

  const stopPeek = useCallback(() => {
    setIsPeeking(false);
    setHovered(null, null);
  }, [setHovered]);

  const handleMouseEnter = () => {
    if (isTouch) return;
    hoverTimerRef.current = setTimeout(startPeek, PEEK_DELAY_MS);
  };

  const handleMouseLeave = () => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    stopPeek();
  };

  const handleTouchStart = () => {
    touchTimerRef.current = setTimeout(startPeek, LONG_PRESS_MS);
  };

  const handleTouchEnd = () => {
    if (touchTimerRef.current) {
      clearTimeout(touchTimerRef.current);
      touchTimerRef.current = null;
    }
    stopPeek();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      setIsPeeking((prev) => !prev);
      if (!isPeeking) {
        setHovered(visual, "court");
      } else {
        setHovered(null, null);
      }
    }
  };

  const sizeClass =
    size === "small"
      ? "card-perspective card-perspective--small"
      : size === "micro"
        ? "card-perspective card-perspective--micro"
        : "card-perspective";

  return (
    <div
      className={isPeeking ? "disgraced-card--peeking" : undefined}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
    >
      <div
        className={sizeClass}
        tabIndex={0}
        role="button"
        aria-label={`Disgraced card: ${visual.front.name}. Press space to peek.`}
        onKeyDown={handleKeyDown}
      >
        <animated.div
          className="card-body"
          style={{
            transform: flipSpring.rotateY.to((ry) => `rotateY(${ry}deg)`),
          }}
        >
          <CardFront
            value={visual.front.value}
            name={visual.front.name}
            tier={visual.front.tier}
            shortText={visual.front.shortText}
            artwork={visual.front.artwork}
            showContent={size === "normal"}
          />
          <CardBack design={visual.back.design} />
        </animated.div>
      </div>
    </div>
  );
};
