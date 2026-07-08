"""
Hooded Sun Figure — conceito 3D procedural (Blender/bpy), testado ao vivo
via MCP no Blender 5.1.2.

Uma figura totalmente encapuzada, capa esfarrapada quase preta, sem rosto —
no lugar do rosto, uma esfera emissiva (um pequeno sol) que aparece
brilhante pra câmera mas NÃO ilumina fisicamente o resto do capuz (ray
visibility desligada pra difusão/reflexo/transmissão) — é um glow
estilizado, não iluminação realista, senão o capuz "estoura" em cinza. Pés
descalços mal aparecem sob a barra rasgada. Cena quase toda preta (world
strength baixo), fundo transparente, glow por Fog Glow no compositor.

Rodar dentro do Blender (via MCP `execute_blender_code`, em pedaços, ou como
`blender --python hooded_sun_figure.py` com uma janela/contexto disponível).

Notas de API específicas do Blender 5.1 (mudou de versões anteriores):
- `scene.node_tree` não existe mais; o compositor agora é um node group em
  `scene.compositing_node_group` (precisa de `group.interface.new_socket(...)`
  e um nó `NodeGroupOutput`, não existe mais `CompositorNodeComposite`).
- O node Glare não tem mais propriedades diretas (`glare_type`, `quality`
  etc.) — viraram sockets de input (`glare.inputs["Type"].default_value`,
  aceitando strings tipo "Fog Glow", "High").
"""
import bpy
import bmesh
import math
import random

random.seed(7)


def clear_scene():
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.lights, bpy.data.cameras):
        for item in list(block):
            if item.users == 0:
                block.remove(item)


def new_mesh_obj(name):
    mesh = bpy.data.meshes.new(name)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return obj, mesh


def make_material(name, color, emission_strength=0.0, roughness=0.9):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    if emission_strength > 0:
        bsdf.inputs["Emission Color"].default_value = (*color, 1.0)
        bsdf.inputs["Emission Strength"].default_value = emission_strength
    return mat


# ---------------------------------------------------------------- cloak ----
def build_cloak():
    obj, mesh = new_mesh_obj("Cloak")
    bm = bmesh.new()

    segments = 28
    rings = 22
    height = 1.55
    top_radius = 0.30
    bottom_radius = 0.62

    verts = [[None] * segments for _ in range(rings)]
    for r in range(rings):
        t = r / (rings - 1)
        z = height * (1 - t)
        radius = top_radius + (bottom_radius - top_radius) * (t ** 1.3)
        for s in range(segments):
            ang = 2 * math.pi * s / segments
            wrinkle = 0.02 * math.sin(ang * 5 + t * 10)
            rad = radius + wrinkle
            x = math.cos(ang) * rad
            y = math.sin(ang) * rad
            z_local = z
            if t > 0.85:
                z_local -= random.uniform(0.0, 0.05) * ((t - 0.85) / 0.15)
            verts[r][s] = bm.verts.new((x, y, z_local))
    bm.verts.ensure_lookup_table()

    faces_grid = [[None] * segments for _ in range(rings - 1)]
    for r in range(rings - 1):
        for s in range(segments):
            s2 = (s + 1) % segments
            v1, v2 = verts[r][s], verts[r][s2]
            v3, v4 = verts[r + 1][s2], verts[r + 1][s]
            faces_grid[r][s] = bm.faces.new((v1, v2, v3, v4))

    # cobertura no topo (ombros, escondidos sob o capuz)
    top_center = bm.verts.new((0, 0, height))
    for s in range(segments):
        s2 = (s + 1) % segments
        bm.faces.new((verts[0][s2], verts[0][s], top_center))
    bm.normal_update()

    # barra esfarrapada: alterna "línguas" de pano mais compridas
    bottom_band = faces_grid[rings - 2]
    tongues = [bottom_band[s] for s in range(segments) if s % 2 == 0]
    result = bmesh.ops.extrude_face_region(bm, geom=tongues)
    extruded_verts = [g for g in result["geom"] if isinstance(g, bmesh.types.BMVert)]
    for v in extruded_verts:
        v.co.z -= random.uniform(0.10, 0.26)
        v.co.x *= 0.90
        v.co.y *= 0.90
    bm.normal_update()

    bm.to_mesh(mesh)
    bm.free()
    mesh.polygons.foreach_set("use_smooth", [True] * len(mesh.polygons))

    mat = make_material("CloakFabric", (0.015, 0.012, 0.010), roughness=0.85)
    obj.data.materials.append(mat)
    return obj


# ----------------------------------------------------------------- hood ----
def build_hood(shoulder_z=1.55):
    obj, mesh = new_mesh_obj("Hood")
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=16, radius=0.42)
    bmesh.ops.scale(bm, verts=bm.verts, vec=(1.05, 0.95, 1.20))

    center_z = shoulder_z + 0.06
    center_y = 0.05

    def is_open_bottom(face):
        z = face.calc_center_median().z
        return z < -0.28

    def is_face_opening(face):
        c = face.calc_center_median()
        facing_front = c.y < -0.08          # frente do capuz (rosto) aponta para -Y
        lower_middle = -0.02 < c.z < 0.34
        return facing_front and lower_middle

    to_delete = [f for f in bm.faces if is_open_bottom(f) or is_face_opening(f)]
    bmesh.ops.delete(bm, geom=to_delete, context="FACES")

    for v in bm.verts:
        v.co.z += center_z
        v.co.y += center_y
        v.co.x += random.uniform(-0.004, 0.004)

    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()
    mesh.polygons.foreach_set("use_smooth", [True] * len(mesh.polygons))

    mat = make_material("HoodFabric", (0.012, 0.010, 0.009), roughness=0.85)
    obj.data.materials.append(mat)
    return obj


# ------------------------------------------------------------ rosto-sol ----
def build_sun_face(shoulder_z=1.55):
    obj, mesh = new_mesh_obj("SunFace")
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=20, v_segments=14, radius=0.115)
    center = (0.0, -0.20, shoulder_z + 0.14)
    for v in bm.verts:
        v.co.x += center[0]
        v.co.y += center[1]
        v.co.z += center[2]
    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()

    mat = make_material("SunGlow", (1.0, 0.80, 0.42), emission_strength=40.0, roughness=0.3)
    obj.data.materials.append(mat)

    # Só aparece pra câmera - não ilumina fisicamente o capuz (senão o
    # tecido ao redor "estoura" em cinza por causa do bounce de luz real).
    obj.visible_diffuse = False
    obj.visible_glossy = False
    obj.visible_transmission = False
    obj.visible_volume_scatter = False
    return obj


# ------------------------------------------------------------------ pés ----
def build_feet(ground_z=0.0):
    mat = make_material("Skin", (0.42, 0.27, 0.18), roughness=0.6)
    for side, x in (("L", -0.10), ("R", 0.10)):
        obj, mesh = new_mesh_obj(f"Foot_{side}")
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.scale(bm, verts=bm.verts, vec=(0.055, 0.14, 0.045))
        bm.normal_update()
        bm.to_mesh(mesh)
        bm.free()
        obj.location = (x, -0.18, ground_z + 0.045)
        obj.data.materials.append(mat)


# ------------------------------------------------------- câmera & mundo ----
def setup_camera_and_world():
    cam_data = bpy.data.cameras.new("Camera")
    cam_data.lens = 28
    cam_obj = bpy.data.objects.new("Camera", cam_data)
    cam_obj.location = (0.0, -2.6, 0.95)
    cam_obj.rotation_euler = (math.radians(90), 0, 0)
    bpy.context.collection.objects.link(cam_obj)
    bpy.context.scene.camera = cam_obj

    world = bpy.data.worlds.get("World") or bpy.data.worlds.new("World")
    bpy.context.scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = (0.0, 0.0, 0.0, 1.0)
    bg.inputs["Strength"].default_value = 0.03


def setup_render(filepath):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 64
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
    glare.inputs["Highlights Threshold"].default_value = 0.9
    glare.inputs["Strength"].default_value = 1.2
    out = tree.nodes.new("NodeGroupOutput")
    tree.links.new(rl.outputs["Image"], glare.inputs["Image"])
    tree.links.new(glare.outputs["Image"], out.inputs["Image"])

    scene.render.filepath = filepath
    bpy.ops.render.render(write_still=True)


def main():
    clear_scene()
    build_cloak()
    build_hood()
    build_sun_face()
    build_feet()
    setup_camera_and_world()
    setup_render("/home/teuzothedev/work/world-light/blender/renders/hooded-sun-figure.png")


if __name__ == "__main__":
    main()
