// frontend/src/components/games/towerAtlasGroups.js

export const TOWER_ATLAS_GROUPS = {
  // Idle
  "default head": Array.from({ length: 60 }, (_, i) => `default head${String(i).padStart(2, "0")}.png`),
  "default wings": Array.from({ length: 60 }, (_, i) => `default wings${String(i).padStart(2, "0")}.png`),

  // Lose
  "lose head start": Array.from({ length: 34 }, (_, i) => `lose head start${String(i).padStart(2, "0")}.png`),
  "lose head loop": Array.from({ length: 40 }, (_, i) => `lose head loop${String(i).padStart(2, "0")}.png`),
  "lose wings open": Array.from({ length: 34 }, (_, i) => `lose wings open${String(i).padStart(2, "0")}.png`),
  "lose wings loop": Array.from({ length: 40 }, (_, i) => `lose wings loop${String(i).padStart(2, "0")}.png`),

  // Win
  "win head start": Array.from({ length: 20 }, (_, i) => `win head start${String(i).padStart(2, "0")}.png`),
  "win head loop": Array.from({ length: 40 }, (_, i) => `win head loop${String(i).padStart(2, "0")}.png`),
  "win wings open": Array.from({ length: 20 }, (_, i) => `win wings open 01${String(i).padStart(2, "0")}.png`),
  "win wings loop": Array.from({ length: 40 }, (_, i) => `win wings loop${String(i).padStart(2, "0")}.png`),

  // Win castle (optional)
  "Win Castle": Array.from({ length: 7 }, (_, i) => `Win Castle${i}.png`),
};