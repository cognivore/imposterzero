import { ImposterKingsGame } from "@imposter-zero/engine";
import { startServer } from "./ws-server.js";

const parseIntOr = (env: string | undefined, fallback: number): number => {
  if (env === undefined || env === "") return fallback;
  const n = parseInt(env, 10);
  return Number.isNaN(n) ? fallback : n;
};

const port = parseIntOr(process.env.PORT, 30588);
const targetScore = parseIntOr(process.env.TARGET_SCORE, 7);

const handle = startServer(ImposterKingsGame, {
  port,
  targetScore,
  autoAdvanceScoring: true,
  botDelayMs: 400,
});

handle.ready.then(
  () => console.log(`Imposter Kings server listening on ws://localhost:${handle.port}`),
  (e: unknown) => console.error("Server failed to start:", e),
);
