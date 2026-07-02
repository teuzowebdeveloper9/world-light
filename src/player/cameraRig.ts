/**
 * Câmera em terceira pessoa: baixa e próxima do chão para o mundo parecer
 * gigante. Q/E e arrasto do mouse orbitam; a entrada no mundo é uma
 * aproximação cinematográfica lenta vinda do alto.
 */
import * as THREE from 'three'
import { dampFactor, lerp, smootherstep01 } from '../utils/math'
import { getTerrainSampler } from '../world/noise'
import { WORLD_SEED } from '../world/chunkTypes'
import { input, playerState } from './PlayerController'

const DISTANCE = 5.6
const HEIGHT = 1.75
const LOOK_HEIGHT = 1.1
const INTRO_SECONDS = 6

class CameraRig {
  yaw = 0
  private pendingMouseYaw = 0
  private introT = 0
  private pos = new THREE.Vector3()
  private look = new THREE.Vector3()
  private initialized = false
  private desired = new THREE.Vector3()
  private lookTarget = new THREE.Vector3()

  addMouseYaw(deltaPx: number): void {
    this.pendingMouseYaw += deltaPx * 0.004
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

    const target = playerState.position
    const sin = Math.sin(this.yaw)
    const cos = Math.cos(this.yaw)

    this.desired.set(target.x + sin * DISTANCE, target.y + HEIGHT, target.z + cos * DISTANCE)

    if (playing && this.introT < 1) {
      this.introT = Math.min(1, this.introT + dt / INTRO_SECONDS)
      const e = smootherstep01(this.introT)
      // Começa alta e distante, mergulha suavemente até a posição de jogo.
      this.desired.set(
        target.x + sin * lerp(26, DISTANCE, e),
        target.y + lerp(17, HEIGHT, e),
        target.z + cos * lerp(26, DISTANCE, e)
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
  }
}

export const cameraRig = new CameraRig()
