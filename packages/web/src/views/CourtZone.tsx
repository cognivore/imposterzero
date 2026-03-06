import type { PlayerId } from "@imposter-zero/types";
import type { CourtEntry, IKEffectChoiceAction, IKState, IKCard, HiddenCard } from "@imposter-zero/engine";
import type { IKClientMessage } from "../ws-client.js";
import { Card } from "./card/Card.js";
import { DisgracedCard } from "./card/DisgracedCard.js";
import { toCardVisual } from "./card/types.js";
import { InlineChoiceBar } from "./InlineChoiceBar.js";

const PLAYER_COLORS = [
  "var(--player-0)",
  "var(--player-1)",
  "var(--player-2)",
  "var(--player-3)",
];

interface Props {
  readonly court: ReadonlyArray<CourtEntry>;
  readonly accused: IKCard | null;
  readonly forgotten: HiddenCard | null;
  readonly playerNames: ReadonlyArray<string>;
  readonly throneValue: number;
  readonly pending: IKState["pendingResolution"];
  readonly effectActions: readonly IKEffectChoiceAction[];
  readonly activePlayer: PlayerId;
  readonly myIndex: PlayerId;
  readonly send: (msg: IKClientMessage) => void;
  readonly gameState: IKState;
}

export const CourtZone: React.FC<Props> = ({
  court,
  accused,
  forgotten,
  playerNames,
  throneValue,
  pending,
  effectActions,
  activePlayer,
  myIndex,
  send,
  gameState,
}) => (
  <div className="court-zone">
    <span className="court-zone__throne-label">Throne: {throneValue}</span>

    {court.length === 0 ? (
      <div className="court-zone__empty">No cards in court</div>
    ) : (
      <div className="court-zone__stack">
        {court.map((entry, idx) => {
          const isTop = idx === court.length - 1;
          const entryClass = `court-zone__entry ${isTop ? "court-zone__entry--top" : ""}`;

          return (
            <div
              key={`court-${entry.card.id}-${idx}`}
              className={entryClass}
              style={{ zIndex: idx }}
            >
              {entry.face === "down" ? (
                <DisgracedCard visual={toCardVisual(entry.card)} size="small" />
              ) : (
                <Card
                  visual={toCardVisual(entry.card)}
                  orientation="front"
                  size="small"
                  previewSource="court"
                />
              )}
              <div
                className="court-zone__player-bar"
                style={{ background: PLAYER_COLORS[entry.playedBy] ?? PLAYER_COLORS[0] }}
              />
            </div>
          );
        })}
      </div>
    )}

    {pending !== null && (
      <InlineChoiceBar
        pending={pending}
        effectActions={effectActions}
        activePlayer={activePlayer}
        myIndex={myIndex}
        playerNames={playerNames as string[]}
        send={send}
        court={court}
        gameState={gameState}
      />
    )}

    {(accused !== null || forgotten !== null) && (
      <div className="court-zone__side-zones">
        {accused !== null && (
          <div className="court-zone__side-zone">
            <span className="zone-label">Accused</span>
            <Card
              visual={toCardVisual(accused)}
              orientation="front"
              size="small"
              previewSource="side"
            />
          </div>
        )}
        {forgotten !== null && (
          <div className="court-zone__side-zone">
            <span className="zone-label">Forgotten</span>
            <Card
              visual={toCardVisual(forgotten.card)}
              orientation="back"
              size="small"
            />
          </div>
        )}
      </div>
    )}
  </div>
);

