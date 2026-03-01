import { ok, err, unwrap, type Result } from "@imposter-zero/types";

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
export type IKAction = IKSetupAction | IKPlayAction;

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

const baseCardSpan = (config: ActionCodecConfig): number => config.maxCardId + 1;
const commitOffset = (config: ActionCodecConfig): number => baseCardSpan(config) + 1;

const maxEncodedValue = (config: ActionCodecConfig): number => {
  const span = baseCardSpan(config);
  return commitOffset(config) + span * span - 1;
};

export const encodeActionSafe = (
  action: IKAction,
  config: ActionCodecConfig,
): Result<EncodeError, number> => {
  const span = baseCardSpan(config);

  if (action.kind === "play") {
    if (action.cardId < 0 || action.cardId >= span) {
      return err({ kind: "play_card_out_of_range", cardId: action.cardId, maxCardId: config.maxCardId });
    }
    return ok(action.cardId);
  }

  if (action.kind === "disgrace") {
    return ok(span);
  }

  if (action.successorId < 0 || action.successorId >= span) {
    return err({ kind: "commit_successor_out_of_range", successorId: action.successorId, maxCardId: config.maxCardId });
  }

  if (action.dungeonId < 0 || action.dungeonId >= span) {
    return err({ kind: "commit_dungeon_out_of_range", dungeonId: action.dungeonId, maxCardId: config.maxCardId });
  }

  return ok(commitOffset(config) + action.successorId * span + action.dungeonId);
};

export const decodeActionSafe = (
  encoded: number,
  config: ActionCodecConfig,
): Result<DecodeError, IKAction> => {
  const span = baseCardSpan(config);

  if (encoded < 0) {
    return err({ kind: "negative", encoded });
  }

  if (encoded > maxEncodedValue(config)) {
    return err({ kind: "out_of_range", encoded, maxEncoded: maxEncodedValue(config) });
  }

  if (encoded < span) {
    return ok({ kind: "play", cardId: encoded });
  }

  if (encoded === span) {
    return ok({ kind: "disgrace" });
  }

  const raw = encoded - commitOffset(config);
  const successorId = Math.floor(raw / span);
  const dungeonId = raw % span;

  if (successorId === dungeonId) {
    return err({ kind: "invalid_commit", successorId, dungeonId });
  }

  return ok({ kind: "commit", successorId, dungeonId });
};

export const encodeAction = (action: IKAction, config: ActionCodecConfig): number =>
  unwrap(encodeActionSafe(action, config));

export const decodeAction = (encoded: number, config: ActionCodecConfig): IKAction =>
  unwrap(decodeActionSafe(encoded, config));
