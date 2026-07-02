/**
 * Matemática de chunks: coordenadas, chaves, índices de grid e regra dos 60%.
 */
import { positiveModulo } from '../utils/math'
import { ACTIVE_RADIUS, CHUNK_SIZE, GRID_WIDTH, PRELOAD_THRESHOLD } from './chunkTypes'

export function getChunkCoord(v: number): number {
  return Math.floor(v / CHUNK_SIZE)
}

export function getLocalPositionInChunk(x: number, z: number): { localX: number; localZ: number } {
  return {
    localX: positiveModulo(x, CHUNK_SIZE),
    localZ: positiveModulo(z, CHUNK_SIZE),
  }
}

export function chunkKey(cx: number, cz: number): string {
  return `${cx},${cz}`
}

/** Distância Chebyshev entre chunks (anéis quadrados). */
export function chunkDistance(ax: number, az: number, bx: number, bz: number): number {
  return Math.max(Math.abs(ax - bx), Math.abs(az - bz))
}

export interface PreloadDirection {
  dx: -1 | 0 | 1
  dz: -1 | 0 | 1
}

/**
 * Regra dos 60%: quando o player cruza 60% do chunk em direção a uma borda,
 * os próximos chunks naquela direção devem começar a gerar antes de ele chegar.
 */
export function shouldPreloadNeighbors(px: number, pz: number): PreloadDirection {
  const { localX, localZ } = getLocalPositionInChunk(px, pz)
  const hi = CHUNK_SIZE * PRELOAD_THRESHOLD
  const lo = CHUNK_SIZE * (1 - PRELOAD_THRESHOLD)
  return {
    dx: localX > hi ? 1 : localX < lo ? -1 : 0,
    dz: localZ > hi ? 1 : localZ < lo ? -1 : 0,
  }
}

/**
 * Prioridade de geração (menor = mais urgente): distância ao player
 * menos um bônus na direção da velocidade — correr aumenta a prioridade
 * dos chunks à frente.
 */
export function chunkPriority(
  cx: number,
  cz: number,
  pcx: number,
  pcz: number,
  velX: number,
  velZ: number
): number {
  const dist = chunkDistance(cx, cz, pcx, pcz)
  const dirX = cx - pcx
  const dirZ = cz - pcz
  const dirLen = Math.hypot(dirX, dirZ)
  const speed = Math.hypot(velX, velZ)
  let bonus = 0
  if (dirLen > 0 && speed > 0.5) {
    const dot = (dirX / dirLen) * (velX / speed) + (dirZ / dirLen) * (velZ / speed)
    bonus = dot * Math.min(speed / 10, 1) * (ACTIVE_RADIUS - 0.5)
  }
  return dist - bonus
}

let cachedIndices: Uint32Array | null = null

/**
 * Índices de triângulos do grid (idênticos para todo chunk — construídos uma vez
 * e compartilhados entre todas as geometrias e trimesh colliders).
 */
export function buildChunkIndices(): Uint32Array {
  if (cachedIndices) return cachedIndices
  const W = GRID_WIDTH
  const quads = (W - 1) * (W - 1)
  const indices = new Uint32Array(quads * 6)
  let o = 0
  for (let j = 0; j < W - 1; j++) {
    for (let i = 0; i < W - 1; i++) {
      const a = j * W + i
      const b = a + 1
      const c = a + W
      const d = a + W + 1
      // Ordem CCW vista de cima (+Y)
      indices[o++] = a
      indices[o++] = c
      indices[o++] = b
      indices[o++] = b
      indices[o++] = c
      indices[o++] = d
    }
  }
  cachedIndices = indices
  return indices
}
