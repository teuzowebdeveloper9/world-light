/**
 * Constantes e tipos do sistema de chunks.
 * Este módulo é puro (sem three.js / DOM) para poder ser importado pelo Web Worker.
 */

export const WORLD_SEED = 20260702

/** Tamanho de um chunk em unidades de mundo. */
export const CHUNK_SIZE = 96
/** Segmentos do grid de terreno por lado (vértices internos = CHUNK_RES + 1). */
export const CHUNK_RES = 40
/** Profundidade da "saia" nas bordas do chunk (esconde emendas entre LODs). */
export const SKIRT_DEPTH = 10

/** Raio (Chebyshev) de chunks mantidos ativos ao redor do player. */
export const ACTIVE_RADIUS = 3
/** Além deste raio o chunk é descartado (com dispose de GPU). */
export const UNLOAD_RADIUS = ACTIVE_RADIUS + 2
/** Ao cruzar 60% do chunk na direção de uma borda, pré-carrega os vizinhos. */
export const PRELOAD_THRESHOLD = 0.6
/** Colliders de física só existem neste raio (3x3 ao redor do player). */
export const PHYSICS_RADIUS = 1
/** Grama só é renderizada neste raio. */
export const GRASS_RADIUS = 1
/** Árvores detalhadas até este raio; além disso, silhueta simples. */
export const TREE_DETAIL_RADIUS = 2

/** Vértices por lado incluindo o anel de saia. */
export const GRID_WIDTH = CHUNK_RES + 3

/** Strides dos buffers de decoração vindos do worker. */
export const TREE_STRIDE = 6 // x, y, z, escala, rotY, tint
export const ROCK_STRIDE = 6 // x, y, z, escala, rotY, tint
export const GRASS_STRIDE = 5 // x, y, z, escala, fase
export const SHARD_STRIDE = 4 // x, y, z, escala

export interface ChunkRequestMessage {
  type: 'generate'
  seed: number
  cx: number
  cz: number
}

export interface ChunkPayload {
  cx: number
  cz: number
  /** Posições xyz do grid (GRID_WIDTH², em coordenadas de mundo). */
  positions: Float32Array
  /** Normais analíticas (contínuas entre chunks — sem emendas de iluminação). */
  normals: Float32Array
  /** Cores por vértice (linear RGB). */
  colors: Float32Array
  trees: Float32Array
  rocks: Float32Array
  grass: Float32Array
  shards: Float32Array
  minY: number
  maxY: number
}
