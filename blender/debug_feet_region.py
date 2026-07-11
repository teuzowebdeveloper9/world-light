"""
Debug: pinta de rosa as faces candidatas a "pés" (por posicao, usando os
mesmos FEET_*_RANGE de export_game_character.py) e renderiza de frente pra
calibrar visualmente, sem depender do addon MCP (que exige GUI).

  blender --background --python blender/debug_feet_region.py
"""
import bpy
import bmesh
import math
import os
import sys
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import export_game_character as m  # noqa: E402


def main():
    m.clear_scene()
    obj = m.import_and_decimate()
    m.make_face_glow(obj)

    mesh = obj.data
    mat = bpy.data.materials.new("DebugPink")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (1.0, 0.0, 0.8, 1.0)
    bsdf.inputs["Emission Color"].default_value = (1.0, 0.0, 0.8, 1.0)
    bsdf.inputs["Emission Strength"].default_value = 2.0
    mesh.materials.append(mat)
    idx = len(mesh.materials) - 1

    bm = bmesh.new()
    bm.from_mesh(mesh)
    bm.faces.ensure_lookup_table()
    count_left = count_right = 0
    for f in bm.faces:
        c = f.calc_center_median()
        if (
            m.FEET_X_RANGE[0] <= c.x <= m.FEET_X_RANGE[1]
            and m.FEET_Y_RANGE[0] <= c.y <= m.FEET_Y_RANGE[1]
            and m.FEET_Z_RANGE[0] <= c.z <= m.FEET_Z_RANGE[1]
        ):
            f.material_index = idx
            if c.x < 0:
                count_left += 1
            else:
                count_right += 1
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    print("faces candidatas a pe: left=", count_left, "right=", count_right)
    print("FEET_Z_RANGE:", m.FEET_Z_RANGE, "FEET_Y_RANGE:", m.FEET_Y_RANGE, "FEET_X_RANGE:", m.FEET_X_RANGE)

    cam_data = bpy.data.cameras.new("Camera")
    cam_data.lens = 45
    cam_obj = bpy.data.objects.new("Camera", cam_data)
    bpy.context.collection.objects.link(cam_obj)
    focus_z = (m.FEET_Z_RANGE[0] + m.FEET_Z_RANGE[1]) / 2
    cam_loc = Vector((1.4, 0.0, focus_z))
    target = Vector((0.0, 0.0, focus_z))
    cam_obj.location = cam_loc
    cam_obj.rotation_euler = (target - cam_loc).to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.camera = cam_obj

    light = bpy.data.lights.new("Sun", type="SUN")
    light.energy = 3.0
    light_obj = bpy.data.objects.new("Sun", light)
    light_obj.rotation_euler = (math.radians(50), 0, math.radians(30))
    bpy.context.collection.objects.link(light_obj)

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 700
    scene.render.resolution_y = 700
    scene.render.film_transparent = False
    scene.render.filepath = os.path.join(m.REPO_ROOT, "blender", "renders", "debug-feet-region.png")
    bpy.ops.render.render(write_still=True)
    print("DONE")


if __name__ == "__main__":
    main()
