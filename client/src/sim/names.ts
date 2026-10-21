/** Default worm names; each team gets its own block of eight. */
const NAMES = [
  'Noodle', 'Pickle', 'Sir Squirm', 'Bean', 'Doris', 'Grub', 'Ziggy', 'Nibbles',
  'Wiggles', 'Gus', 'Dirt Dan', 'Mabel', 'Boris', 'Sprout', 'Clod', 'Sludge',
  'Biscuit', 'Rumble', 'Pip', 'Gravel', 'Fudge', 'Squish', 'Tater', 'Ozzy',
  'Turnip', 'Bramble', 'Crumb', 'Mossy', 'Lumpy', 'Twig', 'Muddy', 'Captain Slime',
];

export function wormName(team: number, index: number): string {
  return NAMES[(team * 8 + index) % NAMES.length];
}
