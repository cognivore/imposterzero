import type { PlayerId } from "@imposter-zero/types";
import type { ChoiceOption } from "@imposter-zero/engine";
import type { ClientPhase } from "../state.js";
import type { IKClientMessage } from "../ws-client.js";
import { Card } from "./card/Card.js";
import { toCardVisual, type CardVisual } from "./card/types.js";
import { CourtDisplay } from "./CourtDisplay.js";

type ResolvingPhase = Extract<ClientPhase, { readonly _tag: "resolving" }>;

interface Props {
  readonly phase: ResolvingPhase;
  readonly send: (msg: IKClientMessage) => void;
}

const findCardVisual = (phase: ResolvingPhase, cardId: number): CardVisual | null => {
  for (const entry of phase.gameState.shared.court) {
    if (entry.card.id === cardId) return toCardVisual(entry.card);
  }
  for (const p of phase.gameState.players) {
    for (const c of p.hand) {
      if (c.id === cardId) return toCardVisual(c);
    }
    for (const c of p.antechamber) {
      if (c.id === cardId) return toCardVisual(c);
    }
  }
  return null;
};

const OptionLabel: React.FC<{ option: ChoiceOption; phase: ResolvingPhase; playerNames: readonly string[] }> = ({
  option,
  phase,
  playerNames,
}) => {
  switch (option.kind) {
    case "card": {
      const visual = findCardVisual(phase, option.cardId);
      if (visual) {
        return (
          <div className="resolving-card-option">
            <Card visual={visual} orientation="front" size="small" />
            <span>{visual.front.name}</span>
          </div>
        );
      }
      return <span>Card #{option.cardId}</span>;
    }
    case "player":
      return <span>{playerNames[option.player] ?? `Player ${option.player}`}</span>;
    case "cardName":
      return <span>{option.name}</span>;
    case "value":
      return <span>{option.value}</span>;
    case "pass":
      return <span>Skip</span>;
    case "proceed":
      return <span>Use Ability</span>;
  }
};

export const ResolvingView: React.FC<Props> = ({ phase, send }) => {
  const { gameState, legalActions, activePlayer, myIndex, numPlayers, playerNames } = phase;
  const isMyTurn = activePlayer === myIndex;
  const pending = gameState.pendingResolution;

  const handleChoice = (choiceIndex: number) => {
    send({ type: "action", action: { kind: "effect_choice", choice: choiceIndex } });
  };

  const choosingPlayer = pending?.choosingPlayer ?? activePlayer;
  const choosingPlayerName = playerNames[choosingPlayer] ?? `Player ${choosingPlayer}`;
  const options = pending?.currentOptions ?? [];

  const topCard = gameState.shared.court.at(-1);
  const contextCardName = topCard ? topCard.card.kind.name : "card";

  return (
    <div className="game-board">
      <div className="court-section">
        <CourtDisplay
          court={gameState.shared.court}
          playerNames={playerNames}
          throneValue={
            gameState.shared.court.length > 0
              ? (gameState.shared.court.at(-1)?.face === "down"
                  ? 1
                  : gameState.shared.court.at(-1)?.card.kind.props.value ?? 0)
              : 0
          }
        />
      </div>

      <div className="resolving-panel">
        <div className="resolving-header">
          <h2>
            {isMyTurn
              ? `${contextCardName} ability — your choice`
              : `${choosingPlayerName} is resolving ${contextCardName}'s ability...`}
          </h2>
        </div>

        {isMyTurn && (
          <div className="resolving-options">
            {options.map((option, idx) => (
              <button
                key={idx}
                className="resolving-option-btn"
                onClick={() => handleChoice(idx)}
                disabled={!legalActions.some((a) => a.choice === idx)}
              >
                <OptionLabel option={option} phase={phase} playerNames={playerNames} />
              </button>
            ))}
          </div>
        )}

        {!isMyTurn && (
          <div className="resolving-waiting">
            Waiting for {choosingPlayerName} to make a choice...
          </div>
        )}
      </div>
    </div>
  );
};
