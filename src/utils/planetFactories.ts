import * as THREE from 'three'

// ── Shared planet factories ────────────────────────────────────────────────
// Used by both the hub (SpaceCanvas) and flight (FlightMode) scenes. Call sites
// position and scale the returned groups; the geometry/material/rotation setup
// is identical across both scenes, so it lives here to avoid duplication.
//
// `opts` (all optional; the defaults are the hub's values, unchanged) lets the
// true-scale flight scene use real radii, finer spheres and Saturn's rings at
// their real radii in the equatorial plane.

export interface PlanetOptions {
  /** Sphere radius (scene units). */
  radius?:   number
  /** Width/height segments of the sphere. */
  segments?: number
  /** Venus: cloud-shell radius as a multiple of the radius. */
  atmosphereScale?: number
  /** Saturn: ring inner/outer radius (scene units); the texture spans this range. */
  ringInner?: number
  ringOuter?: number
  /** Saturn: lay the ring in the equatorial plane (true orientation set by the caller). */
  equatorialRing?: boolean
}

export function createMercury(loader: THREE.TextureLoader, isMobile: boolean, opts: PlanetOptions = {}): { group: THREE.Group; mesh: THREE.Mesh; dispose: () => void } {
  const base       = import.meta.env.BASE_URL
  const mercuryTex = loader.load(base + 'earth/8k_mercury.jpg')
  mercuryTex.colorSpace = THREE.SRGBColorSpace
  const group      = new THREE.Group()
  const INNER_SEGS = opts.segments ?? (isMobile ? 32 : 64)
  const mercuryGeo = new THREE.SphereGeometry(opts.radius ?? 4, INNER_SEGS, INNER_SEGS)
  const mercuryMat = new THREE.MeshPhongMaterial({ map: mercuryTex, shininess: 5, side: THREE.FrontSide })
  const mesh       = new THREE.Mesh(mercuryGeo, mercuryMat)
  group.add(mesh)
  group.rotation.z = 0.034
  return { group, mesh, dispose: () => { mercuryGeo.dispose(); mercuryMat.dispose(); mercuryTex.dispose() } }
}

export function createVenus(loader: THREE.TextureLoader, isMobile: boolean, opts: PlanetOptions = {}): { group: THREE.Group; mesh: THREE.Mesh; atmoMesh: THREE.Mesh; dispose: () => void } {
  const base     = import.meta.env.BASE_URL
  const venusTex = loader.load(base + 'earth/8k_venus_surface.jpg')
  const atmoTex  = loader.load(base + 'earth/4k_venus_atmosphere.jpg')
  venusTex.colorSpace = THREE.SRGBColorSpace
  atmoTex.colorSpace  = THREE.SRGBColorSpace
  const group      = new THREE.Group()
  const INNER_SEGS = opts.segments ?? (isMobile ? 32 : 64)
  const venusR     = opts.radius ?? 9
  const venusGeo   = new THREE.SphereGeometry(venusR, INNER_SEGS, INNER_SEGS)
  const venusMat   = new THREE.MeshPhongMaterial({ map: venusTex, shininess: 8, side: THREE.FrontSide })
  const mesh       = new THREE.Mesh(venusGeo, venusMat)
  group.add(mesh)
  const atmoGeo    = new THREE.SphereGeometry(opts.radius === undefined ? 9.8 : venusR * (opts.atmosphereScale ?? 9.8 / 9), INNER_SEGS, INNER_SEGS)
  const atmoMat    = new THREE.MeshPhongMaterial({ map: atmoTex, shininess: 3, side: THREE.DoubleSide, transparent: true, opacity: 0.7, depthWrite: false })
  const atmoMesh   = new THREE.Mesh(atmoGeo, atmoMat)
  group.add(atmoMesh)
  group.rotation.z = 3.096
  return { group, mesh, atmoMesh, dispose: () => { venusGeo.dispose(); venusMat.dispose(); atmoGeo.dispose(); atmoMat.dispose(); venusTex.dispose(); atmoTex.dispose() } }
}

export function createMars(loader: THREE.TextureLoader, isMobile: boolean, opts: PlanetOptions = {}): { group: THREE.Group; mesh: THREE.Mesh; dispose: () => void } {
  const base    = import.meta.env.BASE_URL
  const marsTex = loader.load(base + 'earth/8k_mars.jpg')
  marsTex.colorSpace = THREE.SRGBColorSpace
  const group      = new THREE.Group()
  const INNER_SEGS = opts.segments ?? (isMobile ? 32 : 64)
  const marsGeo    = new THREE.SphereGeometry(opts.radius ?? 7, INNER_SEGS, INNER_SEGS)
  const marsMat    = new THREE.MeshPhongMaterial({ map: marsTex, shininess: 5, side: THREE.FrontSide })
  const mesh       = new THREE.Mesh(marsGeo, marsMat)
  group.add(mesh)
  group.rotation.z = 0.4396
  return { group, mesh, dispose: () => { marsGeo.dispose(); marsMat.dispose(); marsTex.dispose() } }
}

export function createJupiter(loader: THREE.TextureLoader, isMobile: boolean, opts: PlanetOptions = {}): { group: THREE.Group; mesh: THREE.Mesh; dispose: () => void } {
  const base       = import.meta.env.BASE_URL
  const jupiterTex = loader.load(base + 'earth/8k_jupiter.jpg')
  jupiterTex.colorSpace = THREE.SRGBColorSpace
  const group      = new THREE.Group()
  const OUTER_SEGS = opts.segments ?? (isMobile ? 16 : 32)
  const jupiterGeo = new THREE.SphereGeometry(opts.radius ?? 110, OUTER_SEGS, OUTER_SEGS)
  const jupiterMat = new THREE.MeshPhongMaterial({ map: jupiterTex, shininess: 10, side: THREE.FrontSide })
  const mesh       = new THREE.Mesh(jupiterGeo, jupiterMat)
  group.add(mesh)
  group.rotation.z = 0.0546
  return { group, mesh, dispose: () => { jupiterGeo.dispose(); jupiterMat.dispose(); jupiterTex.dispose() } }
}

export function createSaturn(loader: THREE.TextureLoader, isMobile: boolean, opts: PlanetOptions = {}): { group: THREE.Group; mesh: THREE.Mesh; ringMesh: THREE.Mesh; dispose: () => void } {
  const base      = import.meta.env.BASE_URL
  const saturnTex = loader.load(base + 'earth/8k_saturn.jpg')
  const ringTex   = loader.load(base + 'earth/8k_saturn_ring_alpha.png')
  saturnTex.colorSpace = THREE.SRGBColorSpace
  ringTex.colorSpace   = THREE.SRGBColorSpace
  const group      = new THREE.Group()
  const OUTER_SEGS = opts.segments ?? (isMobile ? 16 : 32)
  const RING_SEGS  = isMobile ? 64 : 128
  const saturnGeo  = new THREE.SphereGeometry(opts.radius ?? 90, OUTER_SEGS, OUTER_SEGS)
  const saturnMat  = new THREE.MeshPhongMaterial({ map: saturnTex, shininess: 10, side: THREE.FrontSide })
  const mesh       = new THREE.Mesh(saturnGeo, saturnMat)
  group.add(mesh)
  const ringInner  = opts.ringInner ?? 117, ringOuter = opts.ringOuter ?? 216
  const ringGeo    = new THREE.RingGeometry(ringInner, ringOuter, RING_SEGS)
  const pos = ringGeo.attributes.position as THREE.BufferAttribute
  const uv  = ringGeo.attributes.uv as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) {
    const r = Math.sqrt(pos.getX(i) ** 2 + pos.getY(i) ** 2)
    uv.setXY(i, (r - ringInner) / (ringOuter - ringInner), 0.5)
  }
  const ringMat  = new THREE.MeshBasicMaterial({ map: ringTex, side: THREE.DoubleSide, transparent: true, depthWrite: false, opacity: 1.0 })
  const ringMesh = new THREE.Mesh(ringGeo, ringMat)
  ringMesh.rotation.x = opts.equatorialRing ? -Math.PI / 2 : Math.PI / 2.5
  group.add(ringMesh)
  group.rotation.z = 0.4665
  return { group, mesh, ringMesh, dispose: () => { saturnGeo.dispose(); saturnMat.dispose(); ringGeo.dispose(); ringMat.dispose(); saturnTex.dispose(); ringTex.dispose() } }
}

export function createUranus(loader: THREE.TextureLoader, isMobile: boolean, opts: PlanetOptions = {}): { group: THREE.Group; mesh: THREE.Mesh; dispose: () => void } {
  const base      = import.meta.env.BASE_URL
  const uranusTex = loader.load(base + 'earth/2k_uranus.jpg')
  uranusTex.colorSpace = THREE.SRGBColorSpace
  const group      = new THREE.Group()
  const OUTER_SEGS = opts.segments ?? (isMobile ? 16 : 32)
  const uranusGeo  = new THREE.SphereGeometry(opts.radius ?? 40, OUTER_SEGS, OUTER_SEGS)
  const uranusMat  = new THREE.MeshPhongMaterial({ map: uranusTex, shininess: 8, side: THREE.FrontSide })
  const mesh       = new THREE.Mesh(uranusGeo, uranusMat)
  group.add(mesh)
  group.rotation.z = 1.706
  return { group, mesh, dispose: () => { uranusGeo.dispose(); uranusMat.dispose(); uranusTex.dispose() } }
}

export function createNeptune(loader: THREE.TextureLoader, isMobile: boolean, opts: PlanetOptions = {}): { group: THREE.Group; mesh: THREE.Mesh; dispose: () => void } {
  const base       = import.meta.env.BASE_URL
  const neptuneTex = loader.load(base + 'earth/2k_neptune.jpg')
  neptuneTex.colorSpace = THREE.SRGBColorSpace
  const group      = new THREE.Group()
  const OUTER_SEGS = opts.segments ?? (isMobile ? 16 : 32)
  const neptuneGeo = new THREE.SphereGeometry(opts.radius ?? 38, OUTER_SEGS, OUTER_SEGS)
  const neptuneMat = new THREE.MeshPhongMaterial({ map: neptuneTex, shininess: 8, side: THREE.FrontSide })
  const mesh       = new THREE.Mesh(neptuneGeo, neptuneMat)
  group.add(mesh)
  group.rotation.z = 0.4942
  return { group, mesh, dispose: () => { neptuneGeo.dispose(); neptuneMat.dispose(); neptuneTex.dispose() } }
}
