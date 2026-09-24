// symbolsAtlas.js
import { SYMBOLS_ATLAS_GROUPS } from "./symbolsAtlasGroups";

export const SYMBOLS_ATLAS_ANIMS = {
  eggEasy:   { frames: SYMBOLS_ATLAS_GROUPS.egg1, fps: 24, loop: false },
  eggMedium: { frames: SYMBOLS_ATLAS_GROUPS.egg2, fps: 24, loop: false },
  eggHard:   { frames: SYMBOLS_ATLAS_GROUPS.egg3, fps: 24, loop: false },

  // ✅ skulls LOOP forever
  skullEasy:   { frames: SYMBOLS_ATLAS_GROUPS.skull1, fps: 24, loop: true },
  skullMedium: { frames: SYMBOLS_ATLAS_GROUPS.skull2, fps: 24, loop: true },
  skullHard:   { frames: SYMBOLS_ATLAS_GROUPS.skull3, fps: 24, loop: true },

  // ✅ fire reveal plays ONCE
  fireReveal1: { frames: SYMBOLS_ATLAS_GROUPS.fire01, fps: 30, loop: false },
  fireReveal2: { frames: SYMBOLS_ATLAS_GROUPS.fire02, fps: 30, loop: false },
  fireReveal3: { frames: SYMBOLS_ATLAS_GROUPS.fire03, fps: 30, loop: false },
  fireReveal4: { frames: SYMBOLS_ATLAS_GROUPS.fire04, fps: 30, loop: false },
  fireReveal5: { frames: SYMBOLS_ATLAS_GROUPS.fire05, fps: 30, loop: false },
};