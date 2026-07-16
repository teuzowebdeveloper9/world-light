/**
 * O Sábio ✨ — surge após ~3 min de caminhada, a 100m à frente do viajante,
 * anunciado por um pilar de luz (a "animação antes de vê-lo"). De longe é
 * um VULTO: os materiais escurecem com a distância e só os olhos e o orbe
 * do cajado atravessam a penumbra; ao se aproximar, as cores voltam.
 * A menos de ~5m, a tecla H conversa: 50 falas sobre a luz, uma por vez
 * (ver sageLines.ts). Depois da última, ele parte subindo num feixe de luz.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useAnimations, useGLTF } from '@react-three/drei'
import { useExperienceStore } from '../state/useExperienceStore'
import { playerState } from '../player/PlayerController'
import { getTerrainSampler } from '../world/noise'
import { sfxController } from '../audio/SfxController'
import { clamp, dampFactor, smoothstep } from '../utils/math'
import { NPC_TEST_MODE } from './npcShared'

export const SAGE_MODEL_URL = `${import.meta.env.BASE_URL}models/sage.glb`

const HEIGHT = 1.8
/** "ele vai aparecer em 100 metros como um vulto". */
const APPEAR_DISTANCE = 100
const TALK_DISTANCE = 5.5
/** Afastar-se além disso no meio da conversa fecha o diálogo (retomável). */
const DIALOG_BREAK_DISTANCE = 9
/** Perto daqui as cores reais aparecem; longe dali, só a silhueta. */
const SILHOUETTE_NEAR = 16
const SILHOUETTE_FAR = 65
const ARRIVAL_SECONDS = 2.6
const FAREWELL_SECONDS = 3.2

type Stage = 'arriving' | 'present' | 'farewell'

export function Sage() {
  const { scene, animations } = useGLTF(SAGE_MODEL_URL)
  const group = useRef<THREE.Group>(null)
  const pillar = useRef<THREE.Mesh>(null)
  const light = useRef<THREE.PointLight>(null)
  const { actions, mixer } = useAnimations(animations, group)
  const seed = useExperienceStore((s) => s.seed)
  const sampler = useMemo(() => getTerrainSampler(seed), [seed])
  const [gone, setGone] = useState(false)

  const fit = useMemo(() => {
    const box = new THREE.Box3().setFromObject(scene)
    const h = Math.max(box.max.y - box.min.y, 0.001)
    const scale = HEIGHT / h
    return { scale, yOffset: -box.min.y * scale }
  }, [scene])

  // Cores/emissões originais guardadas para o efeito de vulto por distância.
  const mats = useMemo(() => {
    const list: {
      mat: THREE.MeshStandardMaterial
      color: THREE.Color
      emissiveIntensity: number
    }[] = []
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (mesh.isMesh) {
        mesh.castShadow = true
        mesh.frustumCulled = false
        const m = mesh.material
        for (const mat of Array.isArray(m) ? m : [m]) {
          const std = mat as THREE.MeshStandardMaterial
          list.push({ mat: std, color: std.color.clone(), emissiveIntensity: std.emissiveIntensity ?? 1 })
        }
      }
    })
    return list
  }, [scene])

  const pos = useRef(new THREE.Vector3())
  const yaw = useRef(0)
  const stage = useRef<Stage>('arriving')
  const t = useRef(0)
  const rise = useRef(0)
  const fadingOut = useRef(false)
  const spawned = useRef(false)

  // Materializa a ~100m NA DIREÇÃO em que o viajante olha — quem anda para
  // frente vai vê-lo crescer no horizonte, não nas costas. Sonda alguns
  // ângulos ao redor e prefere o primeiro chão razoavelmente PLANO: spawnar
  // num paredão íngreme deixaria o encontro fisicamente inalcançável.
  useEffect(() => {
    // Um spawn por vida: se alguma dep trocar de identidade num re-render,
    // re-executar aqui TELEPORTARIA o sábio para +100m dali.
    if (spawned.current) return
    spawned.current = true
    const p = playerState.position
    // Modo teste: pertinho, à direita da princesa — sem sonda de terreno.
    const appearDist = NPC_TEST_MODE ? 14 : APPEAR_DISTANCE
    const baseAngle = playerState.facing + (NPC_TEST_MODE ? 0.55 : 0)
    const normalOut: [number, number, number] = [0, 1, 0]
    let x = p.x + Math.sin(baseAngle) * appearDist
    let z = p.z + Math.cos(baseAngle) * appearDist
    if (!NPC_TEST_MODE) {
      for (const off of [0, 0.35, -0.35, 0.7, -0.7, 1.05, -1.05]) {
        const cx = p.x + Math.sin(baseAngle + off) * appearDist
        const cz = p.z + Math.cos(baseAngle + off) * appearDist
        const [, nY] = sampler.normal(cx, cz, normalOut)
        if (nY >= 0.82) {
          x = cx
          z = cz
          break
        }
      }
    }
    pos.current.set(x, sampler.height(x, z), z)
    if (import.meta.env.DEV) {
      ;(window as unknown as Record<string, unknown>).__sagePos = pos.current
    }
    yaw.current = Math.atan2(p.x - x, p.z - z)
    // Invisível até o pico do clarão do pilar; posiciona já no commit —
    // sem um frame fantasma na origem do mundo.
    scene.visible = false
    group.current?.position.copy(pos.current)
    group.current?.rotation.set(0, yaw.current, 0)
    sfxController.chime()
    actions.Idle?.play()
  }, [sampler, actions, scene])

  useFrame((_, rawDt) => {
    const g = group.current
    if (!g || gone) return
    const dt = Math.min(rawDt, 0.05)
    const store = useExperienceStore.getState()
    const active = store.phase === 'playing' && !store.paused
    mixer.timeScale = active ? 1 : 0
    if (!active) return

    const pp = playerState.position
    const px = pos.current.x - pp.x
    const pz = pos.current.z - pp.z
    const dist = Math.hypot(px, pz)

    if (import.meta.env.DEV) {
      const w = window as unknown as Record<string, unknown>
      w.__sageStage = stage.current
      w.__sageDist = dist
    }

    if (stage.current === 'arriving') {
      // Pilar de luz anuncia; o sábio se condensa no pico do clarão.
      t.current += dt
      const k = clamp(t.current / ARRIVAL_SECONDS, 0, 1)
      const glow = Math.sin(Math.PI * k)
      if (pillar.current) {
        ;(pillar.current.material as THREE.MeshBasicMaterial).opacity = glow * 0.55
      }
      if (light.current) light.current.intensity = glow * 90
      scene.visible = k > 0.45
      if (k >= 1) stage.current = 'present'
    } else if (stage.current === 'present') {
      // Vulto por distância: escurece cores; olhos/orbe seguem atravessando.
      const f = smoothstep(SILHOUETTE_NEAR, SILHOUETTE_FAR, dist)
      for (const e of mats) {
        e.mat.color.copy(e.color).multiplyScalar(1 - 0.93 * f)
        e.mat.emissiveIntensity = e.emissiveIntensity * (1 - 0.75 * f)
      }

      // Vira-se para o viajante quando ele está por perto.
      if (dist < 40) {
        const facePlayer = Math.atan2(-px, -pz)
        let d = facePlayer - yaw.current
        d = Math.atan2(Math.sin(d), Math.cos(d))
        yaw.current += d * dampFactor(3, dt)
      }

      const near = dist < TALK_DISTANCE
      if (near && store.sageDialogIndex === null && !store.sageDone && !store.sagePromptVisible) {
        store.setSagePrompt(true)
      } else if (store.sagePromptVisible && (!near || store.sageDialogIndex !== null || store.sageDone)) {
        store.setSagePrompt(false)
      }
      // Sair andando no meio da conversa fecha o diálogo (retomável depois).
      if (store.sageDialogIndex !== null && dist > DIALOG_BREAK_DISTANCE) {
        store.closeSageDialog()
      }

      if (store.sageDone) {
        stage.current = 'farewell'
        t.current = 0
        sfxController.chime()
        for (const e of mats) e.mat.transparent = true
        fadingOut.current = true
      }
    } else {
      // Despedida: sobe devagar dentro do feixe e se dissolve.
      t.current += dt
      const k = clamp(t.current / FAREWELL_SECONDS, 0, 1)
      rise.current = k * 3.2
      const glow = Math.sin(Math.PI * k)
      if (pillar.current) {
        ;(pillar.current.material as THREE.MeshBasicMaterial).opacity = glow * 0.5
      }
      if (light.current) light.current.intensity = glow * 70
      for (const e of mats) e.mat.opacity = 1 - k
      if (k >= 1) {
        store.setSagePrompt(false)
        setGone(true)
        return
      }
    }

    g.position.set(pos.current.x, pos.current.y + rise.current, pos.current.z)
    g.rotation.y = yaw.current
  })

  if (gone) return null
  return (
    <group ref={group}>
      <primitive object={scene} scale={fit.scale} position-y={fit.yOffset} />
      {/* Feixe de luz da chegada/partida — aditivo, sem escrever profundidade. */}
      <mesh ref={pillar} position={[0, 13, 0]}>
        <cylinderGeometry args={[1.5, 1.9, 28, 20, 1, true]} />
        <meshBasicMaterial
          color="#ffd9a0"
          transparent
          opacity={0}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      <pointLight ref={light} position={[0, 2.2, 0]} color="#ffd9a0" intensity={0} distance={45} decay={1.6} />
    </group>
  )
}
