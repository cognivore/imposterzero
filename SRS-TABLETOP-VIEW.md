# SRS-001: Unified Tabletop View

**Project:** Imposter Kings
**Author:** cognivore
**Date:** 2026-03-08
**Status:** Draft
**Priority:** Critical (UX Overhaul)

---

## 1. Problem Statement

The current Imposter Kings UI renders each game phase (`crown`, `mustering`, `drafting`, `setup`, `play`, `resolving`, `scoring`) as an entirely different React component tree with its own layout, CSS grid, and spatial logic. `CrownView` is a centered column. `MusteringView` is a bespoke layout. `GameLayout` is a 3-column grid. `ScoringView` is a vertical stack. `DraftView` is a card-picker page. The player is yanked between unrelated screens.

Modals and overlays compound the problem: `CardInspectModal` (z-index 200), `LandscapeOverlay` (z-index 9999), `PreviewZone` (fixed-position floating panel), `InlineChoiceBar` (embedded inside `CourtZone` with overflow risk). There is no persistent spatial anchor — the player never develops a mental model of where things are because the table keeps being replaced.

**The fix:** One persistent tabletop layout from the moment gameplay begins (post-lobby) through scoring. Phase transitions change what is shown in designated table zones, not the table itself.

---

## 2. Design Philosophy

The metaphor is a physical card table seen from above — like Tabletop Simulator, not a JRPG menu system with pop-up windows.

1. **Single persistent viewport.** Once the match starts, the player sees one table. It never goes away. No full-screen phase transitions. No view swaps.
2. **Zones, not windows.** Every piece of game information has a designated spatial zone on the table surface. Cards move between zones; zones don't appear and disappear.
3. **Dialog areas are table regions, not modals.** The Primary, Secondary, and Tertiary dialog areas are reserved rectangular regions of the table surface. They are always present (possibly empty). Content slides into them; nothing pops over the table.
4. **No modal obscures the table.** `CardInspectModal` is eliminated. Card preview is handled by the large preview in the left column. `LandscapeOverlay` is the sole permitted full-screen overlay (hardware orientation constraint, not a dialog).

---

## 3. Card Size System

The layout uses three card size tiers. All sizes are defined as CSS custom properties and scale proportionally based on the viewport. The reference design targets a 1920×1080 viewport.

### 3.1 Size Tiers

| Tier | Token | Reference Width | Usage |
|------|-------|-----------------|-------|
| **Large** | `--card-lg` | ~180–220px | Card preview in left column. One card at a time, showing full artwork, name, value, keywords, rules text, and flavor text. |
| **Medium** | `--card-md` | ~100–128px | Hero's Hand cards. Also Antechamber and Parting Zone cards (both hero's and opponents'). Must fit 9 cards side-by-side within the Hand strip at the reference viewport. |
| **Small** | `--card-sm` | ~65–85px | Court stack cards (overlaid). Hero's King, Successor, Squire, Dungeon zone cards. Opponent summary zone cards (King, Successor, Squire, Dungeon). Army and Exhaust pile cards. Accused, Forgotten, Condemned cards. |

### 3.2 Scaling Behavior

All three tiers scale together using a single `--card-scale` factor derived from the viewport's smaller effective dimension. The ratio between tiers remains constant: `--card-lg ≈ 2× --card-md ≈ 3× --card-sm`. Card aspect ratio is fixed at 5:7 (width:height).

At the reference 1920×1080 landscape viewport, `--card-scale: 1`. The layout must remain fully functional down to approximately 1280×720. Below that, the `LandscapeOverlay` may intervene (see §7).

---

## 4. Tabletop Layout Specification

### 4.1 Master Grid

The entire game surface is a single CSS grid that persists from `drafting` through `finished`. It never unmounts. The layout is divided into three horizontal bands: **left column**, **center stage**, and **right column**, with a full-width **hand strip** across the bottom.

```
┌─────────────┬──────────────────────────────────────────────┬────────────────────┐
│             │                                              │ P2 Parting │ P2    │
│ Match Log   │           Court                              │ Zone       │ Ante- │
│ (scrollable │   (small cards, overlaid stack,              │            │chamber│
│  text)      │    "Active Player Spotlight")                ├────────────┼───────┤
│             │                                              │ P2 King    │ P2    │
│             │                                              │ P2 Succ.   │ Army  │
│             │                                              │ P2 Squire  │ P2    │
├─────────────┤                                              │ P2 Dungeon │Exh.   │
│             │   Court (continued)                          ├────────────┴───────┤
│ Card        │                                              │ Accused │Forgotten│
│ Preview     ├──────────────────────────────────────────────┤         │         │
│ (large      │  Primary Dialog Area                         │ Condemned           │
│  card,      │                                              │                     │
│  shows      ├──────────────────────┬───────────────────────┤                     │
│  hovered    │  Secondary           │ Tertiary              │                     │
│  card)      │  Dialog Area         │ Dialog Area           │                     │
│             │                      │ (optional,            │                     │
├─────────────┤  Hero's    Hero's    │  collapses into       ├─────────────────────┤
│             │  Ante-     Parting   │  secondary when       │ Hero's King         │
│ Game Log    │  chamber   Zone      │  not needed)          │ Hero's Successor    │
│ (scrollable │                      │                       │ Hero's Squire       │
│  text)      │                      │                       │ Hero's Dungeon      │
│             │                      │                       │ Hero's Army  Hero's │
│             │                      │                       │              Exhaust│
├─────────────┴──────────────────────┴───────────────────────┴─────────────────────┤
│                                                                                  │
│                              Hero's Hand                                         │
│                  (medium cards, fits 9 cards side-by-side)                        │
│                                                                                  │
└──────────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Left Column

The left column is a fixed-width vertical stack (~15–18% of viewport width), divided into three sections top-to-bottom:

**Match Log (top):** Scrollable text area showing history of all previous rounds, pre-game actions (draft selections, signature card procedures), and match-level events. This is persistent context — it does not clear between rounds.

**Card Preview (middle):** Displays a single large-tier card. By default, shows a contextually relevant card (e.g., the top court card, or the last card played). When the player hovers any card anywhere on the table, the preview immediately updates to show that card at large size with full artwork, name, value, keywords, rules text, and flavor text. When hover ends, it reverts to the default.

**Game Log (bottom):** Scrollable text area showing the turn-by-turn event log for the current round. This is the equivalent of the current `LeftRail`. Auto-scrolls to latest entry, with a manual "jump to bottom" indicator when the user has scrolled up.

### 4.3 Center Stage

The center stage occupies the majority of the table surface. It is subdivided vertically:

**Court (top, largest allocation):** The throne card stack rendered as overlapping small-tier cards in the visual style shown in the mockup. This zone must accommodate the theoretical maximum number of cards that can be played to court in a round. The "Active Player Spotlight" label or indicator is overlaid here. During pre-play phases (drafting, crown, mustering, setup) where the court is empty, this zone still reserves its space — it may show a muted "Court" label or round/phase indicator.

**Primary Dialog Area (middle):** A generous horizontal band below the court. This is where phase-specific choice menus, action buttons, confirmations, and interactive prompts appear. During the play phase it may be mostly empty (just a turn indicator). During resolving, this is where the choice bar renders. Always present in the DOM; renders as transparent table felt when empty.

**Secondary Dialog Area (lower-left, ~66% width):** Tangential information or secondary selections relevant to the current game action. For example, during mustering this shows the hero's Army cards for selection. The hero's Antechamber and Parting Zone card slots live within this spatial region (but must not be overlapped by dialog content — see §4.4).

**Tertiary Dialog Area (lower-right, ~33% width):** Informational display, such as already-exhausted cards during recruiting. When not needed, this area collapses and its space is absorbed by the Secondary Dialog Area, which then spans the full width.

### 4.4 Hero's Antechamber and Parting Zone

These two card zones sit within the lower portion of center stage, visually between/alongside the Secondary and Tertiary dialog areas. They display medium-tier cards (same size as Hand cards). Typical occupancy is 0–2 cards each (Antechamber used by cards like Judge and Inquisitor; Parting Zone almost always empty).

**Critical constraint:** Secondary and Tertiary dialog area content must never overlap or obscure cards in the Antechamber or Parting Zone. The dialog areas and these card zones coexist in the same row but occupy distinct, non-overlapping sub-regions. Implementation may use a nested flex or grid within the row to enforce this separation.

### 4.5 Right Column — Opponent Zones (Top Half)

The right column's upper portion displays the zones of one or more opponents. The same zone layout repeats per opponent. In a 2-player game, one opponent (Player 2). In a 3-player game, two opponents. In a 2v2 game, both opponents (Players 2 and 4) and the ally (Player 3), with opponents visually distinguished from the ally.

Per-opponent zone layout (top to bottom within their section):

| Sub-zone | Card Size | Notes |
|----------|-----------|-------|
| **Parting Zone** | Medium | Side-by-side with Antechamber. Almost always empty. |
| **Antechamber** | Medium | Side-by-side with Parting Zone. 0–2 cards typically. |
| **King** | Small | Face-down (back) unless revealed by game effect. |
| **Successor** | Small | Face-down. |
| **Squire** | Small | May be absent (not all game configurations include Squire). Face-down. |
| **Dungeon** | Small | Face-down. |
| **Army** | Small | Stack/fan of face-down cards. Shows count badge. |
| **Exhaust** | Small | Column/stack of face-up exhausted cards. |
| **Hand Helper** | Text/badge | Shows deduced possible hand information. Not cards — textual indicator. |

When multiple opponents exist, their zone blocks stack vertically within the right column's top half, each with a player name header and color indicator.

### 4.6 Right Column — Shared Zones (Middle)

Below the opponent zones, the right column shows the shared game zones:

| Zone | Card Size | Notes |
|------|-----------|-------|
| **Accused** | Small | Single card slot. Empty or occupied. |
| **Forgotten** | Small | Single card slot. Face-down (back). |
| **Condemned** | Small | Stack. May hold multiple cards. |

### 4.7 Right Column — Hero Zones (Bottom)

The bottom-right corner mirrors the opponent zone structure but for the currently connected player:

| Sub-zone | Card Size | Notes |
|----------|-----------|-------|
| **King** | Small | Face-up (hero can see their own King). |
| **Successor** | Small | Face-down to opponents; hero sees a peek/preview via `forcePreview`. |
| **Squire** | Small | Same as Successor. May be absent. |
| **Dungeon** | Small | Face-down to opponents; hero sees peek/preview. |
| **Army** | Small | Fan of face-up cards (hero can see own Army). Count badge. |
| **Exhaust** | Small | Column of face-up exhausted cards. |

### 4.8 Hand Strip (Bottom, Full Width)

Spans the entire bottom edge of the viewport from the left column's right edge through to the right column's left edge. Displays the hero's hand cards at medium-tier size.

**Sizing constraint:** The hand strip must be wide enough and the medium card size must be calibrated so that 9 cards fit side-by-side without horizontal scrolling at the reference viewport (1920×1080). If the hand contains more than 9 cards (edge case), cards compress slightly or a minimal horizontal scroll activates.

Action buttons (Commit Setup, Disgrace, End Mustering, etc.) are rendered inline within or immediately above the Hand strip, contextually per phase.

---

## 5. Dialog Area Behavior Per Phase

The dialog areas are content slots, not standalone components. Each phase populates them differently. An empty slot renders as transparent table felt.

### 5.1 Drafting Phase

| Zone | Content |
|------|---------|
| Court | Empty (no court yet). Shows match title or "Round N" indicator. |
| Primary Dialog | Signature card pool (up to 9 cards). Selection UI with checkboxes/toggles and confirm button. |
| Secondary Dialog | Rules reminder: "Choose N signatures for your army." |
| Tertiary Dialog | Collapses into Secondary. |
| Hero's Hand | Empty or placeholder text. |
| Opponent Zones | Show opponent names and ready/waiting status. |

### 5.2 Crown Phase

| Zone | Content |
|------|---------|
| Court | Empty court. Accused/Forgotten slots visible if carried from previous round. |
| Primary Dialog | "You are the True King. Choose who plays first." with player-choice buttons. OR "PlayerName is choosing who plays first..." waiting state. |
| Secondary Dialog | Empty. |
| Tertiary Dialog | Collapses into Secondary. |
| Hero's Hand | Full hand display (the dealt hand). |
| Opponent Zones | Show opponent hand counts. |

### 5.3 Mustering Phase

| Zone | Content |
|------|---------|
| Court | Empty. Accused slot visible if populated. |
| Primary Dialog | Mustering action controls: status text, "Exhaust to recruit" / "Recruit" / "Recommission" / "Done" buttons. Selected-card confirmation when applicable. |
| Secondary Dialog | Hero's Army cards at small size (selectable for exhaust or recommission). |
| Tertiary Dialog | Hero's Exhausted cards at small size (selectable for recommission recovery). If no exhausted cards, Tertiary collapses and Secondary expands to full width. |
| Hero's Hand | Full hand. Cards selectable for Recruit discard when applicable. |
| Opponent Zones | Each opponent's exhausted cards (small) and recruit-discard activity. Mirrors current `OpponentMustering` data. |

### 5.4 Setup Phase

| Zone | Content |
|------|---------|
| Court | Empty. |
| Primary Dialog | Setup instruction: "Select Successor, then Dungeon from your hand." Shows setup slot previews (two selected cards in gold/purple frames). Commit button. |
| Secondary Dialog | Empty. |
| Tertiary Dialog | Collapses into Secondary. |
| Hero's Hand | Full hand. Cards clickable to assign as Successor/Dungeon. Selected cards highlighted. |
| Hero Zones (right) | K/S/D slots animate as cards are assigned. Pending selections shown as semi-transparent previews. |

### 5.5 Play Phase

| Zone | Content |
|------|---------|
| Court | Active throne stack with cards accumulating. |
| Primary Dialog | Minimal turn indicator: "Your turn" / "Waiting for PlayerName." Possibly empty if the court area itself serves as the focus. |
| Secondary Dialog | Empty. |
| Tertiary Dialog | Collapses into Secondary. |
| Hero's Hand | Full hand. Playable cards highlighted. Click-to-play. Disgrace button visible. |
| Opponent Zones | Full opponent panels with hand-helper data. Active player highlighted with border/glow. |

### 5.6 Resolving Phase

| Zone | Content |
|------|---------|
| Court | Throne stack in current state. The resolving card visually emphasized (glow/pulse). |
| Primary Dialog | **The choice bar.** Shows context (card name + choice type), option buttons (card / player / cardName / value / pass / proceed / yesNo), and waiting state when another player is choosing. This replaces the current `InlineChoiceBar` that was crammed inside `CourtZone`. |
| Secondary Dialog | If the choice involves selecting from a set of cards (e.g., "choose a card"), display those cards here at readable size. |
| Tertiary Dialog | Resolution trace steps (the indented effect log). Provides immediate context for what is resolving and why. |
| Hero's Hand | Visible but non-interactive unless a choice involves hand cards. |

### 5.7 Scoring Phase

| Zone | Content |
|------|---------|
| Court | Final court state. All court cards visible for review. |
| Primary Dialog | Score table (round scores, match totals). Ready button. Player ready-status badges. |
| Secondary Dialog | Player reveals: each player's K/S/D/Hand laid out for inspection. |
| Tertiary Dialog | Shared zone reveals: Forgotten, Accused, Condemned cards at scoring time. |
| Hero's Hand | Hero's remaining hand cards (face-up for review). |

---

## 6. Component Architecture Changes

### 6.1 New: `TabletopLayout`

Replaces `GameLayout` and the per-phase view switch in `App.tsx` for all in-game phases.

```tsx
const TabletopLayout: React.FC<{ phase: InGamePhase; send: Send }> = ({ phase, send }) => (
  <div className="tabletop">
    <div className="tabletop__left-col">
      <MatchLog />
      <CardPreview />
      <GameLog />
    </div>
    <div className="tabletop__center">
      <CourtArea phase={phase} />
      <PrimaryDialog phase={phase} send={send} />
      <div className="tabletop__lower-dialogs">
        <SecondaryDialog phase={phase} send={send} />
        <HeroAntechamber phase={phase} />
        <HeroPartingZone phase={phase} />
        <TertiaryDialog phase={phase} />
      </div>
    </div>
    <div className="tabletop__right-col">
      <OpponentZones phase={phase} />
      <SharedZones phase={phase} />
      <HeroZones phase={phase} />
    </div>
    <HeroHand phase={phase} send={send} />
  </div>
);
```

Each slot component internally switches on `phase._tag` to render phase-appropriate content. The component itself is always mounted — only its children change.

### 6.2 Refactored: `App.tsx` Phase Router

```tsx
const renderPhase = (phase, send) => {
  switch (phase._tag) {
    case "connecting":
      return <ConnectingScreen />;
    case "browser":
      return <BrowserView phase={phase} send={send} />;
    case "lobby":
      return <LobbyView phase={phase} send={send} />;
    case "drafting":
    case "crown":
    case "mustering":
    case "setup":
    case "play":
    case "resolving":
    case "scoring":
    case "finished":
      return <TabletopLayout phase={phase} send={send} />;
    default:
      return absurd(phase);
  }
};
```

### 6.3 Eliminated Components

| Component | Replacement |
|-----------|-------------|
| `CrownView` | Content distributes into `PrimaryDialog` + `HeroHand`. |
| `MusteringView` | Content distributes across `PrimaryDialog` + `SecondaryDialog` + `TertiaryDialog` + `HeroHand`. |
| `DraftView` | Content renders inside `PrimaryDialog` + `SecondaryDialog`. |
| `SetupView` | Content renders inside `PrimaryDialog` + `HeroHand` + `HeroZones`. |
| `PlayView` | Already merged into `GameLayout`; now part of `TabletopLayout`. |
| `ResolvingView` | Already merged into `GameLayout`; choice bar moves to `PrimaryDialog`. |
| `ScoringView` | Content distributes across `PrimaryDialog` + `SecondaryDialog` + `TertiaryDialog`. |
| `MatchOverView` | Final results in `PrimaryDialog` with "Return to Lobby" button. |
| `CardInspectModal` | **Deleted.** All card inspection handled by the left-column Card Preview. |
| `InlineChoiceBar` | Extracted from `CourtZone`, re-housed as content within `PrimaryDialog` during resolving. |

### 6.4 Preserved Components (Relocated)

| Component | New Location |
|-----------|-------------|
| `CourtZone` | Renders inside `CourtArea` grid slot. Stripped of `InlineChoiceBar`. |
| `HandZone` | Renders inside `HeroHand` grid slot. |
| `LeftRail` (Game Log) | Renders inside left column's Game Log section. |
| `PreviewZone` | **Repurposed** as left column's Card Preview section (no longer a floating fixed-position panel). |
| `RightRail` content | Split: opponent data → `OpponentZones`; hero data → `HeroZones`. |
| `CountdownTimer` | Renders inside `PrimaryDialog` or Court area header depending on phase. |
| `Card` | Unchanged. Gains `size="medium"` variant (see §3). Current `"normal"` renamed to `"medium"`, current `"small"` kept, new `"large"` added for preview. |
| `OpponentPanel` | Preserved, relocated into `OpponentZones`. Expanded to include Parting Zone and Antechamber. |
| `PlayerZones` | Preserved, relocated into `HeroZones` (bottom-right). |

### 6.5 Card Component Size Mapping

Current card sizes map to the new tier system:

| Current Size | Current Token | New Tier | New Token |
|--------------|---------------|----------|-----------|
| `"normal"` | `--card-width` | Medium | `--card-md` |
| `"small"` | `--card-small-width` | Small | `--card-sm` |
| `"micro"` | `--card-micro-width` | *Removed* | Use Small everywhere micro was used |
| `"preview"` | `--card-preview-width` | Large | `--card-lg` |
| — | — | Medium | `--card-md` (new, for Antechamber / Parting Zone) |

The `"micro"` size is eliminated. Anywhere that currently uses `size="micro"` (opponent zone cards, inline choice bar card options) switches to `size="small"`. The previous `"preview"` size was a floating panel detail view; it becomes the `"large"` tier used for the left-column Card Preview.

---

## 7. Viewport and Responsive Behavior

### 7.1 Supported Viewports

This is a tabletop card game. The layout is designed for landscape viewports with reasonable screen real estate. Portrait mode and very small screens are not a design target.

| Category | Viewport Range | Support Level |
|----------|---------------|---------------|
| **Reference** | 1920×1080 | Full layout, `--card-scale: 1`. All zones at their designed proportions. |
| **Comfortable** | 1440×900 to 1920×1080 | Full layout, slight proportional scaling. All zones visible. |
| **Minimum supported** | 1280×720 | Full layout at reduced scale. Cards and text may be tight but fully functional. No zones hidden. |
| **Below minimum** | < 1280×720 | `LandscapeOverlay` activates and blocks gameplay. Message instructs the user to use a larger viewport or rotate to landscape. |

### 7.2 Scaling Strategy

A single `--card-scale` CSS custom property (range ~0.75 to 1.0) is computed from the viewport dimensions and applied to all three card tiers simultaneously. Zone widths, paddings, and font sizes scale proportionally using the same factor or derived `calc()` expressions.

The layout does NOT reflow into a different grid topology at any breakpoint. The three-column-plus-hand-strip structure is the only layout. If the viewport is too small to support it, the game declines to render (via `LandscapeOverlay`).

### 7.3 Landscape Enforcement

On devices that report a portrait orientation and a viewport width below the minimum threshold, the existing `LandscapeOverlay` component renders at z-index 9999 with a "rotate your device" message. This is the sole permitted full-screen overlay. Tablets in landscape that meet the minimum 1280×720 threshold are fully supported.

### 7.4 No Modals, No Popups, No Exceptions

There are exactly zero modals, popups, overlays, or floating panels during gameplay. The `CardInspectModal` is deleted. The `PreviewZone` is not a floating panel — it is an inline section of the left column. The `InlineChoiceBar` is not an overlay — it is content inside the Primary Dialog Area. The only thing that can obscure the tabletop is `LandscapeOverlay`, and it only fires on unsupported viewport geometries.

---

## 8. Transition and Animation Requirements

### 8.1 Phase Transitions

When the phase changes (e.g., `crown` → `setup`), the tabletop grid does NOT unmount or remount. Zone contents cross-fade: old content fades out (opacity 1→0, ~150ms), new content fades in (opacity 0→1, ~150ms). Court cards animate into position using react-spring (existing animation system). Hand cards animate in via the existing `useTrail` system.

A subtle phase-indicator label appears briefly in the court area or primary dialog ("Setup Phase", "Play Phase", etc.) and fades after ~2 seconds.

### 8.2 Card Movement

Cards moving between zones (hand → court, army → exhausted, etc.) should ideally animate spatially across the table surface — absolute positioning during the flight, then settling into the target zone's flow. This is a polish item and may be implemented incrementally.

### 8.3 No Flash of Empty

Zones that will receive new content during a phase transition hold their previous content until the new content is ready, then cross-fade. A blank zone must never flash during transitions.

---

## 9. Acceptance Criteria

1. **AC-1: Single mount.** From `drafting` through `finished`, the `TabletopLayout` component mounts exactly once and never unmounts.
2. **AC-2: No modals.** Zero modal or overlay components render during gameplay. `LandscapeOverlay` is the sole exception and only for unsupported viewport geometry.
3. **AC-3: Spatial persistence.** The left column (Match Log, Card Preview, Game Log), Court Area, Dialog Areas, Opponent Zones, Hero Zones, and Hero's Hand occupy the same screen regions across all phases.
4. **AC-4: Dialog areas.** Primary, Secondary, and Tertiary dialog areas are always present in the DOM. They render phase-appropriate content or render as empty transparent felt.
5. **AC-5: Phase content mapping.** Each phase populates zones according to §5. No phase renders content outside its designated zones.
6. **AC-6: No view-swap flash.** Phase transitions animate smoothly. No blank-screen flicker.
7. **AC-7: Existing game logic unchanged.** All WebSocket messages, game state management (`useGameReducer`), Zustand stores, and action dispatch remain identical. This is a pure presentation-layer refactor.
8. **AC-8: Card sizes.** Three tiers (Large, Medium, Small) are consistently applied per §3. The `micro` size is eliminated. Hand fits 9 medium cards at reference viewport.
9. **AC-9: Card preview.** Hovering any card on the table updates the left-column Card Preview to show that card at large size. Un-hovering reverts to default.
10. **AC-10: Antechamber/Parting safety.** Secondary and Tertiary dialog content never overlaps or obscures Hero's Antechamber or Parting Zone cards.
11. **AC-11: Minimum viewport.** The layout is fully functional at 1280×720. Below that, `LandscapeOverlay` blocks.

---

## 10. Out of Scope

- Server-side changes. This SRS covers the `packages/web` frontend only.
- Game rule changes, new card types, or balance adjustments.
- Lobby and browser views (pre-game, retain their current standalone layouts).
- Drag-and-drop card interaction (future enhancement; click-to-act is sufficient).
- Sound design / audio cues.
- Portrait or mobile-phone layouts. Small screens must use landscape.

---

## 11. Migration Strategy

### Phase 1: Skeleton
Create `TabletopLayout` with the master grid: left column (three sections), center stage (court + dialog areas), right column (opponent/shared/hero zones), hand strip. Wire all gameplay phases (`drafting` through `finished`) to render inside it. Dialog areas render placeholder labels. Verify AC-1 and AC-3.

### Phase 2: Card Size Refactor
Implement the three-tier card size system (Large, Medium, Small). Remove `micro`. Rename existing sizes. Update `Card.tsx` props and CSS custom properties. Verify AC-8.

### Phase 3: Left Column
Relocate Match Log from its current form into the top of the left column. Repurpose `PreviewZone` from a floating fixed-position panel into the left column's inline Card Preview section. Relocate Game Log (`LeftRail`) into the left column's bottom section. Verify AC-9.

### Phase 4: Right Column
Build the opponent zone blocks (Parting, Antechamber, K/S/Sq/D, Army, Exhaust per opponent). Build shared zones (Accused, Forgotten, Condemned). Relocate Hero Zones to bottom-right. Wire to game state. Verify multi-opponent rendering (2p, 3p, 2v2).

### Phase 5: Content Migration
Port each phase's UI content into the appropriate dialog area slots. Order: `play` → `resolving` → `setup` → `crown` → `mustering` → `drafting` → `scoring` → `finished`. Verify AC-5 per phase.

### Phase 6: Modal Elimination
Delete `CardInspectModal`. Remove `InlineChoiceBar` from `CourtZone` and re-house in `PrimaryDialog`. Verify AC-2 and AC-10.

### Phase 7: Animation Polish
Implement cross-fade phase transitions, card movement animations, and phase-indicator labels. Verify AC-6.

### Phase 8: Cleanup
Delete dead components (`CrownView`, `MusteringView`, `DraftView`, `SetupView`, `ScoringView`, `MatchOverView`, `CardInspectModal`). Remove orphaned CSS. Regression test all game logic (AC-7).

---

## Appendix A: Current Component Inventory (Pre-Refactor)

| Component | File | Lines | Fate |
|-----------|------|-------|------|
| `App` | `App.tsx` | 153 | Refactor phase router |
| `GameLayout` | `GameLayout.tsx` | 170 | Replace with `TabletopLayout` |
| `CourtZone` | `CourtZone.tsx` | ~120 | Preserve, strip `InlineChoiceBar` |
| `HandZone` | `HandZone.tsx` | 186 | Preserve, relocate to Hand strip |
| `RightRail` | `RightRail.tsx` | 52 | Split → `OpponentZones` + `HeroZones` |
| `LeftRail` | `LeftRail.tsx` | 91 | Preserve, relocate to left column bottom |
| `PreviewZone` | `PreviewZone.tsx` | 65 | Repurpose as inline left-column Card Preview |
| `InlineChoiceBar` | `InlineChoiceBar.tsx` | 186 | Relocate to `PrimaryDialog` |
| `CardInspectModal` | `CardInspectModal.tsx` | 65 | **Delete** |
| `CrownView` | `CrownView.tsx` | 127 | **Delete** (content migrates to dialog slots) |
| `MusteringView` | `MusteringView.tsx` | 285 | **Delete** (content migrates to dialog slots) |
| `DraftView` | `DraftView.tsx` | 110 | **Delete** (content migrates to dialog slots) |
| `ScoringView` | `ScoringView.tsx` | 222 | **Delete** (content migrates to dialog slots) |
| `MatchOverView` | `MatchOverView.tsx` | ~80 | **Delete** (content migrates to dialog slots) |
| `SetupView` | `SetupView.tsx` | ~60 | **Delete** (content migrates to dialog slots) |
| `LandscapeOverlay` | `LandscapeOverlay.tsx` | ~30 | **Preserve** (sole permitted overlay) |
| `CountdownTimer` | `CountdownTimer.tsx` | ~40 | Preserve, relocate into PrimaryDialog / Court header |
| `Card` | `card/Card.tsx` | ~150 | Preserve, update size prop to 3-tier system |
| `OpponentPanel` | `OpponentPanel.tsx` | ~80 | Preserve, expand for Antechamber/Parting, relocate to right column |
| `PlayerZones` | `PlayerZones.tsx` | ~100 | Preserve, relocate to right column bottom |

## Appendix B: Mockup Reference

The attached mockup image illustrates the target spatial layout. Key observations from the mockup that this SRS codifies:

1. **Left column** contains (top→bottom): Match Log, large Card Preview (Soldier 5 shown), Game Log.
2. **Center stage** contains: Court with overlapping small cards and "Active Player Spotlight", then Primary Dialog Area, then Secondary Dialog Area (~66%) alongside Tertiary Dialog Area (~33%). Hero's Antechamber and Parting Zone occupy labeled slots between the secondary/tertiary areas.
3. **Right column upper** shows Player 2's zones: Parting Zone and Antechamber (medium cards, side by side), then King/Successor/Squire/Dungeon (small, stacked), Army, Exhaust. Pink arrows in the mockup trace the relationships between these zones.
4. **Right column middle** shows shared zones: Accused, Forgotten, Condemned.
5. **Right column lower** shows Hero's zones in the same structure.
6. **Bottom strip** spans full width: Hero's Hand at medium card size.
7. **No modals or floating panels anywhere.** The Card Preview is inline in the left column, not floating.
