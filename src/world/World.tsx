/**
 * Composição da cena: luzes que seguem o player (sombras sempre no lugar
 * certo), névoa, céu, partículas, chunks e o personagem.
 */
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { SUN_DIRECTION, windTimeUniform } from '../visuals/Materials'
import { SkyAtmosphere } from '../visuals/SkyAtmosphere'
import { FloatingParticles } from '../visuals/FloatingParticles'
import { WorldFog } from '../visuals/WorldFog'
import { playerState } from '../player/PlayerController'
import { Player } from '../player/Player'
import { ChunkManager } from './ChunkManager'

export function World() {
  const dirLight = useRef<THREE.DirectionalLight>(null)
  const lightTarget = useMemo(() => new THREE.Object3D(), [])

  useFrame((state, dt) => {
    windTimeUniform.value += Math.min(dt, 0.05)
    void state
    const p = playerState.position
    const light = dirLight.current
    if (light) {
      light.position.set(
        p.x + SUN_DIRECTION.x * 180,
        p.y + SUN_DIRECTION.y * 180,
        p.z + SUN_DIRECTION.z * 180
      )
      lightTarget.position.set(p.x, p.y, p.z)
      lightTarget.updateMatrixWorld()
    }
  })

  return (
    <>
      <WorldFog />
      <hemisphereLight args={['#8b93d6', '#2e2a4a', 0.55]} />
      <ambientLight intensity={0.12} color="#4a4a6a" />
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
      <Player />
    </>
  )
}
