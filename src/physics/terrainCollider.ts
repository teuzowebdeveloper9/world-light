/**
 * Colisão do terreno: o trimesh reutiliza EXATAMENTE os mesmos buffers da
 * geometria renderizada (posições em coordenadas de mundo + índices
 * compartilhados) — colisão sempre idêntica ao visual, sem custo extra de
 * memória além do que o render já usa.
 */
import { buildChunkIndices } from '../world/chunkMath'
import type { ChunkPayload } from '../world/chunkTypes'

export function getTrimeshArgs(payload: ChunkPayload): [Float32Array, Uint32Array] {
  return [payload.positions, buildChunkIndices()]
}
