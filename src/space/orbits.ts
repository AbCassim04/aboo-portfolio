import * as THREE from 'three'
import { AU_KM, centuriesTT, createElements, elementsAt, moonGeocentricKm, orbitPointAtE } from './ephemeris'
import type { PlanetId } from './ephemeris'

// ── Orbit lines ─────────────────────────────────────────────────────────────
// Thin, faint real orbits: each planet's osculating Keplerian ellipse (Standish
// elements at the current sim date, inclination included) and the Moon's real
// geocentric path over one sidereal month around the current date.
//
// Precision: the heliocentric points are kept in float64 and every frame the
// camera-relative positions are written into one float32 vertex buffer (one
// draw call), so lines never jitter however far they are from the origin.
// Fading ("when not needed"): a vertex fades out as it comes close to the
// camera relative to the orbit's size (an orbit is an overview aid, not
// something to fly through), which also hides the line where it passes
// through the planet you are at; and a whole orbit fades as it turns
// edge-on — seen from (nearly) within its plane it collapses into a line
// across the sky that carries no information. Rising above the ecliptic
// brings the ellipses back.
// Orbits are recomputed when the sim date has moved by more than a day.

const SEGMENTS      = 256
const RECOMPUTE_MS  = 86_400_000
const SIDEREAL_MONTH_MS = 27.321661 * 86_400_000

export interface OrbitEntry {
  id:    PlanetId | 'moon'
  color: THREE.Color
  /** Peak opacity. */
  alpha: number
}

const _el  = createElements()
const _p   = new THREE.Vector3()
const _r   = new THREE.Vector3()

export class OrbitLines {
  readonly object: THREE.LineSegments
  private readonly entries: OrbitEntry[]
  /** Float64 points per orbit (heliocentric km; geocentric for the Moon). */
  private readonly pts: Float64Array[]
  /** Fade scale per orbit (km). */
  private readonly scale: number[]
  /** Orbit-plane normal and a point on the plane (centre), per orbit. */
  private readonly normal: THREE.Vector3[]
  private readonly centre: THREE.Vector3[]
  private readonly posBuf: Float32Array
  private readonly colBuf: Float32Array
  private readonly geo:    THREE.BufferGeometry
  private readonly mat:    THREE.LineBasicMaterial
  private lastMs = NaN
  /** Global opacity multiplier (e.g. to hide orbits). */
  opacity = 1

  constructor(entries: OrbitEntry[]) {
    this.entries = entries
    this.pts     = entries.map(() => new Float64Array(SEGMENTS * 3))
    this.scale   = entries.map(() => 1)
    this.normal  = entries.map(() => new THREE.Vector3(0, 1, 0))
    this.centre  = entries.map(() => new THREE.Vector3())
    const nVerts = entries.length * SEGMENTS * 2
    this.posBuf  = new Float32Array(nVerts * 3)
    this.colBuf  = new Float32Array(nVerts * 4)
    this.geo = new THREE.BufferGeometry()
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.posBuf, 3).setUsage(THREE.DynamicDrawUsage))
    this.geo.setAttribute('color',    new THREE.BufferAttribute(this.colBuf, 4).setUsage(THREE.DynamicDrawUsage))
    this.mat = new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    })
    this.object = new THREE.LineSegments(this.geo, this.mat)
    this.object.frustumCulled = false
    this.object.renderOrder   = 5
  }

  /** Recompute the orbit shapes if the sim date moved by more than a day. */
  recompute(simMs: number, force = false): void {
    if (!force && Math.abs(simMs - this.lastMs) < RECOMPUTE_MS) return
    this.lastMs = simMs
    const T = centuriesTT(simMs)
    for (let o = 0; o < this.entries.length; o++) {
      const e   = this.entries[o]
      const out = this.pts[o]
      if (e.id === 'moon') {
        let maxR = 0
        for (let i = 0; i < SEGMENTS; i++) {
          moonGeocentricKm(simMs + (i / SEGMENTS - 0.5) * SIDEREAL_MONTH_MS, _p)
          out[i * 3] = _p.x; out[i * 3 + 1] = _p.y; out[i * 3 + 2] = _p.z
          maxR = Math.max(maxR, _p.length())
        }
        this.scale[o] = maxR
        this.planeFromPoints(o)
      } else {
        elementsAt(e.id, T, _el)
        for (let i = 0; i < SEGMENTS; i++) {
          // Uniform in eccentric anomaly: denser near perihelion is fine.
          orbitPointAtE(_el, (i / SEGMENTS) * Math.PI * 2, AU_KM, _p)
          out[i * 3] = _p.x; out[i * 3 + 1] = _p.y; out[i * 3 + 2] = _p.z
        }
        this.scale[o] = _el.a * AU_KM
        this.planeFromPoints(o)
      }
    }
  }

  /** Plane normal from three well-separated samples; centre = mean point. */
  private planeFromPoints(o: number): void {
    const p = this.pts[o], q = SEGMENTS / 3 | 0
    const a = _p.set(p[0], p[1], p[2])
    const b = _r.set(p[q * 3], p[q * 3 + 1], p[q * 3 + 2]).sub(a)
    const c = this.centre[o].set(p[2 * q * 3], p[2 * q * 3 + 1], p[2 * q * 3 + 2]).sub(a)
    this.normal[o].crossVectors(b, c).normalize()
    let x = 0, y = 0, z = 0
    for (let i = 0; i < SEGMENTS; i++) { x += p[i * 3]; y += p[i * 3 + 1]; z += p[i * 3 + 2] }
    this.centre[o].set(x / SEGMENTS, y / SEGMENTS, z / SEGMENTS)
  }

  /**
   * Write camera-relative vertices.
   * @param toRender maps a world point to render space
   * @param earthWorld Earth's world position (the Moon's path is geocentric)
   */
  update(toRender: (world: THREE.Vector3, out: THREE.Vector3) => THREE.Vector3, earthWorld: THREE.Vector3): void {
    let v = 0
    for (let o = 0; o < this.entries.length; o++) {
      const e   = this.entries[o]
      const pts = this.pts[o]
      const near0 = this.scale[o] * 0.004
      const near1 = this.scale[o] * 0.06
      const isMoon = e.id === 'moon'
      // Edge-on factor: camera height above the orbit plane relative to its
      // distance from the orbit's centre (sine of the viewing elevation).
      _p.copy(this.centre[o])
      if (isMoon) _p.add(earthWorld)
      toRender(_p, _r)                                   // camera → centre is −_r
      const elev = Math.abs(_r.dot(this.normal[o])) / Math.max(_r.length(), 1)
      const edge = elev <= 0.03 ? 0 : elev >= 0.25 ? 1 : ((elev - 0.03) / 0.22) ** 2 * (3 - 2 * (elev - 0.03) / 0.22)
      for (let i = 0; i < SEGMENTS; i++) {
        for (let k = 0; k < 2; k++) {
          const j = ((i + k) % SEGMENTS) * 3
          _p.set(pts[j], pts[j + 1], pts[j + 2])
          if (isMoon) _p.add(earthWorld)
          toRender(_p, _r)
          const d = _r.length()
          const t = Math.min(1, Math.max(0, (d - near0) / (near1 - near0)))
          const a = e.alpha * this.opacity * edge * t * t * (3 - 2 * t)
          this.posBuf[v * 3] = _r.x; this.posBuf[v * 3 + 1] = _r.y; this.posBuf[v * 3 + 2] = _r.z
          // rgb unpremultiplied: additive blending scales by alpha
          this.colBuf[v * 4] = e.color.r; this.colBuf[v * 4 + 1] = e.color.g; this.colBuf[v * 4 + 2] = e.color.b
          this.colBuf[v * 4 + 3] = a
          v++
        }
      }
    }
    ;(this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true
    ;(this.geo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true
  }

  dispose(): void { this.geo.dispose(); this.mat.dispose() }
}
