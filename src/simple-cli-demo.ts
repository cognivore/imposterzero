#!/usr/bin/env node

import { ScreenManager, SelectableItem } from './ui/screen.js';
import { InputManager } from './ui/input.js';
import type { GameBoard, HandCard, CourtCard, CardName } from './types/game.js';

// Create a mock game board for demonstration
function createMockGameBoard(): GameBoard {
  const mockHandCard = (card: CardName): HandCard => ({
    card: { card, flavor: 0 },
    modifiers: {}
  });

  const mockCourtCard = (card: CardName, disgraced: boolean = false): CourtCard => ({
    card: { card, flavor: 0 },
    disgraced,
    modifiers: {},
    sentry_swap: false,
    conspiracist_effect: false
  });

  return {
    fake: false,
    reveal_everything: true,
    player_idx: 0,
    points: [3, 2],
    accused: [mockHandCard('Assassin')],
    randomly_discarded: [],
    dungeons: [[], []],
    court: [
      mockCourtCard('Soldier'),
      mockCourtCard('Judge', true), // disgraced
      mockCourtCard('Queen'), // throne card
    ],
    true_king_idx: 0,
    first_player_idx: 0,
    armies: [[], []],
    replaced_by_army: [[], []],
    hand: [
      mockHandCard('Fool'),
      mockHandCard('Princess'),
      mockHandCard('Mystic'),
      mockHandCard('Elder'),
    ],
    antechamber: [],
    king_facets: ['Regular', 'Regular'],
    kings_flipped: [false, false],
    antechambers: [[], []],
    hands: [
      [
        mockHandCard('Fool'),
        mockHandCard('Princess'),
        mockHandCard('Mystic'),
        mockHandCard('Elder'),
      ],
      [
        mockHandCard('Warden'),
        mockHandCard('Sentry'),
        mockHandCard('Immortal'),
      ]
    ],
    successors: [null, null],
    successors_revealed: [false, false],
    squires: [null, null],
    squires_revealed: [false, false],
    khed: null,
    thrown_assassins: [null, null],
    unseen_cards: [],
    unseen_army_card_counts: [0, 0],
    change_king_facet: null,
    choose_signature_cards: null,
    new_round: false,
    choose_whos_first: false,
    flip_king: false,
    fake_reaction: null,
    move_nothing_to_ante: false,
    sentry_swap: false,
    disgrace_court_cards: null,
    free_mulligan: false,
    mulligan: false,
    end_muster: false,
    skip_rally: false,
    take_dungeon: null,
    card_in_hand_guess: null,
    take_successor: false,
    take_squire: false,
    choose_to_take_one_or_two: false,
    condemn_opponent_hand_card: false,
  };
}

async function runSimpleCLIDemo(): Promise<void> {
  console.log('🎮 Simple CLI Demo - Testing the DOS-style Interface');
  console.log('=' .repeat(60));
  console.log('Use ↑↓ arrow keys to navigate, ENTER to select, ESC to quit');
  console.log('');

  const screen = new ScreenManager();
  const input = new InputManager();

  let isRunning = true;

  // Handle Ctrl+C gracefully
  input.on('keypress', (key) => {
    if (key.ctrl && key.name === 'c') {
      console.log('\nDemo ended by user');
      isRunning = false;
      process.exit(0);
    }
  });

  try {
    input.startListening();

    // Create mock game data
    const mockBoard = createMockGameBoard();
    const playerNames: [string, string] = ['Alice', 'Bob'];

    // Create selectable items (hand cards)
    const selectableItems: SelectableItem[] = mockBoard.hands[0].map((card, idx) => ({
      id: `hand_${idx}`,
      text: getDisplayName(card.card.card),
      description: `Base Value: ${getCardBaseValue(card.card.card)}\nA powerful card with special abilities.\nCan be played this turn.`,
      enabled: true,
      data: { cardIndex: idx, card: card.card.card }
    }));

    // Add some action items
    selectableItems.push({
      id: 'action_flip_king',
      text: 'Flip King',
      description: 'End the round by flipping your king card.\nThis will score points based on court cards.',
      enabled: true,
      data: { action: 'flip_king' }
    });

    selectableItems.push({
      id: 'action_end_turn',
      text: 'End Turn',
      description: 'Pass your turn to the opponent.\nUse this when you have no more actions.',
      enabled: true,
      data: { action: 'end_turn' }
    });

    screen.setSelectableItems(selectableItems);

    console.log('Starting interactive demo...\n');

    // Main demo loop
    while (isRunning) {
      // Draw the screen
      screen.drawGameScreen(mockBoard, 0, playerNames);

      // Wait for user input
      const key = await input.waitForNavigation();

      switch (key) {
        case 'up':
          screen.moveSelection('up');
          break;

        case 'down':
          screen.moveSelection('down');
          break;

        case 'enter':
          const selected = screen.getSelectedItem();
          if (selected) {
            if (selected.id.startsWith('hand_')) {
              // Show card dialog
              const cardName = selected.data.card as CardName;
              screen.showCardDialog(
                'Card Preview',
                cardName,
                `${selected.description}\n\nOptions:`,
                ['1. Play with ability', '2. Play without ability', '3. Cancel']
              );

              // Redraw screen with dialog
              screen.drawGameScreen(mockBoard, 0, playerNames);

              const dialogKey = await input.waitForKey(['1', '2', '3', 'escape']);
              screen.hideDialog();

              if (dialogKey.name === '1') {
                // Simulate playing the card with ability
                console.log(`\n🎯 ${getDisplayName(cardName)} played with ability!`);

                // Update the mock board to show the card was played
                const cardIndex = selected.data.cardIndex;
                mockBoard.hands[0].splice(cardIndex, 1); // Remove from hand
                mockBoard.court.push({
                  card: { card: cardName, flavor: 0 },
                  disgraced: false,
                  modifiers: {},
                  sentry_swap: false,
                  conspiracist_effect: false
                }); // Add to court

                // Update selectable items to reflect new hand
                const newSelectableItems: SelectableItem[] = mockBoard.hands[0].map((card, idx) => ({
                  id: `hand_${idx}`,
                  text: getDisplayName(card.card.card),
                  description: `Base Value: ${getCardBaseValue(card.card.card)}\nA powerful card with special abilities.\nCan be played this turn.`,
                  enabled: true,
                  data: { cardIndex: idx, card: card.card.card }
                }));

                // Re-add action items
                newSelectableItems.push({
                  id: 'action_flip_king',
                  text: 'Flip King',
                  description: 'End the round by flipping your king card.\nThis will score points based on court cards.',
                  enabled: true,
                  data: { action: 'flip_king' }
                });

                screen.setSelectableItems(newSelectableItems);

              } else if (dialogKey.name === '2') {
                console.log(`\n🎯 ${getDisplayName(cardName)} played without ability!`);

                // Same logic as above but without ability
                const cardIndex = selected.data.cardIndex;
                mockBoard.hands[0].splice(cardIndex, 1);
                mockBoard.court.push({
                  card: { card: cardName, flavor: 0 },
                  disgraced: false,
                  modifiers: {},
                  sentry_swap: false,
                  conspiracist_effect: false
                });

                const newSelectableItems: SelectableItem[] = mockBoard.hands[0].map((card, idx) => ({
                  id: `hand_${idx}`,
                  text: getDisplayName(card.card.card),
                  description: `Base Value: ${getCardBaseValue(card.card.card)}\nA powerful card with special abilities.\nCan be played this turn.`,
                  enabled: true,
                  data: { cardIndex: idx, card: card.card.card }
                }));

                newSelectableItems.push({
                  id: 'action_flip_king',
                  text: 'Flip King',
                  description: 'End the round by flipping your king card.',
                  enabled: true,
                  data: { action: 'flip_king' }
                });

                screen.setSelectableItems(newSelectableItems);
              }
            } else {
              console.log(`\n⚡ Executed action: ${selected.text}`);
              if (selected.data.action === 'flip_king') {
                console.log('👑 King flipped! Round ended.');
                mockBoard.points[0] += 2; // Award points
              }
            }
          }
          break;

        case 'escape':
          console.log('\n👋 Demo ended by user');
          isRunning = false;
          break;
      }
    }

  } catch (error) {
    console.error('Demo error:', error);
  } finally {
    input.stopListening();
    // Restore terminal
    console.clear();
    console.log('🎉 Simple CLI Demo completed!');
    console.log('');
    console.log('✅ DOS-style pseudo-GUI is working');
    console.log('✅ Card selection with Enter key navigation works');
    console.log('✅ Card preview dialogs are functional');
    console.log('✅ Arrow key navigation is responsive');
    console.log('');
    console.log('The CLI framework is ready to be integrated with the game server!');
  }
}

function getDisplayName(cardName: CardName): string {
  const nameMap: Partial<Record<CardName, string>> = {
    'Fool': 'Fool',
    'Princess': 'Princess',
    'Mystic': 'Mystic',
    'Elder': 'Elder',
    'Soldier': 'Soldier',
    'Judge': 'Judge',
    'Queen': 'Queen',
    'Warden': 'Warden',
    'Sentry': 'Sentry',
    'Immortal': 'Immortal',
    'Assassin': 'Assassin'
  };
  return nameMap[cardName] || cardName;
}

function getCardBaseValue(cardName: CardName): number {
  const baseValues: Record<string, number> = {
    'Fool': 1, 'Princess': 9, 'Mystic': 7, 'Elder': 3, 'Soldier': 5,
    'Judge': 5, 'Queen': 9, 'Warden': 7, 'Sentry': 8, 'Immortal': 6, 'Assassin': 2
  };
  return baseValues[cardName] || 0;
}

// Run demo if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runSimpleCLIDemo().catch(console.error);
}
