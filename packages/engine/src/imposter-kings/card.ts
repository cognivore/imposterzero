import type { CardInstance, CardKind } from "@imposter-zero/types";

import type { CardEffect } from "./effects/program.js";
import {
  onPlay,
  playOverride,
  reaction,
  continuous,
  disgraceAll,
  disgrace,
  played,
  belowPlayed,
  active,
  done,
  chooseCard,
  choosePlayer,
  checkZone,
  anyOpponentHas,
  addRoundModifier,
  forcePlay,
  condemn,
  withFirstCardIn,
  move,
  court as courtZone,
  sharedZone,
  activeHand,
  optional,
  nameCard,
  nameValue,
  nameValueUpToCourtMax,
  ifCond,
  seq,
  forEachOpponent,
  forEachPlayer,
  playerZone,
  playerId,
  khWindow,
  rally,
  recall,
  binaryChoice,
  revealZone,
  checkDungeon,
  removeFromRound,
  returnOneRallied,
  copyCardEffects,
} from "./effects/program.js";
import type { CardRef, ModifierSpec } from "./effects/program.js";
import {
  kingIsFlipped,
  courtHasRoyalty,
  courtHasDisgraced,
  courtHasFaceUpAtLeast,
  playedOnHigherValue,
  cardIsOnThrone,
  playedOnRoyalty,
} from "./effects/predicates.js";

export interface CardOps<C> {
  readonly value: (card: C) => number;
  readonly name: (card: C) => string;
}

export type CardKeyword = "royalty" | "immune_to_kings_hand" | "reaction" | "steadfast";

export type CardName =
  | "Fool"
  | "Assassin"
  | "Elder"
  | "Zealot"
  | "Inquisitor"
  | "Soldier"
  | "Judge"
  | "Oathbound"
  | "Immortal"
  | "Warlord"
  | "Mystic"
  | "Warden"
  | "Sentry"
  | "King's Hand"
  | "Princess"
  | "Queen"
  | "Executioner"
  | "Bard"
  | "Herald"
  | "Spy"
  | "Arbiter"
  | "Flagbearer"
  | "Stranger"
  | "Aegis"
  | "Ancestor"
  | "Informant"
  | "Nakturn"
  | "Lockshift"
  | "Conspiracist"
  | "Exile"
  | "King";

export interface IKCardProps extends Record<string, unknown> {
  readonly value: number;
  readonly keywords: readonly CardKeyword[];
  readonly shortText: string;
  readonly fullText: string;
  readonly flavorText: string;
  readonly effects: ReadonlyArray<CardEffect>;
}

export type IKCardKind = CardKind<IKCardProps> & { readonly name: CardName };
export type IKCard = CardInstance<IKCardProps> & { readonly kind: IKCardKind };

export const ikCardOps: CardOps<IKCard> = {
  value: (card) => card.kind.props.value,
  name: (card) => card.kind.name,
};

export const KING_CARD_KIND: IKCardKind = {
  name: "King",
  props: {
    value: 0,
    keywords: [],
    shortText: "Flip to Disgrace and take Successor.",
    fullText:
      "Flip to Disgrace the card on the Throne and take your Successor as your turn.",
    flavorText: "His authority rests upon his identity",
    effects: [],
  },
};

interface CardContent {
  readonly keywords: readonly CardKeyword[];
  readonly shortText: string;
  readonly fullText: string;
  readonly flavorTexts: readonly string[];
  readonly effects?: ReadonlyArray<CardEffect>;
}

const copies = (
  name: Exclude<CardName, "King">,
  value: number,
  count: number,
  content: CardContent,
): ReadonlyArray<IKCardKind> =>
  Array.from({ length: count }, (_, i) => ({
    name,
    props: {
      value,
      keywords: content.keywords,
      shortText: content.shortText,
      fullText: content.fullText,
      flavorText: content.flavorTexts[i] ?? content.flavorTexts.at(-1) ?? "",
      effects: content.effects ?? [],
    },
  }));

// ---------------------------------------------------------------------------
// Card content — authored from website artwork + Print-and-Play PDF
// ---------------------------------------------------------------------------

const foolEffect = optional(
  chooseCard(active, courtZone, { tag: "notDisgraced" }, (cardId) =>
    khWindow(move({ kind: "id", cardId } as CardRef, courtZone, activeHand)),
  ),
);

const FOOL: CardContent = {
  keywords: [],
  shortText: "Take any faceup card from Court.",
  fullText:
    "You may choose any other card from the Court that is not Disgraced, then put the chosen card into your hand.",
  flavorTexts: ["High and low, tricking others at every turn"],
  effects: [onPlay(foolEffect)],
};

const ASSASSIN: CardContent = {
  keywords: ["reaction"],
  shortText: "Reaction: counter a King flip.",
  fullText:
    "Reaction: If another player flips their King, you may reveal this card from your hand to prevent their King\u2019s power and cause them to lose this round.",
  flavorTexts: ["Things got complicated with the contract"],
  effects: [reaction("king_flip", done)],
};

const ELDER: CardContent = {
  keywords: ["immune_to_kings_hand"],
  shortText: "May play on any Royalty.",
  fullText: "You may play this card on any Royalty.",
  flavorTexts: [
    "Kingdom politics are beneath them, unless necessary",
    "Experience never fades for the undying",
  ],
  effects: [playOverride({ tag: "onAnyRoyalty" })],
};

const ZEALOT: CardContent = {
  keywords: ["immune_to_kings_hand"],
  shortText: "If King flipped, play on non-Royalty.",
  fullText:
    "If your King is flipped, you may play this card on any non-Royalty card.",
  flavorTexts: ["Their loyalty has swallowed their sanity"],
  effects: [
    playOverride({
      tag: "onAnyNonRoyaltyWhen",
      predicate: kingIsFlipped(active),
    }),
  ],
};

const inquisitorEffect = optional(
  nameCard((name) =>
    khWindow(
      forEachOpponent(
        (opp) =>
          chooseCard(
            playerId(opp),
            playerZone(playerId(opp), "hand"),
            { tag: "hasName", name },
            (cardId) =>
              move(
                { kind: "id", cardId } as CardRef,
                playerZone(playerId(opp), "hand"),
                playerZone(playerId(opp), "antechamber"),
              ),
          ),
      ),
    ),
  ),
);

const INQUISITOR: CardContent = {
  keywords: [],
  shortText: "Name a card; others play it out.",
  fullText:
    "You may say a card name. Other players with that card in their hand must play one to their Antechamber.",
  flavorTexts: [
    "Inquisitors live to point their fingers",
    "Being correct was never the objective",
  ],
  effects: [onPlay(inquisitorEffect)],
};

const executionerEffect = optional(
  nameValueUpToCourtMax(1, (value) =>
    khWindow(
      seq(
        chooseCard(active, activeHand, { tag: "hasBaseValue", value }, (cardId) =>
          condemn({ kind: "id", cardId } as CardRef, activeHand),
        ),
        forEachOpponent((opp) =>
          chooseCard(
            playerId(opp),
            playerZone(playerId(opp), "hand"),
            { tag: "hasBaseValue", value },
            (cardId) =>
              condemn(
                { kind: "id", cardId } as CardRef,
                playerZone(playerId(opp), "hand"),
              ),
          ),
        ),
      ),
    ),
  ),
);

const EXECUTIONER: CardContent = {
  keywords: [],
  shortText: "Name a value; all Condemn it.",
  fullText:
    "You may say any number equal to or less than the highest base value card in Court. All players must Condemn a card in their hand with that base value.",
  flavorTexts: [
    'Only the "guilty" make his acquaintance',
    "Must only meet him once",
  ],
  effects: [onPlay(executionerEffect)],
};

const BARD: CardContent = {
  keywords: [],
  shortText: "Replenish Army on value 3 or 4.",
  fullText:
    "When played on a card with base value 3 or 4, Recall an Exhausted card back into your Army.",
  flavorTexts: ["Songs echo longer than swords"],
};

const disgraceUpTo3 = optional(
  chooseCard(active, courtZone, { tag: "notDisgraced" }, (id1) =>
    disgrace({ kind: "id", cardId: id1 } as CardRef,
      optional(
        chooseCard(active, courtZone, { tag: "notDisgraced" }, (id2) =>
          disgrace({ kind: "id", cardId: id2 } as CardRef,
            optional(
              chooseCard(active, courtZone, { tag: "notDisgraced" }, (id3) =>
                disgrace({ kind: "id", cardId: id3 } as CardRef),
              ),
            ),
          ),
        ),
      ),
    ),
  ),
);

const soldierEffect = nameCard((name) =>
  khWindow(
    anyOpponentHas(
      "hand",
      { tag: "hasName", name },
      seq(
        addRoundModifier(played, { tag: "conditionalValueChange", delta: 2, target: { tag: "self" }, condition: cardIsOnThrone }),
        disgraceUpTo3,
      ),
    ),
  ),
);

const SOLDIER: CardContent = {
  keywords: [],
  shortText: "Name a card; +2 value, Disgrace 3.",
  fullText:
    "Say a card name. If any opponents have that card in their hand, this card gains +2 value while on the Throne and you may Disgrace up to three cards in the Court.",
  flavorTexts: [
    "They owe him their lives, but hate the lives he\u2019s given",
    "Amidst the chaos, they find their purpose",
  ],
  effects: [onPlay(soldierEffect, false)],
};

const judgeEffect = optional(
  choosePlayer((opp) =>
    nameCard((name) =>
      khWindow(
        checkZone(
          playerZone(playerId(opp), "hand"),
          { tag: "hasName", name },
          optional(
            chooseCard(active, activeHand, { tag: "minValue", value: 2 }, (cardId) =>
              move(
                { kind: "id", cardId } as CardRef,
                activeHand,
                playerZone(active, "antechamber"),
              ),
            ),
          ),
        ),
      ),
    ),
  ),
);

const JUDGE: CardContent = {
  keywords: [],
  shortText: "Guess opponent\u2019s card for bonus play.",
  fullText:
    "Guess a card name in an opponent\u2019s hand. If correct, you may play a card to your Antechamber with a base value of 2 or more.",
  flavorTexts: [
    "Duty-bound to distill facts from stories",
    "Even during war, the truth must be discovered",
  ],
  effects: [onPlay(judgeEffect)],
};

const ARBITER: CardContent = {
  keywords: [],
  shortText: "Exchange card; guess opponent\u2019s hand.",
  fullText:
    "You must exchange a card from your hand with a card from your opponent\u2019s hand. Guess whether the card you receive has a higher or lower value. If correct, the exchanged card gains +2 value in Court.",
  flavorTexts: ["Justice is a negotiation, not a verdict"],
};

// ---------------------------------------------------------------------------
// Signature cards — Fragments of Nersetti expansion
// ---------------------------------------------------------------------------

const flagbearerEffect = ifCond(
  courtHasDisgraced,
  optional(
    seq(
      disgrace(played),
      recall(),
      rally(rally(returnOneRallied())),
    ),
  ),
);

const FLAGBEARER: CardContent = {
  keywords: [],
  shortText: "Disgrace self to Recall and Rally.",
  fullText:
    "If there is a Disgraced card in Court, you may Disgrace this card to Recall once, then Rally twice. Reveal Rallied cards, then return one secretly to the Army.",
  flavorTexts: ["Every flag a command, every flutter a call to action"],
  effects: [onPlay(flagbearerEffect)],
};

const strangerEffect = optional(
  copyCardEffects(active, courtZone, { tag: "notDisgraced" }, (cardId) =>
    removeFromRound({ kind: "id", cardId } as CardRef),
  ),
);

const STRANGER: CardContent = {
  keywords: ["immune_to_kings_hand"],
  shortText: "Copy Reaction in hand; copy card on play.",
  fullText:
    "While in your hand, the Stranger may copy any Reaction card in Court that is not on the Throne. When played, it may copy the ability text and name of any card in Court. Remove copied card from the round.",
  flavorTexts: ["\u2026Who are you? Incomplete and yearning, curious\u2026"],
  effects: [onPlay(strangerEffect)],
};

const aegisEffect = optional(
  chooseCard(active, courtZone, { tag: "notDisgraced" }, (cardId) =>
    khWindow(disgrace({ kind: "id", cardId } as CardRef)),
  ),
);

const AEGIS: CardContent = {
  keywords: ["immune_to_kings_hand", "steadfast"],
  shortText: "Play on any card; Disgrace in Court.",
  fullText:
    "You may play this on any card then may Disgrace any card in Court. When your King is flipped, this card loses Steadfast.",
  flavorTexts: ["Experience trumps youth in a duel"],
  effects: [
    playOverride({ tag: "onAnyCard" }),
    onPlay(aegisEffect),
    continuous({ tag: "conditionalRevokeKeyword", keyword: "steadfast", target: { tag: "self" }, condition: { tag: "kingIsFlipped", player: active } }),
  ],
};

const ancestorOnPlay = ifCond(
  playedOnRoyalty,
  seq(
    recall(),
    optional(
      chooseCard(active, activeHand, null, (cardId) =>
        seq(
          move({ kind: "id", cardId } as CardRef, activeHand, playerZone(active, "recruitDiscard")),
          rally(),
        ),
      ),
    ),
  ),
);

const ANCESTOR: CardContent = {
  keywords: ["immune_to_kings_hand"],
  shortText: "Play on Royalty; Recall and Rally.",
  fullText:
    "You may play this card on any Royalty. If you do, Recall. Then, you may reveal and remove a card from your hand to Rally. While this card is in Court, Elders gain Steadfast and +3 value.",
  flavorTexts: ["A reminder of the importance of the Gerontocracy"],
  effects: [
    playOverride({ tag: "onAnyRoyalty" }),
    onPlay(ancestorOnPlay),
    continuous({ tag: "grantKeyword", keyword: "steadfast", target: { tag: "byName", name: "Elder" } }),
    continuous({ tag: "valueChange", delta: 3, target: { tag: "byName", name: "Elder" } }),
  ],
};

const informantEffect = nameCard((name) =>
  khWindow(
    forEachOpponent((opp) => {
      const dungeonZone = playerZone(playerId(opp), "dungeon");
      return checkZone(
        dungeonZone,
        { tag: "hasName", name },
        seq(
          revealZone(dungeonZone),
          optional(
            withFirstCardIn(dungeonZone, (cardId) =>
              move({ kind: "id", cardId } as CardRef, dungeonZone, activeHand),
            ),
            rally(),
          ),
        ),
      );
    }),
  ),
);

const INFORMANT: CardContent = {
  keywords: ["immune_to_kings_hand"],
  shortText: "Guess Dungeon card; take it or Rally.",
  fullText:
    "Guess the card name in an opponent\u2019s Dungeon. If correct, they must reveal it, then you may either add that card into your hand or Rally.",
  flavorTexts: ["Knowledge is the sharpest weapon in a world full of lies"],
  effects: [onPlay(informantEffect, false)],
};

const nakturnWrongGuess = (opp: import("@imposter-zero/types").PlayerId) => {
  const oppHand = playerZone(playerId(opp), "hand");
  return seq(
    revealZone(oppHand),
    chooseCard(active, oppHand, null, (cardId) =>
      condemn({ kind: "id", cardId } as CardRef, oppHand),
    ),
  );
};

const nakturnEffect = ifCond(
  courtHasDisgraced,
  optional(
    nameCard((name) =>
      choosePlayer((opp) =>
        khWindow(
          binaryChoice(playerId(opp), (guessedYes) =>
            guessedYes
              ? checkZone(activeHand, { tag: "hasName", name }, done, nakturnWrongGuess(opp))
              : checkZone(activeHand, { tag: "hasName", name }, nakturnWrongGuess(opp), done),
          ),
        ),
      ),
    ),
  ),
);

const NAKTURN: CardContent = {
  keywords: [],
  shortText: "Bluff; opponent guesses, Condemn if wrong.",
  fullText:
    "If there are any Disgraced cards in Court, you may say a card name. Choose an opponent to guess whether you have that card in your hand. If they are wrong, look at their hand and Condemn a card. This card\u2019s value is 2 while in Court.",
  flavorTexts: ["Some people never make it to Court"],
  effects: [
    onPlay(nakturnEffect),
    continuous({ tag: "selfCourtValue", value: 2 }),
  ],
};

const lockshiftEffect = optional(
  khWindow(
    forEachOpponent(
      (opp) => revealZone(playerZone(playerId(opp), "dungeon")),
      forEachPlayer((p) =>
        checkZone(
          playerZone(playerId(p), "dungeon"),
          null,
          withFirstCardIn(playerZone(playerId(p), "dungeon"), (cardId) =>
            move({ kind: "id", cardId } as CardRef, playerZone(playerId(p), "dungeon"), playerZone(playerId(p), "hand")),
          ),
        ),
      ),
    ),
  ),
);

const LOCKSHIFT: CardContent = {
  keywords: [],
  shortText: "Reveal and reclaim all Dungeons.",
  fullText:
    "You may make all other players reveal their Dungeon card. If you do, all players then put their Dungeon card in their hand.",
  flavorTexts: ["There\u2019s always a crack if you know where to look"],
  effects: [onPlay(lockshiftEffect)],
};

const conspiracistEffect = seq(
  addRoundModifier(played, { tag: "grantKeyword", keyword: "steadfast", target: { tag: "ownedBySourceOwner" } }, done, true),
  addRoundModifier(played, { tag: "valueChange", delta: 1, target: { tag: "ownedBySourceOwner" } }, done, true),
);

const CONSPIRACIST: CardContent = {
  keywords: ["steadfast"],
  shortText: "Grant Steadfast +1 to next plays.",
  fullText:
    "Until the end of your next turn, any card in your hand or Antechamber has Steadfast and +1 value. Cards played during this time keep this effect while they are in Court. This card loses 1 value while on the Throne.",
  flavorTexts: ["They always laughed at them for believing in Magic\u2026"],
  effects: [
    onPlay(conspiracistEffect, false),
    continuous({ tag: "conditionalValueChange", delta: -1, target: { tag: "self" }, condition: cardIsOnThrone }),
  ],
};

const exileOnPlay = addRoundModifier(
  played,
  { tag: "mute", target: { tag: "allInCourtExceptSelf" } },
);

const EXILE: CardContent = {
  keywords: ["steadfast"],
  shortText: "Mute all; weaker vs high-value Court.",
  fullText:
    "This card loses 1 value on Throne for each card in Court with a base value 7 or higher. When played, all cards are Muted until the start of your next turn.",
  flavorTexts: ["Their protection is certain, yet dread hangs in the air"],
  effects: [
    onPlay(exileOnPlay, false),
    continuous({
      tag: "valueChangePerCount",
      deltaPerMatch: -1,
      target: { tag: "self" },
      countQuery: { tag: "byMinBaseValue", minValue: 7 },
    }),
  ],
};

const oathboundEffect = ifCond(
  playedOnHigherValue,
  seq(
    disgrace(belowPlayed),
    chooseCard(active, activeHand, null, (cardId) =>
      forcePlay({ kind: "id", cardId } as CardRef, activeHand),
    ),
  ),
);

const OATHBOUND: CardContent = {
  keywords: ["immune_to_kings_hand"],
  shortText: "Play on higher card to Disgrace it.",
  fullText:
    "You may play this on a higher value card to Disgrace that card, then you must play another card of any value. That card is Immune to King\u2019s Hand.",
  flavorTexts: [
    "None dare challenge their decisions",
    "Now only six, they fight to preserve the world",
  ],
  effects: [playOverride({ tag: "onHigherValue" }), onPlay(oathboundEffect, false)],
};

const immortalModifiers: ReadonlyArray<CardEffect> = [
  continuous({ tag: "selfCourtValue", value: 5 }),
  continuous({ tag: "grantKeyword", keyword: "royalty", target: { tag: "self" } }),
  continuous({ tag: "grantKeyword", keyword: "royalty", target: { tag: "byName", name: "Warlord" } }),
  continuous({
    tag: "valueChange",
    delta: -1,
    target: {
      tag: "and",
      left: { tag: "allInCourtExceptSelf" },
      right: { tag: "or", left: { tag: "byKeyword", keyword: "royalty" }, right: { tag: "byName", name: "Elder" } },
    },
  }),
  continuous({
    tag: "mute",
    target: {
      tag: "and",
      left: { tag: "allInCourtExceptSelf" },
      right: { tag: "or", left: { tag: "byKeyword", keyword: "royalty" }, right: { tag: "byName", name: "Elder" } },
    },
  }),
];

const IMMORTAL: CardContent = {
  keywords: ["steadfast"],
  shortText: "Warlord gains Royalty; Royalty/Elders weakened.",
  fullText:
    "Steadfast (Cannot be Muted or have its value lowered by other cards). While this card is in Court, this card and the Warlord gain Royalty. All other Royalty and Elders lose 1 value and are Muted. This card has a value of 5 in Court.",
  flavorTexts: [
    "The Bhunari seemingly suffer no casualties in battle. In court however\u2026",
  ],
  effects: immortalModifiers,
};

const heraldEffect = khWindow(withFirstCardIn(playerZone(active, "successor"), (succCardId) =>
  seq(
    move(
      { kind: "id", cardId: succCardId } as CardRef,
      playerZone(active, "successor"),
      activeHand,
    ),
    chooseCard(active, activeHand, null, (newSuccId) =>
      seq(
        move(
          { kind: "id", cardId: newSuccId } as CardRef,
          activeHand,
          playerZone(active, "successor"),
        ),
        optional(
          chooseCard(active, activeHand, { tag: "minValue", value: 5 }, (playCardId) =>
            seq(
              move({ kind: "id", cardId: playCardId } as CardRef, activeHand, courtZone),
              move(played, courtZone, activeHand),
            ),
          ),
        ),
      ),
    ),
  ),
));

const HERALD: CardContent = {
  keywords: [],
  shortText: "Swap Successor; chain a 5+ play.",
  fullText:
    "Shuffle your Successor into your hand and place a new Successor. Then you may play another card value 5 or higher to take the Herald back into your hand. This ability is prevented if played from your Antechamber.",
  flavorTexts: ["Those who speak, speak at his discretion"],
  effects: [onPlay(heraldEffect, false)],
};

const WARLORD: CardContent = {
  keywords: [],
  shortText: "+1 value if Royalty in Court.",
  fullText:
    "If there are any Royalty in the Court, this card gains +1 value in your hand and an additional +1 value after being played.",
  flavorTexts: ["In chaos, her influence shines"],
  effects: [
    continuous({
      tag: "conditionalValueChange",
      delta: 2,
      target: { tag: "and", left: { tag: "allInCourt" }, right: { tag: "byName", name: "Warlord" } },
      condition: courtHasRoyalty,
    }),
  ],
};

const mysticMuteTarget = (value: number) => ({
  tag: "and" as const,
  left: { tag: "allInCourt" as const },
  right: { tag: "byBaseValue" as const, value },
});

const mysticEffect = ifCond(
  courtHasDisgraced,
  optional(
    seq(
      disgrace(played),
      nameValue(1, 8, (value) =>
        khWindow(
          seq(
            addRoundModifier(played, {
              tag: "mute",
              target: mysticMuteTarget(value),
            }),
            addRoundModifier(played, {
              tag: "valueChange",
              delta: 3 - value,
              target: mysticMuteTarget(value),
            }),
          ),
        ),
      ),
    ),
  ),
);

const MYSTIC: CardContent = {
  keywords: [],
  shortText: "Disgrace to blank cards of a value.",
  fullText:
    "If there are any Disgraced cards in Court, you may Disgrace this card after playing it to choose a number between 1\u20138. Cards of that base value lose their card text and have a value of 3 after being played for this round.",
  flavorTexts: ["She speaks and the Court is silenced"],
  effects: [onPlay(mysticEffect)],
};

const wardenEffect = ifCond(
  courtHasFaceUpAtLeast(4),
  optional(
    chooseCard(active, activeHand, null, (handCardId) =>
      khWindow(
        withFirstCardIn(sharedZone("accused"), (accusedCardId) =>
          seq(
            move(
              { kind: "id", cardId: accusedCardId } as CardRef,
              sharedZone("accused"),
              activeHand,
            ),
            move(
              { kind: "id", cardId: handCardId } as CardRef,
              activeHand,
              sharedZone("accused"),
            ),
          ),
        ),
      ),
    ),
  ),
);

const WARDEN: CardContent = {
  keywords: [],
  shortText: "Swap hand card with Accused.",
  fullText:
    "If there are four or more faceup cards in the Court, you may exchange any card from your hand with the Accused card.",
  flavorTexts: ["Evidence can change with a little loose change"],
  effects: [onPlay(wardenEffect)],
};

const sentryEffect = optional(
  seq(
    disgrace(played),
    chooseCard(active, courtZone, { tag: "notDisgracedOrRoyalty" }, (courtCardId) =>
      khWindow(
        chooseCard(active, activeHand, null, (handCardId) =>
          seq(
            move({ kind: "id", cardId: courtCardId } as CardRef, courtZone, activeHand),
            move({ kind: "id", cardId: handCardId } as CardRef, activeHand, courtZone),
          ),
        ),
      ),
    ),
  ),
);

const SENTRY: CardContent = {
  keywords: [],
  shortText: "Disgrace to swap with Court card.",
  fullText:
    "You may Disgrace this card after playing it to choose a card from the Court that is not Disgraced or Royalty. Exchange a card from your hand with the chosen card.",
  flavorTexts: ["Forsaking their own, they help the Court see others anew"],
  effects: [onPlay(sentryEffect)],
};

const KINGS_HAND: CardContent = {
  keywords: ["immune_to_kings_hand", "reaction"],
  shortText: "Reaction: cancel any card ability.",
  fullText:
    "Reaction: When another player chooses to use a card\u2019s ability, play this card immediately after they choose their target to prevent that ability. Condemn both this card and the played card.",
  flavorTexts: [
    "To face him, certain death",
    "To be near him, a sense of dread",
  ],
  effects: [reaction("ability_activation", done)],
};

const spyEffect = optional(
  seq(
    disgrace(played),
    khWindow(
      optional(
        choosePlayer((target) =>
          chooseCard(
            playerId(target),
            playerZone(playerId(target), "hand"),
            null,
            (handCardId) =>
              withFirstCardIn(playerZone(playerId(target), "successor"), (succCardId) =>
                seq(
                  move(
                    { kind: "id", cardId: succCardId } as CardRef,
                    playerZone(playerId(target), "successor"),
                    playerZone(playerId(target), "hand"),
                  ),
                  move(
                    { kind: "id", cardId: handCardId } as CardRef,
                    playerZone(playerId(target), "hand"),
                    playerZone(playerId(target), "successor"),
                  ),
                ),
              ),
          ),
        ),
      ),
    ),
  ),
);

const SPY: CardContent = {
  keywords: [],
  shortText: "Disgrace to view/swap Successors.",
  fullText:
    "You may Disgrace this card after playing it to look at all Successors. You may then force one player to change their Successor with a card in their hand.",
  flavorTexts: ["Only hire a Nakht spy if you have nothing to hide"],
  effects: [onPlay(spyEffect)],
};

const princessEffect = optional(
  choosePlayer((opp) =>
    khWindow(
      chooseCard(active, activeHand, null, (myCardId) =>
        chooseCard(
          playerId(opp),
          playerZone(playerId(opp), "hand"),
          null,
          (oppCardId) =>
            seq(
              move(
                { kind: "id", cardId: myCardId } as CardRef,
                activeHand,
                playerZone(playerId(opp), "hand"),
              ),
              move(
                { kind: "id", cardId: oppCardId } as CardRef,
                playerZone(playerId(opp), "hand"),
                activeHand,
              ),
            ),
        ),
      ),
    ),
  ),
);

const PRINCESS: CardContent = {
  keywords: ["royalty"],
  shortText: "Pick a player; swap a card each.",
  fullText: "You may pick a player. Both of you choose and swap a card.",
  flavorTexts: ["Friendly eyes mask a cunning spirit"],
  effects: [onPlay(princessEffect)],
};

const QUEEN: CardContent = {
  keywords: ["royalty"],
  shortText: "Disgrace all other Court cards.",
  fullText: "You must Disgrace all other cards in the Court.",
  flavorTexts: ["Her presence shakes all convictions"],
  effects: [onPlay(disgraceAll(played), false)],
};

// ---------------------------------------------------------------------------
// Deck definitions
// ---------------------------------------------------------------------------

const baseDefinitions: ReadonlyArray<IKCardKind> = [
  ...copies("Fool", 1, 1, FOOL),
  ...copies("Assassin", 2, 1, ASSASSIN),
  ...copies("Elder", 3, 2, ELDER),
  ...copies("Zealot", 3, 1, ZEALOT),
  ...copies("Inquisitor", 4, 2, INQUISITOR),
  ...copies("Soldier", 5, 2, SOLDIER),
  ...copies("Judge", 5, 1, JUDGE),
  ...copies("Oathbound", 6, 2, OATHBOUND),
  ...copies("Immortal", 6, 1, IMMORTAL),
  ...copies("Warlord", 7, 1, WARLORD),
  ...copies("Mystic", 7, 1, MYSTIC),
  ...copies("Warden", 7, 1, WARDEN),
  ...copies("Sentry", 8, 1, SENTRY),
  ...copies("King's Hand", 8, 1, KINGS_HAND),
  ...copies("Princess", 9, 1, PRINCESS),
  ...copies("Queen", 9, 1, QUEEN),
];

const threePlayerExtras: ReadonlyArray<IKCardKind> = [
  ...copies("Executioner", 4, 1, EXECUTIONER),
  ...copies("Bard", 4, 2, BARD),
  ...copies("Herald", 6, 1, HERALD),
  ...copies("Spy", 8, 1, SPY),
];

const fourPlayerExtras: ReadonlyArray<IKCardKind> = [
  ...copies("Fool", 1, 1, FOOL),
  ...copies("Assassin", 2, 1, ASSASSIN),
  ...copies("Executioner", 4, 1, {
    ...EXECUTIONER,
    flavorTexts: ["Must only meet him once"],
  }),
  ...copies("Arbiter", 5, 1, ARBITER),
];

export const BASE_DECK: ReadonlyArray<IKCardKind> = baseDefinitions;
export const THREE_PLAYER_EXTRAS: ReadonlyArray<IKCardKind> = threePlayerExtras;
export const FOUR_PLAYER_EXTRAS: ReadonlyArray<IKCardKind> = fourPlayerExtras;

export const SIGNATURE_CARD_KINDS: ReadonlyArray<IKCardKind> = [
  ...copies("Flagbearer", 1, 1, FLAGBEARER),
  ...copies("Stranger", 2, 1, STRANGER),
  ...copies("Aegis", 3, 1, AEGIS),
  ...copies("Ancestor", 4, 1, ANCESTOR),
  ...copies("Informant", 4, 1, INFORMANT),
  ...copies("Nakturn", 4, 1, NAKTURN),
  ...copies("Lockshift", 5, 1, LOCKSHIFT),
  ...copies("Conspiracist", 6, 1, CONSPIRACIST),
  ...copies("Exile", 8, 1, EXILE),
];

export const BASE_ARMY_KINDS: ReadonlyArray<IKCardKind> = [
  ...copies("Elder", 3, 1, ELDER),
  ...copies("Inquisitor", 4, 1, INQUISITOR),
  ...copies("Soldier", 5, 1, SOLDIER),
  ...copies("Judge", 5, 1, JUDGE),
  ...copies("Oathbound", 6, 1, OATHBOUND),
];

export const regulationDeck = (numPlayers: number): ReadonlyArray<IKCardKind> => {
  if (numPlayers < 2 || numPlayers > 4) {
    throw new RangeError(`Regulation deck supports 2-4 players, received ${numPlayers}`);
  }

  if (numPlayers === 2) {
    return [...BASE_DECK];
  }

  if (numPlayers === 3) {
    return [...BASE_DECK, ...THREE_PLAYER_EXTRAS];
  }

  return [...BASE_DECK, ...THREE_PLAYER_EXTRAS, ...FOUR_PLAYER_EXTRAS];
};
