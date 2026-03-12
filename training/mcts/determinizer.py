"""
Determinization for IS-MCTS.

The determinizer creates consistent game states by randomizing information
that is hidden from the observer while preserving all information the
observer can see.

Hidden information in Imposter Kings:
- Opponent's hand cards
- Opponent's Successor card (face-down)
- Opponent's Dungeon card (face-down)
- Forgotten card (removed from round)
- Condemned cards (face-down discard pile)

Visible information (preserved):
- Observer's own hand, successor, dungeon
- All court cards (face-up played cards)
- Disgraced cards in court (face-down but visible, value 1)
- The Accused card
- Cards discarded during mustering
- Cards in Exhaust zone
- Army cards (available and exhausted)
- Hand sizes (public)
"""

from __future__ import annotations

import random
from typing import List, Optional, Set, TYPE_CHECKING

if TYPE_CHECKING:
    pass


def clone_and_randomize(state, observer: int, rng: Optional[random.Random] = None):
    """
    Deep clone the game state and randomize information hidden from observer.

    This is the core determinization function for IS-MCTS. It:
    1. Deep clones the entire game state
    2. Preserves everything the observer can see
    3. Randomizes opponent's hidden information

    Args:
        state: The game state (ImposterZeroMatchState or ImposterZeroState)
        observer: The player ID whose perspective we're taking
        rng: Optional random number generator for reproducibility

    Returns:
        A cloned state with randomized hidden information
    """
    if rng is None:
        rng = random.Random()

    # Deep clone the state
    clone = state._clone_impl()

    # Determine number of players
    num_players = getattr(clone, "_num_players", 2)

    # Collect all cards visible to the observer
    visible = _collect_visible_cards(clone, observer, num_players)

    # Collect all hidden card IDs that need to be randomized
    hidden_cards: List[int] = []
    hidden_zones: List[dict] = []  # Track where to put cards back

    for p in range(num_players):
        if p == observer:
            continue

        # Opponent's hand is hidden
        hand_size = len(clone._hands[p])
        if hand_size > 0:
            hidden_cards.extend(clone._hands[p])
            hidden_zones.append({"type": "hand", "player": p, "size": hand_size})

        # Opponent's successor is hidden (if set)
        if clone._successors[p] is not None:
            hidden_cards.append(clone._successors[p])
            hidden_zones.append({"type": "successor", "player": p})

        # Opponent's dungeon is hidden (if set)
        if clone._dungeons[p] is not None:
            hidden_cards.append(clone._dungeons[p])
            hidden_zones.append({"type": "dungeon", "player": p})

    # Forgotten card is hidden (if exists)
    if hasattr(clone, "_forgotten") and clone._forgotten is not None:
        hidden_cards.append(clone._forgotten)
        hidden_zones.append({"type": "forgotten"})

    # Condemned cards are hidden
    if hasattr(clone, "_condemned") and clone._condemned:
        for cid in clone._condemned:
            hidden_cards.append(cid)
        hidden_zones.append({"type": "condemned", "size": len(clone._condemned)})

    # Verify we haven't double-counted (no card should be both visible and hidden)
    hidden_set = set(hidden_cards)
    overlap = visible & hidden_set
    if overlap:
        # This shouldn't happen - indicates a bug
        raise ValueError(f"Cards in both visible and hidden sets: {overlap}")

    # Shuffle the hidden cards
    rng.shuffle(hidden_cards)

    # Redistribute hidden cards to their zones
    idx = 0
    for zone in hidden_zones:
        if zone["type"] == "hand":
            p = zone["player"]
            size = zone["size"]
            clone._hands[p] = hidden_cards[idx : idx + size]
            idx += size
        elif zone["type"] == "successor":
            p = zone["player"]
            clone._successors[p] = hidden_cards[idx]
            idx += 1
        elif zone["type"] == "dungeon":
            p = zone["player"]
            clone._dungeons[p] = hidden_cards[idx]
            idx += 1
        elif zone["type"] == "forgotten":
            clone._forgotten = hidden_cards[idx]
            idx += 1
        elif zone["type"] == "condemned":
            size = zone["size"]
            clone._condemned = hidden_cards[idx : idx + size]
            idx += size

    return clone


def _collect_visible_cards(state, observer: int, num_players: int) -> Set[int]:
    """
    Collect all card IDs that the observer can see.

    Visible cards include:
    - Observer's own hand
    - Observer's own successor and dungeon
    - All court cards (both face-up and disgraced)
    - The accused card
    - Army cards (available and exhausted)
    - Mustering discards
    """
    visible: Set[int] = set()

    # Observer's own hand
    visible.update(state._hands[observer])

    # Observer's own successor and dungeon
    if state._successors[observer] is not None:
        visible.add(state._successors[observer])
    if state._dungeons[observer] is not None:
        visible.add(state._dungeons[observer])

    # All court cards (played cards are visible regardless of face state)
    for card_id, _face_up, _played_by in state._court:
        visible.add(card_id)

    # Accused card
    if hasattr(state, "_accused") and state._accused is not None:
        visible.add(state._accused)

    # Antechamber cards (visible to all)
    if hasattr(state, "_antechamber"):
        for p in range(num_players):
            visible.update(state._antechamber[p])

    # Parting cards (visible to owner only, but owner is observer here)
    if hasattr(state, "_parting"):
        visible.update(state._parting[observer])

    # Army cards (all players' armies are visible)
    if hasattr(state, "_army_ids"):
        for p in range(num_players):
            visible.update(state._army_ids[p])

    # Exhausted army cards (visible)
    if hasattr(state, "_exhausted_ids"):
        for p in range(num_players):
            visible.update(state._exhausted_ids[p])

    # Mustering discard cards (visible)
    if hasattr(state, "_recruit_discard_ids"):
        for p in range(num_players):
            visible.update(state._recruit_discard_ids[p])

    return visible


class NegativeInfo:
    """
    Tracks negative information - things we know are NOT true.

    For example:
    - "Named Fool and missed" -> opponent doesn't have Fool
    - "Sentry swapped card X" -> X was in opponent's hand at that time

    This can be used to constrain determinizations for more accurate search.
    Not implemented in Phase 1 - we start with basic card counting.
    """

    def __init__(self):
        # Cards we know opponent does NOT have
        self.excluded_from_opponent: Set[str] = set()
        # Cards we know opponent DOES have (from reveals)
        self.known_in_opponent_hand: Set[int] = set()

    def add_naming_miss(self, card_name: str):
        """Record that a card naming ability missed."""
        self.excluded_from_opponent.add(card_name)

    def add_revealed_card(self, card_id: int):
        """Record that we saw a specific card in opponent's hand."""
        self.known_in_opponent_hand.add(card_id)


def clone_and_randomize_with_constraints(
    state,
    observer: int,
    negative_info: Optional[NegativeInfo] = None,
    rng: Optional[random.Random] = None,
):
    """
    Determinize with negative information constraints.

    This is a future enhancement that uses tracked constraints
    (e.g., "opponent doesn't have Fool") to produce more accurate
    determinizations.

    For Phase 1, this just calls the basic clone_and_randomize.
    """
    # TODO: Implement constraint-based filtering
    # For now, just use basic determinization
    return clone_and_randomize(state, observer, rng)
