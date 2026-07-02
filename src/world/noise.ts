/**
 * Ruído e amostrador de terreno determinístico.
 * Módulo puro (sem three.js / DOM): roda tanto no Web Worker quanto na main thread.
 * A mesma seed + mesmas coordenadas SEMPRE produzem o mesmo mundo.
 */
import { createNoise2D, type NoiseFunction2D } from 'simplex-noise'

export function mulberry32(a: number): () => number {
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Hash determinístico de (seed, x, y) → uint32. Usado para PRNG por chunk. */
export function hashCoords(seed: number, x: number, y: number): number {
  let h = seed ^ Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return (h ^ (h >>> 16)) >>> 0
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  let t = (x - edge0) / (edge1 - edge0)
  t = t < 0 ? 0 : t > 1 ? 1 : t
  return t * t * (3 - 2 * t)
}

export interface TerrainSampler {
  /** Altura do terreno em (x, z). */
  height(x: number, z: number): number
  /** 0 = campina aberta … 1 = floresta densa/rochosa. */
  biome(x: number, z: number): number
  /** 0..1 — fator de trilha natural (caminhos suaves no terreno). */
  path(x: number, z: number): number
  /** Normal analítica por diferenças finitas — contínua entre chunks. */
  normal(x: number, z: number, out: [number, number, number]): [number, number, number]
}

const samplerCache = new Map<number, TerrainSampler>()

export function getTerrainSampler(seed: number): TerrainSampler {
  let s = samplerCache.get(seed)
  if (!s) {
    s = createTerrainSampler(seed)
    samplerCache.set(seed, s)
  }
  return s
}

export function createTerrainSampler(seed: number): TerrainSampler {
  const base: NoiseFunction2D = createNoise2D(mulberry32(seed ^ 0x9e3779b9))
  const hills: NoiseFunction2D = createNoise2D(mulberry32(seed ^ 0x85ebca6b))
  const ridge: NoiseFunction2D = createNoise2D(mulberry32(seed ^ 0xc2b2ae35))
  const mask: NoiseFunction2D = createNoise2D(mulberry32(seed ^ 0x27d4eb2f))
  const detail: NoiseFunction2D = createNoise2D(mulberry32(seed ^ 0x165667b1))
  const biomeN: NoiseFunction2D = createNoise2D(mulberry32(seed ^ 0x94d049bb))
  const pathN: NoiseFunction2D = createNoise2D(mulberry32(seed ^ 0x2545f491))

  function path(x: number, z: number): number {
    // Linhas de nível do ruído ≈ trilhas orgânicas serpenteando o mundo.
    return 1 - smoothstep(0, 0.14, Math.abs(pathN(x / 240, z / 240)))
  }

  function height(x: number, z: number): number {
    // Ondulação base ampla + colinas médias + detalhe fino.
    let h = base(x / 380, z / 380) * 14
    h += hills(x / 130, z / 130) * 5.5
    h += detail(x / 36, z / 36) * 1.3

    // Montanhas "ridged" mascaradas: cordilheiras com planícies abertas entre elas.
    let r = 1 - Math.abs(ridge(x / 560, z / 560))
    r = r * r * r
    const m = smoothstep(0.08, 0.62, mask(x / 900, z / 900) * 0.5 + 0.5)

    // A área inicial (raio ~300 do centro) fica aberta e serena; montanhas ao longe.
    const d0 = Math.sqrt(x * x + z * z)
    const open = smoothstep(180, 560, d0)
    const mountain = r * 88 * m * open
    h += mountain

    // Trilhas suaves rebaixam levemente o terreno onde não há montanha.
    h -= path(x, z) * 2.6 * (1 - smoothstep(4, 20, mountain))

    // Elevação suave no ponto de nascimento — o player começa no alto de uma colina.
    h += 7 * Math.exp(-(d0 * d0) / (70 * 70))
    return h
  }

  function biome(x: number, z: number): number {
    return biomeN(x / 300, z / 300) * 0.5 + 0.5
  }

  function normal(x: number, z: number, out: [number, number, number]): [number, number, number] {
    const e = 1.1
    const nx = height(x - e, z) - height(x + e, z)
    const nz = height(x, z - e) - height(x, z + e)
    const ny = 2 * e
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz)
    out[0] = nx / len
    out[1] = ny / len
    out[2] = nz / len
    return out
  }

  return { height, biome, path, normal }
}
