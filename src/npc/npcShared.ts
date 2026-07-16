/**
 * Estado compartilhado dos encontros (princesa, sábio, lobo).
 * Alta frequência fora do React, no mesmo padrão do playerState: os
 * componentes leem/escrevem direto a cada frame, sem re-render.
 */

function readSecondsParam(name: string, fallback: number): number {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = new URLSearchParams(window.location.search).get(name)
    if (!raw) return fallback
    const v = Number(raw)
    return Number.isFinite(v) && v >= 0 ? v : fallback
  } catch {
    return fallback
  }
}

/**
 * MODO TESTE (hardcoded, sem UI): com true, os TRÊS personagens nascem
 * juntos perto do viajante assim que o mundo abre e ficam PARADOS para
 * inspeção de perto — a princesa não foge, o lobo não persegue (só encara)
 * e o sábio conversa normalmente com H. Volte para false para restaurar o
 * comportamento real do jogo (fuga, 3 min do sábio, caçada dos 7 min).
 */
export const NPC_TEST_MODE = false

export const npcState = {
  /** Segundos ANDADOS de verdade — parado, pausado ou no menu não conta. */
  walkTime: 0,
}

/** Caminhada até o sábio surgir (3 min; ?sageAt=segundos para testes). */
export const SAGE_AT_SECONDS = readSecondsParam('sageAt', 180)
/** Caminhada até a primeira caçada do lobo (7 min; ?wolfAt=segundos). */
export const WOLF_AT_SECONDS = readSecondsParam('wolfAt', 420)

// Inspeção via console/Playwright durante o desenvolvimento.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as Record<string, unknown>).__npcState = npcState
}
