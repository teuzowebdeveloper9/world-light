"""
Prepara o HoodedFigure (ver hooded_sun_figure_realistic.py) para uso como
personagem jogável no world-light e exporta pra public/models/.

Roda 100% headless (sem addon MCP, sem GUI):
  blender --background --python blender/export_game_character.py

Ajustes de game-ready feitos aqui (além do rosto-sol):
- pés no eixo local Y=0 (three.js é Y-up; o exportador glTF do Blender já
  converte Z-up -> Y-up sozinho) — o Player.tsx do jogo posiciona o modelo
  assumindo "pés na origem", igual ao KayKit original.
- altura final ~1.45 unidades, perto da cápsula de colisão do jogo
  (CAPSULE_HALF=0.45 + CAPSULE_RADIUS=0.3, altura total 1.5).
"""
import bpy
import bmesh
import math

GLB_SOURCE = "/home/teuzothedev/Downloads/hooded fantasy figure 3d model.glb"
GLB_OUTPUT = "/home/teuzothedev/work/world-light/public/models/hooded-figure.glb"
TARGET_HEIGHT = 1.45

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
    bpy.ops.import_scene.gltf(filepath=GLB_SOURCE)
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


def make_game_ready(obj):
    """Pés no Y=0 local (Blender Z=0), altura alvo, transform aplicado.

    obj.location/scale ainda estão em identidade neste ponto, então os
    vértices locais == coordenadas de mundo — calcular a translação
    ANTES de escalar dava pés fora do lugar (a escala se aplica sobre as
    coordenadas locais antes da translação, então a translação pré-escala
    ficava "errada" por um fator de `scale`).
    """
    zs = [v.co.z for v in obj.data.vertices]
    min_z, max_z = min(zs), max(zs)
    height = max_z - min_z

    scale = TARGET_HEIGHT / height
    obj.scale = (scale, scale, scale)
    obj.location = (0.0, 0.0, -scale * min_z)  # pés (ponto mais baixo) em z=0

    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    zs2 = [v.co.z for v in obj.data.vertices]
    print("bbox z apos ajuste:", min(zs2), max(zs2))


def export_glb(obj, filepath):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.export_scene.gltf(
        filepath=filepath,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
    )


def main():
    clear_scene()
    obj = import_and_decimate()
    make_face_glow(obj)
    make_game_ready(obj)
    export_glb(obj, GLB_OUTPUT)
    print("EXPORTED_TO", GLB_OUTPUT)


if __name__ == "__main__":
    main()
