"""
Renderiza 4 frames do ciclo de Walk vistos de perfil (lateral), pra
confirmar visualmente o aceno frente/trás do capuz (rotation Y) — mais
confiável que comparar componentes de quaternion em sistemas de
coordenadas diferentes (Blender Z-up vs glTF Y-up remapeia o eixo da
rotação, não só troca de nome).

  blender --background --python blender/debug_hood_nod.py
"""
import bpy
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
    hood = m.separate_hood(obj)
    all_objs = [obj, hood]
    m.make_game_ready(all_objs)
    hood_seam_z = min(v.co.z for v in hood.data.vertices)
    m.set_origin_to_z(hood, hood_seam_z)
    m.add_walk_cycle(obj, hood)

    # vista lateral (perfil) - olhando ao longo do eixo Y (ombro a ombro),
    # pra ver claramente qualquer inclinacao frente/tras (eixo X, frente-tras)
    corners = [hood.matrix_world @ v.co for v in hood.data.vertices]
    hood_center_z = (min(c.z for c in corners) + max(c.z for c in corners)) / 2
    print("hood_center_z", hood_center_z)

    cam_data = bpy.data.cameras.new("Camera")
    cam_data.lens = 50
    cam_obj = bpy.data.objects.new("Camera", cam_data)
    bpy.context.collection.objects.link(cam_obj)
    cam_loc = Vector((0.0, -1.3, hood_center_z))
    target = Vector((0.0, 0.0, hood_center_z))
    cam_obj.location = cam_loc
    cam_obj.rotation_euler = (target - cam_loc).to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.camera = cam_obj

    light = bpy.data.lights.new("Sun", type="SUN")
    light.energy = 3.0
    light_obj = bpy.data.objects.new("Sun", light)
    light_obj.rotation_euler = (math.radians(50), 0, math.radians(30))
    bpy.context.collection.objects.link(light_obj)

    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 24
    scene.render.resolution_x = 500
    scene.render.resolution_y = 700
    scene.render.film_transparent = False

    out_dir = os.path.join(m.REPO_ROOT, "blender", "renders")
    for frame in (0, 5, 10, 15):
        scene.frame_set(frame)
        scene.render.filepath = os.path.join(out_dir, f"debug-hood-nod-f{frame}.png")
        bpy.ops.render.render(write_still=True)
        print("rendered frame", frame)

    print("DONE")


if __name__ == "__main__":
    main()
