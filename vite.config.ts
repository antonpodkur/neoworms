import { defineConfig } from 'vite';

// Phaser alone is ~1.4 MB minified, so the default 500 kB chunk warning is just noise.
export default defineConfig({
  build: { chunkSizeWarningLimit: 2000 },
});
