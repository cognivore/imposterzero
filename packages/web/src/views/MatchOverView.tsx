import type { ClientPhase } from "../state.js";
import type { IKClientMessage } from "../ws-client.js";

type FinishedPhase = Extract<ClientPhase, { readonly _tag: "finished" }>;

interface Props {
  readonly phase: FinishedPhase;
  readonly send: (msg: IKClientMessage) => void;
}

export const MatchOverView: React.FC<Props> = ({ phase, send }) => {
  const { winners, finalScores, numPlayers } = phase;
  const winnerSet = new Set(winners);

  const handleLeave = () => send({ type: "leave_room" });

  return (
    <div className="match-over">
      <h1>Match Over</h1>

      <div className="winner-banner">
        {winners.length === 1
          ? `Player ${winners[0]} wins!`
          : `Players ${winners.join(" & ")} win!`}
      </div>

      <table className="score-table">
        <thead>
          <tr>
            <th>Player</th>
            <th>Final Score</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: numPlayers }, (_, i) => (
            <tr key={i} className={winnerSet.has(i) ? "winner-row" : ""}>
              <td>Player {i}</td>
              <td>{finalScores[i] ?? 0}</td>
              <td>{winnerSet.has(i) ? "Winner" : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <button className="btn btn-primary btn-large" onClick={handleLeave}>
        Back to Lobby
      </button>
    </div>
  );
};
