/**
 * Paleta e coloração por vértice do terreno.
 * Módulo puro — usado pelo Web Worker.
 */
import { smoothstep, clamp, lerp } from '../utils/math'

export type RGB = [number, number, number]

function srgbToLinear(c: number): number {
  return Math.pow(c, 2.2)
}

export function hexToLinear(hex: number): RGB {
  return [
    srgbToLinear(((hex >> 16) & 255) / 255),
    srgbToLinear(((hex >> 8) & 255) / 255),
    srgbToLinear((hex & 255) / 255),
  ]
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]
}

// Paleta serena: azuis profundos, verdes frios, areia quente nas trilhas,
// violeta nas rochas e picos quase brancos.
const MEADOW_LOW = hexToLinear(0x40685c)
const MEADOW_HIGH = hexToLinear(0x7fae83)
const FOREST_FLOOR = hexToLinear(0x35594f)
const PATH_SAND = hexToLinear(0xb8a578)
const ROCK = hexToLinear(0x6a6390)
const SNOW = hexToLinear(0xeae8f8)

export interface VertexColorInput {
  y: number
  /** normal.y — 1 = plano, 0 = vertical. */
  slopeUp: number
  biome: number
  path: number
  /** ruído -1..1 para quebrar bandas de cor. */
  dither: number
}

export function terrainVertexColor(v: VertexColorInput, out: RGB): RGB {
  const slope = 1 - v.slopeUp
  let c = mix(MEADOW_LOW, MEADOW_HIGH, clamp((v.y + 6) / 26, 0, 1))
  c = mix(c, FOREST_FLOOR, smoothstep(0.45, 0.85, v.biome) * 0.55)
  c = mix(c, PATH_SAND, v.path * 0.7 * (1 - smoothstep(0.2, 0.4, slope)))
  c = mix(c, ROCK, smoothstep(0.28, 0.52, slope))
  c = mix(c, SNOW, smoothstep(46, 64, v.y) * (1 - smoothstep(0.35, 0.65, slope)))
  const d = 1 + v.dither * 0.045
  out[0] = c[0] * d
  out[1] = c[1] * d
  out[2] = c[2] * d
  return out
}
