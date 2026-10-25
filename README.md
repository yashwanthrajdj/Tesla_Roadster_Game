# Roadster // Thrust Lab

A browser-based 3D flight-deck game built around a stylized, physically-inspired Tesla Roadster SpaceX package concept. The game is intentionally a simulation abstraction rather than a real vehicle design: cold-gas thrust creates force and torque, gravity is always active, the air reserve is finite, and the underbody suction system only works close to a surface.

## Run it

```bash
nvm install
nvm use
npm ci
npm run dev
```

Then open the local URL printed by Vite. For a production check:

```bash
npm test
npm run build
npm run preview
```

Node **22.23.3** is pinned in `.nvmrc`. After `npm ci`, `npm test` (or `make test`)
runs offline: JavaScript syntax, fourteen input/spin/rendering/model/smoke/settings/stunt regression tests, and
the production build. Fonts and smoke are local/procedural; no runtime CDN is required.

For browser verification on Linux (one-time browser/system-dependency setup):

```bash
PLAYWRIGHT_BROWSERS_PATH=./node_modules/.cache/ms-playwright npx playwright install --with-deps --no-shell chromium
npm run test:browser
```

The browser check starts and stops its own Vite server on port 5175 and saves
screenshots/metrics in ignored `artifacts/`. It uses software rendering for a
repeatable test, not as a prediction of hardware GPU frame rates.

### Container / deploy

```bash
docker build -t roadster-thrust-lab .
docker run --rm -p 4173:4173 roadster-thrust-lab
# Optional isolated browser verification:
docker build --target browser-test -t roadster-browser-test .
docker run --rm roadster-browser-test
```

Open `http://localhost:4173`. For static hosting, run `npm run build` and deploy
the complete `dist/` directory (including `dist/models/` and `dist/textures/`) at the site's root.
The container's preview server is for local/demo use; a public deployment should
use a production static host or web server for `dist/`.

## Controls

| Input | Action |
| --- | --- |
| `↑` / `↓` | Ground drive / brake / reverse (no thrusters) |
| `←` / `→` | Ground steering left/right |
| `W` | Rear pressure thrusters |
| `S` / `Space` | Bottom lift on the ground or in the air |
| `A` / `D` | Left/right yaw thrusters, on the ground or in the air |
| `Q` / `E` | Left/right air spin followed by wheels-down recovery |
| `Z` / `X` | Manual left/right spiral while airborne |
| `O` | Toggle assisted automatic spiral (airborne only) |
| `C` | Cycle cameras; Track 02 also has a fixed 2D-style stunt side profile |
| `V` | Toggle vacuum adhesion for ramps and inverted surfaces |
| `1` / `2` / `3` | Switch Road 01 / Stunt Vector Track 02 / Linear Park Track 03 |
| `B` | Toggle decorative traffic cars |
| Camera dropdown | Select a camera angle directly |
| Car dropdown | Select Roadster 2026, Roadster 2020, or STL model |
| `Shift` | High-output rear boost |
| `R` | Reset run and refill air |
| `T` | Day/night theme |
| `L` / headlamp button | Toggle headlights and red running lights; braking still lights the rear lenses |
| `G` / gear button | Open the Settings / Control Lab page |
| `H` | Open the flight-deck control map |
| `P` / `Esc` | Pause |

Click once or press a key to unlock the synthesized thruster audio. The sound is generated with Web Audio; there are no external audio files.
Touch devices also show drive, steer, brake, lift, thrust, and single-spin buttons.
Settings are saved locally per browser. Steering, top speed, thrust, spin speed,
spiral response, and gyro sensitivity are custom sliders. The page also exposes
Air Stabilization, Auto Thrust, and Gyroscope Controls toggles; the stabilization
and auto-thrust states are mirrored as `STB` and `AT` buttons in the dashboard.
Track 03 adds a Stunt Formation Control section to the same Settings page.
It saves a target count from 1–5 and a target spacing value, then rebuilds the
linear parked-vehicle line immediately while the six-lane track is paused.
Gyroscope input uses device tilt for steering/yaw and pitch when permission is
available; desktop browsers can still use every keyboard control without it.
Q/E are one-shot actions, not held roll controls. Starting upright makes one
complete turn. Starting inverted adds a half-turn recovery so the car ends
wheels-down, preserving its ramp-exit heading. Q/E disable auto-spiral so it
does not immediately overturn the recovered car. Landing interrupts a maneuver
safely if there is insufficient height.

## What is in the scene

- Roadster 2020 is the default. `public/models/tesla-roadster-2020-driving.glb` is an optimized derivative of the unchanged original `tesla-roadster-2020.glb`. Regenerate it with `npm run assets:optimize`; the pinned optimizer keeps named lamp materials. Roadster 2026 and STL remain selectable.
- Third-person follow camera with smooth chase movement, speed-based FOV, landing shake, and attitude readout.
- Rear propulsion jets, bottom lift jets, and perimeter RCS visualizations.
- Four underbody pressure jets use textured, shaded cloud billboards instead of round GL points or solid cones. The streams stretch with the exhaust, expand, spread along the ground, and fade in world space. Rear/yaw/spin/boost jets share the cloud renderer, with at most three smoke draw calls and fixed particle pools.
- `public/textures/smoke-atlas.png` contains four locally generated views through a turbulent 3D density field. Regenerate it offline with `npm run assets:smoke`. The game samples this baked texture, rather than running an expensive full-screen volumetric simulation.
- Thruster air automatically recharges when the controls are released, so the banks recover after a long run instead of staying permanently empty.
- Finite compressed-air reserve, gravity, aerodynamic drag, surface-seeking suction energy, rigid-body angular control, ground/ramp contact, and temperature telemetry.
- A flat four-lane highway on Road 01 with white/amber lane markings, a black night sky, and full-length roadside fixtures. Four reusable nearby street spotlights provide actual lighting; inexpensive distant light pools keep the road readable. The highway has no hidden ramp collision.
- Two actual headlight spotlights originate at the model's measured front lamp vertices. The named rear lens materials glow red and brighten while braking. Models without separate lamp metadata use bounding-box fallback positions. Night ambient fill keeps the road visible even with headlights off.
- Road markings/poles are instanced in culled sections. Expensive glass transmission and real-time shadow passes are disabled; alpha-tinted windows preserve the glass appearance. Rendering is capped at 60 FPS, hidden tabs skip rendering, the HUD updates at 10 Hz, and physics retains 120 Hz contact substeps.
- Rendering always uses native display pixel density with antialiasing. There is no quality selector, automatic resolution reduction, or low-resolution smoke pass.
- A second `STUNT VECTOR` track with a smaller fully curved C-ramp, an inverted return deck, open ground, and track-specific physics surfaces. It starts with traffic disabled; `B` toggles the decorative cars.
- Track 02 is a smaller reference-style fully curved ramp with a long approach runway, open ground, support truss, edge rails, and ramp lights. The ramp collision and mesh share one profile, the return deck holds the car inverted, and it cannot snap a car up from below.
- Track 02 uses a broad arena slab and a contained play boundary so jumping cars stay supported instead of falling out of range. Fixed physics substeps preserve contact at the ramp edge even at high speed.
- Track 02 now continues into a long rear-side landing/run-out road to z=-360 with lane marks and edge rails, so the ramp exit has a proper destination instead of ending at the original short boundary.
- A third `LINEAR PARK` track uses the supplied assets in `Stunt_Jumps/`. The source archives are kept in that folder; optimized browser-ready derivatives are stored in `public/models/stunt/` for Cybertruck, Cybertruck Black, Tesla Semi, Tesla Compact, and Tesla Spaceship targets.
- Track 03 is a recyclable six-lane flat highway with no ramp geometry or ramp collision. Seven road sections are recycled around the player so the highway continues without allocating infinite geometry.
- Track 03 target count and spacing are configurable from the Stunt Formation Control settings page. Target models are normalized, aligned with the road, parked one behind another in a center lane, and reused through cloned templates to keep repeated targets affordable.
- Ramp landings resolve to the surface support distance, damp the impact without deleting forward motion, and stabilize the car's orientation; the inverted return deck uses a downward surface normal and holds the car underneath it.
- Road, runway, ramp, and deck collision heights are generated from the same stunt-track profile as the visible meshes, with a small millimetre-scale support epsilon rather than a visible floating offset.
- The stunt side-profile camera is a dedicated orthographic camera that frames the approach, car, full curve, and inverted return deck without fog or perspective cropping.
- Live speedometer, accelerometer, altitude, vertical velocity, mission progress, and air reserve.
- The loading deck plays `public/loading/roadster-loading.mp4` for a minimum cinematic 5.6-second boot, with a dark vignette and black letterbox borders before the flight deck is revealed.

## Physics research basis

Public descriptions of the Roadster SpaceX package discuss cold-gas thrusters around the car and a separate underbody suction/fan system. Exact nozzle geometry, final pressure, pulse duration, and production performance are not public. This game therefore uses the useful rigid-body abstraction:

```text
force = commanded thrust × direction
torque = lever arm × force
```

The scene treats the lift jets as an explicit game control for the publicly described upward-motion concept. Vacuum adhesion is a deliberate game toggle: when `V` is on, the vehicle is pulled toward a nearby ramp surface and can remain attached upside down; when it is off, gravity is active without surface suction. The car is grounded using a measured normalized support offset, so its visible body stays at the road surface instead of floating above it.

Sources consulted during planning:

- NASA Glenn, [Thrust Force](https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/thrust-force/)
- NASA Glenn, [Rocket Thrust](https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/rocket-thrust/)
- Tesla, [Roadster announcement](https://x.com/elonmusk/status/1005577738332172289)
- Car and Driver, [Roadster reveal](https://www.caranddriver.com/news/a74145531/tesla-roadster-revealed/)
- Car and Driver, [thruster and fan-system explanation](https://www.caranddriver.com/news/a74165059/tesla-roadster-thrusters-fan-system-explained/)

## Performance and verification

See `docs/rendering-checks.md` for measured budgets, model-light analysis, test
coverage and limitations. Batching, optimized geometry and bounded effects keep
cost controlled without lowering clarity. Native high-DPI rendering costs more
on weak GPUs, so performance on every device is not guaranteed; WebGL2 is required.

## License

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.
