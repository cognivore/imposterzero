import { useState, useCallback } from "react";
import type { IKClientMessage } from "../ws-client.js";

interface Props {
  readonly signaturePool: ReadonlyArray<string>;
  readonly mySelections: ReadonlyArray<string>;
  readonly selectionsNeeded: number;
  readonly allReady: boolean;
  readonly playerNames: ReadonlyArray<string>;
  readonly send: (msg: IKClientMessage) => void;
}

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

export const DraftView: React.FC<Props> = ({
  signaturePool,
  mySelections,
  selectionsNeeded,
  allReady,
  playerNames,
  send,
}) => {
  const [selected, setSelected] = useState<Set<string>>(new Set(mySelections));
  const [submitted, setSubmitted] = useState(mySelections.length > 0);

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
      <div className="draft-layout">
        <div className="draft-header">
          <h2>Armies Assembled</h2>
          <p className="draft-status">Starting the match...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="draft-layout">
      <div className="draft-header">
        <h2>Select Your Signature Cards</h2>
        <p className="draft-status">
          {submitted
            ? "Waiting for opponent to select..."
            : `Choose ${selectionsNeeded} cards for your Army (${selected.size}/${selectionsNeeded})`}
        </p>
      </div>

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
        <div className="draft-actions">
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
