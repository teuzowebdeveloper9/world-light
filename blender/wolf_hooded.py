"""
O LOBO ENCAPUZADO — caçador que persegue o jogador no world-light.

100% procedural (primitivas bpy/bmesh + modificadores), sem malha externa.
Visto quase sempre de longe e à noite: o design carrega na SILHUETA
(corcunda de caçador, capa esfarrapada, cauda fluida) e nos OLHOS emissivos
laranja-brasa que precisam ler a 70m no escuro.

Roda 100% headless:
  blender --background --python blender/wolf_hooded.py            # debug renders
  blender --background --python blender/wolf_hooded.py -- beauty  # render final 64 samples

Convenções herdadas de export_game_character.py (lições aprendidas lá):
- pés em Z=0, altura alvo, transform_apply com seleção ISOLADA por objeto;
- FRENTE do personagem apontando pra -Y do Blender (o conversor Z-up -> Y-up
  do glTF faz -Y virar +Z, e o Player.tsx assume rotation.y=0 olhando +Z).
  Aqui a geometria já NASCE com o focinho em -Y, então FORWARD_ROTATION_Z=0;
- animação sem rig: poucos objetos (Body/Cloak/Tail), cada um com uma action
  própria empurrada pra NLA com o MESMO nome de clipe ("Run");
- fcurves constantes são podadas pelo exportador — nenhum canal 0->0.
"""
import bpy
import bmesh
import math
import os
import sys
from mathutils import Vector, noise

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(SCRIPT_DIR)

GLB_OUTPUT = os.path.join(REPO_ROOT, "public", "models", "wolf-hooded.glb")
RENDER_DIR = os.path.join(SCRIPT_DIR, "renders")
TARGET_HEIGHT = 1.55


# ---------------------------------------------------------------- cena/materiais

def clear_scene():
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.lights, bpy.data.cameras, bpy.data.images, bpy.data.curves, bpy.data.textures):
        for item in list(block):
            if item.users == 0:
                block.remove(item)


def _hex_linear(h):
    """#RRGGBB (sRGB) -> tupla linear que o Principled/glTF esperam.
    Setar o hex direto no Base Color escurece/clareia errado no jogo."""
    def chan(c):
        c = int(c, 16) / 255.0
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (chan(h[1:3]), chan(h[3:5]), chan(h[5:7]), 1.0)


def make_material(name, hex_color, roughness=0.9, emission_hex=None, emission_strength=0.0):
    # Só cores CHAPADAS + emission: o exportador glTF não exporta nós de
    # textura procedural, então todo o "detalhe" fica na geometria (displace).
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = _hex_linear(hex_color)
    bsdf.inputs["Roughness"].default_value = roughness
    if emission_hex:
        bsdf.inputs["Emission Color"].default_value = _hex_linear(emission_hex)
        bsdf.inputs["Emission Strength"].default_value = emission_strength
    return mat


MATS = {}


def build_materials():
    MATS["fur"] = make_material("WolfFur", "#101014", roughness=0.9)
    MATS["muzzle"] = make_material("WolfMuzzle", "#0c0c11", roughness=0.9)
    MATS["cloak"] = make_material("WolfCloak", "#1b1626", roughness=0.95)
    # brasa: precisa furar a noite a 70m — strength 20
    MATS["eye"] = make_material("WolfEye", "#ff7d1e", roughness=0.4,
                                emission_hex="#ff5a0a", emission_strength=20.0)
    MATS["bone"] = make_material("WolfBone", "#ddd2bd", roughness=0.55)
    MATS["mouth"] = make_material("WolfMouth", "#4a0f0f", roughness=0.8)
    MATS["nose"] = make_material("WolfNose", "#060608", roughness=0.35)


# ---------------------------------------------------------------- builders

def _assign(obj, mat_key):
    obj.data.materials.append(MATS[mat_key])


def add_blob(name, loc, scale, mat="fur", seg=32, rings=20):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=rings, radius=1.0, location=loc)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    _assign(obj, mat)
    return obj


def add_cone_between(name, p1, p2, r1, r2, mat="fur", verts=20):
    """Cone/cilindro cônico entre dois pontos — membro sem rig. O eixo do
    primitivo é +Z (radius2 na ponta de cima); to_track_quat('Z','Y') alinha
    esse +Z com a direção p1->p2, então r2 é sempre o raio do lado de p2."""
    p1, p2 = Vector(p1), Vector(p2)
    d = p2 - p1
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r1, radius2=r2,
                                    depth=d.length, end_fill_type="NGON",
                                    location=(p1 + p2) / 2)
    obj = bpy.context.object
    obj.name = name
    obj.rotation_euler = d.to_track_quat("Z", "Y").to_euler()
    _assign(obj, mat)
    return obj


def add_subsurf(obj, levels):
    mod = obj.modifiers.new("Subsurf", "SUBSURF")
    mod.levels = levels
    mod.render_levels = levels


_FUR_TEX = None


def add_fur(obj, strength=0.012, size=0.08):
    """Sugestão de pelagem: DISPLACE com textura CLOUDS (procedural do
    Blender). O displace é APLICADO na malha antes do export — textura
    procedural não sai no glTF, mas o relevo assado sai."""
    global _FUR_TEX
    if _FUR_TEX is None:
        _FUR_TEX = bpy.data.textures.new("FurClouds", type="CLOUDS")
        _FUR_TEX.noise_scale = size
    mod = obj.modifiers.new("Fur", "DISPLACE")
    mod.texture = _FUR_TEX
    mod.strength = strength
    mod.mid_level = 0.5


def finalize_part(obj):
    """transform_apply + modifier_apply com seleção ISOLADA (mesma lição do
    make_game_ready do repo: sem isolar, só o 1º objeto é aplicado). Aplicar
    o transform ANTES dos modificadores deixa o displace em coordenadas de
    mundo — o padrão de ruído fica contínuo entre as partes vizinhas."""
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for mod in list(obj.modifiers):
        bpy.ops.object.modifier_apply(modifier=mod.name)


def join_parts(parts, name):
    bpy.ops.object.select_all(action="DESELECT")
    for o in parts:
        o.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    obj = parts[0]
    obj.name = name
    obj.data.polygons.foreach_set("use_smooth", [True] * len(obj.data.polygons))
    return obj


# ---------------------------------------------------------------- corpo

def build_hood():
    """Capuz fundo: esfera esticada em Y, frente removida (abertura em -Y),
    borda irregular, SOLIDIFY pra dentro (não engorda a silhueta)."""
    bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=20, radius=0.225, location=(0, -0.26, 1.28))
    obj = bpy.context.object
    obj.name = "HoodPart"
    _assign(obj, "cloak")
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    for v in bm.verts:
        v.co.y *= 1.15
    front = [v for v in bm.verts if v.co.y < -0.15]
    bmesh.ops.delete(bm, geom=front, context="VERTS")
    # borda rasgadinha do capuz (bem sutil, o rasgo forte fica na capa)
    for v in bm.verts:
        if any(e.is_boundary for e in v.link_edges):
            n = noise.noise(Vector((v.co.x * 9.0, v.co.z * 9.0, 0.31)))
            v.co.y -= max(0.0, n) * 0.035
    bm.to_mesh(obj.data)
    bm.free()
    # inclina o aro pra baixo na frente — sobrancelha do capuz sombreando os olhos
    obj.rotation_euler = (0.12, 0.0, 0.0)
    mod = obj.modifiers.new("Shell", "SOLIDIFY")
    mod.thickness = 0.02
    mod.offset = -1.0
    add_subsurf(obj, 1)
    add_fur(obj, strength=0.006)
    return obj


def build_body():
    """Tudo que não precisa de movimento secundário próprio vira UM objeto —
    parte separada sem action ficaria flutuando parada enquanto o corpo boba."""
    parts = []

    # --- torso corcunda: blobs sobrepostos, silhueta de caçador curvado ---
    for name, loc, scale in (
        ("Hips", (0, 0.04, 0.82), (0.20, 0.235, 0.21)),
        ("Belly", (0, -0.02, 0.95), (0.225, 0.27, 0.24)),
        ("Chest", (0, -0.09, 1.08), (0.245, 0.28, 0.24)),
        ("Hump", (0, -0.04, 1.20), (0.27, 0.23, 0.16)),
    ):
        o = add_blob(name, loc, scale)
        add_subsurf(o, 1)
        add_fur(o)
        parts.append(o)

    # pescoço adiantado — cabeça baixa, à frente do peito — e um "ruff" de
    # pelo no peito que fecha o vão embaixo do queixo visto de perfil
    neck = add_cone_between("Neck", (0, -0.12, 1.22), (0, -0.30, 1.20), 0.105, 0.085)
    add_subsurf(neck, 1)
    add_fur(neck)
    parts.append(neck)
    ruff = add_blob("Ruff", (0, -0.21, 1.10), (0.105, 0.135, 0.125), seg=24, rings=14)
    add_subsurf(ruff, 1)
    add_fur(ruff)
    parts.append(ruff)

    # --- cabeça de lobo (frente = -Y) ---
    head = add_blob("Head", (0, -0.30, 1.20), (0.135, 0.15, 0.13))
    add_subsurf(head, 1)
    add_fur(head, strength=0.008)
    parts.append(head)
    # bochechas/juba lateral — sem elas a cabeça lia como rato, não lobo
    for sx in (-1, 1):
        cheek = add_blob("Cheek", (sx * 0.082, -0.375, 1.165), (0.052, 0.075, 0.06), seg=20, rings=12)
        add_subsurf(cheek, 1)
        add_fur(cheek, strength=0.008)
        parts.append(cheek)

    muzzle = add_cone_between("Muzzle", (0, -0.40, 1.185), (0, -0.645, 1.125), 0.086, 0.048, mat="muzzle")
    add_subsurf(muzzle, 1)
    parts.append(muzzle)

    nose = add_blob("Nose", (0, -0.655, 1.132), (0.036, 0.032, 0.028), mat="nose", seg=16, rings=10)
    parts.append(nose)

    # mandíbula entreaberta + interior escuro-sangue
    jaw = add_cone_between("Jaw", (0, -0.39, 1.13), (0, -0.605, 1.035), 0.06, 0.03, mat="muzzle")
    add_subsurf(jaw, 1)
    parts.append(jaw)
    mouth = add_blob("Mouth", (0, -0.50, 1.075), (0.048, 0.10, 0.035), mat="mouth", seg=16, rings=10)
    parts.append(mouth)

    # dentes: cones claros SEM emissão, sem subsurf (têm que ficar pontudos)
    for sx in (-1, 1):
        for (dx, dy, dz, depth, rad) in (
            (0.036, -0.585, 1.075, 0.055, 0.012),   # canino superior
            (0.043, -0.525, 1.082, 0.038, 0.009),
            (0.047, -0.470, 1.088, 0.032, 0.008),
            (0.028, -0.545, 1.028, 0.042, 0.010),   # canino inferior (aponta pra cima)
        ):
            up = dz < 1.05
            bpy.ops.mesh.primitive_cone_add(vertices=10, radius1=rad, radius2=0.0015,
                                            depth=depth, end_fill_type="NGON",
                                            location=(sx * dx, dy, dz),
                                            rotation=(0.0 if up else math.pi, 0, 0))
            t = bpy.context.object
            t.name = "Tooth"
            _assign(t, "bone")
            parts.append(t)

    # orelhas dobradas pra trás, escondidas sob o capuz (só sugerem volume)
    for sx in (-1, 1):
        bpy.ops.mesh.primitive_cone_add(vertices=12, radius1=0.04, radius2=0.006, depth=0.13,
                                        end_fill_type="NGON",
                                        location=(sx * 0.075, -0.24, 1.335),
                                        rotation=(-0.55, 0, sx * -0.3))
        ear = bpy.context.object
        ear.name = "Ear"
        ear.scale = (1.0, 0.45, 1.0)
        _assign(ear, "fur")
        parts.append(ear)

    # --- olhos brasa, fundos no capuz ---
    for sx in (-1, 1):
        eye = add_blob("Eye", (sx * 0.056, -0.425, 1.225), (0.034, 0.034, 0.034), mat="eye", seg=16, rings=10)
        parts.append(eye)

    parts.append(build_hood())

    # --- braços adiantados, garras à mostra na frente do corpo. Esferas nas
    # juntas (ombro/cotovelo): sem elas os cones liam como contas soltas ---
    for sx in (-1, 1):
        up = add_cone_between("ArmUpper", (sx * 0.20, -0.10, 1.16), (sx * 0.235, -0.16, 0.85), 0.068, 0.05)
        lo = add_cone_between("ArmLower", (sx * 0.235, -0.16, 0.85), (sx * 0.165, -0.32, 0.63), 0.05, 0.035)
        for o in (up, lo):
            add_subsurf(o, 1)
            add_fur(o)
            parts.append(o)
        for name, loc, s in (
            ("Shoulder", (sx * 0.20, -0.10, 1.15), 0.075),
            ("Elbow", (sx * 0.235, -0.16, 0.85), 0.052),
        ):
            j = add_blob(name, loc, (s, s, s), seg=20, rings=12)
            add_subsurf(j, 1)
            add_fur(j)
            parts.append(j)
        hand = add_blob("Hand", (sx * 0.16, -0.35, 0.60), (0.048, 0.062, 0.046), seg=20, rings=12)
        parts.append(hand)
        for dx in (-0.026, 0.0, 0.026):
            p1 = Vector((sx * 0.16 + dx, -0.375, 0.585))
            p2 = p1 + Vector((dx * 0.35, -0.048, -0.055))
            claw = add_cone_between("Claw", p1, p2, 0.011, 0.002, mat="bone", verts=10)
            parts.append(claw)

    # --- pernas digitígradas (a capa cobre a maior parte — só a sugestão) ---
    for sx in (-1, 1):
        thigh = add_cone_between("Thigh", (sx * 0.11, 0.04, 0.80), (sx * 0.125, -0.09, 0.46), 0.09, 0.055)
        shin = add_cone_between("Shin", (sx * 0.125, -0.09, 0.46), (sx * 0.115, 0.09, 0.20), 0.058, 0.038)
        foot = add_cone_between("Foot", (sx * 0.115, 0.09, 0.20), (sx * 0.11, -0.05, 0.05), 0.04, 0.034)
        for o in (thigh, shin, foot):
            add_subsurf(o, 1)
            add_fur(o, strength=0.008)
            parts.append(o)
        for name, loc, s in (
            ("Knee", (sx * 0.125, -0.09, 0.46), 0.058),
            ("Hock", (sx * 0.115, 0.09, 0.20), 0.042),
        ):
            j = add_blob(name, loc, (s, s, s), seg=20, rings=12)
            add_subsurf(j, 1)
            add_fur(j, strength=0.008)
            parts.append(j)
        toe = add_blob("Toe", (sx * 0.108, -0.06, 0.047), (0.052, 0.088, 0.042), seg=20, rings=12)
        parts.append(toe)

    for o in parts:
        finalize_part(o)
    return join_parts(parts, "Body")


# ---------------------------------------------------------------- capa

def _lerp(a, b, t):
    return a + (b - a) * t


def build_cloak():
    """Capa em casca aberta na frente (arco de ~285°): anéis loftados com
    dobras verticais procedurais e barra de baixo RASGADA por ruído — a
    borda irregular é o que vende "esfarrapada" na silhueta de longe.

    O raio cresce com t**0.45 a partir de um topo ESTREITO enfiado dentro da
    corcunda: a 1ª versão (tubo de raio constante começando atrás do capuz)
    lia como uma "mochila" chapada flutuando nas costas — o pano precisa
    nascer por baixo do capuz e se abrir por cima dos ombros."""
    n_seg = 48
    n_rings = 14
    # abertura centrada em -Y (frente), estreita: as garras aparecem na borda
    # mas as pernas ficam quase todas em mistério embaixo do pano
    gap_half = 0.52
    th0 = -math.pi / 2 + gap_half
    th1 = -math.pi / 2 + 2 * math.pi - gap_half

    bm = bmesh.new()
    prev = None
    for j in range(n_rings):
        t = j / (n_rings - 1)
        ring = []
        for i in range(n_seg + 1):
            th = _lerp(th0, th1, i / n_seg)
            # anel do topo ENTERRADO dentro da corcunda (z=1.30, r=0.16 < seção
            # da corcunda ali) — a borda aberta do lofting nunca aparece
            r = 0.16 + (0.42 - 0.16) * (t ** 0.45)
            # dobras de pano verticais que crescem pra baixo
            r += 0.022 * t * math.sin(th * 9.0 + 1.3)
            cy = _lerp(-0.04, 0.10, t)  # o pano escorre pra trás do corpo curvado
            z_bottom = 0.24 - 0.07 * math.sin(th)  # costas mais longas que a frente
            z = _lerp(1.30, z_bottom, t)
            if j >= n_rings - 2:
                # barra esfarrapada: rasgos puxados PARA CIMA por 2 oitavas de ruído
                n1 = noise.noise(Vector((math.cos(th) * 3.1, math.sin(th) * 3.1, 0.7)))
                n2 = noise.noise(Vector((math.cos(th) * 11.0, math.sin(th) * 11.0, 4.2)))
                rag = ((n1 * 0.5 + 0.5) ** 1.5) * 0.17 + max(0.0, n2) * 0.05
                z += rag if j == n_rings - 1 else rag * 0.35
            ring.append(bm.verts.new((r * math.cos(th), cy + r * math.sin(th), z)))
        if prev is not None:
            for i in range(n_seg):
                bm.faces.new((prev[i], prev[i + 1], ring[i + 1], ring[i]))
        prev = ring

    # painel interno na abertura da frente: 2ª camada de pano rasgado que
    # esconde coxas/joelhos (a capa cobre a maior parte — mistério), com o
    # topo ENTERRADO na barriga pra borda de cima nunca aparecer; as mãos
    # ficam num raio maior, então as garras continuam na frente dele
    m_seg = 12
    m_rings = 7
    prev = None
    for j in range(m_rings):
        t = j / (m_rings - 1)
        ring = []
        for i in range(m_seg + 1):
            th = _lerp(-math.pi / 2 - 0.62, -math.pi / 2 + 0.62, i / m_seg)
            r = _lerp(0.27, 0.34, t) + 0.014 * t * math.sin(th * 7.0 + 0.5)
            cy = _lerp(-0.01, 0.07, t)
            z = _lerp(1.03, 0.33, t)
            if j >= m_rings - 2:
                n1 = noise.noise(Vector((math.cos(th) * 3.1, math.sin(th) * 3.1, 9.4)))
                n2 = noise.noise(Vector((math.cos(th) * 11.0, math.sin(th) * 11.0, 13.6)))
                rag = ((n1 * 0.5 + 0.5) ** 1.5) * 0.15 + max(0.0, n2) * 0.05
                z += rag if j == m_rings - 1 else rag * 0.35
            ring.append(bm.verts.new((r * math.cos(th), cy + r * math.sin(th), z)))
        if prev is not None:
            for i in range(m_seg):
                bm.faces.new((prev[i], prev[i + 1], ring[i + 1], ring[i]))
        prev = ring
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)

    mesh = bpy.data.meshes.new("Cloak")
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new("Cloak", mesh)
    bpy.context.collection.objects.link(obj)
    _assign(obj, "cloak")
    mod = obj.modifiers.new("Shell", "SOLIDIFY")
    mod.thickness = 0.012
    add_subsurf(obj, 2)
    add_fur(obj, strength=0.006, size=0.15)
    finalize_part(obj)
    obj.data.polygons.foreach_set("use_smooth", [True] * len(obj.data.polygons))
    return obj


# ---------------------------------------------------------------- cauda

def build_tail():
    """Cauda fluida por curva NURBS com bevel + raio por ponto (taper).
    Sai por baixo da capa e flui pra trás com uma leve curvatura pra cima."""
    cu = bpy.data.curves.new("Tail", "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = 1.0
    cu.bevel_resolution = 4
    cu.resolution_u = 16
    cu.use_fill_caps = True
    sp = cu.splines.new("NURBS")
    pts = (
        ((0, 0.20, 0.70), 0.07),
        ((0, 0.42, 0.55), 0.056),
        ((0, 0.62, 0.45), 0.044),
        ((0, 0.80, 0.42), 0.034),
        ((0, 0.97, 0.47), 0.020),
        ((0, 1.08, 0.56), 0.006),
    )
    sp.points.add(len(pts) - 1)
    for pt, (co, rad) in zip(sp.points, pts):
        pt.co = (*co, 1.0)
        pt.radius = rad
    sp.use_endpoint_u = True

    obj = bpy.data.objects.new("Tail", cu)
    bpy.context.collection.objects.link(obj)
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.convert(target="MESH")
    obj = bpy.context.object
    obj.name = "Tail"
    _assign(obj, "fur")
    add_subsurf(obj, 1)
    add_fur(obj, strength=0.01)
    finalize_part(obj)
    obj.data.polygons.foreach_set("use_smooth", [True] * len(obj.data.polygons))
    return obj


# ---------------------------------------------------------------- game-ready

"""
Player/caçador no jogo assume rotation.y=0 olhando +Z do three.js, que é o
-Y do Blender depois da conversão Z-up -> Y-up do glTF. A geometria daqui já
nasce com o focinho em -Y, então não precisa da rotação de -90° que o
hooded-figure precisava (a frente daquele modelo era +X). Provado com o
render top-down wolf-hooded-orientation.png (cubo marcador em (0,-2,0.2)).
"""
FORWARD_ROTATION_Z = 0.0


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
    return scale, z_offset


def set_origin_to_point(obj, point):
    """
    Move o pivô do objeto pra um ponto específico (mundo), sem mexer na malha
    visualmente. Sem isso, toda rotação da parte gira em torno da origem do
    personagem lá embaixo (pés) — um ângulo pequeno vira um arco enorme na
    altura da costura, abrindo um vão visível entre a parte e o corpo. Girar
    em torno da própria emenda mantém a costura fechada não importa o ângulo.
    (Generaliza o set_origin_to_z do repo: a base da cauda tem Y != 0.)
    """
    cursor = bpy.context.scene.cursor
    saved = cursor.location.copy()
    cursor.location = point
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
    cursor.location = saved


def set_origin_to_z(obj, z):
    set_origin_to_point(obj, (0.0, 0.0, z))


# ---------------------------------------------------------------- animação

RUN_CYCLE_FRAMES = 20  # @30fps — lope rápido, faminto
RUN_BOB = 0.07          # bob vertical forte, 2 batidas/ciclo
RUN_PITCH = math.radians(5)  # investida: pica o focinho pra baixo no contato
RUN_ROLL = 0.05         # balanço lateral (1 alternância/ciclo)
# Capa/cauda: "follow-through" — atraso de fase + amplitude exagerada.
CLOAK_PHASE_LAG = 0.4
CLOAK_MULT = 2.0
CLOAK_FLARE = 0.10      # rad — a capa esvoaça SEMPRE um pouco pra trás (corrida)
TAIL_PHASE_LAG = 0.4
TAIL_WAG = 0.28         # rad — chicote lateral da cauda (rotação Z no pivô da base)
TAIL_PITCH_AMP = 0.12


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


def _push_action_to_nla(obj, action, clip_name="Run"):
    # O nome da action no bpy.data.actions é único (Blender sufixa .001,
    # .002...) mas o exportador glTF agrupa por NOME DO TRACK/STRIP — usar
    # sempre "Run" aqui (em vez de action.name) é o que faz os objetos
    # virarem UM clipe glTF só, com um canal por nó.
    obj.animation_data.action = None
    track = obj.animation_data.nla_tracks.new()
    track.name = clip_name
    track.strips.new(clip_name, 0, action)


def add_run_cycle(body, cloak, tail, fps=30):
    """
    Só a action "Run" em cada objeto — sem clipe de Idle: fcurves que não
    mudam de valor (0 -> 0) são podadas pelo exportador glTF. Parado, o jogo
    simplesmente não toca nenhuma action.

    Eixos com a frente em -Y: rotação X = pitch (investida), rotação Y =
    balanço lateral (roll), rotação Z = guinada (o chicote da cauda).
    ATENÇÃO de amostragem: sin(2*phi) vale 0 nos 5 pontos de fase — sinais
    de 2 batidas/ciclo têm que usar abs(sin(phi)) ou cos(2*phi), senão o
    canal sai constante e o exportador o poda.
    """
    bpy.context.scene.render.fps = fps
    frames, phis = _phase_points(RUN_CYCLE_FRAMES)

    def animate(obj, channels):
        obj.rotation_mode = "XYZ"  # transform_apply() vira QUATERNION; sem
        # isso a keyframe em rotation_euler fica inerte (não é a rotação ativa).
        obj.animation_data_create()
        action = bpy.data.actions.new("Run")
        obj.animation_data.action = action
        for data_path, index, vals in channels:
            if data_path == "location":
                # keyframe de location grava valor ABSOLUTO, não delta — o
                # pivô movido (set_origin_to_*) deixa a base != 0, então sem
                # somar a base o objeto "teletransportaria" pro chão.
                base = obj.location[index]
                vals = [base + v for v in vals]
            _set_fcurve(action, obj, data_path, index, frames, vals)
        _push_action_to_nla(obj, action)

    bob = [abs(math.sin(phi)) * RUN_BOB for phi in phis]

    # --- corpo: bob 2 batidas + investida (pica no contato, quando está
    # embaixo) + balanço lateral alternando a cada passada ---
    animate(body, [
        ("location", 2, bob),
        ("rotation_euler", 0, [RUN_PITCH * math.cos(2 * phi) for phi in phis]),
        ("rotation_euler", 1, [RUN_ROLL * math.sin(phi) for phi in phis]),
    ])

    # --- capa: MESMO bob do corpo (translação não liga pro pivô — qualquer
    # diferença abriria folga vertical na costura do ombro); rotações com
    # atraso e amplitude 2x + flare constante pra trás (vento da corrida) ---
    cloak_phis = [phi + CLOAK_PHASE_LAG for phi in phis]
    animate(cloak, [
        ("location", 2, bob),
        ("rotation_euler", 0, [CLOAK_FLARE + CLOAK_MULT * RUN_PITCH * math.cos(2 * phi) for phi in cloak_phis]),
        ("rotation_euler", 1, [CLOAK_MULT * RUN_ROLL * math.sin(phi) for phi in cloak_phis]),
    ])

    # --- cauda: chicote lateral (rotação Z em torno da base) + quique
    # vertical, tudo atrasado em relação ao corpo ---
    tail_phis = [phi + TAIL_PHASE_LAG for phi in phis]
    animate(tail, [
        ("location", 2, bob),
        ("rotation_euler", 2, [TAIL_WAG * math.sin(phi) for phi in tail_phis]),
        ("rotation_euler", 0, [TAIL_PITCH_AMP * math.cos(2 * phi) for phi in tail_phis]),
    ])

    print("acoes criadas:", [a.name for a in bpy.data.actions])


# ---------------------------------------------------------------- export

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


def count_triangles(objects):
    total = 0
    for o in objects:
        o.data.calc_loop_triangles()
        n = len(o.data.loop_triangles)
        print(f"tris {o.name}: {n}")
        total += n
    print("TRIS_TOTAL:", total)
    return total


# ---------------------------------------------------------------- renders

def _aim(obj, loc, target):
    obj.location = loc
    obj.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()


def setup_stage(samples):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = samples
    scene.render.resolution_x = 700
    scene.render.resolution_y = 700
    scene.render.film_transparent = False
    if scene.world is None:
        scene.world = bpy.data.worlds.new("World")
    scene.world.use_nodes = True
    bg = scene.world.node_tree.nodes.get("Background")
    bg.inputs[0].default_value = (0.16, 0.16, 0.19, 1.0)
    bg.inputs[1].default_value = 1.0

    # 3 luzes de estúdio (padrão debug_hood_nod): o pelo é quase preto, então
    # key forte + rim por trás pra recortar a silhueta do fundo cinza.
    for name, loc, energy in (
        ("Key", (2.0, -3.0, 3.5), 6.0),
        ("Fill", (-3.0, -1.2, 1.5), 2.2),
        ("Rim", (0.5, 4.0, 3.0), 5.0),
    ):
        light = bpy.data.lights.new(name, type="SUN")
        light.energy = energy
        lo = bpy.data.objects.new(name, light)
        bpy.context.collection.objects.link(lo)
        _aim(lo, loc, (0, 0, 0.8))

    cam_data = bpy.data.cameras.new("Camera")
    cam_data.lens = 50
    cam = bpy.data.objects.new("Camera", cam_data)
    bpy.context.collection.objects.link(cam)
    scene.camera = cam
    return cam


def render_shot(cam, loc, target, filepath, frame=0, lens=50):
    scene = bpy.context.scene
    scene.frame_set(frame)
    cam.data.lens = lens
    _aim(cam, loc, target)
    scene.render.filepath = filepath
    bpy.ops.render.render(write_still=True)
    print("rendered", filepath)


def render_debug_set(cam):
    mid = (0, 0, 0.8)
    render_shot(cam, (0, -3.4, 1.1), mid, os.path.join(RENDER_DIR, "wolf-hooded-front.png"))
    render_shot(cam, (3.4, 0, 1.1), mid, os.path.join(RENDER_DIR, "wolf-hooded-profile.png"))
    render_shot(cam, (2.3, -2.6, 1.7), mid, os.path.join(RENDER_DIR, "wolf-hooded-34.png"))

    # prova de orientação: cubo marcador em (0,-2,0.2) — a frente (focinho)
    # tem que apontar pro cubo no top-down (imagem: +Y em cima, -Y embaixo)
    bpy.ops.mesh.primitive_cube_add(size=0.4, location=(0, -2, 0.2))
    marker = bpy.context.object
    marker.data.materials.append(make_material("Marker", "#ff2020", emission_hex="#ff2020", emission_strength=5.0))
    render_shot(cam, (0, 0, 6.0), (0, 0, 0), os.path.join(RENDER_DIR, "wolf-hooded-orientation.png"), lens=35)
    bpy.data.objects.remove(marker, do_unlink=True)

    # 2 frames do ciclo Run (fases opostas) pra ver bob/pitch/capa/cauda
    render_shot(cam, (2.3, -2.6, 1.7), mid, os.path.join(RENDER_DIR, "wolf-hooded-run-f5.png"), frame=5)
    render_shot(cam, (2.3, -2.6, 1.7), mid, os.path.join(RENDER_DIR, "wolf-hooded-run-f15.png"), frame=15)


def render_beauty(cam):
    scene = bpy.context.scene
    scene.cycles.samples = 64
    scene.render.resolution_x = 900
    scene.render.resolution_y = 1100
    render_shot(cam, (2.1, -2.7, 1.5), (0, 0, 0.78), os.path.join(RENDER_DIR, "wolf-hooded.png"), frame=5, lens=60)


# ---------------------------------------------------------------- main

def main():
    mode = "debug"
    if "--" in sys.argv:
        rest = sys.argv[sys.argv.index("--") + 1:]
        if rest:
            mode = rest[0]

    clear_scene()
    build_materials()
    body = build_body()
    cloak = build_cloak()
    tail = build_tail()
    all_objects = [body, cloak, tail]

    make_game_ready(all_objects)
    count_triangles(all_objects)

    # pivôs ANTES da animação (rotação em torno da costura, não dos pés):
    # corpo gira nos quadris (~55% da altura), capa nos ombros (topo dela),
    # cauda na base (o vértice de menor Y é a emenda com o corpo).
    set_origin_to_z(body, 0.55 * TARGET_HEIGHT)
    cloak_top = max(v.co.z for v in cloak.data.vertices)
    set_origin_to_z(cloak, cloak_top - 0.02)
    tail_min_y = min(v.co.y for v in tail.data.vertices)
    seam = [v.co for v in tail.data.vertices if v.co.y < tail_min_y + 0.05]
    seam_z = sum(c.z for c in seam) / len(seam)
    set_origin_to_point(tail, (0.0, tail_min_y, seam_z))
    print("pivos: cloak_top=", cloak_top, "tail_seam=", (tail_min_y, seam_z))

    add_run_cycle(body, cloak, tail)
    export_glb(all_objects, GLB_OUTPUT)
    print("EXPORTED_TO", GLB_OUTPUT)

    cam = setup_stage(samples=16)
    if mode == "beauty":
        render_beauty(cam)
    else:
        render_debug_set(cam)
    print("DONE")


if __name__ == "__main__":
    main()
