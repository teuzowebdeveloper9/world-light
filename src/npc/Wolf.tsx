/**
 * O Lobo Encapuzado 🐺 — o caçador. Após ~7 min de caminhada ele surge a
 * ~70m ATRÁS do viajante e persegue, sempre um pouco mais rápido que a
 * corrida (11): dá para ganhar tempo, não para fugir para sempre. Um drone
 * grave cresce conforme ele se aproxima. Se ele alcança, a tela escurece
 * aos poucos até o preto total… e o mundo volta como se nada — o lobo se
 * foi, o viajante anda normalmente. A caçada pode se repetir mais tarde.
 * Se o viajante abrir ~170m (planando de um penhasco, p.ex.), ele desiste.
 */
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useAnimations, useGLTF } from '@react-three/drei'
import { useExperienceStore } from '../state/useExperienceStore'
import { playerState } from '../player/PlayerController'
import { getTerrainSampler } from '../world/noise'
import { sfxController } from '../audio/SfxController'
import { clamp, dampFactor } from '../utils/math'
import { npcState, WOLF_AT_SECONDS } from './npcShared'

export const WOLF_MODEL_URL = `${import.meta.env.BASE_URL}models/wolf-hooded.glb`

const HEIGHT = 1.55
const SPAWN_BEHIND = 70
/** Corrida do jogador é 11 — o lobo sempre fecha a distância… */
const BASE_SPEED = 12.6
/** …com fôlego extra quando está muito longe… */
const FAR_SPEED = 14.5
/** …e um quase-alcançar dramático quando está em cima. */
const NEAR_SPEED = 12.0
const CATCH_DISTANCE = 1.25
/** Planar alto salva por um tempo: sem alcance vertical, sem captura. */
const CATCH_HEIGHT = 2.5
const ESCAPE_DISTANCE = 170
/** O CSS leva ~1.9s até o preto total; segura mais um instante de vazio. */
const CAUGHT_SECONDS = 2.6
const RETREAT_SECONDS = 1.6
/** O drone de perigo começa a ser audível a esta distância. */
const DRONE_RANGE = 40

type Stage = 'hidden' | 'chasing' | 'caught' | 'retreat'

export function Wolf() {
  const { scene, animations } = useGLTF(WOLF_MODEL_URL)
  const group = useRef<THREE.Group>(null)
  const { actions, mixer } = useAnimations(animations, group)
  const seed = useExperienceStore((s) => s.seed)
  const sampler = useMemo(() => getTerrainSampler(seed), [seed])

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
  // Montado já no gatilho da primeira caçada (ver NpcEncounters) — as
  // seguintes ele agenda sozinho somando mais WOLF_AT_SECONDS de caminhada.
  const stage = useRef<Stage>('hidden')
  const nextAt = useRef(0)
  const t = useRef(0)

  function spawn(): void {
    const p = playerState.position
    const x = p.x - Math.sin(playerState.facing) * SPAWN_BEHIND
    const z = p.z - Math.cos(playerState.facing) * SPAWN_BEHIND
    pos.current.set(x, sampler.height(x, z), z)
    heading.current.set(0, 1)
    for (const m of mats) {
      m.transparent = false
      m.opacity = 1
    }
    stage.current = 'chasing'
    actions.Run?.reset().fadeIn(0.2).play()
    if (import.meta.env.DEV) {
      ;(window as unknown as Record<string, unknown>).__wolfPos = pos.current
    }
  }

  useFrame((_, rawDt) => {
    const g = group.current
    if (!g) return
    const dt = Math.min(rawDt, 0.05)
    const store = useExperienceStore.getState()
    const active = store.phase === 'playing' && !store.paused
    mixer.timeScale = active ? 1 : 0
    if (import.meta.env.DEV) {
      const w = window as unknown as Record<string, unknown>
      w.__wolfStage = stage.current
      w.__wolfT = t.current
    }
    if (!active) {
      sfxController.setDrone(0)
      return
    }

    if (stage.current === 'hidden') {
      g.visible = false
      if (npcState.walkTime >= nextAt.current) spawn()
      return
    }
    g.visible = true

    const pp = playerState.position
    const dx = pp.x - pos.current.x
    const dz = pp.z - pos.current.z
    const dist = Math.hypot(dx, dz)

    if (stage.current === 'chasing') {
      // Persegue de verdade: mira o viajante com viração suavizada.
      if (dist > 0.01) {
        const inv = 1 / dist
        const k = dampFactor(4.5, dt)
        heading.current.x += (dx * inv - heading.current.x) * k
        heading.current.y += (dz * inv - heading.current.y) * k
        heading.current.normalize()
      }
      const speed = dist > 45 ? FAR_SPEED : dist < 8 ? NEAR_SPEED : BASE_SPEED
      pos.current.x += heading.current.x * speed * dt
      pos.current.z += heading.current.y * speed * dt
      yaw.current = Math.atan2(heading.current.x, heading.current.y)
      const run = actions.Run
      if (run) run.timeScale = clamp(speed / 9, 1, 1.8)

      // Tensão sonora por proximidade.
      sfxController.setDrone(clamp(1 - (dist - 3) / DRONE_RANGE, 0, 1))

      const dy = pp.y - pos.current.y
      if (dist < CATCH_DISTANCE && Math.abs(dy) < CATCH_HEIGHT) {
        // Alcançou: o mundo escurece aos poucos (overlay CSS cuida do fade).
        stage.current = 'caught'
        t.current = 0
        store.setBlackout(true)
        sfxController.setDrone(0)
        sfxController.boom()
        actions.Run?.fadeOut(0.4)
      } else if (dist > ESCAPE_DISTANCE) {
        // O viajante abriu distância demais: desiste e se dissolve.
        stage.current = 'retreat'
        t.current = 0
        sfxController.setDrone(0)
        for (const m of mats) m.transparent = true
      }
    } else if (stage.current === 'caught') {
      t.current += dt
      if (t.current >= CAUGHT_SECONDS) {
        // Preto total: o lobo evapora e a tela volta sozinha (transição CSS).
        stage.current = 'hidden'
        nextAt.current = npcState.walkTime + WOLF_AT_SECONDS
        store.setBlackout(false)
      }
    } else if (stage.current === 'retreat') {
      t.current += dt
      const k = clamp(t.current / RETREAT_SECONDS, 0, 1)
      for (const m of mats) m.opacity = 1 - k
      if (k >= 1) {
        stage.current = 'hidden'
        nextAt.current = npcState.walkTime + WOLF_AT_SECONDS
      }
    }

    pos.current.y = sampler.height(pos.current.x, pos.current.z)
    g.position.copy(pos.current)
    g.rotation.y = yaw.current
  })

  return (
    <group ref={group} visible={false}>
      <primitive object={scene} scale={fit.scale} position-y={fit.yOffset} />
    </group>
  )
}
