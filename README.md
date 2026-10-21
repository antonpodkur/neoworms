# NeoWorms

A Worms-style artillery game for the browser: 2–4 teams take turns, on one computer or online
(milestone 5). See [ROADMAP.md](ROADMAP.md) for where it's headed.

## Run it

```bash
npm install
npm run dev
```

Then open the URL Vite prints (usually http://localhost:5173). The menu has two tabs:

- **This computer**: hot-seat. Pick teams, worms per team, turn time, worm health, when sudden
  death starts, and the map.
- **Online**: host a game (you get a 4-letter room code and an invite link) or join one with a
  code. Each player is one team; the host picks the settings and starts the match.

Online play needs the relay. To try it on one machine (e.g. two browser tabs), run it too:

```bash
npm run dev:server
```

To play with friends over the internet, deploy the relay once (it's a free Cloudflare Worker),
then point the game at it:

```bash
cd server
npx wrangler login
npm run deploy
```

The deploy prints the relay's address, e.g. `neoworms-relay.<you>.workers.dev`. Put it in
`client/.env.local` as `VITE_RELAY_HOST=neoworms-relay.<you>.workers.dev` (see
`client/.env.example`) and restart `npm run dev`. Everyone playing needs the same setting.

For now, online play has some limits:

- **Everyone runs the game themselves** with `npm run dev`. The game isn't hosted anywhere yet,
  and a hosted build would only have the generated maps (Worms Revolution maps stay local).
- **Reloading the page drops you out of an online match.** Rejoining a match in progress isn't
  supported yet; the others carry on and your turns are skipped.

Other scripts: `npm test` (simulation tests), `npm run typecheck`, `npm run build`.

## Controls

| Key | Action |
|---|---|
| ← → | walk |
| ↑ ↓ | aim |
| Enter | jump (tap twice quickly: backflip) |
| ← → in the air | steer the jump |
| Backspace | backflip |
| Space | fire the selected weapon (hold to charge the bazooka and thrown bombs) |
| Click the map | call in the air strike there (with the Air Strike selected) |
| Shift | weapon menu (← → to choose, Space or Enter to pick) |
| Tab | toggle: fuse 1–5 s for the grenade, cluster and banana bombs |
| Space with the rope | shoot the rope / let go / shoot again mid-air |
| ← → on rope | swing |
| ↑ ↓ on rope | climb / descend |
| Enter on rope | drop the selected grenade, cluster or banana bomb, dynamite or mine |
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
- A worm brought to 0 HP stays until the turn ends, then blows up (which can hurt its neighbours).
- The next turn starts once everything has stopped moving: grenades gone off, worms landed.
- Wind changes every turn and pushes bazooka shells.
- Sudden death: after the set time the water rises at the end of every turn.
- The last team with worms standing wins.

## Maps

Besides the generated maps, any PNG in `maps/` becomes a map: dark pixels are air, anything else
is ground (green-tinted ground is drawn as stone).

Worms Revolution level outlines can be used locally: copy the `08_maps/*.png` files from your
own export into `client/maps/wr/`. That folder is git-ignored and only the dev server serves it, so the
files never end up in git or in a production build (they're Team17's, for personal use only).
Online, a Worms Revolution map only works if every player has it.

These maps used to go in `maps/wr/` at the top of the repo. If you set them up before the move
to `client/`, move the folder: `mv maps/wr client/maps/wr` (on Windows:
`move maps\wr client\maps\wr`).
See [docs/wr-reference.md](docs/wr-reference.md) for what else we took from the game.

## Tuning

Press **T** for live sliders (rope, gravity, jumps, explosions). Changes are saved in your
browser; **Copy values** copies just the ones you changed, ready to paste into a chat or into
`src/sim/constants.ts` to make them the defaults.

## Layout

npm workspaces: `npm install` at the root installs everything.

- `client/`: the game (Vite + Phaser).
  - `src/sim/`: game simulation and match rules in plain TypeScript (terrain, map generation,
    worm physics, ninja rope, weapons, turns). No Phaser imports, unit-tested in `*.test.ts`.
  - `src/sim/constants.ts`: physics tuning values; `src/sim/weapons.ts`: weapons and blasts.
  - `src/game/`: Phaser scene, views, HUD and menus.
  - `src/net/`: online play (room connection, sending and playing back game frames).
- `server/`: the relay, a Cloudflare Worker with one Durable Object per room. It only forwards
  messages; the game runs in the players' browsers.
- `shared/`: message types used by both.
