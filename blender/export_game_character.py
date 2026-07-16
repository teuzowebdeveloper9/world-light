"""
Prepara o HoodedFigure (ver hooded_sun_figure_realistic.py) para uso como
personagem jogável no world-light e exporta pra public/models/.

Roda 100% headless (sem addon MCP, sem GUI):
  blender --background --python blender/export_game_character.py

Ajustes de game-ready feitos aqui (além do rosto-sol):
- base no eixo local Y=0 (three.js é Y-up; o exportador glTF do Blender já
  converte Z-up -> Y-up sozinho) — o Player.tsx do jogo posiciona o modelo
  assumindo "pés na origem", igual ao KayKit original. Sem pés de verdade
  aqui: é só a capa fechada até o chão, sem espaço embaixo.
- altura final ~1.45 unidades, perto da cápsula de colisão do jogo
  (CAPSULE_HALF=0.45 + CAPSULE_RADIUS=0.3, altura total 1.5).

O modelo fonte (gerado via Tripo AI) mora em blender/sources/ — o arquivo
baixado original em ~/Downloads já desapareceu uma vez nesta sessão, então
o pipeline não depende mais dele: a fonte fica versionada no repo.
"""
import bpy
import bmesh
import math
import os

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(SCRIPT_DIR)

GLB_SOURCE = os.path.join(SCRIPT_DIR, "sources", "hooded-figure-source.glb")
GLB_OUTPUT = os.path.join(REPO_ROOT, "public", "models", "hooded-figure.glb")
TARGET_HEIGHT = 1.45

FACE_Y_RANGE = (-0.045, 0.045)
FACE_Z_RANGE = (0.27, 0.35)

# Capuz + cachecol/gola que sai dele (calibrado olhando
# blender/renders/debug-hood-region.png, escala-fonte original) — tudo
# acima desta altura balança junto como uma peça só.
HOOD_Z_MIN = 0.15


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


def separate_hood(obj):
    mesh = obj.data
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bm.faces.ensure_lookup_table()

    candidates = [f for f in bm.faces if f.calc_center_median().z >= HOOD_Z_MIN]

    materials = list(mesh.materials)
    hood_obj = _extract_faces(bm, candidates, "Hood", materials)

    bmesh.ops.delete(bm, geom=candidates, context="FACES")
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()

    print("capuz extraido:", len(candidates), "faces")
    return hood_obj


"""
Player.tsx gira o modelo com `visual.rotation.y = facing`, onde
`facing = atan2(vx, vz)` — isso vale 0 quando o player anda em +Z, ou seja,
o jogo assume que o modelo "parado" (rotation.y=0) já olha pra +Z. Mas a
frente deste modelo é o eixo X do Blender (ver nota em WALK_BOB_HEIGHT
abaixo), que o exportador glTF mantém como X (a conversão Z-up -> Y-up só
mexe em Y/Z, não em X). Sem essa rotação, o boneco anda sempre 90° errado
— "de lado" em vez de de frente pro movimento. Gira em torno do próprio Z
do Blender (o eixo vertical, que vira o Y do three.js) pra alinhar X -> Z.
"""
FORWARD_ROTATION_Z = -math.pi / 2


def make_game_ready(objects):
    """Pés (o ponto mais baixo entre TODOS os objetos) em Z=0, altura alvo,
    e girado pra alinhar a frente do modelo com a frente que o jogo espera.

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
        o.rotation_euler = (0.0, 0.0, FORWARD_ROTATION_Z)
        # transform_apply() opera nos objetos SELECIONADOS, não no "ativo" —
        # sem isolar a seleção aqui, só o 1º objeto do loop era realmente
        # aplicado (os outros ficavam com o transform "pendurado", não
        # assado na malha, e a exportação glTF saía com posições erradas).
        bpy.ops.object.select_all(action="DESELECT")
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    print("bbox z apos ajuste:", min_z * scale + z_offset, max_z * scale + z_offset)


def set_origin_to_z(obj, z):
    """
    Move o pivô do objeto pra um Z específico (mundo), sem mexer na malha
    visualmente. Sem isso, toda rotação do capuz gira em torno da origem do
    personagem lá embaixo (pés) — um ângulo pequeno vira um arco enorme na
    altura do capuz (~1m acima), abrindo um espaço visível entre capuz e
    corpo. Girar em torno do pescoço (o próprio ponto de encontro com o
    corpo) mantém a costura fechada não importa o ângulo.
    """
    cursor = bpy.context.scene.cursor
    saved = cursor.location.copy()
    cursor.location = (0.0, 0.0, z)
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
    cursor.location = saved


WALK_BOB_HEIGHT = 0.05
WALK_SWAY = 0.04
WALK_CYCLE_FRAMES = 20
# Capuz/cachecol: tecido solto reagindo com inércia ao movimento do corpo —
# atraso de fase + mais amplitude de ROTAÇÃO que o balanço do corpo
# ("follow-through", um dos 12 princípios de animação). O BOB vertical é o
# MESMO do corpo (sem multiplicador) — translação não se importa com pivô,
# então qualquer diferença aqui abriria uma folga vertical entre capuz e
# corpo; só a rotação usa o pivô no pescoço (set_origin_to_z) pra poder
# exagerar sem descolar a costura.
HOOD_PHASE_LAG = 0.35  # rad
HOOD_SWAY_MULT = 1.5
HOOD_NOD = 0.05  # rad — leve balanço frente/trás (eixo Y), some no corpo
"""
Sem esqueleto e sem pés (só a capa fechada até o chão): anima o transform
dos objetos (corpo + Hood) diretamente, exportado como translation/rotation
dos nós glTF — three.js toca isso com o AnimationMixer normal, igual
animaria um rig.

Tudo amostrado nos mesmos 5 pontos de fase (phi = 0, pi/2, pi, 3pi/2, 2pi)
via seno/cosseno de verdade — sem tuplas de sinal copiadas à mão (foi
exatamente um erro de transcrição numa dessas que fez o pé levantar na
fase errada da passada quando ainda existiam pés animados).
"""


def _phase_points(n):
    quarter = n / 4
    frames = (0, quarter, 2 * quarter, 3 * quarter, n)
    phis = [k * math.pi / 2 for k in range(5)]
    return frames, phis


def _set_fcurve(action, obj, data_path, index, frames, values):
    # Blender 4.4+: Actions são "layered" (layers/strips/slots) — fcurves não
    # se criam mais direto via action.fcurves.new(). Este helper cuida de
    # criar layer/strip/slot e associar a action ao objeto sozinho.
    fcurve = action.fcurve_ensure_for_datablock(obj, data_path, index=index)
    for frame, value in zip(frames, values):
        kp = fcurve.keyframe_points.insert(frame, value)
        kp.interpolation = "SINE"
    fcurve.update()
    return fcurve


def _push_action_to_nla(obj, action, clip_name="Walk"):
    # O nome da action no bpy.data.actions é único (Blender sufixa .001,
    # .002...) mas o exportador glTF agrupa por NOME DO TRACK/STRIP — usar
    # sempre "Walk" aqui (em vez de action.name) é o que faz os objetos
    # virarem UM clipe glTF só, com um canal por nó.
    obj.animation_data.action = None
    track = obj.animation_data.nla_tracks.new()
    track.name = clip_name
    track.strips.new(clip_name, 0, action)


def add_walk_cycle(body, hood, fps=30):
    """
    Só a action "Walk" em cada objeto — sem clipe de Idle: fcurves que não
    mudam de valor (0 -> 0) são podadas pelo exportador glTF (detecta que
    não anima nada de verdade e descarta a animação toda). Parado, o
    Player.tsx simplesmente não toca nenhuma action.
    """
    bpy.context.scene.render.fps = fps
    frames, phis = _phase_points(WALK_CYCLE_FRAMES)

    def animate(obj, bob_vals=None, sway_vals=None, nod_vals=None):
        obj.rotation_mode = "XYZ"  # transform_apply() vira QUATERNION; sem
        # isso a keyframe em rotation_euler fica inerte (não é a rotação ativa).
        obj.animation_data_create()
        action = bpy.data.actions.new("Walk")
        obj.animation_data.action = action
        # base_z != 0 pro Hood (set_origin_to_z moveu o pivô pro pescoço) —
        # a keyframe em "location" grava o valor ABSOLUTO, não um delta, então
        # sem somar a base ele "teletransportaria" o capuz pro chão.
        base_z = obj.location.z
        if bob_vals is not None:
            _set_fcurve(action, obj, "location", 2, frames, [base_z + v for v in bob_vals])
        if sway_vals is not None:
            _set_fcurve(action, obj, "rotation_euler", 0, frames, sway_vals)
        if nod_vals is not None:
            _set_fcurve(action, obj, "rotation_euler", 1, frames, nod_vals)
        _push_action_to_nla(obj, action)

    # --- corpo: bob (2 baques/ciclo) + balanço lateral (alterna a cada passo) ---
    animate(
        body,
        bob_vals=[abs(math.sin(phi)) * WALK_BOB_HEIGHT for phi in phis],
        sway_vals=[math.sin(phi) * WALK_SWAY for phi in phis],
    )

    # --- capuz/cachecol: MESMO bob do corpo (fecha a costura), rotação com
    # atraso e mais amplitude (inércia de tecido solto, gira em torno do
    # pescoço graças ao set_origin_to_z) + um leve balanço frente/trás próprio.
    hood_phis = [phi + HOOD_PHASE_LAG for phi in phis]
    animate(
        hood,
        bob_vals=[abs(math.sin(phi)) * WALK_BOB_HEIGHT for phi in phis],
        sway_vals=[math.sin(phi) * WALK_SWAY * HOOD_SWAY_MULT for phi in hood_phis],
        nod_vals=[abs(math.sin(phi)) * HOOD_NOD for phi in hood_phis],
    )

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
    hood = separate_hood(obj)
    all_objects = [obj, hood]
    make_game_ready(all_objects)

    hood_seam_z = min(v.co.z for v in hood.data.vertices)
    set_origin_to_z(hood, hood_seam_z)
    print("hood pivo em z=", hood_seam_z)

    add_walk_cycle(obj, hood)
    export_glb(all_objects, GLB_OUTPUT)
    print("EXPORTED_TO", GLB_OUTPUT)


if __name__ == "__main__":
    main()
