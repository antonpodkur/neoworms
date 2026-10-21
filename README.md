# NeoWorms

A Worms-style artillery game for the browser. Currently a hot-seat game: 2–4 teams take turns on
one computer (milestone 4);
see [ROADMAP.md](ROADMAP.md) for where it's headed.

## Run it

```bash
npm install
npm run dev
```

Then open the URL Vite prints (usually http://localhost:5173). The setup screen picks teams,
worms per team, turn time, worm health, when sudden death starts, and the map.

Other scripts: `npm test` (simulation tests), `npm run typecheck`, `npm run build`.

## Controls

| Key | Action |
|---|---|
| ← → | walk |
| ↑ ↓ | aim |
| Enter | jump (tap twice quickly: backflip) |
| ← → in the air | steer the jump |
| Backspace | backflip |
| Space | fire the selected weapon (hold to charge the bazooka and grenade) |
| Shift | weapon menu (← → to choose, Space or Enter to pick) |
| Tab | toggle: grenade fuse 1–5 s |
| Space with the rope | shoot the rope / let go / shoot again mid-air |
| ← → on rope | swing |
| ↑ ↓ on rope | climb / descend |
| Enter on rope | drop the selected grenade or mine |
| Mouse wheel | zoom |
| Right drag / Alt + drag | pan |
| Esc | menu: pause, resume, new match |
| T | show/hide the map picker and tuning sliders |
| H | show/hide help |

The map and seed are kept in the URL (e.g. `?map=rope-gym&seed=1234`), so a reload keeps the
same map and you can share a link to a map you like.

## Match rules

- Teams take turns; each team cycles through its worms. A turn lasts the turn time.
- Using a weapon (not the ninja rope) leaves 3 seconds of retreat time to get away; you can still
  move and swing on the rope, but not fire again.
- Getting hurt during your own turn ends it.
- The next turn starts once everything has stopped moving: grenades gone off, worms landed.
- Wind changes every turn and pushes bazooka shells.
- Sudden death: after the set time the water rises at the end of every turn.
- The last team with worms standing wins.

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
