/**
 * Composição da cena: ciclo dia/noite, luzes que seguem o player (sombras
 * sempre no lugar certo), névoa, céu, partículas, chunks, cachorros e o
 * personagem. De dia o sol quente ilumina; à noite a lua clara amarelada
 * assume, o céu escurece e as estrelas aparecem.
 */
import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { windTimeUniform } from '../visuals/Materials'
import { dayNightState, moonDirection, sunDirection, updateDayNight } from '../visuals/dayNight'
import { SkyAtmosphere } from '../visuals/SkyAtmosphere'
import { FloatingParticles } from '../visuals/FloatingParticles'
import { WorldFog } from '../visuals/WorldFog'
import { playerState } from '../player/PlayerController'
import { Player } from '../player/Player'
import { NpcEncounters } from '../npc/NpcEncounters'
import { ChunkManager } from './ChunkManager'
import { DogManager } from './DogManager'
import { lerp } from '../utils/math'

const SUN_LIGHT_COLOR = new THREE.Color('#ffe3b3')
const MOON_LIGHT_COLOR = new THREE.Color('#ffedb0')
const FOG_DAY = new THREE.Color('#8d84c8')
const FOG_NIGHT = new THREE.Color('#181c33')

export function World() {
  const dirLight = useRef<THREE.DirectionalLight>(null)
  const hemi = useRef<THREE.HemisphereLight>(null)
  const ambient = useRef<THREE.AmbientLight>(null)
  const lightTarget = useMemo(() => new THREE.Object3D(), [])
  const scene = useThree((s) => s.scene)

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05)
    windTimeUniform.value += dt
    updateDayNight(dt)

    const df = dayNightState.dayFactor
    const p = playerState.position
    const light = dirLight.current
    if (light) {
      // De dia a luz vem do sol; à noite, da lua (transição no crepúsculo).
      const dir = df >= 0.35 ? sunDirection : moonDirection
      light.position.set(p.x + dir.x * 180, p.y + dir.y * 180, p.z + dir.z * 180)
      lightTarget.position.set(p.x, p.y, p.z)
      lightTarget.updateMatrixWorld()
      light.intensity = df >= 0.35 ? lerp(0.7, 2.6, df) : 1.0
      light.color.lerpColors(MOON_LIGHT_COLOR, SUN_LIGHT_COLOR, df)
    }
    if (hemi.current) hemi.current.intensity = lerp(0.2, 0.55, df)
    if (ambient.current) ambient.current.intensity = lerp(0.06, 0.12, df)
    if (scene.fog) (scene.fog as THREE.FogExp2).color.lerpColors(FOG_NIGHT, FOG_DAY, df)
  })

  return (
    <>
      <WorldFog />
      <hemisphereLight ref={hemi} args={['#8b93d6', '#2e2a4a', 0.55]} />
      <ambientLight ref={ambient} intensity={0.12} color="#4a4a6a" />
      <directionalLight
        ref={dirLight}
        target={lightTarget}
        color="#ffe3b3"
        intensity={2.6}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-95}
        shadow-camera-right={95}
        shadow-camera-top={95}
        shadow-camera-bottom={-95}
        shadow-camera-near={20}
        shadow-camera-far={420}
        shadow-bias={-0.0002}
        shadow-normalBias={2.5}
      />
      <primitive object={lightTarget} />

      <SkyAtmosphere />
      <FloatingParticles />
      <ChunkManager />
      <DogManager />
      <NpcEncounters />
      <Player />
    </>
  )
}
