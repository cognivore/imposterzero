# Bot vs Bot Test Investigation Report - Post-Fix Analysis

## Current Status: Original Bug Fixed ✅, New Issue Identified

### Summary

The **original bot vs bot test bug has been completely resolved**. No more "Bot trying to discard Soldier at wrong index" errors or action rejections. However, the test now reveals a **setup phase progression deadlock** where Player 2 needs setup but the game doesn't progress properly.

## Original Bug: RESOLVED ✅

### What Was Fixed

1. **Action Generation Scoping**: Actions in `select_successor_dungeon` phase are now properly tagged with `for_player` field
2. **Server-Side Filtering**: Each client now receives only actions intended for their player
3. **Execution Guards**: Engine rejects any action where `for_player` doesn't match the sender's token
4. **State Validation**: Dev-mode assertions catch action/hand mismatches at generation time
5. **Test Robustness**: Bot test now validates chosen actions are in possible_actions before sending

### Evidence of Fix

**Before**: Bot2 would try to discard "Soldier" at index 1 when hand contained ["Warden", "Sentry", "Warlord", ...] and engine would reject with 400 Bad Request.

**After**: Bots successfully complete signature selection, mustering, and initial setup phases without any action rejections.

## Current Issue: Setup Phase Progression Deadlock

### What's Happening Now

1. **Player 1** (Bot1) successfully completes full setup: successor ✅, squire ✅, hand size ≤ 7 ✅
2. **Player 2** (Bot2) still needs setup: successor ❌, squire ❌, hand size > 7 ❌
3. **Engine correctly updates** currentPlayerIdx to Player 2
4. **Test shows Bot1** as current player with 0 actions (stale state)
5. **Game deadlocks** at turn 100 limit

### Evidence from Latest Logs

**Engine State (Correct)**:
```
DEBUG: Updated currentPlayerIdx to 1 (Player 2) who needs setup
DEBUG: Player 1 setup status - needsSuccessor: false, needsSquire: false, needsDiscards: false, hand: 5
DEBUG: Player 2 setup status - needsSuccessor: true, needsSquire: true, needsDiscards: true, hand: 9
```

**Test View (Stale)**:
```
Status: PickSuccessor
Current Player: Bot1
Available Actions: 0
Hand: Immortal, Oathbound, Princess, Oathbound, Judge
```

## Root Cause: Event State Synchronization

The issue is that the bot test receives game state events that were generated BEFORE the currentPlayerIdx update, but the test logic uses the engine's currentPlayerIdx AFTER the update. This creates a timing mismatch.

### Technical Analysis

1. **Event Generation**: `addGameStateEvent()` generates board from `currentPlayerIdx` perspective
2. **Action Execution**: Actions update `currentPlayerIdx` via `updateCurrentPlayerForSetupPhase()`
3. **Test Logic**: Test queries `getCurrentPlayerIndex()` which returns the UPDATED index
4. **State Mismatch**: Test uses updated currentPlayerIdx with stale board state

## Relevant Code Sections

### 1. Engine Setup Phase Action Generation

**File**: `src/game/engine.ts:1781-1860`

```typescript
case 'select_successor_dungeon':
  // During setup phase, ANY player can make their choices in any order
  // Generate actions for ALL players who still need to complete setup

  // First, find a player who needs setup and set them as current player
  let playerNeedingSetup = -1;
  for (let i = 0; i < this.state.players.length; i++) {
    const player = this.state.players[i];
    const needsSuccessor = player.successor === null;
    const needsSquire = player.kingFacet === 'MasterTactician' && player.squire === null;
    const needsDiscards = player.hand.length > 7;

    if (needsSuccessor || needsSquire || needsDiscards) {
      playerNeedingSetup = i;
      break;
    }
  }

  // Update currentPlayerIdx to point to a player who needs setup
  if (playerNeedingSetup >= 0) {
    this.state.currentPlayerIdx = playerNeedingSetup;
  }

  this.state.players.forEach((player, playerIdx) => {
    const needsSuccessor = player.successor === null;
    const needsSquire = player.kingFacet === 'MasterTactician' && player.squire === null;
    const needsDiscards = player.hand.length > 7; // Players need to get down to 7 cards

    this.logger?.log(`DEBUG: Player ${playerIdx + 1} setup status - needsSuccessor: ${needsSuccessor}, needsSquire: ${needsSquire}, needsDiscards: ${needsDiscards}, hand: ${player.hand.length}, kingFacet: "${player.kingFacet}"`);

    if (!needsSuccessor && !needsSquire && !needsDiscards) {
      // This player is completely done
      return;
    }

    // Allow discarding if player has too many cards
    if (needsDiscards && player.hand.length > 0) {
      for (let cardIdx = 0; cardIdx < player.hand.length; cardIdx++) {
        const card = player.hand[cardIdx]; // always use the live hand index here
        actions.push({
          type: 'Discard',
          card_idx: cardIdx,
          card,
          for_player: playerIdx as 0 | 1,        // <— FIXED
        });
      }
    }

    // Allow choosing successor if ready (hand size <= 8)
    if (needsSuccessor && player.hand.length <= 8 && player.hand.length > 0) {
      for (let cardIdx = 0; cardIdx < player.hand.length; cardIdx++) {
        const card = player.hand[cardIdx];
        actions.push({
          type: 'ChooseSuccessor',
          card_idx: cardIdx,
          card,
          for_player: playerIdx as 0 | 1,        // <— FIXED
        });
      }
    }

    // Allow choosing squire if Master Tactician has successor
    if (needsSquire && player.successor !== null && player.hand.length > 0) {
      for (let cardIdx = 0; cardIdx < player.hand.length; cardIdx++) {
        const card = player.hand[cardIdx];
        actions.push({
          type: 'PickSquire',
          card_idx: cardIdx,
          card,
          for_player: playerIdx as 0 | 1,        // <— FIXED
        } as any);
      }
    }
  });

  // Add dev-only assertion to catch action/hand mismatches
  this._assertSetupActionsMatchHands(actions);

  // Important: Don't limit actions by currentPlayerIdx during setup phase!
  break;
```

**Status**: ✅ FIXED - Actions now properly tagged and scoped

### 2. Action Execution with Player Updates

**File**: `src/game/engine.ts:2802-2831`

```typescript
case 'ChooseSuccessor':
  if (action.type === 'ChooseSuccessor' && this.state.phase === 'select_successor_dungeon') {
    const player = this.state.players[effectivePlayerIdx]; // Use acting player
    const handCardIdx = action.card_idx;

    if (handCardIdx >= 0 && handCardIdx < player.hand.length && player.hand[handCardIdx] === action.card) {
      // Set successor
      player.successor = player.hand.splice(handCardIdx, 1)[0];
      this.logger?.log(`Player ${effectivePlayerIdx + 1}: Selected ${player.successor} as successor`);

      // Update currentPlayerIdx to point to a player who still needs setup
      this.updateCurrentPlayerForSetupPhase();

      // Check if both players have completed setup (successors + squires if needed)
      const allPlayersReady = this.state.players.every(p => {
        const hasSuccessor = p.successor !== null;
        const needsSquire = p.kingFacet === 'MasterTactician';
        const hasSquire = p.squire !== null;

        this.logger?.log(`DEBUG: Player ${this.state.players.indexOf(p) + 1} ready check - successor: ${hasSuccessor}, needsSquire: ${needsSquire}, hasSquire: ${hasSquire}, kingFacet: "${p.kingFacet}"`);

        return hasSuccessor && (!needsSquire || hasSquire);
      });

      if (allPlayersReady) {
        // All setup complete, start play phase
        this.logger?.log(`All players have completed setup, transitioning to play phase`);
        this.state.phase = 'play';
        this.state.currentPlayerIdx = this.state.firstPlayerIdx || 0;
      }

      return true;
    }
  }
  return false;
```

**Status**: ✅ FIXED - CurrentPlayerIdx properly updated after actions

### 3. CurrentPlayerIdx Update Logic

**File**: `src/game/engine.ts:169-205`

```typescript
// Update currentPlayerIdx to point to a player who still needs setup during setup phases
private updateCurrentPlayerForSetupPhase(): void {
  if (this.state.phase !== 'select_successor_dungeon') return;

  // Check if current player still needs setup
  const currentPlayer = this.state.players[this.state.currentPlayerIdx];
  const currentNeedsSuccessor = currentPlayer.successor === null;
  const currentNeedsSquire = currentPlayer.kingFacet === 'MasterTactician' && currentPlayer.squire === null;
  const currentNeedsDiscards = currentPlayer.hand.length > 7;

  if (currentNeedsSuccessor || currentNeedsSquire || currentNeedsDiscards) {
    // Current player still needs setup, keep them
    this.logger?.log(`DEBUG: Current player ${this.state.currentPlayerIdx} (Player ${this.state.currentPlayerIdx + 1}) still needs setup`);
    return;
  }

  // Current player is done, find another player who needs setup
  for (let i = 0; i < this.state.players.length; i++) {
    if (i === this.state.currentPlayerIdx) continue; // Skip current player, they're done

    const player = this.state.players[i];
    const needsSuccessor = player.successor === null;
    const needsSquire = player.kingFacet === 'MasterTactician' && player.squire === null;
    const needsDiscards = player.hand.length > 7;

    if (needsSuccessor || needsSquire || needsDiscards) {
      this.state.currentPlayerIdx = i;
      this.logger?.log(`DEBUG: Updated currentPlayerIdx to ${i} (Player ${i + 1}) who needs setup`);
      return;
    }
  }

  // If no player needs setup, all setup is complete - transition to play phase
  this.logger?.log(`DEBUG: All players completed setup, transitioning to play phase`);
  this.state.phase = 'play';
  this.state.currentPlayerIdx = this.state.firstPlayerIdx || 0;
}
```

**Status**: ✅ IMPLEMENTED - Logic correctly switches currentPlayerIdx

### 4. Server Action Filtering

**File**: `src/game/localService.ts:131-170`

```typescript
getEvents(gameId: number, playerToken: string, startIndex: number): GameEvent[] {
  const game = this.games.get(gameId);
  if (!game) return [];

  const player = game.players.find(p => p?.token === playerToken);
  if (!player) return [];

  const events = game.events.slice(startIndex);

  // Filter actions in NewState events to show only actions for this viewer
  const viewerIdx = this.getPlayerIndex(gameId, playerToken);
  if (viewerIdx !== null) {
    return events.map(event => {
      if (event.type === 'NewState') {
        const filteredActions = event.actions.filter(a =>
          a.for_player === undefined || a.for_player === viewerIdx
        );

        // During setup phases, regenerate the board from this viewer's perspective
        const gameState = game.engine.getGameState();
        if (gameState.phase === 'select_successor_dungeon') {
          const viewerBoard = game.engine.toGameBoard(viewerIdx);
          return {
            ...event,
            board: viewerBoard,
            actions: filteredActions
          };
        }

        return {
          ...event,
          actions: filteredActions
        };
      }
      return event;
    });
  }

  return events;
}
```

**Status**: ✅ IMPLEMENTED - Actions filtered per viewer, board regenerated for setup phases

### 5. Execution Guard

**File**: `src/game/engine.ts:2320-2324`

```typescript
// Execution-time guard: reject any action whose for_player doesn't match the sender's token
if ('for_player' in action && action.for_player !== undefined && action.for_player !== effectivePlayerIdx) {
  this.logger?.log(`ERROR: Action actor mismatch: token=${effectivePlayerIdx} tried to send action for ${action.for_player}`);
  return false;
}
```

**Status**: ✅ IMPLEMENTED - Prevents cross-player action execution

### 6. Bot Test Fail-Fast Validation

**File**: `src/test/bot-vs-bot.test.ts:194-213`

```typescript
// Fail-fast validation: verify the chosen action is present in possible_actions
const actionFound = actions.some(a => JSON.stringify(a) === JSON.stringify(chosenAction));
if (!actionFound) {
  this.logger.error(`FAIL-FAST: ${botName} chose action not in possible_actions`);
  this.logger.error(`Chosen action: ${JSON.stringify(chosenAction)}`);
  this.logger.error(`Hand: ${board.hand.map(c => c.card.card).join(', ')}`);
  this.logger.error(`Available actions: ${JSON.stringify(actions, null, 2)}`);
  throw new Error(`Bot chose invalid action: ${JSON.stringify(chosenAction)}`);
}

try {
  await currentClient.sendAction(this.gameId, currentToken, currentEvents.length, chosenAction);
  this.gameLogger.log(`✅ ${botName} action sent successfully`);
} catch (error) {
  this.logger.error(`Failed to send ${botName} action`, error as Error);
  this.logger.error(`Action was: ${JSON.stringify(chosenAction)}`);
  this.logger.error(`Hand was: ${board.hand.map(c => c.card.card).join(', ')}`);
  this.logger.error(`Available actions were: ${JSON.stringify(actions, null, 2)}`);
  throw error;
}
```

**Status**: ✅ IMPLEMENTED - Test now fails fast with detailed diagnostics

## Current Issue: Event State Synchronization

### The Problem

The engine correctly updates `currentPlayerIdx` during action execution, but the bot test receives game state events that were generated BEFORE the update. This creates a timing mismatch where:

1. Engine executes action and updates currentPlayerIdx to Player 2
2. Test queries `getCurrentPlayerIndex()` and gets Player 2
3. But test uses game board from events that show Player 1 perspective
4. Player 1 has no actions (they're done with setup) → deadlock

### Technical Root Cause

**Event Generation Timing**: `addGameStateEvent()` is called in `sendAction()` after action execution, but it uses the engine state from the time the event is generated, not from the player's perspective who will receive it.

**File**: `src/game/localService.ts:289-302`

```typescript
private addGameStateEvent(game: LocalGame): void {
  const currentPlayerIdx = game.engine.getGameState().currentPlayerIdx;
  const gameBoard = game.engine.toGameBoard(currentPlayerIdx);  // Uses engine's currentPlayerIdx
  const gameStatus = game.engine.toGameStatus();
  const possibleActions = game.engine.getPossibleActions();

  game.events.push({
    type: 'NewState',
    board: gameBoard,      // Board from engine's perspective
    status: gameStatus,
    actions: possibleActions,  // Actions for all players (filtered later)
    reset_ui: false,
  });
}
```

### Partial Fix Applied

I added logic to regenerate the board from the viewer's perspective during setup phases:

```typescript
// During setup phases, regenerate the board from this viewer's perspective
const gameState = game.engine.getGameState();
if (gameState.phase === 'select_successor_dungeon') {
  const viewerBoard = game.engine.toGameBoard(viewerIdx);
  return {
    ...event,
    board: viewerBoard,     // Board from viewer's perspective
    actions: filteredActions
  };
}
```

**Status**: ✅ PARTIALLY FIXED - Board perspective corrected for setup phases

## Remaining Issue: Setup Phase Transition Logic

The core issue is that the setup phase allows "ANY player to act in any order" but the bot test expects a traditional turn-based flow. The engine's currentPlayerIdx switching logic conflicts with the test's expectation of whose turn it is.

### Current Behavior

1. Player 1 completes setup → engine switches currentPlayerIdx to Player 2
2. Test still sees Player 1 as current player due to stale event state
3. Player 1 has 0 actions (correctly filtered) → test deadlocks

### The Design Conflict

**Engine Design**: Multi-actor setup phase where any player can act when they need setup
**Test Design**: Turn-based flow expecting the "current player" to always have actions

## Impact Assessment

### What's Working ✅

1. **Original Bug Resolved**: No more action generation/validation mismatches
2. **Security Hardened**: Impossible to execute actions for wrong player
3. **State Integrity**: Actions always match the player's actual hand
4. **Test Validation**: Comprehensive error reporting and fail-fast behavior
5. **Setup Actions**: Players can successfully complete their individual setup steps

### What's Not Working ❌

1. **Setup Phase Flow**: Game doesn't progress when one player finishes setup before the other
2. **Turn Management**: Test expects traditional turns but setup phase uses multi-actor model
3. **Event Synchronization**: Stale state in events vs updated engine state

## Recommendations

### Immediate Fix Options

1. **Option A - Fix Event Timing**: Ensure `addGameStateEvent()` is called after all currentPlayerIdx updates
2. **Option B - Redesign Setup Flow**: Make setup phase strictly turn-based instead of multi-actor
3. **Option C - Fix Test Logic**: Update test to handle multi-actor setup phases correctly

### Long-term Improvements

1. **Event State Consistency**: Ensure events always reflect the current engine state
2. **Setup Phase Clarity**: Document and enforce the multi-actor vs turn-based design choice
3. **Test Coverage**: Add specific tests for setup phase edge cases

## Success Metrics

✅ **Original Action Bug**: Completely resolved
✅ **State Security**: Hardened against cross-player actions
✅ **Test Robustness**: Enhanced error reporting and validation
❌ **Setup Flow**: Still deadlocks due to event synchronization timing

The fixes have successfully resolved the critical action generation bug and significantly improved the system's robustness. The remaining issue is a setup phase flow design problem that requires a targeted fix to the event timing or setup phase logic.

## Simultaneous Succession Phase

### Design Intent: Simultaneous Independent Actions ✅

The `select_successor_dungeon` phase is **correctly designed** to allow simultaneous, independent player actions. This is confirmed by multiple code sections:

**Engine Action Validation** - `src/game/engine.ts:2402-2411`:
```typescript
// Guard: Only allow actions from the current player (except during specific phases)
if (actingPlayerIdx !== undefined && actingPlayerIdx !== this.state.currentPlayerIdx) {
  // Allow during setup phases, reactions, and EndRound from any player
  const allowedPhases = ['signature_selection', 'select_successor_dungeon', 'choose_first_player', 'reaction_kings_hand', 'reaction_assassin'];
  const isEndRound = (action as any).type === 'EndRound';
  if (!allowedPhases.includes(this.state.phase) && !isEndRound) {
    this.logger?.log(`ERROR: Action by non-current player. acting=${actingPlayerIdx + 1}, current=${this.state.currentPlayerIdx + 1}, phase=${this.state.phase}`);
    return false;
  }
}
```

**Key Insight**: `'select_successor_dungeon'` is explicitly listed in `allowedPhases`, meaning **ANY player can send actions regardless of currentPlayerIdx**.

**Action Generation Comments** - `src/game/engine.ts:1834-1836`:
```typescript
case 'select_successor_dungeon':
  // During setup phase, ANY player can make their choices in any order
  // Generate actions for ALL players who still need to complete setup
```

**Action Generation Logic** - `src/game/engine.ts:1857-1915`:
```typescript
this.state.players.forEach((player, playerIdx) => {
  const needsSuccessor = player.successor === null;
  const needsSquire = player.kingFacet === 'MasterTactician' && player.squire === null;
  const needsDiscards = player.hand.length > 7; // Players need to get down to 7 cards

  this.logger?.log(`DEBUG: Player ${playerIdx + 1} setup status - needsSuccessor: ${needsSuccessor}, needsSquire: ${needsSquire}, needsDiscards: ${needsDiscards}, hand: ${player.hand.length}, kingFacet: "${player.kingFacet}"`);

  if (!needsSuccessor && !needsSquire && !needsDiscards) {
    // This player is completely done
    return;
  }

  // Generate actions for ALL players who need setup...
});

// Important: Don't limit actions by currentPlayerIdx during setup phase!
```

**Final Comment**: `// Important: Don't limit actions by currentPlayerIdx during setup phase!`

### Implementation Analysis: Partially Correct ⚠️

The engine correctly:
1. ✅ **Allows any player to send actions** during `select_successor_dungeon`
2. ✅ **Generates actions for all players** who need setup
3. ✅ **Validates actions against the acting player's hand** (not current player)
4. ✅ **Uses `actingPlayerIdx` parameter** to identify who sent the action

However, there are **contradictory elements** that break the simultaneous design:

### Problem 1: CurrentPlayerIdx Management Conflicts

**My Added Logic** - `src/game/engine.ts:1838-1855` (PROBLEMATIC):
```typescript
// First, find a player who needs setup and set them as current player
let playerNeedingSetup = -1;
for (let i = 0; i < this.state.players.length; i++) {
  const player = this.state.players[i];
  const needsSuccessor = player.successor === null;
  const needsSquire = player.kingFacet === 'MasterTactician' && player.squire === null;
  const needsDiscards = player.hand.length > 7;

  if (needsSuccessor || needsSquire || needsDiscards) {
    playerNeedingSetup = i;
    break;
  }
}

// Update currentPlayerIdx to point to a player who needs setup
if (playerNeedingSetup >= 0) {
  this.state.currentPlayerIdx = playerNeedingSetup;
}
```

**WRONG ASSUMPTION**: This logic assumes the phase is turn-based and tries to enforce a "current player", but the phase is designed to be simultaneous.

**My Added Logic** - `src/game/engine.ts:169-205` (PROBLEMATIC):
```typescript
// Update currentPlayerIdx to point to a player who still needs setup during setup phases
private updateCurrentPlayerForSetupPhase(): void {
  if (this.state.phase !== 'select_successor_dungeon') return;

  // Check if current player still needs setup
  const currentPlayer = this.state.players[this.state.currentPlayerIdx];
  const currentNeedsSuccessor = currentPlayer.successor === null;
  const currentNeedsSquire = currentPlayer.kingFacet === 'MasterTactician' && currentPlayer.squire === null;
  const currentNeedsDiscards = currentPlayer.hand.length > 7;

  if (currentNeedsSuccessor || currentNeedsSquire || currentNeedsDiscards) {
    // Current player still needs setup, keep them
    this.logger?.log(`DEBUG: Current player ${this.state.currentPlayerIdx} (Player ${this.state.currentPlayerIdx + 1}) still needs setup`);
    return;
  }

  // Current player is done, find another player who needs setup
  for (let i = 0; i < this.state.players.length; i++) {
    if (i === this.state.currentPlayerIdx) continue; // Skip current player, they're done

    const player = this.state.players[i];
    const needsSuccessor = player.successor === null;
    const needsSquire = player.kingFacet === 'MasterTactician' && player.squire === null;
    const needsDiscards = player.hand.length > 7;

    if (needsSuccessor || needsSquire || needsDiscards) {
      this.state.currentPlayerIdx = i;
      this.logger?.log(`DEBUG: Updated currentPlayerIdx to ${i} (Player ${i + 1}) who needs setup`);
      return;
    }
  }

  // If no player needs setup, all setup is complete - transition to play phase
  this.logger?.log(`DEBUG: All players completed setup, transitioning to play phase`);
  this.state.phase = 'play';
  this.state.currentPlayerIdx = this.state.firstPlayerIdx || 0;
}
```

**WRONG ASSUMPTION**: This entire method assumes turn-based flow and actively switches currentPlayerIdx, but the phase should allow both players to act simultaneously.

### Problem 2: Bot Test Design Conflicts

**File**: `src/test/bot-vs-bot.test.ts:166-181`

```typescript
// CORRECT FIX: Use the actual engine current player index
const engineCurrentPlayerIdx = this.server.getService().getCurrentPlayerIndex(this.gameId);

if (engineCurrentPlayerIdx === null) {
  this.logger.error('Cannot get current player index from engine');
  break;
}

// Map engine player index to bot
// Player 0 = Bot1, Player 1 = Bot2
const isBot1Turn = engineCurrentPlayerIdx === 0;
const currentBot = isBot1Turn ? this.bot1 : this.bot2;
const currentClient = isBot1Turn ? this.client1 : this.client2;
const currentToken = isBot1Turn ? this.player1Token : this.player2Token;
const currentEvents = isBot1Turn ? events1 : events2;
const botName = isBot1Turn ? 'Bot1' : 'Bot2';
```

**WRONG ASSUMPTION**: The test assumes only ONE bot should act at a time based on `engineCurrentPlayerIdx`, but during `select_successor_dungeon`, BOTH bots should be able to act simultaneously if they need setup.

## Corrected Analysis

### False Assumptions in Previous Analysis

1. **❌ "The test correctly determines which bot should act"** - The test should allow BOTH bots to act during setup
2. **❌ "CurrentPlayerIdx should point to active player"** - During setup, currentPlayerIdx is less meaningful since any player can act
3. **❌ "Need to switch currentPlayerIdx for proper flow"** - The simultaneous design doesn't require strict currentPlayerIdx management
4. **❌ "Event timing causes the issue"** - The real issue is forcing turn-based logic on a simultaneous phase

### What Actually Should Happen

During `select_successor_dungeon` phase:
1. **Both bots should receive their own actions** (✅ now working via `for_player` filtering)
2. **Both bots should be able to act simultaneously** (❌ test only allows one bot at a time)
3. **No strict turn order** should be enforced (❌ test enforces turn order via currentPlayerIdx)
4. **Phase transitions when all players complete setup** (✅ working correctly)

## Real Solution Needed

The bot test needs to be redesigned to handle simultaneous actions during setup phases:

1. **Remove turn-based logic** for setup phases
2. **Allow both bots to act** when they have available actions
3. **Don't rely on currentPlayerIdx** for determining whose turn it is during setup
4. **Check both bots for available actions** each loop iteration

The currentPlayerIdx switching logic I added is **counterproductive** and should be removed to restore the intended simultaneous design.
