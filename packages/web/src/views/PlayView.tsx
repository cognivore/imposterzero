import { useTrail, animated, to } from "@react-spring/web";
import type { PlayerId } from "@imposter-zero/types";
import type { IKPlayAction } from "@imposter-zero/engine";
import type { ClientPhase } from "../state.js";
import type { IKClientMessage } from "../ws-client.js";
import { Card } from "./card/Card.js";
import { toCardVisual, ANONYMOUS_CARD } from "./card/types.js";
import { CourtDisplay } from "./CourtDisplay.js";
import { GameLogPanel } from "./GameLog.js";

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
  const { gameState, legalActions, activePlayer, myIndex, numPlayers, playerNames } = phase;
  const myZones = gameState.players[myIndex];
  const isMyTurn = activePlayer === myIndex;

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

  const trail = useTrail(myZones.hand.length, {
    from: { opacity: 0, y: 30, scale: 0.9 },
    to: { opacity: 1, y: 0, scale: 1 },
    config: { tension: 600, friction: 36 },
  });

  return (
    <div className="game-board">
      <div className="opponents-row">
        {opponents.map((opIdx) => {
          const opZones = gameState.players[opIdx];
          if (opZones === undefined) return null;
          return (
            <div
              key={opIdx}
              className={`opponent-panel ${activePlayer === opIdx ? "opponent-panel--active" : ""}`}
            >
              <div className="opponent-label">
                {playerNames[opIdx] ?? `Player ${opIdx}`}
                {activePlayer === opIdx && <span className="turn-indicator"> (acting)</span>}
              </div>
              <div className="opponent-info">
                <div>
                  <span className="zone-label">King</span>
                  <Card
                    visual={toCardVisual(opZones.king.card)}
                    orientation={opZones.king.face === "up" ? "front" : "back"}
                    size="small"
                  />
                </div>
                <div>
                  <span className="zone-label">Hand</span>
                  <div className="card-stack">
                    <Card visual={ANONYMOUS_CARD} orientation="back" size="small" />
                    {opZones.hand.length > 1 && (
                      <span className="card-stack-count">{opZones.hand.length}</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="board-center">
        <CourtDisplay
          court={gameState.shared.court}
          playerNames={playerNames}
          throneValue={throneValue(phase)}
        />

        {gameState.shared.accused !== null && (
          <div className="accused-area">
            <span className="zone-label">Accused</span>
            <Card
              visual={toCardVisual(gameState.shared.accused)}
              orientation="front"
              size="small"
            />
          </div>
        )}
      </div>

      <div className="player-area">
        <div className="my-king">
          <span className="zone-label">Your King</span>
          <Card
            visual={toCardVisual(myZones.king.card)}
            orientation={myZones.king.face === "up" ? "front" : "back"}
          />
        </div>

        <div className="hand-area">
          <h3>
            Your Hand
            {isMyTurn && <span className="turn-indicator"> &mdash; Your turn!</span>}
          </h3>
          <div className="hand">
            {trail.map((style, i) => {
              const card = myZones.hand[i];
              if (card === undefined) return null;
              const playable = isMyTurn && canPlayCard(card.id, legalActions);
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
                    visual={toCardVisual(card)}
                    orientation="front"
                    interactive={playable}
                    dimmed={isMyTurn && !playable}
                    onClick={() => handlePlayCard(card.id)}
                  />
                </animated.div>
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
        <span>{myZones.king.card.kind.name} is your King</span>
        <span>King is {myZones.king.face === "up" ? "face up" : "face down"}</span>
      </div>

      <GameLogPanel />
    </div>
  );
};
