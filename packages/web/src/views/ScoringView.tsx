import { useTrail, animated, to } from "@react-spring/web";
import type { PlayerId } from "@imposter-zero/types";
import type { ClientPhase } from "../state.js";
import type { IKClientMessage } from "../ws-client.js";
import { Card } from "./card/Card.js";
import { toCardVisual } from "./card/types.js";

type ScoringPhase = Extract<ClientPhase, { readonly _tag: "scoring" }>;

interface Props {
  readonly phase: ScoringPhase;
  readonly send: (msg: IKClientMessage) => void;
}

const scoreClass = (score: number): string =>
  score > 0 ? "score-positive" : score < 0 ? "score-negative" : "";

const formatRound = (score: number): string =>
  score > 0 ? `+${score}` : String(score);

export const ScoringView: React.FC<Props> = ({ phase, send }) => {
  const { gameState, roundScores, matchScores, roundsPlayed, numPlayers, myIndex, playerNames } = phase;

  const handleNextRound = () => send({ type: "ready", ready: true });

  const players = Array.from({ length: numPlayers }, (_, i) => i as PlayerId);

  const courtTrail = useTrail(gameState.shared.court.length, {
    from: { opacity: 0, y: 16, scale: 0.95 },
    to: { opacity: 1, y: 0, scale: 1 },
    config: { tension: 600, friction: 36 },
  });

  return (
    <div className="scoring">
      <h1>Round {roundsPlayed} Complete</h1>

      <div className="round-board">
        {players.map((i) => {
          const zones = gameState.players[i];
          if (!zones) return null;
          const name = playerNames[i] ?? `Player ${i}`;
          const round = roundScores[i] ?? 0;
          return (
            <div key={i} className={`round-player ${i === myIndex ? "is-me" : ""}`}>
              <div className="round-player-name">{name}</div>
              <div className="round-player-king">
                <Card
                  visual={toCardVisual(zones.king.card)}
                  orientation={zones.king.face === "up" ? "front" : "back"}
                  size="small"
                />
              </div>
              <div className={`round-player-score ${scoreClass(round)}`}>
                {formatRound(round)}
              </div>
            </div>
          );
        })}
      </div>

      {gameState.shared.court.length > 0 && (
        <div className="round-court">
          <span className="zone-label">Court</span>
          <div className="round-court-cards">
            {courtTrail.map((style, idx) => {
              const entry = gameState.shared.court[idx];
              if (entry === undefined) return null;
              return (
                <animated.div
                  key={`court-${idx}`}
                  style={{
                    opacity: style.opacity,
                    transform: to(
                      [style.y, style.scale],
                      (y, s) => `translateY(${y}px) scale(${s})`,
                    ),
                  }}
                >
                  <Card
                    visual={toCardVisual(entry.card)}
                    orientation={entry.face === "up" ? "front" : "back"}
                    size="small"
                  />
                </animated.div>
              );
            })}
          </div>
        </div>
      )}

      <table className="score-table">
        <thead>
          <tr>
            <th>Player</th>
            <th>Round Score</th>
            <th>Match Total</th>
          </tr>
        </thead>
        <tbody>
          {players.map((i) => {
            const round = roundScores[i] ?? 0;
            const match = matchScores[i] ?? 0;
            return (
              <tr key={i} className={i === myIndex ? "is-me" : ""}>
                <td>{playerNames[i] ?? `Player ${i}`}</td>
                <td className={scoreClass(round)}>{formatRound(round)}</td>
                <td>{match}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <button className="btn btn-primary btn-large" onClick={handleNextRound}>
        Next Round
      </button>
    </div>
  );
};
