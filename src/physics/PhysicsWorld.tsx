/**
 * Mundo físico Rapier. Gravidade acima do real (-24) para o pulo ter peso.
 * A simulação só roda durante o jogo — pausa e telas iniciais congelam tudo.
 */
import type { ReactNode } from 'react'
import { Physics } from '@react-three/rapier'
import { useExperienceStore } from '../state/useExperienceStore'

export function PhysicsWorld({ children }: { children: ReactNode }) {
  const paused = useExperienceStore((s) => s.paused)
  const phase = useExperienceStore((s) => s.phase)
  return (
    <Physics gravity={[0, -24, 0]} timeStep="vary" paused={paused || phase !== 'playing'}>
      {children}
    </Physics>
  )
}
