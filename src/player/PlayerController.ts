/**
 * Input de teclado + estado mutável de alta frequência do player.
 * Nada aqui passa pelo React: ChunkManager, câmera e partículas leem
 * `playerState` diretamente a cada frame.
 */
import * as THREE from 'three'

export const input = {
  forward: false,
  back: false,
  left: false,
  right: false,
  run: false,
  jump: false,
  rotateLeft: false,
  rotateRight: false,
}

export const playerState = {
  position: new THREE.Vector3(0, 30, 6),
  velocity: new THREE.Vector3(),
  grounded: false,
  /** Direção visual atual do personagem (rad). */
  facing: Math.PI,
  /** Velocidade horizontal suavizada 0..1 (alimenta capa, túnica e cabelo). */
  speedFactor: 0,
  /** Fase do ciclo de passos — anima as perninhas sob a túnica. */
  walkPhase: 0,
}

const KEY_MAP: Record<string, keyof typeof input> = {
  KeyW: 'forward',
  ArrowUp: 'forward',
  KeyS: 'back',
  ArrowDown: 'back',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  ShiftLeft: 'run',
  ShiftRight: 'run',
  Space: 'jump',
  KeyQ: 'rotateLeft',
  KeyE: 'rotateRight',
}

export function bindPlayerInput(): () => void {
  const down = (e: KeyboardEvent) => {
    const k = KEY_MAP[e.code]
    if (k) {
      input[k] = true
      if (e.code === 'Space') e.preventDefault()
    }
  }
  const up = (e: KeyboardEvent) => {
    const k = KEY_MAP[e.code]
    if (k) input[k] = false
  }
  const blur = () => {
    for (const k of Object.keys(input) as (keyof typeof input)[]) input[k] = false
  }
  window.addEventListener('keydown', down)
  window.addEventListener('keyup', up)
  window.addEventListener('blur', blur)
  return () => {
    window.removeEventListener('keydown', down)
    window.removeEventListener('keyup', up)
    window.removeEventListener('blur', blur)
  }
}
