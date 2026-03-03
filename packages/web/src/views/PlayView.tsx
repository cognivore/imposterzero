import type { PlayerId } from "@imposter-zero/types";
import type { IKPlayAction } from "@imposter-zero/engine";
import { ikCardOps } from "@imposter-zero/engine";
import type { ClientPhase } from "../state.js";
import type { IKClientMessage } from "../ws-client.js";
import { CardComponent, CardBack } from "./CardComponent.js";

type PlayPhase = Extract<ClientPhase, { readonly _tag: "play" }>;

interface Props {
  readonly phase: PlayPhase;
  readonly send: (msg: IKClientMessage) => void;
}

const throneValue = (phase: PlayPhase): number => {
  const top = phase.gameState.shared.court.at(-1);
  if (top === undefined) return 0;
  return top.face === "down" ? 1 : top.card.kind.props.value;
};

const canPlayCard = (cardId: number, legalActions: readonly IKPlayAction[]): boolean =>
  legalActions.some((a) => a.kind === "play" && a.cardId === cardId);

const canDisgrace = (legalActions: readonly IKPlayAction[]): boolean =>
  legalActions.some((a) => a.kind === "disgrace");

export const PlayView: React.FC<Props> = ({ phase, send }) => {
  const { gameState, legalActions, activePlayer, myIndex, numPlayers } = phase;
  const myZones = gameState.players[myIndex];
  const isMyTurn = activePlayer === myIndex;
  const topCourt = gameState.shared.court.at(-1);

  const handlePlayCard = (cardId: number) => {
    send({ type: "action", action: { kind: "play", cardId } });
  };

  const handleDisgrace = () => {
    send({ type: "action", action: { kind: "disgrace" } });
  };

  if (myZones === undefined) return null;

  const opponents = Array.from({ length: numPlayers }, (_, i) => i as PlayerId).filter(
    (i) => i !== myIndex,
  );

  return (
    <div className="game-board">
      <div className="opponents-area">
        {opponents.map((opIdx) => {
          const opZones = gameState.players[opIdx];
          if (opZones === undefined) return null;
          return (
            <div
              key={opIdx}
              className={`opponent ${activePlayer === opIdx ? "active-player" : ""}`}
            >
              <div className="opponent-label">
                Player {opIdx}
                {activePlayer === opIdx && <span className="turn-indicator"> (acting)</span>}
              </div>
              <div className="opponent-info">
                <div className="opponent-king">
                  <span className="zone-label">King</span>
                  {opZones.king.face === "up" ? (
                    <CardComponent card={opZones.king.card} small />
                  ) : (
                    <CardBack small />
                  )}
                </div>
                <div className="opponent-hand-count">
                  <CardBack count={opZones.hand.length} small />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="board-center">
        <div className="court-area">
          <h3>Court</h3>
          <div className="throne-value">Throne: {throneValue(phase)}</div>
          {topCourt !== undefined ? (
            <div className="court-top">
              {topCourt.face === "up" ? (
                <CardComponent card={topCourt.card} />
              ) : (
                <CardBack />
              )}
              {gameState.shared.court.length > 1 && (
                <span className="court-depth">{gameState.shared.court.length} cards in court</span>
              )}
            </div>
          ) : (
            <div className="court-empty">Empty court</div>
          )}
        </div>

        {gameState.shared.accused !== null && (
          <div className="accused-area">
            <span className="zone-label">Accused</span>
            <CardComponent card={gameState.shared.accused} small />
          </div>
        )}
      </div>

      <div className="my-area">
        <div className="my-king">
          <span className="zone-label">Your King</span>
          {myZones.king.face === "up" ? (
            <CardComponent card={myZones.king.card} />
          ) : (
            <CardBack />
          )}
        </div>

        <div className="hand-area">
          <h3>
            Your Hand
            {isMyTurn && <span className="turn-indicator"> — Your turn!</span>}
          </h3>
          <div className="hand">
            {myZones.hand.map((card) => {
              const playable = isMyTurn && canPlayCard(card.id, legalActions);
              return (
                <CardComponent
                  key={card.id}
                  card={card}
                  {...(playable ? { onClick: () => handlePlayCard(card.id) } : {})}
                  disabled={!playable}
                  dimmed={isMyTurn && !playable}
                />
              );
            })}
          </div>
        </div>

        {isMyTurn && canDisgrace(legalActions) && (
          <div className="action-bar">
            <button className="btn btn-danger" onClick={handleDisgrace}>
              Disgrace
            </button>
          </div>
        )}
      </div>

      <div className="status-bar">
        <span>Turn {gameState.turnCount}</span>
        <span>{ikCardOps.name(myZones.king.card)} is your King</span>
        <span>
          King is {myZones.king.face === "up" ? "face up" : "face down"}
        </span>
      </div>
    </div>
  );
};
