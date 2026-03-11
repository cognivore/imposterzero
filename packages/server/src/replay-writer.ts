/**
 * File-based ReplaySink — streams replay events as NDJSON.
 *
 * One file per match: {baseDir}/{matchId}.ndjson
 * Each line is a self-contained JSON-encoded ReplayEvent.
 */

import { mkdirSync, appendFileSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { ReplayEvent, ReplaySink } from "@imposter-zero/types";

const ensureDir = (dir: string): void => {
  mkdirSync(dir, { recursive: true });
};

const replayPath = (baseDir: string, matchId: string): string =>
  join(baseDir, `${matchId}.ndjson`);

export const fileReplaySink = <S, A>(baseDir: string): ReplaySink<S, A> => {
  ensureDir(baseDir);
  let currentPath: string | null = null;

  return (event: ReplayEvent<S, A>): void => {
    if (event.type === "match_start") {
      currentPath = replayPath(baseDir, event.matchId);
    }
    if (currentPath === null) return;
    appendFileSync(currentPath, JSON.stringify(event) + "\n");
  };
};

export const readReplayFile = <S, A>(path: string): ReadonlyArray<ReplayEvent<S, A>> =>
  readFileSync(path, "utf-8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as ReplayEvent<S, A>);

export const listReplayFiles = (baseDir: string): ReadonlyArray<string> => {
  try {
    return readdirSync(baseDir)
      .filter((f) => f.endsWith(".ndjson"))
      .map((f) => join(baseDir, f));
  } catch {
    return [];
  }
};
