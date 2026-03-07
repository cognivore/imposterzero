import { describe, it, expect } from "vitest";

import {
  createDraftState,
  selectSignature,
  completeStandardSelection,
  startTournamentDraft,
  chooseDraftOrder,
  draftPick,
  buildPlayerArmies,
} from "../expansion-match.js";
import { REGULATION_2P_EXPANSION, SIGNATURE_CARD_NAMES } from "../config.js";

const seededRng = (seed: number) => {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
};

describe("Standard Signature Selection", () => {
  it("both players select 3 cards and complete selection", () => {
    let draft = createDraftState(REGULATION_2P_EXPANSION, 2, 0);
    expect(draft.phase.tag).toBe("selection");

    draft = selectSignature(draft, 0, ["Aegis", "Exile", "Ancestor"]);
    draft = selectSignature(draft, 1, ["Stranger", "Conspiracist", "Flagbearer"]);

    draft = completeStandardSelection(draft);
    expect(draft.phase.tag).toBe("complete");

    if (draft.phase.tag === "complete") {
      expect(draft.phase.playerSignatures[0]).toEqual(["Aegis", "Exile", "Ancestor"]);
      expect(draft.phase.playerSignatures[1]).toEqual(["Stranger", "Conspiracist", "Flagbearer"]);
    }
  });

  it("builds player armies from selection results", () => {
    const sigs = [
      ["Aegis", "Exile", "Ancestor"] as const,
      ["Stranger", "Conspiracist", "Flagbearer"] as const,
    ];
    const armies = buildPlayerArmies(REGULATION_2P_EXPANSION, sigs);
    expect(armies.length).toBe(2);
    expect(armies[0]!.available.length).toBe(8);
    expect(armies[1]!.available.length).toBe(8);

    const p0Names = armies[0]!.available.map((k) => k.name);
    expect(p0Names).toContain("Elder");
    expect(p0Names).toContain("Aegis");
    expect(p0Names).toContain("Exile");
    expect(p0Names).toContain("Ancestor");
  });
});

describe("Tournament Mode Drafting", () => {
  it("each player selects 1, then drafts from pool of 5", () => {
    let draft = createDraftState(REGULATION_2P_EXPANSION, 2, 0);

    draft = selectSignature(draft, 0, ["Exile"]);
    draft = selectSignature(draft, 1, ["Aegis"]);

    draft = startTournamentDraft(draft, seededRng(42));
    expect(draft.phase.tag).toBe("draft_order");

    if (draft.phase.tag === "draft_order") {
      expect(draft.phase.faceUp.length).toBe(5);
      const pool = draft.phase.faceUp;

      expect(pool).not.toContain("Exile");
      expect(pool).not.toContain("Aegis");
    }
  });

  it("draft order: first picks 1, second picks 2, first picks 1", () => {
    let draft = createDraftState(REGULATION_2P_EXPANSION, 2, 0);
    draft = selectSignature(draft, 0, ["Exile"]);
    draft = selectSignature(draft, 1, ["Aegis"]);
    draft = startTournamentDraft(draft, seededRng(42));

    draft = chooseDraftOrder(draft, true);
    expect(draft.phase.tag).toBe("drafting");

    if (draft.phase.tag === "drafting") {
      const available = draft.phase.faceUp;

      draft = draftPick(draft, available[0]!);
      expect(draft.playerSelections[1]!.length).toBe(2);

      if (draft.phase.tag === "drafting") {
        const avail2 = draft.phase.faceUp;
        draft = draftPick(draft, avail2[0]!);
        expect(draft.playerSelections[0]!.length).toBe(2);

        if (draft.phase.tag === "drafting") {
          draft = draftPick(draft, draft.phase.faceUp[0]!);
        }

        if (draft.phase.tag === "drafting") {
          draft = draftPick(draft, draft.phase.faceUp[0]!);
        }
      }

      expect(draft.phase.tag).toBe("complete");
      if (draft.phase.tag === "complete") {
        expect(draft.phase.playerSignatures[0]!.length).toBe(3);
        expect(draft.phase.playerSignatures[1]!.length).toBe(3);
      }
    }
  });
});
