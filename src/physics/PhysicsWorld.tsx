/**
 * Mundo físico Rapier. Gravidade acima do real (-24) para o pulo ter peso;
 * a queda ganha um bônus extra no Player (parábola assimétrica).
 * Timestep FIXO (default 1/60 + interpolação visual): com passo variável a
 * integração da gravidade depende do frame rate e a altura do pulo muda
 * entre monitores de 60Hz e 144Hz ("Fix Your Timestep", Glenn Fiedler).
 * A simulação só roda durante o jogo — pausa e telas iniciais congelam tudo.
 */
import type { ReactNode } from 'react'
import { Physics } from '@react-three/rapier'
import { useExperienceStore } from '../state/useExperienceStore'

export function PhysicsWorld({ children }: { children: ReactNode }) {
  const paused = useExperienceStore((s) => s.paused)
  const phase = useExperienceStore((s) => s.phase)
  return (
    <Physics gravity={[0, -24, 0]} paused={paused || phase !== 'playing'}>
      {children}
    </Physics>
  )
}
