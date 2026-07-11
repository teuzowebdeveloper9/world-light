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
import os

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(SCRIPT_DIR)

GLB_SOURCE = os.path.join(SCRIPT_DIR, "sources", "hooded-figure-source.glb")
GLB_OUTPUT = os.path.join(REPO_ROOT, "public", "models", "hooded-figure.glb")
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
        # transform_apply() opera nos objetos SELECIONADOS, não no "ativo" —
        # sem isolar a seleção aqui, só o 1º objeto do loop era realmente
        # aplicado (os outros ficavam com o transform "pendurado", não
        # assado na malha, e a exportação glTF saía com posições erradas).
        bpy.ops.object.select_all(action="DESELECT")
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    print("bbox z apos ajuste:", min_z * scale + z_offset, max_z * scale + z_offset)


WALK_BOB_HEIGHT = 0.05
WALK_SWAY = 0.04
WALK_STRIDE = 0.09
WALK_LIFT = 0.035
WALK_CYCLE_FRAMES = 20
# Capuz/cachecol: tecido solto reagindo com inércia ao movimento do corpo —
# atraso de fase + mais amplitude que o balanço do corpo ("follow-through",
# um dos 12 princípios de animação: a parte solta sempre chega um instante
# depois e ultrapassa um pouco).
HOOD_PHASE_LAG = 0.35  # rad
HOOD_BOB_MULT = 1.3
HOOD_SWAY_MULT = 1.5
HOOD_NOD = 0.05  # rad — leve balanço frente/trás (eixo Y), some no corpo/pés
"""
Sem esqueleto: anima o transform dos objetos (corpo + FootLeft + FootRight +
Hood) diretamente, exportado como translation/rotation dos nós glTF — three.js
toca isso com o AnimationMixer normal, igual animaria um rig.

Eixo frente-trás deste modelo é o X local do Blender (descoberto olhando a
vista "Right Orthographic" no hooded_sun_figure_realistic.py — foi lá que
apareceu de frente); Y é o eixo ombro-a-ombro. Passada: X oscila pra
frente/trás, Z levanta o pé só na metade do ciclo em que ele está "no ar"
(senão arrasta no chão). Pé direito com a MESMA fórmula defasada meia volta
(π) — alternando como uma passada de verdade.

Tudo amostrado nos mesmos 5 pontos de fase (phi = 0, pi/2, pi, 3pi/2, 2pi)
via seno/cosseno de verdade — sem tuplas de sinal copiadas à mão (foi
exatamente um erro de transcrição numa dessas que fez o pé levantar na
fase errada da passada da primeira vez).
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


def add_walk_cycle(body, hood, foot_left, foot_right, fps=30):
    """
    Só a action "Walk" em cada objeto — sem clipe de Idle: fcurves que não
    mudam de valor (0 -> 0) são podadas pelo exportador glTF (detecta que
    não anima nada de verdade e descarta a animação toda). Parado, o
    Player.tsx simplesmente não toca nenhuma action.
    """
    bpy.context.scene.render.fps = fps
    frames, phis = _phase_points(WALK_CYCLE_FRAMES)

    def animate(obj, bob_vals=None, sway_vals=None, nod_vals=None, x_vals=None):
        obj.rotation_mode = "XYZ"  # transform_apply() vira QUATERNION; sem
        # isso a keyframe em rotation_euler fica inerte (não é a rotação ativa).
        obj.animation_data_create()
        action = bpy.data.actions.new("Walk")
        obj.animation_data.action = action
        if x_vals is not None:
            _set_fcurve(action, obj, "location", 0, frames, x_vals)
        if bob_vals is not None:
            _set_fcurve(action, obj, "location", 2, frames, bob_vals)
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

    # --- capuz/cachecol: mesmo movimento do corpo, com atraso e mais amplitude
    # (inércia de tecido solto) + um leve balanço frente/trás próprio.
    hood_phis = [phi + HOOD_PHASE_LAG for phi in phis]
    animate(
        hood,
        bob_vals=[abs(math.sin(phi)) * WALK_BOB_HEIGHT * HOOD_BOB_MULT for phi in hood_phis],
        sway_vals=[math.sin(phi) * WALK_SWAY * HOOD_SWAY_MULT for phi in hood_phis],
        nod_vals=[abs(math.sin(phi)) * HOOD_NOD for phi in hood_phis],
    )

    # --- pés: X = STRIDE*cos(phi) (frente/trás), Z = LIFT*max(0,-phase_sign*sin(phi)).
    # X cresce (perna avançando) exatamente quando -phase_sign*sin(phi) > 0 —
    # só aí o pé pode levantar, senão ele "arrasta" no chão indo pra frente
    # em vez de balançar no ar. phase_sign oposto por pé = alternam a passada.
    for foot, phase_sign in ((foot_left, 1), (foot_right, -1)):
        animate(
            foot,
            x_vals=[phase_sign * WALK_STRIDE * math.cos(phi) for phi in phis],
            bob_vals=[max(0.0, -phase_sign * math.sin(phi)) * WALK_LIFT for phi in phis],
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
    foot_left, foot_right = separate_feet(obj)
    hood = separate_hood(obj)
    all_objects = [obj, hood, foot_left, foot_right]
    make_game_ready(all_objects)
    add_walk_cycle(obj, hood, foot_left, foot_right)
    export_glb(all_objects, GLB_OUTPUT)
    print("EXPORTED_TO", GLB_OUTPUT)


if __name__ == "__main__":
    main()
