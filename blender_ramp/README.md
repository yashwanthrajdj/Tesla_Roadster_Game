# Reference vertical ramp

This folder contains a Blender generator and the generated asset for the
attached ramp reference (`image copy.png`).  The profile is modeled as a
90-degree circular quarter-pipe / wall-ride with a smooth approach, a real
thick shell, warm edge rails, and a steel lattice support system.

## Blender version

The build was generated and tested with:

```text
Blender 3.4.1
```

`create_reference_ramp.py` uses only Blender's built-in Python API and keeps
the render-engine and Principled BSDF socket differences guarded so it also
works with current Blender 4.x releases.

## Files

- `create_reference_ramp.py` — repeatable scene generator.
- `reference_vertical_ramp.blend` — generated editable Blender scene.
- `reference_vertical_ramp.png` — generated portrait preview.

## Rebuild the model

From the project root:

```bash
blender -b --python blender_ramp/create_reference_ramp.py
```

The script clears the current scene, rebuilds the ramp, saves the `.blend`,
and renders the preview beside the script.  To open the finished scene in the
Blender UI:

```bash
blender blender_ramp/reference_vertical_ramp.blend
```

## Main proportions

The first constants in the Python file are intentionally exposed for easy
matching:

| Parameter | Value | Purpose |
| --- | ---: | --- |
| `RAMP_RADIUS` | 25.0 m | Circular profile radius |
| `RAMP_WIDTH` | 14.0 m | Driveable surface width |
| `RAMP_THICKNESS` | 0.75 m | Closed shell depth |
| `RAMP_SAMPLES` | 72 | Profile smoothness |
| `RAMP_END_ANGLE` | 90° | Flat approach to vertical face |

The scene also stores these values as custom properties on the Blender scene,
along with the Blender version used to generate it.
