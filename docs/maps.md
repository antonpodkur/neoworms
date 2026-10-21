# Maps

Our maps live in `client/maps/small/` (made for 2–4 teams) and `client/maps/large/` (for 5–8
teams). The folder decides which heading a map gets in the menu, and the file name gives its
name (`twin-isles` → "Twin Isles").

Each map is an **SVG source** plus the **PNG the game loads**. Edit the SVG, then run
`npm run maps` to rebuild the PNGs and `npm test` to check them. The PNG is what ships because
every browser decodes it to the same pixels, and online play needs every player's terrain to
match. Browsers can render the same SVG a few edge pixels apart.

## Format

- Black is air, brown (`#b5794a`) is soil, grey-blue (`#7f97ad`) is stone. Stone only looks
  different (no grass, grey texture); both are destructible.
- One PNG pixel is one game pixel. The bottom 20 px are under water.
- Sizes: 2000 × 1000 for 2–4 teams, 3000 × 1400 for 5–8 teams.
- A map whose top edge is mostly ground counts as a cave: it gets the cave backdrop and no air
  strikes (they'd only hit the roof).

## Scale

| | Pixels |
|---|---|
| Worm (height) | 16 |
| Walking up a slope | up to ~70° |
| Forward jump | ~75 across |
| Rope length | 380 |
| Bazooka crater (radius) | 21 |
| Gap between spawned worms | 90 (closer if a map is crowded) |

## How the SVGs are built

Every map uses the same template; copy an existing one to start a new map.

- **Mirroring.** Only the left half is drawn, inside `<g id="half">`. Two `<use>` elements show
  it on the left and, flipped, on the right, so editors (Inkscape, Figma, a browser) show the
  whole map. With `data-mirror="true"` on the `<svg>`, the build copies the left half onto the
  right pixel for pixel, so both sides are exactly alike. Anything drawn across the middle line
  is mirrored too, which is how the centrepieces stay symmetric.
- **The `rock` filter** turns plain shapes into natural-looking rock: it bends the edges
  (`feDisplacementMap`, `scale` = how far), blurs them, and cuts the blur off at 50% so edges
  are sharp again but rounded. Corners get rounded and nearby shapes melt together. Very thin
  shapes (under ~2 × the blur) disappear, so keep bridges at least ~30 px thick.
- **Layers, painted in order:** soil shapes, then black shapes to dig caves and tunnels, then
  more soil, and so on. Cave maps start from a solid rectangle and dig the chambers out of it,
  which gives rounder rooms than building walls. Stone buildings (Twin Keeps) skip the filter and
  use `shape-rendering="crispEdges"` for straight walls.
- In 2D a tunnel that goes all the way through a hill cuts its top off into a floating piece.
  Dig two caves from either side that stop short of each other instead (the bunkers in Grotto and
  Seven Isles).

You can also paint a PNG directly in any paint program and drop it into a folder; the build
only touches PNGs that have an SVG next to them.

## What makes a map fair and fun

These are the rules the shipped maps follow; `client/src/sim/maps.test.ts` checks the first two.

1. **Same on both sides.** The game detects a symmetric map and spawns worms (and mines) in
   mirrored pairs, alternating sides, so every team has worms on both halves and, with an even
   number of teams, every worm has an enemy starting from the mirror-image spot.
2. **Room for everyone.** A 2–4 team map fits 4 teams × 4 worms at full spacing, a 5–8 team map
   8 × 4 (the shipped ones fit about 30–44 and 40–68 worms). Spawns only count spots
   connected to the main open air, so sealed pockets are fine as decoration but never spawn
   anyone.
3. **Something to hook onto.** Overhangs, floating rocks and stalactites within rope reach
   (380 px) of where worms stand, so the rope works everywhere. Big open spans get a rock in the
   middle.
4. **Water threatens everyone.** Every landmass has an edge or a pit leading to the sea, so a
   good shot can knock anyone in.
5. **High and low ground both have a cost.** High spots are exposed to the wind and to shots
   from everywhere; low spots are near the water or in caves that grenades can be dropped into.
6. **Something in the middle.** A contested centrepiece (keystone rock, stalagmite, volcano,
   watchtower) blocks the straight line between the two sides so nobody gets free shots across
   the whole map.
7. **Thick where it should last, thin where it should break.** Main ground is 60 px or more
   (several bazooka hits); bridges and ledges are 30–40 px, so they break in a hit or two.

## The maps

**For 2–4 teams**

- **Twin Isles**: two islands across a narrow strait. Each has a hook curling over its plateau,
  a hill with a hollow, an arm over the strait with a sea cave under it, and a grotto by the
  water reached through a shaft from the plateau (drop a grenade down it). A keystone rock over
  the strait and a sea stack under it are the way across; rings float overhead.
- **Grotto**: an enclosed cave. Domed roof with stalactites to swing from, a slab hanging like a
  chandelier, a ledge and alcove on each wall, a pit to the water on each side with a cave beside
  it, and a mound in the middle with a bunker in each flank. A stalactite and a stalagmite almost
  meet over the mound.
- **Spires**: five rock spires standing in the sea with mushroom caps, short ledges and a thin
  natural bridge sagging between them, floating rocks overhead and islets near the water. Rope-heavy:
  every gap is a fall into the sea.
- **Strata**: three wavy shelves stacked on columns. Gaps in each shelf let grenades fall to the
  one below, the middle shelf is open in the centre, and the bottom shelf hangs over the sea.

**For 5–8 teams**

- **Deep Caverns**: an enclosed cave in three parts. Each side chamber has an upper floor, a
  lower floor split by a pit to the water and a boulder over it; the great hall in the middle has
  an underground lake with a rock island and a huge stalactite above it. A window high up and a
  tunnel low down join the chambers, so only some teams can see each other at a time.
- **Seven Isles**: a hook island, a mesa with a cave, and a low islet on each side of a volcano
  with a crater and two bunkers. Floating rocks and a ring high above link everything by rope.
- **Twin Keeps**: a stone castle on each hill (a keep with four rooms, a two-storey great hall,
  a gate tower), a dungeon under each hill, houses in the valley and a bridge across the moat
  with a watchtower standing on a pier.
