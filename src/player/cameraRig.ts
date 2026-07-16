/**
 * Câmera em terceira pessoa: baixa e próxima do chão para o mundo parecer
 * gigante. Q/E e arrasto do mouse orbitam (yaw + pitch com clamp); a entrada
 * no mundo é uma aproximação cinematográfica lenta vinda do alto.
 * FOV "kick" suave durante o sprint amplia a sensação de velocidade.
 */
import * as THREE from 'three'
import { clamp, dampFactor, lerp, smoothstep, smootherstep01 } from '../utils/math'
import { getTerrainSampler } from '../world/noise'
import { WORLD_SEED } from '../world/chunkTypes'
import { input, playerState } from './PlayerController'

const DISTANCE = 5.6
const HEIGHT = 1.75
const LOOK_HEIGHT = 1.1
const INTRO_SECONDS = 6
/** Pitch em rad: negativo olha para cima, positivo orbita por cima. */
const PITCH_MIN = -0.3
const PITCH_MAX = 0.9
const BASE_FOV = 55
const SPRINT_FOV_KICK = 8

class CameraRig {
  yaw = 0
  pitch = 0
  private pendingMouseYaw = 0
  private pendingMousePitch = 0
  private introT = 0
  private pos = new THREE.Vector3()
  private look = new THREE.Vector3()
  private initialized = false
  private desired = new THREE.Vector3()
  private lookTarget = new THREE.Vector3()
  private fov = BASE_FOV

  addMouseYaw(deltaPx: number): void {
    this.pendingMouseYaw += deltaPx * 0.004
  }

  addMousePitch(deltaPx: number): void {
    this.pendingMousePitch += deltaPx * 0.0035
  }

  resetIntro(): void {
    this.introT = 0
    this.initialized = false
  }

  update(camera: THREE.Camera, dt: number, playing: boolean): void {
    if (input.rotateLeft) this.yaw += 1.9 * dt
    if (input.rotateRight) this.yaw -= 1.9 * dt
    this.yaw += this.pendingMouseYaw
    this.pendingMouseYaw = 0
    this.pitch = clamp(this.pitch + this.pendingMousePitch, PITCH_MIN, PITCH_MAX)
    this.pendingMousePitch = 0

    const target = playerState.position
    const sin = Math.sin(this.yaw)
    const cos = Math.cos(this.yaw)
    const horiz = DISTANCE * Math.cos(this.pitch)

    this.desired.set(
      target.x + sin * horiz,
      target.y + HEIGHT + Math.sin(this.pitch) * DISTANCE,
      target.z + cos * horiz
    )

    if (playing && this.introT < 1) {
      this.introT = Math.min(1, this.introT + dt / INTRO_SECONDS)
      const e = smootherstep01(this.introT)
      // Começa alta e distante, mergulha suavemente até a posição de jogo.
      this.desired.set(
        target.x + sin * lerp(26, horiz, e),
        target.y + lerp(17, HEIGHT + Math.sin(this.pitch) * DISTANCE, e),
        target.z + cos * lerp(26, horiz, e)
      )
    }

    // Nunca deixa a câmera entrar no terreno.
    const sampler = getTerrainSampler(WORLD_SEED)
    const groundY = sampler.height(this.desired.x, this.desired.z) + 1.0
    if (this.desired.y < groundY) this.desired.y = groundY

    this.lookTarget.set(target.x, target.y + LOOK_HEIGHT, target.z)

    if (!this.initialized) {
      this.pos.copy(this.desired)
      this.look.copy(this.lookTarget)
      this.initialized = true
    } else {
      this.pos.lerp(this.desired, dampFactor(5.5, dt))
      this.look.lerp(this.lookTarget, dampFactor(8, dt))
    }

    camera.position.copy(this.pos)
    camera.lookAt(this.look)

    // FOV kick: só quando de fato correndo perto da velocidade máxima.
    const pc = camera as THREE.PerspectiveCamera
    if (pc.isPerspectiveCamera) {
      const targetFov = playing
        ? BASE_FOV + SPRINT_FOV_KICK * smoothstep(0.6, 1, playerState.speedFactor)
        : BASE_FOV
      this.fov = lerp(this.fov, targetFov, dampFactor(5, dt))
      if (Math.abs(pc.fov - this.fov) > 0.01) {
        pc.fov = this.fov
        pc.updateProjectionMatrix()
      }
    }
  }
}

export const cameraRig = new CameraRig()

// Inspeção/direção via console/Playwright durante o desenvolvimento.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as Record<string, unknown>).__cameraRig = cameraRig
}
