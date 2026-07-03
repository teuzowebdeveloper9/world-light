/**
 * Ciclo dia/noite: o dia dura 10 minutos, a noite 3.
 * O sol nasce, cruza o céu e se põe; à noite uma lua clara de brilho
 * amarelado assume a iluminação. Estado mutável fora do React — atualizado
 * uma vez por frame no World.
 */
import * as THREE from 'three'
import { smoothstep } from '../utils/math'

export const DAY_SECONDS = 600
export const NIGHT_SECONDS = 180
export const CYCLE_SECONDS = DAY_SECONDS + NIGHT_SECONDS

export const SUN_DISTANCE = 950
export const MOON_DISTANCE = 900

/** Direção ATUAL do sol (mutada in-place; consumidores leem por frame). */
export const sunDirection = new THREE.Vector3(0.28, 0.3, -1).normalize()
/** Direção ATUAL da lua. */
export const moonDirection = new THREE.Vector3(-0.3, -0.4, 0.9).normalize()

export const dayNightState = {
  /** Segundos dentro do ciclo. Começa no meio da manhã. */
  time: 150,
  /** 1 = dia pleno … 0 = noite plena (transição suave no crepúsculo). */
  dayFactor: 1,
  isDay: true,
}

export function updateDayNight(dt: number): void {
  const s = dayNightState
  s.time = (s.time + dt) % CYCLE_SECONDS
  s.isDay = s.time < DAY_SECONDS

  if (s.isDay) {
    const p = s.time / DAY_SECONDS
    // Arco do sol: nasce baixo, culmina alto, se põe.
    const elev = 0.05 + Math.sin(p * Math.PI) * 0.6
    sunDirection.set(0.28, elev, -1).normalize()
    moonDirection.set(-0.3, -0.35, 0.9).normalize() // lua abaixo do horizonte
  } else {
    const p = (s.time - DAY_SECONDS) / NIGHT_SECONDS
    sunDirection.set(0.28, -0.1 - Math.sin(p * Math.PI) * 0.25, -1).normalize()
    const elev = 0.12 + Math.sin(p * Math.PI) * 0.5
    moonDirection.set(-0.3, elev, 0.9).normalize()
  }

  s.dayFactor = smoothstep(-0.05, 0.12, sunDirection.y)
}
