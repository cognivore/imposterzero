import type { PlayerId } from "@imposter-zero/types";
import type { IKPlayerZones } from "@imposter-zero/engine";
import { Card } from "./card/Card.js";
import { toCardVisual, ANONYMOUS_CARD } from "./card/types.js";

interface Props {
  readonly opponentIndex: PlayerId;
  readonly zones: IKPlayerZones;
  readonly name: string;
  readonly isActive: boolean;
  readonly handHelperCards?: readonly string[] | null;
}

export const OpponentPanel: React.FC<Props> = ({
  opponentIndex,
  zones,
  name,
  isActive,
  handHelperCards,
}) => (
  <div
    className={`opponent-panel ${isActive ? "opponent-panel--active" : ""}`}
    aria-label={`${name}'s zones`}
  >
    <div className="opponent-panel__name">
      {name}
      {isActive && <span className="opponent-panel__acting"> (acting)</span>}
    </div>

    <div className="opponent-panel__zones">
      <div className="opponent-panel__zone">
        <span className="zone-label">K</span>
        <Card
          visual={toCardVisual(zones.king.card)}
          orientation={zones.king.face === "up" ? "front" : "back"}
          size="micro"
          previewSource="opponent"
        />
      </div>

      <div className="opponent-panel__zone">
        <span className="zone-label">S</span>
        {zones.successor !== null ? (
          <Card visual={ANONYMOUS_CARD} orientation="back" size="micro" />
        ) : (
          <div
            className="player-zone-slot__placeholder"
            style={{
              width: "var(--card-micro-width)",
              height: "var(--card-micro-height)",
              borderWidth: "1px",
            }}
          />
        )}
      </div>

      <div className="opponent-panel__zone">
        <span className="zone-label">D</span>
        {zones.dungeon !== null ? (
          <Card visual={ANONYMOUS_CARD} orientation="back" size="micro" />
        ) : (
          <div
            className="player-zone-slot__placeholder"
            style={{
              width: "var(--card-micro-width)",
              height: "var(--card-micro-height)",
              borderWidth: "1px",
            }}
          />
        )}
      </div>
    </div>

    <div className="opponent-panel__hand">
      {handHelperCards == null ? (
        <>
          <Card visual={ANONYMOUS_CARD} orientation="back" size="micro" />
          {zones.hand.length > 0 && (
            <span className="opponent-panel__hand-count">{zones.hand.length}</span>
          )}
        </>
      ) : (
        <HandHelperInline count={zones.hand.length} possibleCards={handHelperCards} />
      )}
    </div>
  </div>
);

const HandHelperInline: React.FC<{
  readonly count: number;
  readonly possibleCards: readonly string[];
}> = ({ count, possibleCards }) => (
  <div className="hand-helper">
    <div className="hand-helper__count">
      <span className="hand-helper__number">{count}</span>
      <span className="hand-helper__label">cards in hand</span>
    </div>
    {possibleCards.length > 0 && (
      <>
        <div className="hand-helper__possible-label">Possible:</div>
        <div className="hand-helper__cards">
          {possibleCards.map((cardName) => (
            <span
              key={cardName}
              className="hand-helper__card-wrapper"
              style={{
                fontSize: "0.5rem",
                color: "var(--text-dim)",
                background: "var(--surface-raised)",
                borderRadius: "2px",
                padding: "1px 3px",
                opacity: 0.5,
              }}
            >
              {cardName}
            </span>
          ))}
        </div>
      </>
    )}
  </div>
);
