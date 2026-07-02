/**
 * Personagem em terceira pessoa:
 * - Modelo 3D real (KayKit Adventurers — Mago, licença CC0) com pernas,
 *   rigged e animado: Idle / Walking / Running / Jump com crossfade suave
 * - RigidBody dinâmico com rotações travadas + capsule collider
 * - grounded detection ANALÍTICO (amostra a mesma função de altura do terreno)
 * - clamp de segurança: mesmo que um collider ainda não exista, o player
 *   jamais atravessa o chão
 * - pulo com peso, VOO segurando Espaço (energia que recarrega no chão)
 *   e planar suave quando a energia acaba
 */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useAnimations, useGLTF } from '@react-three/drei'
import { CapsuleCollider, RigidBody, type RapierRigidBody } from '@react-three/rapier'
import { CoefficientCombineRule } from '@dimforge/rapier3d-compat'
import { useExperienceStore } from '../state/useExperienceStore'
import { getTerrainSampler } from '../world/noise'
import { clamp, dampFactor, lerp } from '../utils/math'
import { bindPlayerInput, input, playerState } from './PlayerController'
import { cameraRig } from './cameraRig'
import { WindCloth } from './WindCloth'

const MODEL_URL = `${import.meta.env.BASE_URL}models/character.glb`
useGLTF.preload(MODEL_URL)

const CAPSULE_HALF = 0.45
const CAPSULE_RADIUS = 0.3
const FEET_OFFSET = CAPSULE_HALF + CAPSULE_RADIUS

const WALK_SPEED = 5.5
const RUN_SPEED = 11
const JUMP_VELOCITY = 9.2
/** Queda máxima enquanto plana (segurando Espaço no ar). */
const GLIDE_FALL_SPEED = -2.2
/** Segundos de planagem; recarrega ao pousar. */
const GLIDE_ENERGY_SECONDS = 5

/** Modelo KayKit é game-ready: pés no origin. Pequeno diante do mundo imenso. */
const MODEL_SCALE = 0.9
/**
 * Acessórios escondidos (o GLB vem com todos visíveis ao mesmo tempo).
 * A Mage_Cape original é pequena — usamos a nossa capa grande ao vento.
 */
const HIDDEN_ACCESSORIES = ['Spellbook', 'Spellbook_open', '1H_Wand', 'Mage_Cape']

const SPAWN_X = 0
const SPAWN_Z = 6

type AnimName = 'Idle' | 'Walking_A' | 'Running_A' | 'Jump_Idle'

function CharacterModel() {
  const group = useRef<THREE.Group>(null)
  const { scene, animations } = useGLTF(MODEL_URL)
  const { actions } = useAnimations(animations, group)
  const current = useRef<AnimName | ''>('')

  useEffect(() => {
    scene.scale.setScalar(MODEL_SCALE)
    scene.position.set(0, 0, 0)
    scene.traverse((obj) => {
      if (HIDDEN_ACCESSORIES.includes(obj.name)) obj.visible = false
      if ((obj as THREE.Mesh).isMesh) {
        obj.castShadow = true
        obj.receiveShadow = false
        // Skinned meshes têm bounds instáveis — nunca deixar o culling piscar.
        obj.frustumCulled = false
      }
    })
  }, [scene])

  useFrame(() => {
    const hSpeed = Math.hypot(playerState.velocity.x, playerState.velocity.z)
    let target: AnimName
    if (!playerState.grounded) {
      target = 'Jump_Idle'
    } else if (hSpeed > 6.5) {
      target = 'Running_A'
    } else if (hSpeed > 0.5) {
      target = 'Walking_A'
    } else {
      target = 'Idle'
    }

    if (target !== current.current) {
      const next = actions[target]
      const prev = current.current ? actions[current.current] : null
      if (next) {
        next.reset().fadeIn(0.22).play()
        prev?.fadeOut(0.22)
        current.current = target
      }
    }

    // Cadência dos passos acompanha a velocidade real.
    const active = current.current ? actions[current.current] : null
    if (active) {
      if (current.current === 'Walking_A') {
        active.timeScale = clamp(hSpeed / 3.6, 0.75, 1.6)
      } else if (current.current === 'Running_A') {
        active.timeScale = clamp(hSpeed / 8.5, 0.85, 1.35)
      } else {
        active.timeScale = 1
      }
    }
  })

  // Capa grande e fluida presa nos ombros, animada pelo vento global
  // e pela velocidade do player.
  return (
    <group ref={group}>
      <primitive object={scene} />
      <WindCloth />
    </group>
  )
}

export function Player() {
  const rb = useRef<RapierRigidBody>(null)
  const visual = useRef<THREE.Group>(null)
  const seed = useExperienceStore((s) => s.seed)
  const sampler = useMemo(() => getTerrainSampler(seed), [seed])
  const spawn = useMemo<[number, number, number]>(
    () => [SPAWN_X, sampler.height(SPAWN_X, SPAWN_Z) + FEET_OFFSET + 1.2, SPAWN_Z],
    [sampler]
  )
  const prevJump = useRef(false)
  const glideEnergy = useRef(GLIDE_ENERGY_SECONDS)
  const visualY = useRef(-FEET_OFFSET)

  useEffect(() => {
    playerState.position.set(spawn[0], spawn[1] - FEET_OFFSET, spawn[2])
    const unbindKeys = bindPlayerInput()

    // Órbita opcional com arrasto do mouse.
    let dragging = false
    const down = (e: PointerEvent) => {
      if (e.button === 0) dragging = true
    }
    const up = () => {
      dragging = false
    }
    const move = (e: PointerEvent) => {
      if (dragging) cameraRig.addMouseYaw(-e.movementX)
    }
    window.addEventListener('pointerdown', down)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointermove', move)
    return () => {
      unbindKeys()
      window.removeEventListener('pointerdown', down)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointermove', move)
    }
  }, [spawn])

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.05)
    const { phase, paused } = useExperienceStore.getState()
    const body = rb.current

    if (body) {
      const t = body.translation()
      const lv = body.linvel()
      const groundH = sampler.height(t.x, t.z)
      const feetY = t.y - FEET_OFFSET
      const grounded = feetY - groundH < 0.22 && lv.y <= 0.5

      if (phase === 'playing' && !paused) {
        const yaw = cameraRig.yaw
        const f = (input.forward ? 1 : 0) - (input.back ? 1 : 0)
        const r = (input.right ? 1 : 0) - (input.left ? 1 : 0)
        let dx = 0
        let dz = 0
        if (f !== 0 || r !== 0) {
          dx = -Math.sin(yaw) * f + Math.cos(yaw) * r
          dz = -Math.cos(yaw) * f - Math.sin(yaw) * r
          const len = Math.hypot(dx, dz)
          dx /= len
          dz /= len
        }

        const targetSpeed = input.run ? RUN_SPEED : WALK_SPEED
        const control = grounded ? 10 : 4 // menos controle no ar
        const k = dampFactor(control, dt)
        const vx = lerp(lv.x, dx * targetSpeed, k)
        const vz = lerp(lv.z, dz * targetSpeed, k)
        let vy = lv.y

        if (grounded) {
          glideEnergy.current = Math.min(
            GLIDE_ENERGY_SECONDS,
            glideEnergy.current + dt * 2
          )
          // Nada de força extra contra o chão: pressionar a cápsula no
          // trimesh a faz travar em arestas internas dos triângulos e o
          // movimento morre. A gravidade (-24) já cola no terreno; o toque
          // dos pés no chão é garantido pelo snap visual.
          if (input.jump && !prevJump.current) {
            vy = JUMP_VELOCITY
          }
        } else if (input.jump && vy < 0 && glideEnergy.current > 0) {
          // Planar: segurando Espaço na queda ele desce um pouco mais devagar,
          // por bem pouco tempo — sem voar. A gravidade sempre vence.
          vy = Math.max(vy, GLIDE_FALL_SPEED)
          glideEnergy.current -= dt
        }
        prevJump.current = input.jump

        body.setLinvel({ x: vx, y: vy, z: vz }, true)
      }

      // Rede de segurança analítica: nunca atravessa o terreno.
      if (feetY < groundH - 0.5) {
        body.setTranslation({ x: t.x, y: groundH + FEET_OFFSET + 0.4, z: t.z }, true)
        body.setLinvel({ x: lv.x, y: 0, z: lv.z }, true)
      }

      playerState.position.set(t.x, feetY, t.z)
      playerState.velocity.set(lv.x, lv.y, lv.z)
      playerState.grounded = grounded

      const hSpeed = Math.hypot(lv.x, lv.z)
      playerState.speedFactor = lerp(
        playerState.speedFactor,
        clamp(hSpeed / RUN_SPEED, 0, 1),
        dampFactor(4, dt)
      )
      playerState.walkPhase += hSpeed * dt * 1.9

      if (visual.current) {
        if (hSpeed > 0.6) {
          const targetYaw = Math.atan2(lv.x, lv.z)
          let dyaw = targetYaw - playerState.facing
          dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw))
          playerState.facing += dyaw * dampFactor(10, dt)
        }
        visual.current.rotation.y = playerState.facing
        // Snap visual ao terreno: em rampas a cápsula apoia na borda e o
        // centro fica mais alto que o chão logo abaixo — o modelo desce até
        // a altura real do terreno para os pés sempre tocarem o chão.
        let targetY = -FEET_OFFSET
        if (grounded) {
          targetY -= clamp(feetY - groundH, 0, 0.5)
        }
        visualY.current = lerp(visualY.current, targetY, dampFactor(18, dt))
        visual.current.position.y = visualY.current
      }
    }

    cameraRig.update(state.camera, dt, phase === 'playing')
  })

  return (
    <RigidBody
      ref={rb}
      position={spawn}
      colliders={false}
      enabledRotations={[false, false, false]}
      linearDamping={0}
      canSleep={false}
      ccd
    >
      {/* Atrito ZERO com regra Min: a velocidade horizontal é 100% dirigida
          por código — o atrito do terreno nunca pode frear o movimento. */}
      <CapsuleCollider
        args={[CAPSULE_HALF, CAPSULE_RADIUS]}
        friction={0}
        frictionCombineRule={CoefficientCombineRule.Min}
        restitution={0}
      />
      <group ref={visual} position={[0, -FEET_OFFSET, 0]}>
        <CharacterModel />
      </group>
    </RigidBody>
  )
}
