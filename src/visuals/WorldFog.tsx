/**
 * Neblina atmosférica exponencial — funde o fim dos chunks com o horizonte
 * do céu, escondendo o surgimento de terreno novo.
 */
export const FOG_COLOR = '#8d84c8'
export const FOG_DENSITY = 0.0026

export function WorldFog() {
  return <fogExp2 attach="fog" args={[FOG_COLOR, FOG_DENSITY]} />
}
