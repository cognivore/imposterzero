import type { CardVisual, SlotKind } from "./types.js";
import { Card } from "./Card.js";

interface SetupSlotProps {
  readonly kind: SlotKind;
  readonly card: CardVisual | null;
  readonly onClick?: () => void;
}

const CrownIcon: React.FC = () => (
  <svg className="setup-slot__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M2 20h20M4 15l4-9 4 4 4-4 4 9" />
  </svg>
);

const ChainIcon: React.FC = () => (
  <svg className="setup-slot__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </svg>
);

const ShieldIcon: React.FC = () => (
  <svg className="setup-slot__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
);

export const SetupSlot: React.FC<SetupSlotProps> = ({ kind, card, onClick }) => {
  const filled = card !== null;
  const slotClass = [
    "setup-slot",
    `setup-slot--${kind}`,
    filled && "setup-slot--filled",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={slotClass}>
      <span className="setup-slot__label">
        {kind === "successor" ? "SUCCESSOR" : kind === "dungeon" ? "DUNGEON" : "SQUIRE"}
      </span>
      {card !== null ? (
        <Card visual={card} orientation="front" interactive selected {...(onClick ? { onClick } : {})} />
      ) : (
        <div className="setup-slot__empty">
          {kind === "successor" ? <CrownIcon /> : kind === "dungeon" ? <ChainIcon /> : <ShieldIcon />}
        </div>
      )}
    </div>
  );
};
