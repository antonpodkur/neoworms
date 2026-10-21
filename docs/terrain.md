# Terrain

The terrain is drawn to look like Worms Revolution's: chunky slabs of a tiling material with
thick, rounded, softly lit edges, and craters that show as dark holes dug into the slab.

The look is computed on the CPU, one pixel per terrain pixel, into a single canvas texture.

- `client/src/game/terrainPaint.ts` makes the materials and paints pixels. It has no Phaser in
  it, so tests can run it.
- `client/src/game/TerrainView.ts` is the Phaser side: the texture, `carve()` and `flush()`.

The simulation (`client/src/sim`) knows nothing about any of this. It only owns the mask.

## Materials

| Mask value | Map colour | Drawn as |
|---|---|---|
| 1 | brown (`#b5794a`) | warm sandy sponge with light dots and thin dark cracks |
| 2 | grey-blue (`#7f97ad`) | blue-grey cobblestones, each one rounded and lit, with dark gaps |

Each material is a 256 × 256 tile that repeats without seams. Both tiles are generated in code
at startup (about 60 ms, once per page load), not stored as PNGs:

- **Seamless by construction.** The noise is
  [simplex-noise](https://www.npmjs.com/package/simplex-noise) (already a dependency) sampled on
  a 4D torus, and the stones and dots are cell noise on a grid that wraps. A painted PNG would
  need hand work to tile cleanly, plus a loading step.
- **Easy to tune.** Colours, dot sizes and crack density are numbers next to the code.
- **Deterministic.** Seeded, so everyone sees the same terrain.

A painted tile could still replace a generator later: any 256 × 256 RGB image works.

A large, faint brightness drift (`DRIFT`) runs across the whole map so the repeating tile is
hard to spot when zoomed out.

## Rounded, lit edges

1. **Height field.** The mask is box-blurred twice with radius `BEVEL` (6 px), which is close
   to a Gaussian, and the result goes through an ease-out curve. Height is 0 at the edge and
   flat on top about 12 px in. The blur uses integer sums, so it comes out exactly the same
   whatever window it's computed over. That's what lets a carve repaint only part of the map.
2. **Lighting.** Normals come from the height field's slope. The light comes from the upper
   left, so top-left edges catch it and bottom-right edges and undersides fall into shade.
   `BEVEL_STRENGTH` sets how steep the edges look and `LIGHT_GAIN` how strong the light is.
3. **Soft edge shading.** The outermost few pixels are darker (`EDGE_DARK`). Soil touching
   stone gets a thin dark seam.
4. **Smooth outlines.** Edge pixels are drawn partly transparent, depending on how many of
   their 3 × 3 neighbours are ground. This rounds off the pixel steps when zoomed in.

Beyond the map's edges the ground counts as continuing, so a cave's walls and roof aren't
bevelled where they meet the border.

## Craters

- **Back wall.** When the map loads, the painter keeps a copy of the mask. Wherever there was
  ground and now there's air, it draws that copy's material darkened (`BACK_SHADE`). The ground
  in front casts a soft shadow onto it, down and to the right (`SHADOW_X`, `SHADOW_Y`). The
  back wall exists only in the picture: the simulation has no idea it's there, so nothing
  collides with it. Front and back are blended into the same texture, so there is no second
  image.
- **Scorch.** `carve()` burns a ragged ring up to `SCORCH_WIDTH` (5 px) around the hole. The
  ring is kept per pixel, so it survives later repaints.

## Cost

Each carve marks the area it changed: the hole, plus the reach of the blur, the shadow and the
scorch ring. Holes that land in the same frame and overlap are merged into one area. `flush()`
(once per frame) repaints only those areas, copies them into the canvas, and sends them to the
GPU with `texSubImage2D` through Phaser's GL state wrappers. The old code called
`texture.refresh()`, which re-sends the whole texture (17 MB on a 3000 × 1400 map).

Measured in Chrome on Seven Isles (3000 × 1400), warm:

| | Time |
|---|---|
| Painting the whole map at load | 55–75 ms |
| One carve (radius 21–75), repaint and upload | median 0.6 ms, p95 1.7 ms, max 2.0 ms |
| Air strike, five holes in one frame | 2.7 ms |
| Before this change: any frame with a carve (full re-upload) | 6–12 ms |

`client/src/game/terrainPaint.test.ts` checks that repainting just the area around new holes
gives exactly the same pixels as repainting the whole map.

## Why it's custom

Phaser draws textures but has no destructible-terrain renderer. Its normal-map lighting would
still need a normal map worked out on the CPU and re-sent after every carve. It would save no
code and would only give point lights. A GPU shader could do the lighting per frame. But that
means writing a custom shader against Phaser 4's still-new render-node API, while the CPU
version costs about a millisecond per explosion and nothing on frames without one.
