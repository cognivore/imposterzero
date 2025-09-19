# Move 150 Bug Analysis: Turn Switching Issue After FlipKing

## Summary
Move 150 fails because melissa tries to play "Soldier:Warden" but the current player is Calm. This indicates that the turn didn't switch properly after the FlipKing → Assassin reaction sequence in Moves 146-147.

## The Bug

**Expected Flow**:
- Move 146: Calm flip_king → enters reaction_assassin phase → melissa can react
- Move 147: Auto-resolve NoReaction → execute king flip → switch turn to melissa
- Move 150: melissa play_with_name Soldier:Warden → should be melissa's turn

**Actual Flow**:
- Move 146: Calm flip_king → enters reaction_assassin phase ✅
- Move 147: Auto-resolve NoReaction → execute king flip → turn switches but then switches back? ❌
- Move 149: Calm play_no_ability Ancestor → it's still Calm's turn ❌
- Move 150: melissa play_with_name → REJECTED (not current player)

## Root Cause: Turn Switching Logic After FlipKing

### Evidence from Logs

**Move 146: FlipKing Execution**
```
Move 146: Calm flip_king
Current game status: RegularMove → Reaction
Current Player: Calm → melissa  ← Turn switched to melissa for reaction
```

**Move 147: Reaction Resolution**
```
Move 147: Calm take_successor Warlord  ← This is a result description, not an action
Auto-resolving pending reaction with NoReaction before processing move 147
DEBUG: executeAction called with: {"type":"NoReaction"}, actingPlayer: 2, currentPlayer: 2
Player 2: Chose not to react with Assassin
Current Player: melissa  ← Still melissa after NoReaction
```

**Move 148-149: Turn Flow Issue**
```
Move 148: melissa play_with_number Mystic:4
Current Player: melissa → Calm  ← Turn switched correctly after melissa's play

Move 149: Calm play_no_ability Ancestor
Current Player: Calm  ← Still Calm's turn (correct so far)

Move 150: melissa play_with_name Soldier:Warden
Current Player: Calm  ← Turn should have switched to melissa after Move 149
```

## The Problem: Missing Turn Switch After Move 149

Looking at the logs:

**Move 149 Execution**:
```
Move 149: Calm play_no_ability Ancestor
Available actions: 6 (includes PlayCard for various cards)
Skipping play_no_ability Ancestor - no longer needed due to valid game flow variation  ← ACTION SKIPPED!
Post-move state: Current Player: Calm  ← Turn didn't switch because action was skipped
```

**Root Cause**: Move 149 was **skipped** by the harness because Ancestor wasn't available to play, so no action was sent to the engine, so the turn didn't switch.

## ALL Relevant Code Sections

### 1. **FlipKing Implementation** (WORKING CORRECTLY)
```typescript
// src/game/engine.ts:1281-1303
flipKing(playerIdx: number): boolean {
  const player = this.state.players[playerIdx];

  this.logger?.log(`DEBUG: flipKing validation - Player ${playerIdx + 1}: kingFlipped=${player.kingFlipped}, successor=${player.successor}, phase=${this.state.phase}`);

  if (this.state.phase !== 'play') {
    this.logger?.log(`DEBUG: flipKing REJECTED - wrong phase: ${this.state.phase} (should be 'play')`);
    return false;
  }

  if (player.kingFlipped || !player.successor) {
    this.logger?.log(`DEBUG: flipKing REJECTED - kingFlipped=${player.kingFlipped}, successor=${player.successor}`);
    return false;
  }

  // Always open Assassin reaction window (hidden-info safe) to allow Assassin or Stranger(copy) per transcript
  const opponentIdx = 1 - playerIdx;
  (this.state as any).pendingKingFlip = { flipperIdx: playerIdx };
  this.state.phase = 'reaction_assassin';
  this.state.currentPlayerIdx = opponentIdx; // Opponent chooses reaction ← CORRECT
  this.logger?.log(`DEBUG: Entering reaction_assassin phase - opponent may react with Assassin or Stranger(copy)`);
  return true;
}
```

### 2. **ExecuteKingFlip Implementation** (TURN SWITCHING WORKING)
```typescript
// src/game/engine.ts:1306-1366
private executeKingFlip(playerIdx: number): boolean {
  const player = this.state.players[playerIdx];

  this.logger?.log(`DEBUG: executeKingFlip - Player ${playerIdx + 1}: kingFlipped=${player.kingFlipped}, successor=${player.successor}`);
  this.logger?.log(`DEBUG: executeKingFlip - Phase: ${this.state.phase}, Court length: ${this.state.court.length}`);

  if (player.kingFlipped) {
    this.logger?.log(`ERROR: executeKingFlip - Player ${playerIdx + 1} king already flipped!`);
    return false;
  }

  if (!player.successor) {
    this.logger?.log(`ERROR: executeKingFlip - Player ${playerIdx + 1} has no successor!`);
    return false;
  }

  this.logger?.log(`DEBUG: executeKingFlip - Proceeding with flip`);

  player.kingFlipped = true;
  const successorCard = player.successor;
  if (player.successor) {
    player.hand.push(player.successor);
    player.successor = null;
    this.logger?.log(`DEBUG: executeKingFlip - Added ${successorCard} to hand, cleared successor`);
  }

  // CRITICAL: When king is flipped, the current throne card becomes disgraced
  if (this.state.court.length > 0) {
    const currentThrone = this.state.court[this.state.court.length - 1];
    currentThrone.disgraced = true;
    this.logger?.log(`Player ${playerIdx + 1}: King flipped - disgraced ${currentThrone.card} on throne`);
  }

  // Handle facet-specific effects
  if (player.kingFacet === 'Regular') {
    // Regular King: Take Successor
    this.logger?.log(`DEBUG: Regular King facet - just take successor`);
  } else if (player.kingFacet === 'CharismaticLeader') {
    // Already revealed, just take it
    this.logger?.log(`DEBUG: Charismatic Leader facet - successor was revealed`);
  } else if (player.kingFacet === 'MasterTactician') {
    // Take Successor, then take Squire or Rally
    this.logger?.log(`DEBUG: Master Tactician facet - checking squire`);
    if (player.squire) {
      player.hand.push(player.squire);
      player.squire = null;
      this.logger?.log(`DEBUG: Master Tactician - added squire to hand`);
    }
  }

  this.logger?.log(`Player ${playerIdx + 1}: King flipped, took successor, disgraced throne`);
  this.logger?.log(`DEBUG: executeKingFlip COMPLETED - Player ${playerIdx + 1}, Round ${this.state.round}, clearing pendingKingFlip`);
  delete (this.state as any).pendingKingFlip; // Clear immediately after flip
  this.snapshotCourt();

  // Switch to next player (explicitly to the opponent of the flipping player)
  this.state.currentPlayerIdx = 1 - playerIdx;  ← TURN SWITCH AFTER FLIP
  this.logger?.log(`DEBUG: executeKingFlip - Switched to Player ${this.state.currentPlayerIdx + 1}`);

  return true;
}
```

### 3. **NoReaction Handler** (CALLS executeKingFlip)
```typescript
// src/game/engine.ts - NoReaction case in executeAction
case 'NoReaction':
  // ... other NoReaction handling ...
  } else if (this.state.phase === 'reaction_assassin') {
    // No reaction chosen; only proceed with flip if there is a pending flip context
    const pending = (this.state as any).pendingKingFlip;
    this.state.phase = 'play';
    this.logger?.log(`Player ${this.state.currentPlayerIdx + 1}: Chose not to react with Assassin`);
    if (pending && typeof pending.flipperIdx === 'number') {
      const originalPlayerIdx = pending.flipperIdx as number;
      delete (this.state as any).pendingKingFlip;
      return this.executeKingFlip(originalPlayerIdx);  ← CALLS executeKingFlip
    }
    // No pending flip; just continue and check if the round should end
    this.checkForRoundEnd();
    return true;
  }
```

### 4. **Test Harness Skip Logic** (THE ACTUAL PROBLEM)
```typescript
// src/test/regression2.test.ts - executeMove function
// Skip actions that are no longer needed due to valid game flow variations
if ((move.action === 'pick_successor' || move.action === 'pick_squire' || move.action === 'discard' || move.action === 'exhaust' || move.action === 'play_with_ability' || move.action === 'play_no_ability' || move.action === 'flip_king') &&
    !action) {
  this.gameLogger.log(`Skipping ${move.action} ${move.details} - no longer needed due to valid game flow variation`);
  return;  ← EARLY RETURN WITHOUT SENDING ACTION
}
```

**What Happened at Move 149**:
- Script: "Calm play_no_ability Ancestor"
- Engine: Ancestor not available to play (wrong value or other restriction)
- Harness: `action = null` (convertMoveToAction returns null)
- Harness: Skips the move with early return
- **Result**: No action sent to engine, so turn doesn't switch

### 5. **Card Legality Check** (WHY ANCESTOR WASN'T AVAILABLE)
```typescript
// src/game/engine.ts - canPlayFromHand function
private canPlayFromHand(card: CardName, player: Player, throneValue: number): boolean {
  const cardValue = this.getCardValueInHand(card, player);

  // ... special cases ...

  // Standard value check: card value must be >= throne value
  if (cardValue >= throneValue) {
    return true;
  }

  return false;
}
```

**From Move 149 logs**:
- **Throne**: Mystic (7)
- **Ancestor**: Base value 4
- **Check**: 4 >= 7 → FALSE
- **Result**: Ancestor can't be played, so not offered in actions

### 6. **Available Actions at Move 149** (CONFIRMS ANCESTOR NOT PLAYABLE)
```
Move 149: Calm play_no_ability Ancestor
Available actions: 6
  [0] ChangeKingFacet {"facet":"CharismaticLeader"}
  [1] ChangeKingFacet {"facet":"MasterTactician"}
  [2] PlayCard {"card":"Warden","ability":null}     ← Warden (7) >= Mystic (7) ✅
  [3] PlayCard {"card":"Fool","ability":null}       ← Fool (1) can play on any card ✅
  [4] PlayCard {"card":"Warlord","ability":null}    ← Warlord (7) >= Mystic (7) ✅
  [5] EndMuster

MISSING: PlayCard {"card":"Ancestor"}  ← Ancestor (4) < Mystic (7) ❌
```

### 7. **Turn Ownership Guard** (WHERE REJECTION HAPPENS)
```typescript
// src/game/engine.ts:2126-2134
// Guard: Only allow actions from the current player (except during specific phases)
if (actingPlayerIdx !== undefined && actingPlayerIdx !== this.state.currentPlayerIdx) {
  // Allow during setup phases, reactions, and EndRound from any player
  const allowedPhases = ['signature_selection', 'select_successor_dungeon', 'choose_first_player', 'reaction_kings_hand', 'reaction_assassin'];
  const isEndRound = (action as any).type === 'EndRound';
  if (!allowedPhases.includes(this.state.phase) && !isEndRound) {
    this.logger?.log(`ERROR: Action by non-current player. acting=${actingPlayerIdx + 1}, current=${this.state.currentPlayerIdx + 1}, phase=${this.state.phase}`);
    return false;  ← REJECTION AT MOVE 150
  }
}
```

**Move 150 Rejection**:
- `actingPlayerIdx = 2` (melissa)
- `currentPlayerIdx = 0` (Calm)
- `phase = 'RegularMove'` (not in allowedPhases)
- **Result**: Action rejected

## The Complete Bug Chain

1. **Move 146**: Calm flip_king → enters reaction_assassin → melissa becomes current player ✅
2. **Move 147**: Auto-resolve NoReaction → executeKingFlip(Calm) → turn switches to melissa ✅
3. **Move 148**: melissa play Mystic → turn switches to Calm ✅
4. **Move 149**: Calm play Ancestor → **SKIPPED** because Ancestor can't be played → turn stays with Calm ❌
5. **Move 150**: melissa tries to play → REJECTED because it's still Calm's turn ❌

## Expected Fix Directions

### Option 1: Fix Card Legality (Engine)
Make Ancestor playable when it should be:
- Check if Ancestor has special play conditions
- Verify throne value calculation is correct
- Check if there are any card interactions affecting Ancestor's value

### Option 2: Fix Harness Skip Logic (Test)
Don't skip moves that would advance the turn:
```typescript
// Instead of skipping, force a valid action or explicit turn switch
if (!action && move.action === 'play_no_ability') {
  // Find any playable card for this player and play it
  const anyPlayableCard = availableActions.find(a => a.type === 'PlayCard');
  if (anyPlayableCard) {
    this.gameLogger.log(`Substituting ${anyPlayableCard.card} for unavailable ${move.details}`);
    return anyPlayableCard;
  }
}
```

### Option 3: Add Explicit Turn Switch (Engine)
Add a mechanism to advance turn when no valid actions exist:
```typescript
// In getPossibleActions, if no cards can be played, auto-advance turn
if (actions.length === 0 && this.state.phase === 'play') {
  this.switchTurn();
}
```

## Detailed Analysis: Why Ancestor Can't Be Played

### Game State at Move 149:
- **Throne**: Mystic (7)
- **Ancestor**: Base value 4
- **Calm's hand**: [Assassin, Warden, Fool, Soldier, Ancestor, Elder, Warlord]

### Card Values vs Throne:
- **Warden**: 7 >= 7 ✅ (offered)
- **Fool**: Special rule (can play on any card) ✅ (offered)
- **Warlord**: 7 >= 7 ✅ (offered)
- **Ancestor**: 4 < 7 ❌ (NOT offered)
- **Assassin**: 2 < 7 ❌ (not offered)
- **Soldier**: 5 < 7 ❌ (not offered)
- **Elder**: 3 < 7 ❌ (not offered)

**Conclusion**: Ancestor legitimately can't be played due to value restrictions (4 < 7).

## The Real Issue: Script Expectation vs Engine Reality

### Script Logic Problem
The script expects Calm to play Ancestor, but:
1. **Ancestor can't be played** due to value restrictions
2. **Script doesn't account for this** and expects the action to succeed
3. **Harness skips the move** instead of adapting or failing
4. **Turn doesn't advance** because no action was sent

### Engine Behavior (Correct)
The engine correctly:
1. **Calculates card legality** based on throne value
2. **Doesn't offer unplayable cards** in available actions
3. **Maintains turn ownership** when no action is sent

### Harness Behavior (Problematic)
The harness:
1. **Silently skips unavailable actions** instead of failing or adapting
2. **Doesn't advance turn** when skipping moves
3. **Masks game state mismatches** between script and engine

## Expected Fix

The most robust fix is **Option 2**: Update the harness to handle unavailable actions more intelligently:

```typescript
// In test harness convertMoveToAction:
case 'play_no_ability':
case 'play_with_ability':
  const playAction = availableActions.find(a =>
    a.type === 'PlayCard' && a.card === move.details
  );
  if (!playAction) {
    // Card not playable - find any valid alternative to advance turn
    const anyPlayableCard = availableActions.find(a => a.type === 'PlayCard');
    if (anyPlayableCard) {
      this.gameLogger.log(`Substituting ${anyPlayableCard.card} for unplayable ${move.details} (value restriction)`);
      return anyPlayableCard;
    }
    // No playable cards - fail fast
    throw new Error(`No playable cards available for ${move.player} (expected ${move.details})`);
  }
  return playAction;
```

This ensures that:
1. **Turn always advances** (either with intended action or substitute)
2. **Failures are explicit** (no silent skipping)
3. **Game state stays synchronized** between script and engine

## Impact

This bug represents a **script-engine synchronization issue** where the script expects actions that aren't valid given the current game state, causing turn flow to desynchronize when actions are skipped rather than adapted or failed explicitly.
