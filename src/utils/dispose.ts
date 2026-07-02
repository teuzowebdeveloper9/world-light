/**
 * Dispose recursivo de recursos de GPU — evita leaks ao descartar chunks.
 */
import type { Object3D, Material } from 'three'
import { Mesh, Points } from 'three'

function disposeMaterial(material: Material | Material[]): void {
  if (Array.isArray(material)) {
    material.forEach((m) => m.dispose())
  } else {
    material.dispose()
  }
}

export function disposeObject3D(root: Object3D): void {
  root.traverse((obj) => {
    if (obj instanceof Mesh || obj instanceof Points) {
      obj.geometry?.dispose()
      if (obj.material) disposeMaterial(obj.material)
    }
  })
}
