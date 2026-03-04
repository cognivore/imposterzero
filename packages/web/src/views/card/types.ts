import type { IKCard } from "@imposter-zero/engine";

export type CardTier = "low" | "mid" | "high" | "elite";

export const tierOf = (value: number): CardTier =>
  value <= 2 ? "low" : value <= 5 ? "mid" : value <= 7 ? "high" : "elite";

export type CardBackDesign = "standard" | "royal";

export interface CardVisual {
  readonly id: number;
  readonly front: {
    readonly value: number;
    readonly name: string;
    readonly tier: CardTier;
  };
  readonly back: {
    readonly design: CardBackDesign;
  };
}

export type CardOrientation = "front" | "back";

export interface ZonedCard {
  readonly visual: CardVisual;
  readonly orientation: CardOrientation;
  readonly zIndex: number;
}

export type SlotKind = "successor" | "dungeon";

export interface SetupSlotData {
  readonly kind: SlotKind;
  readonly card: CardVisual | null;
}

export const toCardVisual = (card: IKCard): CardVisual => ({
  id: card.id,
  front: {
    value: card.kind.props.value,
    name: card.kind.name,
    tier: tierOf(card.kind.props.value),
  },
  back: {
    design: "standard",
  },
});

export const ANONYMOUS_CARD: CardVisual = {
  id: -1,
  front: { value: 0, name: "", tier: "low" },
  back: { design: "standard" },
};
