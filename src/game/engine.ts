import type { CardName, KingFacet, GameAction, GameBoard, GameStatus } from '../types/game.js';
import { FragmentsOfNersettiRules, GAME_CONFIG } from './rules.js';

export interface Player {
  name: string;
  hand: CardName[];
  army: CardName[];
  exhaustedArmy: CardName[];
  successor: CardName | null;
  squire: CardName | null; // Master Tactician only
  dungeon: CardName | null;
  kingFacet: KingFacet;
  kingFlipped: boolean;
  points: number;
}

export interface LocalGameState {
  players: [Player, Player];
  currentPlayerIdx: number;
  trueKingIdx: number;
  firstPlayerIdx: number | null;
  court: Array<{ card: CardName; playerIdx: number; disgraced: boolean }>;
  accused: CardName;
  deck: CardName[];
  phase: 'signature_selection' | 'mustering' | 'play' | 'game_over';
  round: number;
  rules: FragmentsOfNersettiRules;
  signatureCardsSelected: [boolean, boolean]; // Track which players have selected
}

export class LocalGameEngine {
  private state: LocalGameState;

  constructor(player1Name: string, player2Name: string) {
    // Randomly assign True King
    const trueKingIdx = Math.random() < 0.5 ? 0 : 1;

    this.state = {
      players: [
        this.createPlayer(player1Name),
        this.createPlayer(player2Name),
      ],
      currentPlayerIdx: 0,
      trueKingIdx,
      firstPlayerIdx: null,
      court: [],
      accused: 'Assassin', // For quickplay, always Assassin
      deck: [...GAME_CONFIG.BASE_DECK],
      phase: 'signature_selection',
      round: 1,
      rules: new FragmentsOfNersettiRules(),
      signatureCardsSelected: [false, false],
    };

    // Remove accused card from deck
    this.state.deck = this.state.deck.filter(card => card !== this.state.accused);

    // Shuffle deck
    this.shuffleDeck();
  }

  private createPlayer(name: string): Player {
    return {
      name,
      hand: [],
      army: [...GAME_CONFIG.BASE_ARMY],
      exhaustedArmy: [],
      successor: null,
      squire: null,
      dungeon: null,
      kingFacet: 'Regular',
      kingFlipped: false,
      points: 0,
    };
  }

  private shuffleDeck(): void {
    for (let i = this.state.deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.state.deck[i], this.state.deck[j]] = [this.state.deck[j], this.state.deck[i]];
    }
  }

  getGameState(): LocalGameState {
    return JSON.parse(JSON.stringify(this.state)); // Deep clone
  }

  getCurrentPlayer(): Player {
    return this.state.players[this.state.currentPlayerIdx];
  }

  getOpponentPlayer(): Player {
    return this.state.players[1 - this.state.currentPlayerIdx];
  }

  // Stage 3: Signature Card Selection
  getAvailableSignatureCards(): CardName[] {
    return [...GAME_CONFIG.SIGNATURE_CARDS];
  }

  selectSignatureCards(playerIdx: number, cards: CardName[]): boolean {
    if (cards.length !== GAME_CONFIG.SIGNATURE_CARD_COUNT) {
      return false;
    }

    // Validate all cards are available
    for (const card of cards) {
      if (!GAME_CONFIG.SIGNATURE_CARDS.includes(card)) {
        return false;
      }
    }

    // Add to player's army
    this.state.players[playerIdx].army.push(...cards);
    this.state.rules.setSignatureCards(playerIdx, cards);

    return true;
  }

  // Check if both players have selected signature cards
  canStartMatch(): boolean {
    return this.state.players.every(player =>
      player.army.length === GAME_CONFIG.BASE_ARMY.length + GAME_CONFIG.SIGNATURE_CARD_COUNT
    );
  }

  // Start a new round
  startNewRound(): void {
    if (this.state.phase === 'signature_selection' && this.canStartMatch()) {
      this.state.phase = 'mustering';
    }

    // Deal cards
    this.dealCards();

    // True King decides who goes first
    if (this.state.firstPlayerIdx === null) {
      // For now, True King is player 0, they choose player 1 to go first
      this.state.firstPlayerIdx = this.state.trueKingIdx;
    }

    // Start mustering with the player who goes SECOND (they muster first)
    this.startMusteringPhase();

    // Set up Successor and Dungeon
    this.setupSuccessorAndDungeon();
  }

  private dealCards(): void {
    // Reset hands
    this.state.players.forEach(player => {
      player.hand = [];
      player.kingFlipped = false;
    });

    // Deal 9 cards to each player
    for (let i = 0; i < GAME_CONFIG.HAND_SIZE * 2; i++) {
      const playerIdx = i % 2;
      if (this.state.deck.length > 0) {
        const card = this.state.deck.pop()!;
        this.state.players[playerIdx].hand.push(card);
      }
    }
  }

  private setupSuccessorAndDungeon(): void {
    // Each player chooses Successor and Dungeon
    // For now, auto-select (in real game, players would choose)
    this.state.players.forEach((player, idx) => {
      if (player.hand.length > 0) {
        // Auto-select highest card as successor
        const successorIdx = player.hand.findIndex(card =>
          this.state.rules.getCardValue(card) >= 5
        );
        if (successorIdx >= 0) {
          player.successor = player.hand.splice(successorIdx, 1)[0];
        }

        // Auto-select another card as dungeon
        if (player.hand.length > 0) {
          player.dungeon = player.hand.splice(0, 1)[0];
        }

        // Master Tactician needs a Squire
        if (player.kingFacet === 'MasterTactician' && player.hand.length > 0) {
          player.squire = player.hand.splice(0, 1)[0];
          this.state.rules.setSquire(idx, player.squire);
        }
      }
    });
  }

  // Stage 2: Mustering Phase
  startMusteringPhase(): void {
    this.state.phase = 'mustering';
    // Start with player going second (they muster first)
    this.state.currentPlayerIdx = 1 - (this.state.firstPlayerIdx || 0);
  }

  // Recruit: Remove card from hand, take card from army, exhaust if needed
  recruit(playerIdx: number, handCardIdx: number, armyCardIdx: number): boolean {
    const player = this.state.players[playerIdx];

    if (handCardIdx >= player.hand.length || armyCardIdx >= player.army.length) {
      return false;
    }

    // Remove card from hand (discard)
    const discarded = player.hand.splice(handCardIdx, 1)[0];

    // Take card from army
    const recruited = player.army.splice(armyCardIdx, 1)[0];
    player.hand.push(recruited);

    // Exhaust a card if this is the first recruit/recommission this turn
    // (simplified for now - in real game this would track per-turn state)

    return true;
  }

  // Recommission: Exhaust 2 army cards to return 1 exhausted card to army
  recommission(playerIdx: number, armyCard1Idx: number, armyCard2Idx: number, exhaustedCardIdx: number): boolean {
    const player = this.state.players[playerIdx];

    if (armyCard1Idx >= player.army.length ||
        armyCard2Idx >= player.army.length ||
        exhaustedCardIdx >= player.exhaustedArmy.length) {
      return false;
    }

    // Exhaust 2 army cards
    const exhausted1 = player.army.splice(armyCard1Idx, 1)[0];
    const exhausted2 = player.army.splice(armyCard2Idx >= armyCard1Idx ? armyCard2Idx - 1 : armyCard2Idx, 1)[0];
    player.exhaustedArmy.push(exhausted1, exhausted2);

    // Return 1 exhausted card to army
    const returned = player.exhaustedArmy.splice(exhaustedCardIdx, 1)[0];
    player.army.push(returned);

    return true;
  }

  // Rally: Take card from army (triggered by card abilities)
  rally(playerIdx: number, count: number = 1): CardName[] {
    const player = this.state.players[playerIdx];
    const rallied: CardName[] = [];

    for (let i = 0; i < count && player.army.length > 0; i++) {
      const card = player.army.pop()!;
      player.hand.push(card);
      rallied.push(card);
    }

    return rallied;
  }

  // Recall: Return exhausted card to army (triggered by card abilities)
  recall(playerIdx: number, exhaustedCardIdx: number): boolean {
    const player = this.state.players[playerIdx];

    if (exhaustedCardIdx >= player.exhaustedArmy.length) {
      return false;
    }

    const recalled = player.exhaustedArmy.splice(exhaustedCardIdx, 1)[0];
    player.army.push(recalled);

    return true;
  }

  // Play a card to the court
  playCard(playerIdx: number, handCardIdx: number): boolean {
    const player = this.state.players[playerIdx];

    if (handCardIdx >= player.hand.length) {
      return false;
    }

    const card = player.hand[handCardIdx];
    const currentThroneValue = this.getCurrentThroneValue();
    const cardValue = this.state.rules.getCardValue(card);

    // Check if card can be played (equal or higher value)
    if (cardValue < currentThroneValue) {
      return false;
    }

    // Remove from hand and add to court
    player.hand.splice(handCardIdx, 1);
    this.state.court.push({
      card,
      playerIdx,
      disgraced: false,
    });

    // Switch to next player
    this.state.currentPlayerIdx = 1 - this.state.currentPlayerIdx;

    return true;
  }

  // Flip King to take Successor
  flipKing(playerIdx: number): boolean {
    const player = this.state.players[playerIdx];

    if (player.kingFlipped || !player.successor) {
      return false;
    }

    player.kingFlipped = true;
    player.hand.push(player.successor);
    player.successor = null;

    // Handle facet-specific effects
    if (player.kingFacet === 'Regular') {
      // Regular King: Take Successor
    } else if (player.kingFacet === 'CharismaticLeader') {
      // Already revealed, just take it
    } else if (player.kingFacet === 'MasterTactician') {
      // Take Successor, then take Squire or Rally
      if (player.squire) {
        player.hand.push(player.squire);
        player.squire = null;
      }
    }

    // Switch to next player
    this.state.currentPlayerIdx = 1 - this.state.currentPlayerIdx;

    return true;
  }

  private getCurrentThroneValue(): number {
    if (this.state.court.length === 0) {
      return 0; // Can play any card on empty court
    }

    const throneCard = this.state.court[this.state.court.length - 1];
    if (throneCard.disgraced) {
      return 1; // Disgraced cards have value 1
    }

    return this.state.rules.getCardValue(throneCard.card);
  }

  // Check if player can play any card
  canPlayerPlay(playerIdx: number): boolean {
    const player = this.state.players[playerIdx];
    const throneValue = this.getCurrentThroneValue();

    return player.hand.some(card =>
      this.state.rules.getCardValue(card) >= throneValue
    ) || !player.kingFlipped;
  }

  // End round when a player cannot play
  endRound(): void {
    // Award points to the winner (player who didn't lose)
    const winnerIdx = 1 - this.state.currentPlayerIdx;
    const winner = this.state.players[winnerIdx];

    // Calculate points based on court strength
    const courtStrength = this.state.court.length;
    const points = Math.min(3, Math.max(1, Math.floor(courtStrength / 3)));
    winner.points += points;

    // Check for game over
    if (winner.points >= GAME_CONFIG.POINTS_TO_WIN) {
      this.state.phase = 'game_over';
      return;
    }

    // Prepare for next round
    this.prepareNextRound();
  }

  private prepareNextRound(): void {
    // Exhaust all recruited/rallied cards
    this.state.players.forEach(player => {
      // Move recruited cards to exhausted (simplified)
      player.exhaustedArmy.push(...player.hand.filter(card =>
        !GAME_CONFIG.BASE_DECK.includes(card)
      ));
    });

    // Reset for next round
    this.state.round++;
    this.state.court = [];
    this.state.phase = 'mustering';

    // Shuffle remaining deck with discarded cards
    this.reshuffleDeck();
  }

  private reshuffleDeck(): void {
    // Add all cards back to deck except army cards
    this.state.deck = [...GAME_CONFIG.BASE_DECK].filter(card => card !== this.state.accused);
    this.shuffleDeck();
  }

  // Get possible actions for current player
  getPossibleActions(): GameAction[] {
    const actions: GameAction[] = [];
    const currentPlayer = this.getCurrentPlayer();

    switch (this.state.phase) {
      case 'signature_selection':
        // Only allow signature card selection if current player hasn't selected yet
        if (!this.state.signatureCardsSelected[this.state.currentPlayerIdx]) {
          // Generate all possible signature card combinations
          const availableCards = GAME_CONFIG.SIGNATURE_CARDS;
          for (let i = 0; i < availableCards.length; i++) {
            for (let j = i + 1; j < availableCards.length; j++) {
              for (let k = j + 1; k < availableCards.length; k++) {
                actions.push({
                  type: 'ChooseSignatureCards',
                  cards: [
                    [i, availableCards[i]],
                    [j, availableCards[j]],
                    [k, availableCards[k]],
                  ],
                });
              }
            }
          }
        }
        break;

      case 'mustering':
        // Add recruitment actions - only one of each army card type
        if (currentPlayer.army.length > 0 && currentPlayer.hand.length > 0) {
          const availableArmyCards = new Set<CardName>();
          currentPlayer.army.forEach((armyCard, armyIdx) => {
            if (!availableArmyCards.has(armyCard)) {
              availableArmyCards.add(armyCard);
              actions.push({
                type: 'Recruit',
                army_card_idx: armyIdx,
                army_card: armyCard,
              });
            }
          });
        }

        // Add recommission actions if there are exhausted cards
        if (currentPlayer.exhaustedArmy.length > 0 && currentPlayer.army.length >= 2) {
          currentPlayer.exhaustedArmy.forEach((exhaustedCard, exhaustedIdx) => {
            actions.push({
              type: 'Recommission',
              army_card_idx: 0, // Simplified - would need to pick which cards to exhaust
              army_card: exhaustedCard,
            });
          });
        }

        // Add king facet changes
        GAME_CONFIG.KING_FACETS.forEach(facet => {
          if (facet !== currentPlayer.kingFacet) {
            actions.push({
              type: 'ChangeKingFacet',
              facet,
            });
          }
        });

        // End mustering
        actions.push({
          type: 'EndMuster',
        });
        break;

      case 'play':
        // Add card play actions
        const throneValue = this.getCurrentThroneValue();
        currentPlayer.hand.forEach((card, idx) => {
          const cardValue = this.state.rules.getCardValue(card);
          if (cardValue >= throneValue) {
            actions.push({
              type: 'PlayCard',
              card_idx: { type: 'Hand', idx },
              card,
              ability: null, // Simplified for now
            });
          }
        });

        // Add King flip action
        if (!currentPlayer.kingFlipped && currentPlayer.successor) {
          actions.push({
            type: 'FlipKing',
          });
        }
        break;
    }

    return actions;
  }

  // Execute an action
  executeAction(action: GameAction): boolean {
    switch (action.type) {
      case 'ChooseSignatureCards':
        const success = this.selectSignatureCards(
          this.state.currentPlayerIdx,
          action.cards.map(([, card]) => card)
        );

        if (success) {
          // Mark current player as having selected
          this.state.signatureCardsSelected[this.state.currentPlayerIdx] = true;

          // Switch to other player for their signature card selection
          this.state.currentPlayerIdx = 1 - this.state.currentPlayerIdx;

          // Check if both players have selected their signature cards
          if (this.state.signatureCardsSelected[0] && this.state.signatureCardsSelected[1]) {
            // Both players selected, start the first round
            this.startNewRound();
          }
        }

        return success;

      case 'ChangeKingFacet':
        this.state.players[this.state.currentPlayerIdx].kingFacet = action.facet;
        this.state.rules.setKingFacet(this.state.currentPlayerIdx, action.facet);
        return true;

      case 'EndMuster':
        if (this.state.phase === 'mustering') {
          const secondPlayerIdx = 1 - (this.state.firstPlayerIdx || 0);
          const firstPlayerIdx = this.state.firstPlayerIdx || 0;

          if (this.state.currentPlayerIdx === secondPlayerIdx) {
            // Second player (who musters first) finished, switch to first player
            this.state.currentPlayerIdx = firstPlayerIdx;
          } else {
            // Both players finished mustering, start play phase
            this.state.phase = 'play';
            this.state.currentPlayerIdx = firstPlayerIdx; // First player starts the round
          }
        }
        return true;

      case 'PlayCard':
        if (action.card_idx.type === 'Hand') {
          return this.playCard(this.state.currentPlayerIdx, action.card_idx.idx);
        }
        return false;

      case 'FlipKing':
        return this.flipKing(this.state.currentPlayerIdx);

      default:
        return false;
    }
  }

  // Check if game is over
  isGameOver(): boolean {
    return this.state.phase === 'game_over' ||
           this.state.players.some(player => player.points >= GAME_CONFIG.POINTS_TO_WIN);
  }

  // Get winner
  getWinner(): Player | null {
    if (!this.isGameOver()) return null;

    const [p1, p2] = this.state.players;
    if (p1.points >= GAME_CONFIG.POINTS_TO_WIN) return p1;
    if (p2.points >= GAME_CONFIG.POINTS_TO_WIN) return p2;

    return null;
  }

  // Convert to API-compatible GameBoard format
  toGameBoard(forPlayerIdx: number): GameBoard {
    const player = this.state.players[forPlayerIdx];
    const opponent = this.state.players[1 - forPlayerIdx];

    return {
      fake: false,
      reveal_everything: false,
      player_idx: forPlayerIdx,
      points: [this.state.players[0].points, this.state.players[1].points],
      accused: [],
      randomly_discarded: [],
      dungeons: [
        player.dungeon ? [{ card: player.dungeon, flavor: 0 }] : [],
        opponent.dungeon ? [{ card: opponent.dungeon, flavor: 0 }] : [],
      ],
      court: this.state.court.map(c => ({
        card: { card: c.card, flavor: 0 },
        modifiers: {},
        disgraced: c.disgraced,
        sentry_swap: false,
        conspiracist_effect: false,
      })),
      true_king_idx: this.state.trueKingIdx,
      first_player_idx: this.state.firstPlayerIdx,
      armies: [
        this.state.players[0].army.map(card => ({
          card: { card, flavor: 0 },
          state: 'Available' as const,
          recruit: true,
          exhaust: false,
          recall: false,
          recommission: false,
          rally: false,
        })),
        this.state.players[1].army.map(card => ({
          card: { card, flavor: 0 },
          state: 'Available' as const,
          recruit: true,
          exhaust: false,
          recall: false,
          recommission: false,
          rally: false,
        })),
      ],
      replaced_by_army: [[], []],
      hand: player.hand.map(card => ({
        card: { card, flavor: 0 },
        modifiers: {},
        spec: null,
      })),
      antechamber: [],
      king_facets: [this.state.players[0].kingFacet, this.state.players[1].kingFacet],
      kings_flipped: [this.state.players[0].kingFlipped, this.state.players[1].kingFlipped],
      antechambers: [[], []],
      hands: [
        this.state.players[0].hand.map(card => ({
          card: forPlayerIdx === 0 ? { card, flavor: 0 } : 'Unknown' as any,
          modifiers: {},
          spec: null,
        })),
        this.state.players[1].hand.map(card => ({
          card: forPlayerIdx === 1 ? { card, flavor: 0 } : 'Unknown' as any,
          modifiers: {},
          spec: null,
        })),
      ],
      successors: [
        this.state.players[0].successor ? {
          card: { card: this.state.players[0].successor, flavor: 0 },
          modifiers: {},
          spec: null,
        } : null,
        this.state.players[1].successor ? {
          card: { card: this.state.players[1].successor, flavor: 0 },
          modifiers: {},
          spec: null,
        } : null,
      ],
      successors_revealed: [
        this.state.players[0].kingFacet === 'CharismaticLeader',
        this.state.players[1].kingFacet === 'CharismaticLeader',
      ],
      squires: [
        this.state.players[0].squire ? {
          card: { card: this.state.players[0].squire, flavor: 0 },
          modifiers: {},
          spec: null,
        } : null,
        this.state.players[1].squire ? {
          card: { card: this.state.players[1].squire, flavor: 0 },
          modifiers: {},
          spec: null,
        } : null,
      ],
      squires_revealed: [false, false],
      khed: null,
      thrown_assassins: [null, null],
      unseen_cards: [],
      unseen_army_card_counts: [0, 0],
      change_king_facet: this.state.phase === 'mustering' ? GAME_CONFIG.KING_FACETS : null,
      choose_signature_cards: this.state.phase === 'signature_selection' ? {
        cards: GAME_CONFIG.SIGNATURE_CARDS.map(card => ({ card, flavor: 100 })),
        count: GAME_CONFIG.SIGNATURE_CARD_COUNT,
      } : null,
      new_round: false,
      choose_whos_first: this.state.firstPlayerIdx === null && forPlayerIdx === this.state.trueKingIdx,
      flip_king: !player.kingFlipped && !!player.successor,
      fake_reaction: null,
      move_nothing_to_ante: false,
      sentry_swap: false,
      disgrace_court_cards: null,
      free_mulligan: false,
      mulligan: false,
      end_muster: this.state.phase === 'mustering',
      skip_rally: false,
      take_dungeon: null,
      card_in_hand_guess: null,
      take_successor: false,
      take_squire: false,
      choose_to_take_one_or_two: false,
      condemn_opponent_hand_card: false,
    };
  }

  // Convert to API-compatible GameStatus
  toGameStatus(): GameStatus {
    switch (this.state.phase) {
      case 'signature_selection':
        return { type: 'SelectSignatureCards' };
      case 'mustering':
        return { type: 'Muster' };
      case 'play':
        return { type: 'RegularMove' };
      case 'game_over':
        return {
          type: 'GameOver',
          points: [this.state.players[0].points, this.state.players[1].points]
        };
      default:
        return { type: 'RegularMove' };
    }
  }
}
