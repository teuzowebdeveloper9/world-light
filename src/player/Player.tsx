/**
 * Personagem em terceira pessoa:
 * - Modelo 3D real (figura encapuzada, malha estática sem rig — sem
 *   animações de Idle/Walk/Run/Jump; o rosto é uma região emissiva que
 *   brilha sozinha, ver blender/hooded_sun_figure_realistic.py)
 * - RigidBody dinâmico com rotações travadas + capsule collider
 * - grounded detection ANALÍTICO (amostra a mesma função de altura do terreno)
 * - clamp de segurança: mesmo que um collider ainda não exista, o player
 *   jamais atravessa o chão
 * - pulo com peso, VOO segurando Espaço (energia que recarrega no chão)
 *   e planar suave quando a energia acaba
 *
 * Game feel (padrões consagrados da indústria):
 * - gravidade assimétrica: queda mais rápida que a subida ("Building a
 *   Better Jump", Kyle Pittman, GDC 2016)
 * - jump cut: soltar Espaço na subida encurta o pulo (altura variável)
 * - coyote time + jump buffering (Celeste / Maddy Thorson)
 * - velocidade terminal de queda
 * - slope limit com transição suave 45°→56°: rampas íngremes não são
 *   escaláveis e deslizam (sem liga/desliga no limiar)
 * - squash no pouso + passos/pulo/pouso sonoros procedurais
 */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useGLTF } from '@react-three/drei'
import { CapsuleCollider, RigidBody, type RapierRigidBody } from '@react-three/rapier'
import { CoefficientCombineRule } from '@dimforge/rapier3d-compat'
import { useExperienceStore } from '../state/useExperienceStore'
import { sfxController } from '../audio/SfxController'
import { getTerrainSampler } from '../world/noise'
import { clamp, dampFactor, lerp, smoothstep } from '../utils/math'
import { bindPlayerInput, input, playerState } from './PlayerController'
import { cameraRig } from './cameraRig'

const MODEL_URL = `${import.meta.env.BASE_URL}models/hooded-figure.glb`
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

/** Gravidade extra na queda — parábola assimétrica, queda "snappy". */
const FALL_GRAVITY_BONUS = -16
/** Gravidade extra na subida com Espaço solto — encurta o pulo (jump cut). */
const LOW_JUMP_GRAVITY_BONUS = -34
/** Velocidade terminal: a queda nunca acelera além disso. */
const TERMINAL_FALL_SPEED = -38
/** Janela de graça para pular após sair de uma borda. */
const COYOTE_TIME = 0.12
/** Apertar pulo até isto antes de pousar ainda dispara no pouso. */
const JUMP_BUFFER_TIME = 0.12
/**
 * Folga pés→chão que ainda conta como contato. Em rampas a cápsula apoia
 * na borda dos triângulos e o centro fica até ~0.5 acima da altura analítica
 * — um limiar apertado (0.22) fazia o estado "no chão" piscar ao andar em
 * qualquer ladeira.
 */
const CONTACT_GAP = 0.42
/** Acima desta folga o player está claramente no ar (gravidade extra vale). */
const AIRBORNE_GAP = 0.5
/** Normal.y onde o deslize de rampa começa a atuar (~45°)… */
const STEEP_NORMAL_Y_START = 0.7
/** …e onde é rampa totalmente intransponível (~56°): sem pulo, deslize máximo.
 * A transição SUAVE entre os dois evita o liga/desliga (tremedeira) no limiar. */
const STEEP_NORMAL_Y_FULL = 0.56
/** Aceleração máxima de deslize ladeira abaixo em rampas intransponíveis. */
const STEEP_SLIDE_ACCEL = 16

/** Modelo já exportado game-ready (pés em Y=0, altura ~1.45 — ver blender/export_game_character.py). */
const MODEL_SCALE = 1

/** Bob vertical no pico da passada (unidades de mundo). */
const WALK_BOB_HEIGHT = 0.06
/** Balanço lateral (rad) — o manto pesado embala de um lado pro outro. */
const WALK_SWAY = 0.05

function CharacterModel() {
  const group = useRef<THREE.Group>(null)
  const { scene } = useGLTF(MODEL_URL)
  const walkBlend = useRef(0)

  useEffect(() => {
    scene.scale.setScalar(MODEL_SCALE)
    scene.position.set(0, 0, 0)
    scene.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        obj.castShadow = true
        obj.receiveShadow = false
      }
    })
  }, [scene])

  // Sem rig/animação real: simula a passada com bob + balanço procedurais na
  // mesma fase (playerState.walkPhase) que já sincroniza o som dos passos —
  // o baque do som cai exatamente no fundo do bob (pé "tocando" o chão).
  useFrame((_, dt) => {
    if (!group.current) return
    const target = playerState.grounded ? playerState.speedFactor : 0
    walkBlend.current = lerp(walkBlend.current, target, dampFactor(8, dt))
    const phase = playerState.walkPhase
    group.current.position.y = Math.abs(Math.sin(phase)) * WALK_BOB_HEIGHT * walkBlend.current
    group.current.rotation.z = Math.sin(phase) * WALK_SWAY * walkBlend.current
  })

  return (
    <group ref={group}>
      <primitive object={scene} />
    </group>
  )
}

export function Player() {
  const rb = useRef<RapierRigidBody>(null)
  const visual = useRef<THREE.Group>(null)
  const seed = useExperienceStore((s) => s.seed)
  const spawnPt = useExperienceStore((s) => s.spawn)
  const sampler = useMemo(() => getTerrainSampler(seed), [seed])
  const spawn = useMemo<[number, number, number]>(
    () => [
      spawnPt.x,
      sampler.height(spawnPt.x, spawnPt.z) + FEET_OFFSET + 1.2,
      spawnPt.z,
    ],
    [sampler, spawnPt]
  )
  const prevJump = useRef(false)
  const glideEnergy = useRef(GLIDE_ENERGY_SECONDS)
  const visualY = useRef(-FEET_OFFSET)
  const coyoteTimer = useRef(1)
  const jumpBuffer = useRef(0)
  const timeSinceJump = useRef(1)
  const lastAirborneVy = useRef(0)
  const prevContact = useRef(false)
  const squash = useRef(0)
  const groundNormal = useRef<[number, number, number]>([0, 1, 0])
  const worldPos = useMemo(() => new THREE.Vector3(), [])

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
      if (dragging) {
        cameraRig.addMouseYaw(-e.movementX)
        cameraRig.addMousePitch(-e.movementY)
      }
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
      const gap = feetY - groundH
      // lv.y sobe até ~3 correndo morro acima (o solver empurra a cápsula
      // ao longo da rampa) — isso ainda é "no chão", não um pulo.
      const contact = gap < CONTACT_GAP && lv.y <= 3
      const airborne = gap > AIRBORNE_GAP
      // Slope limit com transição SUAVE: 0 em ≤45°, 1 em ≥56°. Binário no
      // limiar fazia o estado oscilar e o boneco tremer ladeira acima/abaixo.
      const [nX, nY, nZ] = sampler.normal(t.x, t.z, groundNormal.current)
      const steep = 1 - smoothstep(STEEP_NORMAL_Y_FULL, STEEP_NORMAL_Y_START, nY)
      const tooSteep = nY < STEEP_NORMAL_Y_FULL
      const grounded = contact && !tooSteep

      if (phase === 'playing' && !paused) {
        timeSinceJump.current += dt
        // Coyote time: uma janela de graça após sair da borda.
        if (grounded) coyoteTimer.current = 0
        else coyoteTimer.current += dt
        // Jump buffering: o aperto de Espaço vale por alguns frames.
        if (input.jump && !prevJump.current) jumpBuffer.current = JUMP_BUFFER_TIME
        else jumpBuffer.current = Math.max(0, jumpBuffer.current - dt)
        prevJump.current = input.jump

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

        // Rampa íngreme: atenua a componente de subida do input (proporcional
        // ao quão íngreme — nunca um corte binário).
        const nH = Math.hypot(nX, nZ)
        if (steep > 0 && gap < 0.6 && nH > 1e-4 && (dx !== 0 || dz !== 0)) {
          const upX = -nX / nH
          const upZ = -nZ / nH
          const climb = dx * upX + dz * upZ
          if (climb > 0) {
            dx -= upX * climb * steep
            dz -= upZ * climb * steep
          }
        }

        const targetSpeed = input.run ? RUN_SPEED : WALK_SPEED
        const control = grounded ? 10 : 4 // menos controle no ar
        const k = dampFactor(control, dt)
        let vx = lerp(lv.x, dx * targetSpeed, k)
        let vz = lerp(lv.z, dz * targetSpeed, k)
        let vy = lv.y

        // Parado no chão sem input: zera o resíduo horizontal de uma vez.
        // A cápsula sem atrito escorrega em qualquer inclinação (o solver
        // converte gravidade em deslize tangencial a cada passo) e atinge
        // equilíbrio de até ~1.4 m/s contra o damping — o boneco "andava
        // sozinho" ladeira abaixo para sempre. O freio suave leva a corrida
        // até 2.5 m/s; daí o corte para 0 é imperceptível.
        if (f === 0 && r === 0 && grounded && Math.hypot(vx, vz) < 2.5) {
          vx = 0
          vz = 0
        }

        // Gravidade assimétrica ("Building a Better Jump", GDC 2016), SÓ
        // quando claramente no ar: perto do chão o solver gera vy positivo
        // ao subir ladeiras e a gravidade extra brigava com ele (tremedeira
        // + arrasto morro abaixo). O jump cut só vale logo após um pulo.
        if (airborne) {
          if (vy < 0) vy += FALL_GRAVITY_BONUS * dt
          else if (!input.jump && timeSinceJump.current < 0.45)
            vy += LOW_JUMP_GRAVITY_BONUS * dt
        }

        if (contact) {
          glideEnergy.current = Math.min(
            GLIDE_ENERGY_SECONDS,
            glideEnergy.current + dt * 2
          )
        }

        // Nada de força extra contra o chão parado: pressionar a cápsula no
        // trimesh a faz travar em arestas internas dos triângulos e o
        // movimento morre. A gravidade (-24) já cola no terreno; o toque
        // dos pés no chão é garantido pelo snap visual.
        const canJump = grounded || (coyoteTimer.current < COYOTE_TIME && vy <= 0.5)
        if (jumpBuffer.current > 0 && canJump) {
          vy = JUMP_VELOCITY
          jumpBuffer.current = 0
          coyoteTimer.current = COYOTE_TIME
          timeSinceJump.current = 0
          sfxController.jump()
        } else if (!contact && input.jump && vy < 0 && glideEnergy.current > 0) {
          // Planar: segurando Espaço na queda ele desce um pouco mais devagar,
          // por bem pouco tempo — sem voar. A gravidade sempre vence.
          vy = Math.max(vy, GLIDE_FALL_SPEED)
          glideEnergy.current -= dt
        }

        // Deslize ladeira abaixo proporcional à inclinação da rampa.
        // (Nunca um puxão vertical contra o chão: esmagar a cápsula sem
        // atrito no trimesh vira deslize horizontal e o boneco "anda sozinho".)
        if (steep > 0.01 && gap < 0.5 && nH > 1e-4) {
          vx += (nX / nH) * STEEP_SLIDE_ACCEL * steep * dt
          vz += (nZ / nH) * STEEP_SLIDE_ACCEL * steep * dt
        }

        // Velocidade terminal: queda legível, sem risco de tunneling.
        vy = Math.max(vy, TERMINAL_FALL_SPEED)

        body.setLinvel({ x: vx, y: vy, z: vz }, true)
      }

      // Rede de segurança analítica: nunca atravessa o terreno.
      if (feetY < groundH - 0.5) {
        body.setTranslation({ x: t.x, y: groundH + FEET_OFFSET + 0.4, z: t.z }, true)
        body.setLinvel({ x: lv.x, y: 0, z: lv.z }, true)
      }

      // Pouso: squash & stretch + baque sonoro proporcionais à queda.
      if (contact && !prevContact.current && lastAirborneVy.current < -4) {
        const impact = clamp(-lastAirborneVy.current / -TERMINAL_FALL_SPEED, 0, 1)
        squash.current = Math.max(squash.current, 0.08 + impact * 0.2)
        sfxController.land(impact)
      }
      if (!contact) lastAirborneVy.current = lv.y
      prevContact.current = contact

      // Posição para câmera/chunks: o transform do grupo do RigidBody é o
      // interpolado (timestep fixo + interpolação) — follow liso em qualquer Hz.
      const rbObject = visual.current?.parent
      if (rbObject) {
        rbObject.getWorldPosition(worldPos)
        playerState.position.set(worldPos.x, worldPos.y - FEET_OFFSET, worldPos.z)
      } else {
        playerState.position.set(t.x, feetY, t.z)
      }
      playerState.velocity.set(lv.x, lv.y, lv.z)
      playerState.grounded = grounded

      const hSpeed = Math.hypot(lv.x, lv.z)
      playerState.speedFactor = lerp(
        playerState.speedFactor,
        clamp(hSpeed / RUN_SPEED, 0, 1),
        dampFactor(4, dt)
      )
      const prevWalkPhase = playerState.walkPhase
      playerState.walkPhase += hSpeed * dt * 1.9
      // Passos sincronizados ao ciclo de caminhada (um por meia fase).
      if (
        phase === 'playing' &&
        !paused &&
        grounded &&
        hSpeed > 1.2 &&
        Math.floor(playerState.walkPhase / Math.PI) !== Math.floor(prevWalkPhase / Math.PI)
      ) {
        sfxController.footstep(clamp(hSpeed / RUN_SPEED, 0.25, 1))
      }

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

        // Squash & stretch do pouso (princípio nº 1 de animação): amassa no
        // impacto preservando volume e recupera sozinho em ~0,2s.
        squash.current = lerp(squash.current, 0, dampFactor(9, dt))
        const s = squash.current
        visual.current.scale.set(1 + s * 0.5, 1 - s, 1 + s * 0.5)
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
