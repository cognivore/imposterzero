import { useState, useCallback } from "react";
import type { IKSetupAction } from "@imposter-zero/engine";
import type { ClientPhase } from "../state.js";
import type { IKClientMessage } from "../ws-client.js";
import { CardComponent } from "./CardComponent.js";

type SetupPhase = Extract<ClientPhase, { readonly _tag: "setup" }>;

interface Props {
  readonly phase: SetupPhase;
  readonly send: (msg: IKClientMessage) => void;
}

export const SetupView: React.FC<Props> = ({ phase, send }) => {
  const { gameState, legalActions, activePlayer, myIndex } = phase;
  const myZones = gameState.players[myIndex];
  const isMyTurn = activePlayer === myIndex;

  const [successorId, setSuccessorId] = useState<number | null>(null);
  const [dungeonId, setDungeonId] = useState<number | null>(null);

  const canCommit = useCallback(
    (): boolean =>
      successorId !== null &&
      dungeonId !== null &&
      successorId !== dungeonId &&
      legalActions.some(
        (a) => a.kind === "commit" && a.successorId === successorId && a.dungeonId === dungeonId,
      ),
    [successorId, dungeonId, legalActions],
  );

  const handleCommit = () => {
    if (successorId === null || dungeonId === null) return;
    send({ type: "action", action: { kind: "commit", successorId, dungeonId } });
    setSuccessorId(null);
    setDungeonId(null);
  };

  const handleCardClick = (cardId: number) => {
    if (!isMyTurn) return;
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

  const findCard = (id: number) => myZones.hand.find((c) => c.id === id);

  return (
    <div className="game-board">
      <div className="phase-banner">
        <h2>Setup Phase</h2>
        <p>{isMyTurn ? "Choose your Successor and Dungeon cards" : "Waiting for other players..."}</p>
      </div>

      <div className="setup-slots">
        <div className={`setup-slot ${successorId !== null ? "filled" : ""}`}>
          <span className="slot-label">Successor</span>
          {(() => {
            if (successorId === null) return null;
            const card = findCard(successorId);
            if (card === undefined) return null;
            return <CardComponent card={card} selected onClick={() => setSuccessorId(null)} />;
          })()}
        </div>
        <div className={`setup-slot ${dungeonId !== null ? "filled" : ""}`}>
          <span className="slot-label">Dungeon</span>
          {(() => {
            if (dungeonId === null) return null;
            const card = findCard(dungeonId);
            if (card === undefined) return null;
            return <CardComponent card={card} selected onClick={() => setDungeonId(null)} />;
          })()}
        </div>
      </div>

      <div className="hand-area">
        <h3>Your Hand</h3>
        <div className="hand">
          {myZones.hand.map((card) => {
            const isSelected = card.id === successorId || card.id === dungeonId;
            return (
              <CardComponent
                key={card.id}
                card={card}
                onClick={() => handleCardClick(card.id)}
                disabled={!isMyTurn}
                selected={isSelected}
                dimmed={isSelected}
              />
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
    </div>
  );
};
