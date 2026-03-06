import type { PlayerId } from "@imposter-zero/types";
import type { ChoiceOption, IKEffectChoiceAction, IKState } from "@imposter-zero/engine";
import type { IKClientMessage } from "../ws-client.js";
import { Card } from "./card/Card.js";
import { toCardVisual, type CardVisual } from "./card/types.js";

interface Props {
  readonly pending: NonNullable<IKState["pendingResolution"]>;
  readonly effectActions: readonly IKEffectChoiceAction[];
  readonly activePlayer: PlayerId;
  readonly myIndex: PlayerId;
  readonly playerNames: readonly string[];
  readonly send: (msg: IKClientMessage) => void;
  readonly court: IKState["shared"]["court"];
  readonly gameState: IKState;
}

const PLAYER_COLORS = [
  "var(--player-0)",
  "var(--player-1)",
  "var(--player-2)",
  "var(--player-3)",
];

const findCardVisual = (gameState: IKState, cardId: number): CardVisual | null => {
  for (const entry of gameState.shared.court) {
    if (entry.card.id === cardId) return toCardVisual(entry.card);
  }
  for (const p of gameState.players) {
    for (const c of p.hand) {
      if (c.id === cardId) return toCardVisual(c);
    }
    for (const c of p.antechamber) {
      if (c.id === cardId) return toCardVisual(c);
    }
  }
  return null;
};

const OptionButton: React.FC<{
  readonly option: ChoiceOption;
  readonly index: number;
  readonly enabled: boolean;
  readonly playerNames: readonly string[];
  readonly gameState: IKState;
  readonly onClick: () => void;
  readonly labelOverride?: string;
}> = ({ option, index, enabled, playerNames, gameState, onClick, labelOverride }) => {
  const baseClass = "inline-choice-bar__btn";
  const variantClass =
    option.kind === "proceed"
      ? `${baseClass} ${baseClass}--primary`
      : option.kind === "pass"
        ? `${baseClass} ${baseClass}--secondary`
        : baseClass;

  const content = labelOverride ? (
    <span>{labelOverride}</span>
  ) : (() => {
    switch (option.kind) {
      case "card": {
        const visual = findCardVisual(gameState, option.cardId);
        return visual ? (
          <>
            <Card visual={visual} orientation="front" size="micro" />
            <span>{visual.front.name}</span>
          </>
        ) : (
          <span>Card #{option.cardId}</span>
        );
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
  })();

  return (
    <button
      className={variantClass}
      onClick={onClick}
      disabled={!enabled}
      tabIndex={0}
    >
      {content}
    </button>
  );
};

export const InlineChoiceBar: React.FC<Props> = ({
  pending,
  effectActions,
  activePlayer,
  myIndex,
  playerNames,
  send,
  court,
  gameState,
}) => {
  const choosingPlayer = pending.choosingPlayer ?? activePlayer;
  const isMyChoice = choosingPlayer === myIndex;
  const options = pending.currentOptions ?? [];

  const topCard = court.at(-1);
  const contextCardName = topCard ? topCard.card.kind.name : "card";

  const handleChoice = (choiceIndex: number) => {
    send({ type: "action", action: { kind: "effect_choice", choice: choiceIndex } });
  };

  const descriptionForOptions = (opts: readonly ChoiceOption[]): string => {
    if (opts.length === 0) return "make a choice";
    const first = opts[0];
    if (!first) return "make a choice";
    switch (first.kind) {
      case "card":
        return "choose a card";
      case "player":
        return "choose a player";
      case "cardName":
        return "name a card";
      case "value":
        return "choose a value";
      case "pass":
      case "proceed":
        return "decide";
    }
  };

  const isReaction = pending.isReactionWindow ?? false;

  if (!isMyChoice) {
    return (
      <div className="inline-choice-bar">
        <div className="inline-choice-bar__waiting">
          {isReaction
            ? `${playerNames[choosingPlayer] ?? `Player ${choosingPlayer}`} — reaction window...`
            : `${playerNames[choosingPlayer] ?? `Player ${choosingPlayer}`} is choosing...`}
        </div>
      </div>
    );
  }

  const reactionContext = isReaction
    ? `${contextCardName} — react with King's Hand?`
    : `${contextCardName} — ${descriptionForOptions(options)}:`;

  return (
    <div className="inline-choice-bar">
      <div className="inline-choice-bar__context">
        <span className="inline-choice-bar__card-name">{reactionContext}</span>
      </div>
      <div className="inline-choice-bar__options" role="group" aria-label="Choice options">
        {options.map((option, idx) => {
          const enabled = effectActions.some((a) => a.choice === idx);
          const extra = isReaction
            ? { labelOverride: option.kind === "proceed" ? "React with King's Hand" : "Pass" }
            : {};
          return (
            <OptionButton
              key={idx}
              option={option}
              index={idx}
              enabled={enabled}
              playerNames={playerNames}
              gameState={gameState}
              onClick={() => handleChoice(idx)}
              {...extra}
            />
          );
        })}
      </div>
    </div>
  );
};
