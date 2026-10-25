# Lighting, smoke and rendering verification

## What was found

- The previous highway registered 104 roadside point lights, plus three jet
  lights and three global lights: **110 visible lights**. Each fragment paid for
  all of them despite their tiny intensity at road height.
- Road markings/poles were separate meshes: **2,758 visible meshes** in the
  default scene inventory.
- The original Roadster 2020 has 608,850 triangles / 105 mesh primitives. Its
  transmission glass triggered an extra scene rendering pass.
- The old particle code updated arrays that `Float32BufferAttribute` had copied,
  leaving the GPU buffers unchanged. This is now covered by reference-identity
  and motion assertions, not by a copied formula smoke test.

## Model analysis

The source GLB has named `headlights_AHO`, `headlights_main`,
`Glass_rear_lights_main`, and `Glass_rear_lights_DHO` materials. Front lamps are
around local z = -2 m after the game's normalization; rear lenses are around
z = +2 m. Both left/right lights can share a mesh, so the implementation splits
transformed vertices by local x, rather than positioning a light at the mesh
origin. White beams follow the car's rotation; the original rear lens materials
are red. Tests compare original and optimized lamp bounds within 6 cm.

`npm run assets:optimize` regenerates the driving asset using gltfpack 1.3.0 with
16% target triangles / 0.3% error, retaining named materials. The source stays
unchanged. The derivative has **118,721 instanced triangles / 28 draws**. Image
textures are retained; this is not a claim that every asset has a mobile LOD.

## Measurements from the lighting optimization

Environment: Linux container, Node 22.23.3, Playwright Chromium 156,
SwiftShader software rendering, 960 × 600 viewport, DPR 1, the former Balanced setting,
Roadster 2020, stationary highway, night, warm shaders. Each measured sample is
the median of five animation frame intervals; three samples after one warmup.

| Stage | Lights | Draw calls | Rendered triangles | Median frame samples (ms) |
| --- | ---: | ---: | ---: | --- |
| Original scene inventory | 110 | not measured | not measured | Original full browser benchmark timed out; no FPS result claimed |
| Pooled lighting/instanced road, original car | 9 | 309 | 1,232,260 | 3058.5 / 3115.3 / 3096.3 |
| Optimized car, alpha glass, pooled lighting/road | 9 | 86 | 126,413 | 220.7 / 214.8 / 206.1 |

These are software-renderer measurements on a shared host, not laptop/mobile
FPS promises. The structural reductions are the reliable result: 9 fixed
lights, 28 car draws, no scene transmission pass, no real-time shadow maps,
bounded smoke pools and instanced scenery. Contact physics is not weakened to
increase FPS.

## Current high-clarity smoke/input revision

- Removed all rendering presets and adaptive downscaling. The canvas uses native
  device pixel density and antialiasing, including after resize. Browser tests
  verify a DPR-2 mobile canvas is 780 pixels wide for a 390 CSS-pixel viewport.
- Replaced the round point sprites and cone cores with instanced, camera-facing
  cloud quads. A locally baked 768×192 atlas contains four shaded, turbulent
  density clouds. The GPU samples that texture, not a live volumetric raymarch.
  Exhaust-age interpolation fills gaps in the stream; ground contact produces
  spreading clouds. Depth testing, ground-edge fading and back-to-front packing
  keep the smoke attached to the world rather than painted over the car.
- Pools remain bounded at 180 rear + 360 lift + 72 RCS clouds (three batches).
- Arrow keys now drive/steer. W fires rear jets, S/Space lifts, A/D operate yaw
  jets. Touch controls use the same mapping.
- Q/E now finish upright. From an inverted ramp exit, a full roll plus a 180°
  recovery is necessary; another 360° alone would leave the car inverted again.
  Pitch is leveled, heading preserved, and leftover spin velocity removed.

Current stationary native-DPR/antialias browser sample: **9 lights, 83 draw calls,
126,413 rendered triangles**; software frame medians **402.7 / 411.9 / 400.3 ms**.
Antialiasing differs from the historical samples above, so these are not an
apples-to-apples FPS comparison. Full native clarity deliberately replaces the
old downscaling policy. Hardware GPU performance still needs device testing;
there is no claim of zero lag on every device.

## Reproduce

1. `npm ci`, then `npm test` (or `make test`). Ten offline tests cover actual
   model lamp positions/toggle/braking, instancing transforms, road-light coverage
   down to z=-4890, native pixel density, textured cloud generation and smoke
   upload/motion/lifetime/bounds, swapped controls, and Q/E upright recovery from
   upright/inverted/pitched attitudes at different simulation step sizes.
2. Install the browser as described in README, then `npm run test:browser`.
   It checks default model, actual L-key/button toggle, distant lamp relocation,
   Arrow driving versus W thrust, Space/S takeoff, active cloud smoke, landing,
   both actual inverted-ramp Q/E recoveries and wheels-down landings, no quality
   selector, native DPR after resize, and touch UI.
3. Inspect `artifacts/verified-road.png`, `artifacts/headlights-off.png`,
   `artifacts/lift-smoke.png`, `artifacts/lift-smoke-side.png`,
   `artifacts/rear-smoke.png`, `artifacts/ramp-q-recovery.png`,
   `artifacts/ramp-e-recovery.png`, `artifacts/stunt-lighting.png`, and
   `artifacts/mobile-controls.png`, plus `artifacts/settings-page.png` for the
   sensitivity/toggle dashboard.

Remaining validation: real laptop/mobile GPUs, touch-device frame rates, and
Docker build/run on a machine with Docker available. The Vite chunk-size warning
is non-fatal; it does not measure real-time rendering cost.
