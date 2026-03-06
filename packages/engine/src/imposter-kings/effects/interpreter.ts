import type { PlayerId } from "@imposter-zero/types";

import type { CardName } from "../card.js";
import type { IKState } from "../state.js";
import { nextPlayer } from "../state.js";
import {
  readZone,
  removeFromZone,
  insertIntoZone,
  moveCard as zoneMove,
  disgraceInCourt as zoneDis,
  setKingFace as zoneFlip,
  type IKZoneAddress,
} from "../zone-addr.js";
import type {
  EffectProgram,
  EffectContext,
  Resolution,
  CardRef,
  PlayerRef,
  ZoneRef,
  CardFilter,
  TriggerKind,
} from "./program.js";
import { evaluate } from "./predicates.js";

// ---------------------------------------------------------------------------
// Reference resolution
// ---------------------------------------------------------------------------

const resolveCard = (ref: CardRef, ctx: EffectContext, state: IKState): number => {
  switch (ref.kind) {
    case "played":
      return ctx.playedCard.id;
    case "belowPlayed": {
      const court = state.shared.court;
      const idx = court.findIndex((e) => e.card.id === ctx.playedCard.id);
      return idx > 0 ? court[idx - 1]!.card.id : -1;
    }
    case "id":
      return ref.cardId;
  }
};

const resolvePlayer = (ref: PlayerRef, ctx: EffectContext): PlayerId =>
  ref.kind === "active" ? ctx.activePlayer : ref.player;

const resolveZone = (ref: ZoneRef, ctx: EffectContext): IKZoneAddress =>
  ref.kind === "playerZone"
    ? { scope: "player", player: resolvePlayer(ref.player, ctx), slot: ref.slot }
    : { scope: "shared", slot: ref.slot };

// ---------------------------------------------------------------------------
// Card filtering for choice options
// ---------------------------------------------------------------------------

const matchesFilter = (
  card: { readonly id: number; readonly kind: { readonly name?: string; readonly props: { readonly keywords: readonly string[]; readonly value: number } } },
  filter: CardFilter,
  state: IKState,
): boolean => {
  switch (filter.tag) {
    case "notDisgraced": {
      const entry = state.shared.court.find((e) => e.card.id === card.id);
      return !entry || entry.face === "up";
    }
    case "notRoyalty":
      return !card.kind.props.keywords.includes("royalty");
    case "notDisgracedOrRoyalty": {
      const entry = state.shared.court.find((e) => e.card.id === card.id);
      const isDisgraced = entry && entry.face === "down";
      const isRoyalty = card.kind.props.keywords.includes("royalty");
      return !isDisgraced && !isRoyalty;
    }
    case "hasKeyword":
      return card.kind.props.keywords.includes(filter.keyword);
    case "minValue":
      return card.kind.props.value >= filter.value;
    case "hasName":
      return card.kind.name === filter.name;
  }
};

// ---------------------------------------------------------------------------
// Interpreter — steps through effect program, yielding Resolution
// ---------------------------------------------------------------------------

export const resolve = (
  program: EffectProgram,
  state: IKState,
  ctx: EffectContext,
): Resolution => {
  switch (program.tag) {
    case "done":
      return { tag: "done", state };

    case "preventEffect":
      return { tag: "done", state };

    case "sequence": {
      let s = state;
      for (const step of program.steps) {
        const res = resolve(step, s, ctx);
        if (res.tag === "needChoice") {
          const remaining = program.steps.slice(program.steps.indexOf(step) + 1);
          if (remaining.length === 0) return res;
          return {
            ...res,
            resume: (choice) => {
              const inner = res.resume(choice);
              if (inner.tag === "done" && remaining.length > 0) {
                return resolve(
                  { tag: "sequence", steps: remaining },
                  inner.state,
                  ctx,
                );
              }
              if (inner.tag === "needChoice" && remaining.length > 0) {
                const cont = inner;
                return {
                  ...cont,
                  resume: (c) => {
                    const next = cont.resume(c);
                    if (next.tag === "done") {
                      return resolve(
                        { tag: "sequence", steps: remaining },
                        next.state,
                        ctx,
                      );
                    }
                    return next;
                  },
                };
              }
              return inner;
            },
          };
        }
        s = res.state;
      }
      return { tag: "done", state: s };
    }

    case "disgraceAllInCourt": {
      const exceptId = program.except
        ? resolveCard(program.except, ctx, state)
        : null;
      const nextCourt = state.shared.court.map((e) =>
        e.card.id === exceptId ? e : { ...e, face: "down" as const },
      );
      const s: IKState = {
        ...state,
        shared: { ...state.shared, court: nextCourt },
      };
      return resolve(program.then, s, ctx);
    }

    case "disgraceInCourt": {
      const cid = resolveCard(program.target, ctx, state);
      const result = zoneDis(state, cid);
      return resolve(program.then, result.ok ? result.value : state, ctx);
    }

    case "moveCard": {
      const cid = resolveCard(program.card, ctx, state);
      const from = resolveZone(program.from, ctx);
      const to = resolveZone(program.to, ctx);
      const result = zoneMove(state, cid, from, to);
      return resolve(program.then, result.ok ? result.value : state, ctx);
    }

    case "setKingFace": {
      const player = resolvePlayer(program.player, ctx);
      const s = zoneFlip(state, player, program.face);
      return resolve(program.then, s, ctx);
    }

    case "ifCond": {
      const cond = evaluate(program.predicate, state, ctx);
      return resolve(cond ? program.then_ : program.else_, state, ctx);
    }

    case "checkZone": {
      const zone = resolveZone(program.zone, ctx);
      const cards = readZone(state, zone);
      const hasMatch = program.filter
        ? cards.some((c) => matchesFilter(c, program.filter!, state))
        : cards.length > 0;
      return resolve(hasMatch ? program.then_ : program.else_, state, ctx);
    }

    case "anyOpponentHas": {
      const found = Array.from(
        { length: ctx.numPlayers },
        (_, i) => i as PlayerId,
      )
        .filter((p) => p !== ctx.activePlayer)
        .some((opp) => {
          const cards = readZone(state, { scope: "player", player: opp, slot: program.slot });
          return cards.some((c) => matchesFilter(c, program.filter, state));
        });
      return resolve(found ? program.then_ : program.else_, state, ctx);
    }

    case "addRoundModifier": {
      const sourceId = resolveCard(program.source, ctx, state);
      const s: IKState = {
        ...state,
        roundModifiers: [
          ...state.roundModifiers,
          { sourceCardId: sourceId, spec: program.spec },
        ],
      };
      return resolve(program.then, s, ctx);
    }

    case "forcePlay": {
      const cid = resolveCard(program.card, ctx, state);
      const from = resolveZone(program.from, ctx);
      const result = zoneMove(state, cid, from, { scope: "shared", slot: "court" });
      if (!result.ok) return { tag: "done", state };
      const entry = result.value.shared.court.find((e) => e.card.id === cid);
      if (!entry) return { tag: "done", state: result.value };
      const onPlay = entry.card.kind.props.effects.find((e) => e.tag === "onPlay");
      if (!onPlay) return { tag: "done", state: result.value };
      return resolve(onPlay.effect, result.value, {
        playedCard: entry.card,
        activePlayer: ctx.activePlayer,
        numPlayers: ctx.numPlayers,
        playedFrom: "hand",
      });
    }

    case "chooseCard": {
      const player = resolvePlayer(program.player, ctx);
      const zone = resolveZone(program.zone, ctx);
      const cards = readZone(state, zone);
      const filtered = program.filter
        ? cards.filter((c) => matchesFilter(c, program.filter!, state))
        : cards;
      if (filtered.length === 0) return { tag: "done", state };
      const options = filtered.map((c) => ({
        kind: "card" as const,
        cardId: c.id,
      }));
      return {
        tag: "needChoice",
        state,
        player,
        options,
        resume: (choice) =>
          resolve(program.andThen(options[choice]!.cardId), state, ctx),
      };
    }

    case "choosePlayer": {
      const options = Array.from(
        { length: ctx.numPlayers },
        (_, i) => i as PlayerId,
      )
        .filter((p) => p !== ctx.activePlayer)
        .map((p) => ({ kind: "player" as const, player: p }));
      if (options.length === 0) return { tag: "done", state };
      return {
        tag: "needChoice",
        state,
        player: ctx.activePlayer,
        options,
        resume: (choice) =>
          resolve(program.andThen(options[choice]!.player), state, ctx),
      };
    }

    case "nameCard": {
      const allNames: CardName[] = [
        "Fool", "Assassin", "Elder", "Zealot", "Inquisitor", "Soldier",
        "Judge", "Oathbound", "Immortal", "Warlord", "Mystic", "Warden",
        "Sentry", "King's Hand", "Princess", "Queen", "Executioner", "Bard",
        "Herald", "Spy", "Arbiter",
      ];
      const options = allNames.map((n) => ({
        kind: "cardName" as const,
        name: n,
      }));
      return {
        tag: "needChoice",
        state,
        player: ctx.activePlayer,
        options,
        resume: (choice) =>
          resolve(program.andThen(options[choice]!.name), state, ctx),
      };
    }

    case "nameValue": {
      const options = Array.from(
        { length: program.max - program.min + 1 },
        (_, i) => ({ kind: "value" as const, value: program.min + i }),
      );
      return {
        tag: "needChoice",
        state,
        player: ctx.activePlayer,
        options,
        resume: (choice) =>
          resolve(program.andThen(options[choice]!.value), state, ctx),
      };
    }

    case "forEachOpponent": {
      const opponents: PlayerId[] = [];
      for (let i = 1; i < ctx.numPlayers; i++) {
        opponents.push(
          nextPlayer(state, ((ctx.activePlayer + i - 1) % ctx.numPlayers) as PlayerId),
        );
      }
      const steps = [
        ...opponents.map((opp) => program.effect(opp)),
        program.then,
      ];
      return resolve({ tag: "sequence", steps }, state, ctx);
    }

    case "optional": {
      return {
        tag: "needChoice",
        state,
        player: ctx.activePlayer,
        options: [
          { kind: "pass" },
          { kind: "proceed" },
        ],
        resume: (choice) =>
          choice === 1
            ? resolve(program.effect, state, ctx)
            : resolve(program.otherwise, state, ctx),
      };
    }

    case "triggerReaction": {
      const reactors = findPotentialReactors(state, ctx, program.trigger);
      if (reactors.length === 0) {
        return resolve(program.continuation, state, ctx);
      }
      return resolveReactionChain(
        reactors,
        0,
        state,
        ctx,
        program.continuation,
        program.onReacted,
      );
    }

    case "forceLoser": {
      const player = resolvePlayer(program.player, ctx);
      return { tag: "done", state: { ...state, forcedLoser: player } };
    }
  }
};

const findPotentialReactors = (
  state: IKState,
  ctx: EffectContext,
  trigger: TriggerKind,
): ReadonlyArray<{ readonly player: PlayerId; readonly cardId: number }> => {
  const result: Array<{ player: PlayerId; cardId: number }> = [];
  for (let i = 1; i < ctx.numPlayers; i++) {
    const player = ((ctx.activePlayer + i) % ctx.numPlayers) as PlayerId;
    const hand = readZone(state, {
      scope: "player",
      player,
      slot: "hand",
    });
    for (const card of hand) {
      const hasReaction = card.kind.props.effects.some(
        (e) => e.tag === "reaction" && e.trigger === trigger,
      );
      if (hasReaction) {
        result.push({ player, cardId: card.id });
      }
    }
  }
  return result;
};

const resolveReactionChain = (
  reactors: ReadonlyArray<{ readonly player: PlayerId; readonly cardId: number }>,
  idx: number,
  state: IKState,
  ctx: EffectContext,
  continuation: EffectProgram,
  onReacted: EffectProgram,
): Resolution => {
  if (idx >= reactors.length) {
    return resolve(continuation, state, ctx);
  }
  const reactor = reactors[idx]!;
  return {
    tag: "needChoice",
    state,
    player: reactor.player,
    options: [{ kind: "pass" }, { kind: "proceed" }],
    resume: (choice) => {
      if (choice === 1) {
        const removed = removeFromZone(
          state,
          { scope: "player", player: reactor.player, slot: "hand" },
          reactor.cardId,
        );
        let s = removed.ok ? removed.value.state : state;
        if (removed.ok) {
          const condemned = insertIntoZone(
            s,
            { scope: "shared", slot: "army" },
            removed.value.card,
          );
          if (condemned.ok) s = condemned.value;
        }
        return resolve(onReacted, s, ctx);
      }
      return resolveReactionChain(
        reactors,
        idx + 1,
        state,
        ctx,
        continuation,
        onReacted,
      );
    },
  };
};

/**
 * Replays an effect program, feeding in previously-made choices.
 * Returns the Resolution at the current decision point (or Done).
 */
export const replay = (
  program: EffectProgram,
  state: IKState,
  ctx: EffectContext,
  choices: ReadonlyArray<number>,
): Resolution => {
  let resolution = resolve(program, state, ctx);
  for (const choice of choices) {
    if (resolution.tag !== "needChoice") break;
    resolution = resolution.resume(choice);
  }
  return resolution;
};
