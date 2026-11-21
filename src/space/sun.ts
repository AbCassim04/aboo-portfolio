import * as THREE from 'three'
import { AU_KM, BODY_PHYSICAL } from './ephemeris'

// ── The Sun ─────────────────────────────────────────────────────────────────
// True radius (696 000 km), the photosphere texture, a soft corona (a
// world-sized radial glow billboard out to ~3.5 radii, replacing the old
// concentric glow shells, whose hard edges read as a bullseye once visible)
// and a screen-space glare sprite that keeps the Sun a dazzling star from the
// outer planets. The glare sits on the Sun's near surface and depth-tests, so a
// planet in front of the Sun hides it where it overlaps.
//
// The light itself is a PointLight at the Sun's position (set up by the
// caller); brightness falls off with distance and the caller's eye adaptation
// scales it (see FlightMode).

export const SUN_RADIUS_KM = BODY_PHYSICAL.sun.radius

function makeCoronaTexture(): THREE.CanvasTexture {
  // Radial profile in units of the sprite radius (= 3.5 solar radii): zero
  // inside the disc edge (0.286), bright just outside it, fading out.
  const size = 512
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')!
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  grd.addColorStop(0.00, 'rgba(255,210,120,0.0)')
  grd.addColorStop(0.27, 'rgba(255,210,120,0.0)')
  grd.addColorStop(0.29, 'rgba(255,200,110,0.85)')
  grd.addColorStop(0.36, 'rgba(255,170,70,0.38)')
  grd.addColorStop(0.55, 'rgba(255,140,50,0.10)')
  grd.addColorStop(1.00, 'rgba(255,120,40,0)')
  g.fillStyle = grd
  g.fillRect(0, 0, size, size)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function makeGlareTexture(): THREE.CanvasTexture {
  const size = 256
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')!
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  grd.addColorStop(0.00, 'rgba(255,255,250,1)')
  grd.addColorStop(0.06, 'rgba(255,250,225,0.85)')
  grd.addColorStop(0.18, 'rgba(255,225,160,0.32)')
  grd.addColorStop(0.45, 'rgba(255,190,110,0.08)')
  grd.addColorStop(1.00, 'rgba(255,170,80,0)')
  g.fillStyle = grd
  g.fillRect(0, 0, size, size)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

export interface SunObject {
  group:  THREE.Group
  mesh:   THREE.Mesh
  glare:  THREE.Sprite
  /**
   * Per frame, after the floating origin has positioned `group`.
   * @param distKm camera–Sun distance
   * @param fovDeg camera vertical field of view
   */
  update(distKm: number, fovDeg: number): void
  dispose(): void
}

export function createSun(loader: THREE.TextureLoader, isMobile: boolean): SunObject {
  const R    = SUN_RADIUS_KM
  const base = import.meta.env.BASE_URL
  const group = new THREE.Group()
  group.name  = 'Sun'

  const tex = loader.load(base + 'stars/8k_sun.jpg')
  tex.colorSpace = THREE.SRGBColorSpace
  const geo  = new THREE.SphereGeometry(R, 96, 64)
  const mat  = new THREE.MeshBasicMaterial({ map: tex })
  const mesh = new THREE.Mesh(geo, mat)
  group.add(mesh)

  // Corona: world-sized billboard (sizeAttenuation on), behind the disc.
  void isMobile
  const coronaTex = makeCoronaTexture()
  const coronaMat = new THREE.SpriteMaterial({
    map: coronaTex, transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending,
  })
  const corona = new THREE.Sprite(coronaMat)
  corona.scale.setScalar(R * 7)
  corona.frustumCulled = false
  group.add(corona)

  // Glare: constant-screen-size sprite (sizeAttenuation off), additive.
  const glareTex = makeGlareTexture()
  const glareMat = new THREE.SpriteMaterial({
    map: glareTex, color: 0xffffff, transparent: true, depthWrite: false, depthTest: true,
    blending: THREE.AdditiveBlending, sizeAttenuation: false,
  })
  const glare = new THREE.Sprite(glareMat)
  glare.renderOrder = 20
  glare.frustumCulled = false
  group.add(glare)

  const _dir = new THREE.Vector3()

  return {
    group, mesh, glare,
    update(distKm: number, fovDeg: number) {
      // Put the glare on the near surface (local space: toward the camera).
      _dir.copy(group.position).negate()
      const d = _dir.length()
      if (d > 0) _dir.multiplyScalar(Math.min(R * 1.02, d * 0.5) / d)
      glare.position.copy(_dir)
      // Screen fraction of the glare, shrinking slowly with distance (a
      // quarter of the screen height at 1 AU, a small star at Neptune), and
      // never smaller than the disc itself.
      const au   = Math.max(distKm / AU_KM, 1e-4)
      const f    = Math.min(0.9, Math.max(0.035, 0.26 * Math.pow(au, -0.55)))
      const disc = (2 * Math.asin(Math.min(1, R / Math.max(distKm, R)))) / (fovDeg * Math.PI / 180)
      const frac = Math.max(f, disc * 2.2)
      // Sprite with sizeAttenuation off: scale 1 spans 2·tan(fov/2) of the view height.
      glare.scale.setScalar(frac * 2 * Math.tan((fovDeg * Math.PI / 180) / 2))
      glareMat.opacity = Math.min(1, 0.55 * Math.pow(au, -0.25))
    },
    dispose() {
      geo.dispose(); mat.dispose(); tex.dispose()
      coronaTex.dispose(); coronaMat.dispose()
      glareTex.dispose(); glareMat.dispose()
    },
  }
}
