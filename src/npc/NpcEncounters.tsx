/**
 * Maestro dos encontros: acumula o TEMPO ANDADO (parado/pausado não conta),
 * pré-carrega cada modelo ~45s antes da hora (sem soluço de rede na hora H)
 * e monta cada NPC no momento certo — cada um no próprio Suspense, para uma
 * carga tardia nunca derrubar o mundo inteiro para o fallback.
 *
 * Gatilhos: princesa no início; sábio após 3 min andando; lobo após 7 min.
 * Debug: ?sageAt=8&wolfAt=20 encurta os gatilhos (segundos de caminhada).
 */
import { Suspense, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import { useExperienceStore } from '../state/useExperienceStore'
import { playerState } from '../player/PlayerController'
import { NPC_TEST_MODE, npcState, SAGE_AT_SECONDS, WOLF_AT_SECONDS } from './npcShared'
import { Princess } from './Princess'
import { Sage, SAGE_MODEL_URL } from './Sage'
import { Wolf, WOLF_MODEL_URL } from './Wolf'

// Modo teste: todo mundo em cena desde o início — carrega já.
if (NPC_TEST_MODE) {
  useGLTF.preload(SAGE_MODEL_URL)
  useGLTF.preload(WOLF_MODEL_URL)
}

/** Antecedência do preload dos GLBs tardios (segundos de caminhada). */
const PRELOAD_LEAD = 45
/** Andando mais rápido que isso conta como "caminhando pelo mundo". */
const WALKING_SPEED = 1.2

export function NpcEncounters() {
  const phase = useExperienceStore((s) => s.phase)
  const [sageSpawned, setSageSpawned] = useState(false)
  const [wolfSpawned, setWolfSpawned] = useState(false)
  const preloadedSage = useRef(false)
  const preloadedWolf = useRef(false)

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05)
    const { phase: ph, paused } = useExperienceStore.getState()
    if (ph !== 'playing' || paused) return

    const v = playerState.velocity
    if (Math.hypot(v.x, v.z) > WALKING_SPEED) npcState.walkTime += dt

    const t = npcState.walkTime
    if (!preloadedSage.current && t > SAGE_AT_SECONDS - PRELOAD_LEAD) {
      preloadedSage.current = true
      useGLTF.preload(SAGE_MODEL_URL)
    }
    if (!preloadedWolf.current && t > WOLF_AT_SECONDS - PRELOAD_LEAD) {
      preloadedWolf.current = true
      useGLTF.preload(WOLF_MODEL_URL)
    }
    if (!sageSpawned && t >= SAGE_AT_SECONDS) setSageSpawned(true)
    if (!wolfSpawned && t >= WOLF_AT_SECONDS) setWolfSpawned(true)
  })

  return (
    <>
      {phase === 'playing' && (
        <Suspense fallback={null}>
          <Princess />
        </Suspense>
      )}
      {(sageSpawned || (NPC_TEST_MODE && phase === 'playing')) && (
        <Suspense fallback={null}>
          <Sage />
        </Suspense>
      )}
      {(wolfSpawned || (NPC_TEST_MODE && phase === 'playing')) && (
        <Suspense fallback={null}>
          <Wolf />
        </Suspense>
      )}
    </>
  )
}
