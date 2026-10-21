# Roadster // Thrust Lab

A browser-based 3D flight-deck game built around a stylized, physically-inspired Tesla Roadster SpaceX package concept. The game is intentionally a simulation abstraction rather than a real vehicle design: cold-gas thrust creates force and torque, gravity is always active, the air reserve is finite, and the underbody suction system only works close to a surface.

## Run it

```bash
npm install
npm run dev
```

Then open the local URL printed by Vite. For a production check:

```bash
npm test
npm run build
npm run preview
```

`npm test` performs the offline JavaScript syntax check and production build.

## Controls

| Input | Action |
| --- | --- |
| `W` / `S` | Ground drive / proper reverse |
| `A` / `D` | Ground steering left/right |
| `↑` | Rear thrusters |
| `↓` / `Space` | Bottom lift / jump thrusters |
| `←` / `→` | Rotate the car left/right (yaw) on ground or in air |
| `Q` / `E` | One complete left/right air spin per key press |
| `↑` / `↓` | Pitch nose up/down |
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
| `H` | Open the flight-deck control map |
| `P` / `Esc` | Pause |

Click once or press a key to unlock the synthesized thruster audio. The sound is generated with Web Audio; there are no external audio files.

## What is in the scene

- The supplied `public/models/tesla-roadster-2026.glb` render asset.
- Third-person follow camera with smooth chase movement, speed-based FOV, landing shake, and attitude readout.
- Rear propulsion jets, bottom lift jets, and perimeter RCS visualizations.
- High-pressure air-release particles trail behind rear, lift, yaw, spin, and boost thrusters; the released air fades independently in world space instead of sticking to the car. A smaller vapor trail is also visible during forward ground acceleration.
- Finite compressed-air reserve, gravity, aerodynamic drag, surface-seeking suction energy, rigid-body angular control, ground/ramp contact, and temperature telemetry.
- A flat highway on Road 01 with runway markings, test-range lighting, background buildings, stars, traffic, and day/night lighting themes. The highway has no hidden ramp collision.
- A second `STUNT VECTOR` track with a smaller fully curved C-ramp, an inverted return deck, open ground, and track-specific physics surfaces. It starts with traffic disabled; `B` toggles the decorative cars.
- A large ground-based stunt park with route roads, route markers, loop-run geometry, wall-ride geometry, separate track lighting, chevrons, landing pads, and ramps inspired by the supplied reference images.
- Track 02 is a smaller reference-style fully curved ramp with a long approach runway, open ground, support truss, edge rails, and ramp lights. The ramp collision and mesh share one profile, the return deck holds the car inverted, and it cannot snap a car up from below.
- Track 02 uses a broad arena slab and a contained play boundary so jumping cars stay supported instead of falling out of range. Fixed physics substeps preserve contact at the ramp edge even at high speed.
- Ramp landings resolve to the surface support distance, damp the impact without deleting forward motion, and stabilize the car's orientation; the inverted return deck uses a downward surface normal and holds the car underneath it.
- Road, runway, ramp, and deck collision heights are generated from the same stunt-track profile as the visible meshes, with a small millimetre-scale support epsilon rather than a visible floating offset.
- The stunt side-profile camera is a dedicated orthographic camera that frames the approach, car, full curve, and inverted return deck without fog or perspective cropping.
- Live speedometer, accelerometer, altitude, vertical velocity, thrust-array bars, mission progress, air reserve, and score.

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

## Asset note

The requested parent directory `/media/yashwanth` is root-owned and grants the current user read/execute access but not write access. The working project was therefore created at `/media/yashwanth/Data/Tesla Game`, which is writable on the mounted drive. Grant write permission to the parent or move this folder if the exact shorter path is required.
