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

/** Biomas macro do mundo. */
export const BIOME_TEMPERATE = 0
export const BIOME_DESERT = 1
export const BIOME_ICE = 2
export type BiomeId = typeof BIOME_TEMPERATE | typeof BIOME_DESERT | typeof BIOME_ICE

export interface BiomeWeights {
  temperate: number
  desert: number
  ice: number
}

export interface TerrainSampler {
  /** Altura do terreno em (x, z). */
  height(x: number, z: number): number
  /** 0 = campina aberta … 1 = floresta densa/rochosa. */
  biome(x: number, z: number): number
  /** Temperatura -1 (gelo) … +1 (deserto). Escala continental. */
  temperature(x: number, z: number): number
  /** Pesos suaves de cada macro-bioma (para blending de cores). */
  biomeWeights(x: number, z: number, out: BiomeWeights): BiomeWeights
  /** Macro-bioma dominante em (x, z). */
  biomeId(x: number, z: number): BiomeId
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
  const tempN: NoiseFunction2D = createNoise2D(mulberry32(seed ^ 0x3c6ef372))

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

  function temperature(x: number, z: number): number {
    // Escala continental: regiões grandes o bastante para "viajar até o deserto".
    return tempN(x / 1500, z / 1500) + tempN(x / 400, z / 400) * 0.15
  }

  function biomeWeights(x: number, z: number, out: BiomeWeights): BiomeWeights {
    const t = temperature(x, z)
    out.desert = smoothstep(0.34, 0.52, t)
    out.ice = smoothstep(0.34, 0.52, -t)
    out.temperate = Math.max(0, 1 - out.desert - out.ice)
    return out
  }

  const bw: BiomeWeights = { temperate: 1, desert: 0, ice: 0 }
  function biomeId(x: number, z: number): BiomeId {
    biomeWeights(x, z, bw)
    if (bw.desert > bw.temperate && bw.desert >= bw.ice) return BIOME_DESERT
    if (bw.ice > bw.temperate && bw.ice > bw.desert) return BIOME_ICE
    return BIOME_TEMPERATE
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

  return { height, biome, temperature, biomeWeights, biomeId, path, normal }
}

/**
 * Escolhe o ponto de nascimento com CHANCE de cair em cada bioma
 * (40% campos, 30% deserto, 30% gelo). A sorte é da sessão (Math.random),
 * mas a busca pelo ponto é determinística a partir do bioma sorteado.
 */
export function findSpawnPoint(
  seed: number,
  roll: number
): { x: number; z: number; biome: BiomeId } {
  const sampler = getTerrainSampler(seed)
  const target: BiomeId = roll < 0.4 ? BIOME_TEMPERATE : roll < 0.7 ? BIOME_DESERT : BIOME_ICE

  // O centro do mundo é sempre campina aberta (colina de nascimento clássica).
  if (target === BIOME_TEMPERATE) return { x: 0, z: 6, biome: BIOME_TEMPERATE }

  // Espiral áurea: primeiro ponto plano e do bioma certo vence.
  const n: [number, number, number] = [0, 1, 0]
  const GOLDEN = 2.399963
  for (let i = 1; i < 400; i++) {
    const r = 220 + i * 38
    const a = i * GOLDEN
    const x = Math.cos(a) * r
    const z = Math.sin(a) * r
    if (sampler.biomeId(x, z) !== target) continue
    const h = sampler.height(x, z)
    if (h > 34 || h < -4) continue
    sampler.normal(x, z, n)
    if (n[1] < 0.94) continue
    return { x, z, biome: target }
  }
  return { x: 0, z: 6, biome: BIOME_TEMPERATE }
}
