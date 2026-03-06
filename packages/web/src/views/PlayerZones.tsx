import type { IKPlayerZones, IKCard } from "@imposter-zero/engine";
import { Card } from "./card/Card.js";
import { toCardVisual } from "./card/types.js";
import type { SetupSelection } from "./GameLayout.js";

interface Props {
  readonly myZones: IKPlayerZones;
  readonly setupSelection?: SetupSelection | null;
}

const findCardInHand = (hand: ReadonlyArray<IKCard>, id: number): IKCard | undefined =>
  hand.find((c) => c.id === id);

export const PlayerZones: React.FC<Props> = ({ myZones, setupSelection = null }) => {
  const pendingSuccessor =
    setupSelection?.successorId != null
      ? findCardInHand(myZones.hand, setupSelection.successorId)
      : undefined;

  const pendingDungeon =
    setupSelection?.dungeonId != null
      ? findCardInHand(myZones.hand, setupSelection.dungeonId)
      : undefined;

  return (
    <div className="player-zones">
      <div className="player-zone-slot">
        <Card
          visual={toCardVisual(myZones.king.card)}
          orientation={myZones.king.face === "up" ? "front" : "back"}
          size="small"
          previewSource="hand"
        />
        <span className="zone-label">King</span>
      </div>

      <div className="player-zone-slot">
        {myZones.successor !== null ? (
          <Card
            visual={toCardVisual(myZones.successor.card)}
            orientation="back"
            size="small"
            previewSource="hand"
            forcePreview
          />
        ) : pendingSuccessor ? (
          <div className="player-zone-slot__pending player-zone-slot__pending--successor">
            <Card
              visual={toCardVisual(pendingSuccessor)}
              orientation="front"
              size="small"
              previewSource="hand"
            />
          </div>
        ) : (
          <div className={`player-zone-slot__placeholder ${setupSelection !== null ? "player-zone-slot__placeholder--awaiting player-zone-slot__placeholder--successor" : ""}`} />
        )}
        <span className="zone-label">Successor</span>
      </div>

      <div className="player-zone-slot">
        {myZones.dungeon !== null ? (
          <Card
            visual={toCardVisual(myZones.dungeon.card)}
            orientation="back"
            size="small"
            previewSource="hand"
            forcePreview
          />
        ) : pendingDungeon ? (
          <div className="player-zone-slot__pending player-zone-slot__pending--dungeon">
            <Card
              visual={toCardVisual(pendingDungeon)}
              orientation="front"
              size="small"
              previewSource="hand"
            />
          </div>
        ) : (
          <div className={`player-zone-slot__placeholder ${setupSelection !== null ? "player-zone-slot__placeholder--awaiting player-zone-slot__placeholder--dungeon" : ""}`} />
        )}
        <span className="zone-label">Dungeon</span>
      </div>
    </div>
  );
};
