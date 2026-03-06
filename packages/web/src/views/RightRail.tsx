import type { PlayerId } from "@imposter-zero/types";
import type { IKState, IKPlayerZones, CardName } from "@imposter-zero/engine";
import { PlayerZones } from "./PlayerZones.js";
import { OpponentPanel } from "./OpponentPanel.js";
import type { SetupSelection } from "./GameLayout.js";

interface Props {
  readonly myZones: IKPlayerZones;
  readonly opponents: readonly PlayerId[];
  readonly gameState: IKState;
  readonly activePlayer: PlayerId;
  readonly playerNames: readonly string[];
  readonly numPlayers: number;
  readonly possibleHands: Map<PlayerId, readonly CardName[]> | null;
  readonly setupSelection?: SetupSelection | null;
}

export const RightRail: React.FC<Props> = ({
  myZones,
  opponents,
  gameState,
  activePlayer,
  playerNames,
  possibleHands,
  setupSelection = null,
}) => (
  <div className="right-rail">
    <div>
      <span className="zone-label">Your Zones</span>
      <PlayerZones myZones={myZones} setupSelection={setupSelection} />
    </div>

    <div className="opponent-panels">
      <span className="zone-label">Opponents</span>
      {opponents.map((opIdx) => {
        const opZones = gameState.players[opIdx];
        if (opZones === undefined) return null;
        return (
          <OpponentPanel
            key={opIdx}
            opponentIndex={opIdx}
            zones={opZones}
            name={playerNames[opIdx] ?? `Player ${opIdx}`}
            isActive={activePlayer === opIdx}
            handHelperCards={possibleHands?.get(opIdx) ?? null}
          />
        );
      })}
    </div>
  </div>
);
