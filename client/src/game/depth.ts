/** Draw order of scene layers, back to front. */
export const DEPTH = {
  sky: 0,
  terrain: 10,
  rope: 15,
  worms: 20,
  projectiles: 25,
  effects: 30,
  water: 40,
  labels: 50,
} as const;
