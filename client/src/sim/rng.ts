/** Seeded PRNG (mulberry32): the same seed always yields the same sequence. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    const [value, next] = nextRandom(state);
    state = next;
    return value;
  };
}

/**
 * One mulberry32 step from an explicit state, for random sequences whose state has to be
 * saved and sent (online play hands the game state between browsers).
 */
export function nextRandom(state: number): [value: number, state: number] {
  const a = (state + 0x6d2b79f5) >>> 0;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, a];
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000);
}
