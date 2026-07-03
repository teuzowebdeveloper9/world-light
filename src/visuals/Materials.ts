/**
 * Geometrias e materiais compartilhados — construídos UMA vez e reutilizados
 * por todos os chunks. O vento é uma uniform global única (`windTimeUniform`)
 * compartilhada por todos os shaders: um único update por frame move o mundo todo.
 */
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { mulberry32 } from '../world/noise'

/** Uniform global de tempo do vento — atualizada uma única vez por frame no World. */
export const windTimeUniform: { value: number } = { value: 0 }

/** mergeGeometries exige indexação consistente — normaliza para não-indexado. */
function nonIndexed(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  if (!geo.index) return geo
  const ni = geo.toNonIndexed()
  geo.dispose()
  return ni
}

function fillColor(geo: THREE.BufferGeometry, color: THREE.Color): THREE.BufferGeometry {
  const count = geo.getAttribute('position').count
  const colors = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    colors[i * 3] = color.r
    colors[i * 3 + 1] = color.g
    colors[i * 3 + 2] = color.b
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return geo
}

/** Conífera estilizada: tronco + duas copas cônicas (uma única geometria). */
function makeConiferGeometry(trunkHex: number, lowHex: number, topHex: number): THREE.BufferGeometry {
  const trunk = fillColor(new THREE.CylinderGeometry(0.14, 0.24, 1.6, 6, 1), new THREE.Color(trunkHex))
  trunk.translate(0, 0.8, 0)
  const canopyLow = fillColor(new THREE.ConeGeometry(1.5, 2.6, 7, 1), new THREE.Color(lowHex))
  canopyLow.translate(0, 2.5, 0)
  const canopyHigh = fillColor(new THREE.ConeGeometry(1.0, 2.0, 7, 1), new THREE.Color(topHex))
  canopyHigh.translate(0, 4.0, 0)
  const merged = mergeGeometries([trunk, canopyLow, canopyHigh], false)
  trunk.dispose()
  canopyLow.dispose()
  canopyHigh.dispose()
  merged.computeBoundingSphere()
  return merged
}

/** Campos: conífera azul-esverdeada. */
export const treeGeometryDetailed = makeConiferGeometry(0x4a3859, 0x2f6d5c, 0x3f8a6a)
/** Gelo: pinheiro nevado, copas quase brancas. */
export const treeGeometryIce = makeConiferGeometry(0x54486b, 0xc4d8e4, 0xf0f6fc)

/** Deserto: cacto colunar com dois braços. */
export const cactusGeometry: THREE.BufferGeometry = (() => {
  const green = new THREE.Color(0x4f8a5c)
  const body = fillColor(new THREE.CylinderGeometry(0.26, 0.34, 2.6, 7, 1), green)
  body.translate(0, 1.3, 0)
  const armL = fillColor(new THREE.CylinderGeometry(0.13, 0.15, 1.0, 6, 1), green)
  armL.translate(-0.48, 1.75, 0)
  const armLh = fillColor(new THREE.CylinderGeometry(0.12, 0.13, 0.5, 6, 1), green)
  armLh.rotateZ(Math.PI / 2)
  armLh.translate(-0.32, 1.3, 0)
  const armR = fillColor(new THREE.CylinderGeometry(0.12, 0.14, 0.8, 6, 1), green)
  armR.translate(0.46, 2.0, 0)
  const armRh = fillColor(new THREE.CylinderGeometry(0.11, 0.12, 0.44, 6, 1), green)
  armRh.rotateZ(Math.PI / 2)
  armRh.translate(0.32, 1.65, 0)
  const merged = mergeGeometries([body, armL, armLh, armR, armRh], false)
  ;[body, armL, armLh, armR, armRh].forEach((g) => g.dispose())
  merged.computeBoundingSphere()
  return merged
})()

/** Árvore podre: tronco escuro retorcido com galhos nus. */
export const rottenTreeGeometry: THREE.BufferGeometry = (() => {
  const dark = new THREE.Color(0x352c42)
  const trunk = fillColor(new THREE.CylinderGeometry(0.09, 0.22, 2.4, 6, 1), dark)
  trunk.translate(0, 1.2, 0)
  const b1 = fillColor(new THREE.CylinderGeometry(0.04, 0.08, 1.2, 5, 1), dark)
  b1.rotateZ(0.75)
  b1.translate(0.42, 2.0, 0)
  const b2 = fillColor(new THREE.CylinderGeometry(0.03, 0.07, 1.0, 5, 1), dark)
  b2.rotateZ(-0.95)
  b2.translate(-0.36, 1.7, 0.1)
  const b3 = fillColor(new THREE.CylinderGeometry(0.03, 0.06, 0.9, 5, 1), dark)
  b3.rotateX(0.8)
  b3.translate(0, 2.3, -0.3)
  const merged = mergeGeometries([trunk, b1, b2, b3], false)
  ;[trunk, b1, b2, b3].forEach((g) => g.dispose())
  merged.computeBoundingSphere()
  return merged
})()

/** Árvore frutífera: copa redonda cheia de frutas vermelhas. */
export const fruitTreeGeometry: THREE.BufferGeometry = (() => {
  const trunk = fillColor(
    nonIndexed(new THREE.CylinderGeometry(0.16, 0.28, 1.5, 6, 1)),
    new THREE.Color(0x5a4a38)
  )
  trunk.translate(0, 0.75, 0)
  const canopy = fillColor(
    nonIndexed(new THREE.IcosahedronGeometry(1.35, 1)),
    new THREE.Color(0x4f8a54)
  )
  canopy.scale(1, 0.85, 1)
  canopy.translate(0, 2.3, 0)
  const parts = [trunk, canopy]
  const rng = mulberry32(0xf417)
  const fruitColor = new THREE.Color(0xff6b5e)
  for (let i = 0; i < 8; i++) {
    const a = rng() * Math.PI * 2
    const e = rng() * Math.PI - Math.PI / 2
    const fruit = fillColor(nonIndexed(new THREE.SphereGeometry(0.14, 6, 5)), fruitColor)
    fruit.translate(
      Math.cos(a) * Math.cos(e) * 1.25,
      2.3 + Math.sin(e) * 0.95,
      Math.sin(a) * Math.cos(e) * 1.25
    )
    parts.push(fruit)
  }
  const merged = mergeGeometries(parts, false)
  parts.forEach((g) => g.dispose())
  merged.computeBoundingSphere()
  return merged
})()

/** Árvore de luz (1 em 1.000.000): tronco pálido; a copa ganha material emissivo. */
export const lightTreeTrunkGeometry: THREE.BufferGeometry = (() => {
  const trunk = fillColor(new THREE.CylinderGeometry(0.18, 0.3, 2.2, 7, 1), new THREE.Color(0xd8cfae))
  trunk.translate(0, 1.1, 0)
  trunk.computeBoundingSphere()
  return trunk
})()

export const lightTreeCanopyGeometry: THREE.BufferGeometry = (() => {
  const canopy = new THREE.IcosahedronGeometry(1.5, 1)
  canopy.translate(0, 3.1, 0)
  canopy.computeBoundingSphere()
  return canopy
})()

export function makeLightTreeCanopyMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: '#fff6d8',
    emissive: new THREE.Color('#ffdf9e'),
    emissiveIntensity: 2.6,
    roughness: 0.5,
  })
}

/** Aura da árvore de luz: esfera aditiva suave ao redor da copa. */
export function makeAuraMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: new THREE.Color(1.6, 1.3, 0.7),
    transparent: true,
    opacity: 0.16,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.BackSide,
  })
}

const farConeCache = new Map<number, THREE.BufferGeometry>()
/** Silhueta distante barata, com cor por bioma. */
export function getFarTreeGeometry(hex: number): THREE.BufferGeometry {
  let geo = farConeCache.get(hex)
  if (!geo) {
    geo = fillColor(new THREE.ConeGeometry(1.4, 4.6, 5, 1), new THREE.Color(hex))
    geo.translate(0, 2.5, 0)
    geo.computeBoundingSphere()
    farConeCache.set(hex, geo)
  }
  return geo
}

/** Pedra low-poly com vértices deterministicamente irregulares. */
export const rockGeometry: THREE.BufferGeometry = (() => {
  const geo = new THREE.IcosahedronGeometry(1, 0)
  const rng = mulberry32(0xabcd12)
  const pos = geo.getAttribute('position') as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) {
    const jitter = 0.72 + rng() * 0.5
    pos.setXYZ(i, pos.getX(i) * jitter, pos.getY(i) * jitter * 0.7, pos.getZ(i) * jitter)
  }
  geo.computeVertexNormals()
  geo.computeBoundingSphere()
  return geo
})()

/** Obelisco de luz. */
export const shardGeometry: THREE.BufferGeometry = (() => {
  const geo = new THREE.OctahedronGeometry(0.6, 0)
  geo.scale(0.55, 2.6, 0.55)
  geo.translate(0, 1.5, 0)
  geo.computeBoundingSphere()
  return geo
})()

/** Lâmina de grama: quad afunilado com gradiente de cor e uv.y = altura. */
export const grassGeometry: THREE.BufferGeometry = (() => {
  const geo = new THREE.BufferGeometry()
  const base = 0.07
  const positions = new Float32Array([
    -base, 0, 0, base, 0, 0, -base * 0.45, 0.55, 0,
    base * 0.45, 0.55, 0, 0, 1.0, 0,
  ])
  const indices = new Uint16Array([0, 1, 2, 2, 1, 3, 2, 3, 4])
  const uvs = new Float32Array([0, 0, 1, 0, 0, 0.55, 1, 0.55, 0.5, 1])
  const bottom = new THREE.Color('#568a6d')
  const top = new THREE.Color('#c3e8b4')
  const colors = new Float32Array(5 * 3)
  const heights = [0, 0, 0.55, 0.55, 1]
  for (let i = 0; i < 5; i++) {
    const c = bottom.clone().lerp(top, heights[i])
    colors[i * 3] = c.r
    colors[i * 3 + 1] = c.g
    colors[i * 3 + 2] = c.b
  }
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geo.setIndex(new THREE.BufferAttribute(indices, 1))
  geo.computeVertexNormals()
  geo.computeBoundingSphere()
  return geo
})()

/** Injeta balanço de vento no vertex shader de um material padrão. */
function injectWind(
  material: THREE.Material,
  cacheKey: string,
  displacement: string
): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWindTime = windTimeUniform
    shader.vertexShader = `uniform float uWindTime;\n${shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      {
        #ifdef USE_INSTANCING
          vec4 windWorld = modelMatrix * instanceMatrix * vec4(position, 1.0);
        #else
          vec4 windWorld = modelMatrix * vec4(position, 1.0);
        #endif
        ${displacement}
      }`
    )}`
  }
  material.customProgramCacheKey = () => cacheKey
}

export function makeTerrainMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 1,
    metalness: 0,
  })
}

export function makeTreeMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.95,
    metalness: 0,
  })
  injectWind(
    mat,
    'wind-tree',
    `float windMask = smoothstep(1.2, 4.6, position.y);
     transformed.x += sin(uWindTime * 1.1 + windWorld.x * 0.05 + windWorld.z * 0.07) * 0.14 * windMask;
     transformed.z += cos(uWindTime * 0.8 + windWorld.x * 0.06) * 0.09 * windMask;`
  )
  return mat
}

export function makeRockMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: '#7b76a0',
    roughness: 0.9,
    metalness: 0.05,
  })
}

export function makeGrassMaterial(): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
  })
  injectWind(
    mat,
    'wind-grass',
    `float bendMask = uv.y * uv.y;
     float gust = sin(uWindTime * 1.6 + windWorld.x * 0.35 + windWorld.z * 0.27)
                + 0.5 * sin(uWindTime * 2.7 + windWorld.x * 0.8 + windWorld.z * 0.5);
     transformed.x += gust * 0.16 * bendMask;
     transformed.z += gust * 0.07 * bendMask;`
  )
  return mat
}

export function makeShardMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: '#fff2d8',
    emissive: new THREE.Color('#ffd9a0'),
    emissiveIntensity: 3.2,
    roughness: 0.4,
  })
}

/** Material com rim light quente — usado no personagem para o brilho de contorno. */
export function makeRimMaterial(
  color: string,
  rimColor: string,
  rimStrength: number
): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.85,
    metalness: 0,
  })
  const rim = new THREE.Color(rimColor)
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uRimColor = { value: rim }
    shader.uniforms.uRimStrength = { value: rimStrength }
    shader.fragmentShader = `uniform vec3 uRimColor;\nuniform float uRimStrength;\n${shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      {
        vec3 rimViewDir = normalize(vViewPosition);
        float rimFactor = pow(1.0 - abs(dot(normalize(normal), rimViewDir)), 3.0);
        totalEmissiveRadiance += uRimColor * rimFactor * uRimStrength;
      }`
    )}`
  }
  mat.customProgramCacheKey = () => `rim-${rimColor}-${rimStrength}`
  return mat
}
