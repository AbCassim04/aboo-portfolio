import * as THREE from 'three'
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'
import { AU_KM, eclToScene, solveKepler, daysTT } from './ephemeris'
import { createRockMaterial, loadAsteroidTextures, seededRandom } from '../systems/AsteroidField'
import type { AsteroidTextures } from '../systems/AsteroidField'

// ── Main asteroid belt, true scale ──────────────────────────────────────────
//
// 1. BeltBand — the belt as seen from afar: a few thousand real-scale
//    Keplerian orbits between 2.2 and 3.3 AU (Kirkwood gaps at the 3:1, 5:2,
//    7:3 and 2:1 resonances), each moving at its Kepler's-third-law rate with
//    the shared sim clock, drawn as faint points, plus a very faint haze
//    annulus. Points are stored heliocentric in float32 (≤ 32 km error at
//    3 AU), which is invisible at the distances they are seen from.
//
// 2. LocalBeltField — what you fly through. When the camera is inside the
//    belt zone, a deterministic field of rocks streams in around it from a
//    3D grid of chunks: each chunk's rocks come from a hash of its integer
//    coordinates, so the same place always holds the same rocks. Three octaves
//    (big/medium/small rocks on coarse/medium/fine grids) keep the field
//    interesting at any scale. Density follows the belt's radial profile (gaps
//    included) and is EXAGGERATED by many orders of magnitude (the real belt
//    averages ~1 million km between km-sized bodies) — the HUD says so.
//    Rocks are instanced with AsteroidField's triplanar/glint shader; instance
//    matrices are relative to a chunk-aligned root that the floating origin
//    keeps near the camera, so they are precise.

export const BELT_INNER_AU = 2.2
export const BELT_OUTER_AU = 3.3
/** 3:1, 5:2, 7:3, 2:1 mean-motion resonances with Jupiter (AU). */
export const KIRKWOOD_GAPS_AU = [2.502, 2.825, 2.958, 3.279]

const GAUSS_K_DEG_PER_DAY = 0.9856076686   // n = k / a^1.5

/** Relative number density of the belt at heliocentric distance r (AU), 0..1. */
export function beltRadialDensity(rAU: number): number {
  const edge = smooth(BELT_INNER_AU - 0.05, BELT_INNER_AU + 0.12, rAU) * (1 - smooth(BELT_OUTER_AU - 0.15, BELT_OUTER_AU + 0.05, rAU))
  let gaps = 1
  for (const g of KIRKWOOD_GAPS_AU) gaps *= 1 - 0.92 * Math.exp(-(((rAU - g) / 0.018) ** 2))
  // Slightly denser inner belt.
  return edge * gaps * (1.15 - 0.3 * (rAU - BELT_INNER_AU))
}

/** Belt-zone density at a world point (radial profile × vertical thickness). */
export function beltZoneDensity(world: THREE.Vector3): number {
  const rxz = Math.hypot(world.x, world.z) / AU_KM
  const h   = world.y / AU_KM
  return Math.max(0, beltRadialDensity(rxz)) * Math.exp(-((h / (0.11 * rxz)) ** 2))
}

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

// ── 1. Far band ─────────────────────────────────────────────────────────────

const BAND_VERT = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
attribute float aBright;
uniform float uSize;
uniform float uNearFade;
varying float vA;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float d = length(mv.xyz);
  vA = aBright * smoothstep(uNearFade * 0.3, uNearFade, d);
  gl_Position  = projectionMatrix * mv;
  gl_PointSize = uSize;
  #include <logdepthbuf_vertex>
}`

const BAND_FRAG = /* glsl */`
#include <logdepthbuf_pars_fragment>
uniform vec3  uColor;
uniform float uOpacity;
varying float vA;
void main() {
  #include <logdepthbuf_fragment>
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float a = exp(-dot(c, c) * 3.0) * vA * uOpacity;
  if (a < 0.003) discard;
  gl_FragColor = vec4(uColor * a, 1.0);
}`

// The haze is for seeing the belt from afar: it fades where it is seen at a
// grazing angle (no hard "horizon" when flying in the belt plane) and close
// to the camera (no glow directly around you; the local field takes over).
const HAZE_VERT = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
varying float vR;
varying vec3  vView;
varying vec3  vNormalView;
void main() {
  vR = length(position.xy) / ${AU_KM.toFixed(1)};
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView       = mv.xyz;
  vNormalView = normalize(normalMatrix * vec3(0.0, 0.0, 1.0));
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}`

const HAZE_FRAG = /* glsl */`
#include <logdepthbuf_pars_fragment>
uniform vec3  uColor;
uniform float uOpacity;
varying float vR;
varying vec3  vView;
varying vec3  vNormalView;
void main() {
  #include <logdepthbuf_fragment>
  float d       = length(vView);
  float grazing = smoothstep(0.05, 0.3, abs(dot(vView / d, normalize(vNormalView))));
  float nearF   = smoothstep(${(0.03 * AU_KM).toFixed(1)}, ${(0.25 * AU_KM).toFixed(1)}, d);
  float a = grazing * nearF * smoothstep(${BELT_INNER_AU.toFixed(2)} - 0.1, ${BELT_INNER_AU.toFixed(2)} + 0.25, vR)
          * (1.0 - smoothstep(${BELT_OUTER_AU.toFixed(2)} - 0.35, ${BELT_OUTER_AU.toFixed(2)} + 0.1, vR));
  gl_FragColor = vec4(uColor * a * uOpacity, 1.0);
}`

export class BeltBand {
  /** Place at the Sun (world origin) via the floating origin. */
  readonly group = new THREE.Group()
  private readonly n: number
  private readonly el: Float64Array          // a, e, i, Ω, ω, M0 per body
  private readonly pos: Float32Array
  private readonly geo: THREE.BufferGeometry
  private readonly mat: THREE.ShaderMaterial
  private readonly hazeGeo: THREE.RingGeometry
  private readonly hazeMat: THREE.ShaderMaterial
  private lastMs = NaN

  constructor(isMobile: boolean, seed = 7) {
    this.group.name = 'BeltBand'
    const rand = seededRandom(seed)
    this.n   = isMobile ? 1500 : 5000
    this.el  = new Float64Array(this.n * 6)
    this.pos = new Float32Array(this.n * 3)
    const bright = new Float32Array(this.n)
    let placed = 0
    while (placed < this.n) {
      const a = BELT_INNER_AU - 0.05 + rand() * (BELT_OUTER_AU - BELT_INNER_AU + 0.1)
      if (rand() > beltRadialDensity(a)) continue
      const i = placed * 6
      this.el[i]     = a
      this.el[i + 1] = Math.min(0.3, Math.abs(gauss(rand)) * 0.09)
      this.el[i + 2] = Math.abs(gauss(rand)) * 8 * Math.PI / 180
      this.el[i + 3] = rand() * Math.PI * 2
      this.el[i + 4] = rand() * Math.PI * 2
      this.el[i + 5] = rand() * Math.PI * 2
      bright[placed] = 0.35 + 0.65 * rand() ** 3
      placed++
    }
    this.geo = new THREE.BufferGeometry()
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage))
    this.geo.setAttribute('aBright', new THREE.BufferAttribute(bright, 1))
    this.mat = new THREE.ShaderMaterial({
      vertexShader: BAND_VERT, fragmentShader: BAND_FRAG,
      uniforms: {
        uColor:    { value: new THREE.Color(0xd8c3a0) },
        uOpacity:  { value: 0.9 },
        uSize:     { value: 1.6 },
        uNearFade: { value: 2e5 },
      },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    })
    this.mat.name = 'belt-band'
    const points = new THREE.Points(this.geo, this.mat)
    points.frustumCulled = false
    this.group.add(points)

    this.hazeGeo = new THREE.RingGeometry((BELT_INNER_AU - 0.15) * AU_KM, (BELT_OUTER_AU + 0.15) * AU_KM, isMobile ? 128 : 256, 4)
    this.hazeMat = new THREE.ShaderMaterial({
      vertexShader: HAZE_VERT, fragmentShader: HAZE_FRAG,
      uniforms: { uColor: { value: new THREE.Color(0xd4b896) }, uOpacity: { value: 0.075 } },
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    })
    this.hazeMat.name = 'belt-haze'
    const haze = new THREE.Mesh(this.hazeGeo, this.hazeMat)
    haze.rotation.x = -Math.PI / 2           // ecliptic plane = scene XZ
    haze.frustumCulled = false
    this.group.add(haze)
  }

  /** Point size in device px (call on resize / DPR change). */
  setPointSize(px: number): void { this.mat.uniforms.uSize.value = px }

  /** Move every body along its orbit to `simMs` (skipped if < 10 sim-min moved). */
  update(simMs: number): void {
    if (Math.abs(simMs - this.lastMs) < 600_000) return
    this.lastMs = simMs
    const d = daysTT(simMs)
    const p = _bandP
    for (let k = 0; k < this.n; k++) {
      const i = k * 6
      const a = this.el[i], e = this.el[i + 1], inc = this.el[i + 2], O = this.el[i + 3], w = this.el[i + 4]
      const M = this.el[i + 5] + (GAUSS_K_DEG_PER_DAY * Math.PI / 180) / Math.pow(a, 1.5) * d
      const E = solveKepler(M % (Math.PI * 2), e)
      const xp = a * (Math.cos(E) - e), yp = a * Math.sqrt(1 - e * e) * Math.sin(E)
      const cw = Math.cos(w), sw = Math.sin(w), cO = Math.cos(O), sO = Math.sin(O), ci = Math.cos(inc), si = Math.sin(inc)
      eclToScene(
        ((cw * cO - sw * sO * ci) * xp + (-sw * cO - cw * sO * ci) * yp) * AU_KM,
        ((cw * sO + sw * cO * ci) * xp + (-sw * sO + cw * cO * ci) * yp) * AU_KM,
        ((sw * si) * xp + (cw * si) * yp) * AU_KM,
        p,
      )
      this.pos[k * 3] = p.x; this.pos[k * 3 + 1] = p.y; this.pos[k * 3 + 2] = p.z
    }
    ;(this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true
  }

  dispose(): void { this.geo.dispose(); this.mat.dispose(); this.hazeGeo.dispose(); this.hazeMat.dispose() }
}

const _bandP = new THREE.Vector3()

function gauss(rand: () => number): number {
  return Math.sqrt(-2 * Math.log(Math.max(rand(), 1e-9))) * Math.cos(2 * Math.PI * rand())
}

// ── 2. Local streaming field ────────────────────────────────────────────────

interface Octave {
  chunk:    number     // chunk edge (km)
  range:    number     // chunks either side of the camera's chunk
  sizeMin:  number     // rock diameter range (km)
  sizeMax:  number
  perChunk: number     // mean rocks per chunk at full density
}

// Each octave keeps rock size ≈ chunk / 15, so at every scale the nearest
// rocks are big on screen and the farther ones read as a field.
const OCTAVES_DESKTOP: Octave[] = [
  { chunk: 600, range: 3, sizeMin: 4,     sizeMax: 30,   perChunk: 0.6 },
  { chunk: 80,  range: 3, sizeMin: 0.5,   sizeMax: 5,    perChunk: 1.2 },
  { chunk: 12,  range: 3, sizeMin: 0.06,  sizeMax: 0.6,  perChunk: 1.2 },
  { chunk: 1.5, range: 2, sizeMin: 0.008, sizeMax: 0.06, perChunk: 1.0 },
]
const OCTAVES_MOBILE: Octave[] = [
  { chunk: 600, range: 2, sizeMin: 4,     sizeMax: 30,   perChunk: 0.8 },
  { chunk: 80,  range: 2, sizeMin: 0.5,   sizeMax: 5,    perChunk: 1.5 },
  { chunk: 12,  range: 2, sizeMin: 0.06,  sizeMax: 0.6,  perChunk: 1.5 },
  { chunk: 1.5, range: 1, sizeMin: 0.008, sizeMax: 0.06, perChunk: 1.5 },
]

/** Root re-anchoring grid (km); a multiple of every octave's chunk. */
const ANCHOR = 2400
const SHAPES = 4

interface Rock {
  x: number; y: number; z: number     // relative to the root (km)
  r: number                           // radius (km)
  ax: number; ay: number; az: number  // spin axis
  w: number; phase: number            // spin rate (rad/s), phase
  shape: number
  cr: number; cg: number; cb: number
}

// Allocation-free PRNG (mulberry32) for chunk generation.
let _rs = 0
function rseed(seed: number): void { _rs = seed | 0 }
function rnd(): number {
  _rs = (_rs + 0x6D2B79F5) | 0
  let t = Math.imul(_rs ^ (_rs >>> 15), 1 | _rs)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

function hash3(ix: number, iy: number, iz: number, salt: number): number {
  let h = Math.imul(ix | 0, 0x8da6b343) ^ Math.imul(iy | 0, 0xd8163841) ^ Math.imul(iz | 0, 0xcb1ab31f) ^ Math.imul(salt, 0x165667b1)
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d)
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39)
  return (h ^ (h >>> 15)) >>> 0
}

/** Watertight lumpy rock (indexed, displaced along the normal, smooth normals). */
function makeRockGeometry(rand: () => number, detail: number): THREE.BufferGeometry {
  let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, detail)
  g.deleteAttribute('normal'); g.deleteAttribute('uv')
  g = mergeVertices(g)
  const p = g.getAttribute('position') as THREE.BufferAttribute
  const waves: number[][] = []
  for (let k = 0; k < 6; k++) {
    const v = new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize()
    waves.push([v.x, v.y, v.z, 1.2 + rand() * 2.8, rand() * 6.28, (0.16 / (1 + k * 0.6)) * (0.6 + rand())])
  }
  const stretch = [0.75 + rand() * 0.5, 0.65 + rand() * 0.4, 0.8 + rand() * 0.4]
  const v = new THREE.Vector3()
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize()
    let d = 1
    for (const [x, y, z, f, ph, amp] of waves) d += amp * Math.sin((v.x * x + v.y * y + v.z * z) * f * 3.0 + ph)
    p.setXYZ(i, v.x * d * stretch[0], v.y * d * stretch[1], v.z * d * stretch[2])
  }
  g.computeVertexNormals()
  g.computeBoundingSphere()
  return g
}

export class LocalBeltField {
  /** Track with the floating origin; its world position is `rootWorld`. */
  readonly root      = new THREE.Group()
  readonly rootWorld = new THREE.Vector3(NaN, NaN, NaN)
  /** Belt density at the camera (0 = outside the belt). */
  density = 0
  private readonly octaves: Octave[]
  /** Per-octave rock pools (preallocated) and live counts. */
  private readonly rocks: Rock[][]
  private readonly rockCount: number[]
  /** Camera chunk per octave (x, y, z), NaN = needs regeneration. */
  private readonly lastChunk: Float64Array
  private readonly tex: AsteroidTextures
  private readonly mat: THREE.ShaderMaterial
  private readonly geos: THREE.BufferGeometry[] = []
  private readonly meshes: THREE.InstancedMesh[] = []   // [shape * 2 + lod]
  private readonly counts: number[]
  private readonly capacity: number
  private readonly dummy = new THREE.Object3D()
  private readonly _axis = new THREE.Vector3()
  private readonly _q    = new THREE.Quaternion()
  private readonly _p    = new THREE.Vector3()
  private readonly _col  = new THREE.Color()

  constructor(isMobile: boolean) {
    this.root.name = 'LocalBeltField'
    this.octaves   = isMobile ? OCTAVES_MOBILE : OCTAVES_DESKTOP
    this.capacity  = isMobile ? 500 : 1600
    const POOL     = isMobile ? 700 : 1400
    this.rocks     = this.octaves.map(() => Array.from({ length: POOL }, (): Rock => ({
      x: 0, y: 0, z: 0, r: 0, ax: 0, ay: 1, az: 0, w: 0, phase: 0, shape: 0, cr: 1, cg: 1, cb: 1,
    })))
    this.rockCount = this.octaves.map(() => 0)
    this.lastChunk = new Float64Array(this.octaves.length * 3).fill(NaN)
    this.tex = loadAsteroidTextures()
    this.mat = createRockMaterial(this.tex, { ROCK_SPACE_TEX: '' }, 1.0)
    const rand = seededRandom(1234)
    for (let s = 0; s < SHAPES; s++) {
      for (const detail of [isMobile ? 2 : 3, 1]) {
        const g = makeRockGeometry(seededRandom(Math.floor(rand() * 1e9)), detail)
        g.setAttribute('instanceColor', new THREE.InstancedBufferAttribute(new Float32Array(this.capacity * 3).fill(1), 3))
        this.geos.push(g)
        const m = new THREE.InstancedMesh(g, this.mat, this.capacity)
        m.count = 0
        m.frustumCulled = false
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
        this.meshes.push(m)
        this.root.add(m)
      }
    }
    this.counts = this.meshes.map(() => 0)
    this.root.visible = false
  }

  /**
   * Before the floating origin applies: decide whether the field is active,
   * re-anchor the root near the camera and regenerate chunks the camera has
   * moved into. `camWorld` is the camera's world position (km).
   */
  prepare(camWorld: THREE.Vector3): void {
    this.density = beltZoneDensity(camWorld)
    const active = this.density > 0.02
    this.root.visible = active
    if (!active) { this.rootWorld.set(NaN, NaN, NaN); this.lastChunk.fill(NaN); return }

    const ax = Math.round(camWorld.x / ANCHOR) * ANCHOR
    const ay = Math.round(camWorld.y / ANCHOR) * ANCHOR
    const az = Math.round(camWorld.z / ANCHOR) * ANCHOR
    const reanchor = ax !== this.rootWorld.x || ay !== this.rootWorld.y || az !== this.rootWorld.z
    if (reanchor) {
      this.rootWorld.set(ax, ay, az)
      this.lastChunk.fill(NaN)
    }
    for (let o = 0; o < this.octaves.length; o++) {
      const oc = this.octaves[o]
      const cx = Math.floor(camWorld.x / oc.chunk), cy = Math.floor(camWorld.y / oc.chunk), cz = Math.floor(camWorld.z / oc.chunk)
      const L = this.lastChunk
      if (L[o * 3] === cx && L[o * 3 + 1] === cy && L[o * 3 + 2] === cz) continue
      L[o * 3] = cx; L[o * 3 + 1] = cy; L[o * 3 + 2] = cz
      this.fillOctave(o, cx, cy, cz)
    }
  }

  private fillOctave(o: number, cx: number, cy: number, cz: number): void {
    const oc   = this.octaves[o]
    const pool = this.rocks[o]
    let count  = 0
    const R = oc.range
    for (let ix = cx - R; ix <= cx + R; ix++) for (let iy = cy - R; iy <= cy + R; iy++) for (let iz = cz - R; iz <= cz + R; iz++) {
      rseed(hash3(ix, iy, iz, o + 1))
      this._p.set((ix + 0.5) * oc.chunk, (iy + 0.5) * oc.chunk, (iz + 0.5) * oc.chunk)
      const n = Math.floor(oc.perChunk * Math.min(1, beltZoneDensity(this._p)) + rnd())
      for (let k = 0; k < n && count < pool.length; k++) {
        const rk = pool[count++]
        const t  = rnd()
        const sz = oc.sizeMin * Math.pow(oc.sizeMax / oc.sizeMin, t * t * t)     // many small, few large
        this._axis.set(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize()
        this._col.setHSL(0.05 + rnd() * 0.06, 0.03 + rnd() * 0.2, 0.18 + rnd() * 0.55)
        rk.x = (ix + rnd()) * oc.chunk - this.rootWorld.x
        rk.y = (iy + rnd()) * oc.chunk - this.rootWorld.y
        rk.z = (iz + rnd()) * oc.chunk - this.rootWorld.z
        rk.r = sz / 2
        rk.ax = this._axis.x; rk.ay = this._axis.y; rk.az = this._axis.z
        rk.w = (0.02 + rnd() * 0.12) / Math.sqrt(Math.max(sz, 0.05)); rk.phase = rnd() * 6.283
        rk.shape = Math.floor(rnd() * SHAPES)
        rk.cr = this._col.r; rk.cg = this._col.g; rk.cb = this._col.b
      }
    }
    this.rockCount[o] = count
  }

  /**
   * After the floating origin has positioned `root`: LOD selection and
   * instance matrices. `pxPerRad` converts angular size to device pixels.
   */
  afterApply(timeSec: number, pxPerRad: number, sunDirWorld: THREE.Vector3, lightGain: number): void {
    if (!this.root.visible) return
    ;(this.mat.uniforms.sunDir.value as THREE.Vector3).copy(sunDirWorld)
    this.mat.uniforms.lightGain.value = lightGain
    for (let i = 0; i < this.counts.length; i++) this.counts[i] = 0
    const rp = this.root.position
    const fade = Math.min(1, this.density / 0.08)
    for (let o = 0; o < this.rocks.length; o++) {
      const list = this.rocks[o]
      for (let j = 0; j < this.rockCount[o]; j++) {
        const rk = list[j]
        const dx = rp.x + rk.x, dy = rp.y + rk.y, dz = rp.z + rk.z
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
        const px = (2 * rk.r / Math.max(dist, 1e-6)) * pxPerRad * fade
        if (px < 0.6) continue
        const lod = px > 45 ? 0 : 1
        const mi  = rk.shape * 2 + lod
        const c   = this.counts[mi]
        if (c >= this.capacity) continue
        this._axis.set(rk.ax, rk.ay, rk.az)
        this._q.setFromAxisAngle(this._axis, rk.phase + rk.w * timeSec)
        this.dummy.position.set(rk.x, rk.y, rk.z)
        this.dummy.quaternion.copy(this._q)
        this.dummy.scale.setScalar(rk.r * Math.min(1, fade * 1.5))
        this.dummy.updateMatrix()
        const mesh = this.meshes[mi]
        mesh.setMatrixAt(c, this.dummy.matrix)
        ;(mesh.geometry.getAttribute('instanceColor') as THREE.InstancedBufferAttribute).setXYZ(c, rk.cr, rk.cg, rk.cb)
        this.counts[mi] = c + 1
      }
    }
    for (let i = 0; i < this.meshes.length; i++) {
      const m = this.meshes[i]
      m.count = this.counts[i]
      m.instanceMatrix.needsUpdate = true
      ;(m.geometry.getAttribute('instanceColor') as THREE.InstancedBufferAttribute).needsUpdate = true
    }
  }

  /** Rocks drawn this frame. */
  get visibleCount(): number { let n = 0; for (const c of this.counts) n += c; return n }

  dispose(): void {
    for (const g of this.geos) g.dispose()
    this.mat.dispose()
    this.tex.diff.dispose(); this.tex.normal.dispose(); this.tex.rough.dispose()
  }
}
