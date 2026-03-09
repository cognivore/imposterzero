import { describe, expect, it } from "vitest";

import {
  flattenTranscript,
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

const replayMismatchMessage = (label: string, transcript: Parameters<typeof replayStage4Transcript>[0]): string => {
  try {
    replayStage4Transcript(transcript);
    throw new Error(`${label}: expected replay mismatch but replay succeeded`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.info(`[stage4-test] ${label} mismatch\n${message}`);
    return message;
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

  it("advances Goose vs Will replay past the Sentry court-position and squireId=0 fixes", () => {
    const message = replayMismatchMessage("Goose/Will", GOOSE_WILL_STAGE4_GOLDEN);
    expect(message).toMatch(/round [4-7]/);
  });

  it("advances Calm vs katto replay past the accused-tracking and KH-counter fixes", () => {
    const message = replayMismatchMessage("Calm/katto", CALM_KATTO_STAGE4_GOLDEN);
    expect(message).toMatch(/round 1/i);
  });
});
