import { useState, useCallback } from "react";
import { useTrail, animated, to } from "@react-spring/web";
import type { IKPlayAction, IKPlayerZones } from "@imposter-zero/engine";
import type { IKClientMessage } from "../ws-client.js";
import { Card } from "./card/Card.js";
import { toCardVisual, type CardVisual } from "./card/types.js";
import { CardInspectModal } from "./CardInspectModal.js";
import { useTouchDevice } from "../hooks/useTouchDevice.js";
import type { SetupSelection } from "./GameLayout.js";

interface Props {
  readonly myZones: IKPlayerZones;
  readonly isMyTurn: boolean;
  readonly activePlayerName: string;
  readonly legalActions: readonly IKPlayAction[];
  readonly send: (msg: IKClientMessage) => void;
  readonly setupMode: SetupSelection | null | undefined;
  readonly onSetupCardClick: ((cardId: number) => void) | undefined;
  readonly onCommitSetup: (() => void) | undefined;
  readonly setupWaiting: boolean | undefined;
}

const canPlayCard = (cardId: number, legalActions: readonly IKPlayAction[]): boolean =>
  legalActions.some((a) => a.kind === "play" && a.cardId === cardId);

const canDisgrace = (legalActions: readonly IKPlayAction[]): boolean =>
  legalActions.some((a) => a.kind === "disgrace");

export const HandZone: React.FC<Props> = ({
  myZones,
  isMyTurn,
  activePlayerName,
  legalActions,
  send,
  setupMode = null,
  onSetupCardClick,
  onCommitSetup,
  setupWaiting = false,
}) => {
  const isTouch = useTouchDevice();
  const inSetup = setupMode !== null;

  const [inspectCard, setInspectCard] = useState<CardVisual | null>(null);
  const [inspectPlayable, setInspectPlayable] = useState(false);
  const [inspectPlayCb, setInspectPlayCb] = useState<(() => void) | null>(null);

  const handlePlayCard = useCallback(
    (cardId: number) => {
      send({ type: "action", action: { kind: "play", cardId } });
    },
    [send],
  );

  const handleDisgrace = useCallback(() => {
    send({ type: "action", action: { kind: "disgrace" } });
  }, [send]);

  const openInspect = useCallback(
    (visual: CardVisual, playable: boolean, playCb: (() => void) | null) => {
      setInspectCard(visual);
      setInspectPlayable(playable);
      setInspectPlayCb(() => playCb);
    },
    [],
  );

  const closeInspect = useCallback(() => {
    setInspectCard(null);
    setInspectPlayable(false);
    setInspectPlayCb(null);
  }, []);

  const trail = useTrail(myZones.hand.length, {
    from: { opacity: 0, y: 30, scale: 0.9 },
    to: { opacity: 1, y: 0, scale: 1 },
    config: { tension: 600, friction: 36 },
  });

  const turnLabel = inSetup
    ? "Choose Successor, then Dungeon"
    : setupWaiting
      ? "Waiting for setup..."
      : isMyTurn
        ? "Your turn"
        : `${activePlayerName} is thinking...`;

  const turnClass = inSetup || isMyTurn
    ? "hand-zone__turn-indicator hand-zone__turn-indicator--mine"
    : "hand-zone__turn-indicator hand-zone__turn-indicator--waiting";

  return (
    <div className="hand-zone">
      <span className={turnClass}>{turnLabel}</span>

      <div className="hand-zone__cards">
        {trail.map((style, i) => {
          const card = myZones.hand[i];
          if (card === undefined) return null;
          const visual = toCardVisual(card);

          const isSetupSelected =
            inSetup &&
            (card.id === setupMode.successorId || card.id === setupMode.dungeonId);

          if (inSetup) {
            const handleClick = () => onSetupCardClick?.(card.id);
            return (
              <animated.div
                key={card.id}
                style={{
                  opacity: style.opacity,
                  transform: to(
                    [style.y, style.scale],
                    (y, s) => `translateY(${y}px) scale(${s})`,
                  ),
                }}
              >
                <Card
                  visual={visual}
                  orientation="front"
                  interactive={!isSetupSelected}
                  dimmed={isSetupSelected}
                  selected={isSetupSelected}
                  previewSource="hand"
                  onClick={handleClick}
                />
              </animated.div>
            );
          }

          const playable = isMyTurn && canPlayCard(card.id, legalActions);
          const handleClick = () => {
            if (isTouch) {
              openInspect(visual, playable, playable ? () => handlePlayCard(card.id) : null);
            } else if (playable) {
              handlePlayCard(card.id);
            }
          };
          return (
            <animated.div
              key={card.id}
              style={{
                opacity: style.opacity,
                transform: to(
                  [style.y, style.scale],
                  (y, s) => `translateY(${y}px) scale(${s})`,
                ),
              }}
            >
              <Card
                visual={visual}
                orientation="front"
                interactive={playable || isTouch}
                dimmed={isMyTurn && !playable && !isTouch}
                previewSource="hand"
                onClick={handleClick}
              />
            </animated.div>
          );
        })}
      </div>

      <div className="hand-zone__actions">
        {onCommitSetup && (
          <button className="btn btn-primary" onClick={onCommitSetup}>
            Commit
          </button>
        )}
        {!inSetup && !setupWaiting && isMyTurn && canDisgrace(legalActions) && (
          <button className="btn btn-danger" onClick={handleDisgrace}>
            Disgrace
          </button>
        )}
      </div>

      {inspectCard !== null && (
        <CardInspectModal
          card={inspectCard}
          canPlay={inspectPlayable}
          onPlay={inspectPlayCb}
          onClose={closeInspect}
        />
      )}
    </div>
  );
};
