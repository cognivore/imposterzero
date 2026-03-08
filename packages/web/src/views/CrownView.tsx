import { useTrail, animated, to } from "@react-spring/web";
import type { PlayerId } from "@imposter-zero/types";
import type { ClientPhase } from "../state.js";
import type { IKClientMessage } from "../ws-client.js";
import { Card } from "./card/Card.js";
import { toCardVisual } from "./card/types.js";
import { PreviewZone } from "./PreviewZone.js";
import { CountdownTimer } from "./CountdownTimer.js";

type CrownPhase = Extract<ClientPhase, { readonly _tag: "crown" }>;

interface Props {
  readonly phase: CrownPhase;
  readonly send: (msg: IKClientMessage) => void;
}

export const CrownView: React.FC<Props> = ({ phase, send }) => {
  const { activePlayer, myIndex, numPlayers, playerNames, gameState } = phase;
  const isMyTurn = activePlayer === myIndex;
  const trueKingName = playerNames[activePlayer] ?? `Player ${activePlayer}`;

  const myZones = gameState.players[myIndex];
  const { accused, forgotten } = gameState.shared;

  const handleChoose = (player: PlayerId) => {
    send({ type: "action", action: { kind: "crown", firstPlayer: player } });
  };

  const players = Array.from({ length: numPlayers }, (_, i) => i as PlayerId);

  const trail = useTrail(myZones?.hand.length ?? 0, {
    from: { opacity: 0, y: 30, scale: 0.9 },
    to: { opacity: 1, y: 0, scale: 1 },
    config: { tension: 600, friction: 36 },
  });

  if (myZones === undefined) return null;

  return (
    <div className="crown-view">
      <CountdownTimer turnDeadline={phase.turnDeadline} isMyTurn={isMyTurn} />
      <h1 className="crown-title">True King</h1>

      {(accused !== null || forgotten !== null) && (
        <div className="side-zones">
          {accused !== null && (
            <div className="side-zone">
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
            <div className="side-zone">
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

      <div className="hand-area">
        <h3>Your Hand</h3>
        <div className="hand">
          {trail.map((style, i) => {
            const card = myZones.hand[i];
            if (card === undefined) return null;
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
                  previewSource="hand"
                />
              </animated.div>
            );
          })}
        </div>
      </div>

      {isMyTurn ? (
        <>
          <p className="crown-subtitle">You are the True King. Choose who plays first.</p>
          <div className="crown-choices">
            {players.map((p) => {
              const name = playerNames[p] ?? `Player ${p}`;
              const isMe = p === myIndex;
              return (
                <button
                  key={p}
                  className={`btn crown-choice ${isMe ? "crown-choice--me" : ""}`}
                  onClick={() => handleChoose(p)}
                >
                  {isMe ? `${name} (you)` : name}
                </button>
              );
            })}
          </div>
        </>
      ) : (
        <p className="crown-subtitle">
          <strong>{trueKingName}</strong> is the True King and is choosing who plays first...
        </p>
      )}

      <PreviewZone />
    </div>
  );
};
