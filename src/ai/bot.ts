import type { GameAction, GameBoard, GameStatus, CardName } from '../types/game.js';
import { GAME_CONFIG } from '../game/rules.js';
import { Logger } from '../utils/logger.js';

export class SimpleBot {
  private playerName: string;
  private logger: Logger;

  constructor(playerName: string) {
    this.playerName = playerName;
    this.logger = new Logger(`bot-${playerName.toLowerCase()}.log`);
  }

  // Choose signature cards - pick first 3 available
  chooseSignatureCards(availableCards: CardName[]): [number, CardName][] {
    this.logger.log(`${this.playerName}: Choosing signature cards from ${availableCards.length} options`);

    // Pick first 3 cards for simplicity
    const selected: [number, CardName][] = [
      [0, availableCards[0]],
      [1, availableCards[1]],
      [2, availableCards[2]]
    ];

    this.logger.log(`${this.playerName}: Selected signature cards: ${selected.map(([, card]) => card).join(', ')}`);
    return selected;
  }

  // Mustering strategy: recruit highest value card for lowest hand card
  chooseMusteringAction(
    board: GameBoard,
    availableActions: GameAction[]
  ): GameAction | null {
    this.logger.log(`${this.playerName}: Choosing mustering action from ${availableActions.length} options`);

    const recruitActions = availableActions.filter(a => a.type === 'Recruit');
    const endMusterActions = availableActions.filter(a => a.type === 'EndMuster');
    const changeFacetActions = availableActions.filter(a => a.type === 'ChangeKingFacet');

    // Strategy:
    // 1. First recruit ONE highest value army card if we have low cards
    // 2. Then change king facet ONCE if beneficial
    // 3. Then end mustering

    // Only recruit if we have a clear benefit and haven't recruited much yet
    if (recruitActions.length > 0 && board.hand.length > 0 && board.hand.length < 7) {
      // Find lowest card in hand
      const handValues = board.hand.map(card => this.getCardValue(card.card.card));
      const minHandValue = Math.min(...handValues);

      // Find highest value army card we can recruit
      let bestRecruitAction: GameAction | null = null;
      let bestArmyValue = 0;

      for (const action of recruitActions) {
        if (action.type === 'Recruit') {
          const armyValue = this.getCardValue(action.army_card);
          if (armyValue > bestArmyValue && armyValue > minHandValue + 2) { // Only if significantly better
            bestArmyValue = armyValue;
            bestRecruitAction = action;
          }
        }
      }

      if (bestRecruitAction) {
        this.logger.log(`${this.playerName}: Recruiting ${bestRecruitAction.type === 'Recruit' ? bestRecruitAction.army_card : 'unknown'} (value ${bestArmyValue}) to replace low card (value ${minHandValue})`);
        return bestRecruitAction;
      }
    }

    // Change king facet ONCE if we're still on Regular and have good options
    if (changeFacetActions.length > 0 && board.king_facets[board.player_idx] === 'Regular') {
      // Prefer Master Tactician for extra card advantage
      const masterTacticianAction = changeFacetActions.find(a =>
        a.type === 'ChangeKingFacet' && a.facet === 'MasterTactician'
      );
      if (masterTacticianAction) {
        this.logger.log(`${this.playerName}: Changing to Master Tactician`);
        return masterTacticianAction;
      }
    }

    // End mustering - always available and preferred when no clear benefits
    if (endMusterActions.length > 0) {
      this.logger.log(`${this.playerName}: Ending mustering phase`);
      return endMusterActions[0];
    }

    return null;
  }

  // Play strategy: prefer antechamber, then lowest possible card, avoid Assassin unless necessary
  choosePlayAction(
    board: GameBoard,
    availableActions: GameAction[]
  ): GameAction | null {
    this.logger.log(`${this.playerName}: Choosing play action from ${availableActions.length} options`);

    const playActions = availableActions.filter(a => a.type === 'PlayCard');
    const flipKingActions = availableActions.filter(a => a.type === 'FlipKing');

    if (playActions.length > 0) {
      // Separate antechamber and hand actions
      const antechamberActions = playActions.filter(a =>
        a.type === 'PlayCard' && a.card_idx.type === 'Antechamber'
      );
      const handActions = playActions.filter(a =>
        a.type === 'PlayCard' && a.card_idx.type === 'Hand'
      );

      // Prefer playing from antechamber (ignores value restrictions)
      if (antechamberActions.length > 0) {
        const action = antechamberActions[0];
        if (action.type === 'PlayCard') {
          this.logger.log(`${this.playerName}: Playing ${action.card} from Antechamber (ignores value)`);
          return action;
        }
      }

      // Otherwise play from hand - sort by value, avoid Assassin
      if (handActions.length > 0) {
        const sortedActions = handActions
          .filter(a => a.type === 'PlayCard')
          .sort((a, b) => {
            if (a.type !== 'PlayCard' || b.type !== 'PlayCard') return 0;

            const aValue = this.getCardValue(a.card);
            const bValue = this.getCardValue(b.card);

            // Strongly avoid Assassin unless no choice
            const aIsAssassin = a.card === 'Assassin';
            const bIsAssassin = b.card === 'Assassin';

            if (aIsAssassin && !bIsAssassin) return 1;
            if (!aIsAssassin && bIsAssassin) return -1;

            return aValue - bValue;
          });

        const chosenAction = sortedActions[0];
        if (chosenAction && chosenAction.type === 'PlayCard') {
          this.logger.log(`${this.playerName}: Playing ${chosenAction.card} from Hand (value ${this.getCardValue(chosenAction.card)})`);
          return chosenAction;
        }
      }
    }

    // If no cards can be played, flip king if possible
    if (flipKingActions.length > 0) {
      this.logger.log(`${this.playerName}: Flipping king to avoid losing`);
      return flipKingActions[0];
    }

    this.logger.log(`${this.playerName}: No valid actions available`);
    return null;
  }

  private getCardValue(card: CardName): number {
    const baseValues: Record<CardName, number> = {
      'Fool': 1,
      'FlagBearer': 1,
      'Assassin': 2,
      'Stranger': 2,
      'Elder': 3,
      'Zealot': 3,
      'Aegis': 3,
      'Inquisitor': 4,
      'Ancestor': 4,
      'Informant': 4,
      'Nakturn': 4,
      'Soldier': 5,
      'Judge': 5,
      'Lockshift': 5,
      'Immortal': 6,
      'Oathbound': 6,
      'Conspiracist': 6,
      'Mystic': 7,
      'Warlord': 7,
      'Warden': 7,
      'Sentry': 8,
      'KingsHand': 8,
      'Exile': 8,
      'Princess': 9,
      'Queen': 9, // Updated from 10 to 9 as per rules
    };

    return baseValues[card] || 0;
  }

  // Choose best action based on current game state
  chooseAction(
    board: GameBoard,
    status: GameStatus,
    availableActions: GameAction[]
  ): GameAction | null {
    this.logger.log(`${this.playerName}: Game status: ${status.type}, Available actions: ${availableActions.length}`);

    switch (status.type) {
      case 'SelectSignatureCards':
        const signatureAction = availableActions.find(a => a.type === 'ChooseSignatureCards');
        if (signatureAction && signatureAction.type === 'ChooseSignatureCards') {
          return {
            type: 'ChooseSignatureCards',
            cards: this.chooseSignatureCards(GAME_CONFIG.SIGNATURE_CARDS)
          };
        }
        break;

      case 'Muster':
        return this.chooseMusteringAction(board, availableActions);

      case 'RegularMove':
      case 'PlayCardOfAnyValue':
        return this.choosePlayAction(board, availableActions);

      case 'NewRound':
        const newRoundAction = availableActions.find(a => a.type === 'StartNewRound');
        if (newRoundAction) {
          this.logger.log(`${this.playerName}: Starting new round`);
          return newRoundAction;
        }
        break;

      case 'ChooseWhosFirst':
        // Choose self to go first
        const chooseFirstAction = availableActions.find(a =>
          a.type === 'ChooseWhosFirst' && a.player_idx === board.player_idx
        );
        if (chooseFirstAction) {
          this.logger.log(`${this.playerName}: Choosing to go first`);
          return chooseFirstAction;
        }
        break;

      case 'GameOver':
        this.logger.log(`${this.playerName}: Game over`);
        return null;

      default:
        this.logger.log(`${this.playerName}: Unhandled status type: ${status.type}`);
    }

    return null;
  }
}
