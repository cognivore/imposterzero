# Universal Reaction System

## Overview

The Universal Reaction System ensures **perfect hidden information protection** by always asking players about reaction opportunities, regardless of whether they actually have the reaction cards. This prevents information leakage about hand contents while maintaining strategic depth.

## Core Principles

### 🔒 **Hidden Information Protection**
- **ALWAYS** prompt for reactions if card could theoretically be in hand
- **NEVER** reveal hand contents through selective prompting
- **MAINTAIN** bluffing opportunities for all reaction cards

### 🎯 **Universal Coverage**
All reaction cards follow the same system:
- **King's Hand** - Prevents MAY abilities
- **Assassin** - Prevents King flips
- **Stranger** - Copies reactions from court cards
- **Arbiter** - Turn start reactions (separate system)
- **Impersonator** - Turn start reactions (separate system)

### 📍 **Visibility Zone Logic**
A player could have a reaction card if it's NOT in visible zones:
- ❌ **Visible Zones**: Antechamber, Court, Accused, Condemned, Exhausted Army
- ✅ **Hidden Zones**: Hand, Active Army

## Reaction Flow

```
Trigger Event (ability use or king flip)
↓
For each opponent:
  ↓
  Get possible reaction cards for trigger type
  ↓
  For each possible reaction:
    ↓
    Could player have this card? (visibility check)
    ↓
    If YES: Ask "Do you want to use [Card] reaction?"
    ↓
    Player responds Yes/No
    ↓
    If Yes: Check if they actually have it
      ├─ Have it → Execute reaction
      └─ Don't have it → Illegal move (penalty)
    ↓
    If reaction executed → Stop, ability prevented
  ↓
Continue with original ability if no reactions used
```

## Example Scenarios

### Scenario 1: King's Hand vs Fool
```
Player A plays Fool (MAY ability)
Player B could have King's Hand (not in visible zones)
→ "Player B, do you want to use King's Hand to prevent Fool?"
→ Asked regardless of whether B actually has King's Hand
```

### Scenario 2: Assassin vs King Flip with Stranger
```
Player A flips King
Player B could have:
  - Assassin (prevent king flips)
  - Stranger (court has King's Hand to copy)
→ "Player B, do you want to use Assassin reaction?"
→ "Player B, do you want to use Stranger reaction?"
→ Both asked regardless of actual hand contents
```

### Scenario 3: Multiple Possible Reactions
```
Court: [King's Hand, Mystic]
Player A uses Soldier ability
Player B could have:
  - King's Hand (not visible, could be in hand/army)
  - Stranger (could copy King's Hand from court)
→ Both reactions prompted
```

## Strategic Elements

### 🎭 **Bluffing Opportunities**
- Players can claim to have reactions they don't possess
- Illegal moves result in penalties, creating risk/reward
- Information warfare through reaction claims

### 🧠 **Bot Intelligence**
- **10% bluff rate** for King's Hand when not held
- **5% bluff rate** for other reactions when not held
- **Smart usage** based on card values and game state

### ⚖️ **Balance Mechanisms**
- Penalties for false reaction claims
- Risk/reward for bluffing
- Maintains competitive integrity

## Implementation Details

### Key Classes
- `CardAbilityManager` - Central reaction coordinator
- `checkUniversalReactions()` - Main reaction checker
- `couldPlayerHaveCard()` - Visibility zone analyzer
- `executeReaction()` - Reaction ability executor

### Trigger Types
- `'ability'` - Card abilities (King's Hand, Stranger copying)
- `'kingFlip'` - King flip attempts (Assassin, Stranger copying)
- `'turnStart'` - Turn-based reactions (Arbiter, Impersonator)

### Visibility Zones Checked
```typescript
const visibleZones = [
  ...player.antechamber,    // Opponent can see
  ...player.condemned,      // Public knowledge
  ...state.court.map(c => c.card),  // Everyone can see
  state.accused,            // Public card
  ...state.condemned,       // Public pile
  ...player.exhaustedArmy   // Visible if exhausted
  // NOTE: hand and active army remain hidden
];
```

## Benefits

✅ **Perfect Information Hiding** - No hand content leakage
✅ **Strategic Depth** - Bluffing with any reaction card
✅ **Competitive Balance** - Risk/reward for false claims
✅ **Universal Coverage** - Same system for all reactions
✅ **Extensible Design** - Easy to add new reaction cards

This system captures the essence of high-level competitive card games where maintaining hidden information is crucial for strategic gameplay.
