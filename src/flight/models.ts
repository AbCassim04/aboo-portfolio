import * as THREE from 'three'
import { GLTFLoader }  from 'three/addons/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'

// ── GLB models (ISS, JWST, astronaut) ───────────────────────────────────────
// Each model is centred on its origin and scaled to its real size (km): the
// largest bounding-box dimension is set to `sizeKm`.

export const ISS_SIZE_KM       = 0.109    // truss span 109 m
export const JWST_SIZE_KM      = 0.0212   // sunshield 21.2 m
export const ASTRONAUT_SIZE_KM = 0.0018   // 1.8 m

/** Dispose a material and every texture it references (deduplicated). */
export function disposeMaterial(mat: THREE.Material, seenTextures: Set<THREE.Texture>): void {
  for (const value of Object.values(mat)) {
    const tex = value as THREE.Texture | null
    if (tex && tex.isTexture && !seenTextures.has(tex)) {
      seenTextures.add(tex)
      tex.dispose()
      // GLTFLoader decodes to ImageBitmap where supported; release it eagerly.
      if (typeof ImageBitmap !== 'undefined' && tex.image instanceof ImageBitmap) tex.image.close()
    }
  }
  mat.dispose()
}

/** Dispose all geometries, materials and textures under `root`. */
export function disposeObjectTree(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>()
  const materials  = new Set<THREE.Material>()
  root.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!mesh.isMesh) return
    if (mesh.geometry) geometries.add(mesh.geometry)
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const m of mats) if (m) materials.add(m)
  })
  const textures = new Set<THREE.Texture>()
  for (const g of geometries) g.dispose()
  for (const m of materials) disposeMaterial(m, textures)
}

export interface LoadedModel { group: THREE.Group; dispose: () => void }

/** Load a Draco-compressed GLB; `prepare` adjusts the scene before resolving. */
function loadGLB(
  file: string, label: string, manager: THREE.LoadingManager | undefined, prepare: (group: THREE.Group) => void,
): Promise<LoadedModel> {
  return new Promise((resolve, reject) => {
    const dracoLoader = new DRACOLoader()
    dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/')
    const loader = new GLTFLoader(manager)
    loader.setDRACOLoader(dracoLoader)
    loader.load(
      import.meta.env.BASE_URL + 'models/' + file,
      (gltf) => {
        dracoLoader.dispose()
        const group = gltf.scene
        prepare(group)
        resolve({ group, dispose: () => disposeObjectTree(group) })
      },
      undefined,
      (error) => {
        dracoLoader.dispose()
        console.error(`❌ ${label} failed to load`, error)
        reject(error)
      },
    )
  })
}

/**
 * Centre the model on the group origin (shifting its root child) and scale the
 * group so its largest dimension is `sizeKm`. Also disables shadows.
 */
function normalise(group: THREE.Group, sizeKm: number): void {
  group.updateMatrixWorld(true)
  const box    = new THREE.Box3().setFromObject(group)
  const center = box.getCenter(new THREE.Vector3())
  const size   = box.getSize(new THREE.Vector3())
  const maxDim = Math.max(size.x, size.y, size.z)
  for (const c of group.children) { c.position.sub(center); c.updateMatrix() }
  group.scale.setScalar(maxDim > 0 ? sizeKm / maxDim : sizeKm)
  group.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (mesh.isMesh) { mesh.castShadow = false; mesh.receiveShadow = false }
  })
}

export function createISS(manager?: THREE.LoadingManager): Promise<LoadedModel> {
  return loadGLB('iss.glb', 'ISS', manager, (group) => normalise(group, ISS_SIZE_KM))
}

export function createJWST(manager?: THREE.LoadingManager): Promise<LoadedModel> {
  return loadGLB('jwst.glb', 'JWST', manager, (group) => normalise(group, JWST_SIZE_KM))
}

export function createAstronaut(manager?: THREE.LoadingManager): Promise<LoadedModel> {
  return loadGLB('astronaut-compressed.glb', 'Astronaut', manager, (group) => {
    // The GLB root node (Sketchfab_model) has a baked-in matrix that translates
    // the model far from its origin; normalise() re-centres it.
    normalise(group, ASTRONAUT_SIZE_KM)

    // KHR_materials_pbrSpecularGlossiness is unsupported in Three.js r184, so
    // every mesh gets one shared lit MeshStandardMaterial (lit by the Sun plus
    // the viewer-side fill light set up when he's added to the scene). The
    // original GLTF materials and their embedded textures are never rendered:
    // collect them and dispose them right after the swap.
    const replacement = new THREE.MeshStandardMaterial({
      color:     new THREE.Color(0xddddcc),
      roughness: 0.7,
      metalness: 0.1,
      side:      THREE.DoubleSide,
    })
    const originals = new Set<THREE.Material>()
    group.traverse((child) => {
      const mesh = child as THREE.Mesh
      if (!mesh.isMesh) return
      mesh.frustumCulled = false
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const m of mats) if (m) originals.add(m)
      mesh.material = replacement
    })
    const textures = new Set<THREE.Texture>()
    for (const m of originals) disposeMaterial(m, textures)
  })
}
