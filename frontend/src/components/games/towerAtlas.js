// frontend/src/components/games/towerAtlas.js
import { TOWER_ATLAS_GROUPS } from "./towerAtlasGroups";

export const TOWER_ATLAS_ANIMS = {
  // Idle
  dragonHeadIdle: { frames: TOWER_ATLAS_GROUPS["default head"], fps: 60, loop: true },
  dragonWingsIdle: { frames: TOWER_ATLAS_GROUPS["default wings"], fps: 60, loop: true },

  // Lose (start -> loop)
  dragonHeadLoseStart: { frames: TOWER_ATLAS_GROUPS["lose head start"], fps: 60, loop: false },
  dragonHeadLoseLoop: { frames: TOWER_ATLAS_GROUPS["lose head loop"], fps: 60, loop: true },
  dragonWingsLoseOpen: { frames: TOWER_ATLAS_GROUPS["lose wings open"], fps: 60, loop: false },
  dragonWingsLoseLoop: { frames: TOWER_ATLAS_GROUPS["lose wings loop"], fps: 60, loop: true },

  // Win (start -> loop)
  dragonHeadWinStart: { frames: TOWER_ATLAS_GROUPS["win head start"], fps: 60, loop: false },
  dragonHeadWinLoop: { frames: TOWER_ATLAS_GROUPS["win head loop"], fps: 60, loop: true },
  dragonWingsWinOpen: { frames: TOWER_ATLAS_GROUPS["win wings open"], fps: 60, loop: false },
  dragonWingsWinLoop: { frames: TOWER_ATLAS_GROUPS["win wings loop"], fps: 60, loop: true },

  // Win castle (optional)
  winCastle: { frames: TOWER_ATLAS_GROUPS["Win Castle"], fps: 24, loop: false },
};