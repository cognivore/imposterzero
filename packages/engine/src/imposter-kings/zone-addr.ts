import {
  ok,
  err,
  flatMap,
  type PlayerId,
  type Result,
  type ZoneAddress,
} from "@imposter-zero/types";

import type { IKCard } from "./card.js";
import type { IKState } from "./state.js";
import { playerZones as getPlayerZones } from "./state.js";
import type { FaceState, IKPlayerZones } from "./zones.js";
import { replacePlayerZones } from "./rules/shared.js";

// ---------------------------------------------------------------------------
// IK-specific zone vocabulary
// ---------------------------------------------------------------------------

export type IKPlayerZoneSlot =
  | "hand"
  | "king"
  | "successor"
  | "dungeon"
  | "antechamber"
  | "parting";

export type IKSharedZoneSlot = "court" | "accused" | "forgotten" | "army" | "condemned";

export type IKZoneAddress = ZoneAddress<IKPlayerZoneSlot, IKSharedZoneSlot>;

// ---------------------------------------------------------------------------
// Zone errors
// ---------------------------------------------------------------------------

export type ZoneError =
  | {
      readonly kind: "card_not_in_zone";
      readonly cardId: number;
      readonly addr: IKZoneAddress;
    }
  | { readonly kind: "zone_immutable"; readonly addr: IKZoneAddress };

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

const readPlayerZone = (
  zones: IKPlayerZones,
  slot: IKPlayerZoneSlot,
): ReadonlyArray<IKCard> => {
  switch (slot) {
    case "hand":
      return zones.hand;
    case "king":
      return [zones.king.card];
    case "successor":
      return zones.successor ? [zones.successor.card] : [];
    case "dungeon":
      return zones.dungeon ? [zones.dungeon.card] : [];
    case "antechamber":
      return zones.antechamber;
    case "parting":
      return zones.parting;
  }
};

export const readZone = (
  state: IKState,
  addr: IKZoneAddress,
): ReadonlyArray<IKCard> => {
  if (addr.scope === "player") {
    return readPlayerZone(getPlayerZones(state, addr.player), addr.slot);
  }
  switch (addr.slot) {
    case "court":
      return state.shared.court.map((e) => e.card);
    case "accused":
      return state.shared.accused ? [state.shared.accused] : [];
    case "forgotten":
      return state.shared.forgotten ? [state.shared.forgotten.card] : [];
    case "army":
      return state.shared.army;
    case "condemned":
      return state.shared.condemned.map((e) => e.card);
  }
};

// ---------------------------------------------------------------------------
// Contains
// ---------------------------------------------------------------------------

export const zoneContains = (
  state: IKState,
  addr: IKZoneAddress,
  cardId: number,
): boolean => readZone(state, addr).some((c) => c.id === cardId);

// ---------------------------------------------------------------------------
// Remove
// ---------------------------------------------------------------------------

export interface ZoneRemoval {
  readonly card: IKCard;
  readonly state: IKState;
}

const removeFromPlayerZone = (
  state: IKState,
  player: PlayerId,
  slot: IKPlayerZoneSlot,
  cardId: number,
): Result<ZoneError, ZoneRemoval> => {
  const zones = getPlayerZones(state, player);
  const addr: IKZoneAddress = { scope: "player", player, slot };

  switch (slot) {
    case "hand": {
      const card = zones.hand.find((c) => c.id === cardId);
      if (!card) return err({ kind: "card_not_in_zone", cardId, addr });
      const next: IKPlayerZones = {
        ...zones,
        hand: zones.hand.filter((c) => c.id !== cardId),
      };
      return ok({
        card,
        state: {
          ...state,
          players: replacePlayerZones(state.players, player, next),
        },
      });
    }
    case "king":
      return err({ kind: "zone_immutable", addr });
    case "successor": {
      if (!zones.successor || zones.successor.card.id !== cardId)
        return err({ kind: "card_not_in_zone", cardId, addr });
      const card = zones.successor.card;
      const next: IKPlayerZones = { ...zones, successor: null };
      return ok({
        card,
        state: {
          ...state,
          players: replacePlayerZones(state.players, player, next),
        },
      });
    }
    case "dungeon": {
      if (!zones.dungeon || zones.dungeon.card.id !== cardId)
        return err({ kind: "card_not_in_zone", cardId, addr });
      const card = zones.dungeon.card;
      const next: IKPlayerZones = { ...zones, dungeon: null };
      return ok({
        card,
        state: {
          ...state,
          players: replacePlayerZones(state.players, player, next),
        },
      });
    }
    case "antechamber": {
      const card = zones.antechamber.find((c) => c.id === cardId);
      if (!card) return err({ kind: "card_not_in_zone", cardId, addr });
      const next: IKPlayerZones = {
        ...zones,
        antechamber: zones.antechamber.filter((c) => c.id !== cardId),
      };
      return ok({
        card,
        state: {
          ...state,
          players: replacePlayerZones(state.players, player, next),
        },
      });
    }
    case "parting": {
      const card = zones.parting.find((c) => c.id === cardId);
      if (!card) return err({ kind: "card_not_in_zone", cardId, addr });
      const next: IKPlayerZones = {
        ...zones,
        parting: zones.parting.filter((c) => c.id !== cardId),
      };
      return ok({
        card,
        state: {
          ...state,
          players: replacePlayerZones(state.players, player, next),
        },
      });
    }
  }
};

const removeFromSharedZone = (
  state: IKState,
  slot: IKSharedZoneSlot,
  cardId: number,
): Result<ZoneError, ZoneRemoval> => {
  const addr: IKZoneAddress = { scope: "shared", slot };
  const { shared } = state;

  switch (slot) {
    case "court": {
      const entry = shared.court.find((e) => e.card.id === cardId);
      if (!entry) return err({ kind: "card_not_in_zone", cardId, addr });
      return ok({
        card: entry.card,
        state: {
          ...state,
          shared: {
            ...shared,
            court: shared.court.filter((e) => e.card.id !== cardId),
          },
        },
      });
    }
    case "accused": {
      if (!shared.accused || shared.accused.id !== cardId)
        return err({ kind: "card_not_in_zone", cardId, addr });
      return ok({
        card: shared.accused,
        state: { ...state, shared: { ...shared, accused: null } },
      });
    }
    case "forgotten": {
      if (!shared.forgotten || shared.forgotten.card.id !== cardId)
        return err({ kind: "card_not_in_zone", cardId, addr });
      return ok({
        card: shared.forgotten.card,
        state: { ...state, shared: { ...shared, forgotten: null } },
      });
    }
    case "army": {
      const card = shared.army.find((c) => c.id === cardId);
      if (!card) return err({ kind: "card_not_in_zone", cardId, addr });
      return ok({
        card,
        state: {
          ...state,
          shared: {
            ...shared,
            army: shared.army.filter((c) => c.id !== cardId),
          },
        },
      });
    }
    case "condemned": {
      const entry = shared.condemned.find((e) => e.card.id === cardId);
      if (!entry) return err({ kind: "card_not_in_zone", cardId, addr });
      return ok({
        card: entry.card,
        state: {
          ...state,
          shared: {
            ...shared,
            condemned: shared.condemned.filter((e) => e.card.id !== cardId),
          },
        },
      });
    }
  }
};

export const removeFromZone = (
  state: IKState,
  addr: IKZoneAddress,
  cardId: number,
): Result<ZoneError, ZoneRemoval> =>
  addr.scope === "player"
    ? removeFromPlayerZone(state, addr.player, addr.slot, cardId)
    : removeFromSharedZone(state, addr.slot, cardId);

// ---------------------------------------------------------------------------
// Insert
// ---------------------------------------------------------------------------

export interface InsertOptions {
  readonly face?: FaceState;
  readonly playedBy?: PlayerId;
}

const insertIntoPlayerZone = (
  state: IKState,
  player: PlayerId,
  slot: IKPlayerZoneSlot,
  card: IKCard,
): Result<ZoneError, IKState> => {
  const zones = getPlayerZones(state, player);
  const addr: IKZoneAddress = { scope: "player", player, slot };

  switch (slot) {
    case "hand": {
      const next: IKPlayerZones = {
        ...zones,
        hand: [...zones.hand, card],
      };
      return ok({
        ...state,
        players: replacePlayerZones(state.players, player, next),
      });
    }
    case "king":
      return err({ kind: "zone_immutable", addr });
    case "successor": {
      const next: IKPlayerZones = {
        ...zones,
        successor: { card, face: "down" },
      };
      return ok({
        ...state,
        players: replacePlayerZones(state.players, player, next),
      });
    }
    case "dungeon": {
      const next: IKPlayerZones = {
        ...zones,
        dungeon: { card, face: "down" },
      };
      return ok({
        ...state,
        players: replacePlayerZones(state.players, player, next),
      });
    }
    case "antechamber": {
      const next: IKPlayerZones = {
        ...zones,
        antechamber: [...zones.antechamber, card],
      };
      return ok({
        ...state,
        players: replacePlayerZones(state.players, player, next),
      });
    }
    case "parting": {
      const next: IKPlayerZones = {
        ...zones,
        parting: [...zones.parting, card],
      };
      return ok({
        ...state,
        players: replacePlayerZones(state.players, player, next),
      });
    }
  }
};

const insertIntoSharedZone = (
  state: IKState,
  slot: IKSharedZoneSlot,
  card: IKCard,
  opts: InsertOptions,
): Result<ZoneError, IKState> => {
  const addr: IKZoneAddress = { scope: "shared", slot };
  const { shared } = state;

  switch (slot) {
    case "court": {
      const entry = {
        card,
        face: (opts.face ?? "up") as FaceState,
        playedBy: opts.playedBy ?? state.activePlayer,
      };
      return ok({
        ...state,
        shared: { ...shared, court: [...shared.court, entry] },
      });
    }
    case "accused":
      return ok({ ...state, shared: { ...shared, accused: card } });
    case "forgotten":
      return ok({
        ...state,
        shared: { ...shared, forgotten: { card, face: "down" } },
      });
    case "army":
      return ok({
        ...state,
        shared: { ...shared, army: [...shared.army, card] },
      });
    case "condemned":
      return ok({
        ...state,
        shared: {
          ...shared,
          condemned: [
            ...shared.condemned,
            { card, face: (opts.face ?? "down") as FaceState },
          ],
        },
      });
  }
};

export const insertIntoZone = (
  state: IKState,
  addr: IKZoneAddress,
  card: IKCard,
  opts: InsertOptions = {},
): Result<ZoneError, IKState> =>
  addr.scope === "player"
    ? insertIntoPlayerZone(state, addr.player, addr.slot, card)
    : insertIntoSharedZone(state, addr.slot, card, opts);

// ---------------------------------------------------------------------------
// Move (remove + insert)
// ---------------------------------------------------------------------------

export const moveCard = (
  state: IKState,
  cardId: number,
  from: IKZoneAddress,
  to: IKZoneAddress,
  opts: InsertOptions = {},
): Result<ZoneError, IKState> =>
  flatMap(removeFromZone(state, from, cardId), ({ card, state: s }) =>
    insertIntoZone(s, to, card, opts),
  );

// ---------------------------------------------------------------------------
// Court-specific helpers
// ---------------------------------------------------------------------------

export const disgraceInCourt = (
  state: IKState,
  cardId: number,
): Result<ZoneError, IKState> => {
  const addr: IKZoneAddress = { scope: "shared", slot: "court" };
  const entry = state.shared.court.find((e) => e.card.id === cardId);
  if (!entry) return err({ kind: "card_not_in_zone", cardId, addr });
  return ok({
    ...state,
    shared: {
      ...state.shared,
      court: state.shared.court.map((e) =>
        e.card.id === cardId ? { ...e, face: "down" as const } : e,
      ),
    },
  });
};

export const setKingFace = (
  state: IKState,
  player: PlayerId,
  face: FaceState,
): IKState => {
  const zones = getPlayerZones(state, player);
  const next: IKPlayerZones = {
    ...zones,
    king: { ...zones.king, face },
  };
  return {
    ...state,
    players: replacePlayerZones(state.players, player, next),
  };
};
