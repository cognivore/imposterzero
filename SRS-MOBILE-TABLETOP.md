# SRS-002: Mobile Tabletop Experience

**Project:** Imposter Kings
**Author:** cognivore
**Date:** 2026-03-10
**Status:** Draft
**Priority:** High
**Scope:** Mobile play experience only. The desktop `TabletopLayout` (SRS-001) is unaffected.

---

## 1. Scope and Context

This SRS covers exclusively the mobile and small-screen play experience for Imposter Kings. The game is 100% browser-based, runs in any modern browser, and uses no native platform APIs. The desktop tabletop layout defined in SRS-001 remains the canonical experience for large viewports. This document specifies how the same game renders on smaller screens in landscape orientation.

The current implementation already has a `TabletopLayout` component (~1500 lines) that handles all in-game phases in a unified grid. The task here is to define a **separate rendering mode within that same component** (or a sibling) that activates on mobile-class viewports, dramatically simplifying the visible surface while keeping full game functionality accessible through a shallow modal hierarchy.

---

## 2. Orientation and Viewport Detection

### 2.1 Problem

The game is a landscape card game. Portrait orientation on small screens does not provide enough horizontal space to render even a minimal hand of cards. Portrait must be blocked with a clear prompt to rotate.

### 2.2 Industry-Standard Detection Methods

Since this is a pure browser application with no native dependencies, detection must rely on standard Web APIs. The following are the recommended approaches, listed in order of reliability:

**Primary: CSS `orientation` media feature + viewport dimensions.**
The CSS media query `(orientation: portrait)` fires when `height > width`. Combined with a max-width/max-height check, this reliably detects small-screen portrait. This is the most widely supported method (all browsers since ~2012) and responds instantly to device rotation, window resize, and split-screen changes.

```css
@media (orientation: portrait) and (max-width: 960px) {
  .landscape-overlay { display: flex; }
  .tabletop { display: none; }
}
```

**Secondary: JavaScript `matchMedia` listener.**
The current `useOrientation` hook already uses this approach. It listens to `(orientation: portrait)` and `(max-width: 767px)` via `window.matchMedia`. This is correct but the max-width threshold should be revisited (see §2.3).

**Tertiary (optional enhancement): Screen Orientation API.**
`screen.orientation.type` returns `"portrait-primary"`, `"landscape-primary"`, etc. The `screen.orientation.lock("landscape")` method can attempt to lock orientation on supported mobile browsers (primarily Chrome on Android; Safari does not support it outside of fullscreen). This is purely an enhancement — the game must not depend on it working.

**Not recommended:**
- `window.orientation` (deprecated, removed from standards).
- `deviceorientation` events (gyroscope data — overkill, battery-draining, and unreliable for layout decisions).
- User-Agent string sniffing (brittle, does not account for tablets, foldables, desktop browsers resized small, or browser spoofing).

### 2.3 Threshold Definition

The mobile layout activates when the viewport matches **all** of the following:

| Condition | Rationale |
|-----------|-----------|
| `max-width: 960px` in landscape | Screens narrower than 960px landscape cannot fit the full desktop 3-column grid legibly. 960px covers all phones in landscape and most small tablets. |
| OR `max-height: 540px` in landscape | Very short viewports (e.g., phones with wide aspect ratios like 21:9) need the compact layout even if width exceeds 960px. |

**Portrait blocking** activates when:

| Condition | Rationale |
|-----------|-----------|
| `orientation: portrait` AND `max-width: 960px` | Any small-screen portrait viewport. Large tablets (e.g., iPad in portrait at 1024px width) may technically work but are not a design target; portrait block is acceptable. |

The current hook uses `max-width: 767px` which is too narrow — it misses phones in portrait that are 768–960px (e.g., iPad Mini, large Android phones in scaled mode). Update to 960px.

### 2.4 Implementation

Update `useOrientation.ts`:

```ts
interface OrientationState {
  readonly isPortrait: boolean;
  readonly isMobile: boolean;        // true when viewport is mobile-class
  readonly requiresLandscape: boolean; // true when portrait must be blocked
}
```

- `isMobile`: `true` when landscape width ≤ 960px OR landscape height ≤ 540px.
- `isPortrait`: `true` when `(orientation: portrait)` matches.
- `requiresLandscape`: `isPortrait && isMobile`.

The `TabletopLayout` component reads `isMobile` to decide whether to render the desktop grid or the mobile layout. The `App` component reads `requiresLandscape` to render the `LandscapeOverlay`, exactly as it does today.

---

## 3. Mobile Layout Design Philosophy

The mobile layout strips the table down to what the player needs for moment-to-moment decisions. Everything else is one tap away, never more. The metaphor shifts from "surveying a full table" to "focused play area with quick-peek drawers."

Core principles:

1. **Court + Hand + Dialogs are the permanent view.** These three things are always visible.
2. **Preview + Log live in a left sidebar.** The left column collapses to a tap-to-reveal sliding drawer.
3. **Player zones (hero and opponents) live behind tap-to-open modals.** Tapping a player icon opens a modal showing all their zones. This is the one place where modals ARE permitted on mobile — and they are intentional, shallow (one level), and always dismissible.
4. **Small cards everywhere except preview.** The hand, court, antechamber, parting zone — all use `--card-sm`. Only the preview panel uses `--card-lg`.
5. **Landscape only.** Portrait is blocked. Period.

---

## 4. Mobile Layout Specification

### 4.1 Screen Regions

In landscape on a mobile-class viewport, the screen is divided into three horizontal bands:

```
┌──────────────────────────────────────────────────────┐
│ [☰]  Court (small cards, overlaid)    [P2] [P3] [Me] │
│       + Primary Dialog Area                           │
│       + Secondary / Tertiary Dialog Area              │
├──────────────────────────────────────────────────────┤
│  [Antechamber slots]    [Parting Zone slots]          │
├──────────────────────────────────────────────────────┤
│  Hero's Hand (small cards, fits 9)                    │
└──────────────────────────────────────────────────────┘
```

**Top region (~55–60% of viewport height):** Contains the Court stack, the three dialog areas vertically stacked (Primary, then Secondary+Tertiary side by side below), and action buttons. This is the main play surface.

**Middle strip (~10%):** Hero's Antechamber (left) and Parting Zone (right). Usually empty. When populated (Judge, Inquisitor effects), cards appear here at small size.

**Bottom strip (~30–35%):** Hero's Hand. Small cards. Must fit 9 cards across in landscape at the minimum supported phone width (~640px landscape). At `--card-sm` ~50–60px width, 9 cards = ~500px, which fits with spacing.

### 4.2 Top Bar Icons

Across the top of the screen, flush against the top edge:

| Position | Element | Behavior |
|----------|---------|----------|
| Far left | **Drawer icon** (`☰` hamburger) | Tapping opens the left sliding drawer (Preview + unified Log). |
| Center | **Phase / Turn indicator** | Text: "Setup Phase", "Your turn", "Waiting for PlayerName..." |
| Right side | **Player icons** (one per opponent + one for hero) | Small circular badges or card-back thumbnails with player color borders. Tapping opens that player's zone modal. Active player icon pulses or glows. |

### 4.3 Left Drawer (Preview + Unified Log)

On mobile, the Match Log and Game Log are merged into a single scrollable **Unified Log**. There is no need for two separate log areas on a small screen.

The left drawer slides in from the left edge, covering ~75% of the screen width. It contains:

1. **Card Preview (top):** Large card. On mobile, since hover is not available, this shows the last card tapped. Tapping any card anywhere on the table updates the preview and opens the drawer if it is closed. A second tap on the same card (or a tap on the X / swipe-away) closes the drawer.
2. **Unified Log (below preview):** Single scrollable list combining match events and turn-by-turn game log entries. Match-level events (round start/end, draft results) are interspersed chronologically with play events. This replaces both `MatchLog` and `GameLog` from the desktop layout.

The drawer is dismissed by tapping outside it, tapping the `☰` icon again, or swiping left.

### 4.4 Player Zone Modals

Tapping a player icon in the top bar opens a **Player Zone Modal**. This is a full-height panel (sliding in from the right, or a centered modal — implementation choice) showing all zones for that player.

#### 4.4.1 Opponent Zone Modal

When tapping an opponent's icon, the modal shows:

```
┌─────────────────────────────┐
│  [X]  PlayerName             │
│                              │
│  ┌───┐ ┌───┐ ┌───┐  ┌───┐  │
│  │ S │ │ D │ │ Sq │  │ K │  │
│  │(▼)│ │(▼)│ │(▼) │  │(▼)│  │
│  └───┘ └───┘ └───┘  └───┘  │
│                              │
│  Army (N)  ►    Exhaust (N) ►│
│                              │
│  Hand Helper: ...            │
└─────────────────────────────┘
```

- **Successor, Dungeon, Squire:** Shown face-down (card backs) at small size. Squire slot only present if the opponent's King facet is Master Tactician.
- **King:** Shown face-down at small size (unless revealed by game effect).
- **Army:** Shown as a labeled count badge. **Tappable.** Tapping opens a **sub-modal** showing all army cards face-down at small size.
- **Exhaust + Discarded:** Shown as a labeled count badge. **Tappable.** Tapping opens a sub-modal showing exhausted cards (face-up, small) and any cards discarded from hand this round (face-up, small), clearly separated with labels.
- **Hand Helper:** Text line showing deduced hand information.
- **Antechamber / Parting Zone:** If populated (rare), shown as small cards at the top of the modal.

**Sub-modal behavior:** A sub-modal (e.g., tapping "Exhaust") opens in front of the player modal. It shows the card detail and has an X button or tap-outside to dismiss. Dismissing the sub-modal returns to the player modal. Dismissing the player modal returns to the game table. Maximum depth is always 2 (player modal → sub-modal). Never deeper.

#### 4.4.2 Hero Zone Modal

When tapping the hero's own icon, the modal shows the same structure but with face-up cards:

- **King:** Face-up.
- **Successor:** Face-up (hero can see their own).
- **Dungeon:** Face-up.
- **Squire:** Face-up (if present).
- **Army:** Tappable. Opens sub-modal with all army cards face-up at small size.
- **Exhaust:** Tappable. Opens sub-modal with exhausted cards face-up.

### 4.5 Opponent Antechamber and Parting Zone

On the desktop layout, each opponent's Antechamber and Parting Zone are visible in the right column at all times. On mobile, these are shown in two places:

1. **Inside the opponent's Player Zone Modal** (when opened).
2. **On the main table, near the court** if currently populated (since cards in antechamber/parting are tactically relevant and time-sensitive). These appear as small cards along the top edge of the court area, labeled with the opponent's name. When empty (the common case), they take no space.

### 4.6 Card Size on Mobile

| Element | Size | Notes |
|---------|------|-------|
| Hero's Hand | Small (`--card-sm`) | Fits 9 across at ~50–60px each. |
| Court stack | Small | Same overlaid style as desktop but smaller. |
| Antechamber / Parting Zone | Small | Both hero's and opponents'. |
| Player zone modal cards | Small | K/S/Sq/D, Army, Exhaust all small. |
| Sub-modal card detail | Small | Exhaust cards, army cards. |
| Preview (left drawer) | Large (`--card-lg`) | Full artwork, text, keywords. |

The Medium tier (`--card-md`) is not used on mobile. Everything is Small except the one card in the Preview.

### 4.7 Touch Interactions

| Gesture | Target | Result |
|---------|--------|--------|
| **Tap** | Hand card (playable) | Plays the card (during play phase). |
| **Tap** | Hand card (setup phase) | Selects for Successor/Dungeon assignment. |
| **Long-press** or **double-tap** | Any card | Opens left drawer with that card in Preview. |
| **Tap** | Player icon (top bar) | Opens Player Zone Modal. |
| **Tap** | `☰` hamburger | Toggles left drawer. |
| **Tap** | Modal X / outside modal | Closes modal. |
| **Swipe left** | Left drawer | Closes drawer. |
| **Tap** | Dialog button | Executes action (choice, recruit, etc.). |

Note: hover is not available on touch devices. The "hover to preview" mechanic from desktop becomes "long-press or double-tap to preview" on mobile.

---

## 5. Dialog Areas on Mobile

The three dialog areas (Primary, Secondary, Tertiary) still exist on mobile but are rendered inline in the top region, stacked vertically below the court. They are the same content slots as on desktop — same phase-specific content from SRS-001 §5 applies — but rendered more compactly.

When Secondary and Tertiary are both empty (the common case during play), the Primary dialog area expands to fill the available space. When Tertiary is not needed, Secondary expands to full width. The collapsing logic is identical to desktop.

During mustering, the Secondary and Tertiary areas show Army and Exhaust cards at small size (instead of the desktop layout which puts them in dedicated grid columns). These cards are interactive (tappable for recruit/recommission selection) just as on desktop.

---

## 6. Unified Log Specification

On mobile, the separate Match Log and Game Log are merged into a single Unified Log rendered inside the left drawer. The merge is purely presentational — the underlying `useGameLogStore` data model is unchanged.

The Unified Log displays all entries from `useGameLogStore` in chronological order, with visual differentiation:

| Entry Kind | Visual Treatment |
|------------|-----------------|
| `round_start`, `round_end` | Bold system text, full-width separator. |
| `play`, `disgrace`, `commit` | Player name (colored) + description. Turn number badge. |
| `mustering` | Player name + description. Indented slightly. |
| `trace` | Monospace, indented by depth. Dimmed color. |

This is functionally the current `GameLog` component with `MatchLog` entries interspersed. No data model changes required.

---

## 7. Acceptance Criteria

1. **AC-M1: Portrait block.** On viewports ≤960px wide in portrait orientation, `LandscapeOverlay` renders and the game is hidden. No gameplay is possible in portrait.
2. **AC-M2: Mobile layout activation.** On viewports ≤960px wide (or ≤540px tall) in landscape, the mobile layout renders instead of the desktop tabletop grid.
3. **AC-M3: Persistent table.** Court, dialog areas, hero's antechamber/parting zone, and hero's hand are always visible on the mobile table. They occupy fixed screen regions that do not change between phases.
4. **AC-M4: Player modals.** Tapping a player icon opens a modal showing all of that player's zones. Modal has an X to dismiss and dismisses on tap-outside.
5. **AC-M5: Sub-modals.** Tapping "Army" or "Exhaust" within a player modal opens a sub-modal showing those cards. Sub-modal dismisses back to the player modal. Maximum modal depth is 2.
6. **AC-M6: Left drawer.** The `☰` icon opens a sliding left drawer containing the card preview (large) and unified log. Drawer dismisses on tap-outside, re-tap hamburger, or swipe-left.
7. **AC-M7: Card preview via touch.** Long-press or double-tap on any card opens the left drawer with that card shown at large size in the preview area.
8. **AC-M8: Small cards everywhere.** All cards on the mobile table render at `--card-sm`. Only the preview card in the left drawer renders at `--card-lg`. Medium size is not used.
9. **AC-M9: 9-card hand.** The hand strip fits 9 small cards across without horizontal scroll at the minimum supported landscape width (640px).
10. **AC-M10: Game logic unchanged.** All WebSocket messages, state management, and action dispatch are identical to desktop. This is a presentation-layer adaptation only.
11. **AC-M11: No orphaned overlays.** When the viewport transitions from mobile to desktop (e.g., rotating a tablet from landscape-narrow to landscape-wide, or resizing a browser window), any open mobile modals or drawers are dismissed and the desktop layout takes over cleanly.

---

## 8. Out of Scope

- Desktop layout changes (SRS-001 is unaffected).
- Portrait mode gameplay of any kind.
- Offline or PWA support.
- Server-side changes.
- Game rule or balance changes.
- Accessibility beyond standard ARIA roles on modals and buttons.
- Drag-and-drop interactions (tap-to-act only on mobile).

---

## 9. Implementation Notes

### 9.1 Conditional Rendering in TabletopLayout

The `TabletopLayout` component should branch on `isMobile` near the top of its render:

```tsx
const { isMobile } = useOrientation();

if (isMobile) {
  return <MobileTabletop phase={phase} send={send} />;
}

return (
  <div className="tabletop">
    {/* ...existing desktop grid... */}
  </div>
);
```

`MobileTabletop` is a new component (or a section within `TabletopLayout`) that reuses all the existing phase-specific content components (`DraftContent`, `CrownContent`, `MusteringContent`, `MusteringSecondary`, `MusteringTertiary`, `SetupContent`, `ChoiceBarContent`, `ScoringContent`, etc.) but renders them in the mobile layout structure instead of the desktop grid.

### 9.2 Modal State

Mobile modals (player zones, sub-modals, left drawer) are local UI state, managed by a Zustand store or `useState` in `MobileTabletop`:

```ts
interface MobileUIState {
  drawerOpen: boolean;
  playerModalOpen: PlayerId | "hero" | null;
  subModal: "army" | "exhaust" | null;
}
```

### 9.3 Shared Content Components

All phase-specific dialog content (`DraftContent`, `CrownContent`, `MusteringContent`, `ChoiceBarContent`, scoring tables, etc.) are already extracted as standalone components inside `TabletopLayout.tsx`. These are reused as-is in the mobile layout — they render inside the mobile dialog area instead of the desktop grid slot. No logic changes are needed in these components; only their container changes.

### 9.4 CSS Strategy

The mobile layout uses a completely separate CSS grid (not media-query overrides on the desktop grid). The desktop `.tabletop` class and the mobile `.tabletop-mobile` class are mutually exclusive, toggled by the `isMobile` branch. This avoids cascading complexity and makes each layout independently maintainable.

```css
.tabletop-mobile {
  display: grid;
  grid-template-rows: auto 1fr auto auto;
  grid-template-columns: 1fr;
  height: 100vh;
  height: 100dvh; /* dynamic viewport height for mobile browsers */
  overflow: hidden;
}
```

Use `100dvh` (dynamic viewport height) to account for mobile browser chrome (URL bar, toolbar) appearing and disappearing.

---

## 10. Migration Strategy

### Phase 1: Orientation and Detection
Update `useOrientation` hook to the new threshold (960px / 540px). Add `isMobile` to the returned state. Verify `LandscapeOverlay` fires correctly on portrait at new threshold. Verify AC-M1.

### Phase 2: Mobile Skeleton
Create `MobileTabletop` component with the three-band layout (court+dialogs, antechamber/parting, hand). Wire it into `TabletopLayout` behind the `isMobile` branch. Render placeholder content. Verify AC-M2 and AC-M3.

### Phase 3: Player Zone Modals
Implement the player icon top bar and player zone modals (opponent and hero). Implement sub-modals for Army and Exhaust drill-down. Verify AC-M4 and AC-M5.

### Phase 4: Left Drawer
Implement the sliding left drawer with card preview and unified log. Implement long-press/double-tap to preview. Verify AC-M6 and AC-M7.

### Phase 5: Content Wiring
Wire all existing phase content components into the mobile dialog areas. Verify each phase (drafting, crown, mustering, setup, play, resolving, scoring, finished) renders correctly in the mobile layout. Verify AC-M8 and AC-M9.

### Phase 6: Viewport Transition Polish
Test and handle transitions between mobile and desktop (resize, rotation). Ensure modal cleanup on viewport change. Verify AC-M11.
