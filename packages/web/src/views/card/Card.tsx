import { useSpring, animated, to } from "@react-spring/web";
import { useHover } from "@use-gesture/react";
import type { CardVisual, CardOrientation } from "./types.js";
import { CardFront } from "./CardFront.js";
import { CardBack } from "./CardBack.js";
import { usePreviewStore, type PreviewSource } from "../../stores/preview.js";

interface CardProps {
  readonly visual: CardVisual;
  readonly orientation: CardOrientation;
  readonly size?: "normal" | "small" | "micro";
  readonly interactive?: boolean;
  readonly selected?: boolean;
  readonly dimmed?: boolean;
  readonly veiled?: boolean;
  readonly previewSource?: PreviewSource;
  /** Show preview on hover even when orientation is "back" (e.g. player's own Successor/Dungeon) */
  readonly forcePreview?: boolean;
  readonly onClick?: () => void;
}

export const Card: React.FC<CardProps> = ({
  visual,
  orientation,
  size = "normal",
  interactive = false,
  selected = false,
  dimmed = false,
  veiled = false,
  previewSource = null,
  forcePreview = false,
  onClick,
}) => {
  const setHovered = usePreviewStore((s) => s.setHovered);

  const flipSpring = useSpring({
    rotateY: orientation === "front" ? 0 : 180,
    config: { tension: 500, friction: 38, mass: 0.8 },
  });

  const selectionSpring = useSpring({
    scale: selected ? 1.05 : 1,
    glow: selected ? 1 : 0,
    config: { tension: 420, friction: 22 },
  });

  const [hoverSpring, hoverApi] = useSpring(() => ({
    y: 0,
    shadow: 0,
    tiltX: 0,
    config: { tension: 500, friction: 26, mass: 0.3 },
  }));

  const bind = useHover(({ hovering }) => {
    if (!interactive && !previewSource) return;
    if (dimmed) return;
    if (interactive) {
      hoverApi.start({
        y: hovering ? -8 : 0,
        shadow: hovering ? 16 : 0,
        tiltX: hovering ? -2 : 0,
      });
    }
    if (previewSource && (orientation === "front" || forcePreview)) {
      setHovered(hovering ? visual : null, hovering ? previewSource : null);
    }
  });

  const perspectiveClass = [
    "card-perspective",
    size === "small" && "card-perspective--small",
    size === "micro" && "card-perspective--micro",
    dimmed && "card-perspective--dimmed",
    veiled && "card-perspective--veiled",
    selected && "card-perspective--selected",
    interactive && "card-perspective--interactive",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <animated.div
      {...bind()}
      className={perspectiveClass}
      style={{
        transform: to(
          [hoverSpring.y, hoverSpring.tiltX],
          (y, tilt) => `translateY(${y}px) rotateX(${tilt}deg)`,
        ),
        boxShadow: hoverSpring.shadow.to(
          (s) => `0 ${s}px ${s * 1.5}px rgba(0,0,0,0.3)`,
        ),
      }}
      onClick={interactive ? onClick : undefined}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
    >
      <animated.div
        className="card-body"
        style={{
          transform: to(
            [flipSpring.rotateY, selectionSpring.scale],
            (ry, sc) => `rotateY(${ry}deg) scale(${sc})`,
          ),
          boxShadow: selectionSpring.glow.to(
            (g) => `0 0 0 ${g * 3}px rgba(109, 191, 139, ${g * 0.8})`,
          ),
        }}
      >
        <CardFront
          value={visual.front.value}
          name={visual.front.name}
          tier={visual.front.tier}
          shortText={visual.front.shortText}
          artwork={visual.front.artwork}
          showContent={size === "normal"}
          alt={`${visual.front.name}, value ${visual.front.value}`}
        />
        <CardBack design={visual.back.design} />
      </animated.div>
    </animated.div>
  );
};
