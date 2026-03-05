import { useSpring, animated } from "@react-spring/web";
import { usePreviewStore } from "../stores/preview.js";
import type { CardVisual } from "./card/types.js";

const PreviewCard: React.FC<{ readonly card: CardVisual }> = ({ card }) => {
  const { front } = card;
  return (
    <div className="preview-card">
      {front.artwork.full !== null && (
        <img
          className="preview-artwork-full"
          src={front.artwork.full}
          alt={front.name}
          loading="lazy"
        />
      )}
      <div className={`preview-value card-value--${front.tier}`}>
        {front.value}
      </div>
      <div className="preview-name">{front.name}</div>
      {(front.keywords?.length ?? 0) > 0 && (
        <div className="preview-keywords">
          {front.keywords.map((kw) => (
            <span key={kw} className="preview-keyword">
              {kw.replace(/_/g, " ")}
            </span>
          ))}
        </div>
      )}
      <div className="preview-divider" />
      <div className="preview-full-text">{front.fullText}</div>
      {(front.flavorText?.length ?? 0) > 0 && (
        <div className="preview-flavor">{front.flavorText}</div>
      )}
    </div>
  );
};

export const PreviewZone: React.FC = () => {
  const hoveredCard = usePreviewStore((s) => s.hoveredCard);

  const cardSpring = useSpring({
    opacity: hoveredCard !== null ? 1 : 0,
    scale: hoveredCard !== null ? 1 : 0.95,
    config: { tension: 600, friction: 30 },
  });

  return (
    <div className="preview-zone">
      {hoveredCard !== null ? (
        <animated.div
          style={{
            opacity: cardSpring.opacity,
            transform: cardSpring.scale.to((s) => `scale(${s})`),
          }}
        >
          <PreviewCard card={hoveredCard} />
        </animated.div>
      ) : (
        <div className="preview-placeholder">Hover a card to inspect</div>
      )}
    </div>
  );
};
