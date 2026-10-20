# NeoWorms

A Worms-style artillery game for the browser. Currently a single-player sandbox (milestone 1);
see [ROADMAP.md](ROADMAP.md) for where it's headed.

## Run it

```bash
npm install
npm run dev
```

Then open the URL Vite prints (usually http://localhost:5173).

Other scripts: `npm test` (simulation tests), `npm run typecheck`, `npm run build`.

## Controls

| Key | Action |
|---|---|
| ← → | walk |
| ↑ ↓ | aim |
| Enter | jump |
| Backspace | backflip |
| Tab | next worm |
| Left click | explosion (debug) |
| Mouse wheel | zoom |
| Right drag / Shift + drag | pan |
| R | new random map |
| M | next map type |
| H | show/hide help |

## Layout

- `src/sim/`: game simulation in plain TypeScript (terrain, map generation, worm physics, world).
  No Phaser imports, unit-tested in `sim.test.ts`.
- `src/game/`: Phaser scene and views that draw the simulation and feed it input.
- `src/sim/constants.ts`: physics tuning values (gravity, walk speed, jump strength, damage).
