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

export type IKPlayAction = IKPlayCardAction | IKDisgraceAction;
export type IKAction = IKCrownAction | IKSetupAction | IKPlayAction;

export interface ActionCodecConfig {
  readonly maxCardId: number;
}

export type EncodeError =
  | { readonly kind: "play_card_out_of_range"; readonly cardId: number; readonly maxCardId: number }
  | { readonly kind: "commit_successor_out_of_range"; readonly successorId: number; readonly maxCardId: number }
  | { readonly kind: "commit_dungeon_out_of_range"; readonly dungeonId: number; readonly maxCardId: number };

export type DecodeError =
  | { readonly kind: "negative"; readonly encoded: number }
  | { readonly kind: "out_of_range"; readonly encoded: number; readonly maxEncoded: number }
  | { readonly kind: "invalid_commit"; readonly successorId: number; readonly dungeonId: number };

const DISGRACE_SLOT = 0;
const PLAY_OFFSET = 1;

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
  if (action.kind === "crown") {
    const crownOffset = PLAY_OFFSET + config.maxCardId + 1;
    const commitSlots = (config.maxCardId + 1) * (config.maxCardId + 1);
    return ok(crownOffset + commitSlots + action.firstPlayer);
  }

  if (action.kind === "disgrace") return ok(DISGRACE_SLOT);

  if (action.kind === "play") {
    if (action.cardId < 0 || action.cardId > config.maxCardId) {
      return err({ kind: "play_card_out_of_range", cardId: action.cardId, maxCardId: config.maxCardId });
    }
    return ok(PLAY_OFFSET + action.cardId);
  }

  const commitBase = PLAY_OFFSET + config.maxCardId + 1;
  const stride = config.maxCardId + 1;
  if (action.successorId < 0 || action.successorId > config.maxCardId) {
    return err({ kind: "commit_successor_out_of_range", successorId: action.successorId, maxCardId: config.maxCardId });
  }
  if (action.dungeonId < 0 || action.dungeonId > config.maxCardId) {
    return err({ kind: "commit_dungeon_out_of_range", dungeonId: action.dungeonId, maxCardId: config.maxCardId });
  }
  return ok(commitBase + action.successorId * stride + action.dungeonId);
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

  if (encoded === DISGRACE_SLOT) return ok({ kind: "disgrace" });

  const playMax = PLAY_OFFSET + config.maxCardId;
  if (encoded <= playMax) {
    return ok({ kind: "play", cardId: encoded - PLAY_OFFSET });
  }

  const commitBase = PLAY_OFFSET + config.maxCardId + 1;
  const stride = config.maxCardId + 1;
  const commitSlots = stride * stride;
  const commitMax = commitBase + commitSlots - 1;

  if (encoded <= commitMax) {
    const offset = encoded - commitBase;
    const successorId = Math.floor(offset / stride);
    const dungeonId = offset % stride;
    if (successorId === dungeonId) {
      return err({ kind: "invalid_commit", successorId, dungeonId });
    }
    return ok({ kind: "commit", successorId, dungeonId });
  }

  const crownBase = commitBase + commitSlots;
  const crownPlayer = encoded - crownBase;
  if (crownPlayer >= 0) {
    return ok({ kind: "crown", firstPlayer: crownPlayer });
  }

  return err({ kind: "out_of_range", encoded, maxEncoded: crownBase + 3 });
};
