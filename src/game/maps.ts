import { PHYS } from '../sim/constants';
import privateMaps from 'virtual:private-maps';
import { MAP_PRESETS, type MapPreset } from '../sim/mapgen';

/**
 * Height of a worm in Worms Revolution level outlines, in their pixels: its collision box,
 * cross-checked against the corridor heights in its castle levels.
 */
const WR_WORM_HEIGHT = 19.5;

export type MapEntry =
  | { id: string; name: string; kind: 'generated'; preset: MapPreset }
  | { id: string; name: string; kind: 'image'; url: string };

// Any PNG put in maps/ shows up as a map: dark = air, anything else = ground.
// maps/wr/ holds Worms Revolution level outlines from a personal copy: git-ignored and served
// by the dev server only (see vite.config.ts), so a production build never ships them.
const imageUrls: Record<string, string> = {
  ...import.meta.glob<string>('/maps/*.png', { query: '?url', import: 'default', eager: true }),
  ...Object.fromEntries(privateMaps.map((url) => [url, url])),
};

export const MAPS: MapEntry[] = [
  ...MAP_PRESETS.map((p): MapEntry => ({ id: p.id, name: p.name, kind: 'generated', preset: p.id })),
  ...Object.entries(imageUrls)
    .map(([path, url]): MapEntry => {
      const id = path.replace(/^\/maps\//, '').replace(/\.png$/, '');
      return { id, name: prettyName(id), kind: 'image', url };
    })
    .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true })),
];

export function findMap(id: string | null): MapEntry | undefined {
  return MAPS.find((m) => m.id === id);
}

/** How much to resize an image map so its worms-per-pixel match ours. */
export function imageScale(entry: MapEntry): number {
  return entry.id.startsWith('wr/') ? (2 * PHYS.wormRadius) / WR_WORM_HEIGHT : 1;
}

/** "wr/DLC_Quest_Campaign43" → "WR · DLC Quest Campaign 43" */
function prettyName(id: string): string {
  const [folder, file] = id.includes('/') ? id.split('/', 2) : ['', id];
  const name = file.replace(/_/g, ' ').replace(/([a-z])(\d)/gi, '$1 $2');
  return folder ? `${folder.toUpperCase()} · ${name}` : name;
}
