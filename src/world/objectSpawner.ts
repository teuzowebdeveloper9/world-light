/**
 * Distribuição determinística de decorações por chunk (árvores, pedras, grama,
 * obeliscos de luz). Módulo puro — roda dentro do Web Worker.
 */
import { hashCoords, mulberry32, type TerrainSampler } from './noise'
import {
  CHUNK_SIZE,
  GRASS_STRIDE,
  ROCK_STRIDE,
  SHARD_STRIDE,
  TREE_STRIDE,
} from './chunkTypes'

export interface Decorations {
  trees: Float32Array
  rocks: Float32Array
  grass: Float32Array
  shards: Float32Array
}

export function spawnDecorations(
  seed: number,
  cx: number,
  cz: number,
  sampler: TerrainSampler
): Decorations {
  const rng = mulberry32(hashCoords(seed, cx, cz))
  const ox = cx * CHUNK_SIZE
  const oz = cz * CHUNK_SIZE
  const n: [number, number, number] = [0, 1, 0]

  // --- Árvores ---------------------------------------------------------
  const trees: number[] = []
  const TREE_ATTEMPTS = 110
  for (let i = 0; i < TREE_ATTEMPTS; i++) {
    const x = ox + rng() * CHUNK_SIZE
    const z = oz + rng() * CHUNK_SIZE
    const r = rng()
    const b = sampler.biome(x, z)
    // Floresta em biomas altos, árvores solitárias na campina.
    const density = b > 0.48 ? (b - 0.4) * 1.1 : 0.05
    if (r > density) continue
    const y = sampler.height(x, z)
    if (y > 42 || y < -4) continue
    sampler.normal(x, z, n)
    if (n[1] < 0.82) continue // encostas íngremes não têm árvores
    if (sampler.path(x, z) > 0.55) continue // trilhas ficam abertas
    const scale = 0.8 + rng() * 1.5
    trees.push(x, y - 0.25, z, scale, rng() * Math.PI * 2, 0.82 + rng() * 0.3)
  }

  // --- Pedras ----------------------------------------------------------
  const rocks: number[] = []
  const ROCK_ATTEMPTS = 26
  for (let i = 0; i < ROCK_ATTEMPTS; i++) {
    const x = ox + rng() * CHUNK_SIZE
    const z = oz + rng() * CHUNK_SIZE
    if (rng() > 0.4) continue
    const y = sampler.height(x, z)
    sampler.normal(x, z, n)
    if (n[1] < 0.55) continue
    const t = rng()
    const scale = 0.35 + t * t * 2.4
    rocks.push(x, y - scale * 0.3, z, scale, rng() * Math.PI * 2, 0.85 + rng() * 0.3)
  }

  // --- Grama -----------------------------------------------------------
  const grass: number[] = []
  const GRASS_ATTEMPTS = 780
  for (let i = 0; i < GRASS_ATTEMPTS; i++) {
    const x = ox + rng() * CHUNK_SIZE
    const z = oz + rng() * CHUNK_SIZE
    const b = sampler.biome(x, z)
    // Campinas têm mais grama que o chão de floresta.
    if (rng() > 0.35 + (1 - b) * 0.55) continue
    const y = sampler.height(x, z)
    if (y > 38) continue
    sampler.normal(x, z, n)
    if (n[1] < 0.86) continue
    if (sampler.path(x, z) > 0.75) continue
    grass.push(x, y - 0.02, z, 0.65 + rng() * 0.75, rng() * Math.PI * 2)
  }

  // --- Obeliscos de luz (raros) -----------------------------------------
  const shards: number[] = []
  if (hashCoords(seed ^ 0x51ab3d, cx, cz) / 4294967296 < 0.09) {
    for (let i = 0; i < 6; i++) {
      const x = ox + rng() * CHUNK_SIZE
      const z = oz + rng() * CHUNK_SIZE
      const y = sampler.height(x, z)
      sampler.normal(x, z, n)
      if (n[1] < 0.9 || y > 34) continue
      shards.push(x, y, z, 1.4 + rng() * 1.6)
      break
    }
  }

  return {
    trees: packFloats(trees, TREE_STRIDE),
    rocks: packFloats(rocks, ROCK_STRIDE),
    grass: packFloats(grass, GRASS_STRIDE),
    shards: packFloats(shards, SHARD_STRIDE),
  }
}

function packFloats(values: number[], stride: number): Float32Array {
  const count = Math.floor(values.length / stride)
  const arr = new Float32Array(count * stride)
  arr.set(values.slice(0, count * stride))
  return arr
}
