import type { IKPhase } from "./state.js";

export type TransitionError =
  | { readonly kind: "phase_mismatch"; readonly phase: IKPhase; readonly actionKind: string }
  | { readonly kind: "card_not_in_hand"; readonly cardId: number }
  | { readonly kind: "insufficient_value"; readonly cardValue: number; readonly threshold: number }
  | { readonly kind: "same_card_commit"; readonly cardId: number }
  | { readonly kind: "cards_not_found"; readonly successorId: number; readonly dungeonId: number }
  | { readonly kind: "no_throne_for_disgrace" }
  | { readonly kind: "king_already_down" }
  | { readonly kind: "invalid_first_player"; readonly player: number }
  | { readonly kind: "invalid_effect_choice"; readonly choice: number }
  | { readonly kind: "no_pending_resolution" }
  | { readonly kind: "card_not_in_army"; readonly cardId: number }
  | { readonly kind: "card_not_exhausted"; readonly cardId: number }
  | { readonly kind: "not_enough_exhausted_for_recommission" }
  | { readonly kind: "no_army_cards_available" }
  | { readonly kind: "must_exhaust_for_first_recruit" };

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
    case "invalid_effect_choice":
      return `Effect choice ${e.choice} is out of range`;
    case "no_pending_resolution":
      return "No pending effect resolution to apply choice to";
    case "card_not_in_army":
      return `Card ${e.cardId} is not in the player's army`;
    case "card_not_exhausted":
      return `Card ${e.cardId} is not in the player's exhausted zone`;
    case "not_enough_exhausted_for_recommission":
      return "Need at least 2 exhausted cards and 1 exhausted card to recover for recommission";
    case "no_army_cards_available":
      return "No cards available in army to recruit";
    case "must_exhaust_for_first_recruit":
      return "Must exhaust a card from army as cost for first recruit this mustering phase";
  }
};
