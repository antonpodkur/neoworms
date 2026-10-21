# Effects

## Explosions (`client/src/game/explosions.ts`)

Inspired by Worms Revolution's: a hot flash and fireball, chunks of ground flying out, and a
crater that glows molten and keeps burning along its lower lip for a few seconds. It's all Phaser
particles. Its three textures (a soft glow, a soft puff with a ragged edge, small rock chunks) are
drawn in code once. Everything scales with the blast's radius. It's purely visual: the simulation
only sends the `explosion` event.

In the order you see it:

| Part | What | How long |
|---|---|---|
| Flash | a white-hot disc that swells and fades, and a wider, dimmer glow lighting up the surroundings | 0.15–0.4 s |
| Fireball | solid puffs that swell and burn from orange through red to soot, around a white-hot core (added light) | 0.2–0.65 s |
| Sparks | small bright embers thrown out fast, falling under gravity | 0.35–0.85 s |
| Debris | rock chunks in the colours of the ground that was blown away, thrown up and out, spinning | 0.7–1.3 s |
| Smoke | a few grey puffs that rise a moment later, behind the fireball, and drift with the wind | 1.4–2.4 s |
| Molten rim | an orange glow along the crater's edge, only where it's real ground, cooling to dark red | up to 3.5 s |
| Flames | small flames licking up along the lower rim | about 2.8 s |

The camera shakes harder for bigger blasts.

Debris colours come from `TerrainView.colorsAround`. That reads the terrain as it's drawn
before the next repaint, so it still shows the ground the hole just removed. The rim and its
flames sit at `DEPTH.embers`: on the ground, behind the worms. Each part's emitter removes itself
when its particles are gone.

Starting an explosion costs about 0.2 ms. An air strike of five blasts at once peaks at a few
hundred particles.
