/**
 * Sol gigante e lua clara de brilho amarelado. O grupo acompanha a câmera
 * (os astros nunca se aproximam), mas continua ocluído pelo terreno — é isso
 * que alimenta os god rays. As posições seguem o ciclo dia/noite por frame.
 */
import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { MOON_DISTANCE, SUN_DISTANCE, moonDirection, sunDirection } from './dayNight'

interface SunProps {
  onReady: (mesh: THREE.Mesh) => void
}

export function Sun({ onReady }: SunProps) {
  const group = useRef<THREE.Group>(null)
  const sun = useRef<THREE.Mesh>(null)
  const moon = useRef<THREE.Mesh>(null)

  useEffect(() => {
    if (sun.current) onReady(sun.current)
  }, [onReady])

  useFrame(({ camera }) => {
    const g = group.current
    if (!g) return
    g.position.copy(camera.position)
    sun.current?.position.set(
      sunDirection.x * SUN_DISTANCE,
      sunDirection.y * SUN_DISTANCE,
      sunDirection.z * SUN_DISTANCE
    )
    moon.current?.position.set(
      moonDirection.x * MOON_DISTANCE,
      moonDirection.y * MOON_DISTANCE,
      moonDirection.z * MOON_DISTANCE
    )
  })

  return (
    <group ref={group}>
      <mesh ref={sun} frustumCulled={false}>
        <sphereGeometry args={[105, 32, 32]} />
        {/* Cor HDR acima de 1.0 — o bloom e os god rays fazem o resto. */}
        <meshBasicMaterial color={[3.1, 2.6, 1.9]} fog={false} toneMapped={false} />
      </mesh>
      {/* Lua clara com brilho bem amarelado. */}
      <mesh ref={moon} frustumCulled={false}>
        <sphereGeometry args={[62, 24, 24]} />
        <meshBasicMaterial color={[2.4, 2.15, 1.25]} fog={false} toneMapped={false} />
      </mesh>
    </group>
  )
}
