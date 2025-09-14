/**
 * Example demonstrating the Universal Reaction System with Hidden Information Protection
 *
 * This shows how the game maintains hidden information for ALL reaction cards:
 * - King's Hand (prevent abilities)
 * - Assassin (prevent king flips)
 * - Stranger (copy other reactions from court)
 * - And any other reaction cards
 */

interface ReactionScenario {
  name: string;
  playerA: {
    hand: string[];
    army: string[];
    exhaustedArmy: string[];
  };
  playerB: {
    hand: string[];
    army: string[];
    exhaustedArmy: string[];
  };
  court: string[];
  action: string;
  trigger: 'ability' | 'kingFlip';
}

function demonstrateUniversalReactionSystem() {
  console.log("=== Universal Reaction System Example ===\n");

  const scenarios: ReactionScenario[] = [
    {
      name: "King's Hand vs Fool Ability",
      playerA: { hand: ['KingsHand', 'Elder'], army: ['Soldier'], exhaustedArmy: [] },
      playerB: { hand: ['Fool', 'Judge'], army: ['Inquisitor'], exhaustedArmy: [] },
      court: ['Princess', 'Warden'],
      action: "Player B plays Fool",
      trigger: 'ability'
    },
    {
      name: "Assassin vs King Flip (with Stranger possibility)",
      playerA: { hand: ['Assassin'], army: ['Stranger'], exhaustedArmy: [] },
      playerB: { hand: ['Queen', 'Oracle'], army: ['Judge'], exhaustedArmy: ['Elder'] },
      court: ['KingsHand', 'Mystic'], // Court has King's Hand that Stranger could copy
      action: "Player B flips King",
      trigger: 'kingFlip'
    },
    {
      name: "Multiple possible reactions (hidden information stress test)",
      playerA: { hand: ['Warden'], army: ['KingsHand', 'Assassin', 'Stranger'], exhaustedArmy: [] },
      playerB: { hand: ['Soldier'], army: ['Princess'], exhaustedArmy: [] },
      court: ['Assassin'], // Court has Assassin that Stranger could copy
      action: "Player B plays Soldier",
      trigger: 'ability'
    }
  ];

  scenarios.forEach((scenario, index) => {
    console.log(`\n--- Scenario ${index + 1}: ${scenario.name} ---`);
    console.log(`Action: ${scenario.action}`);
    console.log(`Player A hand: [${scenario.playerA.hand.join(', ')}]`);
    console.log(`Player A army: [${scenario.playerA.army.join(', ')}]`);
    console.log(`Court: [${scenario.court.join(', ')}]`);

    // Analyze what reactions are theoretically possible
    console.log("\n🔍 System Analysis:");

    const possibleReactions = analyzePossibleReactions(scenario);
    possibleReactions.forEach(reaction => {
      console.log(`   - ${reaction.card}: ${reaction.reason}`);
    });

    // Show the prompting sequence
    console.log("\n🔄 Reaction Prompts (Player A):");
    possibleReactions.forEach(reaction => {
      console.log(`   → "Do you want to use ${reaction.card} to react?"`)
      console.log(`     (Asked regardless of whether you have ${reaction.card})`);
    });

    console.log("\n💡 Hidden Information Maintained:");
    console.log("   ✅ Player B cannot determine Player A's hand contents from prompts");
    console.log("   ✅ All theoretically possible reactions are prompted");
    console.log("   ✅ Bluffing opportunities preserved for all reaction cards");
    console.log("   ✅ Strategic depth maintained across all card types");
  });

  console.log("\n=== Universal Design Principles ===");
  console.log("🎯 Always prompt for reactions if card COULD be in hand");
  console.log("🎭 Allow bluffing with any reaction card");
  console.log("🔒 Never leak information about hand contents");
  console.log("⚖️  Apply same logic to ALL reaction cards uniformly");
  console.log("🧠 Consider card locations: hand, army, court, exhausted, etc.");
}

function analyzePossibleReactions(scenario: ReactionScenario): Array<{card: string, reason: string}> {
  const reactions: Array<{card: string, reason: string}> = [];

  // King's Hand - can react to abilities
  if (scenario.trigger === 'ability') {
    const kingsHandVisible = [...scenario.court, ...scenario.playerA.exhaustedArmy].includes('KingsHand');
    if (!kingsHandVisible) {
      reactions.push({
        card: "King's Hand",
        reason: "Could be in hand/army, not in visible zones"
      });
    }
  }

  // Assassin - can react to king flips
  if (scenario.trigger === 'kingFlip') {
    const assassinVisible = [...scenario.court, ...scenario.playerA.exhaustedArmy].includes('Assassin');
    if (!assassinVisible) {
      reactions.push({
        card: "Assassin",
        reason: "Could be in hand/army, not in visible zones"
      });
    }
  }

  // Stranger - can copy reactions from court
  const strangerVisible = [...scenario.court, ...scenario.playerA.exhaustedArmy].includes('Stranger');
  const courtHasReactions = scenario.court.some(card =>
    ['KingsHand', 'Assassin', 'Arbiter', 'Impersonator'].includes(card)
  );

  if (!strangerVisible && courtHasReactions) {
    const courtReactions = scenario.court.filter(card =>
      ['KingsHand', 'Assassin', 'Arbiter', 'Impersonator'].includes(card)
    );
    reactions.push({
      card: "Stranger",
      reason: `Could copy ${courtReactions.join(' or ')} from court`
    });
  }

  return reactions;
}

// Export for documentation purposes
export { demonstrateUniversalReactionSystem };
