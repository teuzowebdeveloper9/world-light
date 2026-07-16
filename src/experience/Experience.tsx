/**
 * Casca da experiência: gate de desktop, Canvas R3F, atalhos globais de
 * teclado (M / H / Esc), HUD minimalista, overlays dos encontros (diálogo
 * do sábio, apagão do lobo) e transição de entrada.
 */
import { Suspense, useEffect, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { PerformanceMonitor } from '@react-three/drei'
import type * as THREE from 'three'
import { useExperienceStore } from '../state/useExperienceStore'
import { isDesktopExperience } from '../utils/device'
import { audioController } from '../audio/AudioController'
import { sfxController } from '../audio/SfxController'
import { useMusic } from '../audio/useMusic'
import { cameraRig } from '../player/cameraRig'
import { PhysicsWorld } from '../physics/PhysicsWorld'
import { World } from '../world/World'
import { Sun } from '../visuals/Sun'
import { PostProcessing } from '../visuals/PostProcessing'
import { SAGE_LINES } from '../npc/sageLines'
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

/** Prompt de conversa e caixa de diálogo do sábio (tecla H). */
function SageDialogHud() {
  const promptVisible = useExperienceStore((s) => s.sagePromptVisible)
  const dialogIndex = useExperienceStore((s) => s.sageDialogIndex)

  if (dialogIndex !== null) {
    return (
      <div className="dialog-box">
        <div className="dialog-speaker">O Sábio</div>
        <p className="dialog-line">{SAGE_LINES[dialogIndex]}</p>
        <div className="dialog-hint">
          <kbd>H</kbd> continuar · {dialogIndex + 1}/{SAGE_LINES.length}
        </div>
      </div>
    )
  }
  if (promptVisible) {
    return (
      <div className="npc-prompt">
        <kbd>H</kbd> falar com o Sábio
      </div>
    )
  }
  return null
}

/** Escurecimento total quando o lobo alcança o viajante — o CSS faz o
 * fade lento nos dois sentidos; aqui só liga/desliga a classe. */
function BlackoutOverlay() {
  const blackout = useExperienceStore((s) => s.blackout)
  return <div className={`blackout ${blackout ? 'blackout-active' : ''}`} />
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
        sfxController.unlock()
        s.setPhase('entering')
        return
      }
      if (e.code === 'KeyM') s.setMusicOn(!s.musicOn)
      // H perto do sábio conversa (abre/avança o diálogo); longe dele,
      // segue sendo o toggle da ajuda de sempre.
      if (e.code === 'KeyH') {
        if (s.sageDialogIndex !== null || s.sagePromptVisible) s.advanceSageDialog()
        else s.toggleHelp()
      }
      if (e.code === 'Escape' && s.phase === 'playing') s.setPaused(!s.paused)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Auto-pause ao perder a aba: voltar nunca te encontra em queda livre.
  useEffect(() => {
    const onVisibility = () => {
      const s = useExperienceStore.getState()
      if (document.hidden && s.phase === 'playing' && !s.paused) s.setPaused(true)
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
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
      <SageDialogHud />
      <BlackoutOverlay />
    </div>
  )
}
