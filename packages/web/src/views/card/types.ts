import type { IKCard, CardKeyword } from "@imposter-zero/engine";

export type CardTier = "low" | "mid" | "high" | "elite";

export const tierOf = (value: number): CardTier =>
  value <= 2 ? "low" : value <= 5 ? "mid" : value <= 7 ? "high" : "elite";

export type CardBackDesign = "standard" | "royal";

export interface CardArtwork {
  readonly thumb: string | null;
  readonly full: string | null;
}

export interface CardVisual {
  readonly id: number;
  readonly front: {
    readonly value: number;
    readonly name: string;
    readonly tier: CardTier;
    readonly keywords: readonly CardKeyword[];
    readonly shortText: string;
    readonly fullText: string;
    readonly flavorText: string;
    readonly artwork: CardArtwork;
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
    keywords: card.kind.props.keywords ?? [],
    shortText: card.kind.props.shortText ?? "",
    fullText: card.kind.props.fullText ?? "",
    flavorText: card.kind.props.flavorText ?? "",
    artwork: resolveArtwork(card.kind.name),
  },
  back: {
    design: "standard",
  },
});

export const ANONYMOUS_CARD: CardVisual = {
  id: -1,
  front: {
    value: 0,
    name: "",
    tier: "low",
    keywords: [],
    shortText: "",
    fullText: "",
    flavorText: "",
    artwork: { thumb: null, full: null },
  },
  back: { design: "standard" },
};

const CARD_ART: Partial<Record<string, { thumb: string; full: string }>> = {};

const resolveArtwork = (cardName: string): CardArtwork => {
  const entry = CARD_ART[cardName];
  return entry ?? { thumb: null, full: null };
};
