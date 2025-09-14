/**
 * Example demonstrating the King's Hand reaction system and hidden information protection
 *
 * This shows how the game maintains hidden information by always asking players
 * if they want to use King's Hand, regardless of whether they actually have it.
 */

interface ExampleGameState {
  currentPlayer: string;
  opponent: string;
  scenario: string;
}

function demonstrateKingsHandInteraction() {
  console.log("=== King's Hand Reaction System Example ===\n");

  const scenarios = [
    {
      name: "Player A has King's Hand, Player B plays Fool",
      playerA: { hasKingsHand: true },
      playerB: { hasKingsHand: false },
      action: "Player B plays Fool (MAY ability)"
    },
    {
      name: "Player A doesn't have King's Hand, Player B plays Judge",
      playerA: { hasKingsHand: false },
      playerB: { hasKingsHand: false },
      action: "Player B plays Judge (MAY ability)"
    },
    {
      name: "Both players have King's Hand, Player B plays Oracle",
      playerA: { hasKingsHand: true },
      playerB: { hasKingsHand: true },
      action: "Player B plays Oracle (MAY ability)"
    }
  ];

  scenarios.forEach((scenario, index) => {
    console.log(`\n--- Scenario ${index + 1}: ${scenario.name} ---`);
    console.log(`Action: ${scenario.action}`);
    console.log(`Player A has King's Hand: ${scenario.playerA.hasKingsHand ? 'Yes' : 'No'}`);
    console.log(`Player B has King's Hand: ${scenario.playerB.hasKingsHand ? 'Yes' : 'No'}`);

    // The critical part: ALWAYS ask Player A if they want to use King's Hand
    console.log("\n🔄 System: Player A, do you want to use King's Hand to prevent this ability?");
    console.log("   (You will be asked this regardless of whether you have King's Hand)");

    if (scenario.playerA.hasKingsHand) {
      console.log("📋 Player A's options:");
      console.log("   - Say 'Yes' and use King's Hand (prevents ability, condemns both cards)");
      console.log("   - Say 'No' and let the ability resolve");
      console.log("   - Bluff by saying 'Yes' even without King's Hand (illegal, causes penalty)");
    } else {
      console.log("📋 Player A's options:");
      console.log("   - Say 'Yes' and bluff having King's Hand (illegal, causes penalty)");
      console.log("   - Say 'No' and let the ability resolve");
      console.log("   - Sometimes bluff to confuse opponent about hand contents");
    }

    console.log("\n💡 Why this matters:");
    console.log("   - Player B cannot determine if Player A has King's Hand based on whether they're asked");
    console.log("   - Maintains strategic tension and bluffing opportunities");
    console.log("   - Prevents information leakage about hidden hand contents");
  });

  console.log("\n=== Key Design Principles ===");
  console.log("✅ Always prompt for reactions, regardless of hand contents");
  console.log("✅ Allow bluffing but make it risky (penalties for false claims)");
  console.log("✅ Maintain hidden information throughout the game");
  console.log("✅ Create meaningful decision points even without the reaction card");
}

// Export for documentation purposes
export { demonstrateKingsHandInteraction };
