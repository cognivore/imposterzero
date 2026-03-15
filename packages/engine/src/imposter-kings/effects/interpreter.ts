import type { PlayerId } from "@imposter-zero/types";

import type { CardName, IKCard } from "../card.js";
import type { IKState } from "../state.js";
import { nextPlayer } from "../state.js";
import {
  readZone,
  removeFromZone,
  insertIntoZone,
  moveCard as zoneMove,
  disgraceInCourt as zoneDis,
  setKingFace as zoneFlip,
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
  ChoiceOption,
} from "./program.js";
import { evaluate } from "./predicates.js";
import { crystallizeStickyModifiers, effectiveValue, effectiveKeywords } from "./modifiers.js";
import {
  describeProgram,
  describeChoiceTrace,
  findCardName,
  type TraceSink,
} from "./trace.js";

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

const resolveZone = (ref: ZoneRef, ctx: EffectContext) =>
  ref.kind === "playerZone"
    ? ({ scope: "player", player: resolvePlayer(ref.player, ctx), slot: ref.slot } as const)
    : ({ scope: "shared", slot: ref.slot } as const);

// ---------------------------------------------------------------------------
// Card filtering for choice options
// ---------------------------------------------------------------------------

const matchesFilter = (
  card: IKCard,
  filter: CardFilter,
  state: IKState,
): boolean => {
  switch (filter.tag) {
    case "notDisgraced": {
      const entry = state.shared.court.find((e) => e.card.id === card.id);
      return !entry || entry.face === "up";
    }
    case "notRoyalty":
      return !effectiveKeywords(state, card).includes("royalty");
    case "notDisgracedOrRoyalty": {
      const entry = state.shared.court.find((e) => e.card.id === card.id);
      const isDisgraced = entry && entry.face === "down";
      const isRoyalty = effectiveKeywords(state, card).includes("royalty");
      return !isDisgraced && !isRoyalty;
    }
    case "hasKeyword":
      return effectiveKeywords(state, card).includes(filter.keyword);
    case "minValue":
      return card.kind.props.value >= filter.value;
    case "hasBaseValue":
      return card.kind.props.value === filter.value;
    case "hasName":
      return card.kind.name === filter.name;
    case "nameInSet":
      return filter.names.includes(card.kind.name as import("../card.js").CardName);
  }
};

// ---------------------------------------------------------------------------
// Trace helpers
// ---------------------------------------------------------------------------

const emitStep = (
  trace: TraceSink | undefined,
  depth: number,
  program: EffectProgram,
  ctx: EffectContext,
  state: IKState,
): void => {
  if (!trace || program.tag === "done") return;
  trace({ depth, tag: program.tag, description: describeProgram(program, ctx, state) });
};

const emitChoice = (
  trace: TraceSink | undefined,
  depth: number,
  choiceIdx: number,
  options: ReadonlyArray<ChoiceOption>,
  state: IKState,
  player: PlayerId,
): void => {
  if (!trace) return;
  const option = options[choiceIdx];
  if (!option) return;
  trace({ depth, tag: "choice", ...describeChoiceTrace(option, state, player) });
};

const emitRaw = (
  trace: TraceSink | undefined,
  depth: number,
  tag: EffectProgram["tag"],
  description: string,
): void => {
  if (trace) trace({ depth, tag, description });
};

// ---------------------------------------------------------------------------
// Chain: run first resolution to completion, then continue with a program
// ---------------------------------------------------------------------------

const chainResolution = (
  first: Resolution,
  continuation: EffectProgram,
  ctx: EffectContext,
  trace?: TraceSink,
  depth = 0,
): Resolution => {
  if (first.tag === "done") {
    return resolve(continuation, first.state, ctx, trace, depth);
  }
  return {
    ...first,
    resume: (choice) => chainResolution(first.resume(choice), continuation, ctx, trace, depth),
  };
};

// ---------------------------------------------------------------------------
// Interpreter — steps through effect program, yielding Resolution
// ---------------------------------------------------------------------------

export const resolve = (
  program: EffectProgram,
  state: IKState,
  ctx: EffectContext,
  trace?: TraceSink,
  depth = 0,
): Resolution => {
  emitStep(trace, depth, program, ctx, state);

  switch (program.tag) {
    case "done":
      return { tag: "done", state };

    case "preventEffect":
      return { tag: "done", state };

    case "sequence": {
      let s = state;
      for (const step of program.steps) {
        const res = resolve(step, s, ctx, trace, depth);
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
                  trace,
                  depth,
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
                        trace,
                        depth,
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
      return resolve(program.then, s, ctx, trace, depth);
    }

    case "disgraceInCourt": {
      const cid = resolveCard(program.target, ctx, state);
      const result = zoneDis(state, cid);
      return resolve(program.then, result.ok ? result.value : state, ctx, trace, depth);
    }

    case "moveCard": {
      const cid = resolveCard(program.card, ctx, state);
      const from = resolveZone(program.from, ctx);
      const to = resolveZone(program.to, ctx);
      const result = zoneMove(state, cid, from, to);
      let s = result.ok ? result.value : state;
      if (result.ok) s = trackKHMove(s, cid, from);
      return resolve(program.then, s, ctx, trace, depth);
    }

    case "setKingFace": {
      const player = resolvePlayer(program.player, ctx);
      const s = zoneFlip(state, player, program.face);
      return resolve(program.then, s, ctx, trace, depth);
    }

    case "ifCond": {
      const cond = evaluate(program.predicate, state, ctx);
      emitRaw(trace, depth, "ifCond", `Evaluated to ${cond}.`);
      return resolve(cond ? program.then_ : program.else_, state, ctx, trace, depth);
    }

    case "checkZone": {
      const zone = resolveZone(program.zone, ctx);
      const cards = readZone(state, zone);
      const hasMatch = program.filter
        ? cards.some((c) => matchesFilter(c, program.filter!, state))
        : cards.length > 0;
      emitRaw(trace, depth, "checkZone", hasMatch ? "Match found." : "No match.");
      return resolve(hasMatch ? program.then_ : program.else_, state, ctx, trace, depth);
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
      emitRaw(trace, depth, "anyOpponentHas", found ? "Opponent has match." : "No opponent match.");
      return resolve(found ? program.then_ : program.else_, state, ctx, trace, depth);
    }

    case "addRoundModifier": {
      const sourceId = resolveCard(program.source, ctx, state);
      const s: IKState = {
        ...state,
        roundModifiers: [
          ...state.roundModifiers,
          {
            sourceCardId: sourceId,
            spec: program.spec,
            playedBy: ctx.activePlayer,
            sticky: program.sticky || undefined,
          },
        ],
      };
      return resolve(program.then, s, ctx, trace, depth);
    }

    case "forcePlay": {
      const cid = resolveCard(program.card, ctx, state);
      const from = resolveZone(program.from, ctx);
      const priorThrone = state.shared.court[state.shared.court.length - 1];
      const playedOnValue =
        priorThrone === undefined
          ? 0
          : priorThrone.face === "down"
            ? 1
            : effectiveValue(state, priorThrone.card);
      const result = zoneMove(state, cid, from, { scope: "shared", slot: "court" });
      if (!result.ok) return { tag: "done", state };
      let s = crystallizeStickyModifiers(result.value, cid, ctx.activePlayer);
      const entry = s.shared.court.find((e) => e.card.id === cid);
      if (!entry) return { tag: "done", state: s };
      const onPlay = entry.card.kind.props.effects.find((e) => e.tag === "onPlay");
      if (!onPlay) return { tag: "done", state: s };
      emitRaw(trace, depth + 1, "forcePlay", `${entry.card.kind.name}'s onPlay effect resolves.`);
      return resolve(onPlay.effect, s, {
        playedCard: entry.card,
        activePlayer: ctx.activePlayer,
        numPlayers: ctx.numPlayers,
        playedFrom: "hand",
        playedOnValue,
      }, trace, depth + 1);
    }

    case "condemn": {
      const cid = resolveCard(program.card, ctx, state);
      const from = resolveZone(program.from, ctx);
      const allPlayers = Array.from({ length: ctx.numPlayers }, (_, i) => i as PlayerId);
      const knownBy = from.scope === "shared" ? allPlayers : [ctx.activePlayer, from.player];
      const result = zoneMove(state, cid, from, { scope: "shared", slot: "condemned" }, { face: "down", knownBy });
      return resolve(program.then, result.ok ? result.value : state, ctx, trace, depth);
    }

    case "swapWithCourt": {
      const courtCid = resolveCard(program.courtCard, ctx, state);
      const handCid = resolveCard(program.handCard, ctx, state);
      const handZone = resolveZone(program.handZone, ctx);
      const courtAddr: import("../zone-addr.js").IKZoneAddress = { scope: "shared", slot: "court" };
      const courtIdx = state.shared.court.findIndex((e) => e.card.id === courtCid);
      if (courtIdx < 0) return resolve(program.then, state, ctx, trace, depth);
      const courtName = state.shared.court[courtIdx]!.card.kind.name;
      const removedCourt = removeFromZone(state, courtAddr, courtCid);
      if (!removedCourt.ok) return resolve(program.then, state, ctx, trace, depth);
      const insertedHand = insertIntoZone(removedCourt.value.state, handZone, removedCourt.value.card);
      const s1 = insertedHand.ok ? insertedHand.value : removedCourt.value.state;
      const removedHand = removeFromZone(s1, handZone, handCid);
      if (!removedHand.ok) return resolve(program.then, s1, ctx, trace, depth);
      const handName = removedHand.value.card.kind.name;
      const insertedCourt = insertIntoZone(
        removedHand.value.state,
        courtAddr,
        removedHand.value.card,
        { insertAt: courtIdx },
      );
      const s2 = insertedCourt.ok ? insertedCourt.value : removedHand.value.state;
      emitRaw(trace, depth, "swapWithCourt", `Swapped ${courtName} (court position ${courtIdx}) with ${handName}.`);
      return resolve(program.then, s2, ctx, trace, depth);
    }

    case "withFirstCardIn": {
      const zone = resolveZone(program.zone, ctx);
      const cards = readZone(state, zone);
      if (cards.length === 0) return { tag: "done", state };
      emitRaw(trace, depth, "withFirstCardIn", `Found ${cards[0]!.kind.name}.`);
      return resolve(program.andThen(cards[0]!.id), state, ctx, trace, depth);
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
        resume: (choice) => {
          emitChoice(trace, depth, choice, options, state, player);
          return resolve(program.andThen(options[choice]!.cardId), state, ctx, trace, depth);
        },
      };
    }

    case "choosePlayer": {
      const options: ReadonlyArray<ChoiceOption> = Array.from(
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
        resume: (choice) => {
          emitChoice(trace, depth, choice, options, state, ctx.activePlayer);
          return resolve(program.andThen((options[choice] as { kind: "player"; player: PlayerId }).player), state, ctx, trace, depth);
        },
      };
    }

    case "nameCard": {
      const allNames: CardName[] = [
        "Fool", "Assassin", "Elder", "Zealot", "Inquisitor", "Soldier",
        "Judge", "Oathbound", "Immortal", "Warlord", "Mystic", "Warden",
        "Sentry", "King's Hand", "Princess", "Queen", "Executioner", "Bard",
        "Herald", "Spy", "Arbiter",
        "Flagbearer", "Stranger", "Aegis", "Ancestor", "Informant",
        "Nakturn", "Lockshift", "Conspiracist", "Exile",
      ];
      const options: ReadonlyArray<ChoiceOption> = allNames.map((n) => ({
        kind: "cardName" as const,
        name: n,
      }));
      return {
        tag: "needChoice",
        state,
        player: ctx.activePlayer,
        options,
        resume: (choice) => {
          emitChoice(trace, depth, choice, options, state, ctx.activePlayer);
          return resolve(program.andThen((options[choice] as { kind: "cardName"; name: CardName }).name), state, ctx, trace, depth);
        },
      };
    }

    case "nameValue": {
      const options: ReadonlyArray<ChoiceOption> = Array.from(
        { length: program.max - program.min + 1 },
        (_, i) => ({ kind: "value" as const, value: program.min + i }),
      );
      return {
        tag: "needChoice",
        state,
        player: ctx.activePlayer,
        options,
        resume: (choice) => {
          emitChoice(trace, depth, choice, options, state, ctx.activePlayer);
          return resolve(program.andThen((options[choice] as { kind: "value"; value: number }).value), state, ctx, trace, depth);
        },
      };
    }

    case "nameValueUpToCourtMax": {
      const maxVal = state.shared.court
        .filter((e) => e.face === "up")
        .reduce((m, e) => Math.max(m, e.card.kind.props.value), 0);
      if (maxVal < program.min) return { tag: "done", state };
      const options: ReadonlyArray<ChoiceOption> = Array.from(
        { length: maxVal - program.min + 1 },
        (_, i) => ({ kind: "value" as const, value: program.min + i }),
      );
      return {
        tag: "needChoice",
        state,
        player: ctx.activePlayer,
        options,
        resume: (choice) => {
          emitChoice(trace, depth, choice, options, state, ctx.activePlayer);
          return resolve(program.andThen((options[choice] as { kind: "value"; value: number }).value), state, ctx, trace, depth);
        },
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
      return resolve({ tag: "sequence", steps }, state, ctx, trace, depth);
    }

    case "forEachPlayer": {
      const players: PlayerId[] = Array.from(
        { length: ctx.numPlayers },
        (_, i) => i as PlayerId,
      );
      const steps = [
        ...players.map((p) => program.effect(p)),
        program.then,
      ];
      return resolve({ tag: "sequence", steps }, state, ctx, trace, depth);
    }

    case "optional": {
      const options: ReadonlyArray<ChoiceOption> = [
        { kind: "pass" },
        { kind: "proceed" },
      ];
      return {
        tag: "needChoice",
        state,
        player: ctx.activePlayer,
        options,
        resume: (choice) => {
          emitChoice(trace, depth, choice, options, state, ctx.activePlayer);
          return choice === 1
            ? resolve(program.effect, state, ctx, trace, depth)
            : resolve(program.otherwise, state, ctx, trace, depth);
        },
      };
    }

    case "triggerReaction": {
      if (shouldSkipTriggerReactionWindow(state, ctx, program.trigger)) {
        emitRaw(trace, depth, "triggerReaction", "All reactions publicly accounted for — skipping.");
        return resolve(program.continuation, state, ctx, trace, depth);
      }
      const opponents = opponentsInPlayOrder(state, ctx);
      return resolveReactionChain(
        opponents, 0, state, ctx,
        program.trigger,
        program.continuation, program.onReacted,
        trace, depth,
      );
    }

    case "forceLoser": {
      const player = resolvePlayer(program.player, ctx);
      return { tag: "done", state: { ...state, forcedLoser: player } };
    }

    case "khReactionWindow": {
      if (effectiveKeywords(state, ctx.playedCard).includes("immune_to_kings_hand")) {
        return resolve(program.continuation, state, ctx, trace, depth);
      }
      if (shouldSkipKHWindow(state, ctx)) {
        emitRaw(trace, depth, "khReactionWindow", "All King's Hand cards accounted for — skipping.");
        return resolve(program.continuation, state, ctx, trace, depth);
      }
      const opponents = opponentsInPlayOrder(state, ctx);
      return resolveKHReactionChain(
        opponents, 0, state, ctx,
        program.continuation,
        trace, depth,
      );
    }

    case "rally": {
      const armyZone = { scope: "player" as const, player: ctx.activePlayer, slot: "army" as const };
      const handZone = { scope: "player" as const, player: ctx.activePlayer, slot: "hand" as const };
      const armyCards = readZone(state, armyZone);
      if (armyCards.length === 0) {
        emitRaw(trace, depth, "rally", "No cards in army — skipping.");
        return resolve(program.then, state, ctx, trace, depth);
      }
      const options = armyCards.map((c) => ({ kind: "card" as const, cardId: c.id }));
      return {
        tag: "needChoice",
        state,
        player: ctx.activePlayer,
        options,
        resume: (choice) => {
          emitChoice(trace, depth, choice, options, state, ctx.activePlayer);
          const chosenId = options[choice]!.cardId;
          const result = zoneMove(state, chosenId, armyZone, handZone);
          const s = result.ok ? result.value : state;
          const tracked: IKState = {
            ...s,
            armyRecruitedIds: [...s.armyRecruitedIds, chosenId],
          };
          return resolve(program.then, tracked, ctx, trace, depth);
        },
      };
    }

    case "charismaticRally": {
      const armyZone = { scope: "player" as const, player: ctx.activePlayer, slot: "army" as const };
      const handZone = { scope: "player" as const, player: ctx.activePlayer, slot: "hand" as const };
      const armyCards = readZone(state, armyZone);
      const eligible = armyCards.filter((c) => c.kind.props.value <= program.maxValue);
      if (eligible.length === 0) {
        emitRaw(trace, depth, "charismaticRally", "No eligible army cards — skipping.");
        return resolve(program.then, state, ctx, trace, depth);
      }
      const options = eligible.map((c) => ({ kind: "card" as const, cardId: c.id }));
      return {
        tag: "needChoice",
        state,
        player: ctx.activePlayer,
        options,
        resume: (choice) => {
          emitChoice(trace, depth, choice, options, state, ctx.activePlayer);
          const chosenId = options[choice]!.cardId;
          const result = zoneMove(state, chosenId, armyZone, handZone);
          const s = result.ok ? result.value : state;
          const tracked: IKState = {
            ...s,
            armyRecruitedIds: [...s.armyRecruitedIds, chosenId],
            charismaticRallyIds: [...s.charismaticRallyIds, chosenId],
          };
          return resolve(program.then, tracked, ctx, trace, depth);
        },
      };
    }

    case "recall": {
      const exhaustZone = { scope: "player" as const, player: ctx.activePlayer, slot: "exhausted" as const };
      const armyZone = { scope: "player" as const, player: ctx.activePlayer, slot: "army" as const };
      const exhaustedCards = readZone(state, exhaustZone);
      const eligible = program.filter
        ? exhaustedCards.filter((c) => matchesFilter(c, program.filter!, state))
        : exhaustedCards;
      if (eligible.length === 0) {
        emitRaw(trace, depth, "recall", "No eligible exhausted cards — skipping.");
        return resolve(program.then, state, ctx, trace, depth);
      }
      const options = eligible.map((c) => ({ kind: "card" as const, cardId: c.id }));
      return {
        tag: "needChoice",
        state,
        player: ctx.activePlayer,
        options,
        resume: (choice) => {
          emitChoice(trace, depth, choice, options, state, ctx.activePlayer);
          const chosenId = options[choice]!.cardId;
          const result = zoneMove(state, chosenId, exhaustZone, armyZone);
          return resolve(program.then, result.ok ? result.value : state, ctx, trace, depth);
        },
      };
    }

    case "binaryChoice": {
      const player = resolvePlayer(program.player, ctx);
      const options: ReadonlyArray<ChoiceOption> = [
        { kind: "yesNo", value: false },
        { kind: "yesNo", value: true },
      ];
      return {
        tag: "needChoice",
        state,
        player,
        options,
        resume: (choice) => {
          emitChoice(trace, depth, choice, options, state, player);
          return resolve(program.andThen(choice === 1), state, ctx, trace, depth);
        },
      };
    }

    case "revealZone": {
      emitRaw(trace, depth, "revealZone", "Zone revealed.");
      return resolve(program.then, state, ctx, trace, depth);
    }

    case "checkDungeon": {
      const player = resolvePlayer(program.player, ctx);
      const pz = state.players[player]!;
      const dungeonCard = pz.dungeon?.card ?? null;
      const correct = dungeonCard !== null && dungeonCard.kind.name === ctx.playedCard.kind.name;
      emitRaw(trace, depth, "checkDungeon", correct ? "Dungeon guess correct!" : "Dungeon guess incorrect.");
      return resolve(program.andThen(correct), state, ctx, trace, depth);
    }

    case "removeFromRound": {
      const cid = resolveCard(program.card, ctx, state);
      const courtIdx = state.shared.court.findIndex((e) => e.card.id === cid);
      if (courtIdx >= 0) {
        const s: IKState = {
          ...state,
          shared: {
            ...state.shared,
            court: state.shared.court.filter((e) => e.card.id !== cid),
          },
        };
        return resolve(program.then, s, ctx, trace, depth);
      }
      return resolve(program.then, state, ctx, trace, depth);
    }

    case "returnOneRallied": {
      const handZone = { scope: "player" as const, player: ctx.activePlayer, slot: "hand" as const };
      const armyZone = { scope: "player" as const, player: ctx.activePlayer, slot: "army" as const };
      const hand = readZone(state, handZone);
      const ralliedInHand = state.armyRecruitedIds.filter(
        (id) => hand.some((c) => c.id === id),
      );
      if (ralliedInHand.length === 0) {
        emitRaw(trace, depth, "returnOneRallied", "No rallied cards in hand — skipping.");
        return resolve(program.then, state, ctx, trace, depth);
      }
      if (ralliedInHand.length === 1) {
        emitRaw(trace, depth, "returnOneRallied", "Only one rallied card — returning automatically.");
        const result = zoneMove(state, ralliedInHand[0]!, handZone, armyZone);
        return resolve(program.then, result.ok ? result.value : state, ctx, trace, depth);
      }
      const options = ralliedInHand.map((id) => ({ kind: "card" as const, cardId: id }));
      emitRaw(trace, depth, "returnOneRallied", `Reveal ${ralliedInHand.length} rallied cards; return one to army.`);
      return {
        tag: "needChoice",
        state,
        player: ctx.activePlayer,
        options,
        resume: (choice) => {
          emitChoice(trace, depth, choice, options, state, ctx.activePlayer);
          const chosenId = options[choice]!.cardId;
          const result = zoneMove(state, chosenId, handZone, armyZone);
          return resolve(program.then, result.ok ? result.value : state, ctx, trace, depth);
        },
      };
    }

    case "copyCardEffects": {
      const zone = resolveZone(program.zone, ctx);
      const cards = readZone(state, zone);
      const eligible = program.filter
        ? cards.filter((c) => matchesFilter(c, program.filter!, state))
        : cards;
      if (eligible.length === 0) {
        emitRaw(trace, depth, "copyCardEffects", "No eligible cards to copy.");
        return resolve({ tag: "done" }, state, ctx, trace, depth);
      }
      const options = eligible.map((c) => ({ kind: "card" as const, cardId: c.id }));
      emitRaw(trace, depth, "copyCardEffects", "Choose a card to copy.");
      return {
        tag: "needChoice",
        state,
        player: ctx.activePlayer,
        options,
        resume: (choice) => {
          emitChoice(trace, depth, choice, options, state, ctx.activePlayer);
          const chosenId = options[choice]!.cardId;
          const chosenCard = eligible.find((c) => c.id === chosenId);
          if (!chosenCard) return resolve({ tag: "done" }, state, ctx, trace, depth);

          const copiedOnPlay = chosenCard.kind.props.effects.find(
            (e): e is { readonly tag: "onPlay"; readonly effect: EffectProgram; readonly isOptional: boolean } =>
              e.tag === "onPlay",
          );

          const strangerEntry = state.shared.court.find(
            (e) => e.card.id === ctx.playedCard.id,
          );
          let s = state;
          if (strangerEntry) {
            s = {
              ...state,
              shared: {
                ...state.shared,
                court: state.shared.court.map((e) =>
                  e.card.id === ctx.playedCard.id
                    ? { ...e, copiedName: chosenCard.kind.name }
                    : e,
                ),
              },
            };
          }

          emitRaw(
            trace, depth, "copyCardEffects",
            `Stranger copies ${chosenCard.kind.name}'s ability.`,
          );

          const continuation = program.andThen(chosenId);

          if (!copiedOnPlay) {
            return resolve(continuation, s, ctx, trace, depth);
          }

          const copiedCtx: EffectContext = {
            ...ctx,
            copiedName: chosenCard.kind.name,
          };

          const copiedResolution = resolve(copiedOnPlay.effect, s, copiedCtx, trace, depth + 1);
          return chainResolution(copiedResolution, continuation, copiedCtx, trace, depth);
        },
      };
    }

    case "assassinate3p": {
      const victimId = resolvePlayer(program.victim, ctx);
      const assassinId = resolvePlayer(program.assassin, ctx);

      let s = state;
      const removed = removeFromZone(
        s,
        { scope: "player", player: assassinId, slot: "parting" },
        program.assassinCardId,
      );
      if (removed.ok) {
        s = {
          ...removed.value.state,
          players: removed.value.state.players.map((p, i) =>
            i === victimId
              ? { ...p, hand: [...p.hand, removed.value.card] }
              : p,
          ),
        };
      }

      emitRaw(trace, depth, "assassinate3p",
        `Player ${assassinId} assassinates Player ${victimId}. Pick a card from victim's hand + successor.`,
      );

      const victimZones = s.players[victimId]!;
      const pickable: Array<{ kind: "card"; cardId: number }> = victimZones.hand.map(
        (c) => ({ kind: "card" as const, cardId: c.id }),
      );
      if (victimZones.successor) {
        pickable.push({ kind: "card" as const, cardId: victimZones.successor.card.id });
      }

      const options: ReadonlyArray<ChoiceOption> = pickable;
      return {
        tag: "needChoice",
        state: s,
        player: assassinId,
        options,
        resume: (choice) => {
          emitChoice(trace, depth, choice, options, s, assassinId);
          const chosenId = pickable[choice]!.cardId;
          let afterPick = s;

          const inHand = victimZones.hand.find((c) => c.id === chosenId);
          if (inHand) {
            // Handle victim === assassin edge case (shouldn't happen, but defensive)
            if (victimId === assassinId) {
              // Card stays in hand, no transfer needed
            } else {
              afterPick = {
                ...afterPick,
                players: afterPick.players.map((p, i) => {
                  if (i === victimId) return { ...p, hand: p.hand.filter((c) => c.id !== chosenId) };
                  if (i === assassinId) return { ...p, hand: [...p.hand, inHand] };
                  return p;
                }),
              };
            }
          } else if (victimZones.successor?.card.id === chosenId) {
            // Handle victim === assassin edge case (shouldn't happen, but defensive)
            if (victimId === assassinId) {
              // Move successor to hand for the same player
              afterPick = {
                ...afterPick,
                players: afterPick.players.map((p, i) =>
                  i === victimId
                    ? { ...p, successor: null, hand: [...p.hand, victimZones.successor!.card] }
                    : p,
                ),
              };
            } else {
              afterPick = {
                ...afterPick,
                players: afterPick.players.map((p, i) => {
                  if (i === victimId) return { ...p, successor: null };
                  if (i === assassinId) return { ...p, hand: [...p.hand, victimZones.successor!.card] };
                  return p;
                }),
              };
            }
          }

          const eliminated: IKState = {
            ...afterPick,
            eliminatedPlayers: [...afterPick.eliminatedPlayers, victimId],
          };
          return { tag: "done", state: eliminated };
        },
      };
    }
  }
};

// ---------------------------------------------------------------------------
// KH public-knowledge tracking
// ---------------------------------------------------------------------------

const trackKHMove = (
  state: IKState,
  cardId: number,
  from: { readonly scope: "player" | "shared"; readonly slot: string },
): IKState => {
  const card = findCardInState(state, cardId);
  if (!card || card.kind.name !== "King's Hand") return state;
  if (state.publiclyTrackedKH.includes(cardId)) return state;
  if (from.scope === "shared") {
    return { ...state, publiclyTrackedKH: [...state.publiclyTrackedKH, cardId] };
  }
  return state;
};

const findCardInState = (state: IKState, cardId: number): import("../card.js").IKCard | null => {
  for (const p of state.players) {
    for (const c of p.hand) if (c.id === cardId) return c;
    if (p.successor?.card.id === cardId) return p.successor.card;
    if (p.dungeon?.card.id === cardId) return p.dungeon.card;
    if (p.squire?.card.id === cardId) return p.squire.card;
    for (const c of p.antechamber) if (c.id === cardId) return c;
    for (const c of p.parting) if (c.id === cardId) return c;
    for (const c of p.army) if (c.id === cardId) return c;
    for (const c of p.exhausted) if (c.id === cardId) return c;
    for (const c of p.recruitDiscard) if (c.id === cardId) return c;
  }
  for (const e of state.shared.court) if (e.card.id === cardId) return e.card;
  if (state.shared.accused?.id === cardId) return state.shared.accused;
  if (state.shared.forgotten?.card.id === cardId) return state.shared.forgotten.card;
  for (const e of state.shared.condemned) if (e.card.id === cardId) return e.card;
  return null;
};

const hasReactionTrigger = (
  card: IKCard,
  trigger: TriggerKind,
): boolean =>
  card.kind.props.effects.some(
    (effect) => effect.tag === "reaction" && effect.trigger === trigger,
  );

const isKnownToAllPlayers = (
  state: IKState,
  knownBy: ReadonlyArray<PlayerId>,
): boolean =>
  Array.from({ length: state.numPlayers }, (_, i) => i as PlayerId)
    .every((player) => knownBy.includes(player));

const countMatchingCards = (
  state: IKState,
  predicate: (card: IKCard) => boolean,
): { readonly total: number; readonly publicKnown: number } => {
  let total = 0;
  let publicKnown = 0;
  const publiclyTrackedKH = state.publiclyTrackedKH ?? [];
  const revealedSuccessors = state.revealedSuccessors ?? [];
  const record = (card: IKCard, isPublic: boolean): void => {
    if (!predicate(card)) return;
    total += 1;
    if (isPublic) publicKnown += 1;
  };

  for (const [player, zones] of state.players.entries()) {
    const playerId = player as PlayerId;
    for (const card of zones.hand) {
      record(
        card,
        card.kind.name === "King's Hand" && publiclyTrackedKH.includes(card.id),
      );
    }
    record(zones.king.card, zones.king.face === "up");
    if (zones.successor) {
      record(zones.successor.card, revealedSuccessors.includes(playerId));
    }
    if (zones.dungeon) record(zones.dungeon.card, false);
    if (zones.squire) record(zones.squire.card, false);
    for (const card of zones.antechamber) record(card, true);
    for (const card of zones.parting) record(card, true);
    for (const card of zones.army) record(card, true);
    for (const card of zones.exhausted) record(card, true);
    for (const card of zones.recruitDiscard) record(card, true);
  }

  for (const entry of state.shared.court) record(entry.card, true);
  if (state.shared.accused) record(state.shared.accused, true);
  if (state.shared.forgotten) record(state.shared.forgotten.card, false);
  for (const entry of state.shared.condemned) {
    record(entry.card, isKnownToAllPlayers(state, entry.knownBy));
  }

  return { total, publicKnown };
};

const allMatchingCardsArePublic = (
  state: IKState,
  predicate: (card: IKCard) => boolean,
): boolean => {
  const counts = countMatchingCards(state, predicate);
  return counts.total === counts.publicKnown;
};

// ---------------------------------------------------------------------------
// King's Hand reaction window helpers
// ---------------------------------------------------------------------------

const courtHasReactionNotOnThrone = (
  state: IKState,
  trigger: TriggerKind,
): boolean => {
  const topId = state.shared.court.length > 0
    ? state.shared.court[state.shared.court.length - 1]!.card.id
    : -1;
  return state.shared.court.some(
    (e) =>
      e.face === "up" &&
      e.card.id !== topId &&
      e.card.kind.props.effects.some(
        (ef) => ef.tag === "reaction" && ef.trigger === trigger,
      ),
  );
};

const courtHasKHNotOnThrone = (state: IKState): boolean => {
  const topId = state.shared.court.length > 0
    ? state.shared.court[state.shared.court.length - 1]!.card.id
    : -1;
  return state.shared.court.some(
    (e) =>
      e.face === "up" &&
      e.card.id !== topId &&
      e.card.kind.name === "King's Hand",
  );
};

const shouldSkipKHWindow = (state: IKState, ctx: EffectContext): boolean => {
  const courtHasKH = courtHasKHNotOnThrone(state);
  const opponents = opponentsInPlayOrder(state, ctx);
  const opponentCanActuallyReact = opponents.some((player) => {
    const hand = readZone(state, { scope: "player", player, slot: "hand" });
    return (
      hand.some((card) => card.kind.name === "King's Hand") ||
      (courtHasKH && hand.some((card) => card.kind.name === "Stranger"))
    );
  });
  if (opponentCanActuallyReact) return false;
  return (
    allMatchingCardsArePublic(state, (card) => card.kind.name === "King's Hand") &&
    (!courtHasKH ||
      allMatchingCardsArePublic(state, (card) => card.kind.name === "Stranger"))
  );
};

const shouldSkipTriggerReactionWindow = (
  state: IKState,
  ctx: EffectContext,
  trigger: TriggerKind,
): boolean => {
  const courtHasTrigger = courtHasReactionNotOnThrone(state, trigger);
  const opponents = opponentsInPlayOrder(state, ctx);
  const opponentCanActuallyReact = opponents.some((player) => {
    const hand = readZone(state, { scope: "player", player, slot: "hand" });
    return (
      hand.some((card) => hasReactionTrigger(card, trigger)) ||
      (courtHasTrigger && hand.some((card) => card.kind.name === "Stranger"))
    );
  });
  if (opponentCanActuallyReact) return false;
  return (
    allMatchingCardsArePublic(state, (card) => hasReactionTrigger(card, trigger)) &&
    (!courtHasTrigger ||
      allMatchingCardsArePublic(state, (card) => card.kind.name === "Stranger"))
  );
};

const opponentsInPlayOrder = (state: IKState, ctx: EffectContext): ReadonlyArray<PlayerId> => {
  const opponents: PlayerId[] = [];
  let current = ctx.activePlayer;
  for (let i = 1; i < ctx.numPlayers; i++) {
    current = nextPlayer(state, current);
    // Stop if we've looped back to the active player (all others eliminated)
    if (current === ctx.activePlayer) break;
    opponents.push(current);
  }
  return opponents;
};

const resolveKHReactionChain = (
  opponents: ReadonlyArray<PlayerId>,
  idx: number,
  state: IKState,
  ctx: EffectContext,
  continuation: EffectProgram,
  trace?: TraceSink,
  depth = 0,
): Resolution => {
  if (idx >= opponents.length) {
    return resolve(continuation, state, ctx, trace, depth);
  }
  const opp = opponents[idx]!;
  const hand = readZone(state, { scope: "player", player: opp, slot: "hand" });
  const khCard = hand.find((c) => c.kind.name === "King's Hand");
  const strangerAsKH = !khCard && courtHasKHNotOnThrone(state)
    ? hand.find((c) => c.kind.name === "Stranger")
    : null;
  const reactorCard = khCard ?? strangerAsKH;

  emitRaw(
    trace, depth, "khReactionWindow",
    `Player ${opp} reaction window (King's Hand).`,
  );

  const options: ReadonlyArray<ChoiceOption> = [{ kind: "pass" }, { kind: "proceed" }];
  return {
    tag: "needChoice",
    state,
    player: opp,
    options,
    isReactionWindow: true,
    reactionWindowKind: "kings_hand",
    resume: (choice) => {
      emitChoice(trace, depth, choice, options, state, opp);
      if (choice === 1 && reactorCard) {
        emitRaw(trace, depth, "khReactionWindow",
          strangerAsKH
            ? `Player ${opp} reacts with Stranger (copying King's Hand)!`
            : `Player ${opp} reacts with King's Hand!`,
        );
        let s = state;
        const removedReactor = removeFromZone(s, { scope: "player", player: opp, slot: "hand" }, reactorCard.id);
        if (removedReactor.ok) {
          const toOppParting = insertIntoZone(
            removedReactor.value.state,
            { scope: "player", player: opp, slot: "parting" },
            removedReactor.value.card,
          );
          s = toOppParting.ok ? toOppParting.value : removedReactor.value.state;
        }
        const playedId = ctx.playedCard.id;
        const removedPlayed = removeFromZone(s, { scope: "shared", slot: "court" }, playedId);
        if (removedPlayed.ok) {
          const toActiveParting = insertIntoZone(
            removedPlayed.value.state,
            { scope: "player", player: ctx.activePlayer, slot: "parting" },
            removedPlayed.value.card,
          );
          s = toActiveParting.ok ? toActiveParting.value : removedPlayed.value.state;
        }
        return { tag: "done", state: { ...s, khPrevented: true } };
      }
      return resolveKHReactionChain(
        opponents, idx + 1, state, ctx,
        continuation,
        trace, depth,
      );
    },
  };
};

// ---------------------------------------------------------------------------
// Legacy reaction helpers (Assassin king-flip)
// ---------------------------------------------------------------------------

const findReactionCard = (
  state: IKState,
  player: PlayerId,
  trigger: TriggerKind,
): { readonly cardId: number; readonly usedStranger: boolean } | null => {
  const hand = readZone(state, {
    scope: "player",
    player,
    slot: "hand",
  });
  const liveReaction = hand.find((card) => hasReactionTrigger(card, trigger));
  if (liveReaction) return { cardId: liveReaction.id, usedStranger: false };
  if (!courtHasReactionNotOnThrone(state, trigger)) return null;
  const stranger = hand.find((card) => card.kind.name === "Stranger");
  return stranger ? { cardId: stranger.id, usedStranger: true } : null;
};

const resolveReactionChain = (
  opponents: ReadonlyArray<PlayerId>,
  idx: number,
  state: IKState,
  ctx: EffectContext,
  trigger: TriggerKind,
  continuation: EffectProgram,
  onReacted: EffectProgram,
  trace?: TraceSink,
  depth = 0,
): Resolution => {
  if (idx >= opponents.length) {
    return resolve(continuation, state, ctx, trace, depth);
  }
  const reactor = opponents[idx]!;
  const reactionCard = findReactionCard(state, reactor, trigger);
  emitRaw(
    trace, depth, "triggerReaction",
    `Player ${reactor} may react with ${trigger === "king_flip" ? "Assassin" : "a reaction card"}.`,
  );
  const options: ReadonlyArray<ChoiceOption> = [{ kind: "pass" }, { kind: "proceed" }];
  return {
    tag: "needChoice",
    state,
    player: reactor,
    options,
    isReactionWindow: true,
    reactionWindowKind: "king_flip",
    resume: (choice) => {
      emitChoice(trace, depth, choice, options, state, reactor);
      if (choice === 1 && reactionCard) {
        const removed = removeFromZone(
          state,
          { scope: "player", player: reactor, slot: "hand" },
          reactionCard.cardId,
        );
        let s = removed.ok ? removed.value.state : state;
        if (removed.ok) {
          const toParting = insertIntoZone(
            s,
            { scope: "player", player: reactor, slot: "parting" },
            removed.value.card,
          );
          if (toParting.ok) s = toParting.value;
        }

        const effectiveOnReacted = ctx.numPlayers === 3
          ? { tag: "assassinate3p" as const, victim: { kind: "active" as const }, assassin: { kind: "id" as const, player: reactor }, assassinCardId: reactionCard.cardId }
          : onReacted;

        const reactorCtx: EffectContext = {
          ...ctx,
          activePlayer: reactor,
        };
        if (shouldSkipKHWindow(s, reactorCtx)) {
          return resolve(effectiveOnReacted, s, ctx, trace, depth + 1);
        }
        const khOpponents = opponentsInPlayOrder(s, reactorCtx);
        return resolveKHCounterReaction(
          khOpponents, 0, s, ctx,
          { player: reactor, cardId: reactionCard.cardId }, effectiveOnReacted, continuation,
          trace, depth + 1,
        );
      }
      return resolveReactionChain(
        opponents, idx + 1, state, ctx,
        trigger, continuation, onReacted,
        trace, depth,
      );
    },
  };
};

const resolveKHCounterReaction = (
  opponents: ReadonlyArray<PlayerId>,
  idx: number,
  state: IKState,
  ctx: EffectContext,
  assassinReactor: { readonly player: PlayerId; readonly cardId: number },
  onReacted: EffectProgram,
  continuation: EffectProgram,
  trace?: TraceSink,
  depth = 0,
): Resolution => {
  if (idx >= opponents.length) {
    return resolve(onReacted, state, ctx, trace, depth);
  }
  const opp = opponents[idx]!;
  const hand = readZone(state, { scope: "player", player: opp, slot: "hand" });
  const khCard = hand.find((c) => c.kind.name === "King's Hand");
  const strangerAsKH = !khCard && courtHasKHNotOnThrone(state)
    ? hand.find((c) => c.kind.name === "Stranger")
    : null;
  const reactorCard = khCard ?? strangerAsKH;

  emitRaw(trace, depth, "khReactionWindow", `Player ${opp} may counter-react with King's Hand.`);

  const options: ReadonlyArray<ChoiceOption> = [{ kind: "pass" }, { kind: "proceed" }];
  return {
    tag: "needChoice",
    state,
    player: opp,
    options,
    isReactionWindow: true,
    reactionWindowKind: "kings_hand",
    resume: (choice) => {
      emitChoice(trace, depth, choice, options, state, opp);
      if (choice === 1 && reactorCard) {
        emitRaw(trace, depth, "khReactionWindow",
          strangerAsKH
            ? `Player ${opp} counters Assassin with Stranger (copying King's Hand)!`
            : `Player ${opp} counters Assassin with King's Hand!`,
        );
        let s = state;
        const removedReactor = removeFromZone(s, { scope: "player", player: opp, slot: "hand" }, reactorCard.id);
        if (removedReactor.ok) {
          const toOppParting = insertIntoZone(
            removedReactor.value.state,
            { scope: "player", player: opp, slot: "parting" },
            removedReactor.value.card,
          );
          s = toOppParting.ok ? toOppParting.value : removedReactor.value.state;
        }
        return withKhPrevented(resolve(continuation, s, ctx, trace, depth));
      }
      return resolveKHCounterReaction(
        opponents, idx + 1, state, ctx,
        assassinReactor, onReacted, continuation,
        trace, depth,
      );
    },
  };
};

const withKhPrevented = (resolution: Resolution): Resolution =>
  resolution.tag === "done"
    ? {
        tag: "done",
        state: {
          ...resolution.state,
          khPrevented: true,
        },
      }
    : {
        ...resolution,
        resume: (choice) => withKhPrevented(resolution.resume(choice)),
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
  trace?: TraceSink,
): Resolution => {
  let resolution = resolve(program, state, ctx, trace);
  for (const choice of choices) {
    if (resolution.tag !== "needChoice") break;
    resolution = resolution.resume(choice);
  }
  return resolution;
};
