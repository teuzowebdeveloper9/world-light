/**
 * Poeira de luz: pontos aditivos com shader próprio que fazem "wrap" em uma
 * caixa ao redor da câmera — densidade constante, custo constante,
 * quantidade limitada (1200) e zero alocação por frame.
 */
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { mulberry32 } from '../world/noise'

const COUNT = 1200
const BOX = new THREE.Vector3(240, 90, 240)

const vertexShader = /* glsl */ `
  attribute float aSeed;
  uniform float uTime;
  uniform vec3 uCenter;
  uniform vec3 uBox;
  varying float vAlpha;

  void main() {
    vec3 p = position;
    p.y += uTime * (1.2 + aSeed * 2.2);
    p.x += sin(uTime * 0.32 + aSeed * 6.2831) * 7.0;
    p.z += cos(uTime * 0.27 + aSeed * 6.2831) * 7.0;

    vec3 rel = mod(p - uCenter + uBox * 0.5, uBox) - uBox * 0.5;
    vec3 world = uCenter + rel;

    vec4 mvPosition = viewMatrix * vec4(world, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    float dist = max(-mvPosition.z, 0.001);
    gl_PointSize = (2.2 + aSeed * 3.4) * (170.0 / dist);

    float twinkle = 0.5 + 0.5 * sin(uTime * (0.8 + aSeed * 2.4) + aSeed * 40.0);
    float nearFade = smoothstep(2.0, 8.0, dist);
    float farFade = smoothstep(130.0, 60.0, dist);
    vAlpha = twinkle * nearFade * farFade;
  }
`

const fragmentShader = /* glsl */ `
  varying float vAlpha;
  uniform vec3 uColor;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.06, d) * vAlpha;
    if (a < 0.003) discard;
    gl_FragColor = vec4(uColor, a);
  }
`

export function FloatingParticles() {
  const points = useRef<THREE.Points>(null)

  const { geometry, material } = useMemo(() => {
    const rng = mulberry32(0x5eed01)
    const positions = new Float32Array(COUNT * 3)
    const seeds = new Float32Array(COUNT)
    for (let i = 0; i < COUNT; i++) {
      positions[i * 3] = (rng() - 0.5) * BOX.x
      positions[i * 3 + 1] = (rng() - 0.5) * BOX.y
      positions[i * 3 + 2] = (rng() - 0.5) * BOX.z
      seeds[i] = rng()
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1))

    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uCenter: { value: new THREE.Vector3() },
        uBox: { value: BOX.clone() },
        // Dourado levemente acima de 1 — pega um brilho suave do bloom.
        uColor: { value: new THREE.Color(1.4, 1.15, 0.75) },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    return { geometry, material }
  }, [])

  useFrame(({ camera, clock }) => {
    material.uniforms.uTime.value = clock.elapsedTime
    ;(material.uniforms.uCenter.value as THREE.Vector3).copy(camera.position)
  })

  return <points ref={points} geometry={geometry} material={material} frustumCulled={false} />
}
