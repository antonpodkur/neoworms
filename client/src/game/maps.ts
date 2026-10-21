import { PHYS } from '../sim/constants';
import privateMaps from 'virtual:private-maps';
import { MAP_PRESETS, type MapPreset } from '../sim/mapgen';

/**
 * Height of a worm in Worms Revolution level outlines, in their pixels: its collision box,
 * cross-checked against the corridor heights in its castle levels.
 */
const WR_WORM_HEIGHT = 19.5;

/** Where a map comes from; the menu lists maps in this order, under these headings. */
export const MAP_GROUPS = {
  small: 'For 2–4 teams',
  large: 'For 5–8 teams',
  custom: 'Your maps',
  generated: 'Random',
  wr: 'Worms Revolution (your copy)',
} as const;

export type MapGroup = keyof typeof MAP_GROUPS;

export type MapEntry = { id: string; name: string; group: MapGroup } & (
  | { kind: 'generated'; preset: MapPreset }
  | { kind: 'image'; url: string }
);

// Our maps live in maps/small/ and maps/large/ (drawn as SVG, built to PNG by `npm run maps`).
// Any other PNG put in maps/ shows up too: dark = air, anything else = ground.
// maps/wr/ holds Worms Revolution level outlines from a personal copy: git-ignored and served
// by the dev server only (see vite.config.ts), so a production build never ships them.
const imageUrls: Record<string, string> = {
  ...import.meta.glob<string>(['/maps/*.png', '/maps/small/*.png', '/maps/large/*.png'], {
    query: '?url',
    import: 'default',
    eager: true,
  }),
  ...Object.fromEntries(privateMaps.map((url) => [url, url])),
};

const groupOrder = Object.keys(MAP_GROUPS);

export const MAPS: MapEntry[] = [
  ...MAP_PRESETS.map((p): MapEntry => ({ id: p.id, name: p.name, group: 'generated', kind: 'generated', preset: p.id })),
  ...Object.entries(imageUrls).map(([path, url]): MapEntry => {
    const id = path.replace(/^\/maps\//, '').replace(/\.png$/, '');
    const folder = id.includes('/') ? id.split('/')[0] : 'custom';
    const group = (folder in MAP_GROUPS ? folder : 'custom') as MapGroup;
    return { id, name: prettyName(id), group, kind: 'image', url };
  }),
].sort(
  (a, b) =>
    groupOrder.indexOf(a.group) - groupOrder.indexOf(b.group) ||
    (a.group === 'generated' ? 0 : a.id.localeCompare(b.id, undefined, { numeric: true })),
);

export function findMap(id: string | null): MapEntry | undefined {
  return MAPS.find((m) => m.id === id);
}

/** How much to resize an image map so its worms-per-pixel match ours. */
export function imageScale(entry: MapEntry): number {
  return entry.group === 'wr' ? (2 * PHYS.wormRadius) / WR_WORM_HEIGHT : 1;
}

/** "small/twin-isles" → "Twin Isles"; "wr/DLC_Quest_Campaign43" → "WR · DLC Quest Campaign 43" */
function prettyName(id: string): string {
  const [folder, file] = id.includes('/') ? id.split('/', 2) : ['', id];
  const name = file
    .replace(/[_-]/g, ' ')
    .replace(/([a-z])(\d)/gi, '$1 $2')
    .replace(/\b[a-z]/g, (c) => c.toUpperCase());
  return folder === 'wr' ? `WR · ${name}` : name;
}
