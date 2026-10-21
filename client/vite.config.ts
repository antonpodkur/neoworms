import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

export default defineConfig({
  plugins: [privateMaps()],
  // Phaser alone is ~1.4 MB minified, so the default 500 kB chunk warning is just noise.
  build: { chunkSizeWarningLimit: 2000 },
});

/**
 * `virtual:private-maps` lists the level outlines in maps/wr/. They come from a personal copy
 * of Worms Revolution (Team17's, not ours to distribute), so only the dev server lists and
 * serves them; a production build gets an empty list and never copies the files.
 */
function privateMaps(): Plugin {
  const id = 'virtual:private-maps';
  let root = '';
  let isBuild = false;
  return {
    name: 'private-maps',
    configResolved(config) {
      root = config.root;
      isBuild = config.command === 'build';
    },
    resolveId: (source) => (source === id ? `\0${id}` : undefined),
    load(resolved) {
      if (resolved !== `\0${id}`) return;
      const dir = join(root, 'maps/wr');
      const files = isBuild || !existsSync(dir) ? [] : readdirSync(dir).filter((f) => f.endsWith('.png'));
      return `export default ${JSON.stringify(files.map((f) => `/maps/wr/${f}`))};`;
    },
  };
}
