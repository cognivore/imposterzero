import { useState, useEffect, useMemo, useCallback, useRef, type Dispatch, type SetStateAction, type ReactNode } from "react";
import type { PlayerId } from "@imposter-zero/types";
import type {
  IKPlayAction,
  IKSetupAction,
  IKRecruitAction,
  IKRecommissionAction,
  IKSelectKingAction,
  IKState,
  IKPlayerZones,
  CourtEntry,
  CardName,
} from "@imposter-zero/engine";
import type { ClientPhase } from "../state.js";
import type { IKClientMessage } from "../ws-client.js";
import { Card } from "./card/Card.js";
import { DisgracedCard } from "./card/DisgracedCard.js";
import { SetupSlot } from "./card/SetupSlot.js";
import { toCardVisual, ANONYMOUS_CARD, type CardVisual } from "./card/types.js";
import { useTrail, animated, to } from "@react-spring/web";
import { usePreviewStore } from "../stores/preview.js";
import { useGameLogStore } from "../stores/game-log.js";
import { useDisgracedTracker } from "../stores/disgraced-tracker.js";
import { useSeenCardsTracker } from "../stores/seen-cards.js";
import { computePossibleHand } from "../logic/hand-helper.js";
import { CountdownTimer } from "./CountdownTimer.js";
import { useTouchDevice } from "../hooks/useTouchDevice.js";

// ---------------------------------------------------------------------------
// Phase type covering all in-game phases
// ---------------------------------------------------------------------------

type InGamePhase = Extract<
  ClientPhase,
  | { readonly _tag: "drafting" }
  | { readonly _tag: "crown" }
  | { readonly _tag: "mustering" }
  | { readonly _tag: "setup" }
  | { readonly _tag: "play" }
  | { readonly _tag: "resolving" }
  | { readonly _tag: "scoring" }
  | { readonly _tag: "finished" }
>;

type GameplayPhase = Extract<
  ClientPhase,
  | { readonly _tag: "crown" }
  | { readonly _tag: "mustering" }
  | { readonly _tag: "setup" }
  | { readonly _tag: "play" }
  | { readonly _tag: "resolving" }
>;

interface Props {
  readonly phase: InGamePhase;
  readonly send: (msg: IKClientMessage) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PLAYER_COLORS = [
  "var(--player-0)",
  "var(--player-1)",
  "var(--player-2)",
  "var(--player-3)",
];

const kingFacetTitle = (facet: IKPlayerZones["king"]["facet"]): string | null => {
  switch (facet) {
    case "charismatic":
      return "Charismatic";
    case "masterTactician":
      return "Tactician";
    default:
      return null;
  }
};

const StackedZone: React.FC<{
  readonly label: string;
  readonly base: ReactNode;
  readonly overlay?: ReactNode | undefined;
  readonly overlayLabel?: string | undefined;
  readonly className?: string | undefined;
}> = ({ label, base, overlay, overlayLabel, className = "" }) => (
  <div className={`player-zone-slot ${className}`.trim()}>
    <div className="tt-zone-stack">
      <div className="tt-zone-stack__base">{base}</div>
      {overlay !== undefined && overlay !== null && (
        <div className="tt-zone-stack__overlay">
          {overlay}
          {overlayLabel && (
            <span className="tt-zone-stack__overlay-badge">{overlayLabel}</span>
          )}
        </div>
      )}
    </div>
    <span className="zone-label">{label}</span>
  </div>
);

const hasGameState = (
  phase: InGamePhase,
): phase is Extract<InGamePhase, { readonly gameState: IKState }> =>
  "gameState" in phase;

const hasActivePlayer = (
  phase: InGamePhase,
): phase is Extract<InGamePhase, { readonly activePlayer: PlayerId }> =>
  "activePlayer" in phase;

const hasTurnDeadline = (
  phase: InGamePhase,
): phase is Extract<InGamePhase, { readonly turnDeadline: number }> =>
  "turnDeadline" in phase;

const safeMyIndex = (phase: InGamePhase): PlayerId =>
  phase.myIndex ?? (0 as PlayerId);

const throneValue = (court: ReadonlyArray<CourtEntry>): number => {
  const top = court.at(-1);
  if (top === undefined) return 0;
  return top.face === "down" ? 1 : top.card.kind.props.value;
};

// ---------------------------------------------------------------------------
// MatchLog — scrollable match history
// ---------------------------------------------------------------------------

const MatchLog: React.FC = () => {
  const entries = useGameLogStore((s) => s.entries);
  const scrollRef = useRef<HTMLDivElement>(null);

  const matchEntries = useMemo(
    () => entries.filter((e) => e.kind === "round_start" || e.kind === "round_end"),
    [entries],
  );

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [matchEntries.length]);

  return (
    <div className="tt-match-log">
      <div className="tt-section-header">Match Log</div>
      <div className="tt-match-log__entries" ref={scrollRef}>
        {matchEntries.map((entry) => (
          <div key={entry.id} className="tt-match-log__entry">
            <span className="left-rail__system">{entry.description}</span>
          </div>
        ))}
        {matchEntries.length === 0 && (
          <div className="tt-empty-zone">No match events yet</div>
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// CardPreview — left column large preview
// ---------------------------------------------------------------------------

const CardPreview: React.FC = () => {
  const hoveredCard = usePreviewStore((s) => s.hoveredCard);
  const card = hoveredCard;

  return (
    <div className="tt-card-preview">
      <div className="tt-section-header">Card Preview</div>
      {card !== null ? (
        <div className="preview-card">
          {card.front.artwork.full !== null && (
            <img
              className="preview-artwork-full"
              src={card.front.artwork.full}
              alt={card.front.name}
              loading="lazy"
            />
          )}
          <div className={`preview-value card-value--${card.front.tier}`}>
            {card.front.value}
          </div>
          <div className="preview-name">{card.front.name}</div>
          {(card.front.keywords?.length ?? 0) > 0 && (
            <div className="preview-keywords">
              {card.front.keywords.map((kw) => (
                <span key={kw} className="preview-keyword">
                  {kw.replace(/_/g, " ")}
                </span>
              ))}
            </div>
          )}
          <div className="preview-divider" />
          <div className="preview-full-text">{card.front.fullText}</div>
          {(card.front.flavorText?.length ?? 0) > 0 && (
            <div className="preview-flavor">{card.front.flavorText}</div>
          )}
        </div>
      ) : (
        <div className="tt-empty-zone tt-empty-zone--preview">
          Hover a card to inspect
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// GameLog — scrollable turn-by-turn log
// ---------------------------------------------------------------------------

const GameLog: React.FC<{ readonly turnCount: number }> = ({ turnCount }) => {
  const entries = useGameLogStore((s) => s.entries);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [hasNew, setHasNew] = useState(false);

  const isNearBottom = useCallback((): boolean => {
    const el = scrollRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (isNearBottom()) {
      el.scrollTop = el.scrollHeight;
      setHasNew(false);
    } else {
      setHasNew(true);
    }
  }, [entries.length, isNearBottom]);

  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
      setHasNew(false);
    }
  };

  const handleScroll = () => {
    if (isNearBottom()) setHasNew(false);
  };

  return (
    <div className="tt-game-log">
      <div className="tt-section-header">
        Game Log{turnCount > 0 ? ` · T${turnCount}` : ""}
      </div>
      <div className="tt-game-log__entries" ref={scrollRef} onScroll={handleScroll}>
        {entries.map((entry) => (
          <div
            key={entry.id}
            className={`left-rail__entry left-rail__entry--${entry.kind}`}
          >
            {entry.kind === "round_start" || entry.kind === "round_end" ? (
              <span className="left-rail__system">{entry.description}</span>
            ) : entry.kind === "trace" ? (
              <span className="left-rail__trace">{entry.description}</span>
            ) : entry.kind === "mustering" ? (
              entry.playerIndex === -1 ? (
                <span className="left-rail__system">{entry.description}</span>
              ) : (
                <>
                  <span className="left-rail__player">{entry.playerName}</span>
                  <span className="left-rail__desc">{entry.description}</span>
                </>
              )
            ) : (
              <>
                <span className="left-rail__turn">T{entry.turnNumber}</span>
                <span className="left-rail__player">{entry.playerName}</span>
                <span className="left-rail__desc">{entry.description}</span>
              </>
            )}
          </div>
        ))}
        {entries.length === 0 && (
          <div className="tt-empty-zone">No actions yet</div>
        )}
      </div>
      <div
        className={`left-rail__new-indicator ${hasNew ? "left-rail__new-indicator--visible" : ""}`}
        onClick={scrollToBottom}
        role="button"
        tabIndex={hasNew ? 0 : -1}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") scrollToBottom();
        }}
      >
        ↓ New entries
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// CourtArea — throne stack (always present, content varies by phase)
// ---------------------------------------------------------------------------

const CourtArea: React.FC<{ readonly phase: InGamePhase }> = ({ phase }) => {
  const gameState = hasGameState(phase) ? phase.gameState : null;
  const court = gameState?.shared.court ?? [];
  const tv = throneValue(court);
  const playerNames = "playerNames" in phase ? phase.playerNames : [];
  const activePlayer = hasActivePlayer(phase) ? phase.activePlayer : null;

  if (court.length === 0) {
    return (
      <div className="tt-court">
        <span className="court-zone__throne-label">Court</span>
        <div className="court-zone__empty">
          {phase._tag === "drafting"
            ? "Selecting signatures..."
            : phase._tag === "crown"
              ? "Selecting first player..."
              : phase._tag === "mustering"
                ? "Mustering Phase"
                : phase._tag === "setup"
                  ? "Setup Phase"
                  : "No cards in court"}
        </div>
      </div>
    );
  }

  return (
    <div className="tt-court">
      <span className="court-zone__throne-label">
        Throne: {tv}
        {activePlayer !== null && (
          <span className="tt-court__active-label">
            {" "}— {(playerNames as readonly string[])[activePlayer] ?? `Player ${activePlayer}`}
          </span>
        )}
      </span>
      <div className="court-zone__stack">
        {court.map((entry, idx) => {
          const isTop = idx === court.length - 1;
          const entryClass = `court-zone__entry ${isTop ? "court-zone__entry--top" : ""}`;
          return (
            <div
              key={`court-${entry.card.id}-${idx}`}
              className={entryClass}
              style={{ zIndex: idx }}
            >
              {entry.face === "down" ? (
                <DisgracedCard visual={toCardVisual(entry.card)} size="small" />
              ) : (
                <Card
                  visual={toCardVisual(entry.card)}
                  orientation="front"
                  size="small"
                  previewSource="court"
                />
              )}
              <div
                className="court-zone__player-bar"
                style={{ background: PLAYER_COLORS[entry.playedBy] ?? PLAYER_COLORS[0] }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// PrimaryDialog — phase-specific main interaction area
// ---------------------------------------------------------------------------

const DraftContent: React.FC<{
  readonly phase: Extract<InGamePhase, { readonly _tag: "drafting" }>;
  readonly send: (msg: IKClientMessage) => void;
}> = ({ phase, send }) => {
  const { signaturePool, mySelections, selectionsNeeded, allReady } = phase;
  const [selected, setSelected] = useState<Set<string>>(new Set(mySelections));
  const [submitted, setSubmitted] = useState(mySelections.length > 0);

  const SIGNATURE_DESCRIPTIONS: Record<string, string> = {
    Flagbearer: "Value 1. Disgrace self to Recall + Rally twice.",
    Stranger: "Value 2. Copy Reactions in hand; copy Court card on play.",
    Aegis: "Value 3. Steadfast. Play on any card; Disgrace in Court.",
    Ancestor: "Value 4. Play on Royalty; Recall + Rally. Elders gain +3.",
    Informant: "Value 4. Guess Dungeon card name; take it or Rally.",
    Nakturn: "Value 4. Bluff game; opponent guesses, Condemn if wrong.",
    Lockshift: "Value 5. Reveal all Dungeons; return them to hands.",
    Conspiracist: "Value 6. Steadfast. Grant Steadfast +1 to next plays.",
    Exile: "Value 8. Steadfast. Mute all on play; weaker vs high Court.",
  };

  const toggleCard = useCallback((name: string) => {
    if (submitted) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else if (next.size < selectionsNeeded) {
        next.add(name);
      }
      return next;
    });
  }, [submitted, selectionsNeeded]);

  const handleSubmit = useCallback(() => {
    if (selected.size !== selectionsNeeded) return;
    send({ type: "draft_select", cards: [...selected] });
    setSubmitted(true);
  }, [selected, selectionsNeeded, send]);

  if (allReady) {
    return (
      <div className="tt-dialog-content">
        <h2 className="tt-phase-title">Armies Assembled</h2>
        <p className="tt-phase-subtitle">Starting the match...</p>
      </div>
    );
  }

  return (
    <div className="tt-dialog-content">
      <h2 className="tt-phase-title">Select Your Signature Cards</h2>
      <p className="tt-phase-subtitle">
        {submitted
          ? "Waiting for opponent to select..."
          : `Choose ${selectionsNeeded} cards for your Army (${selected.size}/${selectionsNeeded})`}
      </p>
      <div className="draft-pool">
        {signaturePool.map((name) => {
          const isSelected = selected.has(name);
          const canSelect = !submitted && (isSelected || selected.size < selectionsNeeded);
          return (
            <div
              key={name}
              className={`draft-card ${isSelected ? "draft-card--selected" : ""} ${!canSelect && !isSelected ? "draft-card--disabled" : ""}`}
              onClick={() => canSelect || isSelected ? toggleCard(name) : undefined}
            >
              <div className="draft-card__name">{name}</div>
              <div className="draft-card__desc">
                {SIGNATURE_DESCRIPTIONS[name] ?? ""}
              </div>
            </div>
          );
        })}
      </div>
      {!submitted && (
        <div className="draft-actions" style={{ marginTop: "var(--space-md)" }}>
          <button
            className="btn btn-primary"
            disabled={selected.size !== selectionsNeeded}
            onClick={handleSubmit}
          >
            Confirm Selection
          </button>
        </div>
      )}
    </div>
  );
};

const CrownContent: React.FC<{
  readonly phase: Extract<InGamePhase, { readonly _tag: "crown" }>;
  readonly send: (msg: IKClientMessage) => void;
}> = ({ phase, send }) => {
  const { activePlayer, myIndex, numPlayers, playerNames } = phase;
  const isMyTurn = activePlayer === myIndex;
  const trueKingName = playerNames[activePlayer] ?? `Player ${activePlayer}`;

  const handleChoose = (player: PlayerId) => {
    send({ type: "action", action: { kind: "crown", firstPlayer: player } });
  };

  const players = Array.from({ length: numPlayers }, (_, i) => i as PlayerId);

  return (
    <div className="tt-dialog-content">
      <h2 className="tt-phase-title">True King</h2>
      {isMyTurn ? (
        <>
          <p className="tt-phase-subtitle">You are the True King. Choose who plays first.</p>
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
        <p className="tt-phase-subtitle">
          <strong>{trueKingName}</strong> is the True King and is choosing who plays first...
        </p>
      )}
    </div>
  );
};

interface MusteringSelection {
  readonly selectedHandCard: number | null;
  readonly selectedArmyCard: number | null;
  readonly recommExhaust1: number | null;
  readonly recommExhaust2: number | null;
  readonly recommRecover: number | null;
}

const EMPTY_MUSTERING_SELECTION: MusteringSelection = {
  selectedHandCard: null,
  selectedArmyCard: null,
  recommExhaust1: null,
  recommExhaust2: null,
  recommRecover: null,
};

const MusteringContent: React.FC<{
  readonly phase: Extract<InGamePhase, { readonly _tag: "mustering" }>;
  readonly send: (msg: IKClientMessage) => void;
  readonly selection: MusteringSelection;
  readonly setSelection: Dispatch<SetStateAction<MusteringSelection>>;
}> = ({ phase, send, selection, setSelection }) => {
  const { gameState, legalActions, activePlayer, myIndex, playerNames } = phase;
  const isMyTurn = activePlayer === myIndex;
  const hasBegunRecruiting = gameState.hasExhaustedThisMustering;

  const canRecruit = legalActions.some((a) => a.kind === "recruit");
  const canSelectCharismatic = legalActions.some(
    (a) => a.kind === "select_king" && a.facet === "charismatic",
  );
  const canSelectTactician = legalActions.some(
    (a) => a.kind === "select_king" && a.facet === "masterTactician",
  );

  const {
    selectedHandCard,
    selectedArmyCard,
    recommExhaust1,
    recommExhaust2,
    recommRecover,
  } = selection;

  const handleRecruit = useCallback(() => {
    if (selectedHandCard === null || selectedArmyCard === null) return;
    const action = legalActions.find(
      (a): a is IKRecruitAction =>
        a.kind === "recruit" &&
        a.discardFromHandId === selectedHandCard &&
        a.takeFromArmyId === selectedArmyCard,
    );
    if (!action) return;
    send({ type: "action", action });
    setSelection((prev) => ({
      ...prev,
      selectedHandCard: null,
      selectedArmyCard: null,
    }));
  }, [selectedHandCard, selectedArmyCard, legalActions, send, setSelection]);

  const handleRecommission = useCallback(() => {
    if (recommExhaust1 === null || recommExhaust2 === null || recommRecover === null) return;
    const action = legalActions.find(
      (a): a is IKRecommissionAction =>
        a.kind === "recommission" &&
        ((a.exhaust1Id === recommExhaust1 && a.exhaust2Id === recommExhaust2) ||
         (a.exhaust1Id === recommExhaust2 && a.exhaust2Id === recommExhaust1)) &&
        a.recoverFromExhaustId === recommRecover,
    );
    if (!action) return;
    send({ type: "action", action });
    setSelection((prev) => ({
      ...prev,
      recommExhaust1: null,
      recommExhaust2: null,
      recommRecover: null,
    }));
  }, [recommExhaust1, recommExhaust2, recommRecover, legalActions, send, setSelection]);

  const handleEndMustering = useCallback(() => {
    send({ type: "action", action: { kind: "end_mustering" } });
  }, [send]);

  const handleSelectKing = useCallback((
    facet: IKSelectKingAction["facet"],
  ) => {
    const action = legalActions.find(
      (a): a is IKSelectKingAction =>
        a.kind === "select_king" &&
        a.facet === facet,
    );
    if (!action) return;
    send({ type: "action", action });
  }, [legalActions, send]);

  const recruitValid = canRecruit && selectedHandCard !== null && selectedArmyCard !== null &&
    legalActions.some((a) =>
      a.kind === "recruit" &&
      a.discardFromHandId === selectedHandCard &&
      a.takeFromArmyId === selectedArmyCard,
    );

  const recommValid = recommExhaust1 !== null && recommExhaust2 !== null && recommRecover !== null &&
    legalActions.some((a) =>
      a.kind === "recommission" &&
      ((a.exhaust1Id === recommExhaust1 && a.exhaust2Id === recommExhaust2) ||
       (a.exhaust1Id === recommExhaust2 && a.exhaust2Id === recommExhaust1)) &&
      a.recoverFromExhaustId === recommRecover,
    );

  const activePlayerName = playerNames[activePlayer] ?? "opponent";
  const statusText = isMyTurn
    ? canSelectCharismatic || canSelectTactician
      ? "Choose a king or continue mustering."
      : hasBegunRecruiting
        ? "You may recruit (discard a hand card, take an army card), recommission, or pass."
        : "Exhaust an army card to begin recruiting, recommission, or pass."
    : `Waiting for ${activePlayerName} to muster...`;

  return (
    <div className="tt-dialog-content">
      <h2 className="tt-phase-title">Mustering Phase</h2>
      <p className="tt-phase-subtitle">{statusText}</p>
      <div className="mustering-actions">
        {isMyTurn && (
          <>
            {canSelectCharismatic && (
              <button
                className="btn btn-secondary"
                onClick={() => handleSelectKing("charismatic")}
              >
                Charismatic Leader
              </button>
            )}
            {canSelectTactician && (
              <button
                className="btn btn-secondary"
                onClick={() => handleSelectKing("masterTactician")}
              >
                Master Tactician
              </button>
            )}
            {recruitValid && (
              <button className="btn btn-primary" onClick={handleRecruit}>Recruit</button>
            )}
            {recommValid && (
              <button className="btn btn-secondary" onClick={handleRecommission}>Recommission</button>
            )}
            <button className="btn btn-ghost" onClick={handleEndMustering}>Done</button>
          </>
        )}
      </div>
    </div>
  );
};

const MusteringSecondary: React.FC<{
  readonly phase: Extract<InGamePhase, { readonly _tag: "mustering" }>;
  readonly send: (msg: IKClientMessage) => void;
  readonly selection: MusteringSelection;
  readonly setSelection: Dispatch<SetStateAction<MusteringSelection>>;
}> = ({ phase, send, selection, setSelection }) => {
  const { gameState, legalActions, activePlayer, myIndex } = phase;
  const isMyTurn = activePlayer === myIndex;
  const myZones = gameState.players[myIndex]!;
  const armyCards = myZones.army;
  const hasBegunRecruiting = gameState.hasExhaustedThisMustering;
  const canBeginRecruit = legalActions.some((a) => a.kind === "begin_recruit");
  const canRecruit = legalActions.some((a) => a.kind === "recruit");
  const canRecommission = legalActions.some((a) => a.kind === "recommission");

  const toggleRecommissionArmy = useCallback((cardId: number) => {
    setSelection((prev) => {
      if (prev.recommExhaust1 === cardId) {
        return {
          ...prev,
          selectedHandCard: null,
          selectedArmyCard: null,
          recommExhaust1: prev.recommExhaust2,
          recommExhaust2: null,
        };
      }
      if (prev.recommExhaust2 === cardId) {
        return {
          ...prev,
          selectedHandCard: null,
          selectedArmyCard: null,
          recommExhaust2: null,
        };
      }
      if (prev.recommExhaust1 === null) {
        return {
          ...prev,
          selectedHandCard: null,
          selectedArmyCard: null,
          recommExhaust1: cardId,
        };
      }
      if (prev.recommExhaust2 === null) {
        return {
          ...prev,
          selectedHandCard: null,
          selectedArmyCard: null,
          recommExhaust2: cardId,
        };
      }
      return {
        ...prev,
        selectedHandCard: null,
        selectedArmyCard: null,
        recommExhaust1: cardId,
        recommExhaust2: null,
      };
    });
  }, [setSelection]);

  const handleArmyClick = useCallback((cardId: number) => {
    if (!isMyTurn) return;

    if (canBeginRecruit && !hasBegunRecruiting) {
      send({ type: "action", action: { kind: "begin_recruit", exhaustCardId: cardId } });
      return;
    }

    if (
      selection.recommRecover !== null ||
      selection.recommExhaust1 !== null ||
      selection.recommExhaust2 !== null
    ) {
      if (!canRecommission) return;
      toggleRecommissionArmy(cardId);
      return;
    }

    if (canRecruit) {
      setSelection((prev) => ({
        ...prev,
        recommExhaust1: null,
        recommExhaust2: null,
        recommRecover: null,
        selectedArmyCard: prev.selectedArmyCard === cardId ? null : cardId,
      }));
      return;
    }

    if (canRecommission) {
      toggleRecommissionArmy(cardId);
    }
  }, [
    canBeginRecruit,
    canRecruit,
    canRecommission,
    hasBegunRecruiting,
    isMyTurn,
    selection.recommExhaust1,
    selection.recommExhaust2,
    selection.recommRecover,
    send,
    setSelection,
    toggleRecommissionArmy,
  ]);

  const interactive = isMyTurn && (canBeginRecruit || canRecruit || canRecommission);

  return (
    <div>
      <span className="zone-label">Your Army ({armyCards.length})</span>
      <div className="mustering-cards">
        {armyCards.map((card) => {
          const selectedClass =
            selection.selectedArmyCard === card.id
              ? "selected-recruit"
              : selection.recommExhaust1 === card.id || selection.recommExhaust2 === card.id
                ? "selected-recomm"
                : "";
          return (
            <div
              key={card.id}
              className={`mustering-card-slot ${selectedClass} ${interactive ? "mustering-card-slot--active" : "mustering-card-slot--readonly"}`.trim()}
              onClick={interactive ? () => handleArmyClick(card.id) : undefined}
              role={interactive ? "button" : undefined}
              tabIndex={interactive ? 0 : undefined}
              onKeyDown={interactive ? (e) => {
                if (e.key === "Enter" || e.key === " ") handleArmyClick(card.id);
              } : undefined}
            >
              <Card
                visual={toCardVisual(card)}
                orientation="front"
                size="small"
                previewSource="hand"
                interactive={interactive}
                selected={selectedClass !== ""}
              />
              {canBeginRecruit && !hasBegunRecruiting && isMyTurn && (
                <button
                  className="card-action-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleArmyClick(card.id);
                  }}
                >
                  Exhaust
                </button>
              )}
            </div>
          );
        })}
        {armyCards.length === 0 && <div className="empty-zone">No cards</div>}
      </div>
    </div>
  );
};

const MusteringTertiary: React.FC<{
  readonly phase: Extract<InGamePhase, { readonly _tag: "mustering" }>;
  readonly selection: MusteringSelection;
  readonly setSelection: Dispatch<SetStateAction<MusteringSelection>>;
}> = ({ phase, selection, setSelection }) => {
  const { gameState, myIndex, activePlayer, legalActions } = phase;
  const myZones = gameState.players[myIndex]!;
  const exhaustedCards = myZones.exhausted;
  const isMyTurn = activePlayer === myIndex;
  const canRecommission = legalActions.some((a) => a.kind === "recommission");

  if (exhaustedCards.length === 0) return null;

  const interactive = isMyTurn && canRecommission;

  return (
    <div>
      <span className="zone-label">Exhausted ({exhaustedCards.length})</span>
      <div className="mustering-cards">
        {exhaustedCards.map((card) => {
          const selected = selection.recommRecover === card.id;
          return (
            <div
              key={card.id}
              className={`mustering-card-slot ${selected ? "selected-recover" : ""} ${interactive ? "mustering-card-slot--active" : "mustering-card-slot--readonly"}`.trim()}
              onClick={interactive ? () => {
                setSelection((prev) => ({
                  ...prev,
                  selectedHandCard: null,
                  selectedArmyCard: null,
                  recommRecover: prev.recommRecover === card.id ? null : card.id,
                }));
              } : undefined}
              role={interactive ? "button" : undefined}
              tabIndex={interactive ? 0 : undefined}
            >
              <Card
                visual={toCardVisual(card)}
                orientation="front"
                size="small"
                previewSource="hand"
                interactive={interactive}
                selected={selected}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};

const SetupContent: React.FC<{
  readonly phase: Extract<InGamePhase, { readonly _tag: "setup" }>;
  readonly setupSelection: SetupSelection;
}> = ({ phase, setupSelection }) => {
  const { activePlayer, myIndex } = phase;
  const isMyTurn = activePlayer === myIndex;

  return (
    <div className="tt-dialog-content">
      <h2 className="tt-phase-title">Setup Phase</h2>
      <p className="tt-phase-subtitle">
        {isMyTurn ? "Choose your Successor and Dungeon cards" : "Waiting for other players..."}
      </p>
      <div className="setup-slots">
        <SetupSlot
          kind="successor"
          card={setupSelection.successorVisual}
        />
        <SetupSlot
          kind="dungeon"
          card={setupSelection.dungeonVisual}
        />
      </div>
    </div>
  );
};

const PlayContent: React.FC<{
  readonly phase: Extract<InGamePhase, { readonly _tag: "play" }>;
}> = ({ phase }) => {
  const { activePlayer, myIndex, playerNames } = phase;
  const isMyTurn = activePlayer === myIndex;

  return (
    <div className="tt-dialog-content tt-dialog-content--minimal">
      {isMyTurn ? (
        <span className="tt-turn-indicator tt-turn-indicator--mine">Your turn</span>
      ) : (
        <span className="tt-turn-indicator tt-turn-indicator--waiting">
          {playerNames[activePlayer] ?? `Player ${activePlayer}`} is thinking...
        </span>
      )}
    </div>
  );
};

const findCardVisualInState = (gameState: IKState, cardId: number): CardVisual | null => {
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

const ResolvingContent: React.FC<{
  readonly phase: Extract<InGamePhase, { readonly _tag: "resolving" }>;
  readonly send: (msg: IKClientMessage) => void;
}> = ({ phase, send }) => {
  const { gameState, legalActions: effectActions, activePlayer, myIndex, playerNames } = phase;
  const pending = gameState.pendingResolution;
  const court = gameState.shared.court;

  if (pending === null) return null;

  const choosingPlayer = pending.choosingPlayer ?? activePlayer;
  const isMyChoice = choosingPlayer === myIndex;
  const options = pending.currentOptions ?? [];
  const topCard = court.at(-1);
  const contextCardName = topCard ? topCard.card.kind.name : "card";
  const isReaction = pending.isReactionWindow ?? false;

  const handleChoice = (choiceIndex: number) => {
    send({ type: "action", action: { kind: "effect_choice", choice: choiceIndex } });
  };

  if (!isMyChoice) {
    return (
      <div className="tt-dialog-content">
        <div className="inline-choice-bar">
          <div className="inline-choice-bar__waiting">
            {isReaction
              ? `${playerNames[choosingPlayer] ?? `Player ${choosingPlayer}`} — reaction window...`
              : `${playerNames[choosingPlayer] ?? `Player ${choosingPlayer}`} is choosing...`}
          </div>
        </div>
      </div>
    );
  }

  const descriptionForOptions = (opts: readonly import("@imposter-zero/engine").ChoiceOption[]): string => {
    if (opts.length === 0) return "make a choice";
    const first = opts[0];
    if (!first) return "make a choice";
    switch (first.kind) {
      case "card": return "choose a card";
      case "player": return "choose a player";
      case "cardName": return "name a card";
      case "value": return "choose a value";
      case "pass":
      case "proceed": return "decide";
      case "yesNo": return "answer yes or no";
    }
  };

  const reactionContext = isReaction
    ? `${contextCardName} — react with King's Hand?`
    : `${contextCardName} — ${descriptionForOptions(options)}:`;

  return (
    <div className="tt-dialog-content">
      <div className="inline-choice-bar" style={{ maxHeight: "none" }}>
        <div className="inline-choice-bar__context">
          <span className="inline-choice-bar__card-name">{reactionContext}</span>
        </div>
        <div className="inline-choice-bar__options" role="group" aria-label="Choice options">
          {options.map((option, idx) => {
            const enabled = effectActions.some((a) => a.choice === idx);
            const labelOverride = isReaction
              ? option.kind === "proceed" ? "React with King's Hand" : "Pass"
              : undefined;

            const content = labelOverride ? (
              <span>{labelOverride}</span>
            ) : (() => {
              switch (option.kind) {
                case "card": {
                  const visual = findCardVisualInState(gameState, option.cardId);
                  return visual ? (
                    <>
                      <Card visual={visual} orientation="front" size="small" />
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
                case "yesNo":
                  return <span>{option.value ? "Yes" : "No"}</span>;
              }
            })();

            const baseClass = "inline-choice-bar__btn";
            const variantClass =
              option.kind === "proceed"
                ? `${baseClass} ${baseClass}--primary`
                : option.kind === "pass"
                  ? `${baseClass} ${baseClass}--secondary`
                  : baseClass;

            return (
              <button
                key={idx}
                className={variantClass}
                onClick={() => handleChoice(idx)}
                disabled={!enabled}
                tabIndex={0}
              >
                {content}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

const scoreClass = (score: number): string =>
  score > 0 ? "score-positive" : score < 0 ? "score-negative" : "";

const formatRound = (score: number): string =>
  score > 0 ? `+${score}` : String(score);

const ScoringContent: React.FC<{
  readonly phase: Extract<InGamePhase, { readonly _tag: "scoring" }>;
  readonly send: (msg: IKClientMessage) => void;
}> = ({ phase, send }) => {
  const { roundScores, matchScores, roundsPlayed, numPlayers, myIndex, playerNames, readyPlayers, name } = phase;
  const handleReady = () => send({ type: "ready", ready: true });
  const amReady = readyPlayers.includes(name);
  const players = Array.from({ length: numPlayers }, (_, i) => i as PlayerId);

  return (
    <div className="tt-dialog-content">
      <h2 className="tt-phase-title">Round {roundsPlayed} Complete</h2>
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
        <button className="btn btn-primary" onClick={handleReady} disabled={amReady}>
          {amReady ? "Waiting for others\u2026" : "Ready"}
        </button>
      </div>
    </div>
  );
};

const ScoringSecondary: React.FC<{
  readonly phase: Extract<InGamePhase, { readonly _tag: "scoring" }>;
}> = ({ phase }) => {
  const { gameState, numPlayers, myIndex, playerNames, roundScores } = phase;
  const players = Array.from({ length: numPlayers }, (_, i) => i as PlayerId);

  return (
    <div className="scoring-players">
      {players.map((i) => {
        const zones = gameState.players[i];
        if (!zones) return null;
        const round = roundScores[i] ?? 0;
        return (
          <div key={i} className={`scoring-player ${i === myIndex ? "is-me" : ""}`}>
            <div className="scoring-player__name">{playerNames[i] ?? `Player ${i}`}</div>
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
      })}
    </div>
  );
};

const ScoringTertiary: React.FC<{
  readonly phase: Extract<InGamePhase, { readonly _tag: "scoring" }>;
}> = ({ phase }) => {
  const { gameState } = phase;
  const { forgotten, accused, condemned } = gameState.shared;
  const hasAny = forgotten !== null || accused !== null || condemned.length > 0;

  if (!hasAny) return null;

  return (
    <div className="scoring-side-zones">
      {forgotten !== null && (
        <div className="scoring-side-zone">
          <span className="zone-label">Forgotten</span>
          <Card visual={toCardVisual(forgotten.card)} orientation="front" size="small" />
        </div>
      )}
      {accused !== null && (
        <div className="scoring-side-zone">
          <span className="zone-label">Accused</span>
          <Card visual={toCardVisual(accused)} orientation="front" size="small" />
        </div>
      )}
      {condemned.map((entry, idx) => (
        <div key={idx} className="scoring-side-zone">
          <span className="zone-label">Condemned</span>
          <Card visual={toCardVisual(entry.card)} orientation="front" size="small" />
        </div>
      ))}
    </div>
  );
};

const FinishedContent: React.FC<{
  readonly phase: Extract<InGamePhase, { readonly _tag: "finished" }>;
  readonly send: (msg: IKClientMessage) => void;
}> = ({ phase, send }) => {
  const { winners, finalScores, numPlayers, playerNames } = phase;
  const winnerSet = new Set(winners);
  const winnerNames = winners.map((w) => playerNames[w] ?? `Player ${w}`);
  const handleLeave = () => send({ type: "leave_room" });

  return (
    <div className="tt-dialog-content">
      <h2 className="tt-phase-title">Match Over</h2>
      <div className="winner-banner">
        {winnerNames.length === 1
          ? `${winnerNames[0]} wins!`
          : `${winnerNames.join(" & ")} win!`}
      </div>
      <table className="score-table">
        <thead>
          <tr><th>Player</th><th>Final Score</th><th></th></tr>
        </thead>
        <tbody>
          {Array.from({ length: numPlayers }, (_, i) => (
            <tr key={i} className={winnerSet.has(i) ? "winner-row" : ""}>
              <td>{playerNames[i] ?? `Player ${i}`}</td>
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

const PrimaryDialog: React.FC<{
  readonly phase: InGamePhase;
  readonly send: (msg: IKClientMessage) => void;
  readonly setupSelection: SetupSelection;
  readonly musteringSelection: MusteringSelection;
  readonly setMusteringSelection: Dispatch<SetStateAction<MusteringSelection>>;
}> = ({ phase, send, setupSelection, musteringSelection, setMusteringSelection }) => {
  switch (phase._tag) {
    case "drafting":
      return <DraftContent phase={phase} send={send} />;
    case "crown":
      return <CrownContent phase={phase} send={send} />;
    case "mustering":
      return (
        <MusteringContent
          phase={phase}
          send={send}
          selection={musteringSelection}
          setSelection={setMusteringSelection}
        />
      );
    case "setup":
      return <SetupContent phase={phase} setupSelection={setupSelection} />;
    case "play":
      return <PlayContent phase={phase} />;
    case "resolving":
      return <ResolvingContent phase={phase} send={send} />;
    case "scoring":
      return <ScoringContent phase={phase} send={send} />;
    case "finished":
      return <FinishedContent phase={phase} send={send} />;
  }
};

// ---------------------------------------------------------------------------
// SecondaryDialog
// ---------------------------------------------------------------------------

const SecondaryDialog: React.FC<{
  readonly phase: InGamePhase;
  readonly send: (msg: IKClientMessage) => void;
  readonly musteringSelection: MusteringSelection;
  readonly setMusteringSelection: Dispatch<SetStateAction<MusteringSelection>>;
}> = ({ phase, send, musteringSelection, setMusteringSelection }) => {
  switch (phase._tag) {
    case "mustering":
      return (
        <MusteringSecondary
          phase={phase}
          send={send}
          selection={musteringSelection}
          setSelection={setMusteringSelection}
        />
      );
    case "scoring":
      return <ScoringSecondary phase={phase} />;
    default:
      return null;
  }
};

// ---------------------------------------------------------------------------
// TertiaryDialog
// ---------------------------------------------------------------------------

const TertiaryDialog: React.FC<{
  readonly phase: InGamePhase;
  readonly musteringSelection: MusteringSelection;
  readonly setMusteringSelection: Dispatch<SetStateAction<MusteringSelection>>;
}> = ({ phase, musteringSelection, setMusteringSelection }) => {
  switch (phase._tag) {
    case "mustering":
      return (
        <MusteringTertiary
          phase={phase}
          selection={musteringSelection}
          setSelection={setMusteringSelection}
        />
      );
    case "scoring":
      return <ScoringTertiary phase={phase} />;
    default:
      return null;
  }
};

// ---------------------------------------------------------------------------
// OpponentZones (right column, top)
// ---------------------------------------------------------------------------

const HandHelperInline: React.FC<{
  readonly count: number;
  readonly possibleCards: readonly string[];
}> = ({ count, possibleCards }) => (
  <div className="hand-helper">
    <div className="hand-helper__count">
      <span className="hand-helper__number">{count}</span>
      <span className="hand-helper__label">cards in hand</span>
    </div>
    {possibleCards.length > 0 && (
      <>
        <div className="hand-helper__possible-label">Possible:</div>
        <div className="hand-helper__cards">
          {possibleCards.map((cardName) => (
            <span
              key={cardName}
              className="hand-helper__card-wrapper"
              style={{
                fontSize: "0.5rem",
                color: "var(--text-dim)",
                background: "var(--surface-raised)",
                borderRadius: "2px",
                padding: "1px 3px",
                opacity: 0.5,
              }}
            >
              {cardName}
            </span>
          ))}
        </div>
      </>
    )}
  </div>
);

const SingleOpponent: React.FC<{
  readonly opIdx: PlayerId;
  readonly zones: IKPlayerZones;
  readonly name: string;
  readonly isActive: boolean;
  readonly handHelperCards: readonly string[] | null;
}> = ({ opIdx, zones, name, isActive, handHelperCards }) => {
  const facet = kingFacetTitle(zones.king.facet);

  return (
    <div
      className={`opponent-panel ${isActive ? "opponent-panel--active" : ""}`}
      aria-label={`${name}'s zones`}
    >
      <div className="opponent-panel__header">
        <div className="opponent-panel__name">
          {name}
          {isActive && <span className="opponent-panel__acting"> (acting)</span>}
        </div>
        {facet && <span className="tt-facet-badge">{facet}</span>}
      </div>

      {(zones.parting.length > 0 || zones.antechamber.length > 0) && (
        <div className="tt-opponent-ante-parting">
          {zones.parting.length > 0 && (
            <div className="tt-opponent-subzone">
              <span className="zone-label">Parting</span>
              <div className="tt-card-row">
                {zones.parting.map((c) => (
                  <Card key={c.id} visual={toCardVisual(c)} orientation="front" size="small" previewSource="opponent" />
                ))}
              </div>
            </div>
          )}
          {zones.antechamber.length > 0 && (
            <div className="tt-opponent-subzone">
              <span className="zone-label">Antechamber</span>
              <div className="tt-card-row">
                {zones.antechamber.map((c) => (
                  <Card key={c.id} visual={toCardVisual(c)} orientation="front" size="small" previewSource="opponent" />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="opponent-panel__zones">
        <div className="opponent-panel__zone">
          <span className="zone-label">K</span>
          <Card
            visual={toCardVisual(zones.king.card)}
            orientation={zones.king.face === "up" ? "front" : "back"}
            size="small"
            previewSource="opponent"
          />
        </div>
        <div className="opponent-panel__zone">
          <span className="zone-label">S</span>
          {zones.successor !== null ? (
            <Card visual={ANONYMOUS_CARD} orientation="back" size="small" />
          ) : (
            <div className="player-zone-slot__placeholder" />
          )}
        </div>
        <StackedZone
          label="D"
          className="opponent-panel__zone"
          base={
            zones.dungeon !== null
              ? <Card visual={ANONYMOUS_CARD} orientation="back" size="small" />
              : <div className="player-zone-slot__placeholder" />
          }
          overlay={
            zones.squire !== null
              ? <Card visual={ANONYMOUS_CARD} orientation="back" size="small" />
              : undefined
          }
          overlayLabel={zones.squire !== null ? "Sq" : undefined}
        />
      </div>

      <div className="opponent-panel__hand">
        {handHelperCards == null ? (
          <>
            <Card visual={ANONYMOUS_CARD} orientation="back" size="small" />
            {zones.hand.length > 0 && (
              <span className="opponent-panel__hand-count">{zones.hand.length}</span>
            )}
          </>
        ) : (
          <HandHelperInline count={zones.hand.length} possibleCards={handHelperCards} />
        )}
      </div>

      {(zones.army.length > 0 || zones.exhausted.length > 0) && (
        <div className="tt-opponent-counts">
          <span className="army-count-badge">Army: {zones.army.length}</span>
          <span className="army-count-badge">Exh: {zones.exhausted.length}</span>
        </div>
      )}
    </div>
  );
};

const OpponentZones: React.FC<{
  readonly phase: InGamePhase;
  readonly possibleHands: Map<PlayerId, readonly CardName[]> | null;
}> = ({ phase, possibleHands }) => {
  if (!hasGameState(phase)) {
    if (phase._tag === "drafting" || phase._tag === "finished") {
      const playerNames = phase.playerNames;
      return (
        <div className="tt-opponents">
          <span className="zone-label">Opponents</span>
          {playerNames.map((pName, idx) => (
            <div key={idx} className="opponent-panel">
              <div className="opponent-panel__name">{pName}</div>
            </div>
          ))}
        </div>
      );
    }
    return null;
  }

  const { gameState, playerNames } = phase;
  const myIndex = safeMyIndex(phase);
  const activePlayer = hasActivePlayer(phase) ? phase.activePlayer : (0 as PlayerId);

  const opponents = Array.from({ length: gameState.numPlayers }, (_, i) => i as PlayerId).filter(
    (i) => i !== myIndex,
  );

  return (
    <div className="tt-opponents">
      <span className="zone-label">Opponents</span>
      {opponents.map((opIdx) => {
        const opZones = gameState.players[opIdx];
        if (opZones === undefined) return null;
        return (
          <SingleOpponent
            key={opIdx}
            opIdx={opIdx}
            zones={opZones}
            name={(playerNames as readonly string[])[opIdx] ?? `Player ${opIdx}`}
            isActive={activePlayer === opIdx}
            handHelperCards={possibleHands?.get(opIdx) ?? null}
          />
        );
      })}
    </div>
  );
};

// ---------------------------------------------------------------------------
// SharedZones (right column, middle)
// ---------------------------------------------------------------------------

const SharedZones: React.FC<{ readonly phase: InGamePhase }> = ({ phase }) => {
  const gameState = hasGameState(phase) ? phase.gameState : null;
  if (!gameState) return <div className="tt-shared-zones" />;

  const { accused, forgotten, condemned } = gameState.shared;
  const hasAny = accused !== null || forgotten !== null || condemned.length > 0;
  if (!hasAny) return <div className="tt-shared-zones" />;

  return (
    <div className="tt-shared-zones">
      {accused !== null && (
        <div className="tt-shared-slot">
          <span className="zone-label">Accused</span>
          <Card visual={toCardVisual(accused)} orientation="front" size="small" previewSource="side" />
        </div>
      )}
      {forgotten !== null && (
        <div className="tt-shared-slot">
          <span className="zone-label">Forgotten</span>
          <Card visual={toCardVisual(forgotten.card)} orientation="back" size="small" />
        </div>
      )}
      {condemned.map((entry, idx) => (
        <div key={idx} className="tt-shared-slot">
          <span className="zone-label">Condemned</span>
          <Card visual={toCardVisual(entry.card)} orientation="back" size="small" />
        </div>
      ))}
    </div>
  );
};

// ---------------------------------------------------------------------------
// HeroZones (right column, bottom)
// ---------------------------------------------------------------------------

const HeroZones: React.FC<{
  readonly phase: InGamePhase;
  readonly setupSelection: SetupSelection;
}> = ({ phase, setupSelection }) => {
  const gameState = hasGameState(phase) ? phase.gameState : null;
  if (!gameState) return <div className="tt-hero-zones" />;

  const myZones = gameState.players[safeMyIndex(phase)];
  if (myZones === undefined) return <div className="tt-hero-zones" />;

  const pendingSuccessor = setupSelection.successorVisual;
  const pendingDungeon = setupSelection.dungeonVisual;
  const facet = kingFacetTitle(myZones.king.facet);

  return (
    <div className="tt-hero-zones">
      <div className="tt-hero-zones__header">
        <span className="zone-label">Your Zones</span>
        {facet && <span className="tt-facet-badge">{facet}</span>}
      </div>
      <div className="player-zones">
        <div className="player-zone-slot">
          <Card
            visual={toCardVisual(myZones.king.card)}
            orientation={myZones.king.face === "up" ? "front" : "back"}
            size="small"
            previewSource="hand"
          />
          <span className="zone-label">King</span>
        </div>

        <div className="player-zone-slot">
          {myZones.successor !== null ? (
            <Card
              visual={toCardVisual(myZones.successor.card)}
              orientation="back"
              size="small"
              previewSource="hand"
              forcePreview
            />
          ) : pendingSuccessor ? (
            <div className="player-zone-slot__pending player-zone-slot__pending--successor">
              <Card visual={pendingSuccessor} orientation="front" size="small" previewSource="hand" />
            </div>
          ) : (
            <div className={`player-zone-slot__placeholder ${phase._tag === "setup" ? "player-zone-slot__placeholder--awaiting player-zone-slot__placeholder--successor" : ""}`} />
          )}
          <span className="zone-label">Successor</span>
        </div>
        <StackedZone
          label="Dungeon"
          base={
            myZones.dungeon !== null ? (
              <Card
                visual={toCardVisual(myZones.dungeon.card)}
                orientation="back"
                size="small"
                previewSource="hand"
                forcePreview
              />
            ) : pendingDungeon ? (
              <div className="player-zone-slot__pending player-zone-slot__pending--dungeon">
                <Card visual={pendingDungeon} orientation="front" size="small" previewSource="hand" />
              </div>
            ) : (
              <div className={`player-zone-slot__placeholder ${phase._tag === "setup" ? "player-zone-slot__placeholder--awaiting player-zone-slot__placeholder--dungeon" : ""}`} />
            )
          }
          overlay={
            myZones.squire !== null ? (
              <Card
                visual={toCardVisual(myZones.squire.card)}
                orientation="back"
                size="small"
                previewSource="hand"
                forcePreview
              />
            ) : undefined
          }
          overlayLabel={myZones.squire !== null ? "Sq" : undefined}
        />
      </div>
      {(myZones.army.length > 0 || myZones.exhausted.length > 0) && (
        <div className="tt-player-counts">
          <span className="army-count-badge">Army: {myZones.army.length}</span>
          <span className="army-count-badge">Exh: {myZones.exhausted.length}</span>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// HeroHand (bottom strip)
// ---------------------------------------------------------------------------

interface SetupSelection {
  readonly successorId: number | null;
  readonly dungeonId: number | null;
  readonly successorVisual: CardVisual | null;
  readonly dungeonVisual: CardVisual | null;
}

const EMPTY_SETUP: SetupSelection = {
  successorId: null,
  dungeonId: null,
  successorVisual: null,
  dungeonVisual: null,
};

const HeroHand: React.FC<{
  readonly phase: InGamePhase;
  readonly send: (msg: IKClientMessage) => void;
  readonly setupSelection: SetupSelection;
  readonly onSetupCardClick: (cardId: number) => void;
  readonly onCommitSetup: (() => void) | undefined;
  readonly musteringSelection: MusteringSelection;
  readonly setMusteringSelection: Dispatch<SetStateAction<MusteringSelection>>;
}> = ({
  phase,
  send,
  setupSelection,
  onSetupCardClick,
  onCommitSetup,
  musteringSelection,
  setMusteringSelection,
}) => {
  const mi = safeMyIndex(phase);
  const gameState = hasGameState(phase) ? phase.gameState : null;
  const myZones = gameState?.players[mi];
  const handCards = myZones?.hand ?? [];
  const isTouch = useTouchDevice();

  const isMyTurn = hasActivePlayer(phase) && phase.activePlayer === mi;
  const inSetup = phase._tag === "setup";

  const playActions: readonly IKPlayAction[] =
    phase._tag === "play" ? phase.legalActions : [];

  const canPlayCard = (cardId: number): boolean =>
    playActions.some((a) => a.kind === "play" && a.cardId === cardId);

  const canDisgrace = playActions.some((a) => a.kind === "disgrace");

  const handlePlayCard = useCallback(
    (cardId: number) => {
      send({ type: "action", action: { kind: "play", cardId } });
    },
    [send],
  );

  const handleDisgrace = useCallback(() => {
    send({ type: "action", action: { kind: "disgrace" } });
  }, [send]);

  const trail = useTrail(handCards.length, {
    from: { opacity: 0, y: 30, scale: 0.9 },
    to: { opacity: 1, y: 0, scale: 1 },
    config: { tension: 600, friction: 36 },
  });

  if (phase._tag === "drafting") {
    return <div className="tt-hand" />;
  }

  const isMusteringHand = phase._tag === "mustering";

  const turnLabel = inSetup
    ? "Choose Successor, then Dungeon"
    : phase._tag === "play" && isMyTurn
      ? "Your turn"
      : phase._tag === "play"
        ? `${(phase.playerNames as readonly string[])[phase.activePlayer] ?? "..."} is thinking...`
        : null;

  return (
    <div className="tt-hand">
      {turnLabel !== null && (
        <span className={`hand-zone__turn-indicator ${isMyTurn || inSetup ? "hand-zone__turn-indicator--mine" : "hand-zone__turn-indicator--waiting"}`}>
          {turnLabel}
        </span>
      )}
      <div className="hand-zone__cards">
        {trail.map((style, i) => {
          const card = handCards[i];
          if (card === undefined) return null;
          const visual = toCardVisual(card);

          if (inSetup) {
            const isSetupSelected =
              card.id === setupSelection.successorId || card.id === setupSelection.dungeonId;
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
                  visual={visual}
                  orientation="front"
                  interactive={!isSetupSelected}
                  dimmed={isSetupSelected}
                  selected={isSetupSelected}
                  previewSource="hand"
                  onClick={() => onSetupCardClick(card.id)}
                />
              </animated.div>
            );
          }

          if (isMusteringHand) {
            const musteringPhase = phase;
            const canSelect = musteringPhase.activePlayer === mi;
            const isSelected = musteringSelection.selectedHandCard === card.id;
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
                  visual={visual}
                  orientation="front"
                  previewSource="hand"
                  interactive={canSelect}
                  selected={isSelected}
                  {...(canSelect
                    ? {
                        onClick: () => {
                          setMusteringSelection((prev) => ({
                            ...prev,
                            recommExhaust1: null,
                            recommExhaust2: null,
                            recommRecover: null,
                            selectedHandCard: prev.selectedHandCard === card.id ? null : card.id,
                          }));
                        },
                      }
                    : {})}
                />
              </animated.div>
            );
          }

          const playable = phase._tag === "play" && isMyTurn && canPlayCard(card.id);
          const handleClick = () => {
            if (playable) handlePlayCard(card.id);
          };

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
                visual={visual}
                orientation="front"
                interactive={playable || isTouch}
                dimmed={phase._tag === "play" && isMyTurn && !playable && !isTouch}
                previewSource="hand"
                onClick={handleClick}
              />
            </animated.div>
          );
        })}
      </div>

      <div className="hand-zone__actions">
        {onCommitSetup && (
          <button className="btn btn-primary" onClick={onCommitSetup}>Commit</button>
        )}
        {phase._tag === "play" && isMyTurn && canDisgrace && (
          <button className="btn btn-danger" onClick={handleDisgrace}>Disgrace</button>
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// HeroAntechamber + HeroPartingZone (center stage lower)
// ---------------------------------------------------------------------------

const HeroAntechamber: React.FC<{ readonly phase: InGamePhase }> = ({ phase }) => {
  const gameState = hasGameState(phase) ? phase.gameState : null;
  const myZones = gameState?.players[safeMyIndex(phase)];
  const cards = myZones?.antechamber ?? [];
  if (cards.length === 0) return <div className="tt-hero-ante" />;

  return (
    <div className="tt-hero-ante">
      <span className="zone-label">Antechamber</span>
      <div className="tt-card-row">
        {cards.map((c: import("@imposter-zero/engine").IKCard) => (
          <Card key={c.id} visual={toCardVisual(c)} orientation="front" size="small" previewSource="hand" />
        ))}
      </div>
    </div>
  );
};

const HeroPartingZone: React.FC<{ readonly phase: InGamePhase }> = ({ phase }) => {
  const gameState = hasGameState(phase) ? phase.gameState : null;
  const myZones = gameState?.players[safeMyIndex(phase)];
  const cards = myZones?.parting ?? [];
  if (cards.length === 0) return <div className="tt-hero-parting" />;

  return (
    <div className="tt-hero-parting">
      <span className="zone-label">Parting Zone</span>
      <div className="tt-card-row">
        {cards.map((c: import("@imposter-zero/engine").IKCard) => (
          <Card key={c.id} visual={toCardVisual(c)} orientation="front" size="small" previewSource="hand" />
        ))}
      </div>
    </div>
  );
};

const PHASE_LABELS: Partial<Record<InGamePhase["_tag"], string>> = {
  drafting: "Draft Phase",
  crown: "Crown Phase",
  mustering: "Mustering Phase",
  setup: "Setup Phase",
  play: "Play Phase",
  resolving: "Resolving",
  scoring: "Scoring",
  finished: "Match Over",
};

// ---------------------------------------------------------------------------
// TabletopLayout — the master persistent grid
// ---------------------------------------------------------------------------

export const TabletopLayout: React.FC<Props> = ({ phase, send }) => {
  const mi = safeMyIndex(phase);
  const gameState = hasGameState(phase) ? phase.gameState : null;
  const turnCount = gameState?.turnCount ?? 0;
  const isMyTurn = hasActivePlayer(phase) && phase.activePlayer === mi;
  const handHelper = phase._tag === "play" || phase._tag === "resolving" ? phase.handHelper : false;

  // ── Phase indicator (shows briefly on phase change) ──
  const [phaseLabel, setPhaseLabel] = useState<string | null>(null);
  const prevTagRef = useRef(phase._tag);

  useEffect(() => {
    if (phase._tag !== prevTagRef.current) {
      prevTagRef.current = phase._tag;
      const label = PHASE_LABELS[phase._tag];
      if (label) {
        setPhaseLabel(label);
        const timer = setTimeout(() => setPhaseLabel(null), 2000);
        return () => clearTimeout(timer);
      }
    }
    return undefined;
  }, [phase._tag]);

  // ── Setup selection state ──
  const isSetup = phase._tag === "setup";
  const isMustering = phase._tag === "mustering";
  const [setupSel, setSetupSel] = useState<{ successorId: number | null; dungeonId: number | null }>({
    successorId: null,
    dungeonId: null,
  });
  const [musteringSelection, setMusteringSelection] = useState<MusteringSelection>(
    EMPTY_MUSTERING_SELECTION,
  );

  useEffect(() => {
    if (!isSetup) setSetupSel({ successorId: null, dungeonId: null });
  }, [isSetup]);

  useEffect(() => {
    if (!isMustering) {
      setMusteringSelection(EMPTY_MUSTERING_SELECTION);
    }
  }, [isMustering]);

  useEffect(() => {
    if (phase._tag === "mustering" && phase.activePlayer !== mi) {
      setMusteringSelection(EMPTY_MUSTERING_SELECTION);
    }
  }, [phase, mi]);

  const handleSetupCardClick = useCallback((cardId: number) => {
    setSetupSel((prev) => {
      if (prev.successorId === null) return { ...prev, successorId: cardId };
      if (cardId === prev.successorId) return { ...prev, successorId: null };
      if (prev.dungeonId === null) return { ...prev, dungeonId: cardId };
      if (cardId === prev.dungeonId) return { ...prev, dungeonId: null };
      return { successorId: cardId, dungeonId: null };
    });
  }, []);

  const myHand = gameState?.players[mi]?.hand ?? [];

  const setupSelection: SetupSelection = useMemo(() => ({
    successorId: setupSel.successorId,
    dungeonId: setupSel.dungeonId,
    successorVisual:
      setupSel.successorId !== null
        ? (() => { const c = myHand.find((h: import("@imposter-zero/engine").IKCard) => h.id === setupSel.successorId); return c ? toCardVisual(c) : null; })()
        : null,
    dungeonVisual:
      setupSel.dungeonId !== null
        ? (() => { const c = myHand.find((h: import("@imposter-zero/engine").IKCard) => h.id === setupSel.dungeonId); return c ? toCardVisual(c) : null; })()
        : null,
  }), [setupSel.successorId, setupSel.dungeonId, myHand]);

  const canCommitSetup =
    isSetup &&
    isMyTurn &&
    setupSel.successorId !== null &&
    setupSel.dungeonId !== null &&
    setupSel.successorId !== setupSel.dungeonId &&
    (phase.legalActions as readonly IKSetupAction[]).some(
      (a) =>
        a.kind === "commit" &&
        a.successorId === setupSel.successorId &&
        a.dungeonId === setupSel.dungeonId,
    );

  const handleCommitSetup = useCallback(() => {
    if (setupSel.successorId === null || setupSel.dungeonId === null) return;
    send({
      type: "action",
      action: {
        kind: "commit",
        successorId: setupSel.successorId,
        dungeonId: setupSel.dungeonId,
      },
    });
    setSetupSel({ successorId: null, dungeonId: null });
  }, [setupSel, send]);

  // ── Hand helper + disgraced/seen card tracking ──
  const updateCourt = useDisgracedTracker((s) => s.updateCourt);
  const disgracedCards = useDisgracedTracker((s) => s.disgracedCards);
  const seenCards = useSeenCardsTracker((s) => s.seenCards);

  useEffect(() => {
    if (gameState) updateCourt(gameState.shared.court);
  }, [gameState?.shared.court, updateCourt]);

  const possibleHands = useMemo(
    () =>
      handHelper && gameState
        ? computePossibleHand(gameState, mi, gameState.numPlayers, disgracedCards, seenCards)
        : null,
    [handHelper, gameState, mi, disgracedCards, seenCards],
  );

  // ── Timer ──
  const timerDeadline = hasTurnDeadline(phase) ? phase.turnDeadline : 0;
  const showTimer = timerDeadline > 0;

  // ── Tertiary collapse ──
  const hasTertiary = phase._tag === "mustering" || phase._tag === "scoring";

  return (
    <div className="tabletop">
      {/* ── Left Column ── */}
      <div className="tabletop__left-col">
        <MatchLog />
        <CardPreview />
        <GameLog turnCount={turnCount} />
      </div>

      {/* ── Center Stage ── */}
      <div className="tabletop__center">
        {showTimer && (
          <div className="tabletop__timer">
            <CountdownTimer turnDeadline={timerDeadline} isMyTurn={isMyTurn} />
          </div>
        )}
        {phaseLabel !== null && (
          <div className="tt-phase-indicator" key={phaseLabel}>{phaseLabel}</div>
        )}
        <CourtArea phase={phase} />
        <div className="tabletop__primary-dialog">
          <PrimaryDialog
            phase={phase}
            send={send}
            setupSelection={setupSelection}
            musteringSelection={musteringSelection}
            setMusteringSelection={setMusteringSelection}
          />
        </div>
        <div className={`tabletop__lower-dialogs ${hasTertiary ? "" : "tabletop__lower-dialogs--no-tertiary"}`}>
          <div className="tabletop__secondary-dialog">
            <SecondaryDialog
              phase={phase}
              send={send}
              musteringSelection={musteringSelection}
              setMusteringSelection={setMusteringSelection}
            />
          </div>
          <HeroAntechamber phase={phase} />
          <HeroPartingZone phase={phase} />
          {hasTertiary && (
            <div className="tabletop__tertiary-dialog">
              <TertiaryDialog
                phase={phase}
                musteringSelection={musteringSelection}
                setMusteringSelection={setMusteringSelection}
              />
            </div>
          )}
        </div>
      </div>

      {/* ── Right Column ── */}
      <div className="tabletop__right-col">
        <OpponentZones phase={phase} possibleHands={possibleHands} />
        <SharedZones phase={phase} />
        <HeroZones phase={phase} setupSelection={setupSelection} />
      </div>

      {/* ── Hand Strip ── */}
      <HeroHand
        phase={phase}
        send={send}
        setupSelection={setupSelection}
        onSetupCardClick={handleSetupCardClick}
        onCommitSetup={canCommitSetup ? handleCommitSetup : undefined}
        musteringSelection={musteringSelection}
        setMusteringSelection={setMusteringSelection}
      />
    </div>
  );
};
