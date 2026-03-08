import { useState, useEffect, useMemo, useCallback } from "react";
import type { PlayerId } from "@imposter-zero/types";
import type { IKPlayAction, IKEffectChoiceAction, IKSetupAction } from "@imposter-zero/engine";
import type { ClientPhase } from "../state.js";
import type { IKClientMessage } from "../ws-client.js";
import { LeftRail } from "./LeftRail.js";
import { RightRail } from "./RightRail.js";
import { CourtZone } from "./CourtZone.js";
import { HandZone } from "./HandZone.js";
import { PreviewZone } from "./PreviewZone.js";
import { CountdownTimer } from "./CountdownTimer.js";
import { useDisgracedTracker } from "../stores/disgraced-tracker.js";
import { useSeenCardsTracker } from "../stores/seen-cards.js";
import { computePossibleHand } from "../logic/hand-helper.js";

type GamePhase = Extract<
  ClientPhase,
  { readonly _tag: "setup" } | { readonly _tag: "play" } | { readonly _tag: "resolving" }
>;

interface Props {
  readonly phase: GamePhase;
  readonly send: (msg: IKClientMessage) => void;
}

const throneValue = (phase: GamePhase): number => {
  const top = phase.gameState.shared.court.at(-1);
  if (top === undefined) return 0;
  return top.face === "down" ? 1 : top.card.kind.props.value;
};

export interface SetupSelection {
  readonly successorId: number | null;
  readonly dungeonId: number | null;
}

export const GameLayout: React.FC<Props> = ({ phase, send }) => {
  const { gameState, activePlayer, myIndex, numPlayers, playerNames } = phase;
  const handHelper = phase._tag === "setup" ? false : phase.handHelper;
  const myZones = gameState.players[myIndex];
  const isMyTurn = activePlayer === myIndex;
  const isSetup = phase._tag === "setup";

  const [setupSelection, setSetupSelection] = useState<SetupSelection>({
    successorId: null,
    dungeonId: null,
  });

  useEffect(() => {
    if (!isSetup) setSetupSelection({ successorId: null, dungeonId: null });
  }, [isSetup]);

  const handleSetupCardClick = useCallback(
    (cardId: number) => {
      setSetupSelection((prev) => {
        if (prev.successorId === null) return { ...prev, successorId: cardId };
        if (cardId === prev.successorId) return { ...prev, successorId: null };
        if (prev.dungeonId === null) return { ...prev, dungeonId: cardId };
        if (cardId === prev.dungeonId) return { ...prev, dungeonId: null };
        return { successorId: cardId, dungeonId: null };
      });
    },
    [],
  );

  const canCommitSetup =
    isSetup &&
    isMyTurn &&
    setupSelection.successorId !== null &&
    setupSelection.dungeonId !== null &&
    setupSelection.successorId !== setupSelection.dungeonId &&
    (phase.legalActions as readonly IKSetupAction[]).some(
      (a) =>
        a.kind === "commit" &&
        a.successorId === setupSelection.successorId &&
        a.dungeonId === setupSelection.dungeonId,
    );

  const handleCommitSetup = useCallback(() => {
    if (setupSelection.successorId === null || setupSelection.dungeonId === null) return;
    send({
      type: "action",
      action: {
        kind: "commit",
        successorId: setupSelection.successorId,
        dungeonId: setupSelection.dungeonId,
      },
    });
    setSetupSelection({ successorId: null, dungeonId: null });
  }, [setupSelection, send]);

  const updateCourt = useDisgracedTracker((s) => s.updateCourt);
  const disgracedCards = useDisgracedTracker((s) => s.disgracedCards);
  const seenCards = useSeenCardsTracker((s) => s.seenCards);

  useEffect(() => {
    updateCourt(gameState.shared.court);
  }, [gameState.shared.court, updateCourt]);

  const possibleHands = useMemo(
    () =>
      handHelper
        ? computePossibleHand(gameState, myIndex, numPlayers, disgracedCards, seenCards)
        : null,
    [handHelper, gameState, myIndex, numPlayers, disgracedCards, seenCards],
  );

  if (myZones === undefined) return null;

  const opponents = Array.from({ length: numPlayers }, (_, i) => i as PlayerId).filter(
    (i) => i !== myIndex,
  );

  const playActions: readonly IKPlayAction[] =
    phase._tag === "play" ? phase.legalActions : [];

  const effectActions: readonly IKEffectChoiceAction[] =
    phase._tag === "resolving" ? phase.legalActions : [];

  const pending = gameState.pendingResolution;

  return (
    <div className="game-layout">
      <div className="game-layout__timer">
        <CountdownTimer turnDeadline={phase.turnDeadline} isMyTurn={isMyTurn} />
      </div>
      <LeftRail turnCount={gameState.turnCount} />

      <CourtZone
        court={gameState.shared.court}
        accused={gameState.shared.accused}
        forgotten={gameState.shared.forgotten}
        playerNames={playerNames}
        throneValue={throneValue(phase)}
        pending={pending}
        effectActions={effectActions}
        activePlayer={activePlayer}
        myIndex={myIndex}
        send={send}
        gameState={gameState}
      />

      <RightRail
        myZones={myZones}
        opponents={opponents}
        gameState={gameState}
        activePlayer={activePlayer}
        playerNames={playerNames}
        numPlayers={numPlayers}
        possibleHands={possibleHands}
        setupSelection={isSetup ? setupSelection : null}
      />

      <HandZone
        myZones={myZones}
        isMyTurn={isMyTurn && phase._tag === "play"}
        activePlayerName={playerNames[activePlayer] ?? `Player ${activePlayer}`}
        legalActions={playActions}
        send={send}
        setupMode={isSetup && isMyTurn ? setupSelection : null}
        onSetupCardClick={isSetup && isMyTurn ? handleSetupCardClick : undefined}
        onCommitSetup={canCommitSetup ? handleCommitSetup : undefined}
        setupWaiting={isSetup && !isMyTurn}
      />

      <PreviewZone />
    </div>
  );
};
