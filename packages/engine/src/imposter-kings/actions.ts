import type { PlayerId } from "@imposter-zero/types";
import { ok, err, unwrap, type Result } from "@imposter-zero/types";

export interface IKCrownAction {
  readonly kind: "crown";
  readonly firstPlayer: PlayerId;
}

export interface IKSetupAction {
  readonly kind: "commit";
  readonly successorId: number;
  readonly dungeonId: number;
}

export interface IKPlayCardAction {
  readonly kind: "play";
  readonly cardId: number;
}

export interface IKDisgraceAction {
  readonly kind: "disgrace";
}

export interface IKEffectChoiceAction {
  readonly kind: "effect_choice";
  readonly choice: number;
}

export type IKPlayAction = IKPlayCardAction | IKDisgraceAction;
export type IKAction = IKCrownAction | IKSetupAction | IKPlayAction | IKEffectChoiceAction;

export interface ActionCodecConfig {
  readonly maxCardId: number;
  readonly maxPlayers?: number;
  readonly maxEffectChoices?: number;
}

export type EncodeError =
  | { readonly kind: "play_card_out_of_range"; readonly cardId: number; readonly maxCardId: number }
  | { readonly kind: "commit_successor_out_of_range"; readonly successorId: number; readonly maxCardId: number }
  | { readonly kind: "commit_dungeon_out_of_range"; readonly dungeonId: number; readonly maxCardId: number }
  | { readonly kind: "effect_choice_out_of_range"; readonly choice: number; readonly max: number };

export type DecodeError =
  | { readonly kind: "negative"; readonly encoded: number }
  | { readonly kind: "out_of_range"; readonly encoded: number; readonly maxEncoded: number }
  | { readonly kind: "invalid_commit"; readonly successorId: number; readonly dungeonId: number };

const DISGRACE_SLOT = 0;
const PLAY_OFFSET = 1;
const DEFAULT_MAX_PLAYERS = 4;
const DEFAULT_MAX_EFFECT_CHOICES = 50;

const codecLayout = (config: ActionCodecConfig) => {
  const span = config.maxCardId + 1;
  const commitBase = PLAY_OFFSET + span;
  const commitSlots = span * span;
  const crownBase = commitBase + commitSlots;
  const maxPlayers = config.maxPlayers ?? DEFAULT_MAX_PLAYERS;
  const choiceBase = crownBase + maxPlayers;
  const maxEffectChoices = config.maxEffectChoices ?? DEFAULT_MAX_EFFECT_CHOICES;
  const maxEncoded = choiceBase + maxEffectChoices - 1;
  return { span, commitBase, commitSlots, crownBase, maxPlayers, choiceBase, maxEffectChoices, maxEncoded };
};

export const encodeAction = (
  action: IKAction,
  config: ActionCodecConfig,
): number => {
  const result = encodeActionSafe(action, config);
  return unwrap(result);
};

export const encodeActionSafe = (
  action: IKAction,
  config: ActionCodecConfig,
): Result<EncodeError, number> => {
  const layout = codecLayout(config);

  if (action.kind === "disgrace") return ok(DISGRACE_SLOT);

  if (action.kind === "play") {
    if (action.cardId < 0 || action.cardId > config.maxCardId) {
      return err({ kind: "play_card_out_of_range", cardId: action.cardId, maxCardId: config.maxCardId });
    }
    return ok(PLAY_OFFSET + action.cardId);
  }

  if (action.kind === "commit") {
    if (action.successorId < 0 || action.successorId > config.maxCardId) {
      return err({ kind: "commit_successor_out_of_range", successorId: action.successorId, maxCardId: config.maxCardId });
    }
    if (action.dungeonId < 0 || action.dungeonId > config.maxCardId) {
      return err({ kind: "commit_dungeon_out_of_range", dungeonId: action.dungeonId, maxCardId: config.maxCardId });
    }
    return ok(layout.commitBase + action.successorId * layout.span + action.dungeonId);
  }

  if (action.kind === "crown") {
    return ok(layout.crownBase + action.firstPlayer);
  }

  if (action.choice < 0 || action.choice >= layout.maxEffectChoices) {
    return err({ kind: "effect_choice_out_of_range", choice: action.choice, max: layout.maxEffectChoices });
  }
  return ok(layout.choiceBase + action.choice);
};

export const decodeAction = (
  encoded: number,
  config: ActionCodecConfig,
): IKAction => {
  const result = decodeActionSafe(encoded, config);
  return unwrap(result);
};

export const decodeActionSafe = (
  encoded: number,
  config: ActionCodecConfig,
): Result<DecodeError, IKAction> => {
  if (encoded < 0) return err({ kind: "negative", encoded });

  const layout = codecLayout(config);

  if (encoded === DISGRACE_SLOT) return ok({ kind: "disgrace" });

  const playMax = PLAY_OFFSET + config.maxCardId;
  if (encoded <= playMax) {
    return ok({ kind: "play", cardId: encoded - PLAY_OFFSET });
  }

  const commitMax = layout.commitBase + layout.commitSlots - 1;
  if (encoded <= commitMax) {
    const offset = encoded - layout.commitBase;
    const successorId = Math.floor(offset / layout.span);
    const dungeonId = offset % layout.span;
    if (successorId === dungeonId) {
      return err({ kind: "invalid_commit", successorId, dungeonId });
    }
    return ok({ kind: "commit", successorId, dungeonId });
  }

  const crownMax = layout.crownBase + layout.maxPlayers - 1;
  if (encoded <= crownMax) {
    return ok({ kind: "crown", firstPlayer: (encoded - layout.crownBase) as PlayerId });
  }

  if (encoded <= layout.maxEncoded) {
    return ok({ kind: "effect_choice", choice: encoded - layout.choiceBase });
  }

  return err({ kind: "out_of_range", encoded, maxEncoded: layout.maxEncoded });
};
