"""
O SÁBIO ("Sage") — NPC do world-light, 100% autoral e procedural.

Figura alta (1.8 vs 1.45 do jogador), magra e levemente curvada: túnica
cinza-azulada até o chão com orlas emissivas douradas ("runas de luz"),
cabeça careca de testa alta, cabelo e barba brancos, olhos = pontos
emissivos fundos, cajado retorcido mais alto que ele com um orbe dourado
flutuando na ponta.

Roda 100% headless (sem addon MCP, sem GUI):
  blender --background --python blender/sage.py

Env:
  SAGE_BEAUTY=1     -> também renderiza o beleza (64 samples) em renders/sage.png
  SAGE_NO_RENDER=1  -> só constrói + exporta (iteração rápida de geometria)

Padrões copiados de export_game_character.py (lições aprendidas lá):
- transform_apply com seleção ISOLADA por objeto (sem isso só o 1º aplica);
- pivô de partes separadas na costura com o corpo (set_origin_*);
- actions em camadas do Blender 5.x via fcurve_ensure_for_datablock;
- NLA track/strip com o MESMO nome ("Idle") = um único clipe glTF;
- keyframes de location são ABSOLUTOS (somar a base do objeto);
- nenhuma fcurve constante (o exportador PODA curvas 0->0).
"""
import bpy
import bmesh
import math
import os

from mathutils import Euler, Matrix, Vector, noise

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(SCRIPT_DIR)

GLB_OUTPUT = os.path.join(REPO_ROOT, "public", "models", "sage.glb")
RENDER_DIR = os.path.join(SCRIPT_DIR, "renders")

# Altura do SÁBIO (topo da cabeça). O cajado e o orbe passam da cabeça de
# propósito ("mais alto que ele") — escalar pelo bbox TOTAL encolheria o
# personagem pra ~1.55 e mataria a leitura "mais alto que o jogador (1.45)".
TARGET_HEIGHT = 1.8

DO_BEAUTY = os.environ.get("SAGE_BEAUTY") == "1"
NO_RENDER = os.environ.get("SAGE_NO_RENDER") == "1"

TAU = 2.0 * math.pi

# ---------------------------------------------------------------- materiais
# Só cores chapadas + Emission: o exportador glTF não exporta nós de textura
# procedural, então todo o "detalhe" fica na silhueta/geometria.


def make_material(name, color, roughness=0.75, metallic=0.0, emission=None, strength=0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if emission is not None:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1.0)
        bsdf.inputs["Emission Strength"].default_value = strength
    return mat


def clear_scene():
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.lights, bpy.data.cameras, bpy.data.images):
        for item in list(block):
            if item.users == 0:
                block.remove(item)


def _smooth(mesh):
    mesh.polygons.foreach_set("use_smooth", [True] * len(mesh.polygons))
    mesh.update()


def _new_object(name, bm, mats):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(name)
    for m in mats:
        mesh.materials.append(m)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    _smooth(mesh)
    return obj


def lathe_object(name, profile, mats, bands=(), steps=48, angle=TAU, cent=(0.0, 0.0),
                 start_az=0.0, weld=0.0025):
    """Perfil (raio, z) girado em torno do eixo Z em `cent` — o jeito mais
    controlável de fazer túnica/mangas/cajado E de pintar anéis emissivos:
    `bands` = [(zmin, zmax, material_index)] atribuídos por altura do centro
    da face, ANTES de qualquer deformação — anel dourado perfeito, sem torus
    solto tentando adivinhar o raio pós-subsurf."""
    bm = bmesh.new()
    ca, sa = math.cos(start_az), math.sin(start_az)
    prev = None
    for r, z in profile:
        v = bm.verts.new((cent[0] + r * ca, cent[1] + r * sa, z))
        if prev is not None:
            bm.edges.new((prev, v))
        prev = v
    bmesh.ops.spin(bm, geom=bm.verts[:] + bm.edges[:], cent=(cent[0], cent[1], 0.0),
                   axis=(0.0, 0.0, 1.0), angle=angle, steps=steps,
                   use_merge=False, use_duplicate=False)
    if weld:
        # solda a emenda do giro completo E colapsa os anéis-tampa (r~0.0005)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=weld)
    for f in bm.faces:
        cz = f.calc_center_median().z
        f.material_index = 0
        for zmin, zmax, idx in bands:
            if zmin <= cz <= zmax:
                f.material_index = idx
    return bm, _new_object_deferred(name, mats)


def _new_object_deferred(name, mats):
    # pequena fábrica pra manter lathe_object legível (bm ainda editável fora)
    def finish(bm):
        return _new_object(name, bm, mats)
    return finish


def sphere_object(name, mats, u, v, radius, loc, scale=(1.0, 1.0, 1.0), rot=(0.0, 0.0, 0.0)):
    bm = bmesh.new()
    mtx = Matrix.LocRotScale(Vector(loc), Euler(rot), Vector(scale))
    bmesh.ops.create_uvsphere(bm, u_segments=u, v_segments=v, radius=radius, matrix=mtx)
    return _new_object(name, bm, mats)


def cube_object(name, mats, size, loc, scale, rot=(0.0, 0.0, 0.0)):
    bm = bmesh.new()
    mtx = Matrix.LocRotScale(Vector(loc), Euler(rot), Vector(scale))
    bmesh.ops.create_cube(bm, size=size, matrix=mtx)
    return _new_object(name, bm, mats)


def apply_modifiers(obj):
    # mesma pegadinha do transform_apply: modifier_apply opera no ativo,
    # então isola a seleção antes.
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    for mod in list(obj.modifiers):
        bpy.ops.object.modifier_apply(modifier=mod.name)


def add_subsurf(obj, levels):
    mod = obj.modifiers.new("Subsurf", "SUBSURF")
    mod.levels = levels
    mod.render_levels = levels
    apply_modifiers(obj)


def join_into(target, parts):
    bpy.ops.object.select_all(action="DESELECT")
    for p in parts:
        p.select_set(True)
    target.select_set(True)
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.join()


# ------------------------------------------------------------- construção
# Tudo modelado JÁ na escala final (~1.8 de altura) e JÁ olhando pra -Y
# (nariz/barba no lado -Y): o conversor Z-up -> Y-up do glTF faz -Y virar
# +Z, e o Player/NPC do jogo assume rotation.y=0 olhando +Z. Modelar certo
# de origem evita o FORWARD_ROTATION_Z que o hooded-figure precisou.

HEAD_C = Vector((0.0, -0.11, 1.66))   # cabeça projetada à frente (postura de idade)
STAFF_BASE = (0.30, -0.08)            # eixo do cajado, junto ao corpo
STAFF_TOP = 1.95
GRIP_Z = 1.03                          # altura da mão que segura o cajado
CHIN_PIVOT = Vector((0.0, -0.18, 1.61))


def staff_wobble(z):
    """Desvio do eixo do cajado por altura — madeira retorcida de verdade
    (o eixo serpenteia), não só ruído de superfície."""
    return (0.014 * math.sin(z * 4.1), 0.012 * math.sin(z * 3.3 + 1.7))


def build_body(mats):
    m_robe, m_gold, m_skin, m_hair, m_dark, m_eye = mats

    # --- túnica: lathe com 2 orlas douradas na barra (linhas de faces viram
    # anéis finos e perfeitos porque o material segue a malha no subsurf)
    profile = [
        (0.0005, 0.000),
        (0.300, 0.000),
        (0.300, 0.025),
        (0.297, 0.055),   # faces 0.025-0.055 -> ouro (orla 1)
        (0.290, 0.085),
        (0.285, 0.105),   # faces 0.085-0.105 -> ouro (orla 2)
        (0.272, 0.150),
        (0.240, 0.300),
        (0.210, 0.500),
        (0.185, 0.700),
        (0.160, 0.880),
        (0.148, 1.000),
        (0.150, 1.120),
        (0.168, 1.260),
        (0.182, 1.380),
        (0.180, 1.440),
        (0.150, 1.490),
        (0.095, 1.525),
        (0.060, 1.555),
        (0.055, 1.600),
    ]
    bm, finish = lathe_object("Sage", profile, [m_robe, m_gold],
                              bands=[(0.025, 0.055, 1), (0.085, 0.105, 1)], steps=80)
    for v in bm.verts:
        # dobras de tecido na barra (ondulação radial que morre na cintura)
        if v.co.z < 0.6:
            az = math.atan2(v.co.y, v.co.x)
            amp = 0.012 * (1.0 - v.co.z / 0.6)
            r = math.hypot(v.co.x, v.co.y)
            if r > 0.01:
                r += math.sin(az * 9.0) * amp
                v.co.x = r * math.cos(az)
                v.co.y = r * math.sin(az)
        # corcunda: acima da cintura o tronco verga pra frente (-Y)
        if v.co.z > 0.95:
            v.co.y -= (v.co.z - 0.95) ** 2 * 0.34
    robe = finish(bm)
    add_subsurf(robe, 2)

    parts = []

    # --- cabeça careca de testa alta (esfera alongada em Z)
    head = sphere_object("Head", [m_skin], 28, 18, 0.115, HEAD_C, scale=(1.0, 0.94, 1.18))
    add_subsurf(head, 1)
    parts.append(head)

    # --- rosto: nariz + cavidades escuras + pontos de luz (olhos)
    face_y = HEAD_C.y - 0.108
    parts.append(sphere_object("Nose", [m_skin], 12, 8, 1.0,
                               (0.0, face_y - 0.008, 1.632), scale=(0.014, 0.020, 0.024)))
    for sx in (-1.0, 1.0):
        # pastilha escura = cavidade; ponto emissivo pequeno e quase rente a
        # ela (olho "fundo" que brilha sob a sombra da sobrancelha)
        parts.append(sphere_object("Socket", [m_dark], 12, 8, 1.0,
                                   (sx * 0.045, face_y + 0.004, 1.650),
                                   scale=(0.025, 0.012, 0.021)))
        parts.append(sphere_object("Eye", [m_eye], 12, 8, 0.008,
                                   (sx * 0.045, face_y - 0.004, 1.650)))
        brow = cube_object("Brow", [m_hair], 1.0,
                           (sx * 0.048, face_y + 0.002, 1.681),
                           scale=(0.034, 0.014, 0.011),
                           rot=(math.radians(10), 0.0, sx * math.radians(-14)))
        add_subsurf(brow, 2)
        parts.append(brow)

    # --- cabelo: cortina lateral/traseira (spin parcial deixando o rosto
    # aberto), com ondulação radial pra sugerir mechas + solidify
    hair_profile = [
        (0.100, 1.730),
        (0.118, 1.660),
        (0.128, 1.580),
        (0.138, 1.500),
        (0.152, 1.420),
    ]
    bm, finish = lathe_object("HairShell", hair_profile, [m_hair],
                              steps=40, angle=math.radians(250),
                              cent=(HEAD_C.x, HEAD_C.y),
                              start_az=math.radians(325), weld=0.0)
    for v in bm.verts:
        az = math.atan2(v.co.y - HEAD_C.y, v.co.x - HEAD_C.x)
        r = math.hypot(v.co.x - HEAD_C.x, v.co.y - HEAD_C.y)
        r += math.sin(az * 16.0) * 0.005
        v.co.x = HEAD_C.x + r * math.cos(az)
        v.co.y = HEAD_C.y + r * math.sin(az)
    hair = finish(bm)
    sol = hair.modifiers.new("Solidify", "SOLIDIFY")
    sol.thickness = 0.018
    apply_modifiers(hair)
    add_subsurf(hair, 1)
    parts.append(hair)

    # --- mechas longas caindo nas costas/ombros (a cortina para nos ombros;
    # estas descem por cima da túnica)
    strands = [
        ((0.00, 0.085, 1.27), (0.035, 0.022, 0.145), (math.radians(-22), 0.0, 0.0)),
        ((-0.062, 0.070, 1.29), (0.030, 0.020, 0.135), (math.radians(-20), 0.0, math.radians(8))),
        ((0.062, 0.070, 1.29), (0.030, 0.020, 0.135), (math.radians(-20), 0.0, math.radians(-8))),
        ((-0.150, -0.050, 1.31), (0.022, 0.042, 0.140), (0.0, math.radians(6), 0.0)),
        ((0.150, -0.050, 1.31), (0.022, 0.042, 0.140), (0.0, math.radians(-6), 0.0)),
    ]
    for i, (loc, scale, rot) in enumerate(strands):
        s = sphere_object(f"Strand{i}", [m_hair], 14, 10, 1.0, loc, scale=scale, rot=rot)
        add_subsurf(s, 1)
        parts.append(s)

    # --- mangas largas (lathe local em +Z, orla dourada perto do punho,
    # depois rotacionado do ombro pro punho)
    def sleeve(name, shoulder, cuff):
        shoulder = Vector(shoulder)
        cuff = Vector(cuff)
        axis = cuff - shoulder
        length = axis.length
        prof = [
            (0.0005, 0.00 * length),
            (0.055, 0.00 * length),
            (0.050, 0.30 * length),
            (0.058, 0.55 * length),
            (0.068, 0.75 * length),
            (0.079, 0.860 * length),
            (0.083, 0.905 * length),  # faces 0.86L-0.905L -> ouro (punho)
            (0.088, 0.970 * length),
            (0.088, 1.000 * length),
            (0.064, 1.000 * length),
            (0.060, 0.900 * length),
        ]
        bm, finish = lathe_object(name, prof, [m_robe, m_gold],
                                  bands=[(0.860 * length, 0.905 * length, 1)], steps=32)
        mtx = Matrix.LocRotScale(shoulder, axis.normalized().to_track_quat("Z", "Y"), None)
        bmesh.ops.transform(bm, matrix=mtx, verts=bm.verts[:])
        obj = finish(bm)
        add_subsurf(obj, 1)
        return obj

    wx, wy = staff_wobble(GRIP_Z)
    grip = Vector((STAFF_BASE[0] + wx, STAFF_BASE[1] + wy, GRIP_Z))
    parts.append(sleeve("SleeveR", (0.16, -0.05, 1.43), (0.27, -0.095, 1.09)))
    parts.append(sleeve("SleeveL", (-0.16, -0.05, 1.43), (-0.225, -0.10, 1.04)))

    # --- mãos: a direita envolve o cajado (esfera esculpida = punho fechado)
    hand_r = sphere_object("HandR", [m_skin], 16, 12, 0.048,
                           (grip.x, grip.y, grip.z), scale=(1.05, 1.05, 1.35))
    add_subsurf(hand_r, 1)
    parts.append(hand_r)
    hand_l = sphere_object("HandL", [m_skin], 16, 12, 0.042,
                           (-0.235, -0.105, 1.00), scale=(1.0, 1.0, 1.35))
    add_subsurf(hand_l, 1)
    parts.append(hand_l)

    join_into(robe, parts)
    robe.name = "Sage"
    return robe


def build_beard(mats):
    m_hair = mats
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=28, v_segments=18, radius=1.0)
    seed = Vector((7.3, 1.9, 4.2))
    for v in bm.verts:
        x, y, z = v.co
        t = (z + 1.0) * 0.5           # 0 = ponta de baixo, 1 = queixo
        w = 0.35 + 0.65 * t ** 0.7    # afunila pra baixo (gota de ponta fina)
        v.co.x = x * 0.115 * w
        v.co.y = y * 0.075 * w
        v.co.z = z * 0.260
        # a ponta DRAPEJA pra frente por cima do peito — sem isso a metade de
        # baixo (afinada pelo taper) some DENTRO da túnica estufada e a barba
        # vira uma "máscara" flutuando na boca (visto no render da rodada 2)
        v.co.y -= (1.0 - t) ** 1.2 * 0.055
        # sulcos verticais + ruído = "mechas" que sobrevivem à cor chapada
        az = math.atan2(y, x)
        groove = 1.0 + 0.06 * math.sin(az * 9.0)
        n = noise.noise(Vector((x * 5.0, y * 5.0, z * 3.0)) + seed)
        v.co.x *= groove * (1.0 + 0.12 * n)
        v.co.y *= groove * (1.0 + 0.09 * n)
    bmesh.ops.translate(bm, verts=bm.verts[:], vec=(0.0, -0.19, 1.40))
    # bigode: dois rolinhos caindo de sob o nariz, pontas pra baixo
    for sx in (-1.0, 1.0):
        mtx = Matrix.LocRotScale(Vector((sx * 0.032, -0.232, 1.603)),
                                 Euler((0.0, sx * math.radians(15), sx * math.radians(25))),
                                 Vector((0.042, 0.015, 0.012)))
        bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=1.0, matrix=mtx)
    beard = _new_object("Beard", bm, [m_hair])
    add_subsurf(beard, 2)
    return beard


def build_staff(mats):
    m_wood = mats
    profile = [(0.0005, 0.0), (0.024, 0.0)]
    z = 0.10
    while z < 1.78:
        profile.append((0.023 - 0.008 * (z / 1.95), z))
        z += 0.09
    profile += [(0.020, 1.84), (0.026, 1.89), (0.024, 1.92), (0.012, STAFF_TOP), (0.0005, STAFF_TOP)]
    bm, finish = lathe_object("Staff", profile, [m_wood], steps=12, cent=STAFF_BASE)
    for v in bm.verts:
        dx = v.co.x - STAFF_BASE[0]
        dy = v.co.y - STAFF_BASE[1]
        az = math.atan2(dy, dx)
        # cristas em espiral (o "retorcido" que sobrevive à cor chapada)
        ridge = 1.0 + 0.10 * math.sin(3.0 * az + v.co.z * 4.0)
        n = noise.noise(Vector((v.co.x * 8.0, v.co.y * 8.0, v.co.z * 2.5)))
        gnarl = 1.0 + 0.18 * n
        v.co.x = STAFF_BASE[0] + dx * ridge * gnarl
        v.co.y = STAFF_BASE[1] + dy * ridge * gnarl
        wx, wy = staff_wobble(v.co.z)
        v.co.x += wx
        v.co.y += wy
    staff = finish(bm)
    add_subsurf(staff, 2)
    return staff


def build_orb(mats):
    m_orb = mats
    wx, wy = staff_wobble(STAFF_TOP)
    center = (STAFF_BASE[0] + wx, STAFF_BASE[1] + wy, STAFF_TOP + 0.085)
    return sphere_object("Orb", [m_orb], 48, 24, 0.055, center)


# ------------------------------------------------------------- game-ready

def make_game_ready(objects, height_ref):
    """Ponto mais baixo de TODOS os objetos em Z=0, mas a ESCALA vem da
    altura do corpo (height_ref): cajado/orbe passam da cabeça de propósito.
    Objetos ainda em location/scale identidade neste ponto — calcular a
    translação ANTES de escalar dava pés fora do lugar (a escala se aplica
    sobre as coordenadas locais antes da translação)."""
    all_z = [v.co.z for o in objects for v in o.data.vertices]
    min_z = min(all_z)
    ref_max = max(v.co.z for v in height_ref.data.vertices)
    height = ref_max - min_z
    scale = TARGET_HEIGHT / height
    z_offset = -scale * min_z

    for o in objects:
        o.scale = (scale, scale, scale)
        o.location = (0.0, 0.0, z_offset)
        # frente já modelada em -Y: nenhuma rotação de correção necessária
        # (o conversor Z-up -> Y-up do glTF faz -Y virar o +Z que o jogo
        # assume em rotation.y=0).
        o.rotation_euler = (0.0, 0.0, 0.0)
        # transform_apply() opera nos objetos SELECIONADOS, não no "ativo" —
        # sem isolar a seleção aqui, só o 1º objeto do loop era realmente
        # aplicado (os outros ficavam com o transform "pendurado", não
        # assado na malha, e a exportação glTF saía com posições erradas).
        bpy.ops.object.select_all(action="DESELECT")
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    print("escala aplicada:", scale, "| corpo até z=", ref_max * scale + z_offset)
    return scale


def set_origin_to_point(obj, point):
    """Igual ao set_origin_to_z do export_game_character.py, mas com o pivô
    num PONTO 3D completo: barba/cajado/orbe não estão no eixo x=0 — girar
    ou ESCALAR em torno de (0,0,z) arrastaria o objeto de lado (pior no
    pulso de escala do orbe, que multiplicaria o offset x inteiro)."""
    cursor = bpy.context.scene.cursor
    saved = cursor.location.copy()
    cursor.location = point
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
    cursor.location = saved


# -------------------------------------------------------------- animação

IDLE_CYCLE_FRAMES = 40  # ciclo lento e contemplativo (40f @ 30fps)
BREATH_BOB = 0.012
BODY_ROCK = 0.008       # rad — balanço quase imperceptível, pivô nos pés
BEARD_PHASE_LAG = 0.35  # rad — follow-through de "tecido"/pelo solto
BEARD_SWAY = 0.03       # rad — nod da barba em torno do queixo
STAFF_PHASE_LAG = 0.5
STAFF_SWAY = math.radians(1.0)
ORB_PHASE_LAG = 0.8
ORB_BOB = 0.03
ORB_PULSE = 0.08        # escala 0.92 -> 1.08


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


def _push_action_to_nla(obj, action, clip_name="Idle"):
    # O nome da action no bpy.data.actions é único (Blender sufixa .001,
    # .002...) mas o exportador glTF agrupa por NOME DO TRACK/STRIP — usar
    # sempre "Idle" aqui (em vez de action.name) é o que faz os objetos
    # virarem UM clipe glTF só, com um canal por nó.
    obj.animation_data.action = None
    track = obj.animation_data.nla_tracks.new()
    track.name = clip_name
    track.strips.new(clip_name, 0, action)


def add_idle_cycle(body, beard, staff, orb, fps=30):
    """Um único clipe "Idle": respiração + balanço mínimo do corpo, barba
    com atraso de fase (follow-through), cajado oscilando ~1° e orbe com bob
    e PULSO de escala próprios. Nenhuma fcurve constante — o exportador
    glTF poda curvas que não variam e descartaria o clipe."""
    bpy.context.scene.render.fps = fps
    frames, phis = _phase_points(IDLE_CYCLE_FRAMES)

    def animate(obj, bob_vals=None, rock_vals=None, scale_vals=None):
        obj.rotation_mode = "XYZ"  # transform_apply() vira QUATERNION; sem
        # isso a keyframe em rotation_euler fica inerte (não é a rotação ativa).
        obj.animation_data_create()
        action = bpy.data.actions.new("Idle")
        obj.animation_data.action = action
        # base_z != 0 pra quem passou por set_origin_to_point — keyframe em
        # "location" grava o valor ABSOLUTO, não um delta; sem somar a base o
        # objeto "teletransportaria" pra origem.
        base_z = obj.location.z
        if bob_vals is not None:
            _set_fcurve(action, obj, "location", 2, frames, [base_z + v for v in bob_vals])
        if rock_vals is not None:
            _set_fcurve(action, obj, "rotation_euler", 0, frames, rock_vals)
        if scale_vals is not None:
            for idx in (0, 1, 2):
                _set_fcurve(action, obj, "scale", idx, frames, scale_vals)
        _push_action_to_nla(obj, action)

    # corpo: respiração (pivô nos pés mantém a barra no chão)
    animate(body,
            bob_vals=[math.sin(p) * BREATH_BOB for p in phis],
            rock_vals=[math.sin(p) * BODY_ROCK for p in phis])

    # barba: MESMO bob do corpo (fecha a costura com o rosto — translação não
    # se importa com pivô), rotação atrasada e maior em torno do queixo.
    animate(beard,
            bob_vals=[math.sin(p) * BREATH_BOB for p in phis],
            rock_vals=[math.sin(p + BEARD_PHASE_LAG) * BEARD_SWAY for p in phis])

    # cajado: fica PLANTADO no chão (sem bob — a mão desliza nele, como na
    # vida real), só oscila ~1° em torno do punho.
    animate(staff,
            rock_vals=[math.sin(p + STAFF_PHASE_LAG) * STAFF_SWAY for p in phis])

    # orbe: flutuação própria + pulso de escala 0.92->1.08 (a "luz" respira)
    animate(orb,
            bob_vals=[math.sin(p + ORB_PHASE_LAG) * ORB_BOB for p in phis],
            scale_vals=[1.0 + ORB_PULSE * math.sin(p) for p in phis])

    print("acoes criadas:", [a.name for a in bpy.data.actions])


def count_tris(objects):
    total = 0
    for o in objects:
        o.data.calc_loop_triangles()
        n = len(o.data.loop_triangles)
        print(f"  tris {o.name}: {n}")
        total += n
    print("TOTAL_TRIS", total)
    return total


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


# ---------------------------------------------------------------- renders

def _look_at(cam, loc, target):
    cam.location = Vector(loc)
    cam.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()


def render_suite():
    scene = bpy.context.scene
    world = bpy.data.worlds.new("Studio")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (0.20, 0.21, 0.23, 1.0)
    bg.inputs[1].default_value = 1.0
    scene.world = world

    # 3 sóis simples, mesmo espírito do debug_hood_nod.py: key frontal,
    # fill fraco do outro lado, rim por trás pra recortar a silhueta branca
    for name, rot, energy in (("Key", (50, 0, 30), 3.0),
                              ("Fill", (60, 0, -55), 1.1),
                              ("Rim", (-55, 0, 180), 1.8)):
        li = bpy.data.lights.new(name, type="SUN")
        li.energy = energy
        lo = bpy.data.objects.new(name, li)
        lo.rotation_euler = tuple(math.radians(a) for a in rot)
        bpy.context.collection.objects.link(lo)

    cam_data = bpy.data.cameras.new("Camera")
    cam_data.lens = 45
    cam = bpy.data.objects.new("Camera", cam_data)
    bpy.context.collection.objects.link(cam)
    scene.camera = cam

    # marcador de orientação em (0,-2,0.2): a frente TEM que apontar pra ele
    marker = cube_object("Marker", [make_material("Marker", (0.8, 0.05, 0.05))],
                         0.3, (0.0, -2.0, 0.15), (1.0, 1.0, 1.0))
    marker.hide_render = True

    scene.render.engine = "CYCLES"
    scene.cycles.samples = 20
    scene.render.film_transparent = False

    def shot(path, loc, target, frame=0, res=(620, 820), samples=20, lens=45):
        scene.frame_set(frame)
        cam_data.lens = lens
        scene.cycles.samples = samples
        scene.render.resolution_x, scene.render.resolution_y = res
        _look_at(cam, loc, target)
        scene.render.filepath = os.path.join(RENDER_DIR, path)
        bpy.ops.render.render(write_still=True)
        print("rendered", path)

    shot("sage-front.png", (0.0, -3.6, 1.15), (0.0, 0.0, 1.02))
    shot("sage-profile.png", (3.6, 0.0, 1.15), (0.0, 0.0, 1.02))
    shot("sage-quarter.png", (2.5, -2.6, 1.6), (0.0, 0.0, 1.0))

    marker.hide_render = False
    shot("sage-orientation.png", (0.0, -0.9, 5.4), (0.0, -0.9, 0.0), res=(620, 620), lens=35)
    marker.hide_render = True

    shot("sage-idle-f10.png", (2.5, -2.6, 1.6), (0.0, 0.0, 1.0), frame=10)
    shot("sage-idle-f30.png", (2.5, -2.6, 1.6), (0.0, 0.0, 1.0), frame=30)

    if DO_BEAUTY:
        shot("sage.png", (2.3, -2.9, 1.45), (0.0, -0.02, 1.02),
             frame=10, res=(820, 1080), samples=64, lens=50)


def main():
    clear_scene()

    m_robe = make_material("Robe", (0.33, 0.38, 0.47), roughness=0.85)
    m_gold = make_material("GoldTrim", (0.80, 0.55, 0.15), roughness=0.4,
                           emission=(1.0, 0.62, 0.15), strength=3.0)
    m_skin = make_material("Skin", (0.72, 0.53, 0.40), roughness=0.7)
    m_hair = make_material("Hair", (0.88, 0.87, 0.84), roughness=0.9)
    m_dark = make_material("Socket", (0.02, 0.015, 0.012), roughness=0.9)
    m_eye = make_material("EyeGlow", (1.0, 0.9, 0.6),
                          emission=(1.0, 0.88, 0.55), strength=8.0)
    m_wood = make_material("Wood", (0.055, 0.032, 0.018), roughness=0.8)
    m_orb = make_material("OrbGlow", (1.0, 0.8, 0.4),
                          emission=(1.0, 0.62, 0.18), strength=15.0)

    body = build_body((m_robe, m_gold, m_skin, m_hair, m_dark, m_eye))
    beard = build_beard(m_hair)
    staff = build_staff(m_wood)
    orb = build_orb(m_orb)
    objects = [body, beard, staff, orb]

    scale = make_game_ready(objects, height_ref=body)

    # pivôs nas costuras (rotacionar em torno da origem lá nos pés abriria
    # um vão enorme na emenda — mesmo problema do capuz do hooded-figure)
    set_origin_to_point(beard, Vector(CHIN_PIVOT) * scale)
    wx, wy = staff_wobble(GRIP_Z)
    set_origin_to_point(staff, Vector((STAFF_BASE[0] + wx, STAFF_BASE[1] + wy, GRIP_Z)) * scale)
    # orbe: pivô no próprio centro (escala pulsa em volta de si mesmo)
    orb_center = sum((v.co for v in orb.data.vertices), Vector()) / len(orb.data.vertices)
    set_origin_to_point(orb, orb_center)

    add_idle_cycle(body, beard, staff, orb)
    count_tris(objects)

    for o in objects:
        zs = [v.co.z for v in o.data.vertices]
        print(f"  bounds {o.name}: z {min(zs):.3f} .. {max(zs):.3f}")

    export_glb(objects, GLB_OUTPUT)
    print("EXPORTED_TO", GLB_OUTPUT)

    if not NO_RENDER:
        render_suite()
    print("DONE")


if __name__ == "__main__":
    main()
