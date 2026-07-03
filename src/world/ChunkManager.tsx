/**
 * Orquestra o mundo infinito:
 * - mantém o anel ativo de chunks ao redor do player
 * - aplica a regra dos 60% (pré-carrega a próxima banda na direção do movimento)
 * - prioriza chunks na direção da velocidade (correr gera mais à frente)
 * - aplica no máximo 2 resultados do worker por frame (zero stutter)
 * - descarta chunks distantes (dispose completo via unmount do TerrainChunk)
 */
import { useEffect, useReducer, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { chunkWorkerClient } from '../workers/chunkWorkerClient'
import { useExperienceStore } from '../state/useExperienceStore'
import { playerState } from '../player/PlayerController'
import {
  chunkDistance,
  chunkKey,
  chunkPriority,
  getChunkCoord,
  shouldPreloadNeighbors,
} from './chunkMath'
import { ACTIVE_RADIUS, UNLOAD_RADIUS, type ChunkPayload } from './chunkTypes'
import { TerrainChunk } from './TerrainChunk'

interface ChunkEntry {
  cx: number
  cz: number
  payload: ChunkPayload | null
  /** true se o chunk nasceu antes do reveal — aparece sem fade. */
  instant: boolean
}

const MAX_APPLY_PER_FRAME = 2
const AREA_UPDATE_INTERVAL = 0.15

export function ChunkManager() {
  const seed = useExperienceStore((s) => s.seed)
  const [, force] = useReducer((c: number) => c + 1, 0)
  const chunks = useRef(new Map<string, ChunkEntry>())
  const readyBuffer = useRef<ChunkPayload[]>([])
  const areaTimer = useRef(0)

  function requestChunk(cx: number, cz: number, priority: number): void {
    const key = chunkKey(cx, cz)
    const existing = chunks.current.get(key)
    if (!existing) {
      chunks.current.set(key, {
        cx,
        cz,
        payload: null,
        instant: !useExperienceStore.getState().worldReady,
      })
      chunkWorkerClient.enqueueChunkGeneration(cx, cz, seed, priority)
    } else if (!existing.payload && chunkWorkerClient.isPending(key)) {
      // Repriorizacão enquanto ainda está na fila.
      chunkWorkerClient.enqueueChunkGeneration(cx, cz, seed, priority)
    }
  }

  function updateArea(): void {
    const p = playerState.position
    const v = playerState.velocity
    const pcx = getChunkCoord(p.x)
    const pcz = getChunkCoord(p.z)
    useExperienceStore.getState().setPlayerChunk(pcx, pcz)

    // Anel ativo completo.
    for (let dz = -ACTIVE_RADIUS; dz <= ACTIVE_RADIUS; dz++) {
      for (let dx = -ACTIVE_RADIUS; dx <= ACTIVE_RADIUS; dx++) {
        const cx = pcx + dx
        const cz = pcz + dz
        requestChunk(cx, cz, chunkPriority(cx, cz, pcx, pcz, v.x, v.z))
      }
    }

    // Regra dos 60%: banda extra na direção em que o player está avançando
    // (inclui diagonais para nunca abrir buracos).
    const dir = shouldPreloadNeighbors(p.x, p.z)
    const edge = ACTIVE_RADIUS + 1
    if (dir.dx !== 0) {
      for (let k = -1; k <= 1; k++) {
        const cx = pcx + edge * dir.dx
        const cz = pcz + k
        requestChunk(cx, cz, chunkPriority(cx, cz, pcx, pcz, v.x, v.z) - 0.5)
      }
    }
    if (dir.dz !== 0) {
      for (let k = -1; k <= 1; k++) {
        const cx = pcx + k
        const cz = pcz + edge * dir.dz
        requestChunk(cx, cz, chunkPriority(cx, cz, pcx, pcz, v.x, v.z) - 0.5)
      }
    }
    if (dir.dx !== 0 && dir.dz !== 0) {
      requestChunk(
        pcx + edge * dir.dx,
        pcz + edge * dir.dz,
        chunkPriority(pcx + edge * dir.dx, pcz + edge * dir.dz, pcx, pcz, v.x, v.z)
      )
    }

    // Descarta chunks longe demais.
    let removed = false
    for (const [key, entry] of chunks.current) {
      if (chunkDistance(entry.cx, entry.cz, pcx, pcz) > UNLOAD_RADIUS) {
        chunkWorkerClient.cancel(key)
        chunks.current.delete(key)
        removed = true
      }
    }
    if (removed) force()
  }

  function checkWorldReady(): void {
    const store = useExperienceStore.getState()
    if (store.worldReady) return
    // O círculo inicial é ao redor do PONTO DE NASCIMENTO (que pode ser
    // qualquer bioma), não da origem do mundo.
    const scx = getChunkCoord(store.spawn.x)
    const scz = getChunkCoord(store.spawn.z)
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const entry = chunks.current.get(chunkKey(scx + dx, scz + dz))
        if (!entry?.payload) return
      }
    }
    store.setWorldReady(true)
  }

  useEffect(() => {
    const off = chunkWorkerClient.onResult((payload) => {
      readyBuffer.current.push(payload)
    })
    updateArea()
    return off
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed])

  useFrame((_, dt) => {
    // Aplica resultados do worker com orçamento por frame — a construção de
    // geometria nunca compete com o render de um frame inteiro.
    let applied = 0
    while (readyBuffer.current.length > 0 && applied < MAX_APPLY_PER_FRAME) {
      const payload = readyBuffer.current.shift()!
      const entry = chunks.current.get(chunkKey(payload.cx, payload.cz))
      if (entry) {
        entry.payload = payload
        applied++
      }
    }
    if (applied > 0) {
      force()
      checkWorldReady()
    }

    areaTimer.current += dt
    if (areaTimer.current >= AREA_UPDATE_INTERVAL) {
      areaTimer.current = 0
      updateArea()
    }
  })

  const ready: ChunkEntry[] = []
  for (const entry of chunks.current.values()) {
    if (entry.payload) ready.push(entry)
  }

  return (
    <>
      {ready.map((entry) => (
        <TerrainChunk
          key={chunkKey(entry.cx, entry.cz)}
          payload={entry.payload!}
          instantFade={entry.instant}
        />
      ))}
    </>
  )
}
