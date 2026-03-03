import type { ClientPhase } from "../state.js";

type ScoringPhase = Extract<ClientPhase, { readonly _tag: "scoring" }>;

interface Props {
  readonly phase: ScoringPhase;
}

const scoreClass = (score: number): string =>
  score > 0 ? "score-positive" : score < 0 ? "score-negative" : "";

const formatRound = (score: number): string =>
  score > 0 ? `+${score}` : String(score);

export const ScoringView: React.FC<Props> = ({ phase }) => {
  const { roundScores, matchScores, roundsPlayed, numPlayers, me } = phase;

  return (
    <div className="scoring">
      <h1>Round {roundsPlayed} Complete</h1>

      <table className="score-table">
        <thead>
          <tr>
            <th>Player</th>
            <th>Round Score</th>
            <th>Match Total</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: numPlayers }, (_, i) => {
            const round = roundScores[i] ?? 0;
            const match = matchScores[i] ?? 0;
            return (
              <tr key={i} className={me === `player-${i}` ? "is-me" : ""}>
                <td>Player {i}</td>
                <td className={scoreClass(round)}>{formatRound(round)}</td>
                <td>{match}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <p className="scoring-hint">Next round starting soon...</p>
    </div>
  );
};
