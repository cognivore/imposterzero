import type { CardVisual } from "./card/types.js";

interface CardInspectModalProps {
  readonly card: CardVisual;
  readonly canPlay: boolean;
  readonly onPlay: (() => void) | null;
  readonly onClose: () => void;
}

export const CardInspectModal: React.FC<CardInspectModalProps> = ({
  card,
  canPlay,
  onPlay,
  onClose,
}) => {
  const { front } = card;

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div className="inspect-modal-backdrop" onClick={handleBackdropClick}>
      <div className="inspect-modal-card">
        {front.artwork.full !== null && (
          <img
            className="inspect-modal-artwork"
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
      <div className="inspect-modal-actions">
        {canPlay && onPlay !== null && (
          <button className="btn btn-primary" onClick={onPlay}>
            Play
          </button>
        )}
        <button className="btn btn-secondary" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
};
