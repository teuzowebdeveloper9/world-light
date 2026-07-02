/** Módulo sempre positivo — essencial para coordenadas locais de chunk com posições negativas. */
export function positiveModulo(value: number, mod: number): number {
  return ((value % mod) + mod) % mod
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}

export function smootherstep01(t: number): number {
  const x = clamp(t, 0, 1)
  return x * x * x * (x * (x * 6 - 15) + 10)
}

/**
 * Fator de amortecimento exponencial independente de frame-rate.
 * Uso: value = lerp(value, target, dampFactor(lambda, dt))
 */
export function dampFactor(lambda: number, dt: number): number {
  return 1 - Math.exp(-lambda * dt)
}
