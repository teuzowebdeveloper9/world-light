/**
 * Entrada elegante: tela azul-escura com partículas leves e um convite.
 * Ao pressionar qualquer tecla os chunks iniciais são gerados por trás do
 * veil; quando o primeiro círculo está pronto, o veil se dissolve e a câmera
 * mergulha no mundo.
 */
import { useMemo } from 'react'
import { useExperienceStore } from '../state/useExperienceStore'
import { mulberry32 } from '../world/noise'

function CssParticles({ count }: { count: number }) {
  const particles = useMemo(() => {
    const rng = mulberry32(0xfee1 ^ 0x1234)
    return Array.from({ length: count }, (_, i) => ({
      id: i,
      left: `${rng() * 100}%`,
      delay: `${rng() * 14}s`,
      duration: `${9 + rng() * 14}s`,
      size: 1.5 + rng() * 2.5,
    }))
  }, [count])

  return (
    <div className="css-particles" aria-hidden>
      {particles.map((p) => (
        <span
          key={p.id}
          style={{
            left: p.left,
            width: p.size,
            height: p.size,
            animationDelay: p.delay,
            animationDuration: p.duration,
          }}
        />
      ))}
    </div>
  )
}

export function KeyboardStartScreen() {
  const phase = useExperienceStore((s) => s.phase)
  const worldReady = useExperienceStore((s) => s.worldReady)

  if (phase === 'start') {
    return (
      <div className="overlay start-screen">
        <CssParticles count={40} />
        <h1 className="start-title">World of Light</h1>
        <p className="start-subtitle">um mundo infinito de luz e silêncio</p>
        <p className="start-hint">Pressione qualquer tecla para entrar</p>
      </div>
    )
  }

  if (phase === 'entering' || phase === 'playing') {
    const dissolved = worldReady && phase === 'playing'
    return (
      <div className={`overlay veil ${dissolved ? 'veil-hidden' : ''}`}>
        <CssParticles count={26} />
        {!worldReady && <p className="veil-text">o mundo está despertando…</p>}
      </div>
    )
  }

  return null
}
