import type { CardName, KingFacet, GameAction, GameBoard, GameStatus } from '../types/game.js';
import { FragmentsOfNersettiRules, GAME_CONFIG } from './rules.js';
import { Logger } from '../utils/logger.js';

export interface Player {
  name: string;
  hand: CardName[];
  antechamber: CardName[];
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
  private logger?: Logger;

  constructor(player1Name: string, player2Name: string, logger?: Logger) {
    this.logger = logger;

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
      accused: 'Fool', // Will be set during setupSuccessorAndDungeon
      deck: [...GAME_CONFIG.BASE_DECK],
      phase: 'signature_selection',
      round: 1,
      rules: new FragmentsOfNersettiRules(),
      signatureCardsSelected: [false, false],
    };

    // Accused card will be selected during setup, don't remove it yet

    // Shuffle deck
    this.shuffleDeck();
  }


  private createPlayer(name: string): Player {
    return {
      name,
      hand: [],
      antechamber: [],
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

    this.logger?.log(`Dealing ${GAME_CONFIG.HAND_SIZE} cards to each player from deck of ${this.state.deck.length}`);

    // Deal 9 cards to each player
    for (let i = 0; i < GAME_CONFIG.HAND_SIZE * 2; i++) {
      const playerIdx = i % 2;
      if (this.state.deck.length > 0) {
        const card = this.state.deck.pop()!;
        this.state.players[playerIdx].hand.push(card);
      }
    }

    this.logger?.log(`After dealing - Player 1 hand: ${this.state.players[0].hand.length} cards, Player 2 hand: ${this.state.players[1].hand.length} cards`);
    this.logger?.log(`Player 1 hand: ${this.state.players[0].hand.join(', ')}`);
    this.logger?.log(`Player 2 hand: ${this.state.players[1].hand.join(', ')}`);
  }

  private setupSuccessorAndDungeon(): void {
    // Each player chooses Successor and Dungeon from their hand
    this.state.players.forEach((player, idx) => {
      this.logger?.log(`Setting up Successor and Dungeon for Player ${idx + 1}`);

      if (player.hand.length > 0) {
        // Auto-select highest card as successor (players would choose in real game)
        const successorIdx = player.hand.findIndex(card =>
          this.state.rules.getCardValue(card) >= 5
        );
        if (successorIdx >= 0) {
          player.successor = player.hand.splice(successorIdx, 1)[0];
          this.logger?.log(`Player ${idx + 1}: Selected ${player.successor} as Successor`);
        } else if (player.hand.length > 0) {
          // If no high card, take any card as successor
          player.successor = player.hand.splice(0, 1)[0];
          this.logger?.log(`Player ${idx + 1}: Selected ${player.successor} as Successor (no high cards)`);
        }

        // Auto-select another card as dungeon (face-down discard)
        if (player.hand.length > 0) {
          player.dungeon = player.hand.splice(0, 1)[0];
          this.logger?.log(`Player ${idx + 1}: Selected ${player.dungeon} as Dungeon (face-down)`);
        }

        // Master Tactician needs a Squire
        if (player.kingFacet === 'MasterTactician' && player.hand.length > 0) {
          player.squire = player.hand.splice(0, 1)[0];
          this.state.rules.setSquire(idx, player.squire);
          this.logger?.log(`Player ${idx + 1}: Selected ${player.squire} as Squire (Master Tactician)`);
        }
      }

      this.logger?.log(`Player ${idx + 1}: Final hand size after setup: ${player.hand.length} cards`);
    });

    // Select accused card (face-up, set aside, can be swapped with Warden)
    if (this.state.deck.length > 0) {
      // Remove accused card from deck randomly
      const accusedIdx = Math.floor(Math.random() * this.state.deck.length);
      this.state.accused = this.state.deck.splice(accusedIdx, 1)[0];
      this.logger?.log(`Accused card selected: ${this.state.accused} (face-up, set aside, removed from deck)`);
      this.logger?.log(`Remaining deck size: ${this.state.deck.length} cards`);
    }
  }

  // Stage 2: Mustering Phase
  startMusteringPhase(): void {
    this.state.phase = 'mustering';
    // Start with player going second (they muster first)
    this.state.currentPlayerIdx = 1 - (this.state.firstPlayerIdx || 0);
  }

  // Recruit: Remove card from hand, take card from army, exhaust another army card
  recruit(playerIdx: number, handCardIdx: number, armyCardIdx: number, exhaustArmyCardIdx?: number): boolean {
    const player = this.state.players[playerIdx];

    if (handCardIdx >= player.hand.length || armyCardIdx >= player.army.length) {
      this.logger?.log(`Recruit failed: invalid indices. Hand: ${handCardIdx}/${player.hand.length}, Army: ${armyCardIdx}/${player.army.length}`);
      return false;
    }

    // Remove card from hand (discard to dungeon)
    const discarded = player.hand.splice(handCardIdx, 1)[0];
    this.logger?.log(`Player ${playerIdx + 1}: Discarded ${discarded} from hand`);

    // Take card from army
    const recruited = player.army.splice(armyCardIdx, 1)[0];
    player.hand.push(recruited);
    this.logger?.log(`Player ${playerIdx + 1}: Recruited ${recruited} from army to hand`);

    // Must exhaust another army card (different from recruited)
    let exhaustCardIdx = exhaustArmyCardIdx;
    if (exhaustCardIdx === undefined || exhaustCardIdx === armyCardIdx || exhaustCardIdx >= player.army.length) {
      // Find a different card to exhaust
      exhaustCardIdx = player.army.findIndex((card, idx) => idx !== armyCardIdx);
    }

    if (exhaustCardIdx >= 0 && exhaustCardIdx < player.army.length) {
      const exhausted = player.army.splice(exhaustCardIdx, 1)[0];
      player.exhaustedArmy.push(exhausted);
      this.logger?.log(`Player ${playerIdx + 1}: Exhausted ${exhausted} from army`);
    } else {
      this.logger?.log(`Player ${playerIdx + 1}: No army card available to exhaust`);
    }

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
  playCard(playerIdx: number, handCardIdx: number, fromAntechamber: boolean = false): boolean {
    const player = this.state.players[playerIdx];
    const opponent = this.state.players[1 - playerIdx];

    const sourceCards = fromAntechamber ? player.antechamber : player.hand;

    if (handCardIdx >= sourceCards.length) {
      return false;
    }

    const card = sourceCards[handCardIdx];
    const currentThroneValue = this.getCurrentThroneValue();
    const cardValue = this.state.rules.getCardValue(card);

    // Check if card can be played (equal or higher value, or from antechamber which ignores value)
    if (!fromAntechamber && cardValue < currentThroneValue) {
      return false;
    }

    // Remove from source and add to court
    sourceCards.splice(handCardIdx, 1);
    this.state.court.push({
      card,
      playerIdx,
      disgraced: false,
    });

    this.logger?.log(`Player ${playerIdx + 1}: Played ${card} ${fromAntechamber ? 'from Antechamber' : 'from Hand'} (value ${cardValue})`);

    // Trigger card ability
    this.triggerCardAbility(card, playerIdx, opponent);

    // Switch to next player
    this.state.currentPlayerIdx = 1 - this.state.currentPlayerIdx;

    return true;
  }

  // Trigger card abilities
  private triggerCardAbility(card: CardName, playerIdx: number, opponent: Player): void {
    this.logger?.log(`Triggering ability for ${card}`);

    switch (card) {
      case 'Inquisitor':
        this.triggerInquisitorAbility(playerIdx, opponent);
        break;

      case 'Judge':
        this.triggerJudgeAbility(playerIdx);
        break;

      case 'Warden':
        this.triggerWardenAbility(playerIdx, opponent);
        break;

      // Add more abilities as needed
      default:
        this.logger?.log(`No ability implemented for ${card}`);
    }
  }

  private triggerInquisitorAbility(playerIdx: number, opponent: Player): void {
    // Inquisitor: Say a card name. If opponent has it in hand, they put it in antechamber
    // For bot testing, we'll have the bot "guess" a card not visible to them

    const visibleCards = new Set<CardName>();

    // Add cards visible to current player
    visibleCards.add(this.state.accused);
    this.state.court.forEach(c => visibleCards.add(c.card));
    this.state.players[playerIdx].hand.forEach(c => visibleCards.add(c));

    // Bot guesses a card they haven't seen
    const allPossibleCards = [...GAME_CONFIG.BASE_DECK, ...GAME_CONFIG.SIGNATURE_CARDS];
    const unseenCards = allPossibleCards.filter(card => !visibleCards.has(card));

    if (unseenCards.length > 0) {
      const guessedCard = unseenCards[Math.floor(Math.random() * unseenCards.length)];
      this.logger?.log(`Player ${playerIdx + 1}: Inquisitor ability - guessing ${guessedCard}`);

      // Check if opponent has the guessed card
      const opponentHasCard = opponent.hand.includes(guessedCard);

      if (opponentHasCard) {
        // Move card from opponent's hand to their antechamber
        const cardIdx = opponent.hand.indexOf(guessedCard);
        const movedCard = opponent.hand.splice(cardIdx, 1)[0];
        opponent.antechamber.push(movedCard);

        this.logger?.log(`Player ${(1 - playerIdx) + 1}: Has ${guessedCard}! Moved to antechamber`);
      } else {
        this.logger?.log(`Player ${(1 - playerIdx) + 1}: Does not have ${guessedCard}`);
      }
    }
  }

  private triggerJudgeAbility(playerIdx: number): void {
    // Judge: Put a card from hand to antechamber
    const player = this.state.players[playerIdx];

    if (player.hand.length > 0) {
      // For bot, put lowest value card in antechamber
      let lowestIdx = 0;
      let lowestValue = this.state.rules.getCardValue(player.hand[0]);

      for (let i = 1; i < player.hand.length; i++) {
        const value = this.state.rules.getCardValue(player.hand[i]);
        if (value < lowestValue) {
          lowestValue = value;
          lowestIdx = i;
        }
      }

      const movedCard = player.hand.splice(lowestIdx, 1)[0];
      player.antechamber.push(movedCard);

      this.logger?.log(`Player ${playerIdx + 1}: Judge ability - moved ${movedCard} to antechamber`);
    }
  }

  private triggerWardenAbility(playerIdx: number, opponent: Player): void {
    // Warden: If there are 3+ court cards including Warden, may swap with accused
    if (this.state.court.length >= 3) {
      // For bot, always swap if beneficial
      const currentCard = this.state.court[this.state.court.length - 1].card;
      const accusedValue = this.state.rules.getCardValue(this.state.accused);
      const currentValue = this.state.rules.getCardValue(currentCard);

      if (accusedValue > currentValue) {
        // Swap with accused
        this.state.court[this.state.court.length - 1].card = this.state.accused;
        this.state.accused = currentCard;

        this.logger?.log(`Player ${playerIdx + 1}: Warden ability - swapped ${currentCard} with accused ${this.state.accused}`);
      } else {
        this.logger?.log(`Player ${playerIdx + 1}: Warden ability - chose not to swap`);
      }
    }
  }

  // Flip King to take Successor
  flipKing(playerIdx: number): boolean {
    const player = this.state.players[playerIdx];

    if (player.kingFlipped || !player.successor) {
      return false;
    }

    // Check for Assassin reactions before flipping
    const opponentIdx = 1 - playerIdx;
    const opponent = this.state.players[opponentIdx];

    // Check if opponent has Assassin in hand and can react
    const hasAssassin = opponent.hand.includes('Assassin');
    if (hasAssassin) {
      // Assassin reaction - opponent wins immediately
      const assassinatorKingFlipped = opponent.kingFlipped;
      const points = assassinatorKingFlipped ? 2 : 3;

      opponent.points += points;
      this.state.phase = 'game_over';

      this.logger?.log(`Assassin reaction! Player ${opponentIdx + 1} wins ${points} points`);
      return true;
    }

    // No Assassin reaction, proceed with king flip
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
    const loserIdx = this.state.currentPlayerIdx;
    const winnerIdx = 1 - loserIdx;
    const winner = this.state.players[winnerIdx];
    const loser = this.state.players[loserIdx];

    // Calculate points: 1 + 1 + 1 system
    let points = 1; // Base point for winning

    // +1 if winner's king isn't flipped
    if (!winner.kingFlipped) {
      points += 1;
    }

    // +1 if loser had cards in hand or successor and king not flipped
    if ((loser.hand.length > 0 || (loser.successor !== null && !loser.kingFlipped))) {
      points += 1;
    }

    winner.points += points;

    this.logger?.log(`Round ended. Player ${winnerIdx + 1} wins ${points} points. Score: ${this.state.players[0].points}-${this.state.players[1].points}`);

    // Check for game over
    if (winner.points >= GAME_CONFIG.POINTS_TO_WIN) {
      this.state.phase = 'game_over';
      return;
    }

    // Prepare for next round
    this.prepareNextRound();
  }

  private prepareNextRound(): void {
    this.logger?.log('=== PREPARING NEXT ROUND ===');

    // Exhaust all recruited/rallied cards that came from army
    this.state.players.forEach((player, idx) => {
      // Cards that were recruited from army go to exhausted zone
      const armyCards = [...GAME_CONFIG.BASE_ARMY, ...player.army, ...player.exhaustedArmy];
      const recruitedCards = player.hand.filter(card =>
        !GAME_CONFIG.BASE_DECK.includes(card) || armyCards.includes(card)
      );

      // Move recruited army cards to exhausted
      recruitedCards.forEach(card => {
        const handIdx = player.hand.indexOf(card);
        if (handIdx >= 0) {
          player.hand.splice(handIdx, 1);
          player.exhaustedArmy.push(card);
        }
      });

      this.logger?.log(`Player ${idx + 1}: Moved ${recruitedCards.length} recruited cards to exhausted zone: ${recruitedCards.join(', ')}`);
      this.logger?.log(`Player ${idx + 1}: Exhausted army now has ${player.exhaustedArmy.length} cards`);
    });

    // Reset for next round
    this.state.round++;
    this.state.court = [];
    this.state.phase = 'mustering';
    this.state.signatureCardsSelected = [true, true]; // Signature cards persist across rounds

    this.logger?.log(`Starting Round ${this.state.round}`);

    // Shuffle remaining deck with discarded cards
    this.reshuffleDeck();
  }

  private reshuffleDeck(): void {
    // Add all cards back to deck except army cards and accused card
    this.state.deck = [...GAME_CONFIG.BASE_DECK].filter(card => card !== this.state.accused);
    this.logger?.log(`Reshuffled deck: ${this.state.deck.length} cards (excluded accused: ${this.state.accused})`);
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
        // Add card play actions from hand
        const throneValue = this.getCurrentThroneValue();
        currentPlayer.hand.forEach((card, idx) => {
          const cardValue = this.state.rules.getCardValue(card);
          if (cardValue >= throneValue) {
            actions.push({
              type: 'PlayCard',
              card_idx: { type: 'Hand', idx },
              card,
              ability: null,
            });
          }
        });

        // Add card play actions from antechamber (ignores value requirement)
        currentPlayer.antechamber.forEach((card, idx) => {
          actions.push({
            type: 'PlayCard',
            card_idx: { type: 'Antechamber', idx },
            card,
            ability: null,
          });
        });

        // Add King flip action if player can't play any cards
        const canPlayFromHand = currentPlayer.hand.some(card =>
          this.state.rules.getCardValue(card) >= throneValue
        );
        const canPlayFromAntechamber = currentPlayer.antechamber.length > 0;

        if (!canPlayFromHand && !canPlayFromAntechamber && !currentPlayer.kingFlipped && currentPlayer.successor) {
          actions.push({
            type: 'FlipKing',
          });
        }

        // If player can't play and can't flip king, they lose the round
        if (!canPlayFromHand && !canPlayFromAntechamber && (currentPlayer.kingFlipped || !currentPlayer.successor)) {
          // End the round - current player loses
          this.endRound();
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
          return this.playCard(this.state.currentPlayerIdx, action.card_idx.idx, false);
        } else if (action.card_idx.type === 'Antechamber') {
          return this.playCard(this.state.currentPlayerIdx, action.card_idx.idx, true);
        }
        return false;

      case 'Recruit':
        if (action.type === 'Recruit') {
          // Find the card in army and a card in hand to discard
          const player = this.state.players[this.state.currentPlayerIdx];
          const armyCardIdx = player.army.findIndex(card => card === action.army_card);
          const handCardIdx = 0; // Discard first card for simplicity

          if (armyCardIdx >= 0 && handCardIdx < player.hand.length) {
            return this.recruit(this.state.currentPlayerIdx, handCardIdx, armyCardIdx);
          }
        }
        return false;

      case 'FlipKing':
        return this.flipKing(this.state.currentPlayerIdx);

      default:
        this.logger?.log(`Unhandled action type: ${action.type}`);
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
      accused: [{
        card: { card: this.state.accused, flavor: 0 },
        modifiers: {},
        spec: null,
      }],
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
      antechamber: player.antechamber.map(card => ({
        card: { card, flavor: 0 },
        modifiers: {},
        spec: null,
      })),
      king_facets: [this.state.players[0].kingFacet, this.state.players[1].kingFacet],
      kings_flipped: [this.state.players[0].kingFlipped, this.state.players[1].kingFlipped],
      antechambers: [
        this.state.players[0].antechamber.map(card => ({
          card: forPlayerIdx === 0 ? { card, flavor: 0 } : 'Unknown' as any,
          modifiers: {},
          spec: null,
        })),
        this.state.players[1].antechamber.map(card => ({
          card: forPlayerIdx === 1 ? { card, flavor: 0 } : 'Unknown' as any,
          modifiers: {},
          spec: null,
        })),
      ],
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
