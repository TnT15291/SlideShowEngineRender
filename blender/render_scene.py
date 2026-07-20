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


def image_material(name, filename):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    principled = nodes.get("Principled BSDF")
    texture = nodes.new("ShaderNodeTexImage")
    texture.image = bpy.data.images.load(filename, check_existing=True)
    material.node_tree.links.new(texture.outputs["Color"], principled.inputs["Base Color"])
    principled.inputs["Roughness"].default_value = 0.72
    return material


def page(name, filename, z=0.0):
    bpy.ops.mesh.primitive_grid_add(x_subdivisions=65, y_subdivisions=40, size=2, location=(0, 0, z))
    obj = bpy.context.object
    obj.name = name
    obj.scale = (3.3, 2.1, 1)
    obj.data.materials.append(image_material(name + "Material", filename))
    return obj


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
    scene.view_settings.view_transform = "Standard"
    configure_render_io(job, scene)
    scene.world.color = (0.02, 0.018, 0.016)

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
    back = page("PageB", assets[1], 0.0)
    front = page("PageA", assets[0], 0.025)
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
    count = max(1, len(assets))
    for i, asset in enumerate(assets):
        p = page("Gallery%02d" % i, asset, i * 0.08)
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


def standing_page(name, filename, location, half_size=(1.75, 1.1)):
    """A photo plane rotated upright to face a level camera (page() lies flat on the ground)."""
    bpy.ops.mesh.primitive_grid_add(x_subdivisions=65, y_subdivisions=40, size=2, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.rotation_euler[0] = math.radians(90)
    obj.scale = (half_size[0], half_size[1], 1)
    obj.data.materials.append(image_material(name + "Material", filename))
    return obj


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


def ring_spin_reveal(job, camera):
    assets = [os.path.abspath(p) for p in job["assets"]]
    standing_page("Backdrop", assets[0], (0, 1.6, 0), half_size=(3.0, 1.9))

    bpy.ops.mesh.primitive_torus_add(major_radius=0.85, minor_radius=0.16, location=(0, -1.4, 0))
    ring = bpy.context.object
    ring.name = "Ring"
    ring.rotation_euler[0] = math.radians(90)
    ring.data.materials.append(gold_material("RingMaterial"))

    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.2, location=(0, -1.4, 0.85))
    gem = bpy.context.object
    gem.name = "Gem"
    gem.parent = ring
    gem_material = bpy.data.materials.new("GemMaterial")
    gem_material.use_nodes = True
    gem_principled = gem_material.node_tree.nodes.get("Principled BSDF")
    gem_principled.inputs["Base Color"].default_value = (0.95, 0.98, 1.0, 1.0)
    gem_principled.inputs["Transmission Weight"].default_value = 1.0
    gem_principled.inputs["Roughness"].default_value = 0.02
    gem_principled.inputs["IOR"].default_value = 2.4
    gem.data.materials.append(gem_material)

    emissive_sphere("GlowA", (-1.8, -0.6, 0.6), 0.12, (1.0, 0.86, 0.6), 4.0)
    emissive_sphere("GlowB", (2.0, -0.9, -0.4), 0.1, (1.0, 0.8, 0.55), 3.0)

    frames = max(2, round(job["duration"] * job["fps"]))
    ring.rotation_euler[2] = 0
    ring.keyframe_insert(data_path="rotation_euler", frame=1)
    ring.rotation_euler[2] = math.radians(560)
    ring.keyframe_insert(data_path="rotation_euler", frame=frames)

    hold = max(2, round(frames * 0.35))
    reveal = max(hold + 1, round(frames * 0.78))
    camera.data.dof.focus_distance = 4.6
    camera.data.dof.keyframe_insert(data_path="focus_distance", frame=1)
    camera.data.dof.focus_distance = 4.6
    camera.data.dof.keyframe_insert(data_path="focus_distance", frame=hold)
    camera.data.dof.focus_distance = 7.6
    camera.data.dof.keyframe_insert(data_path="focus_distance", frame=reveal)


def photo_frame_orbit(job, camera):
    # setup_world_eevee's 85mm default is too tight for this composition — the wide gallery
    # shot needs the background bokeh lights actually inside frame, not cropped off by a tele lens.
    camera.data.lens = 35
    assets = [os.path.abspath(p) for p in job["assets"]]
    frame_border("Frame", (0, 0.03, 0), half_size=(1.9, 1.25))
    standing_page("Photo", assets[0], (0, 0, 0), half_size=(1.75, 1.1))

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
    else:
        raise ValueError("Unknown Blender template: " + template)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.splitext(os.path.abspath(job["output"]))[0] + ".blend")
    bpy.ops.render.render(animation=True)


main()
