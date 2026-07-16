/**
 * A Princesa da Luz 👑 — o primeiro encontro do jogo.
 * Aparece a poucos metros do viajante logo que o mundo abre, encara-o por
 * um instante… e FOGE. Inalcançável por design: a velocidade dela é sempre
 * a do jogador somada a uma folga (e nunca abaixo de 15 — a corrida do
 * jogador é 11), então perseguir só torna a fuga mais bonita. Longe o
 * bastante, ela se desfaz em luz (fade + sino) em vez de simplesmente sumir.
 *
 * Sem física: segue a altura analítica do terreno, no padrão do DogManager.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useAnimations, useGLTF } from '@react-three/drei'
import { useExperienceStore } from '../state/useExperienceStore'
import { playerState } from '../player/PlayerController'
import { cameraRig } from '../player/cameraRig'
import { getTerrainSampler } from '../world/noise'
import { sfxController } from '../audio/SfxController'
import { clamp, dampFactor } from '../utils/math'

export const PRINCESS_MODEL_URL = `${import.meta.env.BASE_URL}models/princess.glb`
useGLTF.preload(PRINCESS_MODEL_URL)

const HEIGHT = 1.02
/** Distância à frente do viajante onde ela aparece no início. */
const APPEAR_AHEAD = 9
/** Quanto tempo ela encara o viajante antes de disparar — contado só
 * DEPOIS da intro da câmera terminar (em 60fps ela disparava no meio do
 * mergulho cinematográfico e ninguém chegava a vê-la). */
const WAIT_SECONDS = 2.5
/** Chegar mais perto que isso corta a espera: ela dispara na hora. */
const PANIC_DISTANCE = 5
/** Piso de velocidade de fuga — sempre acima da corrida do jogador (11). */
const MIN_FLEE_SPEED = 15
/** …e sempre esta margem acima da velocidade ATUAL do jogador. */
const FLEE_MARGIN = 4
const ACCEL = 16
/** Começa a se desfazer em luz aqui… */
const FADE_START = 95
/** …e some de vez aqui. */
const GONE_DISTANCE = 130

export function Princess() {
  const { scene, animations } = useGLTF(PRINCESS_MODEL_URL)
  const group = useRef<THREE.Group>(null)
  const { actions, mixer } = useAnimations(animations, group)
  const seed = useExperienceStore((s) => s.seed)
  const sampler = useMemo(() => getTerrainSampler(seed), [seed])
  const [gone, setGone] = useState(false)

  // Normaliza o GLB para a altura dela com a base exatamente no chão.
  const fit = useMemo(() => {
    const box = new THREE.Box3().setFromObject(scene)
    const h = Math.max(box.max.y - box.min.y, 0.001)
    const scale = HEIGHT / h
    return { scale, yOffset: -box.min.y * scale }
  }, [scene])

  const mats = useMemo(() => {
    const list: THREE.MeshStandardMaterial[] = []
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (mesh.isMesh) {
        mesh.castShadow = true
        // O mixer move as partes (cabelo/saia) dentro do grupo — sem cull
        // por parte, senão uma mecha some no canto da tela.
        mesh.frustumCulled = false
        const m = mesh.material
        for (const mat of Array.isArray(m) ? m : [m]) {
          list.push(mat as THREE.MeshStandardMaterial)
        }
      }
    })
    return list
  }, [scene])

  const pos = useRef(new THREE.Vector3())
  const heading = useRef(new THREE.Vector2())
  const yaw = useRef(0)
  const speed = useRef(0)
  const timer = useRef(WAIT_SECONDS)
  const fleeing = useRef(false)
  const fading = useRef(false)
  const glow = useRef<THREE.PointLight>(null)

  // Nasce alguns metros à frente do viajante, de frente para ele.
  useEffect(() => {
    const p = playerState.position
    const dx = Math.sin(playerState.facing)
    const dz = Math.cos(playerState.facing)
    const x = p.x + dx * APPEAR_AHEAD
    const z = p.z + dz * APPEAR_AHEAD
    pos.current.set(x, sampler.height(x, z), z)
    heading.current.set(dx, dz)
    yaw.current = Math.atan2(p.x - x, p.z - z)
    // Posiciona já no commit — sem um frame fantasma na origem do mundo.
    group.current?.position.copy(pos.current)
    group.current?.rotation.set(0, yaw.current, 0)
    if (import.meta.env.DEV) {
      ;(window as unknown as Record<string, unknown>).__princessPos = pos.current
    }
  }, [sampler])

  useFrame((_, rawDt) => {
    const g = group.current
    if (!g || gone) return
    const dt = Math.min(rawDt, 0.05)
    const { phase, paused } = useExperienceStore.getState()
    const active = phase === 'playing' && !paused
    // Pausa congela a animação também (o useAnimations avança o mixer sozinho).
    mixer.timeScale = active ? 1 : 0
    if (!active) return

    const pp = playerState.position
    const px = pos.current.x - pp.x
    const pz = pos.current.z - pp.z
    const dist = Math.hypot(px, pz)

    if (!fleeing.current) {
      // O relógio da fuga só corre depois da intro; chegar perto assusta
      // e dispara na hora de qualquer jeito.
      if (cameraRig.introDone) timer.current -= dt
      // Encara o viajante enquanto espera.
      const facePlayer = Math.atan2(-px, -pz)
      let d = facePlayer - yaw.current
      d = Math.atan2(Math.sin(d), Math.cos(d))
      yaw.current += d * dampFactor(6, dt)
      if (timer.current <= 0 || dist < PANIC_DISTANCE) {
        fleeing.current = true
        actions.Run?.reset().fadeIn(0.15).play()
      }
    } else {
      // Direção de fuga: para longe do viajante, com viração suavizada
      // (sem teleporte de direção quando o jogador dá a volta).
      if (dist > 0.01) {
        const inv = 1 / dist
        const k = dampFactor(3.5, dt)
        heading.current.x += (px * inv - heading.current.x) * k
        heading.current.y += (pz * inv - heading.current.y) * k
        heading.current.normalize()
      }
      const playerH = Math.hypot(playerState.velocity.x, playerState.velocity.z)
      const target = Math.max(MIN_FLEE_SPEED, playerH + FLEE_MARGIN)
      speed.current = Math.min(target, speed.current + ACCEL * dt)
      pos.current.x += heading.current.x * speed.current * dt
      pos.current.z += heading.current.y * speed.current * dt
      yaw.current = Math.atan2(heading.current.x, heading.current.y)

      const run = actions.Run
      if (run) run.timeScale = clamp(speed.current / 8, 0.8, 2.4)

      if (dist > FADE_START) {
        if (!fading.current) {
          fading.current = true
          for (const m of mats) m.transparent = true
        }
        const opacity = clamp(1 - (dist - FADE_START) / (GONE_DISTANCE - FADE_START), 0, 1)
        for (const m of mats) m.opacity = opacity
        if (glow.current) glow.current.intensity = 2.6 * opacity
        if (opacity <= 0.02) {
          setGone(true)
          sfxController.chime()
          if (import.meta.env.DEV) {
            ;(window as unknown as Record<string, unknown>).__princessGone = true
          }
          return
        }
      }
    }

    pos.current.y = sampler.height(pos.current.x, pos.current.z)
    g.position.copy(pos.current)
    g.rotation.y = yaw.current
  })

  if (gone) return null
  return (
    <group ref={group}>
      <primitive object={scene} scale={fit.scale} position-y={fit.yOffset} />
      {/* Ela é feita de luz: um brilho quente próprio garante que ninguém
          a perca — mesmo nascendo de noite ou em contraluz. */}
      <pointLight ref={glow} position={[0, 1.1, 0]} color="#ffe9c4" intensity={2.6} distance={10} decay={1.8} />
    </group>
  )
}
