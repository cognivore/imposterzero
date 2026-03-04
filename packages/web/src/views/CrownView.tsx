import type { PlayerId } from "@imposter-zero/types";
import type { ClientPhase } from "../state.js";
import type { IKClientMessage } from "../ws-client.js";

type CrownPhase = Extract<ClientPhase, { readonly _tag: "crown" }>;

interface Props {
  readonly phase: CrownPhase;
  readonly send: (msg: IKClientMessage) => void;
}

export const CrownView: React.FC<Props> = ({ phase, send }) => {
  const { activePlayer, myIndex, numPlayers, playerNames } = phase;
  const isMyTurn = activePlayer === myIndex;
  const trueKingName = playerNames[activePlayer] ?? `Player ${activePlayer}`;

  const handleChoose = (player: PlayerId) => {
    send({ type: "action", action: { kind: "crown", firstPlayer: player } });
  };

  const players = Array.from({ length: numPlayers }, (_, i) => i as PlayerId);

  return (
    <div className="crown-view">
      <h1 className="crown-title">True King</h1>
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
    </div>
  );
};
