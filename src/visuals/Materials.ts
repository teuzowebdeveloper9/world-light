/**
 * Geometrias e materiais compartilhados — construídos UMA vez e reutilizados
 * por todos os chunks. O vento é uma uniform global única (`windTimeUniform`)
 * compartilhada por todos os shaders: um único update por frame move o mundo todo.
 */
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { mulberry32 } from '../world/noise'

export const SUN_DIRECTION = new THREE.Vector3(0.28, 0.3, -1).normalize()
export const SUN_DISTANCE = 950

/** Uniform global de tempo do vento — atualizada uma única vez por frame no World. */
export const windTimeUniform: { value: number } = { value: 0 }

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

const TRUNK_COLOR = new THREE.Color('#4a3859')
const CANOPY_COLOR = new THREE.Color('#2f6d5c')
const CANOPY_TOP_COLOR = new THREE.Color('#3f8a6a')

/** Árvore estilizada detalhada: tronco + duas copas cônicas (uma única geometria). */
export const treeGeometryDetailed: THREE.BufferGeometry = (() => {
  const trunk = fillColor(new THREE.CylinderGeometry(0.14, 0.24, 1.6, 6, 1), TRUNK_COLOR)
  trunk.translate(0, 0.8, 0)
  const canopyLow = fillColor(new THREE.ConeGeometry(1.5, 2.6, 7, 1), CANOPY_COLOR)
  canopyLow.translate(0, 2.5, 0)
  const canopyHigh = fillColor(new THREE.ConeGeometry(1.0, 2.0, 7, 1), CANOPY_TOP_COLOR)
  canopyHigh.translate(0, 4.0, 0)
  const merged = mergeGeometries([trunk, canopyLow, canopyHigh], false)
  trunk.dispose()
  canopyLow.dispose()
  canopyHigh.dispose()
  merged.computeBoundingSphere()
  return merged
})()

/** Silhueta distante: um único cone barato. */
export const treeGeometryFar: THREE.BufferGeometry = (() => {
  const cone = fillColor(new THREE.ConeGeometry(1.4, 4.6, 5, 1), CANOPY_COLOR)
  cone.translate(0, 2.5, 0)
  cone.computeBoundingSphere()
  return cone
})()

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
