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
- pés separados da malha principal em dois objetos (FootLeft/FootRight)
  pra poder animar a passada de verdade (perna avançando), não só o
  corpo balançando — ver add_walk_cycle().

O modelo fonte (gerado via Tripo AI) mora em blender/sources/ — o arquivo
baixado original em ~/Downloads já desapareceu uma vez nesta sessão, então
o pipeline não depende mais dele: a fonte fica versionada no repo.
"""
import bpy
import bmesh
import math

GLB_SOURCE = "/home/teuzothedev/work/world-light/blender/sources/hooded-figure-source.glb"
GLB_OUTPUT = "/home/teuzothedev/work/world-light/public/models/hooded-figure.glb"
TARGET_HEIGHT = 1.45

FACE_Y_RANGE = (-0.045, 0.045)
FACE_Z_RANGE = (0.27, 0.35)

# Região que contém os pés + um pouco da barra rasgada ao redor (calibrado
# olhando blender/renders/debug-feet-region.png, escala-fonte original,
# altura total [-0.5, 0.5]). Não dá pra isolar só a pele sem também pegar
# um pouco do tecido que se sobrepõe na mesma altura, o que é até
# bem-vindo: o pano balança junto com a perna, como um tecido solto de
# verdade. Dividido em X=0 vira pé esquerdo/direito.
FEET_X_RANGE = (-0.2, 0.2)
FEET_Y_RANGE = (-0.10, 0.10)
FEET_Z_RANGE = (-0.5, -0.35)


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


def _extract_faces(bm_source, faces, name, materials):
    """Copia as faces dadas (com UV e material_index) pra um objeto novo."""
    vert_map = {}
    new_bm = bmesh.new()
    src_uv = bm_source.loops.layers.uv.active
    new_uv = new_bm.loops.layers.uv.new(src_uv.name) if src_uv else None

    for f in faces:
        new_verts = []
        for v in f.verts:
            nv = vert_map.get(v.index)
            if nv is None:
                nv = new_bm.verts.new(v.co.copy())
                vert_map[v.index] = nv
            new_verts.append(nv)
        nf = new_bm.faces.new(new_verts)
        nf.material_index = f.material_index
        if new_uv:
            for loop, src_loop in zip(nf.loops, f.loops):
                loop[new_uv].uv = src_loop[src_uv].uv

    new_bm.normal_update()
    mesh = bpy.data.meshes.new(name)
    for mat in materials:
        mesh.materials.append(mat)
    new_bm.to_mesh(mesh)
    new_bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return obj


def separate_feet(obj):
    mesh = obj.data
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bm.faces.ensure_lookup_table()

    def in_box(f):
        c = f.calc_center_median()
        return (
            FEET_X_RANGE[0] <= c.x <= FEET_X_RANGE[1]
            and FEET_Y_RANGE[0] <= c.y <= FEET_Y_RANGE[1]
            and FEET_Z_RANGE[0] <= c.z <= FEET_Z_RANGE[1]
        )

    candidates = [f for f in bm.faces if in_box(f)]
    left = [f for f in candidates if f.calc_center_median().x < 0]
    right = [f for f in candidates if f.calc_center_median().x >= 0]

    materials = list(mesh.materials)
    left_obj = _extract_faces(bm, left, "FootLeft", materials)
    right_obj = _extract_faces(bm, right, "FootRight", materials)

    bmesh.ops.delete(bm, geom=candidates, context="FACES")
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()

    print("pes extraidos: left=", len(left), "right=", len(right), "faces")
    return left_obj, right_obj


def make_game_ready(objects):
    """Pés (o ponto mais baixo entre TODOS os objetos) em Z=0, altura alvo.

    Objetos ainda em location/scale identidade neste ponto — calcular a
    translação ANTES de escalar dava pés fora do lugar (a escala se aplica
    sobre as coordenadas locais antes da translação).
    """
    all_z = [v.co.z for o in objects for v in o.data.vertices]
    min_z, max_z = min(all_z), max(all_z)
    height = max_z - min_z
    scale = TARGET_HEIGHT / height
    z_offset = -scale * min_z

    for o in objects:
        o.scale = (scale, scale, scale)
        o.location = (0.0, 0.0, z_offset)
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    print("bbox z apos ajuste:", min_z * scale + z_offset, max_z * scale + z_offset)


WALK_BOB_HEIGHT = 0.05
WALK_SWAY = 0.04
WALK_STRIDE = 0.09
WALK_LIFT = 0.035
WALK_CYCLE_FRAMES = 20
"""
Sem esqueleto: anima o transform dos 3 objetos (corpo + FootLeft +
FootRight) diretamente, exportado como translation/rotation dos nós glTF —
three.js toca isso com o AnimationMixer normal, igual animaria um rig.

Eixo frente-trás deste modelo é o X local do Blender (descoberto olhando a
vista "Right Orthographic" no hooded_sun_figure_realistic.py — foi lá que
apareceu de frente). Passada: X oscila pra frente/trás, Z levanta o pé só
na metade do ciclo em que ele está "no ar" (senão arrasta no chão). Pé
direito com a MESMA fórmula defasada meia volta (π) — alternando como uma
passada de verdade.
"""


def _set_fcurve(action, obj, data_path, index, frames_values):
    # Blender 4.4+: Actions são "layered" (layers/strips/slots) — fcurves não
    # se criam mais direto via action.fcurves.new(). Este helper cuida de
    # criar layer/strip/slot e associar a action ao objeto sozinho.
    fcurve = action.fcurve_ensure_for_datablock(obj, data_path, index=index)
    for frame, value in frames_values:
        kp = fcurve.keyframe_points.insert(frame, value)
        kp.interpolation = "SINE"
    fcurve.update()
    return fcurve


def _push_action_to_nla(obj, action, clip_name="Walk"):
    # O nome da action no bpy.data.actions é único (Blender sufixa .001,
    # .002...) mas o exportador glTF agrupa por NOME DO TRACK/STRIP — usar
    # sempre "Walk" aqui (em vez de action.name) é o que faz os 3 objetos
    # virarem UM clipe glTF só, com um canal por nó.
    obj.animation_data.action = None
    track = obj.animation_data.nla_tracks.new()
    track.name = clip_name
    track.strips.new(clip_name, 0, action)


def add_walk_cycle(body, foot_left, foot_right, fps=30):
    """
    Só a action "Walk" em cada objeto — sem clipe de Idle: fcurves que não
    mudam de valor (0 -> 0) são podadas pelo exportador glTF (detecta que
    não anima nada de verdade e descarta a animação toda). Parado, o
    Player.tsx simplesmente não toca nenhuma action.
    """
    bpy.context.scene.render.fps = fps
    n = WALK_CYCLE_FRAMES
    quarter = n / 4

    # --- corpo: bob (2 baques/ciclo) + balanço lateral (alterna a cada passo) ---
    body.rotation_mode = "XYZ"  # transform_apply() vira QUATERNION; sem isso
    # a keyframe em rotation_euler fica inerte (não é a rotação ativa).
    body.animation_data_create()
    walk_body = bpy.data.actions.new("Walk")
    body.animation_data.action = walk_body
    bob = [(0, 0.0), (quarter, WALK_BOB_HEIGHT), (2 * quarter, 0.0), (3 * quarter, WALK_BOB_HEIGHT), (n, 0.0)]
    sway = [(0, 0.0), (quarter, WALK_SWAY), (2 * quarter, 0.0), (3 * quarter, -WALK_SWAY), (n, 0.0)]
    _set_fcurve(walk_body, body, "location", 2, bob)
    _set_fcurve(walk_body, body, "rotation_euler", 0, sway)
    _push_action_to_nla(body, walk_body)

    # --- pés: X = STRIDE*cos(phi) (frente/trás), Z = LIFT*max(0,-phase_sign*sin(phi)).
    # X cresce (perna avançando) exatamente quando -phase_sign*sin(phi) > 0 —
    # só aí o pé pode levantar, senão ele "arrasta" no chão indo pra frente
    # em vez de balançar no ar. phase_sign oposto por pé = alternam a passada.
    # amostrado em phi = 0, pi/2, pi, 3pi/2, 2pi (mesmos 5 frames de cima).
    def stride_frames(phase_sign):
        cos_samples = (1, 0, -1, 0, 1)
        sin_samples = (0, 1, 0, -1, 0)
        xs = [phase_sign * WALK_STRIDE * v for v in cos_samples]
        zs = [max(0.0, -phase_sign * v) * WALK_LIFT for v in sin_samples]
        frames_x = list(zip((0, quarter, 2 * quarter, 3 * quarter, n), xs))
        frames_z = list(zip((0, quarter, 2 * quarter, 3 * quarter, n), zs))
        return frames_x, frames_z

    for foot, phase_sign in ((foot_left, 1), (foot_right, -1)):
        foot.animation_data_create()
        walk_foot = bpy.data.actions.new("Walk")
        foot.animation_data.action = walk_foot
        fx, fz = stride_frames(phase_sign)
        _set_fcurve(walk_foot, foot, "location", 0, fx)
        _set_fcurve(walk_foot, foot, "location", 2, fz)
        _push_action_to_nla(foot, walk_foot)

    print("acoes criadas:", [a.name for a in bpy.data.actions])


def export_glb(objects, filepath):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objects:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.export_scene.gltf(
        filepath=filepath,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_animation_mode="NLA_TRACKS",
        export_nla_strips=False,
    )


def main():
    clear_scene()
    obj = import_and_decimate()
    make_face_glow(obj)
    foot_left, foot_right = separate_feet(obj)
    make_game_ready([obj, foot_left, foot_right])
    add_walk_cycle(obj, foot_left, foot_right)
    export_glb([obj, foot_left, foot_right], GLB_OUTPUT)
    print("EXPORTED_TO", GLB_OUTPUT)


if __name__ == "__main__":
    main()
