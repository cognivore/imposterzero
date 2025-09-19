import type { GameAction, GameBoard, GameStatus, CardName, AbilitySpec } from '../types/game.js';
import { GAME_CONFIG } from '../game/rules.js';
import { Logger } from '../utils/logger.js';

/**
 * Modern bot that works with the current engine version.
 * Handles all game statuses and actions comprehensively.
 */
export class ModernBot {
  private playerName: string;
  private logger: Logger;

  constructor(playerName: string) {
    this.playerName = playerName;
    this.logger = new Logger(`modern-bot-${playerName.toLowerCase()}.log`);
  }

  /**
   * Choose the best action based on current game state.
   * This bot uses simple heuristics but handles all game phases.
   */
  chooseAction(
    board: GameBoard,
    status: GameStatus,
    availableActions: GameAction[]
  ): GameAction | null {
    this.logger.log(`${this.playerName}: Status=${status.type}, Actions=${availableActions.length}`);

    if (availableActions.length === 0) {
      this.logger.log(`${this.playerName}: No actions available`);
      return null;
    }

    // Log available action types for debugging
    const actionTypes = availableActions.map(a => a.type).join(', ');
    this.logger.log(`${this.playerName}: Available action types: ${actionTypes}`);

    switch (status.type) {
      case 'SelectSignatureCards':
        return this.handleSignatureCardSelection(availableActions);

      case 'ChooseWhosFirst':
        return this.handleChooseWhoGoesFirst(board, availableActions);

      case 'Muster':
        return this.handleMusterPhase(board, availableActions);

      case 'PickSuccessor':
        return this.handlePickSuccessor(board, availableActions);

      case 'PickSquire':
        return this.handlePickSquire(board, availableActions);

      case 'Discard':
        return this.handleDiscard(board, availableActions);

      case 'Exhaust':
        return this.handleExhaust(availableActions);

      case 'Rally':
        return this.handleRally(availableActions);

      case 'Recall':
        return this.handleRecall(availableActions);

      case 'RegularMove':
      case 'PlayCardOfAnyValue':
        return this.handleRegularMove(board, availableActions);

      case 'Reaction':
        return this.handleReaction(availableActions);

      case 'NewRound':
        return this.handleNewRound(availableActions);

      case 'RallyOrTakeDungeon':
        return this.handleRallyOrTakeDungeon(availableActions);

      case 'RallyOrTakeSuccessor':
        return this.handleRallyOrTakeSuccessor(availableActions);

      case 'RallyOrTakeSquire':
        return this.handleRallyOrTakeSquire(availableActions);

      case 'TakeSuccessorOrSquire':
        return this.handleTakeSuccessorOrSquire(availableActions);

      case 'ChooseToTakeOneOrTwo':
        return this.handleChooseToTakeOneOrTwo(availableActions);

      case 'PickCardForSwap':
        return this.handlePickCardForSwap(availableActions);

      case 'PickForAnte':
        return this.handlePickForAnte(availableActions);

      case 'PickCardsForSentrySwap':
        return this.handlePickCardsForSentrySwap(availableActions);

      case 'PickCardsToDisgrace':
        return this.handlePickCardsToDisgrace(availableActions);

      case 'GuessCardPresence':
        return this.handleGuessCardPresence(availableActions);

      case 'CondemnOpponentHandCard':
        return this.handleCondemnOpponentHandCard(availableActions);

      case 'GetRidOfCard':
        return this.handleGetRidOfCard(availableActions);

      case 'Waiting':
        this.logger.log(`${this.playerName}: Waiting for other player`);
        return null;

      case 'GameOver':
        this.logger.log(`${this.playerName}: Game over`);
        return null;

      case 'Observing':
        this.logger.log(`${this.playerName}: Observing`);
        return null;

      default:
        // Fallback: pick first available action
        this.logger.log(`${this.playerName}: Unknown status ${(status as any).type}, picking first action`);
        return this.pickFirstAction(availableActions);
    }
  }

  private handleSignatureCardSelection(actions: GameAction[]): GameAction | null {
    const signatureAction = actions.find(a => a.type === 'ChooseSignatureCards');
    if (signatureAction && signatureAction.type === 'ChooseSignatureCards') {
      // Use the action as-is since it already has the card selection
      this.logger.log(`${this.playerName}: Selecting signature cards`);
      return signatureAction;
    }
    return this.pickFirstAction(actions);
  }

  private handleChooseWhoGoesFirst(board: GameBoard, actions: GameAction[]): GameAction | null {
    // Prefer to go first if possible
    const goFirstAction = actions.find(a =>
      a.type === 'ChooseWhosFirst' && a.player_idx === board.player_idx
    );
    if (goFirstAction) {
      this.logger.log(`${this.playerName}: Choosing to go first`);
      return goFirstAction;
    }

    // Otherwise pick any available option
    const anyChooseAction = actions.find(a => a.type === 'ChooseWhosFirst');
    if (anyChooseAction) {
      this.logger.log(`${this.playerName}: Choosing who goes first`);
      return anyChooseAction;
    }

    return this.pickFirstAction(actions);
  }

  private handleMusterPhase(board: GameBoard, actions: GameAction[]): GameAction | null {
    // Strategy: Change king facet once, maybe recruit one card, then end

    // 1. Change to Master Tactician if still on Regular
    const changeFacetActions = actions.filter(a => a.type === 'ChangeKingFacet');
    const masterTacticianAction = changeFacetActions.find(a =>
      a.type === 'ChangeKingFacet' && a.facet === 'MasterTactician'
    );
    if (masterTacticianAction) {
      this.logger.log(`${this.playerName}: Changing to Master Tactician`);
      return masterTacticianAction;
    }

    // 2. Consider recruiting if we have low-value cards
    const recruitActions = actions.filter(a => a.type === 'Recruit');
    if (recruitActions.length > 0 && board.hand.length > 6) {
      // Find lowest value card in hand
      const handValues = board.hand.map(card => this.getCardValue(card.card.card));
      const minValue = Math.min(...handValues);

      // Find highest value army card we can recruit
      const bestRecruit = recruitActions.reduce((best, action) => {
        if (action.type === 'Recruit') {
          const armyValue = this.getCardValue(action.army_card);
          if (best === null || armyValue > this.getCardValue((best as any).army_card)) {
            return action;
          }
        }
        return best;
      }, null as GameAction | null);

      if (bestRecruit && bestRecruit.type === 'Recruit') {
        const armyValue = this.getCardValue(bestRecruit.army_card);
        if (armyValue > minValue + 1) { // Only if significantly better
          this.logger.log(`${this.playerName}: Recruiting ${bestRecruit.army_card}`);
          return bestRecruit;
        }
      }
    }

    // 3. End mustering
    const endMusterAction = actions.find(a => a.type === 'EndMuster');
    if (endMusterAction) {
      this.logger.log(`${this.playerName}: Ending muster phase`);
      return endMusterAction;
    }

    return this.pickFirstAction(actions);
  }

  private handlePickSuccessor(board: GameBoard, actions: GameAction[]): GameAction | null {
    // First check if we need to discard to get to proper hand size
    const discardActions = actions.filter(a => a.type === 'Discard');
    if (discardActions.length > 0) {
      // Pick lowest value card to discard
      const lowestValueDiscard = discardActions.reduce((lowest, action) => {
        if (action.type === 'Discard' && lowest.type === 'Discard') {
          return this.getCardValue(action.card) <= this.getCardValue(lowest.card) ? action : lowest;
        }
        return action;
      });
      this.logger.log(`${this.playerName}: Discarding ${lowestValueDiscard.type === 'Discard' ? lowestValueDiscard.card : 'unknown'}`);
      return lowestValueDiscard;
    }

    // Then pick successor - prefer high-value cards
    const successorActions = actions.filter(a => a.type === 'ChooseSuccessor');
    if (successorActions.length > 0) {
      const bestSuccessor = successorActions.reduce((best, action) => {
        if (action.type === 'ChooseSuccessor' && best.type === 'ChooseSuccessor') {
          return this.getCardValue(action.card) >= this.getCardValue(best.card) ? action : best;
        }
        return action;
      });
      this.logger.log(`${this.playerName}: Choosing ${bestSuccessor.type === 'ChooseSuccessor' ? bestSuccessor.card : 'unknown'} as successor`);
      return bestSuccessor;
    }

    return this.pickFirstAction(actions);
  }

  private handlePickSquire(board: GameBoard, actions: GameAction[]): GameAction | null {
    // First handle discards if needed
    const discardActions = actions.filter(a => a.type === 'Discard');
    if (discardActions.length > 0) {
      const lowestValueDiscard = discardActions.reduce((lowest, action) => {
        if (action.type === 'Discard' && lowest.type === 'Discard') {
          return this.getCardValue(action.card) <= this.getCardValue(lowest.card) ? action : lowest;
        }
        return action;
      });
      this.logger.log(`${this.playerName}: Discarding ${lowestValueDiscard.type === 'Discard' ? lowestValueDiscard.card : 'unknown'}`);
      return lowestValueDiscard;
    }

    // Pick squire - prefer medium-value cards
    const squireActions = actions.filter(a => a.type === 'ChooseSquire' || a.type === 'PickSquire');
    if (squireActions.length > 0) {
      this.logger.log(`${this.playerName}: Picking squire`);
      return squireActions[0];
    }

    return this.pickFirstAction(actions);
  }

  private handleDiscard(board: GameBoard, actions: GameAction[]): GameAction | null {
    const discardActions = actions.filter(a => a.type === 'Discard');
    if (discardActions.length > 0) {
      // Pick lowest value card
      const lowestValueDiscard = discardActions.reduce((lowest, action) => {
        if (action.type === 'Discard' && lowest.type === 'Discard') {
          return this.getCardValue(action.card) <= this.getCardValue(lowest.card) ? action : lowest;
        }
        return action;
      });
      this.logger.log(`${this.playerName}: Discarding ${lowestValueDiscard.type === 'Discard' ? lowestValueDiscard.card : 'unknown'}`);
      return lowestValueDiscard;
    }
    return this.pickFirstAction(actions);
  }

  private handleExhaust(actions: GameAction[]): GameAction | null {
    const exhaustAction = actions.find(a => a.type === 'Exhaust');
    if (exhaustAction) {
      this.logger.log(`${this.playerName}: Exhausting army card`);
      return exhaustAction;
    }
    return this.pickFirstAction(actions);
  }

  private handleRally(actions: GameAction[]): GameAction | null {
    const rallyAction = actions.find(a => a.type === 'Rally');
    if (rallyAction) {
      this.logger.log(`${this.playerName}: Rallying army card`);
      return rallyAction;
    }

    const skipRallyAction = actions.find(a => a.type === 'SkipRally');
    if (skipRallyAction) {
      this.logger.log(`${this.playerName}: Skipping rally`);
      return skipRallyAction;
    }

    return this.pickFirstAction(actions);
  }

  private handleRecall(actions: GameAction[]): GameAction | null {
    const recallAction = actions.find(a => a.type === 'Unexhaust');
    if (recallAction) {
      this.logger.log(`${this.playerName}: Recalling army card`);
      return recallAction;
    }
    return this.pickFirstAction(actions);
  }

  private handleRegularMove(board: GameBoard, actions: GameAction[]): GameAction | null {
    // Strategy: Play highest value card that won't be beaten easily
    const playActions = actions.filter(a => a.type === 'PlayCard');

    if (playActions.length > 0) {
      // Find the highest value card we can play
      const bestPlay = playActions.reduce((best, action) => {
        if (action.type === 'PlayCard' && best.type === 'PlayCard') {
          return this.getCardValue(action.card) >= this.getCardValue(best.card) ? action : best;
        }
        return action;
      });

      this.logger.log(`${this.playerName}: Playing ${bestPlay.type === 'PlayCard' ? bestPlay.card : 'unknown'}`);
      return bestPlay;
    }

    // Handle other regular move actions
    const flipKingAction = actions.find(a => a.type === 'FlipKing');
    if (flipKingAction) {
      this.logger.log(`${this.playerName}: Flipping king`);
      return flipKingAction;
    }

    const takeSuccessorAction = actions.find(a => a.type === 'TakeSuccessor');
    if (takeSuccessorAction) {
      this.logger.log(`${this.playerName}: Taking successor`);
      return takeSuccessorAction;
    }

    const takeSquireAction = actions.find(a => a.type === 'TakeSquire');
    if (takeSquireAction) {
      this.logger.log(`${this.playerName}: Taking squire`);
      return takeSquireAction;
    }

    // IMPORTANT: Don't play EndMuster during regular play - that's not a valid regular move
    // Filter out EndMuster actions during regular play
    const validRegularActions = actions.filter(a => a.type !== 'EndMuster');
    if (validRegularActions.length > 0) {
      this.logger.log(`${this.playerName}: Playing first valid regular action: ${validRegularActions[0].type}`);
      return validRegularActions[0];
    }

    // If no valid actions, return null to pass turn
    this.logger.log(`${this.playerName}: No valid regular moves available, passing turn`);
    return null;
  }

  private handleReaction(actions: GameAction[]): GameAction | null {
    // Default to no reaction for simplicity
    const noReactionAction = actions.find(a => a.type === 'NoReaction');
    if (noReactionAction) {
      this.logger.log(`${this.playerName}: No reaction`);
      return noReactionAction;
    }

    // If no NoReaction available, pick first reaction
    const reactionAction = actions.find(a => a.type === 'Reaction');
    if (reactionAction) {
      this.logger.log(`${this.playerName}: Reacting`);
      return reactionAction;
    }

    return this.pickFirstAction(actions);
  }

  private handleNewRound(actions: GameAction[]): GameAction | null {
    const newRoundAction = actions.find(a => a.type === 'StartNewRound');
    if (newRoundAction) {
      this.logger.log(`${this.playerName}: Starting new round`);
      return newRoundAction;
    }
    return this.pickFirstAction(actions);
  }

  private handleRallyOrTakeDungeon(actions: GameAction[]): GameAction | null {
    // Prefer rally over taking dungeon
    const rallyAction = actions.find(a => a.type === 'Rally');
    if (rallyAction) {
      this.logger.log(`${this.playerName}: Rallying instead of taking dungeon`);
      return rallyAction;
    }

    const takeDungeonAction = actions.find(a => a.type === 'TakeDungeon');
    if (takeDungeonAction) {
      this.logger.log(`${this.playerName}: Taking dungeon card`);
      return takeDungeonAction;
    }

    return this.pickFirstAction(actions);
  }

  private handleRallyOrTakeSuccessor(actions: GameAction[]): GameAction | null {
    // Prefer taking successor
    const takeSuccessorAction = actions.find(a => a.type === 'TakeSuccessor');
    if (takeSuccessorAction) {
      this.logger.log(`${this.playerName}: Taking successor`);
      return takeSuccessorAction;
    }

    const rallyAction = actions.find(a => a.type === 'Rally');
    if (rallyAction) {
      this.logger.log(`${this.playerName}: Rallying instead of taking successor`);
      return rallyAction;
    }

    return this.pickFirstAction(actions);
  }

  private handleRallyOrTakeSquire(actions: GameAction[]): GameAction | null {
    // Prefer taking squire
    const takeSquireAction = actions.find(a => a.type === 'TakeSquire');
    if (takeSquireAction) {
      this.logger.log(`${this.playerName}: Taking squire`);
      return takeSquireAction;
    }

    const rallyAction = actions.find(a => a.type === 'Rally');
    if (rallyAction) {
      this.logger.log(`${this.playerName}: Rallying instead of taking squire`);
      return rallyAction;
    }

    return this.pickFirstAction(actions);
  }

  private handleTakeSuccessorOrSquire(actions: GameAction[]): GameAction | null {
    // Prefer successor over squire
    const takeSuccessorAction = actions.find(a => a.type === 'TakeSuccessor');
    if (takeSuccessorAction) {
      this.logger.log(`${this.playerName}: Taking successor`);
      return takeSuccessorAction;
    }

    const takeSquireAction = actions.find(a => a.type === 'TakeSquire');
    if (takeSquireAction) {
      this.logger.log(`${this.playerName}: Taking squire`);
      return takeSquireAction;
    }

    return this.pickFirstAction(actions);
  }

  private handleChooseToTakeOneOrTwo(actions: GameAction[]): GameAction | null {
    // Prefer taking two if available
    const takeTwoAction = actions.find(a => a.type === 'ChooseToTakeTwo');
    if (takeTwoAction) {
      this.logger.log(`${this.playerName}: Choosing to take two`);
      return takeTwoAction;
    }

    const takeOneAction = actions.find(a => a.type === 'ChooseToTakeOne');
    if (takeOneAction) {
      this.logger.log(`${this.playerName}: Choosing to take one`);
      return takeOneAction;
    }

    return this.pickFirstAction(actions);
  }

  private handlePickCardForSwap(actions: GameAction[]): GameAction | null {
    // Pick lowest value card for swap
    const swapActions = actions.filter(a => a.type === 'PickCardForSwap');
    if (swapActions.length > 0) {
      const lowestValueSwap = swapActions.reduce((lowest, action) => {
        if (action.type === 'PickCardForSwap' && lowest.type === 'PickCardForSwap') {
          return this.getCardValue(action.card) <= this.getCardValue(lowest.card) ? action : lowest;
        }
        return action;
      });
      this.logger.log(`${this.playerName}: Picking ${lowestValueSwap.type === 'PickCardForSwap' ? lowestValueSwap.card : 'unknown'} for swap`);
      return lowestValueSwap;
    }
    return this.pickFirstAction(actions);
  }

  private handlePickForAnte(actions: GameAction[]): GameAction | null {
    // Pick lowest value card for antechamber
    const anteAction = actions.find(a => a.type === 'MoveToAnte');
    if (anteAction) {
      this.logger.log(`${this.playerName}: Moving card to antechamber`);
      return anteAction;
    }

    const moveNothingAction = actions.find(a => a.type === 'MoveNothingToAnte');
    if (moveNothingAction) {
      this.logger.log(`${this.playerName}: Moving nothing to antechamber`);
      return moveNothingAction;
    }

    return this.pickFirstAction(actions);
  }

  private handlePickCardsForSentrySwap(actions: GameAction[]): GameAction | null {
    const sentrySwapAction = actions.find(a => a.type === 'SentrySwap');
    if (sentrySwapAction) {
      this.logger.log(`${this.playerName}: Performing sentry swap`);
      return sentrySwapAction;
    }
    return this.pickFirstAction(actions);
  }

  private handlePickCardsToDisgrace(actions: GameAction[]): GameAction | null {
    const disgraceAction = actions.find(a => a.type === 'Disgrace');
    if (disgraceAction) {
      this.logger.log(`${this.playerName}: Disgracing cards`);
      return disgraceAction;
    }
    return this.pickFirstAction(actions);
  }

  private handleGuessCardPresence(actions: GameAction[]): GameAction | null {
    // Random guess for simplicity
    const guessAction = actions.find(a => a.type === 'CardInHandGuess');
    if (guessAction) {
      this.logger.log(`${this.playerName}: Making card presence guess`);
      return guessAction;
    }
    return this.pickFirstAction(actions);
  }

  private handleCondemnOpponentHandCard(actions: GameAction[]): GameAction | null {
    const condemnAction = actions.find(a => a.type === 'Condemn');
    if (condemnAction) {
      this.logger.log(`${this.playerName}: Condemning opponent hand card`);
      return condemnAction;
    }
    return this.pickFirstAction(actions);
  }

  private handleGetRidOfCard(actions: GameAction[]): GameAction | null {
    // Pick lowest value card to get rid of
    const discardAction = actions.find(a => a.type === 'Discard');
    if (discardAction) {
      this.logger.log(`${this.playerName}: Getting rid of card`);
      return discardAction;
    }
    return this.pickFirstAction(actions);
  }

  private pickFirstAction(actions: GameAction[]): GameAction | null {
    if (actions.length > 0) {
      this.logger.log(`${this.playerName}: Picking first available action: ${actions[0].type}`);
      return actions[0];
    }
    return null;
  }

  private getCardValue(card: CardName): number {
    const baseValues: Record<CardName, number> = {
      'Fool': 0,
      'FlagBearer': 1,
      'Assassin': 1,
      'Stranger': 1,
      'Elder': 2,
      'Zealot': 2,
      'Aegis': 2,
      'Inquisitor': 3,
      'Ancestor': 4,
      'Informant': 4,
      'Nakturn': 4,
      'Soldier': 5,
      'Lockshift': 5,
      'Conspiracist': 5,
      'Exile': 5,
      'Warden': 6,
      'Sentry': 6,
      'Judge': 6,
      'Mystic': 6,
      'Oathbound': 7,
      'Executioner': 7,
      'KingsHand': 8,
      'Warlord': 8,
      'Princess': 9,
      'Queen': 10,

      'Arbiter': 4,
      'Bard': 4,
      'Immortal': 6,
    };

    return baseValues[card] || 0;
  }
}
