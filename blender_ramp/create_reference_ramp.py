"""Build a clean, render-ready Blender model of the supplied vertical ramp.

The reference is a tall quarter-pipe / wall-ride: a flat approach transitions
through a smooth circular arc into a near-vertical launch face.  This script
keeps the proportions easy to edit while adding the details visible in the
reference: a thick ramp shell, hot edge rails, a steel truss cage, runway
markings, practical lights, and a presentation camera.

Usage (Blender 3.4+):
    blender -b --python create_reference_ramp.py

The script writes a .blend file and a preview PNG beside itself.  It has no
third-party Python dependencies and is deliberately compatible with Blender
3.4 and current 4.x builds.
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


# -----------------------------------------------------------------------------
# Scene constants: these are the first values to change when matching a new
# reference.  Coordinates use X = ramp width, Y = up, Z = travel direction.
# -----------------------------------------------------------------------------

RAMP_RADIUS = 25.0
RAMP_WIDTH = 14.0
RAMP_THICKNESS = 0.75
RAMP_SAMPLES = 72
RAMP_START_Z = 0.0
RAMP_END_ANGLE = math.pi * 0.5

OUTPUT_DIR = Path(__file__).resolve().parent
BLEND_PATH = OUTPUT_DIR / "reference_vertical_ramp.blend"
PREVIEW_PATH = OUTPUT_DIR / "reference_vertical_ramp.png"


# -----------------------------------------------------------------------------
# Small Blender helpers
# -----------------------------------------------------------------------------


def clear_scene() -> None:
    """Remove the default scene while keeping the script deterministic."""

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (
        bpy.data.meshes,
        bpy.data.curves,
        bpy.data.materials,
        bpy.data.cameras,
        bpy.data.lights,
    ):
        for datablock in list(datablocks):
            if datablock.users == 0:
                datablocks.remove(datablock)


def set_socket(node, socket_name: str, value) -> None:
    """Set a shader input only when that Blender version exposes it."""

    socket = node.inputs.get(socket_name)
    if socket is not None:
        socket.default_value = value


def make_material(
    name: str,
    color: tuple[float, float, float, float],
    *,
    metallic: float = 0.0,
    roughness: float = 0.5,
    emission: tuple[float, float, float, float] | None = None,
    emission_strength: float = 0.0,
) -> bpy.types.Material:
    """Create a Principled material with 3.x/4.x emission compatibility."""

    material = bpy.data.materials.new(name)
    material.use_nodes = True
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    if bsdf is None:
        return material
    set_socket(bsdf, "Base Color", color)
    set_socket(bsdf, "Metallic", metallic)
    set_socket(bsdf, "Roughness", roughness)
    if emission is not None:
        # Blender 3.4 calls this socket Emission; Blender 4 keeps the same
        # logical socket but also renamed some neighboring inputs.
        set_socket(bsdf, "Emission", emission)
        set_socket(bsdf, "Emission Color", emission)
        set_socket(bsdf, "Emission Strength", emission_strength)
    return material


def add_bevel(object_: bpy.types.Object, width: float, segments: int = 3) -> None:
    """Add a small non-destructive bevel for manufactured, finished edges."""

    if width <= 0.0:
        return
    modifier = object_.modifiers.new(name="Soft manufactured edges", type="BEVEL")
    modifier.width = width
    modifier.segments = segments
    modifier.limit_method = "ANGLE"


def add_box(
    name: str,
    location: Vector | tuple[float, float, float],
    dimensions: tuple[float, float, float],
    material: bpy.types.Material,
    *,
    bevel: float = 0.0,
    rotation: tuple[float, float, float] | None = None,
) -> bpy.types.Object:
    """Create a cube with applied scale so bevel widths stay predictable."""

    bpy.ops.mesh.primitive_cube_add(location=location)
    object_ = bpy.context.object
    object_.name = name
    object_.dimensions = dimensions
    if rotation is not None:
        object_.rotation_euler = rotation
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    object_.data.materials.append(material)
    add_bevel(object_, bevel)
    return object_


def add_cylinder(
    name: str,
    location: Vector | tuple[float, float, float],
    radius: float,
    depth: float,
    material: bpy.types.Material,
    *,
    vertices: int = 12,
) -> bpy.types.Object:
    """Create a small round structural/detail element."""

    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices,
        radius=radius,
        depth=depth,
        location=location,
    )
    object_ = bpy.context.object
    object_.name = name
    object_.data.materials.append(material)
    return object_


def add_beam_between(
    name: str,
    start: Vector,
    end: Vector,
    thickness: float,
    material: bpy.types.Material,
    *,
    bevel: float = 0.0,
) -> bpy.types.Object:
    """Create a square tube aligned exactly between two world-space points."""

    delta = end - start
    length = delta.length
    if length <= 1e-6:
        raise ValueError(f"Cannot create zero-length beam: {name}")
    middle = (start + end) * 0.5
    bpy.ops.mesh.primitive_cube_add(location=middle)
    object_ = bpy.context.object
    object_.name = name
    object_.dimensions = (thickness, thickness, length)
    object_.rotation_mode = "QUATERNION"
    object_.rotation_quaternion = delta.to_track_quat("Z", "Y")
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    object_.data.materials.append(material)
    add_bevel(object_, bevel, segments=2)
    return object_


def add_polyline(
    name: str,
    points: list[Vector],
    material: bpy.types.Material,
    *,
    bevel_depth: float,
    resolution: int = 2,
) -> bpy.types.Object:
    """Create a smooth 3D tube following sampled points."""

    curve_data = bpy.data.curves.new(name=name, type="CURVE")
    curve_data.dimensions = "3D"
    curve_data.resolution_u = resolution
    curve_data.bevel_depth = bevel_depth
    curve_data.bevel_resolution = 3
    curve_data.resolution_u = max(resolution, len(points) - 1)

    spline = curve_data.splines.new("POLY")
    spline.points.add(len(points) - 1)
    for spline_point, point in zip(spline.points, points):
        spline_point.co = (*point, 1.0)
    object_ = bpy.data.objects.new(name, curve_data)
    bpy.context.collection.objects.link(object_)
    object_.data.materials.append(material)
    return object_


def point_camera_at(object_: bpy.types.Object, target: Vector) -> None:
    """Aim a camera or light using Blender's conventional -Z forward axis."""

    direction = target - object_.location
    object_.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def ramp_point(theta: float, radius: float = RAMP_RADIUS, offset: float = 0.0) -> Vector:
    """Return a point on the quarter-pipe centerline, offset along its normal."""

    # The circle center is (Y=radius, Z=start_z).  At theta=0 the ramp is
    # tangent to the approach road; at theta=90 degrees it is vertical.
    normal = Vector((0.0, math.cos(theta), math.sin(theta)))
    centerline = Vector(
        (
            0.0,
            radius * (1.0 - math.cos(theta)),
            RAMP_START_Z - radius * math.sin(theta),
        )
    )
    return centerline + normal * offset


# -----------------------------------------------------------------------------
# Ramp and structural model
# -----------------------------------------------------------------------------


def create_ramp_shell(ramp_material: bpy.types.Material, side_material: bpy.types.Material) -> None:
    """Build a watertight, thick quarter-pipe mesh rather than a paper-thin plane."""

    top_vertices: list[Vector] = []
    bottom_vertices: list[Vector] = []
    for index in range(RAMP_SAMPLES + 1):
        theta = RAMP_END_ANGLE * index / RAMP_SAMPLES
        top_center = ramp_point(theta, offset=0.04)
        bottom_center = ramp_point(theta, offset=-RAMP_THICKNESS)
        for x in (-RAMP_WIDTH * 0.5, RAMP_WIDTH * 0.5):
            top_vertices.append(Vector((x, top_center.y, top_center.z)))
            bottom_vertices.append(Vector((x, bottom_center.y, bottom_center.z)))

    vertices = [tuple(point) for point in top_vertices + bottom_vertices]
    faces: list[tuple[int, ...]] = []
    material_indices: list[int] = []
    row = 2

    # Surface faces: left -> right -> next right -> next left gives an
    # outward-facing normal on the top surface.
    for index in range(RAMP_SAMPLES):
        left = index * row
        right = left + 1
        next_left = left + row
        next_right = next_left + 1
        faces.append((left, right, next_right, next_left))
        material_indices.append(0)

    # Underside and the two finished side walls.
    bottom_offset = len(top_vertices)
    for index in range(RAMP_SAMPLES):
        left = bottom_offset + index * row
        right = left + 1
        next_left = left + row
        next_right = next_left + 1
        faces.append((left, next_left, next_right, right))
        material_indices.append(1)

        top_left = index * row
        top_right = top_left + 1
        next_top_left = top_left + row
        next_top_right = next_top_left + 1
        faces.append((top_left, next_top_left, next_left, left))
        material_indices.append(1)
        faces.append((top_right, right, next_right, next_top_right))
        material_indices.append(1)

    # Close the two end caps so the result is a real manufactured object.
    faces.append((0, bottom_offset, bottom_offset + 1, 1))
    material_indices.append(1)
    last = RAMP_SAMPLES * row
    faces.append((last, last + 1, bottom_offset + last + 1, bottom_offset + last))
    material_indices.append(1)

    mesh = bpy.data.meshes.new("Reference ramp shell mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    for material in (ramp_material, side_material):
        mesh.materials.append(material)
    for polygon, material_index in zip(mesh.polygons, material_indices):
        polygon.material_index = material_index

    ramp = bpy.data.objects.new("RAMP / thick quarter-pipe shell", mesh)
    bpy.context.collection.objects.link(ramp)
    bevel = ramp.modifiers.new(name="Clean shell edge", type="BEVEL")
    bevel.width = 0.08
    bevel.segments = 3

    # Subtle underside ribs are visible from the three-quarter camera and make
    # the shell read as a designed structure, not an infinitely thin sheet.
    steel = bpy.data.materials.get("Structural steel")
    for rib_index in range(4, RAMP_SAMPLES, 8):
        theta = RAMP_END_ANGLE * rib_index / RAMP_SAMPLES
        center = ramp_point(theta, offset=-RAMP_THICKNESS - 0.15)
        add_beam_between(
            f"Ramp underside rib {rib_index:02d}",
            center + Vector((-RAMP_WIDTH * 0.5, 0.0, 0.0)),
            center + Vector((RAMP_WIDTH * 0.5, 0.0, 0.0)),
            0.16,
            steel,
            bevel=0.025,
        )


def create_ramp_finish(edge_material: bpy.types.Material, white_material: bpy.types.Material) -> None:
    """Add hot edge rails and a restrained center guide line."""

    rail_points_left: list[Vector] = []
    rail_points_right: list[Vector] = []
    for index in range(RAMP_SAMPLES + 1):
        theta = RAMP_END_ANGLE * index / RAMP_SAMPLES
        point = ramp_point(theta, offset=0.16)
        rail_points_left.append(point + Vector((-RAMP_WIDTH * 0.5 - 0.14, 0.0, 0.0)))
        rail_points_right.append(point + Vector((RAMP_WIDTH * 0.5 + 0.14, 0.0, 0.0)))
    add_polyline("Left warm edge rail", rail_points_left, edge_material, bevel_depth=0.105)
    add_polyline("Right warm edge rail", rail_points_right, edge_material, bevel_depth=0.105)

    # Short center dashes preserve the clean silhouette while giving the ramp
    # a believable test-track identity.
    dash_count = 9
    for index in range(dash_count):
        start_theta = 0.10 + index * 0.155
        end_theta = min(start_theta + 0.075, RAMP_END_ANGLE - 0.015)
        points = [ramp_point(start_theta, offset=0.105), ramp_point(end_theta, offset=0.105)]
        add_polyline(f"Ramp center dash {index + 1:02d}", points, white_material, bevel_depth=0.045)


def support_point(theta: float, radius: float) -> Vector:
    """Point on a larger concentric arc used for the truss cage."""

    return Vector(
        (
            0.0,
            radius - radius * math.cos(theta),
            RAMP_START_Z - radius * math.sin(theta),
        )
    )


def create_truss_cage(steel: bpy.types.Material, steel_dark: bpy.types.Material) -> None:
    """Build twin side trusses and cross-bracing behind the curved surface."""

    inner_radius = RAMP_RADIUS + 1.25
    outer_radius = RAMP_RADIUS + 4.2
    frame_x = RAMP_WIDTH * 0.5 + 1.55
    truss_segments = 18

    for side in (-1.0, 1.0):
        inner_points: list[Vector] = []
        outer_points: list[Vector] = []
        for index in range(truss_segments + 1):
            theta = RAMP_END_ANGLE * index / truss_segments
            inner = support_point(theta, inner_radius)
            outer = support_point(theta, outer_radius)
            inner.x = side * frame_x
            outer.x = side * frame_x
            inner_points.append(inner)
            outer_points.append(outer)

        add_polyline(
            f"{'Left' if side < 0 else 'Right'} inner curved truss chord",
            inner_points,
            steel,
            bevel_depth=0.11,
        )
        add_polyline(
            f"{'Left' if side < 0 else 'Right'} outer curved truss chord",
            outer_points,
            steel,
            bevel_depth=0.13,
        )

        for index in range(truss_segments):
            # Radial posts and alternating X braces create a readable lattice
            # without turning the support into visual noise.
            # Both concentric arcs meet at the ground origin.  There is no
            # structural member to draw at that exact station, so start one
            # segment in and use the base plates below for the foot detail.
            if index > 0:
                add_beam_between(
                    f"Truss radial {side:+.0f} {index:02d}",
                    inner_points[index],
                    outer_points[index],
                    0.12,
                    steel_dark,
                    bevel=0.02,
                )
            if index % 2 == 0:
                add_beam_between(
                    f"Truss diagonal A {side:+.0f} {index:02d}",
                    inner_points[index],
                    outer_points[index + 1],
                    0.085,
                    steel_dark,
                )
                add_beam_between(
                    f"Truss diagonal B {side:+.0f} {index:02d}",
                    outer_points[index],
                    inner_points[index + 1],
                    0.085,
                    steel_dark,
                )

    # Cross beams tie the twin frames together at useful structural stations.
    for index in range(0, truss_segments + 1, 3):
        theta = RAMP_END_ANGLE * index / truss_segments
        inner = support_point(theta, inner_radius)
        outer = support_point(theta, outer_radius)
        for point, label in ((inner, "inner"), (outer, "outer")):
            start = point + Vector((-frame_x * 0.0 - frame_x, 0.0, 0.0))
            end = point + Vector((frame_x, 0.0, 0.0))
            add_beam_between(
                f"Cross tie {label} {index:02d}",
                start,
                end,
                0.11,
                steel,
                bevel=0.02,
            )

    # Four clean base feet ground the truss and make the load path obvious.
    for side in (-1.0, 1.0):
        x = side * frame_x
        for z in (0.0, -RAMP_RADIUS - 4.2):
            add_box(
                f"Truss base plate {side:+.0f} {z:.1f}",
                (x, 0.14, z),
                (2.0, 0.24, 1.6),
                steel_dark,
                bevel=0.04,
            )


def create_reference_side_tower(steel: bpy.types.Material, steel_dark: bpy.types.Material) -> None:
    """Add the tall rectangular lattice tower visible on the reference's side."""

    # The curved twin frames carry the ramp itself.  This separate service
    # tower is deliberately offset to the right/back so it remains readable in
    # the camera view, matching the strong vertical scaffold in Image 1.
    tower_x = RAMP_WIDTH * 0.5 + 3.0
    tower_top = RAMP_RADIUS + 5.5
    tower_z = [
        RAMP_START_Z - RAMP_RADIUS - 7.0,
        RAMP_START_Z - RAMP_RADIUS - 3.0,
        RAMP_START_Z - RAMP_RADIUS + 1.0,
        RAMP_START_Z - RAMP_RADIUS + 5.0,
    ]
    y_levels = [index * 4.5 for index in range(7)]

    for column_index, z in enumerate(tower_z):
        add_beam_between(
            f"Reference tower vertical {column_index:02d}",
            Vector((tower_x, 0.0, z)),
            Vector((tower_x, tower_top, z)),
            0.16,
            steel,
            bevel=0.025,
        )

    for level_index, y in enumerate(y_levels):
        for column_index in range(len(tower_z) - 1):
            add_beam_between(
                f"Reference tower horizontal {level_index:02d} {column_index:02d}",
                Vector((tower_x, y, tower_z[column_index])),
                Vector((tower_x, y, tower_z[column_index + 1])),
                0.11,
                steel_dark,
                bevel=0.02,
            )

        if level_index < len(y_levels) - 1:
            for column_index in range(len(tower_z) - 1):
                left = Vector((tower_x, y, tower_z[column_index]))
                right = Vector((tower_x, y, tower_z[column_index + 1]))
                next_y = y_levels[level_index + 1]
                if level_index % 2 == 0:
                    add_beam_between(
                        f"Reference tower diagonal A {level_index:02d} {column_index:02d}",
                        left,
                        Vector((tower_x, next_y, tower_z[column_index + 1])),
                        0.075,
                        steel_dark,
                    )
                    add_beam_between(
                        f"Reference tower diagonal B {level_index:02d} {column_index:02d}",
                        right,
                        Vector((tower_x, next_y, tower_z[column_index])),
                        0.075,
                        steel_dark,
                    )

    # A small cap beam gives the tower a crisp top silhouette.
    add_beam_between(
        "Reference tower top cap",
        Vector((tower_x, tower_top, tower_z[0])),
        Vector((tower_x, tower_top, tower_z[-1])),
        0.18,
        steel,
        bevel=0.025,
    )


def create_runway(
    ground_material: bpy.types.Material,
    road_material: bpy.types.Material,
    white_material: bpy.types.Material,
    edge_material: bpy.types.Material,
) -> None:
    """Create the clean approach lane seen at the foot of the reference ramp."""

    add_box("Test-range ground", (0.0, -0.75, -11.0), (95.0, 1.0, 95.0), ground_material)
    add_box("Ramp approach slab", (0.0, -0.02, 13.0), (RAMP_WIDTH + 4.0, 0.18, 26.0), road_material, bevel=0.06)
    add_box("Ramp approach left curb", (-RAMP_WIDTH * 0.5 - 1.7, 0.10, 13.0), (0.18, 0.16, 26.0), edge_material)
    add_box("Ramp approach right curb", (RAMP_WIDTH * 0.5 + 1.7, 0.10, 13.0), (0.18, 0.16, 26.0), edge_material)

    # Dashed center lane marks.
    for index, z in enumerate(range(3, 26, 5)):
        add_box(
            f"Approach lane dash {index:02d}",
            (0.0, 0.095, z),
            (0.12, 0.025, 2.6),
            white_material,
        )

    # A small top cap gives the vertical end a finished, engineered edge.
    add_box(
        "Top launch cap",
        (0.0, RAMP_RADIUS + 0.10, RAMP_START_Z - RAMP_RADIUS - 0.45),
        (RAMP_WIDTH, 0.20, 0.9),
        road_material,
        bevel=0.06,
    )


def add_text(
    name: str,
    body: str,
    location: tuple[float, float, float],
    material: bpy.types.Material,
    *,
    size: float = 0.7,
    extrude: float = 0.015,
) -> bpy.types.Object:
    """Add a modest readable label without relying on external font files."""

    font_data = bpy.data.curves.new(name=name, type="FONT")
    font_data.body = body
    font_data.align_x = "CENTER"
    font_data.align_y = "CENTER"
    font_data.size = size
    font_data.extrude = extrude
    font_data.bevel_depth = 0.008
    object_ = bpy.data.objects.new(name, font_data)
    bpy.context.collection.objects.link(object_)
    object_.location = location
    object_.data.materials.append(material)
    return object_


# -----------------------------------------------------------------------------
# Presentation setup
# -----------------------------------------------------------------------------


def add_area_light(
    name: str,
    location: tuple[float, float, float],
    energy: float,
    color: tuple[float, float, float],
    size: float,
    target: Vector,
) -> bpy.types.Object:
    """Create and aim an area light for predictable studio-style illumination."""

    light_data = bpy.data.lights.new(name=name, type="AREA")
    light_data.energy = energy
    light_data.color = color
    light_data.shape = "DISK"
    light_data.size = size
    object_ = bpy.data.objects.new(name, light_data)
    bpy.context.collection.objects.link(object_)
    object_.location = location
    point_camera_at(object_, target)
    return object_


def add_point_light(
    name: str,
    location: tuple[float, float, float],
    energy: float,
    color: tuple[float, float, float],
    radius: float = 0.5,
) -> bpy.types.Object:
    """Create a compact practical light along the ramp edge."""

    light_data = bpy.data.lights.new(name=name, type="POINT")
    light_data.energy = energy
    light_data.color = color
    light_data.shadow_soft_size = radius
    object_ = bpy.data.objects.new(name, light_data)
    bpy.context.collection.objects.link(object_)
    object_.location = location
    return object_


def create_edge_lights(
    lamp_material: bpy.types.Material,
    edge_material: bpy.types.Material,
) -> None:
    """Place low-profile amber markers along both sides of the runway/ramp."""

    for index, theta in enumerate((0.08, 0.28, 0.48, 0.68, 0.88, 1.08, 1.28)):
        if theta >= RAMP_END_ANGLE - 0.03:
            continue
        point = ramp_point(theta, offset=0.22)
        for side in (-1.0, 1.0):
            x = side * (RAMP_WIDTH * 0.5 + 0.58)
            post = add_cylinder(
                f"Ramp marker post {index:02d} {side:+.0f}",
                (x, point.y + 0.14, point.z),
                0.06,
                0.36,
                lamp_material,
                vertices=10,
            )
            post.rotation_euler[0] = theta
            add_box(
                f"Ramp marker lens {index:02d} {side:+.0f}",
                (x, point.y + 0.36, point.z),
                (0.28, 0.07, 0.12),
                edge_material,
                bevel=0.015,
                rotation=(theta, 0.0, 0.0),
            )


def create_sign(steel: bpy.types.Material, sign_material: bpy.types.Material) -> None:
    """Add a compact service sign to echo the small label in the reference."""

    sign_x = RAMP_WIDTH * 0.5 + 4.0
    sign_z = -RAMP_RADIUS - 5.4
    add_beam_between(
        "Sign support left",
        Vector((sign_x - 1.1, 0.0, sign_z)),
        Vector((sign_x - 1.1, 4.3, sign_z)),
        0.12,
        steel,
    )
    add_beam_between(
        "Sign support right",
        Vector((sign_x + 1.1, 0.0, sign_z)),
        Vector((sign_x + 1.1, 4.3, sign_z)),
        0.12,
        steel,
    )
    add_box(
        "Ramp service sign board",
        (sign_x, 3.35, sign_z),
        (3.3, 1.6, 0.14),
        sign_material,
        bevel=0.06,
    )
    sign_text = add_text(
        "Ramp service sign text",
        "V-01  /  RAMP",
        (sign_x, 3.35, sign_z + 0.10),
        bpy.data.materials["Warm edge emission"],
        size=0.32,
    )


def configure_scene() -> tuple[bpy.types.Material, ...]:
    """Create the palette and global render settings."""

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in {item.identifier for item in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items} else "BLENDER_EEVEE"
    scene.render.resolution_x = 720
    scene.render.resolution_y = 980
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(PREVIEW_PATH)
    scene.render.film_transparent = False
    scene.render.image_settings.color_mode = "RGBA"

    # Eevee property names changed in Blender 4, so set them only if present.
    eevee = getattr(scene, "eevee", None)
    if eevee is not None:
        if hasattr(eevee, "use_gtao"):
            eevee.use_gtao = True
        if hasattr(eevee, "gtao_distance"):
            eevee.gtao_distance = 3.0
        if hasattr(eevee, "gtao_factor"):
            eevee.gtao_factor = 1.35
        if hasattr(eevee, "taa_render_samples"):
            eevee.taa_render_samples = 64

    scene.world.color = (0.003, 0.006, 0.018)
    scene.view_settings.view_transform = "Filmic"
    if "Medium High Contrast" in {item.name for item in scene.view_settings.bl_rna.properties["look"].enum_items}:
        scene.view_settings.look = "Medium High Contrast"
    scene.view_settings.exposure = 0.25
    scene.view_settings.gamma = 1.0

    ramp = make_material(
        "Ramp surface",
        (0.16, 0.19, 0.22, 1.0),
        metallic=0.12,
        roughness=0.58,
    )
    ramp_side = make_material(
        "Ramp shell sides",
        (0.035, 0.048, 0.065, 1.0),
        metallic=0.55,
        roughness=0.33,
    )
    steel = make_material(
        "Structural steel",
        (0.12, 0.15, 0.19, 1.0),
        metallic=0.86,
        roughness=0.28,
    )
    steel_dark = make_material(
        "Structural steel dark",
        (0.035, 0.05, 0.075, 1.0),
        metallic=0.75,
        roughness=0.34,
    )
    road = make_material(
        "Approach asphalt",
        (0.055, 0.065, 0.08, 1.0),
        metallic=0.08,
        roughness=0.77,
    )
    ground = make_material(
        "Range ground",
        (0.008, 0.014, 0.03, 1.0),
        metallic=0.0,
        roughness=0.92,
    )
    white = make_material(
        "Lane marking",
        (0.68, 0.74, 0.77, 1.0),
        metallic=0.15,
        roughness=0.38,
        emission=(0.04, 0.07, 0.09, 1.0),
        emission_strength=0.4,
    )
    warm_edge = make_material(
        "Warm edge emission",
        (0.42, 0.035, 0.008, 1.0),
        metallic=0.18,
        roughness=0.3,
        emission=(1.0, 0.09, 0.012, 1.0),
        emission_strength=7.0,
    )
    amber = make_material(
        "Amber marker lens",
        (0.95, 0.25, 0.015, 1.0),
        metallic=0.05,
        roughness=0.24,
        emission=(1.0, 0.18, 0.01, 1.0),
        emission_strength=6.0,
    )
    sign = make_material(
        "Service sign",
        (0.018, 0.035, 0.07, 1.0),
        metallic=0.42,
        roughness=0.33,
    )
    # The rest of the script looks up the shared structural materials by name.
    return ramp, ramp_side, steel, steel_dark, road, ground, white, warm_edge, amber, sign


def configure_lighting(warm_edge: bpy.types.Material) -> None:
    """Set a navy night range with warm key light and cool rim separation."""

    target = Vector((0.0, RAMP_RADIUS * 0.52, -RAMP_RADIUS * 0.40))
    add_area_light("Warm key", (-26.0, 52.0, 31.0), 1650.0, (1.0, 0.38, 0.12), 28.0, target)
    add_area_light("Cool fill", (28.0, 30.0, 34.0), 1150.0, (0.10, 0.28, 1.0), 24.0, target)
    add_area_light("Soft top", (-8.0, 65.0, -45.0), 950.0, (0.62, 0.76, 1.0), 18.0, target)

    # A few real lights make the emission rails softly influence nearby metal.
    for index, theta in enumerate((0.18, 0.54, 0.90, 1.24)):
        point = ramp_point(theta, offset=0.24)
        add_point_light(
            f"Warm ramp practical {index:02d}",
            (0.0, point.y + 0.45, point.z),
            75.0,
            (1.0, 0.08, 0.015),
            radius=0.35,
        )

    # A small emissive plane at the upper cap adds the bright top rim visible
    # in the supplied night reference without flattening the whole scene.
    cap = add_box(
        "Top cap light strip",
        (0.0, RAMP_RADIUS + 0.24, RAMP_START_Z - RAMP_RADIUS - 0.88),
        (RAMP_WIDTH - 0.2, 0.08, 0.08),
        warm_edge,
        bevel=0.02,
    )
    cap.rotation_euler[0] = 0.0


def configure_camera() -> None:
    """Frame a portrait three-quarter shot close to the supplied reference."""

    camera_data = bpy.data.cameras.new("Reference ramp camera")
    camera = bpy.data.objects.new("Reference ramp camera", camera_data)
    bpy.context.collection.objects.link(camera)
    bpy.context.scene.camera = camera
    camera.location = (54.0, 18.0, 50.0)
    camera_data.lens = 48.0
    camera_data.sensor_width = 36.0
    point_camera_at(camera, Vector((0.0, 16.0, -11.5)))


def build_scene() -> None:
    """Build, light, save, and render the complete asset."""

    clear_scene()
    materials = configure_scene()
    (
        ramp_material,
        side_material,
        steel,
        steel_dark,
        road,
        ground,
        white,
        warm_edge,
        amber,
        sign,
    ) = materials

    create_ramp_shell(ramp_material, side_material)
    create_ramp_finish(warm_edge, white)
    create_truss_cage(steel, steel_dark)
    create_reference_side_tower(steel, steel_dark)
    create_runway(ground, road, white, warm_edge)
    create_edge_lights(amber, warm_edge)
    create_sign(steel, sign)
    configure_lighting(warm_edge)
    configure_camera()

    # Store useful design metadata directly in the .blend for later editing.
    scene = bpy.context.scene
    scene["reference_asset"] = "Image 1 / vertical quarter-pipe ramp"
    scene["blender_version_at_build"] = bpy.app.version_string
    scene["ramp_radius_m"] = RAMP_RADIUS
    scene["ramp_width_m"] = RAMP_WIDTH
    scene["ramp_thickness_m"] = RAMP_THICKNESS
    scene["ramp_profile"] = "circular quarter-pipe, 90 degrees"

    # Ensure output paths are absolute and reproducible even when Blender is
    # launched from another working directory.
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    # Avoid a growing .blend1/.blend2 trail when the generator is rerun.
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH))
    bpy.context.scene.render.filepath = str(PREVIEW_PATH)
    bpy.ops.render.render(write_still=True)
    print(f"Created Blender {bpy.app.version_string} scene: {BLEND_PATH}")
    print(f"Rendered preview: {PREVIEW_PATH}")


if __name__ == "__main__":
    # This script is intended to run inside Blender.  The guard is retained so
    # it is obvious when somebody accidentally invokes it with system Python.
    if "bpy" not in sys.modules:
        raise RuntimeError("Run this file with Blender: blender -b --python create_reference_ramp.py")
    build_scene()
