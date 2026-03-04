import type { CardTier } from "./types.js";

interface Props {
  readonly value: number;
  readonly name: string;
  readonly tier: CardTier;
}

export const CardFront: React.FC<Props> = ({ value, name, tier }) => (
  <div className="card-face card-face--front">
    <span className={`card-value card-value--${tier}`}>{value}</span>
    <span className="card-name">{name}</span>
  </div>
);
