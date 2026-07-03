/**
 * Domo de céu em shader: gradiente azul profundo → violeta → dourado perto do
 * sol, estrelas sutis no zênite e duas camadas de montanhas-silhueta no
 * horizonte (baked no shader — profundidade infinita a custo zero).
 */
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { dayNightState, moonDirection, sunDirection } from './dayNight'

const vertexShader = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
  }
`

const fragmentShader = /* glsl */ `
  varying vec3 vDir;
  uniform vec3 uSunDir;
  uniform vec3 uMoonDir;
  uniform float uDayFactor;
  uniform vec3 uZenith;
  uniform vec3 uMid;
  uniform vec3 uHorizon;
  uniform vec3 uNightZenith;
  uniform vec3 uNightMid;
  uniform vec3 uNightHorizon;
  uniform vec3 uSunGlow;
  uniform vec3 uRidgeFar;
  uniform vec3 uRidgeNear;

  float hash21(vec2 p) {
    p = fract(p * vec2(234.34, 435.345));
    p += dot(p, p + 34.23);
    return fract(p.x * p.y);
  }

  float ridgeShape(float az, float a, float b, float c, float d) {
    return 0.030 * sin(az * 3.0 + a)
         + 0.020 * sin(az * 7.0 + b)
         + 0.012 * sin(az * 13.0 + c)
         + 0.007 * sin(az * 23.0 + d);
  }

  void main() {
    vec3 dir = normalize(vDir);
    float elev = dir.y;

    // Paleta do momento: dia ↔ noite.
    vec3 zenith = mix(uNightZenith, uZenith, uDayFactor);
    vec3 mid = mix(uNightMid, uMid, uDayFactor);
    vec3 horizon = mix(uNightHorizon, uHorizon, uDayFactor);

    // Gradiente vertical em três paradas.
    vec3 col = mix(horizon, mid, smoothstep(-0.02, 0.18, elev));
    col = mix(col, zenith, smoothstep(0.12, 0.55, elev));

    // Glow quente ao redor do sol.
    float sunAmount = max(dot(dir, uSunDir), 0.0);
    col += uSunGlow * pow(sunAmount, 7.0) * 0.6 * max(uDayFactor, 0.15);
    col += vec3(1.2, 1.05, 0.8) * pow(sunAmount, 48.0) * 0.9;

    // Halo amarelado da lua à noite.
    float moonAmount = max(dot(dir, uMoonDir), 0.0);
    float night = 1.0 - uDayFactor;
    col += vec3(0.95, 0.85, 0.5) * pow(moonAmount, 10.0) * 0.3 * night;
    col += vec3(1.1, 1.0, 0.65) * pow(moonAmount, 90.0) * 1.1 * night;

    // Estrelas — tímidas de dia, brilhantes à noite.
    if (elev > 0.12) {
      vec2 cell = floor(dir.xz / max(elev, 0.001) * 90.0);
      float star = hash21(cell);
      float starMask = smoothstep(0.995, 1.0, star) * smoothstep(0.12, 0.4, elev);
      col += vec3(0.9, 0.92, 1.0) * starMask * mix(1.4, 0.4, uDayFactor);
    }

    // Montanhas-silhueta no horizonte (duas camadas com névoa).
    float az = atan(dir.z, dir.x);
    float far1 = 0.055 + ridgeShape(az, 1.7, 0.3, 4.2, 2.1);
    float near1 = 0.028 + ridgeShape(az, 4.9, 2.6, 0.9, 5.3) * 0.8;
    float farMask = smoothstep(far1 + 0.008, far1 - 0.008, elev);
    float nearMask = smoothstep(near1 + 0.006, near1 - 0.006, elev);
    float ridgeLight = mix(0.35, 1.0, uDayFactor);
    vec3 ridgeFarCol = mix(uRidgeFar, horizon, 0.45) * ridgeLight;
    col = mix(col, ridgeFarCol, farMask * 0.85);
    col = mix(col, uRidgeNear * ridgeLight, nearMask * 0.9);
    // Névoa atmosférica cobre a base do horizonte.
    col = mix(col, horizon, smoothstep(0.03, -0.05, elev) * 0.85);

    gl_FragColor = vec4(col, 1.0);
  }
`

export function SkyAtmosphere() {
  const group = useRef<THREE.Group>(null)

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: {
          uSunDir: { value: sunDirection.clone() },
          uMoonDir: { value: moonDirection.clone() },
          uDayFactor: { value: 1 },
          uZenith: { value: new THREE.Color('#10173a') },
          uMid: { value: new THREE.Color('#3d3a75') },
          uHorizon: { value: new THREE.Color('#b09ad8') },
          uNightZenith: { value: new THREE.Color('#05070f') },
          uNightMid: { value: new THREE.Color('#0d1128') },
          uNightHorizon: { value: new THREE.Color('#1f2547') },
          uSunGlow: { value: new THREE.Color('#ffca7a') },
          uRidgeFar: { value: new THREE.Color('#544d85') },
          uRidgeNear: { value: new THREE.Color('#403a6b') },
        },
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      }),
    []
  )

  useFrame(({ camera }) => {
    group.current?.position.copy(camera.position)
    ;(material.uniforms.uSunDir.value as THREE.Vector3).copy(sunDirection)
    ;(material.uniforms.uMoonDir.value as THREE.Vector3).copy(moonDirection)
    material.uniforms.uDayFactor.value = dayNightState.dayFactor
  })

  return (
    <group ref={group} renderOrder={-10}>
      <mesh material={material} frustumCulled={false}>
        <sphereGeometry args={[1400, 48, 32]} />
      </mesh>
    </group>
  )
}
