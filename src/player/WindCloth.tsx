/**
 * Manto ao vento do personagem.
 * Não é um plano pendurado: é um MEIO-CILINDRO (~220°) que envolve as costas
 * e as laterais do corpo — geometricamente o corpo não escapa do manto.
 * Os vértices são 100% paramétricos (ângulo + altura), animados por senos com
 * amplitude crescente em direção à barra, influenciados pela velocidade do
 * player e por um campo de vento global. Custo desprezível por frame.
 *
 * Evolução futura: cloth Verlet (constraints de distância) mantendo o mesmo
 * anel de fixação nos ombros.
 */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { playerState } from './PlayerController'
import { makeRimMaterial } from '../visuals/Materials'

/** Colunas ao longo do arco e linhas do ombro à barra. */
const COLS = 12
const ROWS = 12
/** Abertura do arco: ±112° — envolve costas e laterais, aberto na frente. */
const THETA = 1.95
/** Raio no ombro (corpo chibi tem ~0.28 de raio). */
const TOP_RADIUS = 0.34
/** Quanto o manto alarga até a barra. */
const FLARE = 0.3
const CAPE_LENGTH = 0.82
/** Altura do anel de fixação (ombros do mago em escala 0.9). */
const ATTACH_Y = 0.86

/** Rajadas lentas globais — o manto respira mesmo com o player parado. */
function windGust(t: number): number {
  return 0.55 + 0.45 * Math.sin(t * 0.7) * Math.sin(t * 0.23 + 1.7)
}

export function WindCloth() {
  const mesh = useRef<THREE.Mesh>(null)

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry()
    const count = (COLS + 1) * (ROWS + 1)
    const positions = new Float32Array(count * 3)
    const uvs = new Float32Array(count * 2)
    const indices: number[] = []

    for (let j = 0; j <= ROWS; j++) {
      const f = j / ROWS
      for (let i = 0; i <= COLS; i++) {
        const u = i / COLS
        const theta = -THETA + 2 * THETA * u
        const r = TOP_RADIUS + FLARE * f
        const o = (j * (COLS + 1) + i) * 3
        positions[o] = Math.sin(theta) * r
        positions[o + 1] = -f * CAPE_LENGTH
        positions[o + 2] = -Math.cos(theta) * r
        const ov = (j * (COLS + 1) + i) * 2
        uvs[ov] = u
        uvs[ov + 1] = f
      }
    }
    for (let j = 0; j < ROWS; j++) {
      for (let i = 0; i < COLS; i++) {
        const a = j * (COLS + 1) + i
        const b = a + 1
        const c = a + COLS + 1
        const d = c + 1
        indices.push(a, c, b, b, c, d)
      }
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
    geo.setIndex(indices)
    geo.computeVertexNormals()
    return geo
  }, [])

  const material = useMemo(() => {
    // Rim discreto: com rim alto o manto lia como couro marrom contra o sol.
    const mat = makeRimMaterial('#2f2a5c', '#ffc98a', 0.3)
    mat.side = THREE.DoubleSide
    return mat
  }, [])

  useEffect(() => {
    return () => {
      geometry.dispose()
      material.dispose()
    }
  }, [geometry, material])

  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    const speedF = playerState.speedFactor
    const attr = geometry.getAttribute('position') as THREE.BufferAttribute
    const arr = attr.array as Float32Array
    const gust = windGust(t)

    for (let j = 0; j <= ROWS; j++) {
      const f = j / ROWS
      // O anel do ombro (f=0) fica FIXO — o manto é vestido, não flutua.
      const trail = f * f * (0.14 + 0.85 * speedF)
      const lift = f * f * 0.4 * speedF
      for (let i = 0; i <= COLS; i++) {
        const u = i / COLS
        const theta = -THETA + 2 * THETA * u

        const wave =
          Math.sin(t * 2.4 + f * 5.2 + theta * 2.6) * 0.07 +
          Math.sin(t * 3.9 + f * 8.0 + theta * 4.2) * 0.028

        const r = TOP_RADIUS + FLARE * f + wave * (0.3 + gust * 0.5 + speedF * 0.6) * f

        const o = (j * (COLS + 1) + i) * 3
        arr[o] = Math.sin(theta) * r
        arr[o + 1] = -f * CAPE_LENGTH + lift
        arr[o + 2] = -Math.cos(theta) * r - trail
      }
    }
    attr.needsUpdate = true
    geometry.computeVertexNormals()
  })

  return (
    <mesh
      ref={mesh}
      geometry={geometry}
      material={material}
      position={[0, ATTACH_Y, 0]}
      castShadow
    />
  )
}
