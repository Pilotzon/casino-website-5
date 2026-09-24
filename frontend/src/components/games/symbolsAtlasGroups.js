export const SYMBOLS_ATLAS_GROUPS = {
  egg1: Array.from({ length: 18 }, (_, i) => `egg1-animated${String(i).padStart(2, "0")}.png`),
  egg2: Array.from({ length: 18 }, (_, i) => `egg2-animated${String(i).padStart(2, "0")}.png`),
  egg3: Array.from({ length: 18 }, (_, i) => `egg3-animated${String(i).padStart(2, "0")}.png`),
  egg4: Array.from({ length: 18 }, (_, i) => `egg4-animated${String(i).padStart(2, "0")}.png`),

  // egg5 has 29 frames in your list (00..28)
  egg5: Array.from({ length: 29 }, (_, i) => `egg5-animated${String(i).padStart(2, "0")}.png`),

  // skull1 is 00..29 WITHOUT underscore
  skull1: Array.from({ length: 30 }, (_, i) => `skull1-animated${String(i).padStart(2, "0")}.png`),

  // skull2..5 are skullN-animated_00000.png format
  skull2: Array.from({ length: 30 }, (_, i) => `skull2-animated_${String(i).padStart(5, "0")}.png`),
  skull3: Array.from({ length: 30 }, (_, i) => `skull3-animated_${String(i).padStart(5, "0")}.png`),
  skull4: Array.from({ length: 30 }, (_, i) => `skull4-animated_${String(i).padStart(5, "0")}.png`),
  skull5: Array.from({ length: 30 }, (_, i) => `skull5-animated_${String(i).padStart(5, "0")}.png`),

  fire01: Array.from({ length: 21 }, (_, i) => `Fire 01 reveal_000${String(i).padStart(2, "0")}.png`),
  fire02: Array.from({ length: 21 }, (_, i) => `Fire 02 reveal_000${String(i).padStart(2, "0")}.png`),
  fire03: Array.from({ length: 21 }, (_, i) => `Fire 03 reveal_000${String(i).padStart(2, "0")}.png`),
  fire04: Array.from({ length: 21 }, (_, i) => `Fire 04 reveal_000${String(i).padStart(2, "0")}.png`),
  fire05: Array.from({ length: 21 }, (_, i) => `Fire 05 reveal_000${String(i).padStart(2, "0")}.png`),
};