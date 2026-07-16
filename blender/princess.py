"""
A PRINCESA DA LUZ — personagem autoral 100% procedural pro world-light.

Roda headless:
  PRINCESS_MODE=views,orient blender --background --python blender/princess.py
  PRINCESS_MODE=export,anim,beauty blender --background --python blender/princess.py

Modos (env PRINCESS_MODE, separados por vírgula):
  views  -> renders frente/perfil/3-4 (Cycles baixo)
  orient -> render top-down com cubo marcador em (0,-2,0.2) provando frente=-Y
  anim   -> frames 5 e 15 do ciclo "Run"
  beauty -> render final 64 samples (blender/renders/princess.png)
  export -> escreve public/models/princess.glb

Direção de arte: chibi de porcelana (cabeça ~35% da altura), vestido-sino
marfim com barra de filigrana emissiva dourada, cabelo loiro com duas mechas
longas que balançam, coroa obsidiana quase preta meio afundada no cabelo,
olhos grandes escuros com catchlight dourado, estrela emissiva no peito.
Ela FOGE do jogador — o único clipe é "Run", uma corrida fofa e urgente.

Padrões copiados de export_game_character.py (lições aprendidas lá):
- make_game_ready com transform_apply POR OBJETO (seleção isolada);
- set_origin_to_z pra pivô de rotação na costura (senão abre vão);
- _set_fcurve via action.fcurve_ensure_for_datablock (Blender 5.x, actions
  em camadas);
- _push_action_to_nla com o MESMO nome de strip em todos os objetos ("Run")
  — é o nome do track/strip que funde tudo num único clipe glTF;
- rotation_mode='XYZ' depois do transform_apply;
- keyframes de location são ABSOLUTOS (somar a base do objeto);
- nunca criar fcurve constante (0->0): o exportador glTF PODA e descarta.
"""
import bpy
import bmesh
import math
import os
from mathutils import Vector

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(SCRIPT_DIR)
RENDER_DIR = os.path.join(SCRIPT_DIR, "renders")
GLB_OUTPUT = os.path.join(REPO_ROOT, "public", "models", "princess.glb")

TARGET_HEIGHT = 1.05  # o jogador tem 1.45 — ela é baixinha de propósito

# A frente (rosto/estrela do peito) já é CONSTRUÍDA olhando pra -Y do
# Blender: o conversor Z-up -> Y-up do glTF faz -Y virar +Z, e o Player.tsx
# assume rotation.y=0 olhando +Z. Então aqui não precisa girar nada — mas o
# make_game_ready mantém o slot de rotação pra deixar a intenção explícita.
FORWARD_ROTATION_Z = 0.0

# ---------------------------------------------------------------------------
# proporções (unidades de "design", escaladas no make_game_ready)
# ---------------------------------------------------------------------------
HEAD_C = Vector((0.0, 0.0, 1.72))
HEAD_R = 0.38          # diâmetro 0.76 num total ~2.2 => cabeça ~35% (chibi)
HAIR_R = 0.44          # casco de cabelo um pouco maior que a cabeça

LOCK_ROOT_Z = 1.80     # raiz das mechas laterais (no alto da cabeça)
LOCK_TIP_Z = 0.66      # pontas abaixo do ombro
LOCK_X = 0.37          # raiz encostada na lateral do casco de cabelo

WAIST_Z = 0.82         # topo da saia (pivô do corpo e da saia)

# ---------------------------------------------------------------------------
# ciclo "Run" (valores em unidades FINAIS, aplicados depois da escala)
# ---------------------------------------------------------------------------
RUN_CYCLE_FRAMES = 20  # 20 frames @ 30fps — corrida rápida e urgente
RUN_BOB = 0.06         # bob forte, 2 batidas por ciclo (abs(sin))
BODY_ROLL = 0.09       # balanço lateral (rot Y; frente é -Y => Y é "roll")
BODY_PITCH_BASE = 0.10  # inclinação constante pra frente (corre com pressa)
BODY_PITCH_AMP = 0.07   # ... mas oscilando — fcurve constante seria PODADA
CLOTH_LAG = 0.4        # atraso de fase do tecido/cabelo (follow-through)
SKIRT_ROLL_AMP = 0.16  # ~1.8x o roll do corpo
SKIRT_PITCH_AMP = 0.13
HAIR_PITCH_BASE = 0.16  # mechas arrastadas pra trás pelo vento da corrida
HAIR_PITCH_AMP = 0.14   # ~2x a oscilação de pitch do corpo
HAIR_LAG_L = 0.40
HAIR_LAG_R = 0.52      # lados dessincronizados de leve = mais vida


def clear_scene():
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.lights, bpy.data.cameras, bpy.data.images):
        for item in list(block):
            if item.users == 0:
                block.remove(item)


# ---------------------------------------------------------------------------
# materiais — só Principled BSDF com cores chapadas + Emission: o exportador
# glTF NÃO exporta nós procedurais de textura, então nada de node-tree extra.
# ---------------------------------------------------------------------------
def make_material(name, base, rough=0.5, metallic=0.0, emit=None, estr=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (*base, 1.0)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metallic
    if emit is not None:
        b.inputs["Emission Color"].default_value = (*emit, 1.0)
        b.inputs["Emission Strength"].default_value = estr
    return m


def build_materials():
    return {
        # pele de porcelana que parece feita de luz (emissão branca-azulada sutil)
        "skin": make_material("PorcelainSkin", (0.92, 0.93, 0.98), rough=0.35,
                              emit=(0.85, 0.90, 1.00), estr=0.6),
        "eye": make_material("EyeDark", (0.015, 0.015, 0.025), rough=0.15),
        "catch": make_material("EyeCatchlight", (1.0, 0.8, 0.35), rough=0.4,
                               emit=(1.0, 0.80, 0.35), estr=5.0),
        "cheek": make_material("CheekBlush", (1.0, 0.45, 0.50), rough=0.7,
                               emit=(1.0, 0.40, 0.45), estr=0.25),
        "hair": make_material("HairGold", (0.87, 0.58, 0.16), rough=0.45),
        # pontas das mechas "costuradas de luz"
        "hairtip": make_material("HairTipGlow", (1.0, 0.78, 0.35), rough=0.4,
                                 emit=(1.0, 0.85, 0.40), estr=1.5),
        # coroa obsidiana: o escuro-no-dourado é a marca dela
        "crown": make_material("ObsidianCrown", (0.02, 0.015, 0.03),
                               rough=0.25, metallic=0.85),
        "dress": make_material("IvoryDress", (0.87, 0.82, 0.70), rough=0.55),
        # filigrana da barra do vestido
        "gold": make_material("GoldFiligree", (1.0, 0.78, 0.35), rough=0.35,
                              emit=(1.0, 0.80, 0.35), estr=3.0),
        # estrela do peito — eco do rosto-sol do jogador
        "star": make_material("ChestStar", (1.0, 0.80, 0.35), rough=0.4,
                              emit=(1.0, 0.82, 0.40), estr=4.0),
    }


# ---------------------------------------------------------------------------
# helpers de malha (bmesh, tudo procedural)
# ---------------------------------------------------------------------------
def new_obj(name, bm, mats=None, smooth=True):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    if mats:
        for m in mats:
            mesh.materials.append(m)
    if smooth and len(mesh.polygons):
        mesh.polygons.foreach_set("use_smooth", [True] * len(mesh.polygons))
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return obj


def select_only(obj):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def apply_modifier(obj, mod):
    # modifier_apply opera no objeto ATIVO — isolar a seleção como no
    # transform_apply do make_game_ready (mesma pegadinha de contexto).
    select_only(obj)
    bpy.ops.object.modifier_apply(modifier=mod.name)


def join_objects(objs, name):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    joined = bpy.context.view_layer.objects.active
    joined.name = name
    return joined


def add_sphere(name, radius, loc, seg=48, rings=32, scale=(1, 1, 1), mats=None, smooth=True):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=radius)
    for v in bm.verts:
        v.co.x = v.co.x * scale[0] + loc[0]
        v.co.y = v.co.y * scale[1] + loc[1]
        v.co.z = v.co.z * scale[2] + loc[2]
    return new_obj(name, bm, mats, smooth)


def _catmull(p0, p1, p2, p3, t):
    # Catmull-Rom em (r, z): perfis de sino/mecha ficam curvos e orgânicos em
    # vez de facetados — interpolação linear entre poucos controles deixava
    # "degraus" visíveis com shading smooth.
    t2, t3 = t * t, t * t * t
    return tuple(
        0.5 * (2 * p1[i] + (-p0[i] + p2[i]) * t
               + (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * t2
               + (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * t3)
        for i in range(2)
    )


def densify(pts, per_span=3):
    ext = [pts[0]] + list(pts) + [pts[-1]]
    out = [pts[0]]
    for i in range(len(pts) - 1):
        for k in range(1, per_span + 1):
            out.append(_catmull(ext[i], ext[i + 1], ext[i + 2], ext[i + 3], k / per_span))
    return out


def make_lathe(name, rings, segments, mats=None, wave=None, center_fn=None, smooth=True):
    """Superfície de revolução: lista de anéis (r, z); r<=0 vira polo.
    wave(a, z) -> delta de raio (babados da saia); center_fn(z) -> (cx, cy)
    desloca o centro do anel (curva em S das mechas de cabelo)."""
    bm = bmesh.new()
    ring_verts = []
    for (r, z) in rings:
        cx, cy = center_fn(z) if center_fn else (0.0, 0.0)
        if r <= 1e-6:
            ring_verts.append([bm.verts.new((cx, cy, z))])
            continue
        ring = []
        for i in range(segments):
            a = 2.0 * math.pi * i / segments
            rr = r + (wave(a, z) if wave else 0.0)
            ring.append(bm.verts.new((cx + rr * math.cos(a), cy + rr * math.sin(a), z)))
        ring_verts.append(ring)
    for ra, rb in zip(ring_verts, ring_verts[1:]):
        if len(ra) == 1 and len(rb) == 1:
            continue
        if len(ra) == 1:
            for i in range(segments):
                bm.faces.new((ra[0], rb[i], rb[(i + 1) % segments]))
        elif len(rb) == 1:
            for i in range(segments):
                bm.faces.new((ra[i], ra[(i + 1) % segments], rb[0]))
        else:
            for i in range(segments):
                bm.faces.new((ra[i], ra[(i + 1) % segments], rb[(i + 1) % segments], rb[i]))
    return new_obj(name, bm, mats, smooth)


# ---------------------------------------------------------------------------
# corpo (tudo que NÃO balança sozinho vira UM objeto só — senão a parte fica
# flutuando parada enquanto o corpo boba, lição do repo)
# ---------------------------------------------------------------------------
def build_body(mats):
    parts = []

    # --- bodice: metade de cima do vestido-sino, desce POR CIMA do topo da
    # saia (sobreposição radial ~0.05) pra esconder a costura quando a saia
    # gira com atraso de fase. Fundo fechado: nunca se vê "dentro" do vestido.
    bodice_outer = densify([
        (0.13, 1.44), (0.16, 1.40), (0.20, 1.30), (0.245, 1.20),
        (0.275, 1.10), (0.30, 1.00), (0.33, 0.90), (0.365, 0.80),
        (0.40, 0.70), (0.43, 0.62),
    ])
    bodice_rings = [(0.0, 1.455)] + bodice_outer + [(0.34, 0.595), (0.0, 0.595)]
    parts.append(make_lathe("Bodice", bodice_rings, 96, [mats["dress"]]))

    # --- cabeça de porcelana (levemente achatada = mais fofa)
    parts.append(add_sphere("Head", HEAD_R, HEAD_C, seg=96, rings=64,
                            scale=(1.0, 0.97, 0.94), mats=[mats["skin"]]))

    # --- casco de cabelo: esfera com "janela" do rosto recortada na frente
    # (-Y) + SOLIDIFY pra borda ter espessura (sem isso a abertura mostra o
    # verso das faces, um buraco preto no render).
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=96, v_segments=64, radius=HAIR_R)
    doomed = []
    for f in bm.faces:
        d = f.calc_center_median().normalized()
        if d.y < -0.30 and d.z < 0.42:  # frente e abaixo da linha da franja
            doomed.append(f)
    bmesh.ops.delete(bm, geom=doomed, context="FACES")
    for v in bm.verts:
        v.co += HEAD_C
    hair_cap = new_obj("HairCap", bm, [mats["hair"]])
    solid = hair_cap.modifiers.new("Solidify", "SOLIDIFY")
    solid.thickness = 0.035
    solid.offset = -1.0  # casca cresce pra DENTRO: mantém o raio externo
    apply_modifier(hair_cap, solid)
    parts.append(hair_cap)

    # --- franja: 5 "conchinhas" arredondadas sobre a testa (volume fofo;
    # raio contido — 0.115 virava um "calombo" saliente visto de perfil)
    fringe_e = 0.30  # elevação (rad) da linha da franja
    for i, a in enumerate((-0.62, -0.31, 0.0, 0.31, 0.62)):
        d = Vector((math.cos(fringe_e) * math.sin(a),
                    -math.cos(fringe_e) * math.cos(a),
                    math.sin(fringe_e)))
        pos = HEAD_C + d * 0.385
        parts.append(add_sphere(f"Fringe{i}", 0.10, pos, seg=32, rings=22,
                                mats=[mats["hair"]]))

    # --- olhos grandes quase pretos, salientes (chibi), com catchlight
    # dourado emissivo — o "eco" do rosto-sol do jogador no olhar dela.
    for sgn in (-1.0, 1.0):
        a, e = sgn * 0.34, -0.06
        d = Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e)))
        eye_pos = HEAD_C + d * 0.34
        parts.append(add_sphere("Eye", 0.088, eye_pos, seg=48, rings=32,
                                scale=(1.0, 0.75, 1.2), mats=[mats["eye"]]))
        # catchlight ENCOSTADO na esfera do olho — com offset maior ele
        # renderizava como um ponto solto flutuando na frente do olho
        catch = eye_pos + d * 0.060 + Vector((sgn * 0.015, -0.005, 0.028))
        parts.append(add_sphere("Catch", 0.022, catch, seg=20, rings=14,
                                mats=[mats["catch"]]))
        # bochecha rosada (disco achatado meio afundado na pele)
        ca, ce = sgn * 0.58, -0.30
        cd = Vector((math.sin(ca) * math.cos(ce), -math.cos(ca) * math.cos(ce), math.sin(ce)))
        parts.append(add_sphere("Cheek", 0.062, HEAD_C + cd * 0.365,
                                seg=32, rings=22, scale=(1.0, 0.45, 0.75),
                                mats=[mats["cheek"]]))

    # --- coroa obsidiana meio afundada no cabelo (flat shading de propósito:
    # facetada parece pedra lapidada; smooth deixava com cara de plástico)
    crown_z = HEAD_C.z + 0.385
    bpy.ops.mesh.primitive_torus_add(major_segments=96, minor_segments=24,
                                     major_radius=0.17, minor_radius=0.028,
                                     location=(0.0, 0.0, crown_z))
    ring = bpy.context.active_object
    ring.name = "CrownRing"
    ring.data.materials.append(mats["crown"])
    parts.append(ring)
    for k in range(5):
        a = -math.pi / 2 + k * 2.0 * math.pi / 5  # 1ª ponta pra FRENTE (-Y)
        depth = 0.22 if k == 0 else 0.16
        bpy.ops.mesh.primitive_cone_add(vertices=24, radius1=0.045, radius2=0.0,
                                        depth=depth,
                                        location=(0.17 * math.cos(a),
                                                  0.17 * math.sin(a),
                                                  crown_z + depth / 2 + 0.01))
        spike = bpy.context.active_object
        spike.name = f"CrownSpike{k}"
        spike.data.materials.append(mats["crown"])
        parts.append(spike)

    # --- mangas bufantes + mãozinhas rentes ao corpo
    for sgn in (-1.0, 1.0):
        parts.append(add_sphere("Sleeve", 0.115, (sgn * 0.315, -0.02, 1.12),
                                seg=48, rings=32, mats=[mats["dress"]]))
        parts.append(add_sphere("Hand", 0.06, (sgn * 0.345, -0.06, 0.97),
                                seg=32, rings=22, mats=[mats["skin"]]))

    # --- estrela emissiva no peito (leque de triângulos + SOLIDIFY)
    star_bm = bmesh.new()
    pts = []
    for k in range(10):
        ang = math.pi / 2 + k * math.pi / 5
        r = 0.08 if k % 2 == 0 else 0.034
        pts.append(star_bm.verts.new((r * math.cos(ang), 0.0, r * math.sin(ang))))
    center = star_bm.verts.new((0.0, 0.0, 0.0))
    for k in range(10):
        star_bm.faces.new((center, pts[k], pts[(k + 1) % 10]))
    for v in star_bm.verts:
        v.co.y += -0.255  # encostada na superfície do bodice (r~0.25 em z=1.18)
        v.co.z += 1.18
    star = new_obj("ChestStar", star_bm, [mats["star"]], smooth=False)
    solid = star.modifiers.new("Solidify", "SOLIDIFY")
    solid.thickness = 0.05
    solid.offset = 0.0
    apply_modifier(star, solid)
    parts.append(star)

    return join_objects(parts, "Body")


# ---------------------------------------------------------------------------
# mechas de cabelo (HairL / HairR) — objetos separados pro follow-through
# ---------------------------------------------------------------------------
def _lock_radius(t):
    if t < 0.3:
        return 0.04 + (0.11 - 0.04) * math.sin(t / 0.3 * math.pi / 2)
    if t < 0.85:
        return 0.11 - (0.11 - 0.05) * ((t - 0.3) / 0.55) ** 1.2
    s = (t - 0.85) / 0.15
    return 0.05 + 0.024 * math.sin(s * math.pi) - 0.024 * s  # bulbo na ponta


def build_lock(name, side, mats):
    n = 44
    rings = [(0.0, LOCK_ROOT_Z + 0.02)]
    for i in range(n + 1):
        t = i / n
        rings.append((_lock_radius(t), LOCK_ROOT_Z - t * (LOCK_ROOT_Z - LOCK_TIP_Z)))
    rings.append((0.0, LOCK_TIP_Z - 0.03))

    length = LOCK_ROOT_Z - LOCK_TIP_Z

    def center_fn(z):
        t = max(0.0, min(1.0, (LOCK_ROOT_Z - z) / length))
        # curva em S suave: sai da lateral da cabeça, emoldura o rosto e a
        # ponta escapa levemente pra trás (o clipe Run joga tudo pra trás).
        # O termo t^2 empurra a metade de baixo pra FORA — sem ele a mecha
        # afundava na saia (que balança separada: interseção visível).
        cx = side * (LOCK_X + 0.05 * math.sin(t * math.pi) + 0.06 * t ** 2)
        cy = -0.01 - 0.06 * math.sin(t * math.pi * 0.9) + 0.12 * t ** 3
        return cx, cy

    lock = make_lathe(name, rings, 48, [mats["hair"], mats["hairtip"]],
                      center_fn=center_fn)
    # ponta "costurada de luz": ~18% de baixo vira material emissivo
    tip_z = LOCK_TIP_Z + 0.18 * length
    for poly in lock.data.polygons:
        if poly.center.z < tip_z:
            poly.material_index = 1
    return lock


# ---------------------------------------------------------------------------
# saia (Skirt) — metade de baixo do vestido, separada pro balanço com atraso
# ---------------------------------------------------------------------------
def skirt_wave(a, z):
    # babados: onda radial que cresce em direção à barra ("fofo")
    w = max(0.0, (0.55 - z) / 0.55) ** 1.5
    return 0.02 * math.sin(10.0 * a) * w


def build_skirt(mats):
    outer = densify([
        (0.30, 0.79), (0.355, 0.72), (0.38, 0.62), (0.415, 0.50),
        (0.46, 0.38), (0.52, 0.24), (0.575, 0.12), (0.615, 0.04), (0.62, 0.0),
    ])
    rings = [(0.0, WAIST_Z)] + outer + [(0.48, 0.02), (0.0, 0.045)]
    skirt = make_lathe("SkirtMesh", rings, 160, [mats["dress"]], wave=skirt_wave)

    # anel de filigrana emissiva na barra — meio "tecido" nos babados
    bpy.ops.mesh.primitive_torus_add(major_segments=128, minor_segments=20,
                                     major_radius=0.625, minor_radius=0.024,
                                     location=(0.0, 0.0, 0.055))
    hem = bpy.context.active_object
    hem.name = "HemRing"
    hem.data.materials.append(mats["gold"])
    hem.data.polygons.foreach_set("use_smooth", [True] * len(hem.data.polygons))

    parts = [skirt, hem]
    # pontinhos de filigrana em zigue-zague acima da barra
    for i in range(20):
        a = 2.0 * math.pi * i / 20
        z = 0.10 if i % 2 == 0 else 0.17
        r_surf = 0.585 if i % 2 == 0 else 0.55
        r = r_surf + skirt_wave(a, z) + 0.002
        parts.append(add_sphere(f"Stud{i}", 0.02,
                                (r * math.cos(a), r * math.sin(a), z),
                                seg=16, rings=12, mats=[mats["gold"]]))
    return join_objects(parts, "Skirt")


# ---------------------------------------------------------------------------
# game-ready (copiado do repo: transform_apply POR objeto, seleção isolada)
# ---------------------------------------------------------------------------
def make_game_ready(objects):
    """Ponto mais baixo de TODOS os objetos em Z=0, altura alvo, frente -Y.

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
    return scale


def set_origin_to_z(obj, z):
    """
    Move o pivô do objeto pra um Z específico (mundo), sem mexer na malha
    visualmente. Sem isso, toda rotação de saia/mecha gira em torno da
    origem lá embaixo (pés) — um ângulo pequeno vira um arco enorme na
    altura da costura, abrindo um vão visível. Girar em torno da própria
    emenda (cintura pra saia, raiz pro cabelo) mantém a costura fechada.
    """
    cursor = bpy.context.scene.cursor
    saved = cursor.location.copy()
    cursor.location = (0.0, 0.0, z)
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
    cursor.location = saved


# ---------------------------------------------------------------------------
# animação "Run" (helpers copiados do repo)
# ---------------------------------------------------------------------------
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
    # sempre "Run" aqui (em vez de action.name) é o que faz os 4 objetos
    # virarem UM clipe glTF só, com um canal por nó.
    obj.animation_data.action = None
    track = obj.animation_data.nla_tracks.new()
    track.name = clip_name
    track.strips.new(clip_name, 0, action)


def add_run_cycle(body, hairl, hairr, skirt, waist_z, fps=30):
    """
    Só a action "Run" em cada objeto — sem clipe de Idle: fcurves que não
    mudam de valor (0 -> 0) são podadas pelo exportador glTF. Ela só existe
    correndo mesmo — aparece, olha, e FOGE.

    Corpo e saia pivotam AMBOS na cintura (mesmo eixo), então a costura da
    cintura só desliza pela DIFERENÇA de ângulo (o atraso de fase), que a
    sobreposição bodice-sobre-saia esconde. Já as raízes das mechas ficam
    ~0.2 acima do pivô do corpo: quando o corpo inclina/rola, a raiz VIAJA
    junto — compensa com keyframes de location x/y (braço de alavanca *
    seno do ângulo do corpo, SEM atraso: translação precisa seguir o corpo
    exato; o atraso do follow-through fica só na rotação própria da mecha).
    """
    scene = bpy.context.scene
    scene.render.fps = fps
    scene.frame_start = 0
    scene.frame_end = RUN_CYCLE_FRAMES
    frames, phis = _phase_points(RUN_CYCLE_FRAMES)

    def body_pitch(p):
        return BODY_PITCH_BASE + BODY_PITCH_AMP * abs(math.sin(p))

    def body_roll(p):
        return BODY_ROLL * math.sin(p)

    bob = [abs(math.sin(p)) * RUN_BOB for p in phis]

    def animate(obj, loc_x=None, loc_y=None, bob_vals=None, pitch=None, roll=None):
        obj.rotation_mode = "XYZ"  # transform_apply() vira QUATERNION; sem
        # isso a keyframe em rotation_euler fica inerte (não é a rotação ativa).
        obj.animation_data_create()
        action = bpy.data.actions.new("Run")
        obj.animation_data.action = action
        # keyframes de location gravam o valor ABSOLUTO, não um delta — somar
        # a base do objeto (o pivô movido pelo set_origin_to_z) sempre.
        bx, by, bz = obj.location
        if loc_x is not None:
            _set_fcurve(action, obj, "location", 0, frames, [bx + v for v in loc_x])
        if loc_y is not None:
            _set_fcurve(action, obj, "location", 1, frames, [by + v for v in loc_y])
        if bob_vals is not None:
            _set_fcurve(action, obj, "location", 2, frames, [bz + v for v in bob_vals])
        if pitch is not None:
            _set_fcurve(action, obj, "rotation_euler", 0, frames, pitch)
        if roll is not None:
            _set_fcurve(action, obj, "rotation_euler", 1, frames, roll)
        _push_action_to_nla(obj, action)

    # corpo: bob 2 batidas + inclinação pra frente oscilante + roll lateral
    animate(body, bob_vals=bob,
            pitch=[body_pitch(p) for p in phis],
            roll=[body_roll(p) for p in phis])

    # saia: mesmo bob (fecha a costura vertical), rotações com atraso e
    # amplitude ~1.8x — follow-through de tecido
    animate(skirt, bob_vals=bob,
            pitch=[BODY_PITCH_BASE + SKIRT_PITCH_AMP * abs(math.sin(p + CLOTH_LAG)) for p in phis],
            roll=[SKIRT_ROLL_AMP * math.sin(p + CLOTH_LAG) for p in phis])

    # mechas: seguem a raiz (compensação de location) + chicoteiam pra trás
    for hair, lag in ((hairl, HAIR_LAG_L), (hairr, HAIR_LAG_R)):
        lever = hair.location.z - waist_z  # raiz acima do pivô do corpo
        animate(hair,
                loc_x=[lever * math.sin(body_roll(p)) for p in phis],
                loc_y=[-lever * math.sin(body_pitch(p)) for p in phis],
                bob_vals=bob,
                pitch=[HAIR_PITCH_BASE + HAIR_PITCH_AMP * abs(math.sin(p + lag)) for p in phis])

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


# ---------------------------------------------------------------------------
# renders de verificação (padrão do debug_hood_nod.py: Cycles, samples
# baixos, luzes simples de estúdio)
# ---------------------------------------------------------------------------
def setup_render(samples=20):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = samples
    scene.render.film_transparent = False

    world = scene.world
    if world is None:
        world = bpy.data.worlds.new("World")
        scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bg.inputs[0].default_value = (0.16, 0.17, 0.20, 1.0)
    bg.inputs[1].default_value = 1.0

    def sun(name, energy, rot, color=(1.0, 1.0, 1.0)):
        light = bpy.data.lights.new(name, type="SUN")
        light.energy = energy
        light.color = color
        obj = bpy.data.objects.new(name, light)
        obj.rotation_euler = rot
        bpy.context.collection.objects.link(obj)

    sun("Key", 3.0, (math.radians(55), 0.0, math.radians(35)))
    sun("Fill", 1.2, (math.radians(70), 0.0, math.radians(-50)), (0.9, 0.95, 1.0))
    sun("Rim", 2.0, (math.radians(-65), 0.0, 0.0))

    floor_mat = make_material("FloorGray", (0.22, 0.22, 0.24), rough=0.9)
    bpy.ops.mesh.primitive_plane_add(size=14, location=(0.0, 0.0, 0.0))
    floor = bpy.context.active_object
    floor.name = "Floor"
    floor.data.materials.append(floor_mat)

    cam_data = bpy.data.cameras.new("Camera")
    cam_obj = bpy.data.objects.new("Camera", cam_data)
    bpy.context.collection.objects.link(cam_obj)
    scene.camera = cam_obj
    return cam_obj


def place_cam(cam, loc, target, lens=50):
    cam.data.type = "PERSP"
    cam.data.lens = lens
    cam.location = Vector(loc)
    cam.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()


def render_to(path, res=(640, 800), frame=0, samples=None):
    scene = bpy.context.scene
    if samples is not None:
        scene.cycles.samples = samples
    scene.frame_set(frame)
    scene.render.resolution_x, scene.render.resolution_y = res
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print("rendered", path)


def main():
    clear_scene()
    mats = build_materials()
    body = build_body(mats)
    hairl = build_lock("HairL", -1.0, mats)
    hairr = build_lock("HairR", +1.0, mats)
    skirt = build_skirt(mats)
    all_objects = [body, hairl, hairr, skirt]

    # polycount (depois de todos os modificadores aplicados)
    total = 0
    for o in all_objects:
        o.data.calc_loop_triangles()
        n = len(o.data.loop_triangles)
        total += n
        print(f"tris {o.name}: {n}")
    print("TRIS_TOTAL:", total)

    make_game_ready(all_objects)

    # pivôs nas costuras: corpo e saia na cintura, mechas nas raízes
    waist_z = max(v.co.z for v in skirt.data.vertices)
    set_origin_to_z(body, waist_z)
    set_origin_to_z(skirt, waist_z)
    for hair in (hairl, hairr):
        set_origin_to_z(hair, max(v.co.z for v in hair.data.vertices))
    print("pivo cintura em z=", waist_z)

    add_run_cycle(body, hairl, hairr, skirt, waist_z)

    modes = set(os.environ.get("PRINCESS_MODE", "views,orient").split(","))
    if "all" in modes:
        modes = {"views", "orient", "anim", "beauty", "export"}

    if "export" in modes:
        export_glb(all_objects, GLB_OUTPUT)
        print("EXPORTED_TO", GLB_OUTPUT)

    if modes & {"views", "orient", "anim", "beauty"}:
        cam = setup_render(samples=20)
        if "views" in modes:
            place_cam(cam, (0.0, -1.9, 0.62), (0.0, 0.0, 0.5), lens=50)
            render_to(os.path.join(RENDER_DIR, "princess-front.png"))
            place_cam(cam, (1.9, 0.0, 0.62), (0.0, 0.0, 0.5), lens=50)
            render_to(os.path.join(RENDER_DIR, "princess-profile.png"))
            place_cam(cam, (-1.35, -1.45, 0.85), (0.0, 0.0, 0.48), lens=50)
            render_to(os.path.join(RENDER_DIR, "princess-quarter.png"))
        if "orient" in modes:
            # top-down + cubo marcador em (0,-2,0.2): a frente (franja,
            # ponta frontal da coroa) deve apontar pro cubo = -Y provado.
            marker_mat = make_material("MarkerRed", (0.9, 0.05, 0.05), rough=0.6)
            bpy.ops.mesh.primitive_cube_add(size=0.35, location=(0.0, -2.0, 0.2))
            marker = bpy.context.active_object
            marker.data.materials.append(marker_mat)
            cam.data.type = "ORTHO"
            cam.data.ortho_scale = 5.2
            cam.location = (0.0, -0.9, 6.0)
            cam.rotation_euler = (0.0, 0.0, 0.0)
            render_to(os.path.join(RENDER_DIR, "princess-orientation.png"), res=(700, 700))
            bpy.data.objects.remove(marker, do_unlink=True)
        if "anim" in modes:
            place_cam(cam, (-1.35, -1.45, 0.85), (0.0, 0.0, 0.48), lens=50)
            render_to(os.path.join(RENDER_DIR, "princess-run-f5.png"), frame=5)
            render_to(os.path.join(RENDER_DIR, "princess-run-f15.png"), frame=15)
        if "beauty" in modes:
            place_cam(cam, (-1.25, -1.5, 0.78), (0.0, 0.0, 0.47), lens=55)
            render_to(os.path.join(RENDER_DIR, "princess.png"),
                      res=(880, 1080), frame=5, samples=64)

    print("DONE")


if __name__ == "__main__":
    main()
