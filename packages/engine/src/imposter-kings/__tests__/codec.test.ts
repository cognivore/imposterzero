import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

import {
  encodeAction,
  decodeAction,
  encodeActionSafe,
  decodeActionSafe,
  type IKAction,
  type ActionCodecConfig,
} from "../actions.js";

const config: ActionCodecConfig = { maxCardId: 25 };
const span = config.maxCardId + 1;

const actionArb = (cfg: ActionCodecConfig): fc.Arbitrary<IKAction> => {
  const cardIdArb = fc.integer({ min: 0, max: cfg.maxCardId });
  const play = cardIdArb.map((cardId): IKAction => ({ kind: "play", cardId }));
  const disgrace = fc.constant<IKAction>({ kind: "disgrace" });
  const commit = fc
    .tuple(cardIdArb, cardIdArb)
    .filter(([a, b]) => a !== b)
    .map(([successorId, dungeonId]): IKAction => ({ kind: "commit", successorId, dungeonId }));
  return fc.oneof(play, disgrace, commit);
};

describe("encodeAction / decodeAction (throwing wrappers)", () => {
  describe("play actions", () => {
    it("encodes play as cardId + 1", () => {
      expect(encodeAction({ kind: "play", cardId: 0 }, config)).toBe(1);
      expect(encodeAction({ kind: "play", cardId: 5 }, config)).toBe(6);
      expect(encodeAction({ kind: "play", cardId: 25 }, config)).toBe(26);
    });

    it("decodes values in [1, span] as play", () => {
      expect(decodeAction(1, config)).toEqual({ kind: "play", cardId: 0 });
      expect(decodeAction(13, config)).toEqual({ kind: "play", cardId: 12 });
      expect(decodeAction(26, config)).toEqual({ kind: "play", cardId: 25 });
    });
  });

  describe("disgrace action", () => {
    it("encodes disgrace as 0", () => {
      expect(encodeAction({ kind: "disgrace" }, config)).toBe(0);
    });

    it("decodes 0 as disgrace", () => {
      expect(decodeAction(0, config)).toEqual({ kind: "disgrace" });
    });
  });

  describe("commit actions", () => {
    it("encodes commit above disgrace", () => {
      const encoded = encodeAction({ kind: "commit", successorId: 0, dungeonId: 1 }, config);
      expect(encoded).toBeGreaterThan(span);
    });

    it("roundtrips a specific commit", () => {
      const action: IKAction = { kind: "commit", successorId: 3, dungeonId: 7 };
      const encoded = encodeAction(action, config);
      expect(decodeAction(encoded, config)).toEqual(action);
    });
  });

  describe("roundtrip property", () => {
    it("decode(encode(a)) === a for all legal actions", () => {
      fc.assert(
        fc.property(actionArb(config), (action) => {
          const encoded = encodeAction(action, config);
          const decoded = decodeAction(encoded, config);
          expect(decoded).toEqual(action);
        }),
      );
    });
  });

  describe("encode domain boundaries", () => {
    it("throws on negative play cardId", () => {
      expect(() => encodeAction({ kind: "play", cardId: -1 }, config)).toThrow();
    });

    it("throws on play cardId beyond maxCardId", () => {
      expect(() => encodeAction({ kind: "play", cardId: span }, config)).toThrow();
    });

    it("throws on commit with negative successorId", () => {
      expect(() =>
        encodeAction({ kind: "commit", successorId: -1, dungeonId: 0 }, config),
      ).toThrow();
    });

    it("throws on commit with out-of-range dungeonId", () => {
      expect(() =>
        encodeAction({ kind: "commit", successorId: 0, dungeonId: span }, config),
      ).toThrow();
    });
  });

  describe("decode domain boundaries", () => {
    it("throws on negative encoded value", () => {
      expect(() => decodeAction(-1, config)).toThrow();
    });

    it("decodes values at crown base as crown actions", () => {
      const crownBase = 1 + span + span * span;
      expect(decodeAction(crownBase, config)).toEqual({ kind: "crown", firstPlayer: 0 });
    });
  });
});

describe("encodeActionSafe / decodeActionSafe (Result API)", () => {
  describe("encode errors", () => {
    it("returns err for out-of-range play cardId", () => {
      const result = encodeActionSafe({ kind: "play", cardId: -1 }, config);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe("play_card_out_of_range");
    });

    it("returns err for out-of-range commit successorId", () => {
      const result = encodeActionSafe({ kind: "commit", successorId: 999, dungeonId: 0 }, config);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe("commit_successor_out_of_range");
    });

    it("returns err for out-of-range commit dungeonId", () => {
      const result = encodeActionSafe({ kind: "commit", successorId: 0, dungeonId: -1 }, config);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe("commit_dungeon_out_of_range");
    });

    it("returns ok for valid actions", () => {
      const result = encodeActionSafe({ kind: "play", cardId: 5 }, config);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toBe(6);
    });
  });

  describe("decode errors", () => {
    it("returns err for negative values", () => {
      const result = decodeActionSafe(-1, config);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe("negative");
    });

    it("returns ok for crown range values", () => {
      const crownBase = 1 + span + span * span;
      const result = decodeActionSafe(crownBase, config);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toEqual({ kind: "crown", firstPlayer: 0 });
    });

    it("returns err for commit where successorId === dungeonId", () => {
      const offset = span + 1;
      const selfCommit = offset + 3 * span + 3;
      const result = decodeActionSafe(selfCommit, config);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("invalid_commit");
        if (result.error.kind === "invalid_commit") {
          expect(result.error.successorId).toBe(result.error.dungeonId);
        }
      }
    });

    it("returns ok for valid encoded values", () => {
      const result = decodeActionSafe(0, config);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toEqual({ kind: "disgrace" });
    });
  });

  describe("inverse law property (safe)", () => {
    it("decodeSafe(encodeSafe(a)).value === a", () => {
      fc.assert(
        fc.property(actionArb(config), (action) => {
          const encResult = encodeActionSafe(action, config);
          expect(encResult.ok).toBe(true);
          if (!encResult.ok) return;
          const decResult = decodeActionSafe(encResult.value, config);
          expect(decResult.ok).toBe(true);
          if (decResult.ok) expect(decResult.value).toEqual(action);
        }),
      );
    });

    it("encodeSafe(decodeSafe(i)).value === i for valid encoded domain", () => {
      const validEncodedArb = fc.integer({ min: 0, max: span + span * span }).filter((i) => {
        const r = decodeActionSafe(i, config);
        return r.ok;
      });
      fc.assert(
        fc.property(validEncodedArb, (encoded) => {
          const action = decodeActionSafe(encoded, config);
          expect(action.ok).toBe(true);
          if (!action.ok) return;
          const reEncoded = encodeActionSafe(action.value, config);
          expect(reEncoded.ok).toBe(true);
          if (reEncoded.ok) expect(reEncoded.value).toBe(encoded);
        }),
      );
    });
  });
});
