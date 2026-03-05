/**
 * Card-game-specific type layer.
 * Built on top of the abstract protocol — use when the game involves cards.
 */

import type { PlayerId } from "./protocol.js";

export interface CardKind<P extends Record<string, unknown> = Record<string, unknown>> {
  readonly name: string;
  readonly props: P;
}

export interface CardInstance<P extends Record<string, unknown> = Record<string, unknown>> {
  readonly id: number;
  readonly kind: CardKind<P>;
}

export type Visibility =
  | { readonly kind: "public" }
  | { readonly kind: "hidden" }
  | { readonly kind: "owner"; readonly player: PlayerId };

export interface Zone<P extends Record<string, unknown> = Record<string, unknown>> {
  readonly name: string;
  readonly cards: ReadonlyArray<CardInstance<P>>;
  readonly visibility: Visibility;
}

export type ZoneAddress<P extends string = string, S extends string = string> =
  | { readonly scope: "player"; readonly player: PlayerId; readonly slot: P }
  | { readonly scope: "shared"; readonly slot: S };

export const playerZoneAddr = <P extends string>(
  player: PlayerId,
  slot: P,
): ZoneAddress<P, never> => ({ scope: "player", player, slot });

export const sharedZoneAddr = <S extends string>(
  slot: S,
): ZoneAddress<never, S> => ({ scope: "shared", slot });
