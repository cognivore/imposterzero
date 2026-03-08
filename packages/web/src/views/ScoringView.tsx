import { useTrail, animated, to } from "@react-spring/web";
import type { PlayerId } from "@imposter-zero/types";
import type { IKState, IKPlayerZones, CourtEntry, HiddenCard, CondemnedEntry } from "@imposter-zero/engine";
import type { ClientPhase } from "../state.js";
import type { IKClientMessage } from "../ws-client.js";
import { Card } from "./card/Card.js";
import { DisgracedCard } from "./card/DisgracedCard.js";
import { toCardVisual } from "./card/types.js";
import { CountdownTimer } from "./CountdownTimer.js";

type ScoringPhase = Extract<ClientPhase, { readonly _tag: "scoring" }>;

interface Props {
  readonly phase: ScoringPhase;
  readonly send: (msg: IKClientMessage) => void;
}

const scoreClass = (score: number): string =>
  score > 0 ? "score-positive" : score < 0 ? "score-negative" : "";

const formatRound = (score: number): string =>
  score > 0 ? `+${score}` : String(score);

const CourtCard: React.FC<{ readonly entry: CourtEntry }> = ({ entry }) =>
  entry.face === "down" ? (
    <DisgracedCard visual={toCardVisual(entry.card)} size="small" />
  ) : (
    <Card visual={toCardVisual(entry.card)} orientation="front" size="small" />
  );

const RevealedHiddenCard: React.FC<{
  readonly card: HiddenCard | CondemnedEntry;
  readonly label: string;
}> = ({ card, label }) => (
  <div className="scoring-side-zone">
    <span className="zone-label">{label}</span>
    <Card visual={toCardVisual(card.card)} orientation="front" size="small" />
  </div>
);

const PlayerReveal: React.FC<{
  readonly zones: IKPlayerZones;
  readonly name: string;
  readonly round: number;
  readonly isMe: boolean;
}> = ({ zones, name, round, isMe }) => (
  <div className={`scoring-player ${isMe ? "is-me" : ""}`}>
    <div className="scoring-player__name">{name}</div>
    <div className="scoring-player__score">
      <span className={scoreClass(round)}>{formatRound(round)}</span>
    </div>

    <div className="scoring-player__zones">
      <div className="scoring-player__zone">
        <Card visual={toCardVisual(zones.king.card)} orientation="front" size="small" />
        <span className="zone-label">King</span>
      </div>

      <div className="scoring-player__zone">
        {zones.successor !== null ? (
          <Card visual={toCardVisual(zones.successor.card)} orientation="front" size="small" />
        ) : (
          <div className="scoring-player__empty" />
        )}
        <span className="zone-label">Successor</span>
      </div>

      <div className="scoring-player__zone">
        {zones.dungeon !== null ? (
          <Card visual={toCardVisual(zones.dungeon.card)} orientation="front" size="small" />
        ) : (
          <div className="scoring-player__empty" />
        )}
        <span className="zone-label">Dungeon</span>
      </div>
    </div>

    {zones.hand.length > 0 && (
      <div className="scoring-player__hand">
        <span className="zone-label">Hand</span>
        <div className="scoring-player__hand-cards">
          {zones.hand.map((card) => (
            <Card key={card.id} visual={toCardVisual(card)} orientation="front" size="small" />
          ))}
        </div>
      </div>
    )}
  </div>
);

export const ScoringView: React.FC<Props> = ({ phase, send }) => {
  const {
    gameState, roundScores, matchScores, roundsPlayed,
    numPlayers, myIndex, playerNames, readyPlayers, name, reviewDeadline,
  } = phase;

  const handleReady = () => send({ type: "ready", ready: true });
  const amReady = readyPlayers.includes(name);

  const players = Array.from({ length: numPlayers }, (_, i) => i as PlayerId);

  const courtTrail = useTrail(gameState.shared.court.length, {
    from: { opacity: 0, y: 16, scale: 0.95 },
    to: { opacity: 1, y: 0, scale: 1 },
    config: { tension: 600, friction: 36 },
  });

  const hasSharedSideZones =
    gameState.shared.forgotten !== null ||
    gameState.shared.accused !== null ||
    gameState.shared.condemned.length > 0;

  return (
    <div className="scoring">
      <h1>Round {roundsPlayed} Complete</h1>
      <CountdownTimer turnDeadline={reviewDeadline} isMyTurn={!amReady} />

      <div className="scoring-players">
        {players.map((i) => {
          const zones = gameState.players[i];
          if (!zones) return null;
          return (
            <PlayerReveal
              key={i}
              zones={zones}
              name={playerNames[i] ?? `Player ${i}`}
              round={roundScores[i] ?? 0}
              isMe={i === myIndex}
            />
          );
        })}
      </div>

      {gameState.shared.court.length > 0 && (
        <div className="scoring-court">
          <span className="zone-label">Court</span>
          <div className="scoring-court__cards">
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
                  <CourtCard entry={entry} />
                </animated.div>
              );
            })}
          </div>
        </div>
      )}

      {hasSharedSideZones && (
        <div className="scoring-side-zones">
          {gameState.shared.forgotten !== null && (
            <RevealedHiddenCard card={gameState.shared.forgotten} label="Forgotten" />
          )}
          {gameState.shared.accused !== null && (
            <div className="scoring-side-zone">
              <span className="zone-label">Accused</span>
              <Card visual={toCardVisual(gameState.shared.accused)} orientation="front" size="small" />
            </div>
          )}
          {gameState.shared.condemned.map((entry, idx) => (
            <RevealedHiddenCard key={idx} card={entry} label="Condemned" />
          ))}
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

      <div className="scoring-ready">
        <div className="scoring-ready__statuses">
          {playerNames.map((pName) => (
            <span
              key={pName}
              className={`scoring-ready__badge ${readyPlayers.includes(pName) ? "scoring-ready__badge--ready" : ""}`}
            >
              {pName} {readyPlayers.includes(pName) ? "\u2713" : "\u2026"}
            </span>
          ))}
        </div>
        <button
          className="btn btn-primary btn-large"
          onClick={handleReady}
          disabled={amReady}
        >
          {amReady ? "Waiting for others\u2026" : "Ready"}
        </button>
      </div>
    </div>
  );
};
