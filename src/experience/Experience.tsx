/**
 * Casca da experiência: gate de desktop, Canvas R3F, atalhos globais de
 * teclado (M / H / Esc), HUD minimalista e transição de entrada.
 */
import { Suspense, useEffect, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { PerformanceMonitor } from '@react-three/drei'
import type * as THREE from 'three'
import { useExperienceStore } from '../state/useExperienceStore'
import { isDesktopExperience } from '../utils/device'
import { audioController } from '../audio/AudioController'
import { useMusic } from '../audio/useMusic'
import { cameraRig } from '../player/cameraRig'
import { PhysicsWorld } from '../physics/PhysicsWorld'
import { World } from '../world/World'
import { Sun } from '../visuals/Sun'
import { PostProcessing } from '../visuals/PostProcessing'
import { DesktopOnlyGate } from './DesktopOnlyGate'
import { KeyboardStartScreen } from './KeyboardStartScreen'

function Hud() {
  const phase = useExperienceStore((s) => s.phase)
  const paused = useExperienceStore((s) => s.paused)
  const helpVisible = useExperienceStore((s) => s.helpVisible)
  const musicOn = useExperienceStore((s) => s.musicOn)

  if (phase !== 'playing') return null

  return (
    <>
      {paused && (
        <div className="overlay pause-screen">
          <h2>Pausado</h2>
          <p>Pressione Esc para voltar ao mundo</p>
        </div>
      )}

      <div className={`help-panel ${helpVisible ? '' : 'help-hidden'}`}>
        <div className="help-row"><kbd>W A S D</kbd> mover</div>
        <div className="help-row"><kbd>Shift</kbd> correr</div>
        <div className="help-row"><kbd>Espaço</kbd> pular · segure para planar</div>
        <div className="help-row"><kbd>Q / E</kbd> ou arraste o mouse — câmera</div>
        <div className="help-row"><kbd>Esc</kbd> pausar</div>
        <div className="help-row"><kbd>H</kbd> esconder esta ajuda</div>
      </div>

      <div className="music-indicator">
        <kbd>M</kbd> Música: {musicOn ? 'ligada' : 'desligada'}
      </div>
    </>
  )
}

export function Experience() {
  const phase = useExperienceStore((s) => s.phase)
  const worldReady = useExperienceStore((s) => s.worldReady)
  const [sun, setSun] = useState<THREE.Mesh | null>(null)
  const [dpr, setDpr] = useState(() =>
    Math.min(typeof window !== 'undefined' ? window.devicePixelRatio : 1, 1.5)
  )

  useMusic()

  // Gate de plataforma: celular/tablet nunca monta a cena.
  useEffect(() => {
    if (useExperienceStore.getState().phase === 'gate') {
      useExperienceStore.getState().setPhase(isDesktopExperience() ? 'start' : 'blocked')
    }
  }, [])

  // Atalhos globais de teclado.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useExperienceStore.getState()
      if (s.phase === 'start') {
        // Início do áudio dentro do gesto do usuário (política de autoplay).
        audioController.start(s.musicOn)
        s.setPhase('entering')
        return
      }
      if (e.code === 'KeyM') s.setMusicOn(!s.musicOn)
      if (e.code === 'KeyH') s.toggleHelp()
      if (e.code === 'Escape' && s.phase === 'playing') s.setPaused(!s.paused)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Primeiro círculo de chunks pronto → câmera entra suavemente no mundo.
  useEffect(() => {
    if (phase === 'entering' && worldReady) {
      cameraRig.resetIntro()
      const id = setTimeout(() => useExperienceStore.getState().setPhase('playing'), 500)
      return () => clearTimeout(id)
    }
  }, [phase, worldReady])

  if (phase === 'gate') return null
  if (phase === 'blocked') return <DesktopOnlyGate />

  const canvasMounted = phase === 'entering' || phase === 'playing'

  return (
    <div className="experience-root">
      {canvasMounted && (
        <Canvas
          shadows="soft"
          flat
          dpr={dpr}
          camera={{ fov: 55, near: 0.3, far: 2600, position: [0, 26, 40] }}
          gl={{
            antialias: false,
            powerPreference: 'high-performance',
            stencil: false,
          }}
        >
          <color attach="background" args={['#131a38']} />
          <PerformanceMonitor
            onDecline={() => setDpr(1)}
            onIncline={() => setDpr(Math.min(window.devicePixelRatio, 1.5))}
          >
            <Suspense fallback={null}>
              <PhysicsWorld>
                <World />
              </PhysicsWorld>
              <Sun onReady={setSun} />
              <PostProcessing sun={sun} />
            </Suspense>
          </PerformanceMonitor>
        </Canvas>
      )}
      <KeyboardStartScreen />
      <Hud />
    </div>
  )
}
