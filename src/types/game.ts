// Card types
export type CardName =
  | "Fool" | "FlagBearer" | "Assassin" | "Stranger" | "Elder" | "Zealot"
  | "Aegis" | "Inquisitor" | "Ancestor" | "Informant" | "Nakturn"
  | "Soldier" | "Judge" | "Lockshift" | "Immortal" | "Oathbound"
  | "Conspiracist" | "Mystic" | "Warlord" | "Warden" | "Sentry"
  | "KingsHand" | "Exile" | "Princess" | "Queen";

export type KingFacet = "Regular" | "CharismaticLeader" | "MasterTactician";

export interface Card {
  card: CardName;
  flavor: number;
}

export interface CardModifiers {
  value?: {
    type: "Override" | "Delta" | "Deferred";
    value: number;
    delta?: number;
    color: string;
  };
  royalty?: boolean;
  muted?: boolean;
  steadfast?: boolean;
  stranger_mask?: Card;
}

export interface HandCard {
  card: Card;
  modifiers: CardModifiers;
  spec?: ActionSpec | null;
}

export interface CourtCard {
  card: Card;
  modifiers: CardModifiers;
  disgraced: boolean;
  sentry_swap: boolean;
  conspiracist_effect: boolean;
}

export interface ArmyCard {
  card: Card;
  state: "Available" | "Taken" | "Exhausted";
  recruit: boolean;
  exhaust: boolean;
  recall: boolean;
  recommission: boolean;
  rally: boolean;
}

export type UnknownCard = "Unknown";
export type CardOrUnknown = Card | UnknownCard;

// Action types
export interface ActionSpec {
  type: "Discard" | "Unrally" | "PickSuccessor" | "PickSquire" | "PickForSwap"
       | "Play" | "Reaction" | "MoveToAnte" | "SentrySwap";
  idx?: number;
  stranger_target?: CardName;
  play?: {
    without_ability: boolean;
    with_ability?: AbilitySpec;
  };
}

export interface AbilitySpec {
  type: "Simple" | "SayCardName" | "SayNumber" | "PickCourtCard" | "StrangerCopy";
  cards?: CardName[];
  numbers?: number[];
  entries?: Array<{
    court_card_idx: number;
    card: { card: Card; modifiers: CardModifiers };
    play: { with_ability?: AbilitySpec };
  }>;
}

// Game state
export interface GameBoard {
  fake: boolean;
  reveal_everything: boolean;
  player_idx: number;
  points: [number, number];
  accused: HandCard[];
  randomly_discarded: CardOrUnknown[];
  dungeons: [CardOrUnknown[], CardOrUnknown[]];
  court: CourtCard[];
  true_king_idx: number;
  first_player_idx: number | null;
  armies: [ArmyCard[], ArmyCard[]];
  replaced_by_army: [Card[], Card[]];
  hand: HandCard[];
  antechamber: HandCard[];
  king_facets: [KingFacet, KingFacet];
  kings_flipped: [boolean, boolean];
  antechambers: [HandCard[], HandCard[]];
  hands: [HandCard[], HandCard[]];
  successors: [HandCard | null, HandCard | null];
  successors_revealed: [boolean, boolean];
  squires: [HandCard | null, HandCard | null];
  squires_revealed: [boolean, boolean];
  khed: HandCard[] | null;
  thrown_assassins: [HandCard | null, HandCard | null];
  unseen_cards: HandCard[];
  unseen_army_card_counts: [number, number];
  change_king_facet: KingFacet[] | null;
  choose_signature_cards: {
    cards: Card[];
    count: number;
  } | null;
  new_round: boolean;
  choose_whos_first: boolean;
  flip_king: boolean;
  fake_reaction: Card | null;
  move_nothing_to_ante: boolean;
  sentry_swap: boolean;
  disgrace_court_cards: number | null;
  free_mulligan: boolean;
  mulligan: boolean;
  end_muster: boolean;
  skip_rally: boolean;
  take_dungeon: Card | null;
  card_in_hand_guess: Card | null;
  take_successor: boolean;
  take_squire: boolean;
  choose_to_take_one_or_two: boolean;
  condemn_opponent_hand_card: boolean;
}

// Game status
export type GameStatus =
  | { type: "SelectSignatureCards" }
  | { type: "NewRound" }
  | { type: "Discard" }
  | { type: "ChooseWhosFirst" }
  | { type: "Muster" }
  | { type: "Exhaust" }
  | { type: "Recall" }
  | { type: "Rally" }
  | { type: "GetRidOfCard" }
  | { type: "RallyOrTakeDungeon" }
  | { type: "PickSuccessor" }
  | { type: "PickSquire" }
  | { type: "RegularMove" }
  | { type: "PlayCardOfAnyValue" }
  | { type: "RallyOrTakeSuccessor" }
  | { type: "RallyOrTakeSquire" }
  | { type: "TakeSuccessorOrSquire" }
  | { type: "ChooseToTakeOneOrTwo" }
  | { type: "Reaction" }
  | { type: "GameOver"; points: [number, number] }
  | { type: "Waiting"; reason: "Reaction" | "Other" }
  | { type: "PickCardForSwap" }
  | { type: "PickForAnte" }
  | { type: "PickCardsForSentrySwap" }
  | { type: "PickCardsToDisgrace"; max_count: number }
  | { type: "GuessCardPresence" }
  | { type: "CondemnOpponentHandCard" }
  | { type: "Observing" };

// Actions
export type GameAction =
  | { type: "ChooseSignatureCards"; cards: Array<[number, CardName]> }
  | { type: "StartNewRound" }
  | { type: "Discard"; card_idx: number; card: CardName }
  | { type: "ChooseWhosFirst"; player_idx: number }
  | { type: "Mulligan"; free: boolean }
  | { type: "EndMuster" }
  | { type: "Recruit"; army_card_idx: number; army_card: CardName }
  | { type: "Exhaust"; army_card_idx: number; army_card: CardName }
  | { type: "Unexhaust"; army_card_idx: number; army_card: CardName }
  | { type: "Recommission"; army_card_idx: number; army_card: CardName }
  | { type: "Rally"; army_card_idx: number; army_card: CardName }
  | { type: "Unrally"; idx: number; card: CardName }
  | { type: "SkipRally" }
  | { type: "TakeDungeon"; card: CardName }
  | { type: "ChooseSuccessor"; card_idx: number; card: CardName }
  | { type: "ChooseSquire"; card_idx: number; card: CardName }
  | { type: "PlayCard"; card_idx: { type: "Hand" | "Antechamber"; idx: number }; card: CardName; ability: AbilitySpec | null }
  | { type: "ChangeKingFacet"; facet: KingFacet }
  | { type: "FlipKing" }
  | { type: "ChooseToTakeTwo" }
  | { type: "ChooseToTakeOne" }
  | { type: "TakeSuccessor" }
  | { type: "TakeSquire" }
  | { type: "Reaction"; card_idx: number; card: CardName; stranger_target?: CardName }
  | { type: "NoReaction" }
  | { type: "PickCardForSwap"; card_idx: number; card: CardName }
  | { type: "MoveToAnte"; card_idx: number; card: CardName }
  | { type: "MoveNothingToAnte" }
  | { type: "SentrySwap"; court_card_idx: number; court_card: CardName; hand_card_idx: number; hand_card: CardName }
  | { type: "Disgrace"; cards: Array<[number, CardName]> }
  | { type: "CardInHandGuess"; present: boolean }
  | { type: "Condemn"; owning_player_idx: number; card_idx: number; card: CardName };

// Messages
export type GameMessage =
  | { type: "KnownSignatureCardsChosen"; player_idx: number; cards: CardName[] }
  | { type: "UnknownSignatureCardsChosen"; player_idx: number; count: number }
  | { type: "SignatureCardsRevealed"; player_idx: number; cards: CardName[] }
  | { type: "SignatureCardsRevealedPlaceholder" }
  | { type: "NewRoundStarted" }
  | { type: "FirstPlayerChosen"; player_idx: number; first_player_idx: number }
  | { type: "Mulligan"; player_idx: number; free: boolean }
  | { type: "EndedMuster"; player_idx: number }
  | { type: "ChangedKingFacet"; player_idx: number; facet: KingFacet }
  | { type: "Recruited"; player_idx: number; card: CardName | "Unknown" }
  | { type: "Exhausted"; player_idx: number; card: CardName }
  | { type: "Recalled"; player_idx: number; card: CardName }
  | { type: "Rallied"; player_idx: number; card: CardName | "Unknown" }
  | { type: "Unrallied"; player_idx: number; card: CardName | "Unknown" }
  | { type: "SkippedRally"; player_idx: number }
  | { type: "Recommissioned"; player_idx: number; card: CardName }
  | { type: "Discarded"; player_idx: number; card: CardName | "Unknown" }
  | { type: "TookDungeon"; player_idx: number; card: CardName; dungeon_player_idx: number }
  | { type: "SuccessorPicked"; player_idx: number; card: CardName | "Unknown" }
  | { type: "SquirePicked"; player_idx: number; card: CardName | "Unknown" }
  | { type: "CardPlayed"; player_idx: number; card: CardName; ability: AbilitySpec | null }
  | { type: "KingFlipped"; player_idx: number }
  | { type: "SuccessorTaken"; player_idx: number; successor: CardName | "Unknown" }
  | { type: "SquireTaken"; player_idx: number; squire: CardName | "Unknown" }
  | { type: "Reacted"; player_idx: number; card: CardName; stranger_target?: CardName }
  | { type: "NothingHappened" }
  | { type: "CardSwapped"; player_idx: number; old: CardName; new: CardName }
  | { type: "AccusedSwapped"; player_idx: number; old: CardName; new: CardName }
  | { type: "MovedNothingToAntechamber"; player_idx: number }
  | { type: "MovedCardToAntechamber"; player_idx: number; card: CardName }
  | { type: "Disgraced"; player_idx: number; cards: CardName[] }
  | { type: "TookDungeonCard"; player_idx: number; card: CardName | "Unknown" }
  | { type: "Guessed"; player_idx: number; owning_player_idx: number; card: CardName; present: boolean; correct: boolean }
  | { type: "RevealedHand"; player_idx: number; peeking_player_idx: number; cards: CardName[] }
  | { type: "Condemned"; player_idx: number; owning_player_idx: number; card: CardName }
  | { type: "RoundOver"; player_idx: number; points: number }
  | { type: "GameOver"; points: [number, number] };

// Events
export type GameEvent =
  | { type: "Message"; message: GameMessage }
  | { type: "NewState"; board: GameBoard; actions: GameAction[]; status: GameStatus; reset_ui: boolean };

// API responses
export interface GameStatusResponse {
  players: Array<{ type: "Human"; name: string } | { type: "Bot" } | null>;
  started: boolean;
  version_number: number;
  join_token: string;
}

export interface CreateGameRequest {
  player_name: string;
}

export interface CreateGameResponse {
  game_id: number;
  player_token: string;
}

export interface JoinGameRequest {
  game_id: number;
  join_token: string;
  player_name: string;
}

export interface JoinGameResponse {
  player_token: string;
}
