import { useState, useCallback } from "react";
import type { IKMusteringAction, IKBeginRecruitAction, IKRecruitAction, IKRecommissionAction } from "@imposter-zero/engine";
import type { ClientPhase } from "../state.js";
import type { IKClientMessage } from "../ws-client.js";
import { Card } from "./card/Card.js";
import { toCardVisual } from "./card/types.js";
import { PreviewZone } from "./PreviewZone.js";

type MusteringPhase = Extract<ClientPhase, { readonly _tag: "mustering" }>;

interface Props {
  readonly phase: MusteringPhase;
  readonly send: (msg: IKClientMessage) => void;
}

export const MusteringView: React.FC<Props> = ({ phase, send }) => {
  const { gameState, legalActions, activePlayer, myIndex, playerNames } = phase;
  const isMyTurn = activePlayer === myIndex;
  const myZones = gameState.players[myIndex]!;
  const armyCards = myZones.army;
  const exhaustedCards = myZones.exhausted;
  const handCards = myZones.hand;

  const canBeginRecruit = legalActions.some((a) => a.kind === "begin_recruit");
  const canRecruit = legalActions.some((a) => a.kind === "recruit");
  const canRecommission = legalActions.some((a) => a.kind === "recommission");
  const hasBegunRecruiting = gameState.hasExhaustedThisMustering;

  const [selectedHandCard, setSelectedHandCard] = useState<number | null>(null);
  const [selectedArmyCard, setSelectedArmyCard] = useState<number | null>(null);
  const [recommExhaust1, setRecommExhaust1] = useState<number | null>(null);
  const [recommExhaust2, setRecommExhaust2] = useState<number | null>(null);
  const [recommRecover, setRecommRecover] = useState<number | null>(null);

  const handleBeginRecruit = useCallback((exhaustCardId: number) => {
    send({ type: "action", action: { kind: "begin_recruit", exhaustCardId } });
  }, [send]);

  const handleRecruit = useCallback(() => {
    if (selectedHandCard === null || selectedArmyCard === null) return;
    const action = legalActions.find(
      (a): a is IKRecruitAction =>
        a.kind === "recruit" &&
        a.discardFromHandId === selectedHandCard &&
        a.takeFromArmyId === selectedArmyCard,
    );
    if (!action) return;
    send({ type: "action", action });
    setSelectedHandCard(null);
    setSelectedArmyCard(null);
  }, [selectedHandCard, selectedArmyCard, legalActions, send]);

  const handleRecommission = useCallback(() => {
    if (recommExhaust1 === null || recommExhaust2 === null || recommRecover === null) return;
    const action = legalActions.find(
      (a): a is IKRecommissionAction =>
        a.kind === "recommission" &&
        ((a.exhaust1Id === recommExhaust1 && a.exhaust2Id === recommExhaust2) ||
         (a.exhaust1Id === recommExhaust2 && a.exhaust2Id === recommExhaust1)) &&
        a.recoverFromExhaustId === recommRecover,
    );
    if (!action) return;
    send({ type: "action", action });
    setRecommExhaust1(null);
    setRecommExhaust2(null);
    setRecommRecover(null);
  }, [recommExhaust1, recommExhaust2, recommRecover, legalActions, send]);

  const handleEndMustering = useCallback(() => {
    send({ type: "action", action: { kind: "end_mustering" } });
  }, [send]);

  const recruitValid = canRecruit && selectedHandCard !== null && selectedArmyCard !== null &&
    legalActions.some((a) =>
      a.kind === "recruit" &&
      a.discardFromHandId === selectedHandCard &&
      a.takeFromArmyId === selectedArmyCard,
    );

  const recommValid = recommExhaust1 !== null && recommExhaust2 !== null && recommRecover !== null &&
    legalActions.some((a) =>
      a.kind === "recommission" &&
      ((a.exhaust1Id === recommExhaust1 && a.exhaust2Id === recommExhaust2) ||
       (a.exhaust1Id === recommExhaust2 && a.exhaust2Id === recommExhaust1)) &&
      a.recoverFromExhaustId === recommRecover,
    );

  const toggleArmyForRecomm = (cardId: number) => {
    if (recommExhaust1 === cardId) { setRecommExhaust1(recommExhaust2); setRecommExhaust2(null); return; }
    if (recommExhaust2 === cardId) { setRecommExhaust2(null); return; }
    if (recommExhaust1 === null) { setRecommExhaust1(cardId); return; }
    if (recommExhaust2 === null) { setRecommExhaust2(cardId); return; }
    setRecommExhaust1(recommExhaust2);
    setRecommExhaust2(cardId);
  };

  const statusText = isMyTurn
    ? hasBegunRecruiting
      ? "You may recruit (discard a hand card, take an army card), recommission, or pass."
      : "Exhaust an army card to begin recruiting, recommission, or pass."
    : `Waiting for ${playerNames[activePlayer] ?? "opponent"} to muster...`;

  return (
    <div className="mustering-layout">
      <div className="mustering-header">
        <h2>Mustering Phase</h2>
        <p className="mustering-status">{statusText}</p>
      </div>

      <div className="mustering-zones">
        <div className="mustering-zone">
          <span className="zone-label">Your Army ({armyCards.length})</span>
          <div className="mustering-cards">
            {armyCards.map((card) => {
              const isSelectedForRecruit = selectedArmyCard === card.id;
              const isSelectedForRecomm = recommExhaust1 === card.id || recommExhaust2 === card.id;
              return (
                <div
                  key={card.id}
                  className={`mustering-card-slot ${isSelectedForRecruit ? "selected-recruit" : ""} ${isSelectedForRecomm ? "selected-recomm" : ""}`}
                  onClick={() => {
                    if (!isMyTurn) return;
                    if (canBeginRecruit && !hasBegunRecruiting) {
                      handleBeginRecruit(card.id);
                    } else if (canRecruit && hasBegunRecruiting) {
                      setSelectedArmyCard(isSelectedForRecruit ? null : card.id);
                    } else if (canRecommission) {
                      toggleArmyForRecomm(card.id);
                    }
                  }}
                >
                  <Card visual={toCardVisual(card)} orientation="front" size="small" />
                  {canBeginRecruit && !hasBegunRecruiting && isMyTurn && (
                    <div className="card-action-hint">Exhaust to recruit</div>
                  )}
                </div>
              );
            })}
            {armyCards.length === 0 && <div className="empty-zone">No cards</div>}
          </div>
        </div>

        <div className="mustering-zone">
          <span className="zone-label">Exhausted ({exhaustedCards.length})</span>
          <div className="mustering-cards">
            {exhaustedCards.map((card) => {
              const isSelected = recommRecover === card.id;
              return (
                <div
                  key={card.id}
                  className={`mustering-card-slot ${isSelected ? "selected-recover" : ""}`}
                  onClick={() => {
                    if (!isMyTurn || !canRecommission) return;
                    setRecommRecover(isSelected ? null : card.id);
                  }}
                >
                  <Card visual={toCardVisual(card)} orientation="front" size="small" />
                </div>
              );
            })}
            {exhaustedCards.length === 0 && <div className="empty-zone">No cards</div>}
          </div>
        </div>
      </div>

      {hasBegunRecruiting && canRecruit && (
        <div className="mustering-hand">
          <span className="zone-label">Your Hand ({handCards.length}) -- select a card to discard for Recruit</span>
          <div className="mustering-cards hand-cards">
            {handCards.map((card) => {
              const isSelected = selectedHandCard === card.id;
              return (
                <div
                  key={card.id}
                  className={`mustering-card-slot ${isSelected ? "selected-discard" : ""}`}
                  onClick={() => {
                    if (!isMyTurn) return;
                    setSelectedHandCard(isSelected ? null : card.id);
                  }}
                >
                  <Card visual={toCardVisual(card)} orientation="front" size="small" />
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="mustering-actions">
        {isMyTurn && (
          <>
            {recruitValid && (
              <button className="btn btn-primary" onClick={handleRecruit}>
                Recruit
              </button>
            )}
            {recommValid && (
              <button className="btn btn-secondary" onClick={handleRecommission}>
                Recommission
              </button>
            )}
            <button className="btn btn-outline" onClick={handleEndMustering}>
              Done
            </button>
          </>
        )}
      </div>

      <PreviewZone />
    </div>
  );
};
