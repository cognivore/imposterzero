import type { IKCard } from "@imposter-zero/engine";

interface Props {
  readonly card: IKCard;
  readonly faceDown?: boolean;
  readonly selected?: boolean;
  readonly dimmed?: boolean;
  readonly disabled?: boolean;
  readonly small?: boolean;
  readonly onClick?: () => void;
}

const valueColor = (value: number): string => {
  if (value <= 2) return "card-val-low";
  if (value <= 5) return "card-val-mid";
  if (value <= 7) return "card-val-high";
  return "card-val-elite";
};

export const CardComponent: React.FC<Props> = ({
  card,
  faceDown = false,
  selected = false,
  dimmed = false,
  disabled = false,
  small = false,
  onClick,
}) => {
  const classes = [
    "card",
    faceDown ? "card-back" : "card-front",
    selected && "card-selected",
    dimmed && "card-dimmed",
    disabled && "card-disabled",
    small && "card-small",
    !faceDown && valueColor(card.kind.props.value),
  ]
    .filter(Boolean)
    .join(" ");

  const label = faceDown ? "face-down card" : `${card.kind.name} (${card.kind.props.value})`;
  const interactive = onClick !== undefined && !disabled;

  return (
    <div
      className={classes}
      onClick={interactive ? onClick : undefined}
      role={interactive ? "button" : undefined}
      aria-label={label}
      tabIndex={interactive ? 0 : undefined}
    >
      {faceDown ? (
        <div className="card-back-pattern" />
      ) : (
        <>
          <div className="card-value">{card.kind.props.value}</div>
          <div className="card-name">{card.kind.name}</div>
        </>
      )}
    </div>
  );
};

interface CardBackProps {
  readonly count?: number;
  readonly small?: boolean;
}

export const CardBack: React.FC<CardBackProps> = ({ count = 1, small = false }) => (
  <div className={`card-stack ${small ? "card-small" : ""}`}>
    <div className="card card-back">
      <div className="card-back-pattern" />
    </div>
    {count > 1 && <span className="card-stack-count">{count}</span>}
  </div>
);
