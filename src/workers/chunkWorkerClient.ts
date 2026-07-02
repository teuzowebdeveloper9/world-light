/**
 * Cliente do worker de chunks: fila com prioridade na main thread.
 * Mantém no máximo 2 jobs em voo para poder repriorizar a fila enquanto
 * o player se move (correr muda a ordem de geração).
 */
import { chunkKey } from '../world/chunkMath'
import type { ChunkPayload } from '../world/chunkTypes'

interface Job {
  cx: number
  cz: number
  seed: number
  priority: number
}

type ResultListener = (payload: ChunkPayload) => void

const MAX_IN_FLIGHT = 2

class ChunkWorkerClient {
  private worker: Worker | null = null
  private queue = new Map<string, Job>()
  private inFlight = new Set<string>()
  private listeners = new Set<ResultListener>()

  private ensureWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('./chunkWorker.ts', import.meta.url), {
        type: 'module',
      })
      this.worker.onmessage = (e: MessageEvent<ChunkPayload>) => {
        const payload = e.data
        this.inFlight.delete(chunkKey(payload.cx, payload.cz))
        for (const listener of this.listeners) listener(payload)
        this.pump()
      }
    }
    return this.worker
  }

  onResult(listener: ResultListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Enfileira (ou repriorizará) a geração de um chunk. */
  enqueueChunkGeneration(cx: number, cz: number, seed: number, priority: number): void {
    const key = chunkKey(cx, cz)
    if (this.inFlight.has(key)) return
    const existing = this.queue.get(key)
    if (existing) {
      existing.priority = Math.min(existing.priority, priority)
    } else {
      this.queue.set(key, { cx, cz, seed, priority })
    }
    this.pump()
  }

  cancel(key: string): void {
    this.queue.delete(key)
  }

  isPending(key: string): boolean {
    return this.queue.has(key) || this.inFlight.has(key)
  }

  private pump(): void {
    while (this.inFlight.size < MAX_IN_FLIGHT && this.queue.size > 0) {
      let best: Job | null = null
      let bestKey = ''
      for (const [key, job] of this.queue) {
        if (!best || job.priority < best.priority) {
          best = job
          bestKey = key
        }
      }
      if (!best) return
      this.queue.delete(bestKey)
      this.inFlight.add(bestKey)
      this.ensureWorker().postMessage({
        type: 'generate',
        seed: best.seed,
        cx: best.cx,
        cz: best.cz,
      })
    }
  }

  dispose(): void {
    this.worker?.terminate()
    this.worker = null
    this.queue.clear()
    this.inFlight.clear()
    this.listeners.clear()
  }
}

export const chunkWorkerClient = new ChunkWorkerClient()
