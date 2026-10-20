# NeoWorms

A Worms-style artillery game for the browser. Currently a single-player sandbox with the ninja rope (milestone 2);
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
| Enter | jump (tap twice quickly: backflip) |
| ← → in the air | steer the jump |
| Backspace | backflip |
| Space | shoot the ninja rope / let go (works mid-air too) |
| ← → on rope | swing |
| ↑ ↓ on rope | climb / descend |
| Tab | next worm |
| Left click | explosion (debug) |
| Mouse wheel | zoom |
| Right drag / Shift + drag | pan |
| R | respawn worms (new seed; generated maps get new terrain) |
| M | next map (Rope Gym is made for rope practice) |
| T | show/hide the map picker and tuning sliders |
| H | show/hide help |

The map and seed are kept in the URL (e.g. `?map=rope-gym&seed=1234`), so a reload keeps the
same map and you can share a link to a map you like.

## Maps

Besides the generated maps, any PNG in `maps/` becomes a map: dark pixels are air, anything else
is ground (green-tinted ground is drawn as stone).

Worms Revolution level outlines can be used locally: copy the `08_maps/*.png` files from your
own export into `maps/wr/`. That folder is git-ignored and only the dev server serves it, so the
files never end up in git or in a production build (they're Team17's, for personal use only).
See [docs/wr-reference.md](docs/wr-reference.md) for what else we took from the game.

## Tuning

Press **T** for live sliders (rope, gravity, jumps, explosions). Changes are saved in your
browser; **Copy values** copies just the ones you changed, ready to paste into a chat or into
`src/sim/constants.ts` to make them the defaults.

## Layout

- `src/sim/`: game simulation in plain TypeScript (terrain, map generation, worm physics,
  ninja rope, world). No Phaser imports, unit-tested in `*.test.ts`.
- `src/game/`: Phaser scene and views that draw the simulation and feed it input.
- `src/sim/constants.ts`: physics tuning values (gravity, walk speed, jump strength, damage).
