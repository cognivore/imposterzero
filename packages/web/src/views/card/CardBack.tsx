import type { CardBackDesign } from "./types.js";

interface Props {
  readonly design: CardBackDesign;
}

export const CardBack: React.FC<Props> = ({ design: _design }) => (
  <div className="card-face card-face--back">
    <div className="card-back-ornament" />
  </div>
);
