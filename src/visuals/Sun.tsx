/**
 * Sol gigante no horizonte. O grupo acompanha a câmera (o sol nunca se
 * aproxima), mas continua sendo ocluído pelo terreno — é isso que alimenta
 * os god rays no pós-processamento.
 */
import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { SUN_DIRECTION, SUN_DISTANCE } from './Materials'

interface SunProps {
  onReady: (mesh: THREE.Mesh) => void
}

export function Sun({ onReady }: SunProps) {
  const group = useRef<THREE.Group>(null)
  const mesh = useRef<THREE.Mesh>(null)

  useEffect(() => {
    if (mesh.current) onReady(mesh.current)
  }, [onReady])

  useFrame(({ camera }) => {
    group.current?.position.copy(camera.position)
  })

  return (
    <group ref={group}>
      <mesh
        ref={mesh}
        position={[
          SUN_DIRECTION.x * SUN_DISTANCE,
          SUN_DIRECTION.y * SUN_DISTANCE,
          SUN_DIRECTION.z * SUN_DISTANCE,
        ]}
        frustumCulled={false}
      >
        <sphereGeometry args={[105, 32, 32]} />
        {/* Cor HDR acima de 1.0 — o bloom e os god rays fazem o resto. */}
        <meshBasicMaterial color={[3.1, 2.6, 1.9]} fog={false} toneMapped={false} />
      </mesh>
    </group>
  )
}
