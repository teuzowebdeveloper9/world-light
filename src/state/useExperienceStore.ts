/**
 * Estado global da experiência (Zustand).
 * Estado de alta frequência (posição do player, câmera) NÃO vive aqui —
 * fica em refs mutáveis (player/PlayerController) para não re-renderizar React.
 */
import { create } from 'zustand'
import { WORLD_SEED } from '../world/chunkTypes'

export type ExperiencePhase = 'gate' | 'blocked' | 'start' | 'entering' | 'playing'

const MUSIC_KEY = 'world-light:music'

function initialMusicOn(): boolean {
  try {
    return localStorage.getItem(MUSIC_KEY) !== 'off'
  } catch {
    return true
  }
}

interface ExperienceState {
  phase: ExperiencePhase
  paused: boolean
  helpVisible: boolean
  musicOn: boolean
  worldReady: boolean
  seed: number
  playerChunk: { cx: number; cz: number }
  setPhase: (phase: ExperiencePhase) => void
  setPaused: (paused: boolean) => void
  toggleHelp: () => void
  setMusicOn: (on: boolean) => void
  setWorldReady: (ready: boolean) => void
  setPlayerChunk: (cx: number, cz: number) => void
}

export const useExperienceStore = create<ExperienceState>((set) => ({
  phase: 'gate',
  paused: false,
  helpVisible: true,
  musicOn: initialMusicOn(),
  worldReady: false,
  seed: WORLD_SEED,
  playerChunk: { cx: 0, cz: 0 },
  setPhase: (phase) => set({ phase }),
  setPaused: (paused) => set({ paused }),
  toggleHelp: () => set((s) => ({ helpVisible: !s.helpVisible })),
  setMusicOn: (on) => {
    try {
      localStorage.setItem(MUSIC_KEY, on ? 'on' : 'off')
    } catch {
      // localStorage indisponível — segue sem persistir
    }
    set({ musicOn: on })
  },
  setWorldReady: (ready) => set({ worldReady: ready }),
  setPlayerChunk: (cx, cz) =>
    set((s) => (s.playerChunk.cx === cx && s.playerChunk.cz === cz ? s : { playerChunk: { cx, cz } })),
}))
