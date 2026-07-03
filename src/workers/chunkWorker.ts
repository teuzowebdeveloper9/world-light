/**
 * Web Worker de geração procedural.
 * Toda a matemática pesada (heightmap, normais, cores, distribuição de objetos)
 * acontece aqui — a main thread só recebe TypedArrays prontos via transferables
 * e constrói as meshes. Nada de travar o frame.
 */
import { getTerrainSampler, mulberry32, hashCoords, type BiomeWeights } from '../world/noise'
import { terrainVertexColor, type RGB } from '../world/biome'
import { spawnDecorations } from '../world/objectSpawner'
import {
  CHUNK_RES,
  CHUNK_SIZE,
  GRID_WIDTH,
  SKIRT_DEPTH,
  type ChunkPayload,
  type ChunkRequestMessage,
} from '../world/chunkTypes'

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<ChunkRequestMessage>) => void) | null
  postMessage(message: ChunkPayload, transfer: Transferable[]): void
}

function generateChunkData(seed: number, cx: number, cz: number): ChunkPayload {
  const sampler = getTerrainSampler(seed)
  const W = GRID_WIDTH
  const step = CHUNK_SIZE / CHUNK_RES
  const vertCount = W * W

  const positions = new Float32Array(vertCount * 3)
  const normals = new Float32Array(vertCount * 3)
  const colors = new Float32Array(vertCount * 3)

  const dithRng = mulberry32(hashCoords(seed ^ 0x77aa11, cx, cz))
  const n: [number, number, number] = [0, 1, 0]
  const rgb: RGB = [0, 0, 0]
  const weights: BiomeWeights = { temperate: 1, desert: 0, ice: 0 }
  let minY = Infinity
  let maxY = -Infinity

  for (let j = 0; j < W; j++) {
    // O anel externo é a "saia": duplica a borda e desce, escondendo frestas.
    const gj = Math.min(Math.max(j - 1, 0), CHUNK_RES)
    const isEdgeJ = j === 0 || j === W - 1
    const z = cz * CHUNK_SIZE + gj * step
    for (let i = 0; i < W; i++) {
      const gi = Math.min(Math.max(i - 1, 0), CHUNK_RES)
      const isEdge = isEdgeJ || i === 0 || i === W - 1
      const x = cx * CHUNK_SIZE + gi * step

      const h = sampler.height(x, z)
      const y = isEdge ? h - SKIRT_DEPTH : h
      const o = (j * W + i) * 3
      positions[o] = x
      positions[o + 1] = y
      positions[o + 2] = z
      if (y < minY) minY = y
      if (y > maxY) maxY = y

      sampler.normal(x, z, n)
      normals[o] = n[0]
      normals[o + 1] = n[1]
      normals[o + 2] = n[2]

      sampler.biomeWeights(x, z, weights)
      terrainVertexColor(
        {
          y: h,
          slopeUp: n[1],
          biome: sampler.biome(x, z),
          path: sampler.path(x, z),
          weights,
          dither: dithRng() * 2 - 1,
        },
        rgb
      )
      colors[o] = rgb[0]
      colors[o + 1] = rgb[1]
      colors[o + 2] = rgb[2]
    }
  }

  const deco = spawnDecorations(seed, cx, cz, sampler)

  return {
    cx,
    cz,
    positions,
    normals,
    colors,
    trees: deco.trees,
    rotten: deco.rotten,
    fruits: deco.fruits,
    lights: deco.lights,
    rocks: deco.rocks,
    grass: deco.grass,
    shards: deco.shards,
    biomeId: deco.biomeId,
    minY,
    maxY,
  }
}

ctx.onmessage = (e: MessageEvent<ChunkRequestMessage>) => {
  const { type, seed, cx, cz } = e.data
  if (type !== 'generate') return
  const payload = generateChunkData(seed, cx, cz)
  ctx.postMessage(payload, [
    payload.positions.buffer,
    payload.normals.buffer,
    payload.colors.buffer,
    payload.trees.buffer,
    payload.rotten.buffer,
    payload.fruits.buffer,
    payload.lights.buffer,
    payload.rocks.buffer,
    payload.grass.buffer,
    payload.shards.buffer,
  ])
}
