/**
 * Um chunk pronto: terreno com cores por vértice, decorações instanciadas
 * (1 draw call por tipo), collider trimesh apenas quando próximo, LOD por
 * anel de distância e fade-in orgânico ao surgir.
 */
import { useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { RigidBody, TrimeshCollider } from '@react-three/rapier'
import { useExperienceStore } from '../state/useExperienceStore'
import { chunkDistance } from './chunkMath'
import {
  CHUNK_SIZE,
  GRASS_RADIUS,
  GRASS_STRIDE,
  PHYSICS_RADIUS,
  ROCK_STRIDE,
  SHARD_STRIDE,
  TREE_DETAIL_RADIUS,
  TREE_STRIDE,
  type ChunkPayload,
} from './chunkTypes'
import { buildChunkIndices } from './chunkMath'
import { getTrimeshArgs } from '../physics/terrainCollider'
import {
  grassGeometry,
  makeGrassMaterial,
  makeRockMaterial,
  makeShardMaterial,
  makeTerrainMaterial,
  makeTreeMaterial,
  rockGeometry,
  shardGeometry,
  treeGeometryDetailed,
  treeGeometryFar,
} from '../visuals/Materials'
import { smootherstep01 } from '../utils/math'

const dummy = new THREE.Object3D()
const tint = new THREE.Color()

const FADE_SECONDS = 0.9

interface TerrainChunkProps {
  payload: ChunkPayload
  /** Chunks do círculo inicial aparecem prontos (a câmera ainda está no veil). */
  instantFade: boolean
}

function fillInstances(
  mesh: THREE.InstancedMesh | null,
  data: Float32Array,
  stride: number,
  yStretch: number
): void {
  if (!mesh) return
  const count = Math.floor(data.length / stride)
  for (let i = 0; i < count; i++) {
    const o = i * stride
    dummy.position.set(data[o], data[o + 1], data[o + 2])
    const s = data[o + 3]
    dummy.rotation.set(0, data[o + 4] ?? 0, 0)
    dummy.scale.set(s, s * yStretch, s)
    dummy.updateMatrix()
    mesh.setMatrixAt(i, dummy.matrix)
    if (stride >= 6) mesh.setColorAt(i, tint.setScalar(data[o + 5]))
  }
  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  mesh.count = count
}

export function TerrainChunk({ payload, instantFade }: TerrainChunkProps) {
  const playerChunk = useExperienceStore((s) => s.playerChunk)
  const ring = chunkDistance(payload.cx, payload.cz, playerChunk.cx, playerChunk.cz)

  const treesRef = useRef<THREE.InstancedMesh>(null)
  const rocksRef = useRef<THREE.InstancedMesh>(null)
  const grassRef = useRef<THREE.InstancedMesh>(null)
  const fade = useRef(instantFade ? 1 : 0)

  const treeCount = Math.floor(payload.trees.length / TREE_STRIDE)
  const rockCount = Math.floor(payload.rocks.length / ROCK_STRIDE)
  const grassCount = Math.floor(payload.grass.length / GRASS_STRIDE)
  const shardCount = Math.floor(payload.shards.length / SHARD_STRIDE)

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(payload.positions, 3))
    geo.setAttribute('normal', new THREE.BufferAttribute(payload.normals, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(payload.colors, 3))
    geo.setIndex(new THREE.BufferAttribute(buildChunkIndices(), 1))
    // Bounding sphere manual — sem varrer vértices na main thread.
    const cx = (payload.cx + 0.5) * CHUNK_SIZE
    const cz = (payload.cz + 0.5) * CHUNK_SIZE
    const cy = (payload.minY + payload.maxY) / 2
    const radius =
      Math.hypot(CHUNK_SIZE * 0.71, (payload.maxY - payload.minY) / 2 + 1) + 1
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, cy, cz), radius)
    return geo
  }, [payload])

  const materials = useMemo(() => {
    const set = {
      terrain: makeTerrainMaterial(),
      tree: makeTreeMaterial(),
      rock: makeRockMaterial(),
      grass: makeGrassMaterial(),
      shard: makeShardMaterial(),
    }
    // Estado inicial do fade definido UMA vez — re-renders não resetam opacidade.
    const startOpacity = fade.current >= 1 ? 1 : 0
    for (const mat of Object.values(set)) {
      mat.opacity = startOpacity
      mat.transparent = fade.current < 1
    }
    set.shard.emissiveIntensity = 3.2 * startOpacity
    return set
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Dispose completo ao descartar o chunk — sem leaks de GPU.
  useLayoutEffect(() => {
    return () => {
      geometry.dispose()
      Object.values(materials).forEach((m) => m.dispose())
    }
  }, [geometry, materials])

  useLayoutEffect(() => {
    fillInstances(treesRef.current, payload.trees, TREE_STRIDE, 1)
    fillInstances(rocksRef.current, payload.rocks, ROCK_STRIDE, 1)
    fillInstances(grassRef.current, payload.grass, GRASS_STRIDE, 1.25)
  }, [payload])

  // LOD de árvores: geometria detalhada perto, cone-silhueta longe.
  const treeGeo = ring <= TREE_DETAIL_RADIUS ? treeGeometryDetailed : treeGeometryFar
  useLayoutEffect(() => {
    if (treesRef.current) treesRef.current.geometry = treeGeo
  }, [treeGeo])

  // Fade-in orgânico dos elementos ao surgir.
  useFrame((_, dt) => {
    if (fade.current >= 1) return
    fade.current = Math.min(1, fade.current + dt / FADE_SECONDS)
    const eased = smootherstep01(fade.current)
    const done = fade.current >= 1
    for (const mat of [materials.terrain, materials.tree, materials.rock, materials.grass]) {
      mat.opacity = eased
      mat.transparent = !done
    }
    materials.shard.opacity = eased
    materials.shard.transparent = !done
    materials.shard.emissiveIntensity = 3.2 * eased
  })

  return (
    <group>
      <mesh geometry={geometry} material={materials.terrain} receiveShadow />

      {treeCount > 0 && (
        <instancedMesh
          ref={treesRef}
          args={[treeGeo, materials.tree, treeCount]}
          castShadow={ring <= 1}
          receiveShadow
          frustumCulled={false}
        />
      )}

      {rockCount > 0 && (
        <instancedMesh
          ref={rocksRef}
          args={[rockGeometry, materials.rock, rockCount]}
          castShadow={ring <= 1}
          receiveShadow
          frustumCulled={false}
        />
      )}

      {grassCount > 0 && (
        <instancedMesh
          ref={grassRef}
          args={[grassGeometry, materials.grass, grassCount]}
          visible={ring <= GRASS_RADIUS}
          frustumCulled={false}
        />
      )}

      {shardCount > 0 &&
        Array.from({ length: shardCount }, (_, i) => {
          const o = i * SHARD_STRIDE
          const x = payload.shards[o]
          const y = payload.shards[o + 1]
          const z = payload.shards[o + 2]
          const s = payload.shards[o + 3]
          return (
            <group key={i} position={[x, y, z]} scale={s}>
              <mesh geometry={shardGeometry} material={materials.shard} />
              {ring <= 1 && (
                <pointLight color="#ffd9a0" intensity={14} distance={22} decay={2} position={[0, 2, 0]} />
              )}
            </group>
          )
        })}

      {ring <= PHYSICS_RADIUS && (
        <RigidBody type="fixed" colliders={false}>
          <TrimeshCollider args={getTrimeshArgs(payload)} friction={1} />
        </RigidBody>
      )}
    </group>
  )
}
