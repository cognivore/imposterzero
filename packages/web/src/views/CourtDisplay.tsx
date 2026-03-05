import type { CourtEntry } from "@imposter-zero/engine";
import { Card } from "./card/Card.js";
import { toCardVisual } from "./card/types.js";

interface Props {
  readonly court: ReadonlyArray<CourtEntry>;
  readonly playerNames: ReadonlyArray<string>;
  readonly throneValue: number;
}

export const CourtDisplay: React.FC<Props> = ({ court, playerNames, throneValue }) => (
  <div className="court-display">
    <div className="court-header">
      <span className="court-label">Court</span>
      <span className="throne-value">Throne: {throneValue}</span>
    </div>
    {court.length === 0 ? (
      <div className="court-empty">Empty court</div>
    ) : (
      <div className="court-stack">
        {court.map((entry, idx) => (
          <div
            key={`court-${entry.card.id}-${idx}`}
            className={`court-entry ${idx === court.length - 1 ? "court-entry--top" : ""}`}
            style={{
              transform: `translateY(${Math.min(idx, 8) * 4}px)`,
              zIndex: idx,
            }}
          >
            <Card
              visual={toCardVisual(entry.card)}
              orientation={entry.face === "up" ? "front" : "back"}
              size="small"
              previewSource="court"
            />
          </div>
        ))}
      </div>
    )}
  </div>
);
