# Scenery

Everything around the terrain: the sky and the sea behind it, and the water in front. It is
inspired by Worms Revolution's seaside levels: a bright sky with big clouds, hazy islands on
the horizon, the sea running out to it, and jade water with soft reflections. It's only
inspired by them, not copied.

The layers behind the terrain (clouds, islands, posts, cave rock) are rendered in Blender
(see [art.md](art.md#backdrops)) and committed as PNG strips in `client/backdrops/`. Everything
else is made in code when the map loads, from Phaser's own building blocks (images, tile
sprites, graphics gradients, the Blur filter) and the noise helpers in
`client/src/game/procedural.ts`. None of it touches the simulation.

## Backdrop (`BackdropView.ts`)

Seaside maps, back to front, all behind the terrain:

| Layer | What | Made in | Parallax |
|---|---|---|---|
| Sky | gradient, deep blue at the top to pale cyan at the horizon | code | none |
| Far sea | gradient from the horizon down, pale and hazy to jade, with faint glints | code | glints 0.4 |
| Clouds | four big cumulus heaps at different heights, drifting slowly | Blender | 0.1 |
| Far islands | pale, soft, rugged island silhouettes on the horizon | Blender | 0.18 |
| Near islands | bluer islands, one with a lighthouse | Blender | 0.3 |
| Posts | leaning mooring posts, a broken jetty and a sailboat, mirrored in the sea | Blender | 0.4 |

Cave maps get a dark brown gradient, two rows of stalactites hanging from the top of the map
and two rows of rock mounds and stalagmites standing on the water, the near row with a few
glowing crystals.

The horizon sits `HORIZON` (320 px) above the water, so the far sea shows behind the low parts
of the terrain. Parallax is horizontal only, which keeps the horizon steady. Each rendered layer
comes with its placement, parallax, blur and drift in `client/backdrops/<theme>/layers.json`.

Each strip is 2048 px wide and repeats sideways. When the map loads it's drawn into a canvas
three tiles wide, softened with the canvas's own blur `filter` (more for farther layers), and
the middle tile kept. So the blur carries on across the repeat and costs nothing per frame.

## Water (`WaterView.ts`)

From the bottom up:

1. **Body**: see-through at the surface (`SURFACE_ALPHA`), so ground just under the water
   shows. It turns opaque `CLEAR_DEPTH` (26 px) down and darkens from jade to deep green by
   `DEEP_DEPTH`.
2. **Reflection**: the terrain texture's strip just above the water, flipped upside down below
   it, tinted green and softened with Phaser's Blur filter. It uses a frame of the terrain
   texture, so it follows every crater for free. `setCrop` can't be used here: it picks the
   wrong rows on a flipped canvas texture.
3. **Ripples**: two tile sprites of the same seamless ripple-line tile, stretched wide (like a
   surface seen from low down), at different scales, drifting opposite ways and added on top of
   each other.
4. **Cover**: the water's own colour again, clear at the surface and opaque by
   `REFLECTION_DEPTH`. It fades the reflection and the ripples out with depth, so deep water is
   calm and the ripple tile never visibly repeats.
5. **Foam**: a bright line along the waves, with a soft glow.

The camera can look `SEA_VIEW` (220 px) below the bottom of the map, so the water gets room on
screen. When sudden death raises the water, everything moves with it.
