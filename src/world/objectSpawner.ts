/**
 * Distribuição determinística de decorações por chunk, sensível ao bioma:
 * - Campos: coníferas + grama farta
 * - Deserto: cactos esparsos + tufos secos
 * - Gelo: pinheiros nevados + pouca vegetação
 * Raridade de árvores (sorteio por árvore): podre ~1/10, frutífera ~1/1.000,
 * árvore de luz ~1/1.000.000.
 * Módulo puro — roda dentro do Web Worker.
 */
import {
  hashCoords,
  mulberry32,
  BIOME_DESERT,
  BIOME_ICE,
  type BiomeId,
  type TerrainSampler,
} from './noise'
import {
  CHUNK_SIZE,
  FRUIT_TREE_CHANCE,
  GRASS_STRIDE,
  LIGHT_TREE_CHANCE,
  ROCK_STRIDE,
  ROTTEN_TREE_CHANCE,
  SHARD_STRIDE,
  TREE_STRIDE,
} from './chunkTypes'

export interface Decorations {
  trees: Float32Array
  rotten: Float32Array
  fruits: Float32Array
  lights: Float32Array
  rocks: Float32Array
  grass: Float32Array
  shards: Float32Array
  biomeId: BiomeId
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
  const chunkBiome = sampler.biomeId(ox + CHUNK_SIZE / 2, oz + CHUNK_SIZE / 2)

  // --- Árvores ---------------------------------------------------------
  const trees: number[] = []
  const rotten: number[] = []
  const fruits: number[] = []
  const lights: number[] = []
  const TREE_ATTEMPTS = 110
  for (let i = 0; i < TREE_ATTEMPTS; i++) {
    const x = ox + rng() * CHUNK_SIZE
    const z = oz + rng() * CHUNK_SIZE
    const r = rng()
    const localBiome = sampler.biomeId(x, z)
    const b = sampler.biome(x, z)

    let density: number
    if (localBiome === BIOME_DESERT) {
      density = 0.045 // cactos esparsos
    } else if (localBiome === BIOME_ICE) {
      density = b > 0.45 ? (b - 0.38) * 0.8 : 0.03 // bosques nevados
    } else {
      density = b > 0.48 ? (b - 0.4) * 1.1 : 0.05 // florestas e árvores solitárias
    }
    if (r > density) continue

    const y = sampler.height(x, z)
    if (y > 42 || y < -4) continue
    sampler.normal(x, z, n)
    if (n[1] < 0.82) continue
    if (sampler.path(x, z) > 0.55) continue

    const scale = 0.8 + rng() * 1.5
    const entry = [x, y - 0.25, z, scale, rng() * Math.PI * 2, 0.82 + rng() * 0.3]

    // Sorteio de raridade — determinístico por árvore.
    const rarity = rng()
    if (rarity < LIGHT_TREE_CHANCE) {
      lights.push(...entry)
    } else if (rarity < FRUIT_TREE_CHANCE) {
      fruits.push(...entry)
    } else if (rarity < ROTTEN_TREE_CHANCE) {
      rotten.push(...entry)
    } else {
      trees.push(...entry)
    }
  }

  // --- Pedras ----------------------------------------------------------
  const rocks: number[] = []
  const ROCK_ATTEMPTS = chunkBiome === BIOME_DESERT ? 34 : 26
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
    const localBiome = sampler.biomeId(x, z)
    const b = sampler.biome(x, z)
    let keep: number
    if (localBiome === BIOME_ICE) keep = 0.04 // quase nada cresce no gelo
    else if (localBiome === BIOME_DESERT) keep = 0.1 // tufos secos
    else keep = 0.35 + (1 - b) * 0.55
    if (rng() > keep) continue
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
    rotten: packFloats(rotten, TREE_STRIDE),
    fruits: packFloats(fruits, TREE_STRIDE),
    lights: packFloats(lights, TREE_STRIDE),
    rocks: packFloats(rocks, ROCK_STRIDE),
    grass: packFloats(grass, GRASS_STRIDE),
    shards: packFloats(shards, SHARD_STRIDE),
    biomeId: chunkBiome,
  }
}

function packFloats(values: number[], stride: number): Float32Array {
  const count = Math.floor(values.length / stride)
  const arr = new Float32Array(count * stride)
  arr.set(values.slice(0, count * stride))
  return arr
}
