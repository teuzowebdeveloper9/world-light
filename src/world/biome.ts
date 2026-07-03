/**
 * Paleta e coloração por vértice do terreno, com blending entre macro-biomas
 * (campos ↔ deserto ↔ gelo). Módulo puro — usado pelo Web Worker.
 */
import { smoothstep, clamp, lerp } from '../utils/math'
import type { BiomeWeights } from './noise'

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

// --- Campos (bioma inicial): azuis profundos e verdes frios -------------
const MEADOW_LOW = hexToLinear(0x40685c)
const MEADOW_HIGH = hexToLinear(0x7fae83)
const FOREST_FLOOR = hexToLinear(0x35594f)
const PATH_SAND = hexToLinear(0xb8a578)
const ROCK = hexToLinear(0x6a6390)
const SNOW = hexToLinear(0xeae8f8)

// --- Deserto: areias quentes com dunas rosadas ---------------------------
const DESERT_LOW = hexToLinear(0xd4a96b)
const DESERT_HIGH = hexToLinear(0xecd3a0)
const DESERT_PATH = hexToLinear(0xb08a52)
const DESERT_ROCK = hexToLinear(0x9a6b4f)

// --- Gelo: brancos azulados e gelo profundo -------------------------------
const ICE_LOW = hexToLinear(0xbcd4e8)
const ICE_HIGH = hexToLinear(0xf2f7ff)
const ICE_PATH = hexToLinear(0x9db8d4)
const ICE_ROCK = hexToLinear(0x6e7fa8)

export interface VertexColorInput {
  y: number
  /** normal.y — 1 = plano, 0 = vertical. */
  slopeUp: number
  biome: number
  path: number
  weights: BiomeWeights
  /** ruído -1..1 para quebrar bandas de cor. */
  dither: number
}

export function terrainVertexColor(v: VertexColorInput, out: RGB): RGB {
  const slope = 1 - v.slopeUp
  const hT = clamp((v.y + 6) / 26, 0, 1)
  const rockMix = smoothstep(0.28, 0.52, slope)

  // Campos
  let temperate = mix(MEADOW_LOW, MEADOW_HIGH, hT)
  temperate = mix(temperate, FOREST_FLOOR, smoothstep(0.45, 0.85, v.biome) * 0.55)
  temperate = mix(temperate, PATH_SAND, v.path * 0.7 * (1 - smoothstep(0.2, 0.4, slope)))
  temperate = mix(temperate, ROCK, rockMix)
  temperate = mix(
    temperate,
    SNOW,
    smoothstep(46, 64, v.y) * (1 - smoothstep(0.35, 0.65, slope))
  )

  // Deserto
  let desert = mix(DESERT_LOW, DESERT_HIGH, hT)
  desert = mix(desert, DESERT_PATH, v.path * 0.5)
  desert = mix(desert, DESERT_ROCK, rockMix)

  // Gelo
  let ice = mix(ICE_LOW, ICE_HIGH, hT)
  ice = mix(ice, ICE_PATH, v.path * 0.4)
  ice = mix(ice, ICE_ROCK, rockMix * 0.8)

  // Blend pelos pesos suaves dos biomas.
  const w = v.weights
  let c: RGB = [
    temperate[0] * w.temperate + desert[0] * w.desert + ice[0] * w.ice,
    temperate[1] * w.temperate + desert[1] * w.desert + ice[1] * w.ice,
    temperate[2] * w.temperate + desert[2] * w.desert + ice[2] * w.ice,
  ]

  const d = 1 + v.dither * 0.045
  out[0] = c[0] * d
  out[1] = c[1] * d
  out[2] = c[2] * d
  return out
}
