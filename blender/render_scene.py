"""Headless Blender scene worker.

Usage: blender --background --python blender/render_scene.py -- job.json
"""
import json
import math
import os
import sys

import bpy


def job_path():
    args = sys.argv
    return args[args.index("--") + 1]


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)


def clamp01(value, fallback=0.5):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    return min(max(number, 0.0), 1.0)


def job_focus(job):
    """The slide's focal point, injected into params by src/renderBlenderScene.ts."""
    params = job.get("params", {})
    return (clamp01(params.get("focusX")), clamp01(params.get("focusY")))


def cover_photo_uvs(obj, image, plane_aspect, focus):
    """Bake a cover-fit crop into the mesh UVs: keep the IMAGE's own aspect, never stretch it
    to the plane's, and centre the kept window on the slide's focal point.

    Straight 0..1 UVs stretch whatever they are handed — a 3:4 portrait on a 1.59 plane comes
    out 2.4x too wide, which on a wedding film is a deformed face — and a centred crop takes
    the faces off first, which is the whole reason every native effect in this engine crops
    around focusX/focusY.

    Baked into UVs rather than done with a Mapping node because Workbench, which four of these
    templates render on, ignores the shader graph and samples the image straight off the UV
    map: a Mapping node there is silently a no-op (verified by render, not by doc-reading)."""
    image_aspect = (image.size[0] / image.size[1]) if image.size[1] else plane_aspect
    keep_x = min(1.0, plane_aspect / image_aspect)
    keep_y = min(1.0, image_aspect / plane_aspect)
    # focusY is top-down (every other framing consumer in the engine); texture v is bottom-up.
    offset_x = min(max(focus[0] - keep_x / 2.0, 0.0), 1.0 - keep_x)
    offset_y = min(max((1.0 - focus[1]) - keep_y / 2.0, 0.0), 1.0 - keep_y)
    uv_layer = obj.data.uv_layers.active
    if not uv_layer:
        return
    for loop_uv in uv_layer.data:
        u, v = loop_uv.uv
        loop_uv.uv = (offset_x + u * keep_x, offset_y + v * keep_y)


def photo_texture_material(name, image, brightness=None):
    """`brightness=None` shades the photo like a real surface (the flat-page templates want
    that — the page is an object in a lit room). A number instead makes it unlit emission at
    that strength, so the plane reads as the photograph rather than as the photograph relit."""
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    principled = nodes.get("Principled BSDF")
    texture = nodes.new("ShaderNodeTexImage")
    texture.image = image
    texture.extension = "EXTEND"
    # Link UV explicitly so EEVEE reads the same coordinates Workbench does, and so the baked
    # crop in cover_photo_uvs is what both of them sample.
    coord = nodes.new("ShaderNodeTexCoord")
    links.new(coord.outputs["UV"], texture.inputs["Vector"])
    if brightness is None:
        links.new(texture.outputs["Color"], principled.inputs["Base Color"])
        principled.inputs["Roughness"].default_value = 0.72
    else:
        links.new(texture.outputs["Color"], principled.inputs["Emission Color"])
        principled.inputs["Emission Strength"].default_value = brightness
        principled.inputs["Base Color"].default_value = (0.0, 0.0, 0.0, 1.0)
        principled.inputs["Specular IOR Level"].default_value = 0.0
        principled.inputs["Roughness"].default_value = 1.0
    return material


def dress_photo_plane(obj, filename, plane_aspect, focus, brightness=None):
    """Put a photograph on an already-built plane: cover-fitted, focus-aware, textured."""
    image = bpy.data.images.load(filename, check_existing=True)
    cover_photo_uvs(obj, image, plane_aspect, focus)
    obj.data.materials.append(photo_texture_material(obj.name + "Material", image, brightness))
    return obj


def page(name, filename, focus, z=0.0):
    bpy.ops.mesh.primitive_grid_add(x_subdivisions=65, y_subdivisions=40, size=2, location=(0, 0, z))
    obj = bpy.context.object
    obj.name = name
    obj.scale = (3.3, 2.1, 1)
    return dress_photo_plane(obj, filename, 3.3 / 2.1, focus)


def configure_render_io(job, scene):
    scene.render.resolution_x = int(job["width"])
    scene.render.resolution_y = int(job["height"])
    scene.render.resolution_percentage = int(job.get("params", {}).get("renderScale", 100))
    scene.render.fps = int(job["fps"])
    scene.frame_start = 1
    scene.frame_end = max(1, round(float(job["duration"]) * int(job["fps"])))
    scene.render.image_settings.file_format = "PNG"
    frames_dir = os.path.splitext(os.path.abspath(job["output"]))[0] + "-frames"
    os.makedirs(frames_dir, exist_ok=True)
    for filename in os.listdir(frames_dir):
        if filename.lower().endswith(".png"):
            os.remove(os.path.join(frames_dir, filename))
    scene.render.filepath = os.path.join(frames_dir, "frame_")


def add_tracking_camera(location, rotation, lens):
    bpy.ops.object.camera_add(location=location, rotation=rotation)
    camera = bpy.context.object
    camera.data.lens = lens
    track = camera.constraints.new(type="TRACK_TO")
    bpy.ops.object.empty_add(location=(0, 0, 0))
    track.target = bpy.context.object
    track.track_axis = "TRACK_NEGATIVE_Z"
    track.up_axis = "UP_Y"
    return camera


def setup_world(job):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "TEXTURE"
    scene.display.shading.show_shadows = True
    scene.display.shading.show_cavity = True
    scene.display.shading.cavity_type = "WORLD"
    configure_render_io(job, scene)
    scene.world.color = (0.055, 0.045, 0.035)

    camera = add_tracking_camera((0, -8.7, 7.8), (math.radians(43), 0, 0), 52)
    scene.camera = camera

    bpy.ops.object.light_add(type="AREA", location=(-3, -3, 7))
    bpy.context.object.data.energy = 1100
    bpy.context.object.data.shape = "DISK"
    bpy.context.object.data.size = 5
    bpy.ops.object.light_add(type="AREA", location=(4, 1, 4))
    bpy.context.object.data.energy = 700
    bpy.context.object.data.size = 4
    return scene, camera


def setup_world_eevee(job):
    """Real lighting + depth of field for the ring/frame templates. Workbench (setup_world)
    fakes shading with studio lights and can't produce bokeh, so these use EEVEE instead."""
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.eevee.use_raytracing = True
    # EEVEE accumulates depth of field across TAA samples, so this is the bokeh quality dial
    # as much as the noise dial — and the single biggest cost knob on these minutes-per-scene
    # templates. 32 rather than Blender's 64: measured at 1080p, 32 scores ~62 dB PSNR against
    # 64 (visually lossless, and stable frame to frame so it does not shimmer in motion) for
    # 4.5 s/frame instead of 8.0. Raise it if a scene ever shows bokeh noise; lower for previews.
    scene.eevee.taa_render_samples = int(job.get("params", {}).get("renderSamples", 32))
    scene.view_settings.view_transform = "Standard"
    configure_render_io(job, scene)
    # Through the node tree — `world.color` drives Workbench and the viewport only, so this
    # line was a no-op for its whole life and these scenes rendered on Blender's default grey.
    # Held at that same 0.05 rather than the 0.02 it always claimed: metal and glass are mostly
    # REFLECTIONS of the environment, and dropping to near-black now would darken the one
    # template that has been quietly relying on the default.
    set_world_ambient(scene, (0.05, 0.045, 0.04))

    camera = add_tracking_camera((0, -6.0, 0.3), (math.radians(90), 0, 0), 85)
    camera.data.dof.use_dof = True
    camera.data.dof.aperture_fstop = 1.8
    scene.camera = camera

    bpy.ops.object.light_add(type="AREA", location=(-2.5, -3.5, 2.5))
    bpy.context.object.data.energy = 350
    bpy.context.object.data.size = 3
    bpy.context.object.data.color = (1.0, 0.93, 0.82)
    bpy.ops.object.light_add(type="AREA", location=(3, -1.5, 1.5))
    bpy.context.object.data.energy = 180
    bpy.context.object.data.size = 2
    return scene, camera


def page_flip(job):
    assets = [os.path.abspath(p) for p in job["assets"]]
    focus = job_focus(job)
    back = page("PageB", assets[1], focus, 0.0)
    front = page("PageA", assets[0], focus, 0.025)
    bend = front.modifiers.new("PageCurl", "SIMPLE_DEFORM")
    bend.deform_method = "BEND"
    bend.deform_axis = "Y"
    bend.angle = 0
    bend.keyframe_insert(data_path="angle", frame=1)
    bend.angle = math.radians(168)
    bend.keyframe_insert(data_path="angle", frame=max(2, round(job["duration"] * job["fps"] * 0.72)))
    front.rotation_euler[1] = 0
    front.keyframe_insert(data_path="rotation_euler", frame=1)
    front.rotation_euler[1] = math.radians(-178)
    front.keyframe_insert(data_path="rotation_euler", frame=max(2, round(job["duration"] * job["fps"] * 0.72)))


def camera_gallery(job, camera):
    assets = [os.path.abspath(p) for p in job["assets"]]
    focus = job_focus(job)
    count = max(1, len(assets))
    for i, asset in enumerate(assets):
        p = page("Gallery%02d" % i, asset, focus, i * 0.08)
        p.location.x = (i - (count - 1) / 2) * 2.4
        p.rotation_euler[2] = math.radians((i - count / 2) * 3)
        p.scale *= 0.62
    camera.location.x = -2.2
    camera.keyframe_insert(data_path="location", frame=1)
    camera.location.x = 2.2
    camera.keyframe_insert(data_path="location", frame=max(2, round(job["duration"] * job["fps"])))


def gold_material(name):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    principled = material.node_tree.nodes.get("Principled BSDF")
    principled.inputs["Base Color"].default_value = (0.83, 0.68, 0.21, 1.0)
    principled.inputs["Metallic"].default_value = 1.0
    principled.inputs["Roughness"].default_value = 0.22
    return material


def emissive_sphere(name, location, radius, color, strength):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=radius, location=location, segments=16, ring_count=8)
    obj = bpy.context.object
    obj.name = name
    material = bpy.data.materials.new(name + "Material")
    material.use_nodes = True
    principled = material.node_tree.nodes.get("Principled BSDF")
    principled.inputs["Base Color"].default_value = (*color, 1.0)
    principled.inputs["Emission Color"].default_value = (*color, 1.0)
    principled.inputs["Emission Strength"].default_value = strength
    obj.data.materials.append(material)
    return obj


def standing_page(name, filename, location, focus, half_size=(1.75, 1.1)):
    """A photo plane rotated upright to face a level camera (page() lies flat on the ground)."""
    bpy.ops.mesh.primitive_grid_add(x_subdivisions=65, y_subdivisions=40, size=2, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.rotation_euler[0] = math.radians(90)
    obj.scale = (half_size[0], half_size[1], 1)
    return dress_photo_plane(obj, filename, half_size[0] / half_size[1], focus)


def frame_border(name, location, half_size):
    bpy.ops.mesh.primitive_plane_add(size=2, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.rotation_euler[0] = math.radians(90)
    obj.scale = (half_size[0], half_size[1], 1)
    material = bpy.data.materials.new(name + "Material")
    material.use_nodes = True
    principled = material.node_tree.nodes.get("Principled BSDF")
    principled.inputs["Base Color"].default_value = (0.05, 0.04, 0.03, 1.0)
    principled.inputs["Metallic"].default_value = 0.6
    principled.inputs["Roughness"].default_value = 0.35
    obj.data.materials.append(material)
    return obj


def frustum_half_extent(camera, scene, distance):
    """Half width/height of what the camera actually sees `distance` units in front of it.
    Sensor fit AUTO puts the sensor size on the LONGER render axis. Sizing scenery off this
    instead of off hand-tuned world units is the difference between a composition that holds
    at any project resolution and one that was eyeballed once at 16:9."""
    res_x = max(1, int(scene.render.resolution_x))
    res_y = max(1, int(scene.render.resolution_y))
    half_long = distance * (camera.data.sensor_width / 2.0) / camera.data.lens
    if res_x >= res_y:
        return half_long, half_long * res_y / res_x
    return half_long * res_x / res_y, half_long


def action_fcurves(owner):
    """Blender 4.4+ moved an action's curves behind layers/strips/slots and 5.x dropped
    `action.fcurves` entirely, so reach them through whichever layout this build exposes."""
    anim = owner.animation_data
    action = anim.action if anim else None
    if not action:
        return []
    legacy = getattr(action, "fcurves", None)
    if legacy is not None:
        return list(legacy)
    curves = []
    for layer in action.layers:
        for strip in layer.strips:
            bag = strip.channelbag(anim.action_slot)
            if bag:
                curves.extend(bag.fcurves)
    return curves


def ease_curves(owner, data_path, interpolation="SINE", easing="EASE_IN_OUT"):
    """Keyframes default to BEZIER/AUTO, which eases into AND out of every key. On a spin
    that reads as a wobble at both ends; on a focus rack, as a lurch. State the curve."""
    for curve in action_fcurves(owner):
        if not curve.data_path.endswith(data_path):
            continue
        for point in curve.keyframe_points:
            point.interpolation = interpolation
            point.easing = easing


def set_world_ambient(scene, color, strength=1.0):
    """EEVEE renders the world through its node tree; `world.color` only drives Workbench and
    the viewport, so setting that alone leaves an EEVEE scene on Blender's default grey.
    Ambient is load-bearing for this template: metal and glass are mostly REFLECTIONS of the
    environment, and a near-black world is why the gold read olive and the gem read as coal."""
    world = scene.world
    background = world.node_tree.nodes.get("Background") if world.use_nodes and world.node_tree else None
    if background:
        background.inputs["Color"].default_value = (color[0], color[1], color[2], 1.0)
        background.inputs["Strength"].default_value = strength
    else:
        world.color = color


def photo_backdrop(name, filename, camera, scene, distance, focus, brightness, margin=1.02):
    """A photo plane sized to exactly fill the frame at `distance`, facing a level camera."""
    half_w, half_h = frustum_half_extent(camera, scene, distance)
    half_w *= margin
    half_h *= margin
    bpy.ops.mesh.primitive_grid_add(
        x_subdivisions=2, y_subdivisions=2, size=2,
        location=(camera.location.x, camera.location.y + distance, camera.location.z),
    )
    obj = bpy.context.object
    obj.name = name
    obj.rotation_euler[0] = math.radians(90)
    obj.scale = (half_w, half_h, 1)
    return dress_photo_plane(obj, filename, half_w / half_h, focus, brightness)


def ring_spin_reveal(job, camera):
    params = job.get("params", {})
    assets = [os.path.abspath(p) for p in job["assets"]]
    scene = bpy.context.scene
    # Level the camera. The TRACK_TO empty sits at the origin, so any camera height tilts the
    # view axis and the backdrop stops being perpendicular to it — which is exactly the
    # assumption photo_backdrop's frustum fit is built on.
    camera.location.z = 0.0

    focus = job_focus(job)
    ring_distance = float(params.get("ringDistance", 2.4))
    photo_distance = float(params.get("photoDistance", 9.0))
    # Warm, mid-bright environment. The backdrop is unlit emission so this cannot wash the
    # photograph out — it only reaches the metal and the stone, which is the whole point.
    set_world_ambient(scene, (0.30, 0.26, 0.22))
    photo_backdrop("Backdrop", assets[0], camera, scene, photo_distance, focus,
                   float(params.get("photoBrightness", 1.0)))

    # Size and place the ring in FRAME terms. Hand-picked world units made it 2.02 units wide
    # inside a 1.95-unit-wide frustum: the "ring" overflowed the frame on every side and read
    # as a gold porthole, not as jewellery.
    half_w, half_h = frustum_half_extent(camera, scene, ring_distance)
    major = half_h * float(params.get("ringScale", 0.54))
    minor = major * 0.11  # a band. The old 0.16-on-0.85 was a napkin ring.
    # Stand it off the subject's side so the rack focus reveals a face, not a face behind gold.
    side = 1.0 if focus[0] < 0.5 else -1.0
    ring_location = (
        camera.location.x + side * half_w * 0.46,
        camera.location.y + ring_distance,
        # Low in frame. A foreground object near the lens belongs there, and it keeps the
        # ring off the face line, where a wedding photo puts its subjects.
        camera.location.z - half_h * 0.30,
    )
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major, minor_radius=minor, location=ring_location,
        major_segments=96, minor_segments=32,
    )
    ring = bpy.context.object
    ring.name = "Ring"
    ring.rotation_euler[0] = math.radians(90)
    bpy.ops.object.shade_smooth()  # default flat shading bands polished gold into facets
    ring.data.materials.append(gold_material("RingMaterial"))

    # The gem sits at 12 o'clock ON the band, faceted rather than a smooth ball: flat shading
    # on an icosphere is what makes a stone catch light in separate glints instead of sliding
    # one soft highlight around a sphere.
    bpy.ops.mesh.primitive_ico_sphere_add(
        radius=minor * 1.7, subdivisions=2,
        location=(ring_location[0], ring_location[1], ring_location[2] + major + minor * 0.4),
    )
    gem = bpy.context.object
    gem.name = "Gem"
    bpy.ops.object.shade_flat()
    bpy.context.view_layer.update()
    gem.parent = ring
    # Assigning `.parent` alone leaves matrix_parent_inverse at identity, which re-reads the
    # child's WORLD location as a parent-space offset. That flung the old gem to (0,-2.25,-1.4)
    # — below the ring, outside the frustum — so the "glass gem" the docs promise had never
    # once been on screen. Cancelling the parent's matrix is what keeps it where it was placed.
    gem.matrix_parent_inverse = ring.matrix_world.inverted()
    gem_material = bpy.data.materials.new("GemMaterial")
    gem_material.use_nodes = True
    # Transmission alone renders black in EEVEE — it is a raytracing feature, and without this
    # flag the stone refracts nothing and shows the unlit inside of its own mesh.
    gem_material.use_raytrace_refraction = True
    gem_material.use_screen_refraction = True
    gem_material.refraction_depth = minor * 1.7
    gem_principled = gem_material.node_tree.nodes.get("Principled BSDF")
    gem_principled.inputs["Base Color"].default_value = (0.95, 0.98, 1.0, 1.0)
    gem_principled.inputs["Transmission Weight"].default_value = 1.0
    gem_principled.inputs["Roughness"].default_value = 0.02
    gem_principled.inputs["IOR"].default_value = 2.4
    gem.data.materials.append(gem_material)

    # Warm points between ring and photo, defocused at both ends of the rack. Frame-relative
    # for the same reason the ring is: the old pair sat at x=-1.8 and x=2.0 in a frustum
    # 1.14 units wide at their depth, i.e. off screen for the whole shot. Corners only — the
    # photo owns the middle of the frame, and a blown-out white disc parked on a face is worse
    # than no bokeh at all. Strength stays near 1.0 because the Standard view transform clips:
    # push a warm colour past white and every dot renders as a flat white circle.
    glow_distance = ring_distance + (photo_distance - ring_distance) * 0.35
    glow_w, glow_h = frustum_half_extent(camera, scene, glow_distance)
    for i, (fx, fz, fd, radius) in enumerate([
        (-0.82, 0.58, 0.0, 0.042), (0.86, 0.64, 0.6, 0.034), (-0.74, -0.66, -0.5, 0.038),
    ]):
        emissive_sphere(
            "Glow%d" % i,
            (camera.location.x + fx * glow_w,
             camera.location.y + glow_distance + fd,
             camera.location.z + fz * glow_h),
            radius, (1.0, 0.78, 0.48), 0.85,
        )

    frames = max(2, round(job["duration"] * job["fps"]))
    ring.rotation_euler[2] = 0
    ring.keyframe_insert(data_path="rotation_euler", frame=1)
    ring.rotation_euler[2] = math.radians(float(params.get("spinDegrees", 700)))
    ring.keyframe_insert(data_path="rotation_euler", frame=frames)
    # Spun once and coming to rest, landing 20 degrees off face-on so it still reads as 3D.
    ease_curves(ring, "rotation_euler", "SINE", "EASE_OUT")

    hold = max(2, round(frames * 0.35))
    reveal = max(hold + 1, round(frames * 0.78))
    camera.data.dof.focus_distance = ring_distance
    camera.data.dof.keyframe_insert(data_path="focus_distance", frame=1)
    camera.data.dof.focus_distance = ring_distance
    camera.data.dof.keyframe_insert(data_path="focus_distance", frame=hold)
    camera.data.dof.focus_distance = photo_distance
    camera.data.dof.keyframe_insert(data_path="focus_distance", frame=reveal)
    ease_curves(camera.data, "dof.focus_distance", "SINE", "EASE_IN_OUT")


def photo_frame_orbit(job, camera):
    # setup_world_eevee's 85mm default is too tight for this composition — the wide gallery
    # shot needs the background bokeh lights actually inside frame, not cropped off by a tele lens.
    camera.data.lens = 35
    assets = [os.path.abspath(p) for p in job["assets"]]
    frame_border("Frame", (0, 0.03, 0), half_size=(1.9, 1.25))
    standing_page("Photo", assets[0], (0, 0, 0), job_focus(job), half_size=(1.75, 1.1))

    warm = (1.0, 0.82, 0.55)
    bokeh_positions = [
        (-2.6, 2.4, 1.1), (2.8, 2.0, -0.8), (-2.2, 3.4, -1.4),
        (2.4, 3.0, 1.6), (0.4, 2.8, 2.0), (-3.0, 3.8, 0.2),
    ]
    for i, pos in enumerate(bokeh_positions):
        emissive_sphere("Bokeh%d" % i, pos, 0.07 + (i % 3) * 0.02, warm, 6.0)

    frames = max(2, round(job["duration"] * job["fps"]))
    radius = 5.6
    start_angle = math.radians(-26)
    end_angle = math.radians(26)
    for f in (1, frames):
        t = 0.0 if f == 1 else 1.0
        angle = start_angle + (end_angle - start_angle) * t
        camera.location.x = math.sin(angle) * radius
        camera.location.y = -math.cos(angle) * radius
        camera.keyframe_insert(data_path="location", frame=f)

    camera.data.dof.focus_distance = radius


def photo_carousel_3d(job, camera):
    assets = [os.path.abspath(p) for p in job["assets"][:4]]
    frames = max(2, round(job["duration"] * job["fps"]))
    focus = job_focus(job)
    positions = [(-3.0, 1.2, 0.4), (-1.0, 0.2, 0.0), (1.0, 0.2, 0.0), (3.0, 1.2, 0.4)]
    for i, (asset, location) in enumerate(zip(assets, positions)):
        card = standing_page("Carousel%02d" % i, asset, location, focus, half_size=(1.25, 0.82))
        card.rotation_euler[2] = math.radians((i - 1.5) * -8)
        card.keyframe_insert(data_path="rotation_euler", frame=1)
        card.rotation_euler[2] += math.radians(10)
        card.keyframe_insert(data_path="rotation_euler", frame=frames)

    camera.data.lens = 46
    camera.location.x = -2.0
    camera.keyframe_insert(data_path="location", frame=1)
    camera.location.x = 2.0
    camera.keyframe_insert(data_path="location", frame=frames)


def floating_collage_3d(job, camera):
    assets = [os.path.abspath(p) for p in job["assets"][:4]]
    frames = max(2, round(job["duration"] * job["fps"]))
    settle = max(2, round(frames * 0.22))
    leave = max(settle + 1, round(frames * 0.78))
    settled = [(-2.1, 0.9, 0.9), (1.8, 0.7, 0.3), (-1.3, -0.1, -1.0), (2.2, 0.1, -0.8)]
    starts = [(-6.5, 2.8, 3.0), (6.5, 2.4, 2.0), (-5.8, -1.0, -2.4), (6.0, -0.8, -2.0)]
    focus = job_focus(job)
    for i, asset in enumerate(assets):
        card = standing_page("Floating%02d" % i, asset, starts[i], focus, half_size=(1.45, 0.94))
        card.rotation_euler[2] = math.radians((-1 if i % 2 == 0 else 1) * (12 + i * 2))
        card.keyframe_insert(data_path="location", frame=1)
        card.keyframe_insert(data_path="rotation_euler", frame=1)
        card.location = settled[i]
        card.rotation_euler[2] = math.radians((-1 if i % 2 == 0 else 1) * 3)
        card.keyframe_insert(data_path="location", frame=settle)
        card.keyframe_insert(data_path="rotation_euler", frame=settle)
        card.keyframe_insert(data_path="location", frame=leave)
        card.keyframe_insert(data_path="rotation_euler", frame=leave)
        card.location = starts[i]
        card.rotation_euler[2] = math.radians((-1 if i % 2 == 0 else 1) * 18)
        card.keyframe_insert(data_path="location", frame=frames)
        card.keyframe_insert(data_path="rotation_euler", frame=frames)

    camera.data.lens = 42


EEVEE_TEMPLATES = {"ring_spin_reveal", "photo_frame_orbit"}


def main():
    with open(job_path(), "r", encoding="utf-8") as handle:
        job = json.load(handle)
    clear_scene()
    template = job["template"]
    scene, camera = setup_world_eevee(job) if template in EEVEE_TEMPLATES else setup_world(job)
    if template == "page_flip_3d":
        page_flip(job)
    elif template == "camera_gallery_3d":
        camera_gallery(job, camera)
    elif template == "ring_spin_reveal":
        ring_spin_reveal(job, camera)
    elif template == "photo_frame_orbit":
        photo_frame_orbit(job, camera)
    elif template == "photo_carousel_3d":
        photo_carousel_3d(job, camera)
    elif template == "floating_collage_3d":
        floating_collage_3d(job, camera)
    else:
        raise ValueError("Unknown Blender template: " + template)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.splitext(os.path.abspath(job["output"]))[0] + ".blend")
    bpy.ops.render.render(animation=True)


main()
