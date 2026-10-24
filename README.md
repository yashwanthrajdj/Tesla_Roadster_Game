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
runs offline: JavaScript syntax, five rendering/model/smoke regression tests, and
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
the complete `dist/` directory (including `dist/models/`) at the site's root.
The container's preview server is for local/demo use; a public deployment should
use a production static host or web server for `dist/`.

## Controls

| Input | Action |
| --- | --- |
| `W` / `S` | Ground drive / proper reverse |
| `A` / `D` | Ground steering left/right |
| `↑` | Rear thrusters |
| `Space` | Bottom lift / jump thrusters |
| `↓` | Brake/reverse on the road; bottom lift while airborne |
| `←` / `→` | Rotate the car left/right (yaw) on ground or in air |
| `Q` / `E` | One complete left/right air spin per key press |
| `Z` / `X` | Manual left/right spiral while airborne |
| `O` | Toggle assisted automatic spiral (airborne only) |
| `C` | Cycle cameras; Track 02 also has a fixed 2D-style stunt side profile |
| `V` | Toggle vacuum adhesion for ramps and inverted surfaces |
| `1` / `2` | Switch Road 01 / Stunt Vector Track 02 |
| `B` | Toggle decorative traffic cars |
| Camera dropdown | Select a camera angle directly |
| Car dropdown | Select Roadster 2026, Roadster 2020, or STL model |
| `Shift` | High-output rear boost |
| `R` | Reset run and refill air |
| `T` | Day/night theme |
| `L` / headlamp button | Toggle headlights and red running lights; braking still lights the rear lenses |
| AUTO / LOW / BAL / HIGH button | Change rendering resolution/particle budget; Auto reduces resolution on slow devices |
| `H` | Open the flight-deck control map |
| `P` / `Esc` | Pause |

Click once or press a key to unlock the synthesized thruster audio. The sound is generated with Web Audio; there are no external audio files.
Touch devices also show drive, steer, brake, lift, thrust, and single-spin buttons.

## What is in the scene

- Roadster 2020 is the default. `public/models/tesla-roadster-2020-driving.glb` is an optimized derivative of the unchanged original `tesla-roadster-2020.glb`. Regenerate it with `npm run assets:optimize`; the pinned optimizer keeps named lamp materials. Roadster 2026 and STL remain selectable.
- Third-person follow camera with smooth chase movement, speed-based FOV, landing shake, and attitude readout.
- Rear propulsion jets, bottom lift jets, and perimeter RCS visualizations.
- Four underbody white pressure jets and bounded world-space smoke pools form narrow streams that expand, spread along the ground, and fade. Rear, yaw, spin, and boost jets use the same neutral white/gray mist rather than neon flames. No external smoke textures are needed.
- Thruster air automatically recharges when the controls are released, so the banks recover after a long run instead of staying permanently empty.
- Finite compressed-air reserve, gravity, aerodynamic drag, surface-seeking suction energy, rigid-body angular control, ground/ramp contact, and temperature telemetry.
- A flat four-lane highway on Road 01 with white/amber lane markings, a black night sky, and full-length roadside fixtures. Four reusable nearby street spotlights provide actual lighting; inexpensive distant light pools keep the road readable. The highway has no hidden ramp collision.
- Two actual headlight spotlights originate at the model's measured front lamp vertices. The named rear lens materials glow red and brighten while braking. Models without separate lamp metadata use bounding-box fallback positions. Night ambient fill keeps the road visible even with headlights off.
- Road markings/poles are instanced in culled sections. Expensive glass transmission and real-time shadow passes are disabled; alpha-tinted windows preserve the glass appearance. Rendering is capped at 60 FPS, hidden tabs skip rendering, the HUD updates at 10 Hz, and physics retains 120 Hz contact substeps.
- A second `STUNT VECTOR` track with a smaller fully curved C-ramp, an inverted return deck, open ground, and track-specific physics surfaces. It starts with traffic disabled; `B` toggles the decorative cars.
- Track 02 is a smaller reference-style fully curved ramp with a long approach runway, open ground, support truss, edge rails, and ramp lights. The ramp collision and mesh share one profile, the return deck holds the car inverted, and it cannot snap a car up from below.
- Track 02 uses a broad arena slab and a contained play boundary so jumping cars stay supported instead of falling out of range. Fixed physics substeps preserve contact at the ramp edge even at high speed.
- Ramp landings resolve to the surface support distance, damp the impact without deleting forward motion, and stabilize the car's orientation; the inverted return deck uses a downward surface normal and holds the car underneath it.
- Road, runway, ramp, and deck collision heights are generated from the same stunt-track profile as the visible meshes, with a small millimetre-scale support epsilon rather than a visible floating offset.
- The stunt side-profile camera is a dedicated orthographic camera that frames the approach, car, full curve, and inverted return deck without fog or perspective cropping.
- Live speedometer, accelerometer, altitude, vertical velocity, mission progress, and air reserve.

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
coverage and limitations. Low/Auto modes target weaker hardware, but performance
on every device is not guaranteed; WebGL2 support is required.

## License

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.
