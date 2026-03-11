import { describe, expect, it } from "vitest";

import {
  flattenTranscript,
  Stage4TranscriptAtomicParseError,
  Stage4TranscriptStructureError,
  parseStage4Transcript,
  parseStage4TranscriptDocuments,
} from "./stage4-transcript-parser.js";
import {
  CALM_KATTO_STAGE4_TRANSCRIPT,
  GOOSE_WILL_STAGE4_TRANSCRIPT,
  STAGE4_TRANSCRIPT_DOCUMENTS,
} from "./stage4-transcripts.js";
import { replayStage4Transcript } from "./stage4-replay.js";

const normalizeTranscript = (raw: string): ReadonlyArray<string> =>
  raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("==="));

const CALM_KATTO_STAGE4_GOLDEN = parseStage4Transcript(
  CALM_KATTO_STAGE4_TRANSCRIPT,
  "1v1 Stage 4 - Calm vs katto",
);

const GOOSE_WILL_STAGE4_GOLDEN = parseStage4Transcript(
  GOOSE_WILL_STAGE4_TRANSCRIPT,
  "1v1 Stage 4 - Goose vs Will",
);

const expectReplayParity = (
  label: string,
  transcript: Parameters<typeof replayStage4Transcript>[0],
): void => {
  try {
    replayStage4Transcript(transcript);
  } catch (error) {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    console.info(`[stage4-test] ${label} parity failure\n${message}`);
    throw error;
  }
};

describe("Stage 4 golden parity", () => {
  it("parses pasted transcript documents with a combinator grammar", () => {
    const fixtures = parseStage4TranscriptDocuments(STAGE4_TRANSCRIPT_DOCUMENTS);

    expect(fixtures).toHaveLength(2);
    expect(fixtures[0]!.players).toEqual(["Calm", "katto"]);
    expect(fixtures[1]!.players).toEqual(["Goose", "Will"]);
  });

  it("preserves the Goose vs Will transcript verbatim after parsing", () => {
    expect(flattenTranscript(GOOSE_WILL_STAGE4_GOLDEN)).toEqual(
      normalizeTranscript(GOOSE_WILL_STAGE4_TRANSCRIPT),
    );
    expect(GOOSE_WILL_STAGE4_GOLDEN.rounds).toHaveLength(7);
    expect(GOOSE_WILL_STAGE4_GOLDEN.finalScore).toEqual([9, 4]);
    expect(GOOSE_WILL_STAGE4_GOLDEN.reportedFinalScore).toEqual([9, 4]);
  });

  it("preserves the Calm vs katto transcript verbatim after parsing", () => {
    expect(flattenTranscript(CALM_KATTO_STAGE4_GOLDEN)).toEqual(
      normalizeTranscript(CALM_KATTO_STAGE4_TRANSCRIPT),
    );
    expect(CALM_KATTO_STAGE4_GOLDEN.rounds).toHaveLength(6);
    expect(CALM_KATTO_STAGE4_GOLDEN.finalScore).toEqual([4, 7]);
    expect(CALM_KATTO_STAGE4_GOLDEN.reportedFinalScore).toEqual([7, 4]);
    expect(CALM_KATTO_STAGE4_GOLDEN.finalScoreTranscriptOrder).toBe("reverse");
  });

  it("reports atomic parse failures with line numbers", () => {
    const malformed = GOOSE_WILL_STAGE4_TRANSCRIPT.replace(
      'Will played Judge and said card name "Princess".',
      'Will played Judge and said card title "Princess".',
    );

    let caught: unknown;
    try {
      parseStage4Transcript(malformed, "malformed Stage 4 transcript");
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Stage4TranscriptAtomicParseError);
    expect((caught as Stage4TranscriptAtomicParseError).lineNumber).toBeGreaterThan(0);
    expect((caught as Error).message).toMatch(/line/i);
  });

  it("reports structural transcript failures with context", () => {
    const malformed = `${GOOSE_WILL_STAGE4_TRANSCRIPT}\nGoose ended muster.`;

    let caught: unknown;
    try {
      parseStage4Transcript(malformed, "malformed Stage 4 transcript");
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Stage4TranscriptStructureError);
    expect((caught as Stage4TranscriptStructureError).lineNumber).toBeGreaterThan(0);
    expect((caught as Error).message).toMatch(/final score line must be the last line/i);
  });

  it("replays Goose vs Will at full parity", () => {
    expectReplayParity("Goose/Will", GOOSE_WILL_STAGE4_GOLDEN);
  });

  // Transcript played under pre-fix rules where mute did not affect keyword
  // filters (notRoyalty / notDisgracedOrRoyalty).  Immortal's continuous mute
  // now strips Royalty for targeting, changing the available choices and
  // invalidating the recorded choice indices.  Re-record once a new Calm vs
  // katto match is available.
  it.skip("replays Calm vs katto at full parity", () => {
    expectReplayParity("Calm/katto", CALM_KATTO_STAGE4_GOLDEN);
  });
});
