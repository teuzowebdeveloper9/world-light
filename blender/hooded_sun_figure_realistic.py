"""
Hooded Sun Figure (realista) — parte de um modelo .glb externo (gerado via
Tripo AI), decimado e com uma região do rosto transformada em um "sol"
emissivo, sem revelar rosto nenhum. Testado ao vivo via MCP no Blender 5.1.2.

Fonte do modelo: ~/Downloads/hooded fantasy figure 3d model.glb
(214k vértices / 396k polígonos originais — decimado para ~32k antes de
qualquer outra operação, essencial em máquinas com pouca RAM).

A esfera/região do rosto usa `visible_diffuse/glossy/transmission = False`
no objeto inteiro: continua aparecendo brilhante pra câmera, mas não
ilumina fisicamente o resto do capuz (senão o tecido ao redor "estoura"
em cinza por causa do bounce de luz real do Cycles).
"""
import bpy
import bmesh
import math
from mathutils import Vector

GLB_PATH = "/home/teuzothedev/Downloads/hooded fantasy figure 3d model.glb"
RENDER_PATH = "/home/teuzothedev/work/world-light/blender/renders/hooded-sun-figure-realistic.png"

# Região do rosto em coordenadas locais do modelo (bbox original: x=±0.16,
# y=±0.28, z=±0.5). Ajuste estas faixas se o modelo de origem for outro.
FACE_Y_RANGE = (-0.045, 0.045)
FACE_Z_RANGE = (0.27, 0.35)


def clear_scene():
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.lights, bpy.data.cameras, bpy.data.images):
        for item in list(block):
            if item.users == 0:
                block.remove(item)


def import_and_decimate(ratio=0.08):
    bpy.ops.import_scene.gltf(filepath=GLB_PATH)
    obj = bpy.data.objects[0]
    obj.name = "HoodedFigure"

    mod = obj.modifiers.new("Decimate", "DECIMATE")
    mod.ratio = ratio
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=mod.name)

    obj.data.polygons.foreach_set("use_smooth", [True] * len(obj.data.polygons))
    return obj


def make_face_glow(obj, emission_strength=28.0):
    mesh = obj.data
    face_mat = bpy.data.materials.new("FaceGlow")
    face_mat.use_nodes = True
    bsdf = face_mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (1.0, 0.85, 0.5, 1.0)
    bsdf.inputs["Emission Color"].default_value = (1.0, 0.85, 0.5, 1.0)
    bsdf.inputs["Emission Strength"].default_value = emission_strength
    mesh.materials.append(face_mat)
    face_idx = len(mesh.materials) - 1

    bm = bmesh.new()
    bm.from_mesh(mesh)
    bm.faces.ensure_lookup_table()
    for f in bm.faces:
        c = f.calc_center_median()
        if FACE_Y_RANGE[0] <= c.y <= FACE_Y_RANGE[1] and FACE_Z_RANGE[0] <= c.z <= FACE_Z_RANGE[1]:
            f.material_index = face_idx
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()

    # brilha só pra câmera - não ilumina fisicamente o resto do capuz
    obj.visible_diffuse = False
    obj.visible_glossy = False
    obj.visible_transmission = False
    obj.visible_volume_scatter = False


def setup_camera_and_world(distance=1.6, height=0.05):
    cam_data = bpy.data.cameras.new("Camera")
    cam_data.lens = 45
    cam_obj = bpy.data.objects.new("Camera", cam_data)
    bpy.context.collection.objects.link(cam_obj)

    cam_loc = Vector((distance, 0.0, height))
    target = Vector((0.0, 0.0, height))
    cam_obj.location = cam_loc
    cam_obj.rotation_euler = (target - cam_loc).to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.camera = cam_obj

    world = bpy.data.worlds.get("World") or bpy.data.worlds.new("World")
    bpy.context.scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = (0.0, 0.0, 0.0, 1.0)
    bg.inputs["Strength"].default_value = 0.03


def setup_render(filepath, samples=80, glare_strength=0.7):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 900
    scene.render.resolution_y = 1300
    scene.render.film_transparent = True
    scene.render.image_settings.color_mode = "RGBA"
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"

    scene.use_nodes = True
    group = bpy.data.node_groups.get("Compositing") or bpy.data.node_groups.new(
        "Compositing", "CompositorNodeTree"
    )
    group.nodes.clear()
    for item in list(group.interface.items_tree):
        group.interface.remove(item)
    group.interface.new_socket(name="Image", in_out="OUTPUT", socket_type="NodeSocketColor")
    scene.compositing_node_group = group
    tree = group

    rl = tree.nodes.new("CompositorNodeRLayers")
    glare = tree.nodes.new("CompositorNodeGlare")
    glare.inputs["Type"].default_value = "Fog Glow"
    glare.inputs["Quality"].default_value = "High"
    glare.inputs["Highlights Threshold"].default_value = 1.0
    glare.inputs["Strength"].default_value = glare_strength
    out = tree.nodes.new("NodeGroupOutput")
    tree.links.new(rl.outputs["Image"], glare.inputs["Image"])
    tree.links.new(glare.outputs["Image"], out.inputs["Image"])

    scene.render.filepath = filepath
    bpy.ops.render.render(write_still=True)


def main():
    clear_scene()
    obj = import_and_decimate()
    make_face_glow(obj)
    setup_camera_and_world()
    setup_render(RENDER_PATH)


if __name__ == "__main__":
    main()
