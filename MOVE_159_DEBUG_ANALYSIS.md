# Move 159 Bug Analysis: King's Hand Reaction Handler Conflict

## Summary
Move 159 fails with a 400 Bad Request when melissa tries to react with King's Hand to cancel Calm's Assassin reaction. The two-step Assassin reaction system is working correctly (Assassin → King's Hand window), but there's a conflict in the King's Hand reaction handlers.

## The Bug

**Expected Flow**:
- Move 157: melissa flip_king → enters reaction_assassin phase → Calm can react
- Move 158: Calm react Assassin → condemns Assassin → opens reaction_kings_hand for melissa
- Move 159: melissa react KingsHand → cancels Assassin reaction → proceeds with flip

**Actual Flow**:
- Move 157: melissa flip_king → enters reaction_assassin phase ✅
- Move 158: Calm react Assassin → condemns Assassin → opens reaction_kings_hand for melissa ✅
- Move 159: melissa react KingsHand → 400 Bad Request ❌

## Root Cause: Conflicting King's Hand Reaction Handlers

### Evidence from Logs

**Move 158: Assassin Reaction Working**
```
Move 158: Calm react Assassin
Player 1: Condemned Assassin from hand
DEBUG: Assassin chosen — offering King's Hand to Player 2
phase: reaction_kings_hand, currentPlayerIdx: 1 (melissa)
```

**Move 159: King's Hand Window Available**
```
Move 159: melissa react KingsHand
Current game status: Reaction
Available actions: 2
  [0] NoReaction
  [1] Reaction {"card_idx":0,"card":"KingsHand"}
phase: "reaction_kings_hand"
currentPlayerIdx: 1 (melissa)
melissa hand: ["KingsHand"]
```

**Move 159: Engine Rejection**
```
ERROR: Action failed
action: {"type":"Reaction","card_idx":0,"card":"KingsHand"}
phase: "reaction_kings_hand"
currentPlayerIdx: 1
possible_actions: [{"type":"NoReaction"},{"type":"Reaction","card_idx":0,"card":"KingsHand"}]
```

**The Issue**: The action is offered in possible_actions and the game state is correct, but the engine rejects the action during execution.

## ALL Relevant Code Sections

### 1. **Assassin Reaction Handler** (WORKING - Step 1)
```typescript
// src/game/engine.ts:2838-2871
} else if (action.type === 'Reaction' && this.state.phase === 'reaction_assassin' && (action.card === 'Assassin' || action.card === 'Stranger')) {
  // Assassin/Stranger chosen - condemn the card and open King's Hand window for flipper
  const responderIdx = this.state.currentPlayerIdx;
  const responder = this.state.players[responderIdx];

  if (action.card === 'Assassin') {
    // Remove Assassin from hand
    const assassinIdx = responder.hand.indexOf('Assassin');
    if (assassinIdx >= 0) {
      responder.hand.splice(assassinIdx, 1);
      this.state.condemned.push('Assassin');
      this.logger?.log(`Player ${responderIdx + 1}: Condemned Assassin from hand`);
    } else {
      this.logger?.log(`Player ${responderIdx + 1}: Attempted Assassin reaction without having Assassin`);
      return false;
    }
  } else if (action.card === 'Stranger') {
    // Stranger copying Assassin - just log it
    this.logger?.log(`Player ${responderIdx + 1}: Stranger copying Assassin reaction`);
  }

  // Store pending Assassin reaction
  (this.state as any).pendingAssassinReaction = {
    responderIdx,
    kind: action.card === 'Assassin' ? 'Assassin' : 'StrangerAssassin'
  };

  // Offer King's Hand to the flipper
  const flipperIdx = (this.state as any).pendingKingFlip?.flipperIdx;
  if (flipperIdx !== undefined) {
    this.state.phase = 'reaction_kings_hand';
    this.state.currentPlayerIdx = flipperIdx;
    this.logger?.log(`DEBUG: Assassin chosen — offering King's Hand to Player ${flipperIdx + 1}`);
    return true;
  }
  return false;
}
```

### 2. **King's Hand Reaction Handler** (CONFLICTING - Step 2)

#### 2a. **Original King's Hand Handler** (FOR REGULAR ABILITIES)
```typescript
// src/game/engine.ts:2804-2837
if (action.type === 'Reaction' && action.card === 'KingsHand' && this.state.phase === 'reaction_kings_hand') {
  // Execute King's Hand reaction
  const reactingPlayerIdx = this.state.currentPlayerIdx;
  const reactingPlayer = this.state.players[reactingPlayerIdx];
  const pendingReaction = (this.state as any).pendingKingsHandReaction;

  if (pendingReaction) {
    // Remove King's Hand from reacting player's hand
    const kingsHandIdx = reactingPlayer.hand.indexOf('KingsHand');
    if (kingsHandIdx >= 0) {
      const kingsHand = reactingPlayer.hand.splice(kingsHandIdx, 1)[0];
      this.state.condemned.push(kingsHand);
      this.logger?.log(`Player ${reactingPlayerIdx + 1}: Used King's Hand reaction - condemned King's Hand`);
    }

    // Remove the countered card from court and condemn it
    const courtCard = this.state.court[pendingReaction.playedCardCourtIdx];
    if (courtCard && courtCard.card === pendingReaction.playedCard) {
      this.state.court.splice(pendingReaction.playedCardCourtIdx, 1);
      this.state.condemned.push(pendingReaction.playedCard);
      this.logger?.log(`Player ${reactingPlayerIdx + 1}: King's Hand countered ${pendingReaction.playedCard} - condemned ${pendingReaction.playedCard}`);
    }

    // Original player must play again
    this.state.phase = 'play';
    this.state.currentPlayerIdx = pendingReaction.originalPlayerIdx;
    delete (this.state as any).pendingKingsHandReaction;

    this.logger?.log(`Player ${pendingReaction.originalPlayerIdx + 1}: Must play again after being countered`);
    return true;
  }
}
```

#### 2b. **New Assassin King's Hand Handler** (FOR ASSASSIN REACTIONS)
```typescript
// src/game/engine.ts:2872-2891 (after user's fix)
} else if (action.type === 'Reaction' && this.state.phase === 'reaction_kings_hand' && action.card === 'KingsHand') {
  // King's Hand played to cancel Assassin reaction
  const flipperIdx = this.state.currentPlayerIdx;
  const flipper = this.state.players[flipperIdx];

  const khIdx = flipper.hand.indexOf('KingsHand');
  if (khIdx >= 0) {
    flipper.hand.splice(khIdx, 1);
    this.state.condemned.push('KingsHand');
    this.logger?.log(`Player ${flipperIdx + 1}: King's Hand cancels the Assassin reaction`);
  }

  delete (this.state as any).pendingAssassinReaction;

  // Proceed with the original flip as if NoReaction had been chosen
  const pending = (this.state as any).pendingKingFlip;
  this.state.phase = 'play';
  if (pending && typeof pending.flipperIdx === 'number') {
    delete (this.state as any).pendingKingFlip;
    return this.executeKingFlip(pending.flipperIdx);
  }
  return true;
}
```

### 3. **The Conflict Problem**

**The Issue**: Both handlers check for the same conditions:
- `action.type === 'Reaction'`
- `action.card === 'KingsHand'`
- `this.state.phase === 'reaction_kings_hand'`

**Handler Priority**: The original handler (2a) executes first and looks for `pendingKingsHandReaction`, but in the Assassin context there is no `pendingKingsHandReaction` - there's only `pendingAssassinReaction`.

**What Happens at Move 159**:
1. melissa sends `{"type":"Reaction","card":"KingsHand"}`
2. **Original handler** (2a) checks `pendingKingsHandReaction` → **undefined** (no regular KH reaction pending)
3. **Original handler** reaches the end and `return false` (line 2837)
4. **New handler** (2b) never executes because the first handler already returned false

### 4. **State Context at Move 159**

**Game State**:
```json
{
  "phase": "reaction_kings_hand",
  "currentPlayerIdx": 1,
  "pendingKingFlip": { "flipperIdx": 1 },
  "pendingAssassinReaction": {
    "responderIdx": 0,
    "kind": "Assassin"
  },
  "pendingKingsHandReaction": undefined  ← This is the problem
}
```

**Available Actions**:
```json
[
  {"type":"NoReaction"},
  {"type":"Reaction","card_idx":0,"card":"KingsHand"}
]
```

**Player State**:
```json
{
  "melissa": {
    "hand": ["KingsHand"],
    "kingFlipped": false,
    "successor": "Elder"
  }
}
```

### 5. **Action Generation Logic** (WORKING CORRECTLY)
```typescript
// src/game/engine.ts - getPossibleActions for reaction_kings_hand
case 'reaction_kings_hand':
  // Offer choices; include NoReaction except for Fool-deferred windows to avoid auto-advance
  const pendingKH = (this.state as any).pendingKingsHandReaction;
  const isFoolDeferred = !!(pendingKH && pendingKH.playedCard === 'Fool');
  this.logger?.log(`DEBUG: KH window context - playedCard=${pendingKH?.playedCard}, hasResolution=${!!pendingKH?.resolution}`);
  if (!isFoolDeferred) {
    actions.push({ type: 'NoReaction' });
    this.logger?.log(`DEBUG: KH window actions include NoReaction`);
  } else {
    this.logger?.log(`DEBUG: KH window (Fool) suppressing NoReaction to preserve reaction step`);
  }
  // Offer Reaction choice regardless of actual hand (hidden info). Execution will validate possession/context
  const kingsHandIdx = currentPlayer.hand.indexOf('KingsHand');
  actions.push({ type: 'Reaction', card_idx: Math.max(0, kingsHandIdx), card: 'KingsHand' });

  // Also offer Stranger reaction if KH is in court for copying
  const kingsHandInCourt = this.state.court.some(c => c.card === 'KingsHand' && !c.disgraced);
  const strangerIdx = currentPlayer.hand.findIndex(card => card === 'Stranger');
  if (strangerIdx >= 0 && kingsHandInCourt) {
    actions.push({ type: 'Reaction', card_idx: strangerIdx, card: 'Stranger' });
  }
  break;
```

**Analysis**: Action generation works correctly for both contexts (regular KH reactions and Assassin KH reactions) because it doesn't distinguish between the two cases.

### 6. **NoReaction Handler** (INCLUDES ASSASSIN CASE)
```typescript
// src/game/engine.ts:2976-3010
} else if (this.state.phase === 'reaction_kings_hand') {
  // NEW: No King's Hand played against Assassin — resolve Assassin/Stranger and abort the flip
  const pa = (this.state as any).pendingAssassinReaction;
  if (pa) {
    this.logger?.log(`DEBUG: No King's Hand played — resolving ${pa.kind}`);
    delete (this.state as any).pendingAssassinReaction;

    // The flip is prevented
    delete (this.state as any).pendingKingFlip;

    this.state.phase = 'play';
    return this.resolveAssassinReaction(pa.responderIdx, pa.kind);
  }
  return true;
}
```

### 7. **resolveAssassinReaction Helper** (WORKING)
```typescript
// src/game/engine.ts:2142-2167
private resolveAssassinReaction(responderIdx: number, kind: 'Assassin' | 'StrangerAssassin'): boolean {
  const who = kind === 'Assassin' ? 'Assassin' : 'Stranger (copy: Assassin)';
  const responder = this.state.players[responderIdx];

  // Award points based on assassinator's king status
  const points = responder.kingFlipped ? 2 : 3;
  const oldPoints = responder.points;
  responder.points += points;

  this.logger?.log(`Player ${responderIdx + 1}: Used ${who} reaction! Wins ${points} points`);
  this.logger?.log(`DEBUG: Score change - Player ${responderIdx + 1}: ${oldPoints} → ${responder.points} (+${points})`);
  this.logger?.log(`DEBUG: Final scores after Assassin reaction: Calm ${this.state.players[0].points} - melissa ${this.state.players[1].points}`);

  // Check for game over
  if (responder.points >= GAME_CONFIG.POINTS_TO_WIN) {
    this.state.phase = 'game_over';
    this.logger?.log(`Game over! Player ${responderIdx + 1} wins with ${responder.points} points!`);
    return true;
  }

  // Continue to next round
  this.logger?.log(`Round ended by Assassin reaction, preparing next round`);
  this.prepareNextRound();
  delete (this.state as any).pendingKingFlip;
  return true;
}
```

## The Core Problem: Handler Context Mismatch

### Current Handler Logic Flow

**When Move 159 executes**:
1. **Action**: `{"type":"Reaction","card":"KingsHand"}`
2. **Phase**: `reaction_kings_hand`
3. **First Handler** (Regular KH): Checks `pendingKingsHandReaction` → **undefined**
4. **First Handler**: `return false` (no pending regular reaction)
5. **Second Handler** (Assassin KH): **Never reached** because first handler returned false

### The Fix Needed

**Option 1: Check Assassin Context First**
```typescript
if (action.type === 'Reaction' && action.card === 'KingsHand' && this.state.phase === 'reaction_kings_hand') {
  // Check if this is an Assassin reaction context
  const pendingAssassin = (this.state as any).pendingAssassinReaction;
  if (pendingAssassin) {
    // Handle Assassin cancellation
    // ... existing Assassin KH handler code ...
    return true;
  }

  // Otherwise, handle regular KH reaction
  const pendingReaction = (this.state as any).pendingKingsHandReaction;
  if (pendingReaction) {
    // ... existing regular KH handler code ...
    return true;
  }

  return false;
}
```

**Option 2: Unify into Single Handler**
```typescript
if (action.type === 'Reaction' && action.card === 'KingsHand' && this.state.phase === 'reaction_kings_hand') {
  const reactingPlayerIdx = this.state.currentPlayerIdx;
  const reactingPlayer = this.state.players[reactingPlayerIdx];

  // Remove King's Hand from hand (common to both cases)
  const kingsHandIdx = reactingPlayer.hand.indexOf('KingsHand');
  if (kingsHandIdx >= 0) {
    reactingPlayer.hand.splice(kingsHandIdx, 1);
    this.state.condemned.push('KingsHand');
    this.logger?.log(`Player ${reactingPlayerIdx + 1}: Used King's Hand reaction - condemned King's Hand`);
  }

  // Check context: Assassin reaction or regular ability reaction
  const pendingAssassin = (this.state as any).pendingAssassinReaction;
  const pendingRegular = (this.state as any).pendingKingsHandReaction;

  if (pendingAssassin) {
    // Cancel Assassin reaction and proceed with flip
    this.logger?.log(`Player ${reactingPlayerIdx + 1}: King's Hand cancels the Assassin reaction`);
    delete (this.state as any).pendingAssassinReaction;

    const pending = (this.state as any).pendingKingFlip;
    this.state.phase = 'play';
    if (pending && typeof pending.flipperIdx === 'number') {
      delete (this.state as any).pendingKingFlip;
      return this.executeKingFlip(pending.flipperIdx);
    }
    return true;
  } else if (pendingRegular) {
    // Cancel regular ability and force replay
    // ... existing regular handler logic ...
    return true;
  }

  return false;
}
```

### 8. **Current Handler Order Issue**

**Current Code Structure**:
```typescript
case 'Reaction':
  if (action.card === 'KingsHand' && phase === 'reaction_kings_hand') {
    // Handler A: Regular KH reactions (checks pendingKingsHandReaction)
    if (pendingKingsHandReaction) { /* ... */ return true; }
    // Falls through and returns false if no pendingKingsHandReaction
  } else if (phase === 'reaction_assassin' && card === 'Assassin') {
    // Handler B: Assassin reactions (opens KH window)
  } else if (phase === 'reaction_kings_hand' && card === 'KingsHand') {
    // Handler C: Assassin KH reactions (never reached!)
  }
  return false;
```

**The Problem**: Handler A always executes first for KH reactions and returns false when there's no regular pending reaction, preventing Handler C from executing.

## Expected Fix Direction

The fix requires **unifying the King's Hand reaction handling** to check both contexts (regular abilities and Assassin reactions) in a single handler, or **reordering the handlers** to check Assassin context first.

**Key Requirements**:
1. **Assassin KH reactions** should cancel the Assassin and proceed with flip
2. **Regular KH reactions** should cancel abilities and force replay
3. **Both should condemn King's Hand** from the reacting player's hand
4. **Context detection** should use `pendingAssassinReaction` vs `pendingKingsHandReaction`

## Impact

This prevents the final step of the Assassin reaction sequence, causing the test to fail at the very last moment when the King's Hand counter-reaction should cancel the Assassin and allow the flip to proceed.

## Additional Context

### Game State Integrity
All other aspects are working correctly:
- ✅ Two-step Assassin reaction flow
- ✅ Phase transitions (reaction_assassin → reaction_kings_hand)
- ✅ Turn switching (opponent → flipper)
- ✅ Action generation (KH reaction offered)
- ✅ State persistence (pendingKingFlip, pendingAssassinReaction)

### Handler Logic Requirements
The King's Hand reaction handler needs to:
1. **Detect context** (Assassin vs regular ability)
2. **Condemn King's Hand** (common to both)
3. **Branch behavior**:
   - **Assassin context**: Cancel Assassin, proceed with flip
   - **Regular context**: Cancel ability, force replay

This represents the final piece needed to achieve 100% test completion.

