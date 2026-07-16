/**
 * Estado global da experiência (Zustand).
 * Estado de alta frequência (posição do player, câmera) NÃO vive aqui —
 * fica em refs mutáveis (player/PlayerController) para não re-renderizar React.
 */
import { create } from 'zustand'
import { WORLD_SEED } from '../world/chunkTypes'
import { findSpawnPoint, getTerrainSampler, type BiomeId } from '../world/noise'
import { playerState } from '../player/PlayerController'
import { SAGE_LINES } from '../npc/sageLines'

// Sorteia o bioma de nascimento da sessão (40% campos, 30% deserto, 30% gelo)
// e posiciona o estado do player lá antes de qualquer chunk ser pedido.
const spawnPoint = findSpawnPoint(WORLD_SEED, Math.random())
playerState.position.set(
  spawnPoint.x,
  getTerrainSampler(WORLD_SEED).height(spawnPoint.x, spawnPoint.z) + 1,
  spawnPoint.z
)

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
  /** Ponto de nascimento da sessão (bioma sorteado). */
  spawn: { x: number; z: number; biome: BiomeId }
  playerChunk: { cx: number; cz: number }
  /** Prompt "H — falar" visível (perto do sábio, fora do diálogo). */
  sagePromptVisible: boolean
  /** Índice da fala aberta do sábio (null = diálogo fechado). */
  sageDialogIndex: number | null
  /** Onde retomar se o diálogo for interrompido no meio. */
  sageResumeIndex: number
  /** O sábio já disse as 50 falas e partiu. */
  sageDone: boolean
  /** Tela escurecendo até o preto (o lobo alcançou o viajante). */
  blackout: boolean
  setPhase: (phase: ExperiencePhase) => void
  setPaused: (paused: boolean) => void
  toggleHelp: () => void
  setMusicOn: (on: boolean) => void
  setWorldReady: (ready: boolean) => void
  setPlayerChunk: (cx: number, cz: number) => void
  setSagePrompt: (visible: boolean) => void
  /** Abre o diálogo (retomando de onde parou) ou avança uma fala. */
  advanceSageDialog: () => void
  closeSageDialog: () => void
  setBlackout: (on: boolean) => void
}

// Inspeção via console/Playwright durante o desenvolvimento.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as Record<string, unknown>).__spawnBiome = spawnPoint.biome
}

export const useExperienceStore = create<ExperienceState>((set) => ({
  phase: 'gate',
  paused: false,
  helpVisible: true,
  musicOn: initialMusicOn(),
  worldReady: false,
  seed: WORLD_SEED,
  spawn: spawnPoint,
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
  sagePromptVisible: false,
  sageDialogIndex: null,
  sageResumeIndex: 0,
  sageDone: false,
  blackout: false,
  setSagePrompt: (visible) =>
    set((s) => (s.sagePromptVisible === visible ? s : { sagePromptVisible: visible })),
  advanceSageDialog: () =>
    set((s) => {
      if (s.sageDone) return s
      // Fechado: abre retomando de onde a conversa parou.
      if (s.sageDialogIndex === null) {
        return { sageDialogIndex: s.sageResumeIndex, sagePromptVisible: false }
      }
      const next = s.sageDialogIndex + 1
      // Depois da 50ª fala o encontro termina — o sábio parte (ver Sage.tsx).
      if (next >= SAGE_LINES.length) {
        return { sageDialogIndex: null, sageDone: true, sageResumeIndex: 0 }
      }
      return { sageDialogIndex: next, sageResumeIndex: next }
    }),
  closeSageDialog: () => set({ sageDialogIndex: null }),
  setBlackout: (on) => set({ blackout: on }),
}))
