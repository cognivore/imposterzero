import {
  regulationDeck,
  SIGNATURE_CARD_KINDS,
  type CardName,
} from "../index.js";

export type PlayerIndex = 0 | 1;
export type PlayerName = string;
export type KingChoice = "Charismatic Leader" | "Master Tactician";
export type Score = readonly [number, number];

export interface SelectionStep {
  readonly kind: "selection";
  readonly player: PlayerIndex;
  readonly cards: ReadonlyArray<CardName>;
  readonly transcript: ReadonlyArray<string>;
}

export interface FirstPlayerStep {
  readonly kind: "first_player";
  readonly player: PlayerIndex;
  readonly firstPlayer: PlayerIndex;
  readonly transcript: ReadonlyArray<string>;
}

export interface SelectKingStep {
  readonly kind: "select_king";
  readonly player: PlayerIndex;
  readonly king: KingChoice;
  readonly transcript: ReadonlyArray<string>;
}

export interface EndMusterStep {
  readonly kind: "end_muster";
  readonly player: PlayerIndex;
  readonly transcript: ReadonlyArray<string>;
}

export interface RecommissionStep {
  readonly kind: "recommission";
  readonly player: PlayerIndex;
  readonly recover: CardName;
  readonly exhaust: readonly [CardName, CardName];
  readonly transcript: ReadonlyArray<string>;
}

export interface RecruitStep {
  readonly kind: "recruit";
  readonly player: PlayerIndex;
  readonly recruit: CardName;
  readonly discard: CardName;
  readonly exhaust?: CardName;
  readonly transcript: ReadonlyArray<string>;
}

export type MusteringStep =
  | SelectKingStep
  | EndMusterStep
  | RecommissionStep
  | RecruitStep;

export interface SetupDiscardStep {
  readonly kind: "setup_discard";
  readonly player: PlayerIndex;
  readonly card: CardName;
  readonly transcript: ReadonlyArray<string>;
}

export interface SetupSuccessorStep {
  readonly kind: "setup_successor";
  readonly player: PlayerIndex;
  readonly card: CardName;
  readonly transcript: ReadonlyArray<string>;
}

export interface SetupSquireStep {
  readonly kind: "setup_squire";
  readonly player: PlayerIndex;
  readonly card: CardName;
  readonly transcript: ReadonlyArray<string>;
}

export type SetupTranscriptStep =
  | SetupDiscardStep
  | SetupSuccessorStep
  | SetupSquireStep;

export interface CommitStep {
  readonly kind: "commit";
  readonly player: PlayerIndex;
  readonly dungeon: CardName;
  readonly successor: CardName;
  readonly squire?: CardName;
  readonly transcript: ReadonlyArray<string>;
}

export type StepOutcome =
  | { readonly kind: "nothing_happened" }
  | { readonly kind: "move_to_antechamber"; readonly player: PlayerIndex; readonly card: CardName }
  | { readonly kind: "pick_from_court"; readonly player: PlayerIndex; readonly card: CardName }
  | { readonly kind: "swap"; readonly player: PlayerIndex; readonly give: CardName; readonly take: CardName }
  | { readonly kind: "swap_accused"; readonly player: PlayerIndex; readonly accused: CardName; readonly hand: CardName }
  | { readonly kind: "take_from_dungeon"; readonly player: PlayerIndex; readonly card: CardName }
  | { readonly kind: "take_successor"; readonly player: PlayerIndex; readonly card: CardName }
  | { readonly kind: "take_squire"; readonly player: PlayerIndex; readonly card: CardName }
  | { readonly kind: "recall"; readonly player: PlayerIndex; readonly card: CardName }
  | { readonly kind: "rally"; readonly player: PlayerIndex; readonly card: CardName }
  | { readonly kind: "return_to_army"; readonly player: PlayerIndex; readonly card: CardName }
  | { readonly kind: "disgrace"; readonly player: PlayerIndex; readonly cards: ReadonlyArray<CardName> };

export interface PlayStep {
  readonly kind: "play";
  readonly player: PlayerIndex;
  readonly card: CardName;
  readonly namedCard?: CardName;
  readonly namedValue?: number;
  readonly copiedCard?: CardName;
  readonly ability: boolean | null;
  readonly outcomes: ReadonlyArray<StepOutcome>;
  readonly transcript: ReadonlyArray<string>;
}

export interface FlipKingStep {
  readonly kind: "flip_king";
  readonly player: PlayerIndex;
  readonly outcomes: ReadonlyArray<StepOutcome>;
  readonly transcript: ReadonlyArray<string>;
}

export interface ReactionStep {
  readonly kind: "reaction";
  readonly player: PlayerIndex;
  readonly card: CardName;
  readonly transcript: ReadonlyArray<string>;
}

export interface ResolutionStep {
  readonly kind: "resolution";
  readonly outcomes: ReadonlyArray<StepOutcome>;
  readonly transcript: ReadonlyArray<string>;
}

export type PlayTranscriptStep = PlayStep | FlipKingStep | ReactionStep | ResolutionStep;

export interface GoldenRound {
  readonly round: number;
  readonly crown: FirstPlayerStep;
  readonly mustering: ReadonlyArray<MusteringStep>;
  readonly setup: ReadonlyArray<SetupTranscriptStep>;
  readonly play: ReadonlyArray<PlayTranscriptStep>;
  readonly roundScore: Score;
  readonly matchScoreAfterRound: Score;
  readonly roundOverTranscript: ReadonlyArray<string>;
}

export interface Stage4GoldenFixture {
  readonly label: string;
  readonly players: readonly [PlayerName, PlayerName];
  readonly selections: ReadonlyArray<SelectionStep>;
  readonly rounds: ReadonlyArray<GoldenRound>;
  readonly finalScore: Score;
  readonly reportedFinalScore: Score;
  readonly finalScoreTranscriptOrder: "players" | "reverse";
  readonly outro: ReadonlyArray<string>;
}

interface ParseState {
  readonly lines: ReadonlyArray<string>;
  readonly index: number;
}

type ParseSuccess<T> = {
  readonly ok: true;
  readonly value: T;
  readonly state: ParseState;
};

type ParseFailure = {
  readonly ok: false;
  readonly expected: string;
  readonly state: ParseState;
};

type ParseResult<T> = ParseSuccess<T> | ParseFailure;
type Parser<T> = (state: ParseState) => ParseResult<T>;

type AtomicLine =
  | { readonly kind: "selection"; readonly player: PlayerName; readonly cards: ReadonlyArray<CardName>; readonly transcript: string }
  | { readonly kind: "first_player"; readonly player: PlayerName; readonly firstPlayer: PlayerName; readonly transcript: string }
  | { readonly kind: "select_king"; readonly player: PlayerName; readonly king: KingChoice; readonly transcript: string }
  | { readonly kind: "end_muster"; readonly player: PlayerName; readonly transcript: string }
  | { readonly kind: "recommission"; readonly player: PlayerName; readonly recover: CardName; readonly transcript: string }
  | { readonly kind: "recruit"; readonly player: PlayerName; readonly recruit: CardName; readonly transcript: string }
  | { readonly kind: "discard"; readonly player: PlayerName; readonly card: CardName; readonly transcript: string }
  | { readonly kind: "exhaust"; readonly player: PlayerName; readonly card: CardName; readonly transcript: string }
  | { readonly kind: "pick_successor"; readonly player: PlayerName; readonly card: CardName; readonly transcript: string }
  | { readonly kind: "pick_squire"; readonly player: PlayerName; readonly card: CardName; readonly transcript: string }
  | {
      readonly kind: "play";
      readonly player: PlayerName;
      readonly card: CardName;
      readonly namedCard?: CardName;
      readonly namedValue?: number;
      readonly copiedCard?: CardName;
      readonly ability: boolean | null;
      readonly embeddedOutcomes: ReadonlyArray<AtomicOutcome>;
      readonly transcript: string;
    }
  | { readonly kind: "flip_king"; readonly player: PlayerName; readonly transcript: string }
  | { readonly kind: "reaction"; readonly player: PlayerName; readonly card: CardName; readonly transcript: string }
  | { readonly kind: "nothing_happened"; readonly transcript: string }
  | { readonly kind: "move_to_antechamber"; readonly player: PlayerName; readonly card: CardName; readonly transcript: string }
  | { readonly kind: "swap"; readonly player: PlayerName; readonly give: CardName; readonly take: CardName; readonly transcript: string }
  | { readonly kind: "swap_accused"; readonly player: PlayerName; readonly accused: CardName; readonly hand: CardName; readonly transcript: string }
  | { readonly kind: "take_from_dungeon"; readonly player: PlayerName; readonly card: CardName; readonly transcript: string }
  | { readonly kind: "take_successor"; readonly player: PlayerName; readonly card: CardName; readonly transcript: string }
  | { readonly kind: "take_squire"; readonly player: PlayerName; readonly card: CardName; readonly transcript: string }
  | { readonly kind: "recall"; readonly player: PlayerName; readonly card: CardName; readonly transcript: string }
  | { readonly kind: "rally"; readonly player: PlayerName; readonly card: CardName; readonly transcript: string }
  | { readonly kind: "return_to_army"; readonly player: PlayerName; readonly card: CardName; readonly transcript: string }
  | { readonly kind: "disgrace"; readonly player: PlayerName; readonly cards: ReadonlyArray<CardName>; readonly transcript: string }
  | { readonly kind: "round_over"; readonly player: PlayerName; readonly points: number; readonly transcript: string }
  | { readonly kind: "game_over"; readonly score: Score; readonly transcript: string };

type AtomicOutcome =
  | { readonly kind: "move_to_antechamber"; readonly player: PlayerName; readonly card: CardName }
  | { readonly kind: "pick_from_court"; readonly player: PlayerName; readonly card: CardName }
  | { readonly kind: "swap"; readonly player: PlayerName; readonly give: CardName; readonly take: CardName }
  | { readonly kind: "swap_accused"; readonly player: PlayerName; readonly accused: CardName; readonly hand: CardName }
  | { readonly kind: "take_from_dungeon"; readonly player: PlayerName; readonly card: CardName }
  | { readonly kind: "take_successor"; readonly player: PlayerName; readonly card: CardName }
  | { readonly kind: "take_squire"; readonly player: PlayerName; readonly card: CardName }
  | { readonly kind: "recall"; readonly player: PlayerName; readonly card: CardName }
  | { readonly kind: "rally"; readonly player: PlayerName; readonly card: CardName }
  | { readonly kind: "return_to_army"; readonly player: PlayerName; readonly card: CardName }
  | { readonly kind: "disgrace"; readonly player: PlayerName; readonly cards: ReadonlyArray<CardName> }
  | { readonly kind: "nothing_happened" };

const ok = <T>(value: T, state: ParseState): ParseSuccess<T> => ({
  ok: true,
  value,
  state,
});

const fail = <T>(expected: string, state: ParseState): ParseFailure => ({
  ok: false,
  expected,
  state,
});

const map = <A, B>(
  parser: Parser<A>,
  project: (value: A) => B,
): Parser<B> => (state) => {
  const result = parser(state);
  return result.ok ? ok(project(result.value), result.state) : result;
};

const chain = <A, B>(
  parser: Parser<A>,
  project: (value: A) => Parser<B>,
): Parser<B> => (state) => {
  const result = parser(state);
  return result.ok ? project(result.value)(result.state) : result;
};

const orElse = <T>(
  left: Parser<T>,
  right: Parser<T>,
): Parser<T> => (state) => {
  const leftResult = left(state);
  if (leftResult.ok) return leftResult;
  return leftResult.state.index >= state.index ? leftResult : right(state);
};

const choice = <T>(
  ...parsers: ReadonlyArray<Parser<T>>
): Parser<T> => (state) => {
  let bestFailure: ParseFailure | null = null;
  for (const parser of parsers) {
    const result = parser(state);
    if (result.ok) return result;
    if (!bestFailure || result.state.index >= bestFailure.state.index) {
      bestFailure = result;
    }
  }
  return bestFailure ?? fail("choice", state);
};

const many = <T>(parser: Parser<T>): Parser<ReadonlyArray<T>> => (state) => {
  const values: T[] = [];
  let next = state;
  while (true) {
    const result = parser(next);
    if (!result.ok) return ok(values, next);
    if (result.state.index === next.index) {
      throw new Error("many() parser consumed no input");
    }
    values.push(result.value);
    next = result.state;
  }
};

const satisfyLine = <T>(
  expected: string,
  project: (line: string) => T | null,
): Parser<T> => (state) => {
  const line = state.lines[state.index];
  if (line === undefined) return fail(expected, state);
  const value = project(line);
  if (value === null) return fail(expected, state);
  return ok(value, { ...state, index: state.index + 1 });
};

const regexLine = <T>(
  expected: string,
  regex: RegExp,
  project: (match: RegExpMatchArray, line: string) => T,
): Parser<T> =>
  satisfyLine(expected, (line) => {
    const match = line.match(regex);
    return match ? project(match, line) : null;
  });

const parseAll = <T>(
  parser: Parser<T>,
  lines: ReadonlyArray<string>,
): T => {
  const start: ParseState = { lines, index: 0 };
  const result = parser(start);
  if (!result.ok) {
    const found = lines[result.state.index] ?? "EOF";
    throw new Error(`Stage 4 transcript parse error at line ${result.state.index + 1}: expected ${result.expected}, found "${found}"`);
  }
  if (result.state.index !== lines.length) {
    const found = lines[result.state.index] ?? "EOF";
    throw new Error(`Stage 4 transcript parse error at line ${result.state.index + 1}: unexpected trailing input "${found}"`);
  }
  return result.value;
};

const normalizeToken = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]/g, "");

const ALL_CARD_NAMES: ReadonlyArray<CardName> = [
  ...new Set([
    ...regulationDeck(4).map((kind) => kind.name as CardName),
    ...SIGNATURE_CARD_KINDS.map((kind) => kind.name as CardName),
  ]),
];

const CARD_NAME_BY_TOKEN = (() => {
  const byToken = new Map<string, CardName>();
  for (const name of ALL_CARD_NAMES) {
    byToken.set(normalizeToken(name), name);
  }
  return byToken;
})();

const normalizeCardName = (raw: string): CardName => {
  const normalized = CARD_NAME_BY_TOKEN.get(normalizeToken(raw));
  if (!normalized) {
    throw new Error(`Unknown transcript card name "${raw}"`);
  }
  return normalized;
};

const parseCardList = (raw: string): ReadonlyArray<CardName> =>
  raw
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
    .map(normalizeCardName);

const parseDisgraceList = (raw: string): ReadonlyArray<CardName> =>
  raw === "0 cards" ? [] : parseCardList(raw);

const score = (left: number, right: number): Score =>
  [left, right] as const;

export const addScores = (left: Score, right: Score): Score =>
  score(left[0] + right[0], left[1] + right[1]);

const selectionLine = regexLine(
  "selection line",
  /^(.+?) chose the signature cards (.+)\.$/,
  (match, line) => ({
    kind: "selection" as const,
    player: match[1]!,
    cards: parseCardList(match[2]!),
    transcript: line,
  }),
);

const firstPlayerLine = regexLine(
  "first player line",
  /^(.+?) decided that (.+?) goes first\.$/,
  (match, line) => ({
    kind: "first_player" as const,
    player: match[1]!,
    firstPlayer: match[2]!,
    transcript: line,
  }),
);

const selectKingLine = regexLine(
  "select king line",
  /^(.+?) selected new King: (Charismatic Leader|Master Tactician)\.$/,
  (match, line) => ({
    kind: "select_king" as const,
    player: match[1]!,
    king: match[2]! as KingChoice,
    transcript: line,
  }),
);

const endMusterLine = regexLine(
  "end muster line",
  /^(.+?) ended muster\.$/,
  (match, line) => ({
    kind: "end_muster" as const,
    player: match[1]!,
    transcript: line,
  }),
);

const recommissionLine = regexLine(
  "recommission line",
  /^(.+?) recommissioned (.+)\.$/,
  (match, line) => ({
    kind: "recommission" as const,
    player: match[1]!,
    recover: normalizeCardName(match[2]!),
    transcript: line,
  }),
);

const recruitLine = regexLine(
  "recruit line",
  /^(.+?) recruited (.+)\.$/,
  (match, line) => ({
    kind: "recruit" as const,
    player: match[1]!,
    recruit: normalizeCardName(match[2]!),
    transcript: line,
  }),
);

const discardLine = regexLine(
  "discard line",
  /^(.+?) discarded (.+)\.$/,
  (match, line) => ({
    kind: "discard" as const,
    player: match[1]!,
    card: normalizeCardName(match[2]!),
    transcript: line,
  }),
);

const exhaustLine = regexLine(
  "exhaust line",
  /^(.+?) exhausted (.+)\.$/,
  (match, line) => ({
    kind: "exhaust" as const,
    player: match[1]!,
    card: normalizeCardName(match[2]!),
    transcript: line,
  }),
);

const pickSuccessorLine = regexLine(
  "pick successor line",
  /^(.+?) picked (.+) as successor\.$/,
  (match, line) => ({
    kind: "pick_successor" as const,
    player: match[1]!,
    card: normalizeCardName(match[2]!),
    transcript: line,
  }),
);

const pickSquireLine = regexLine(
  "pick squire line",
  /^(.+?) picked (.+) as squire\.$/,
  (match, line) => ({
    kind: "pick_squire" as const,
    player: match[1]!,
    card: normalizeCardName(match[2]!),
    transcript: line,
  }),
);

const playCopyAndPickLine = regexLine(
  "play copy and pick line",
  /^(.+?) played (.+?) and copied (.+?) and picked (.+?) from the court\.$/,
  (match, line) => ({
    kind: "play" as const,
    player: match[1]!,
    card: normalizeCardName(match[2]!),
    copiedCard: normalizeCardName(match[3]!),
    ability: null,
    embeddedOutcomes: [
      {
        kind: "pick_from_court" as const,
        player: match[1]!,
        card: normalizeCardName(match[4]!),
      },
    ],
    transcript: line,
  }),
);

const playPickLine = regexLine(
  "play pick line",
  /^(.+?) played (.+?) and picked (.+?) from the court\.$/,
  (match, line) => ({
    kind: "play" as const,
    player: match[1]!,
    card: normalizeCardName(match[2]!),
    ability: null,
    embeddedOutcomes: [
      {
        kind: "pick_from_court" as const,
        player: match[1]!,
        card: normalizeCardName(match[3]!),
      },
    ],
    transcript: line,
  }),
);

const playNamedCardLine = regexLine(
  "play named card line",
  /^(.+?) played (.+?) and said card name "(.+)"\.$/,
  (match, line) => ({
    kind: "play" as const,
    player: match[1]!,
    card: normalizeCardName(match[2]!),
    namedCard: normalizeCardName(match[3]!),
    ability: null,
    embeddedOutcomes: [],
    transcript: line,
  }),
);

const playNamedValueLine = regexLine(
  "play named value line",
  /^(.+?) played (.+?) and said number (\d+)\.$/,
  (match, line) => ({
    kind: "play" as const,
    player: match[1]!,
    card: normalizeCardName(match[2]!),
    namedValue: Number.parseInt(match[3]!, 10),
    ability: null,
    embeddedOutcomes: [],
    transcript: line,
  }),
);

const playNoAbilityLine = regexLine(
  "play no ability line",
  /^(.+?) played (.+?) with no ability\.$/,
  (match, line) => ({
    kind: "play" as const,
    player: match[1]!,
    card: normalizeCardName(match[2]!),
    ability: false,
    embeddedOutcomes: [],
    transcript: line,
  }),
);

const playWithAbilityLine = regexLine(
  "play with ability line",
  /^(.+?) played (.+?) with ability\.$/,
  (match, line) => ({
    kind: "play" as const,
    player: match[1]!,
    card: normalizeCardName(match[2]!),
    ability: true,
    embeddedOutcomes: [],
    transcript: line,
  }),
);

const flipKingLine = regexLine(
  "flip king line",
  /^(.+?) flipped the king\.$/,
  (match, line) => ({
    kind: "flip_king" as const,
    player: match[1]!,
    transcript: line,
  }),
);

const reactionLine = regexLine(
  "reaction line",
  /^(.+?) reacted with (.+)\.$/,
  (match, line) => ({
    kind: "reaction" as const,
    player: match[1]!,
    card: normalizeCardName(match[2]!),
    transcript: line,
  }),
);

const nothingHappenedLine = regexLine(
  "nothing happened line",
  /^Nothing happened\.$/,
  (_, line) => ({
    kind: "nothing_happened" as const,
    transcript: line,
  }),
);

const movedToAntechamberLine = regexLine(
  "move to antechamber line",
  /^(.+?) moved (.+) to the antechamber\.$/,
  (match, line) => ({
    kind: "move_to_antechamber" as const,
    player: match[1]!,
    card: normalizeCardName(match[2]!),
    transcript: line,
  }),
);

const swapAccusedLine = regexLine(
  "swap accused line",
  /^(.+?) swapped accused (.+) with (.+)\.$/,
  (match, line) => ({
    kind: "swap_accused" as const,
    player: match[1]!,
    accused: normalizeCardName(match[2]!),
    hand: normalizeCardName(match[3]!),
    transcript: line,
  }),
);

const swapLine = regexLine(
  "swap line",
  /^(.+?) swapped (.+) with (.+)\.$/,
  (match, line) => ({
    kind: "swap" as const,
    player: match[1]!,
    give: normalizeCardName(match[2]!),
    take: normalizeCardName(match[3]!),
    transcript: line,
  }),
);

const takeDungeonLine = regexLine(
  "take dungeon line",
  /^(.+?) took (.+) from their Dungeon\.$/,
  (match, line) => ({
    kind: "take_from_dungeon" as const,
    player: match[1]!,
    card: normalizeCardName(match[2]!),
    transcript: line,
  }),
);

const takeSuccessorLine = regexLine(
  "take successor line",
  /^(.+?) took the successor \((.+)\)\.$/,
  (match, line) => ({
    kind: "take_successor" as const,
    player: match[1]!,
    card: normalizeCardName(match[2]!),
    transcript: line,
  }),
);

const takeSquireLine = regexLine(
  "take squire line",
  /^(.+?) took the squire \((.+)\)\.$/,
  (match, line) => ({
    kind: "take_squire" as const,
    player: match[1]!,
    card: normalizeCardName(match[2]!),
    transcript: line,
  }),
);

const recallLine = regexLine(
  "recall line",
  /^(.+?) recalled (.+)\.$/,
  (match, line) => ({
    kind: "recall" as const,
    player: match[1]!,
    card: normalizeCardName(match[2]!),
    transcript: line,
  }),
);

const rallyLine = regexLine(
  "rally line",
  /^(.+?) rallied (.+)\.$/,
  (match, line) => ({
    kind: "rally" as const,
    player: match[1]!,
    card: normalizeCardName(match[2]!),
    transcript: line,
  }),
);

const returnToArmyLine = regexLine(
  "return to army line",
  /^(.+?) returned (.+) to Army\.$/,
  (match, line) => ({
    kind: "return_to_army" as const,
    player: match[1]!,
    card: normalizeCardName(match[2]!),
    transcript: line,
  }),
);

const disgraceLine = regexLine(
  "disgrace line",
  /^(.+?) disgraced (.+)\.$/,
  (match, line) => ({
    kind: "disgrace" as const,
    player: match[1]!,
    cards: parseDisgraceList(match[2]!),
    transcript: line,
  }),
);

const roundOverLine = regexLine(
  "round over line",
  /^The round is over, (.+?) got (\d+) points?\.$/,
  (match, line) => ({
    kind: "round_over" as const,
    player: match[1]!,
    points: Number.parseInt(match[2]!, 10),
    transcript: line,
  }),
);

const gameOverLine = regexLine(
  "game over line",
  /^The game is over with score (\d+):(\d+)\.$/,
  (match, line) => ({
    kind: "game_over" as const,
    score: score(
      Number.parseInt(match[1]!, 10),
      Number.parseInt(match[2]!, 10),
    ),
    transcript: line,
  }),
);

const atomicLine = choice<AtomicLine>(
  selectionLine,
  firstPlayerLine,
  selectKingLine,
  endMusterLine,
  recommissionLine,
  recruitLine,
  discardLine,
  exhaustLine,
  pickSuccessorLine,
  pickSquireLine,
  playCopyAndPickLine,
  playPickLine,
  playNamedCardLine,
  playNamedValueLine,
  playNoAbilityLine,
  playWithAbilityLine,
  flipKingLine,
  reactionLine,
  nothingHappenedLine,
  movedToAntechamberLine,
  swapAccusedLine,
  swapLine,
  takeDungeonLine,
  takeSuccessorLine,
  takeSquireLine,
  recallLine,
  rallyLine,
  returnToArmyLine,
  disgraceLine,
  roundOverLine,
  gameOverLine,
);

const atomicTranscript = many(atomicLine);

const normalizeTranscriptLines = (raw: string): ReadonlyArray<string> =>
  raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("==="));

const splitTranscriptDocuments = (raw: string): ReadonlyArray<string> => {
  const documents: string[][] = [];
  let current: string[] = [];

  for (const original of raw.split(/\r?\n/)) {
    const line = original.trim();
    if (line.startsWith("===")) {
      if (current.some((entry) => entry.length > 0)) {
        documents.push(current);
      }
      current = [];
      continue;
    }
    current.push(original);
  }

  if (current.some((entry) => entry.trim().length > 0)) {
    documents.push(current);
  }

  return documents
    .map((lines) => lines.join("\n").trim())
    .filter((doc) => doc.length > 0);
};

const scoreForPlayer = (
  player: PlayerIndex,
  points: number,
): Score => (player === 0 ? score(points, 0) : score(0, points));

const convertOutcome = (
  outcome: AtomicOutcome,
  playerIndexByName: ReadonlyMap<string, PlayerIndex>,
): StepOutcome => {
  const toPlayerIndex = (player: string): PlayerIndex => {
    const index = playerIndexByName.get(player);
    if (index === undefined) {
      throw new Error(`Unknown player "${player}" in transcript outcome`);
    }
    return index;
  };

  switch (outcome.kind) {
    case "nothing_happened":
      return outcome;
    case "move_to_antechamber":
      return { ...outcome, player: toPlayerIndex(outcome.player) };
    case "pick_from_court":
      return { ...outcome, player: toPlayerIndex(outcome.player) };
    case "swap":
      return { ...outcome, player: toPlayerIndex(outcome.player) };
    case "swap_accused":
      return { ...outcome, player: toPlayerIndex(outcome.player) };
    case "take_from_dungeon":
      return { ...outcome, player: toPlayerIndex(outcome.player) };
    case "take_successor":
      return { ...outcome, player: toPlayerIndex(outcome.player) };
    case "take_squire":
      return { ...outcome, player: toPlayerIndex(outcome.player) };
    case "recall":
      return { ...outcome, player: toPlayerIndex(outcome.player) };
    case "rally":
      return { ...outcome, player: toPlayerIndex(outcome.player) };
    case "return_to_army":
      return { ...outcome, player: toPlayerIndex(outcome.player) };
    case "disgrace":
      return { ...outcome, player: toPlayerIndex(outcome.player) };
  }
};

const isMusteringLead = (line: AtomicLine): boolean =>
  line.kind === "select_king" ||
  line.kind === "end_muster" ||
  line.kind === "recommission" ||
  line.kind === "recruit";

const isPlayOutcome = (line: AtomicLine): boolean =>
  line.kind === "nothing_happened" ||
  line.kind === "move_to_antechamber" ||
  line.kind === "swap" ||
  line.kind === "swap_accused" ||
  line.kind === "take_from_dungeon" ||
  line.kind === "recall" ||
  line.kind === "rally" ||
  line.kind === "return_to_army" ||
  line.kind === "disgrace";

const isFlipOutcome = (line: AtomicLine): boolean =>
  line.kind === "take_successor" ||
  line.kind === "take_squire" ||
  line.kind === "recall" ||
  line.kind === "rally" ||
  line.kind === "return_to_army";

const isResolutionOutcome = (line: AtomicLine): boolean =>
  isPlayOutcome(line) || isFlipOutcome(line);

const buildFixtureFromAtomic = (
  label: string | undefined,
  atomic: ReadonlyArray<AtomicLine>,
): Stage4GoldenFixture => {
  if (atomic.length < 4) {
    throw new Error("Stage 4 transcript is too short");
  }

  const firstSelection = atomic[0];
  const secondSelection = atomic[1];
  if (firstSelection?.kind !== "selection" || secondSelection?.kind !== "selection") {
    throw new Error("Stage 4 transcript must begin with two signature-selection lines");
  }

  const players = [firstSelection.player, secondSelection.player] as const;
  if (players[0] === players[1]) {
    throw new Error("Stage 4 transcript must contain two distinct player names");
  }

  const playerIndexByName = new Map<string, PlayerIndex>([
    [players[0], 0],
    [players[1], 1],
  ]);

  const toPlayerIndex = (player: string): PlayerIndex => {
    const index = playerIndexByName.get(player);
    if (index === undefined) {
      throw new Error(`Unknown player "${player}" in transcript`);
    }
    return index;
  };

  const selections: ReadonlyArray<SelectionStep> = [firstSelection, secondSelection].map(
    (selection) => ({
      kind: "selection",
      player: toPlayerIndex(selection.player),
      cards: selection.cards,
      transcript: [selection.transcript],
    }),
  );

  let cursor = 2;
  let roundNumber = 1;
  let runningScore = score(0, 0);
  const rounds: GoldenRound[] = [];

  while (cursor < atomic.length && atomic[cursor]!.kind !== "game_over") {
    const crownLine = atomic[cursor];
    if (!crownLine || crownLine.kind !== "first_player") {
      throw new Error(`Expected first-player line at transcript item ${cursor + 1}`);
    }
    cursor += 1;

    const crown: FirstPlayerStep = {
      kind: "first_player",
      player: toPlayerIndex(crownLine.player),
      firstPlayer: toPlayerIndex(crownLine.firstPlayer),
      transcript: [crownLine.transcript],
    };

    const mustering: MusteringStep[] = [];
    while (cursor < atomic.length && isMusteringLead(atomic[cursor]!)) {
      const line = atomic[cursor]!;
      switch (line.kind) {
        case "select_king":
          mustering.push({
            kind: "select_king",
            player: toPlayerIndex(line.player),
            king: line.king,
            transcript: [line.transcript],
          });
          cursor += 1;
          break;
        case "end_muster":
          mustering.push({
            kind: "end_muster",
            player: toPlayerIndex(line.player),
            transcript: [line.transcript],
          });
          cursor += 1;
          break;
        case "recommission": {
          const ex1 = atomic[cursor + 1];
          const ex2 = atomic[cursor + 2];
          if (
            ex1?.kind !== "exhaust" ||
            ex2?.kind !== "exhaust" ||
            ex1.player !== line.player ||
            ex2.player !== line.player
          ) {
            throw new Error(`Recommission step for ${line.player} must be followed by two exhaust lines`);
          }
          mustering.push({
            kind: "recommission",
            player: toPlayerIndex(line.player),
            recover: line.recover,
            exhaust: [ex1.card, ex2.card],
            transcript: [line.transcript, ex1.transcript, ex2.transcript],
          });
          cursor += 3;
          break;
        }
        case "recruit": {
          const discard = atomic[cursor + 1];
          if (
            discard?.kind !== "discard" ||
            discard.player !== line.player
          ) {
            throw new Error(`Recruit step for ${line.player} must be followed by a discard line`);
          }
          const maybeExhaust = atomic[cursor + 2];
          const exhaust =
            maybeExhaust?.kind === "exhaust" && maybeExhaust.player === line.player
              ? maybeExhaust
              : null;
          mustering.push({
            kind: "recruit",
            player: toPlayerIndex(line.player),
            recruit: line.recruit,
            discard: discard.card,
            exhaust: exhaust?.card,
            transcript: exhaust
              ? [line.transcript, discard.transcript, exhaust.transcript]
              : [line.transcript, discard.transcript],
          });
          cursor += exhaust ? 3 : 2;
          break;
        }
        default:
          throw new Error(`Unexpected mustering lead ${(line as AtomicLine).kind}`);
      }
    }

    const setup: SetupTranscriptStep[] = [];
    while (
      cursor < atomic.length &&
      (atomic[cursor]!.kind === "discard" ||
        atomic[cursor]!.kind === "pick_successor" ||
        atomic[cursor]!.kind === "pick_squire")
    ) {
      const step = atomic[cursor]!;
      switch (step.kind) {
        case "discard":
          setup.push({
            kind: "setup_discard",
            player: toPlayerIndex(step.player),
            card: step.card,
            transcript: [step.transcript],
          });
          break;
        case "pick_successor":
          setup.push({
            kind: "setup_successor",
            player: toPlayerIndex(step.player),
            card: step.card,
            transcript: [step.transcript],
          });
          break;
        case "pick_squire":
          setup.push({
            kind: "setup_squire",
            player: toPlayerIndex(step.player),
            card: step.card,
            transcript: [step.transcript],
          });
          break;
        default:
          break;
      }
      cursor += 1;
    }

    const play: PlayTranscriptStep[] = [];
    while (cursor < atomic.length && atomic[cursor]!.kind !== "round_over") {
      const line = atomic[cursor]!;
      if (line.kind === "reaction") {
        play.push({
          kind: "reaction",
          player: toPlayerIndex(line.player),
          card: line.card,
          transcript: [line.transcript],
        });
        cursor += 1;
        continue;
      }

      if (line.kind === "flip_king") {
        const transcript = [line.transcript];
        const outcomes: StepOutcome[] = [];
        cursor += 1;
        while (cursor < atomic.length && isFlipOutcome(atomic[cursor]!)) {
          const outcome = atomic[cursor]!;
          transcript.push(outcome.transcript);
          outcomes.push(convertOutcome(outcome, playerIndexByName));
          cursor += 1;
        }
        play.push({
          kind: "flip_king",
          player: toPlayerIndex(line.player),
          outcomes,
          transcript,
        });
        continue;
      }

      if (line.kind === "play") {
        const transcript = [line.transcript];
        const outcomes = line.embeddedOutcomes.map((outcome) =>
          convertOutcome(outcome, playerIndexByName),
        );
        cursor += 1;
        while (cursor < atomic.length && isPlayOutcome(atomic[cursor]!)) {
          const outcome = atomic[cursor]!;
          transcript.push(outcome.transcript);
          outcomes.push(convertOutcome(outcome, playerIndexByName));
          cursor += 1;
        }
        play.push({
          kind: "play",
          player: toPlayerIndex(line.player),
          card: line.card,
          namedCard: line.namedCard,
          namedValue: line.namedValue,
          copiedCard: line.copiedCard,
          ability: line.ability,
          outcomes,
          transcript,
        });
        continue;
      }

      if (isResolutionOutcome(line)) {
        const transcript: string[] = [];
        const outcomes: StepOutcome[] = [];
        while (cursor < atomic.length && isResolutionOutcome(atomic[cursor]!)) {
          const outcome = atomic[cursor]!;
          transcript.push(outcome.transcript);
          outcomes.push(convertOutcome(outcome, playerIndexByName));
          cursor += 1;
        }
        play.push({
          kind: "resolution",
          outcomes,
          transcript,
        });
        continue;
      }

      throw new Error(`Unexpected play-phase line kind "${line.kind}"`);
    }

    const roundOver = atomic[cursor];
    if (!roundOver || roundOver.kind !== "round_over") {
      throw new Error(`Expected round-over line at transcript item ${cursor + 1}`);
    }
    cursor += 1;

    const roundScore = scoreForPlayer(
      toPlayerIndex(roundOver.player),
      roundOver.points,
    );
    runningScore = addScores(runningScore, roundScore);
    rounds.push({
      round: roundNumber,
      crown,
      mustering,
      setup,
      play,
      roundScore,
      matchScoreAfterRound: runningScore,
      roundOverTranscript: [roundOver.transcript],
    });
    roundNumber += 1;
  }

  const gameOver = atomic[cursor];
  if (!gameOver || gameOver.kind !== "game_over") {
    throw new Error("Stage 4 transcript must end with a final score line");
  }

  const finalScoreTranscriptOrder =
    gameOver.score[0] === runningScore[0] && gameOver.score[1] === runningScore[1]
      ? "players"
      : gameOver.score[0] === runningScore[1] && gameOver.score[1] === runningScore[0]
        ? "reverse"
        : null;

  if (!finalScoreTranscriptOrder) {
    throw new Error(
      `Reported final score ${gameOver.score[0]}:${gameOver.score[1]} does not match cumulative round score ${runningScore[0]}:${runningScore[1]}`,
    );
  }

  const fixture: Stage4GoldenFixture = {
    label: label ?? `1v1 Stage 4 - ${players[0]} vs ${players[1]}`,
    players,
    selections,
    rounds,
    finalScore: runningScore,
    reportedFinalScore: gameOver.score,
    finalScoreTranscriptOrder,
    outro: [gameOver.transcript],
  };

  console.info(
    `[stage4-parser] ${fixture.label}: parsed ${fixture.rounds.length} rounds, cumulative ${fixture.finalScore[0]}:${fixture.finalScore[1]}, reported ${fixture.reportedFinalScore[0]}:${fixture.reportedFinalScore[1]} (${fixture.finalScoreTranscriptOrder})`,
  );

  return fixture;
};

export const parseStage4Transcript = (
  raw: string,
  label?: string,
): Stage4GoldenFixture => {
  const lines = normalizeTranscriptLines(raw);
  const atomic = parseAll(atomicTranscript, lines);
  return buildFixtureFromAtomic(label, atomic);
};

export const parseStage4TranscriptDocuments = (
  raw: string,
): ReadonlyArray<Stage4GoldenFixture> =>
  splitTranscriptDocuments(raw).map((document, index) =>
    parseStage4Transcript(document, `1v1 Stage 4 transcript ${index + 1}`),
  );

export const flattenTranscript = (
  fixture: Stage4GoldenFixture,
): ReadonlyArray<string> => [
  ...fixture.selections.flatMap((step) => step.transcript),
  ...fixture.rounds.flatMap((round) => [
    ...round.crown.transcript,
    ...round.mustering.flatMap((step) => step.transcript),
    ...round.setup.flatMap((step) => step.transcript),
    ...round.play.flatMap((step) => step.transcript),
    ...round.roundOverTranscript,
  ]),
  ...fixture.outro,
];
