/** Draw order of scene layers, back to front. */
export const DEPTH = {
  sky: 0,
  terrain: 10,
  /** A fresh crater's glowing rim and flames, on the ground but behind the worms. */
  embers: 12,
  rope: 15,
  worms: 20,
  projectiles: 25,
  effects: 30,
  water: 40,
  labels: 50,
} as const;
