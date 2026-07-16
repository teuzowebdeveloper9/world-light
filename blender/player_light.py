"""
O VIAJANTE DA LUZ v2 — novo personagem principal (player) do world-light,
100% autoral e procedural (bmesh + modificadores + deslocamento por código;
nenhum asset externo, nenhuma malha importada).

Roda headless:
  PLAYER_MODE=views,orient blender --background --python blender/player_light.py
  PLAYER_MODE=anim blender --background --python blender/player_light.py
  PLAYER_MODE=export,beauty blender --background --python blender/player_light.py

Modos (env PLAYER_MODE, separados por vírgula):
  views  -> renders frente/perfil/3-4 (Cycles baixo)
  orient -> render top-down com cubo marcador em (0,-2,0.2) provando frente=-Y
  anim   -> frames Walk f5/f15 e Fly f8/f22
  beauty -> render final 64 samples (blender/renders/player-light.png)
  export -> escreve public/models/player-light.glb

Direção de arte (contraste máximo, treva absoluta + luz pura):
- Cloak: UM manto com capuz até o chão, quase-preto absoluto (#060609,
  rough 0.92), TODO o orçamento de detalhe aqui — dobras de tecido por
  ruído em várias oitavas + Subdivision, cavidade FUNDA no capuz, barra
  rasgada por ruído e levantada na FRENTE (pros pés de luz aparecerem).
- CapeBack: painel de capa traseiro separado, pivô na costura dos ombros,
  borda rasgada — é ele que mostra o vento ao andar e voar.
- Face: PURA LUZ — blob suave sem feições dentro do capuz (#fff2d0, 30).
- FootL/FootR: gotas de luz (mesmo tom, 15) que pisam sob a barra.

Padrões copiados de export_game_character.py / princess.py (lições do repo):
- make_game_ready com transform_apply POR OBJETO (seleção isolada);
- set_origin_to_z / set_origin_to_point pra pivô de rotação nas costuras;
- _set_fcurve via action.fcurve_ensure_for_datablock (Blender 5.x, actions
  em camadas);
- _push_action_to_nla com o MESMO nome de strip em todos os objetos
  ("Walk"/"Fly") — o nome do track/strip é o que funde num clipe glTF só;
- rotation_mode='XYZ' depois do transform_apply;
- keyframes de location são ABSOLUTOS (somar a base do objeto);
- nunca criar fcurve constante (o exportador glTF PODA e descarta);
- passada dos pés = fórmula dos commits d96aa60/726adc3: avanço =
  STRIDE*cos(phi), lift = LIFT*max(0, -phase_sign*sin(phi)) — o pé só
  levanta na metade do ciclo em que avança; phase_sign oposto por pé.
"""
import bpy
import bmesh
import math
import os
from mathutils import Vector, noise

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(SCRIPT_DIR)
RENDER_DIR = os.path.join(SCRIPT_DIR, "renders")
GLB_OUTPUT = os.path.join(REPO_ROOT, "public", "models", "player-light.glb")

TARGET_HEIGHT = 1.10  # o hooded-figure atual tem 1.45 — este é BAIXINHO

# A frente (cavidade do capuz, rosto de luz, barra levantada) já é
# CONSTRUÍDA olhando pra -Y do Blender: o conversor Z-up -> Y-up do glTF
# faz -Y virar +Z, e o Player.tsx assume rotation.y=0 olhando +Z.
FORWARD_ROTATION_Z = 0.0

# ---------------------------------------------------------------------------
# proporções (unidades de "design" ~= finais; make_game_ready normaliza)
# ---------------------------------------------------------------------------
CLOAK_PROFILE = [
    (0.050, 1.093),
    (0.100, 1.068),
    (0.150, 1.022),
    (0.183, 0.965),
    (0.193, 0.905),
    (0.176, 0.845),
    (0.150, 0.805),   # pescoço (pinch entre capuz e ombros)
    (0.158, 0.765),
    (0.196, 0.722),   # ombros
    (0.218, 0.665),
    (0.222, 0.585),
    (0.216, 0.480),
    (0.216, 0.375),
    (0.228, 0.270),
    (0.250, 0.175),
    (0.276, 0.095),
    (0.293, 0.032),
    (0.295, 0.012),
]

# Cavidade FUNDA do capuz: um bolsão escavado ao longo de -Y (eixo da
# frente). Empurrar vértices pra superfície de uma esfera à frente NÃO
# funciona (testado: verts na frente do centro eram empurrados pra FORA,
# virava um calombo esférico saltando do capuz em vez de uma cavidade).
CAVITY_Z = 0.923      # altura do eixo do bolsão
CAVITY_RIM = 0.115    # raio da abertura
CAVITY_DEEP_Y = -0.045  # fundo do bolsão (frente do capuz está em ~-0.21)

HEM_Z = 0.16          # abaixo daqui a barra pode rasgar/levantar
HEM_FRONT_LIFT = 0.085  # barra levantada na FRENTE: os pés de luz aparecem

CAPE_TOP_Z = 0.73     # costura dos ombros (pivô do CapeBack)

FACE_C = Vector((0.0, -0.115, 0.923))  # fundo na cavidade, borda escura ao redor
FOOT_X = 0.066
FOOT_Y = -0.17        # um pouco à frente do eixo, sob a barra levantada
FOOT_Z = 0.042        # centro da gota (fundo quase no chão)

# ---------------------------------------------------------------------------
# animações (valores em unidades FINAIS, aplicados depois da escala)
# ---------------------------------------------------------------------------
WALK_FRAMES = 20      # @30fps
FLY_FRAMES = 30
PHASE_COUNT = 9       # 9 pontos de fase = curvas mais ricas que 5 (abs/max
#                       não são senóides puras); início=fim => loop perfeito

WALK_BOB = 0.045      # 2 batidas/ciclo (abs(sin))
WALK_ROLL = 0.05      # balanço lateral (rot Y; frente é -Y => Y é "roll")
WALK_PITCH_BASE = 0.015  # nod sutil frente/trás do manto...
WALK_PITCH_AMP = 0.020   # ...oscilando (fcurve constante seria PODADA)
WALK_PITCH_LAG = 0.35

CAPE_LAG = 0.45       # atraso de fase do pano (follow-through)
CAPE_ROLL_AMP = 0.10  # 2x o roll do corpo
CAPE_BILLOW_BASE = 0.06  # "billow": rotação frente/trás no pivô dos ombros
CAPE_BILLOW_AMP = 0.15

STRIDE = 0.11         # fórmula dos commits antigos (era 0.09/0.035 no 1.45m;
LIFT = 0.04           # aqui o passo é maior pro pé aparecer sob a barra)

HOVER = 0.06          # Fly: flutua um pouco acima do chão
FLY_BOB = 0.035       # 1 batida lenta/ciclo (sin puro)
FLY_PITCH_BASE = math.radians(10.0)  # inclinação pra frente NUNCA constante
FLY_PITCH_AMP = 0.06
FLY_ROLL_AMP = 0.03
FLY_CAPE_BASE = 1.05  # capa esticada pra TRÁS E PRA CIMA...
FLY_CAPE_AMP = 0.22   # ...ondulando em amplitude grande e lenta
FLY_CAPE_RIPPLE = 0.05
FLY_FOOT_X = 0.032    # pés recolhidos JUNTOS...
FLY_FOOT_Y = 0.34     # ...atrás (trás = +Y), sob a barra traseira levantada
FLY_FOOT_Z = 0.10


def clear_scene():
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.lights, bpy.data.cameras, bpy.data.images):
        for item in list(block):
            if item.users == 0:
                block.remove(item)


# ---------------------------------------------------------------------------
# materiais — só Principled BSDF com cores chapadas + Emission: o exportador
# glTF NÃO exporta nós procedurais de textura. Contraste é a alma: manto
# quase-preto absoluto vs. luz pura; NENHUMA outra cor.
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
    # #060609 e #fff2d0 convertidos sRGB -> linear (inputs do Principled são
    # lineares; colar o valor sRGB direto deixaria o manto cinza-chumbo).
    black = (0.0018, 0.0018, 0.0027)
    warm = (1.0, 0.888, 0.631)
    return {
        "cloak": make_material("CloakBlack", black, rough=0.92, metallic=0.0),
        "face": make_material("FaceLight", warm, rough=0.4, emit=warm, estr=30.0),
        "foot": make_material("FootLight", warm, rough=0.4, emit=warm, estr=15.0),
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


def add_sphere(name, radius, loc, seg=48, rings=32, scale=(1, 1, 1), mats=None, smooth=True):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=radius)
    for v in bm.verts:
        v.co.x = v.co.x * scale[0] + loc[0]
        v.co.y = v.co.y * scale[1] + loc[1]
        v.co.z = v.co.z * scale[2] + loc[2]
    return new_obj(name, bm, mats, smooth)


def _catmull(p0, p1, p2, p3, t):
    # Catmull-Rom em (r, z): perfil do manto curvo e orgânico em vez de
    # facetado (lição da princesa: lerp entre poucos controles dava degraus).
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


def make_lathe(name, rings, segments, mats=None, center_fn=None, smooth=True):
    """Superfície de revolução: lista de anéis (r, z); r<=0 vira polo.
    center_fn(z) -> (cx, cy) desloca o centro do anel (capuz caído pra frente)."""
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
            ring.append(bm.verts.new((cx + r * math.cos(a), cy + r * math.sin(a), z)))
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


def fbm(p, octaves=3, lac=2.0, gain=0.55):
    # várias oitavas de Perlin — dobra grande + vinco médio + granulado
    total, amp, freq = 0.0, 1.0, 1.0
    for _ in range(octaves):
        total += amp * noise.noise(p * freq)
        amp *= gain
        freq *= lac
    return total


# ---------------------------------------------------------------------------
# Cloak — o protagonista: manto com capuz até o chão, fechado embaixo
# ---------------------------------------------------------------------------
def _cloak_center(z):
    # capuz caído levemente pra FRENTE (-Y) — silhueta encurvada, brooding
    t = min(1.0, max(0.0, (z - 0.72) / 0.23))
    s = t * t * (3.0 - 2.0 * t)
    return 0.0, -0.035 * s


def _carve_hood_cavity(obj):
    """Escava a cavidade do capuz: verts da frente do capuz (dentro do raio
    da abertura em torno do eixo -Y) são puxados pra trás em direção ao
    fundo do bolsão. f = smoothstep^0.5 => fundo LARGO e plano com paredes
    íngremes na borda — o rosto de luz cabe dentro sem tocar as paredes."""
    mesh = obj.data
    for v in mesh.vertices:
        if v.co.y > -0.05:
            continue  # só a frente
        rho = math.hypot(v.co.x, v.co.z - CAVITY_Z)
        if rho >= CAVITY_RIM:
            continue
        t = 1.0 - rho / CAVITY_RIM
        f = (t * t * (3.0 - 2.0 * t)) ** 0.5
        v.co.y += f * max(0.0, CAVITY_DEEP_Y - v.co.y)
    mesh.update()


def _displace_cloak(obj):
    """Dobras de tecido em várias oitavas ao longo da normal (ruído esticado
    em Z = pregas verticais caindo do ombro) + barra rasgada/levantada.
    Roda DEPOIS do Subdivision aplicado: o detalhe precisa dos vértices."""
    mesh = obj.data
    data = [(v.co.copy(), v.normal.copy()) for v in mesh.vertices]
    off1 = Vector((3.1, 7.7, 1.3))
    off2 = Vector((11.2, 4.4, 9.8))
    off3 = Vector((5.5, 2.9, 8.1))
    for v, (p, n) in zip(mesh.vertices, data):
        big = 0.017 * fbm(Vector((p.x * 4.5, p.y * 4.5, p.z * 1.5)) + off1, 4)
        med = 0.006 * fbm(Vector((p.x * 12.0, p.y * 12.0, p.z * 7.0)) + off2, 3)
        fine = 0.002 * noise.noise(p * 30.0 + off3)
        # máscara: zero dentro da cavidade (rebordo limpo, sem clipar o
        # rosto), 55% no capuz (vincos mais contidos), 100% no corpo,
        # reduzida rente ao chão (contato limpo com o piso).
        cav_mask = 1.0
        if p.y < -0.02:
            rho = math.hypot(p.x, p.z - CAVITY_Z)
            cav_mask = min(1.0, max(0.0, (rho / CAVITY_RIM - 1.0) / 0.3))
        w = cav_mask * (0.55 if p.z > 0.78 else 1.0)
        w *= min(1.0, max(0.3, p.z / 0.05))
        co = p + n * ((big + med + fine) * w)
        if p.z < HEM_Z:
            r_xy = math.hypot(p.x, p.y)
            if r_xy > 0.03:
                wz = ((HEM_Z - p.z) / HEM_Z) ** 1.6
                nx, ny = p.x / r_xy, p.y / r_xy
                front = max(0.0, -ny)  # frente = -Y
                torn = 0.05 * max(0.0, fbm(Vector((nx * 2.6, ny * 2.6, 5.1)), 2))
                co.z += wz * (HEM_FRONT_LIFT * front * front + torn)
        v.co = co
    mesh.update()


def build_cloak(mats):
    rings = [(0.0, 1.10)] + densify(CLOAK_PROFILE, per_span=7) + [(0.205, 0.004), (0.0, 0.0)]
    # fundo FECHADO (os dois últimos anéis): sem fresta embaixo — nunca se
    # vê "dentro" do manto, mesmo com a barra da frente levantada.
    cloak = make_lathe("Cloak", rings, 192, [mats["cloak"]], center_fn=_cloak_center)
    _carve_hood_cavity(cloak)
    sub = cloak.modifiers.new("Subd", "SUBSURF")
    sub.levels = 1
    sub.render_levels = 1
    apply_modifier(cloak, sub)
    _displace_cloak(cloak)
    return cloak


# ---------------------------------------------------------------------------
# CapeBack — painel traseiro esvoaçante, pivô na costura dos ombros
# ---------------------------------------------------------------------------
def build_cape(mats):
    bm = bmesh.new()
    n_a, n_t = 44, 72
    grid = []
    for j in range(n_t + 1):
        t = j / n_t
        half = 0.60 + 0.38 * t              # abre em leque pra baixo
        # topo (r 0.185) ENFIADO dentro da parede do manto (ombros r~0.196
        # + dobras): a costura fica invisível; o pano emerge e cai rente ao
        # corpo, só flarando/varrendo pra trás perto da barra.
        r = 0.185 + 0.105 * (t ** 1.4)
        cy = 0.008 + 0.105 * (t ** 1.8)     # varre pra TRÁS (+Y) — vento
        row = []
        for i in range(n_a + 1):
            s = i / n_a * 2.0 - 1.0
            a = math.pi / 2 + s * half      # centrado em +Y (costas)
            # borda rasgada: o fundo varia com o ângulo via ruído
            zb = 0.065 + 0.05 * max(0.0, noise.noise(Vector((math.cos(a) * 2.1, math.sin(a) * 2.1, 3.3)))) \
                + 0.015 * math.sin(s * 7.0)
            z = CAPE_TOP_Z - t * (CAPE_TOP_Z - zb)
            # ondulação de pano congelada na malha (dobras verticais que
            # crescem pra baixo — em cima o pano está preso nos ombros)
            wob = 0.02 * math.sin(s * 9.0 + t * 5.0) * t
            wob += 0.018 * fbm(Vector((s * 3.0, t * 2.2, 1.7)), 3) * t
            rr = r + wob
            row.append(bm.verts.new((rr * math.cos(a), cy + rr * math.sin(a), z)))
        grid.append(row)
    for ra, rb in zip(grid, grid[1:]):
        for i in range(n_a):
            bm.faces.new((ra[i], ra[i + 1], rb[i + 1], rb[i]))
    cape = new_obj("CapeBack", bm, [mats["cloak"]])

    # Solidify: painel de um lado só some por trás no three.js (glTF é
    # single-sided por padrão) — casca com espessura resolve dos dois lados.
    solid = cape.modifiers.new("Solidify", "SOLIDIFY")
    solid.thickness = 0.008
    solid.offset = -1.0
    apply_modifier(cape, solid)
    sub = cape.modifiers.new("Subd", "SUBSURF")
    sub.levels = 1
    sub.render_levels = 1
    apply_modifier(cape, sub)

    # detalhe fino DEPOIS do subdiv, em direção RADIAL fixa (não ao longo da
    # normal: as duas cascas têm normais opostas e o mesmo ruído inverteria
    # a espessura, auto-intersecionando o pano).
    mesh = cape.data
    off4 = Vector((9.3, 1.8, 6.6))
    for v in mesh.vertices:
        p = v.co
        r_xy = math.hypot(p.x, p.y)
        if r_xy < 1e-6:
            continue
        d = 0.005 * fbm(Vector((p.x * 9.0, p.y * 9.0, p.z * 5.0)) + off4, 3)
        v.co.x += p.x / r_xy * d
        v.co.y += p.y / r_xy * d
    mesh.update()
    return cape


# ---------------------------------------------------------------------------
# Face e pés — PURA LUZ, nada de feições
# ---------------------------------------------------------------------------
def build_face(mats):
    # disco/blob levemente convexo flutuando dentro da cavidade do capuz —
    # menor que a abertura (raio 0.115): sobra um anel de treva ao redor
    return add_sphere("Face", 0.058, FACE_C, seg=64, rings=44,
                      scale=(1.0, 0.55, 1.12), mats=[mats["face"]])


def build_foot(name, side, mats):
    # gota: mais comprida no eixo do passo (Y), achatada no chão
    return add_sphere(name, 0.046, (side * FOOT_X, FOOT_Y, FOOT_Z),
                      seg=40, rings=28, scale=(1.0, 1.35, 0.75), mats=[mats["foot"]])


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
    visualmente. Sem isso, toda rotação da capa gira em torno da origem lá
    embaixo (pés) — um ângulo pequeno vira um arco enorme na altura da
    costura dos ombros, descolando a capa do manto. Girar em torno da
    própria costura mantém tudo preso não importa o ângulo.
    """
    cursor = bpy.context.scene.cursor
    saved = cursor.location.copy()
    cursor.location = (0.0, 0.0, z)
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
    cursor.location = saved


def set_origin_to_point(obj, co):
    # mesmo truque do set_origin_to_z, mas num ponto 3D — o pulso de escala
    # da Face precisa pulsar em torno do PRÓPRIO centro (com a origem lá
    # embaixo, escalar 1.05 teleporta o rosto ~4cm pra cima e pro lado).
    cursor = bpy.context.scene.cursor
    saved = cursor.location.copy()
    cursor.location = co
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
    cursor.location = saved


# ---------------------------------------------------------------------------
# animações "Walk" e "Fly" (helpers copiados do repo)
# ---------------------------------------------------------------------------
def _phase_points(n, count=PHASE_COUNT):
    step = n / (count - 1)
    frames = [k * step for k in range(count)]
    phis = [k * 2.0 * math.pi / (count - 1) for k in range(count)]
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


def _push_action_to_nla(obj, action, clip_name):
    # O nome da action no bpy.data.actions é único (Blender sufixa .001,
    # .002...) mas o exportador glTF agrupa por NOME DO TRACK/STRIP — usar
    # sempre "Walk"/"Fly" aqui (em vez de action.name) é o que faz os 5
    # objetos virarem UM clipe glTF por nome, com um canal por nó.
    obj.animation_data.action = None
    track = obj.animation_data.nla_tracks.new()
    track.name = clip_name
    track.strips.new(clip_name, 0, action)


def _animate(obj, clip, frames, channels):
    obj.rotation_mode = "XYZ"  # transform_apply() vira QUATERNION; sem
    # isso a keyframe em rotation_euler fica inerte (não é a rotação ativa).
    if obj.animation_data is None:
        obj.animation_data_create()
    action = bpy.data.actions.new(clip)
    obj.animation_data.action = action
    for data_path, index, values in channels:
        _set_fcurve(action, obj, data_path, index, frames, values)
    _push_action_to_nla(obj, action, clip)


def _lever_deltas(y0, z0, pitch, roll):
    """Cloak gira em torno da ORIGEM (chão); Face/CapeBack são objetos
    separados que precisam VIAJAR junto com o ponto do manto onde estão
    "presos" (lever = posição do ponto). Rotação exata em vez de aproximação
    de ângulo pequeno — no Fly o pitch de 10° move o capuz ~16cm."""
    dy = y0 * math.cos(pitch) - z0 * math.sin(pitch) - y0
    dz = y0 * math.sin(pitch) + z0 * (math.cos(pitch) - 1.0)
    dx = z0 * math.sin(roll)
    return dx, dy, dz


def add_walk(cloak, cape, face, footl, footr, cape_pivot_z):
    frames, phis = _phase_points(WALK_FRAMES)

    def pitch(p):
        return WALK_PITCH_BASE + WALK_PITCH_AMP * abs(math.sin(p + WALK_PITCH_LAG))

    def roll(p):
        return WALK_ROLL * math.sin(p)

    bob = [WALK_BOB * abs(math.sin(p)) for p in phis]

    # --- manto: bob 2 batidas + roll lateral + nod sutil (pivô no chão:
    # ângulos pequenos, o topo balança e a barra quase não sai do lugar)
    _animate(cloak, "Walk", frames, [
        ("location", 2, [cloak.location.z + b for b in bob]),
        ("rotation_euler", 0, [pitch(p) for p in phis]),
        ("rotation_euler", 1, [roll(p) for p in phis]),
    ])

    # --- capa traseira: segue a costura dos ombros (compensação de lever) +
    # vento forte: atraso de fase, roll 2x e billow frente/trás no pivô
    bx, by, bz = cape.location
    cape_dx, cape_dy = [], []
    for p in phis:
        dx, dy, _ = _lever_deltas(0.0, cape_pivot_z, pitch(p), roll(p))
        cape_dx.append(dx)
        cape_dy.append(dy)
    _animate(cape, "Walk", frames, [
        ("location", 0, [bx + d for d in cape_dx]),
        ("location", 1, [by + d for d in cape_dy]),
        ("location", 2, [bz + b for b in bob]),
        ("rotation_euler", 0, [CAPE_BILLOW_BASE + CAPE_BILLOW_AMP * abs(math.sin(p + CAPE_LAG)) for p in phis]),
        ("rotation_euler", 1, [CAPE_ROLL_AMP * math.sin(p + CAPE_LAG) for p in phis]),
    ])

    # --- rosto de luz: colado dentro do capuz (mesma compensação de lever;
    # sem ela o roll do manto esfregaria o rosto nas paredes da cavidade)
    fx, fy, fz = face.location
    fdx, fdy, fdz = [], [], []
    for p, b in zip(phis, bob):
        dx, dy, dz = _lever_deltas(fy, fz, pitch(p), roll(p))
        fdx.append(dx)
        fdy.append(dy)
        fdz.append(dz + b)
    _animate(face, "Walk", frames, [
        ("location", 0, [fx + d for d in fdx]),
        ("location", 1, [fy + d for d in fdy]),
        ("location", 2, [fz + d for d in fdz]),
    ])

    # --- pés de luz: passada REAL alternada (fórmula d96aa60/726adc3).
    # Avanço = STRIDE*cos(phi) no eixo da frente (-Y aqui, daí o sinal);
    # lift = LIFT*max(0, -s*sin(phi)): o pé SÓ levanta na metade do ciclo em
    # que avança (d/dphi do avanço > 0 ⇔ -s*sin > 0), senão arrasta no chão.
    # phase_sign oposto por pé = alternam como passada de verdade. Pés têm a
    # origem na origem do mundo (location 0): keyframe absoluto == delta.
    for foot, s in ((footl, 1.0), (footr, -1.0)):
        _animate(foot, "Walk", frames, [
            ("location", 1, [-s * STRIDE * math.cos(p) for p in phis]),
            ("location", 2, [LIFT * max(0.0, -s * math.sin(p)) for p in phis]),
        ])

    print("acoes Walk criadas:", [a.name for a in bpy.data.actions if a.name.startswith("Walk")])


def add_fly(cloak, cape, face, footl, footr, cape_pivot_z, foot_centers):
    frames, phis = _phase_points(FLY_FRAMES)

    def pitch(p):
        # oscila em torno de ~10° — NUNCA constante, senão o exportador poda
        return FLY_PITCH_BASE + FLY_PITCH_AMP * math.sin(p)

    def roll(p):
        return FLY_ROLL_AMP * math.sin(p + 2.0)

    bob = [HOVER + FLY_BOB * math.sin(p + 0.8) for p in phis]

    # --- manto: planando inclinado pra frente, subindo e descendo devagar
    _animate(cloak, "Fly", frames, [
        ("location", 2, [cloak.location.z + b for b in bob]),
        ("rotation_euler", 0, [pitch(p) for p in phis]),
        ("rotation_euler", 1, [roll(p) for p in phis]),
    ])

    # --- capa: esticada pra TRÁS E PRA CIMA, ondulando grande e lento +
    # ripple secundário (2 ondas somadas = pano vivo, não metrônomo)
    bx, by, bz = cape.location
    cape_dx, cape_dy, cape_dz = [], [], []
    for p, b in zip(phis, bob):
        dx, dy, dz = _lever_deltas(0.0, cape_pivot_z, pitch(p), roll(p))
        cape_dx.append(dx)
        cape_dy.append(dy)
        cape_dz.append(dz + b)
    _animate(cape, "Fly", frames, [
        ("location", 0, [bx + d for d in cape_dx]),
        ("location", 1, [by + d for d in cape_dy]),
        ("location", 2, [bz + d for d in cape_dz]),
        ("rotation_euler", 0, [FLY_CAPE_BASE + FLY_CAPE_AMP * math.sin(p + 0.5)
                               + FLY_CAPE_RIPPLE * math.sin(2.0 * p + 1.2) for p in phis]),
        ("rotation_euler", 1, [0.07 * math.sin(p + 1.6) for p in phis]),
    ])

    # --- rosto: viaja com o capuz inclinado + pulso sutil de escala
    # (0.97→1.05; origem no próprio centro via set_origin_to_point)
    fx, fy, fz = face.location
    fdx, fdy, fdz = [], [], []
    for p, b in zip(phis, bob):
        dx, dy, dz = _lever_deltas(fy, fz, pitch(p), roll(p))
        fdx.append(dx)
        fdy.append(dy)
        fdz.append(dz + b)
    pulse = [1.01 + 0.04 * math.sin(p) for p in phis]
    _animate(face, "Fly", frames, [
        ("location", 0, [fx + d for d in fdx]),
        ("location", 1, [fy + d for d in fdy]),
        ("location", 2, [fz + d for d in fdz]),
        ("scale", 0, pulse),
        ("scale", 1, pulse),
        ("scale", 2, pulse),
    ])

    # --- pés: recolhidos JUNTOS atrás (cauda de cometa sob a barra traseira
    # levantada pelo pitch), tremulando de leve dessincronizados
    for foot, side, offs in ((footl, -1.0, (0.0, 0.5, 1.0)), (footr, 1.0, (1.6, 2.1, 2.6))):
        c = foot_centers[foot.name]
        _animate(foot, "Fly", frames, [
            ("location", 0, [side * FLY_FOOT_X - c.x + 0.005 * math.sin(2.0 * p + offs[0]) for p in phis]),
            ("location", 1, [FLY_FOOT_Y - c.y + 0.02 * math.sin(2.0 * p + offs[1]) for p in phis]),
            ("location", 2, [FLY_FOOT_Z - c.z + 0.012 * math.sin(2.0 * p + offs[2]) for p in phis]),
        ])

    print("acoes Fly criadas:", [a.name for a in bpy.data.actions if a.name.startswith("Fly")])


def set_active_clip(objects, name):
    # os dois strips começam no frame 0 em tracks empilhados — pra RENDERIZAR
    # um clipe específico, silencia os outros tracks (o export desliga isso).
    for o in objects:
        if o.animation_data is None:
            continue
        for track in o.animation_data.nla_tracks:
            track.mute = (track.name != name)


def export_glb(objects, filepath):
    for o in objects:  # tracks mutados pelos renders não podem faltar no GLB
        if o.animation_data:
            for track in o.animation_data.nla_tracks:
                track.mute = False
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
# baixos; manto quase preto => rim light FORTE por trás pra silhueta ler)
# ---------------------------------------------------------------------------
def setup_render(samples=16):
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
    bg.inputs[0].default_value = (0.12, 0.13, 0.16, 1.0)
    bg.inputs[1].default_value = 1.0

    def sun(name, energy, rot, color=(1.0, 1.0, 1.0)):
        light = bpy.data.lights.new(name, type="SUN")
        light.energy = energy
        light.color = color
        obj = bpy.data.objects.new(name, light)
        obj.rotation_euler = rot
        bpy.context.collection.objects.link(obj)

    sun("Key", 2.5, (math.radians(55), 0.0, math.radians(35)))
    sun("Fill", 1.0, (math.radians(70), 0.0, math.radians(-50)), (0.9, 0.95, 1.0))
    # rim por trás (+Y): sem ele o manto #060609 vira um borrão preto
    sun("Rim", 6.0, (math.radians(-65), 0.0, 0.0), (1.0, 0.95, 0.85))

    floor_mat = make_material("FloorGray", (0.18, 0.18, 0.20), rough=0.9)
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


def render_to(path, res=(600, 760), frame=0, samples=None):
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
    cloak = build_cloak(mats)
    cape = build_cape(mats)
    face = build_face(mats)
    footl = build_foot("FootL", -1.0, mats)
    footr = build_foot("FootR", +1.0, mats)
    objs = [cloak, cape, face, footl, footr]

    # polycount (depois de todos os modificadores aplicados)
    total = 0
    for o in objs:
        o.data.calc_loop_triangles()
        n = len(o.data.loop_triangles)
        total += n
        print(f"tris {o.name}: {n}")
    print("TRIS_TOTAL:", total)

    make_game_ready(objs)

    # pivôs nas costuras/centros (medidos DEPOIS da normalização)
    cape_pivot_z = max(v.co.z for v in cape.data.vertices)
    set_origin_to_z(cape, cape_pivot_z)
    face_center = sum((v.co for v in face.data.vertices), Vector()) / len(face.data.vertices)
    set_origin_to_point(face, face_center)
    foot_centers = {}
    for f in (footl, footr):
        cs = [v.co.copy() for v in f.data.vertices]
        foot_centers[f.name] = Vector((
            (min(c.x for c in cs) + max(c.x for c in cs)) / 2.0,
            (min(c.y for c in cs) + max(c.y for c in cs)) / 2.0,
            (min(c.z for c in cs) + max(c.z for c in cs)) / 2.0,
        ))
    print("cape pivo z=", cape_pivot_z, "face centro=", tuple(face_center))
    print("pes centros:", {k: tuple(v) for k, v in foot_centers.items()})

    scene = bpy.context.scene
    scene.render.fps = 30
    scene.frame_start = 0
    scene.frame_end = FLY_FRAMES

    add_walk(cloak, cape, face, footl, footr, cape_pivot_z)
    add_fly(cloak, cape, face, footl, footr, cape_pivot_z, foot_centers)

    modes = set(os.environ.get("PLAYER_MODE", "views,orient").split(","))
    if "all" in modes:
        modes = {"views", "orient", "anim", "beauty", "export"}

    if "export" in modes:
        export_glb(objs, GLB_OUTPUT)
        print("EXPORTED_TO", GLB_OUTPUT)

    if modes & {"views", "orient", "anim", "beauty"}:
        cam = setup_render(samples=16)
        set_active_clip(objs, "Walk")
        if "views" in modes:
            place_cam(cam, (0.0, -1.9, 0.62), (0.0, 0.0, 0.5), lens=50)
            render_to(os.path.join(RENDER_DIR, "player-light-front.png"))
            place_cam(cam, (1.9, 0.0, 0.62), (0.0, 0.0, 0.5), lens=50)
            render_to(os.path.join(RENDER_DIR, "player-light-profile.png"))
            place_cam(cam, (-1.35, -1.45, 0.85), (0.0, 0.0, 0.48), lens=50)
            render_to(os.path.join(RENDER_DIR, "player-light-quarter.png"))
        if "orient" in modes:
            # top-down + cubo marcador em (0,-2,0.2): a cavidade do capuz e
            # a barra levantada apontam pro cubo; a CapeBack fica do lado
            # oposto = frente em -Y provada.
            marker_mat = make_material("MarkerRed", (0.9, 0.05, 0.05), rough=0.6)
            bpy.ops.mesh.primitive_cube_add(size=0.35, location=(0.0, -2.0, 0.2))
            marker = bpy.context.active_object
            marker.data.materials.append(marker_mat)
            cam.data.type = "ORTHO"
            cam.data.ortho_scale = 5.2
            cam.location = (0.0, -0.9, 6.0)
            cam.rotation_euler = (0.0, 0.0, 0.0)
            render_to(os.path.join(RENDER_DIR, "player-light-orientation.png"), res=(700, 700))
            bpy.data.objects.remove(marker, do_unlink=True)
        if "anim" in modes:
            # câmera BAIXA de 3/4: é aqui que se confere se os pés de luz
            # aparecem sob a barra ao pisar, alternando de verdade
            set_active_clip(objs, "Walk")
            place_cam(cam, (-1.0, -1.55, 0.5), (0.0, 0.0, 0.42), lens=50)
            render_to(os.path.join(RENDER_DIR, "player-light-walk-f5.png"), frame=5)
            render_to(os.path.join(RENDER_DIR, "player-light-walk-f15.png"), frame=15)
            set_active_clip(objs, "Fly")
            place_cam(cam, (1.75, -0.95, 0.8), (0.0, 0.1, 0.55), lens=50)
            render_to(os.path.join(RENDER_DIR, "player-light-fly-f8.png"), frame=8)
            render_to(os.path.join(RENDER_DIR, "player-light-fly-f22.png"), frame=22)
        if "beauty" in modes:
            set_active_clip(objs, "Walk")
            place_cam(cam, (-1.25, -1.5, 0.8), (0.0, 0.0, 0.46), lens=55)
            render_to(os.path.join(RENDER_DIR, "player-light.png"),
                      res=(880, 1080), frame=5, samples=64)

    print("DONE")


if __name__ == "__main__":
    main()
