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


def setup_world(job):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "TEXTURE"
    scene.display.shading.show_shadows = True
    scene.display.shading.show_cavity = True
    scene.display.shading.cavity_type = "WORLD"
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
    scene.world.color = (0.055, 0.045, 0.035)

    bpy.ops.object.camera_add(location=(0, -8.7, 7.8), rotation=(math.radians(43), 0, 0))
    camera = bpy.context.object
    camera.data.lens = 52
    scene.camera = camera
    track = camera.constraints.new(type="TRACK_TO")
    bpy.ops.object.empty_add(location=(0, 0, 0))
    track.target = bpy.context.object
    track.track_axis = "TRACK_NEGATIVE_Z"
    track.up_axis = "UP_Y"

    bpy.ops.object.light_add(type="AREA", location=(-3, -3, 7))
    bpy.context.object.data.energy = 1100
    bpy.context.object.data.shape = "DISK"
    bpy.context.object.data.size = 5
    bpy.ops.object.light_add(type="AREA", location=(4, 1, 4))
    bpy.context.object.data.energy = 700
    bpy.context.object.data.size = 4
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


def main():
    with open(job_path(), "r", encoding="utf-8") as handle:
        job = json.load(handle)
    clear_scene()
    scene, camera = setup_world(job)
    if job["template"] == "page_flip_3d":
        page_flip(job)
    elif job["template"] == "camera_gallery_3d":
        camera_gallery(job, camera)
    else:
        raise ValueError("Unknown Blender template: " + job["template"])
    bpy.ops.wm.save_as_mainfile(filepath=os.path.splitext(os.path.abspath(job["output"]))[0] + ".blend")
    bpy.ops.render.render(animation=True)


main()
