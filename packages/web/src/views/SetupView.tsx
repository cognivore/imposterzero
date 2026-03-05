import { useState, useCallback } from "react";
import { useTrail, animated, to } from "@react-spring/web";
import type { IKSetupAction } from "@imposter-zero/engine";
import type { ClientPhase } from "../state.js";
import type { IKClientMessage } from "../ws-client.js";
import { Card } from "./card/Card.js";
import { SetupSlot } from "./card/SetupSlot.js";
import { toCardVisual, type CardVisual } from "./card/types.js";
import { PreviewZone } from "./PreviewZone.js";
import { CardInspectModal } from "./CardInspectModal.js";
import { useTouchDevice } from "../hooks/useTouchDevice.js";

type SetupPhase = Extract<ClientPhase, { readonly _tag: "setup" }>;

interface Props {
  readonly phase: SetupPhase;
  readonly send: (msg: IKClientMessage) => void;
}

export const SetupView: React.FC<Props> = ({ phase, send }) => {
  const { gameState, legalActions, activePlayer, myIndex } = phase;
  const myZones = gameState.players[myIndex];
  const isMyTurn = activePlayer === myIndex;
  const isTouch = useTouchDevice();

  const [successorId, setSuccessorId] = useState<number | null>(null);
  const [dungeonId, setDungeonId] = useState<number | null>(null);
  const [inspectCard, setInspectCard] = useState<CardVisual | null>(null);

  const canCommit = useCallback(
    (): boolean =>
      successorId !== null &&
      dungeonId !== null &&
      successorId !== dungeonId &&
      legalActions.some(
        (a: IKSetupAction) =>
          a.kind === "commit" && a.successorId === successorId && a.dungeonId === dungeonId,
      ),
    [successorId, dungeonId, legalActions],
  );

  const handleCommit = () => {
    if (successorId === null || dungeonId === null) return;
    send({ type: "action", action: { kind: "commit", successorId, dungeonId } });
    setSuccessorId(null);
    setDungeonId(null);
  };

  const handleCardClick = (cardId: number, visual: CardVisual) => {
    if (!isMyTurn) return;

    if (isTouch) {
      setInspectCard(visual);
      return;
    }

    if (successorId === null) {
      setSuccessorId(cardId);
    } else if (dungeonId === null) {
      if (cardId === successorId) {
        setSuccessorId(null);
      } else {
        setDungeonId(cardId);
      }
    } else if (cardId === successorId) {
      setSuccessorId(dungeonId);
      setDungeonId(null);
    } else if (cardId === dungeonId) {
      setDungeonId(null);
    } else {
      setSuccessorId(cardId);
      setDungeonId(null);
    }
  };

  if (myZones === undefined) return null;

  const findCardVisual = (id: number) => {
    const c = myZones.hand.find((card) => card.id === id);
    return c ? toCardVisual(c) : null;
  };

  const trail = useTrail(myZones.hand.length, {
    from: { opacity: 0, y: 30, scale: 0.9 },
    to: { opacity: 1, y: 0, scale: 1 },
    config: { tension: 600, friction: 36 },
  });

  return (
    <div className="game-board game-board-with-preview">
      <div className="phase-banner">
        <h2>Setup Phase</h2>
        <p>{isMyTurn ? "Choose your Successor and Dungeon cards" : "Waiting for other players..."}</p>
      </div>

      <div className="setup-slots">
        <SetupSlot
          kind="successor"
          card={successorId !== null ? findCardVisual(successorId) : null}
          onClick={() => setSuccessorId(null)}
        />
        <SetupSlot
          kind="dungeon"
          card={dungeonId !== null ? findCardVisual(dungeonId) : null}
          onClick={() => setDungeonId(null)}
        />
      </div>

      <div className="hand-area">
        <h3>Your Hand</h3>
        <div className="hand">
          {trail.map((style, i) => {
            const card = myZones.hand[i];
            if (card === undefined) return null;
            const visual = toCardVisual(card);
            const isSelected = card.id === successorId || card.id === dungeonId;
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
                  interactive={isMyTurn && !isSelected}
                  dimmed={isSelected}
                  previewSource="hand"
                  onClick={() => handleCardClick(card.id, visual)}
                />
              </animated.div>
            );
          })}
        </div>
      </div>

      {isMyTurn && (
        <div className="action-bar">
          <button
            className="btn btn-primary btn-large"
            onClick={handleCommit}
            disabled={!canCommit()}
          >
            Commit Selection
          </button>
        </div>
      )}

      <PreviewZone />

      {inspectCard !== null && (
        <CardInspectModal
          card={inspectCard}
          canPlay={false}
          onPlay={null}
          onClose={() => setInspectCard(null)}
        />
      )}
    </div>
  );
};
