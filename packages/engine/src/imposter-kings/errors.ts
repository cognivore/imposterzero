import type { IKPhase } from "./state.js";

export type TransitionError =
  | { readonly kind: "phase_mismatch"; readonly phase: IKPhase; readonly actionKind: string }
  | { readonly kind: "card_not_in_hand"; readonly cardId: number }
  | { readonly kind: "insufficient_value"; readonly cardValue: number; readonly threshold: number }
  | { readonly kind: "same_card_commit"; readonly cardId: number }
  | { readonly kind: "cards_not_found"; readonly successorId: number; readonly dungeonId: number }
  | { readonly kind: "no_throne_for_disgrace" }
  | { readonly kind: "king_already_down" }
  | { readonly kind: "invalid_first_player"; readonly player: number };

export const transitionErrorMessage = (e: TransitionError): string => {
  switch (e.kind) {
    case "phase_mismatch":
      return `Action '${e.actionKind}' is not legal during ${e.phase} phase`;
    case "card_not_in_hand":
      return `Card ${e.cardId} is not present in active player's hand`;
    case "insufficient_value":
      return `Card value ${e.cardValue} is below throne threshold ${e.threshold}`;
    case "same_card_commit":
      return `Successor and dungeon must be distinct (both are card ${e.cardId})`;
    case "cards_not_found":
      return `Commit references cards not in hand: successor=${e.successorId}, dungeon=${e.dungeonId}`;
    case "no_throne_for_disgrace":
      return "Cannot disgrace without a throne card";
    case "king_already_down":
      return "Cannot disgrace when king is already face-down";
    case "invalid_first_player":
      return `Invalid first player: ${e.player}`;
  }
};
