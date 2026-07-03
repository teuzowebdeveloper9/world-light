/**
 * Cachorros fofos vagando pelo mundo 🐕
 * Modelos: Husky e Shiba Inu de Quaternius (CC0, poly.pizza).
 *
 * Spawn por área: cada chunk tem uma chance determinística (seed + coords)
 * de abrigar um cão — ≈ 1 cachorro a cada ~75.000 m². Só os chunks num raio
 * de 2 ao redor do player instanciam de verdade (máx. 6 cães vivos).
 *
 * IA simples e barata (sem física): perambula, para, fareja/come, e quando o
 * player chega perto vem correndo feliz. Segue a altura analítica do terreno.
 */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useGLTF } from '@react-three/drei'
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js'
import { useExperienceStore } from '../state/useExperienceStore'
import { playerState } from '../player/PlayerController'
import { getTerrainSampler, hashCoords, mulberry32 } from './noise'
import { CHUNK_SIZE, DOG_CHUNK_CHANCE } from './chunkTypes'
import { chunkKey } from './chunkMath'
import { dampFactor } from '../utils/math'

const HUSKY_URL = `${import.meta.env.BASE_URL}models/dog-husky.glb`
const SHIBA_URL = `${import.meta.env.BASE_URL}models/dog-shiba.glb`
useGLTF.preload(HUSKY_URL)
useGLTF.preload(SHIBA_URL)

const MAX_DOGS = 6
const DOG_RADIUS = 2
const WALK_SPEED = 1.4
const RUN_SPEED = 5.2

type DogAnim = 'Idle' | 'Idle_2' | 'Eating' | 'Walk' | 'Gallop'
type DogState = 'idle' | 'eat' | 'wander' | 'come'

interface DogAgent {
  key: string
  root: THREE.Object3D
  mixer: THREE.AnimationMixer
  actions: Partial<Record<DogAnim, THREE.AnimationAction>>
  current: DogAnim | ''
  state: DogState
  pos: THREE.Vector3
  yaw: number
  target: THREE.Vector3
  timer: number
}

function playAnim(dog: DogAgent, name: DogAnim): void {
  if (dog.current === name) return
  const next = dog.actions[name]
  if (!next) return
  const prev = dog.current ? dog.actions[dog.current] : undefined
  next.reset().fadeIn(0.25).play()
  prev?.fadeOut(0.25)
  dog.current = name
}

export function DogManager() {
  const husky = useGLTF(HUSKY_URL)
  const shiba = useGLTF(SHIBA_URL)
  const seed = useExperienceStore((s) => s.seed)
  const playerChunk = useExperienceStore((s) => s.playerChunk)
  const group = useRef<THREE.Group>(null)
  const dogs = useRef<Map<string, DogAgent>>(new Map())
  const sampler = useMemo(() => getTerrainSampler(seed), [seed])

  // Normaliza os dois modelos uma única vez (altura ~0.6, pés no chão).
  const sources = useMemo(() => {
    return [husky, shiba].map((gltf) => {
      const box = new THREE.Box3().setFromObject(gltf.scene)
      const h = Math.max(box.max.y - box.min.y, 0.001)
      return { gltf, scale: 0.62 / h, yOffset: -box.min.y }
    })
  }, [husky, shiba])

  function spawnDog(key: string, cx: number, cz: number): void {
    const rng = mulberry32(hashCoords(seed ^ 0xd0965, cx, cz))
    const src = sources[rng() < 0.5 ? 0 : 1]
    const root = cloneSkeleton(src.gltf.scene)
    const s = src.scale * (0.85 + rng() * 0.35)
    root.scale.setScalar(s)
    root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true
        o.frustumCulled = false
      }
    })

    const x = cx * CHUNK_SIZE + 10 + rng() * (CHUNK_SIZE - 20)
    const z = cz * CHUNK_SIZE + 10 + rng() * (CHUNK_SIZE - 20)
    const pos = new THREE.Vector3(x, sampler.height(x, z), z)

    const mixer = new THREE.AnimationMixer(root)
    const actions: DogAgent['actions'] = {}
    for (const name of ['Idle', 'Idle_2', 'Eating', 'Walk', 'Gallop'] as DogAnim[]) {
      const clip = THREE.AnimationClip.findByName(src.gltf.animations, name)
      if (clip) actions[name] = mixer.clipAction(clip)
    }

    const dog: DogAgent = {
      key,
      root,
      mixer,
      actions,
      current: '',
      state: 'idle',
      pos,
      yaw: rng() * Math.PI * 2,
      target: pos.clone(),
      timer: 1 + rng() * 3,
    }
    playAnim(dog, 'Idle')
    root.position.copy(pos)
    group.current?.add(root)
    dogs.current.set(key, dog)
  }

  // Sincroniza a população de cães quando o player troca de chunk.
  useEffect(() => {
    const want = new Map<string, [number, number]>()
    for (let dz = -DOG_RADIUS; dz <= DOG_RADIUS; dz++) {
      for (let dx = -DOG_RADIUS; dx <= DOG_RADIUS; dx++) {
        const cx = playerChunk.cx + dx
        const cz = playerChunk.cz + dz
        if (hashCoords(seed ^ 0xd06, cx, cz) / 4294967296 < DOG_CHUNK_CHANCE) {
          want.set(chunkKey(cx, cz), [cx, cz])
        }
      }
    }
    for (const [key, dog] of dogs.current) {
      if (!want.has(key)) {
        dog.mixer.stopAllAction()
        group.current?.remove(dog.root)
        dogs.current.delete(key)
        // Geometrias/materiais são compartilhados com o GLB fonte — sem dispose.
      }
    }
    for (const [key, [cx, cz]] of want) {
      if (!dogs.current.has(key) && dogs.current.size < MAX_DOGS) {
        spawnDog(key, cx, cz)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerChunk, seed, sources])

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05)
    const { phase, paused } = useExperienceStore.getState()
    if (phase !== 'playing' || paused) return
    const pp = playerState.position

    for (const dog of dogs.current.values()) {
      dog.timer -= dt
      const distToPlayer = Math.hypot(dog.pos.x - pp.x, dog.pos.z - pp.z)

      // Ao ver o player por perto, vem correndo feliz.
      if (distToPlayer < 11 && distToPlayer > 2.2 && dog.state !== 'come') {
        dog.state = 'come'
      }

      let speed = 0
      if (dog.state === 'come') {
        if (distToPlayer > 2.2) {
          dog.target.set(pp.x, 0, pp.z)
          speed = distToPlayer > 5 ? RUN_SPEED : WALK_SPEED
        } else {
          dog.state = 'idle'
          dog.timer = 2 + Math.random() * 3
        }
        if (distToPlayer > 16) {
          dog.state = 'idle'
          dog.timer = 1
        }
      } else if (dog.state === 'wander') {
        const d = Math.hypot(dog.target.x - dog.pos.x, dog.target.z - dog.pos.z)
        if (d < 0.6 || dog.timer <= 0) {
          dog.state = 'idle'
          dog.timer = 1.5 + Math.random() * 3.5
        } else {
          speed = WALK_SPEED
        }
      } else if (dog.timer <= 0) {
        // idle/eat terminou: sorteia o próximo comportamento.
        const r = Math.random()
        if (r < 0.5) {
          dog.state = 'wander'
          const a = Math.random() * Math.PI * 2
          const dist = 4 + Math.random() * 10
          dog.target.set(dog.pos.x + Math.cos(a) * dist, 0, dog.pos.z + Math.sin(a) * dist)
          dog.timer = 12
        } else if (r < 0.75) {
          dog.state = 'eat'
          dog.timer = 2.5 + Math.random() * 3
        } else {
          dog.state = 'idle'
          dog.timer = 1.5 + Math.random() * 3
        }
      }

      if (speed > 0) {
        const dirX = dog.target.x - dog.pos.x
        const dirZ = dog.target.z - dog.pos.z
        const len = Math.hypot(dirX, dirZ)
        if (len > 0.01) {
          const targetYaw = Math.atan2(dirX, dirZ)
          let dyaw = targetYaw - dog.yaw
          dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw))
          dog.yaw += dyaw * dampFactor(8, dt)
          dog.pos.x += (dirX / len) * speed * dt
          dog.pos.z += (dirZ / len) * speed * dt
        }
      }
      dog.pos.y = sampler.height(dog.pos.x, dog.pos.z)

      dog.root.position.copy(dog.pos)
      dog.root.rotation.y = dog.yaw

      playAnim(
        dog,
        speed >= RUN_SPEED - 0.1
          ? 'Gallop'
          : speed > 0
            ? 'Walk'
            : dog.state === 'eat'
              ? 'Eating'
              : 'Idle'
      )
      dog.mixer.update(dt)
    }
  })

  return <group ref={group} />
}
