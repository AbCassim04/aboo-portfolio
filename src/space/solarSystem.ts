import * as THREE from 'three'
import {
  createMercury, createVenus, createMars, createJupiter,
  createSaturn, createUranus, createNeptune,
} from '../utils/planetFactories'
import { createLiveEarth } from '../earth/LiveEarth'
import type { LiveEarth } from '../earth/LiveEarth'
import type { CloudStatus } from '../earth/liveClouds'
import { createMoonPlacer } from '../earth/moon'
import type { MoonPlacer } from '../earth/moon'
import {
  AU_KM, BODY_PHYSICAL, SATURN_RING_TEXTURE_INNER_KM, SATURN_RING_TEXTURE_OUTER_KM,
  apparentMagnitude, bodyPole, bodyQuaternion, daysTT, earthPositionKm, planetBarycentreKm,
} from './ephemeris'
import type { BodyId, PlanetId } from './ephemeris'
import type { FloatingOrigin } from './floatingOrigin'
import { createSun } from './sun'
import type { SunObject } from './sun'
import { Impostors } from './impostors'
import { OrbitLines } from './orbits'

// ── The true-scale solar system ─────────────────────────────────────────────
// Every body at its real size, placed each frame from the ephemeris for the
// shared sim clock, oriented from IAU pole/rotation data (Earth: the verified
// Live Earth orientation, pointed at its true pole), lit by a point light at
// the Sun with eye adaptation, plus impostors and orbit lines.
//
// Lighting & eye adaptation: the Sun is a PointLight with physical
// inverse-square falloff, calibrated so a body at 1 AU receives what the old
// flight-mode sunlight gave (3.5). Instead of a global exposure (which would
// also brighten unlit UI-like objects, the Sun's own disc and the sky), the
// adaptation multiplies the sunlight: A = (d_camera / 1 AU)^1.6, smoothed over
// ~1.2 s and clamped. Net brightness of a body at the camera's distance from
// the Sun therefore falls as d^-0.4 — Neptune's neighbourhood is ~4× dimmer
// than Earth's instead of 900×, still clearly readable. Shader-lit parts that
// do not use three.js lights (Live Earth clouds/rim, Saturn's rings, impostors)
// get the same factor via lightGainAt().

export const SUN_LIGHT_AT_1AU = 3.5
const ADAPT_EXPONENT = 1.6
const ADAPT_MIN = 0.3
const ADAPT_MAX = 400
const ADAPT_TAU = 1.2

/** Planets other than Earth (placed from their system barycentres). */
const OUTER_PLANETS: readonly PlanetId[] = ['mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune']

export const BODY_ORDER: BodyId[] = ['sun', 'mercury', 'venus', 'earth', 'moon', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune']

const IMPOSTOR_COLOR: Record<BodyId, number> = {
  sun: 0xfff2d8, mercury: 0xb0a89f, venus: 0xf3e3c3, earth: 0x9cc6ff, moon: 0xd8d4cc,
  mars: 0xe07a4f, jupiter: 0xe8c49a, saturn: 0xeedca5, uranus: 0xbfeef0, neptune: 0x7f9fff,
}

/** Orbit line colours (dim, so the lines stay faint). */
const ORBIT_COLOR: Record<PlanetId | 'moon', number> = {
  mercury: 0x9a948c, venus: 0xd9c08f, earth: 0x5b9be0, moon: 0xa9a9b8, mars: 0xc0562b,
  jupiter: 0xd8a06a, saturn: 0xe6cd8f, uranus: 0x8fd7dc, neptune: 0x5f7fe0,
}

export interface Body {
  id:      BodyId
  /** World position (km, float64), updated by update(). */
  world:   THREE.Vector3
  radius:  number
  /** Object positioned by the floating origin. */
  object:  THREE.Object3D
  /** Last disc diameter on screen (device px). */
  discPx:  number
  /** Last apparent magnitude seen from the camera (unadapted). */
  magnitude: number
}

export interface SolarSystemOptions {
  isMobile:      boolean
  renderer:      THREE.WebGLRenderer
  onCloudStatus: (s: CloudStatus) => void
}

const _tmp   = new THREE.Vector3()
const _toSun = new THREE.Vector3()
const _toObs = new THREE.Vector3()
const _rel   = new THREE.Vector3()
const _e0 = new THREE.Vector3(), _e1 = new THREE.Vector3()
const _m0 = new THREE.Vector3(), _m1 = new THREE.Vector3()
const _rv = new THREE.Vector3(), _mid = new THREE.Vector3(), _rl = new THREE.Vector3()
const _rq = new THREE.Quaternion()

export class SolarSystem {
  readonly bodies: Record<BodyId, Body>
  readonly list:   Body[]
  readonly earth:  LiveEarth
  readonly moonPlacer: MoonPlacer
  readonly sun:    SunObject
  readonly sunLight: THREE.PointLight
  readonly impostors: Impostors
  readonly orbits: OrbitLines
  /** Current eye-adaptation factor (1 at 1 AU). */
  adaptation = 1
  /**
   * World velocity of every body (km per real second): the ephemeris
   * derivative times the sim rate (sim seconds per real second).
   */
  readonly velocities: Record<BodyId, THREE.Vector3>
  /** Earth→Sun unit vector and Earth's spin axis (fed to Live Earth). */
  private readonly earthSunDir = new THREE.Vector3(-1, 0, 0)
  private readonly earthPole   = new THREE.Vector3(0, 1, 0)
  private readonly moonGeo     = new THREE.Vector3()
  private readonly planetMeshes: Partial<Record<PlanetId, { group: THREE.Group; mesh: THREE.Mesh; dispose: () => void }>> = {}
  private readonly venusAtmo: THREE.Mesh
  private readonly saturnRingMat: THREE.MeshBasicMaterial
  private readonly moonMesh: THREE.Mesh
  private readonly moonDispose: () => void
  private adaptInit = false

  constructor(scene: THREE.Scene, origin: FloatingOrigin, loader: THREE.TextureLoader, opts: SolarSystemOptions) {
    const { isMobile, renderer } = opts
    const P = BODY_PHYSICAL
    const segSmall = isMobile ? 64 : 128
    const segGiant = isMobile ? 64 : 160

    // ── Sun + light ──
    this.sun = createSun(loader, isMobile)
    scene.add(this.sun.group)
    this.sunLight = new THREE.PointLight(0xfff5e0, SUN_LIGHT_AT_1AU * AU_KM * AU_KM, 0, 2)
    this.sunLight.name = 'SunLight'
    scene.add(this.sunLight)
    const sunWorld = new THREE.Vector3()
    origin.track(this.sun.group, sunWorld)
    origin.track(this.sunLight, sunWorld)

    // ── Planets ──
    const mk = <T extends { group: THREE.Group; mesh: THREE.Mesh; dispose: () => void }>(id: PlanetId, o: T): T => {
      this.planetMeshes[id] = o
      const ratio = P[id].polarRadius / P[id].radius
      if (ratio !== 1) o.mesh.scale.y = ratio      // oblate giants
      o.mesh.rotation.set(0, 0, 0)
      scene.add(o.group)
      return o
    }
    mk('mercury', createMercury(loader, isMobile, { radius: P.mercury.radius, segments: segSmall }))
    const venus = mk('venus', createVenus(loader, isMobile, { radius: P.venus.radius, segments: segSmall, atmosphereScale: 1.012 }))
    this.venusAtmo = venus.atmoMesh
    mk('mars', createMars(loader, isMobile, { radius: P.mars.radius, segments: segSmall }))
    mk('jupiter', createJupiter(loader, isMobile, { radius: P.jupiter.radius, segments: segGiant }))
    const saturn = mk('saturn', createSaturn(loader, isMobile, {
      radius: P.saturn.radius, segments: segGiant, equatorialRing: true,
      ringInner: SATURN_RING_TEXTURE_INNER_KM, ringOuter: SATURN_RING_TEXTURE_OUTER_KM,
    }))
    this.saturnRingMat = saturn.ringMesh.material as THREE.MeshBasicMaterial
    mk('uranus', createUranus(loader, isMobile, { radius: P.uranus.radius, segments: segGiant }))
    mk('neptune', createNeptune(loader, isMobile, { radius: P.neptune.radius, segments: segGiant }))

    // ── Earth (Live Earth at true radius) ──
    this.earth = createLiveEarth(loader, isMobile, {
      radius:            P.earth.radius,
      cloudScale:        1 + 16 / P.earth.radius,     // cloud tops ~16 km
      atmosphereScale:   1 + 130 / P.earth.radius,    // limb glow out to ~130 km
      sunDirection:      this.earthSunDir,
      poleHint:          this.earthPole,
      orientThresholdMs: 0,                           // the surface moves 0.46 km/s: update every frame
      segments:          isMobile ? 96 : 192,
      renderer,
      onCloudStatus:     opts.onCloudStatus,
    })
    scene.add(this.earth.group)

    // ── Moon ──
    const moonTex = loader.load(import.meta.env.BASE_URL + 'earth/8k_moon.jpg')
    moonTex.colorSpace = THREE.SRGBColorSpace
    const moonGeo = new THREE.SphereGeometry(P.moon.radius, segSmall, segSmall / 2)
    const moonMat = new THREE.MeshPhongMaterial({ map: moonTex, shininess: 5 })
    this.moonMesh = new THREE.Mesh(moonGeo, moonMat)
    this.moonMesh.name = 'Moon'
    scene.add(this.moonMesh)
    this.moonPlacer  = createMoonPlacer(this.moonMesh, this.earth.group, 'true', 0)
    this.moonDispose = () => { moonGeo.dispose(); moonMat.dispose(); moonTex.dispose() }

    // ── Body table ──
    const objectOf = (id: BodyId): THREE.Object3D =>
      id === 'sun' ? this.sun.group : id === 'earth' ? this.earth.group : id === 'moon' ? this.moonMesh : this.planetMeshes[id as PlanetId]!.group
    this.list = BODY_ORDER.map((id) => {
      const object = objectOf(id)
      const world  = id === 'sun' ? sunWorld : origin.track(object, new THREE.Vector3())
      return { id, world, radius: P[id].radius, object, discPx: 0, magnitude: 0 }
    })
    this.bodies = Object.fromEntries(this.list.map(b => [b.id, b])) as Record<BodyId, Body>
    this.velocities = Object.fromEntries(BODY_ORDER.map(id => [id, new THREE.Vector3()])) as Record<BodyId, THREE.Vector3>

    // ── Impostors & orbits ──
    this.impostors = new Impostors(this.list.length)
    this.list.forEach((b, i) => this.impostors.setColor(i, new THREE.Color(IMPOSTOR_COLOR[b.id])))
    scene.add(this.impostors.points)
    this.orbits = new OrbitLines([
      ...(['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'] as PlanetId[])
        .map(id => ({ id, color: new THREE.Color(ORBIT_COLOR[id]), alpha: 0.5 })),
      { id: 'moon' as const, color: new THREE.Color(ORBIT_COLOR.moon), alpha: 0.45 },
    ])
    scene.add(this.orbits.object)
  }

  /** Sunlight at `world` relative to 1 AU, including eye adaptation. */
  lightGainAt(world: THREE.Vector3): number {
    const r = Math.max(world.length(), BODY_PHYSICAL.sun.radius) / AU_KM
    return this.adaptation / (r * r)
  }

  /**
   * World positions and orientations for `simMs`. `camWorld` is the camera's
   * world position (for eye adaptation), `dt` the frame time (s), `simRate`
   * sim seconds per real second (for velocities).
   */
  update(simMs: number, camWorld: THREE.Vector3, dt: number, simRate = 1): void {
    const B = this.bodies
    // Earth first (others use it), from the EM barycentre and the Moon.
    earthPositionKm(simMs, B.earth.world, this.moonGeo)
    this.earthSunDir.copy(B.earth.world).negate().normalize()
    bodyPole('earth', simMs, this.earthPole)
    this.earth.update(simMs, true)

    // Moon: direction from the Live Earth chain (consistent with the globe),
    // real distance from the series.
    this.moonPlacer.update(simMs)
    B.moon.world.addVectors(B.earth.world, this.moonPlacer.offset)

    for (const id of OUTER_PLANETS) {
      planetBarycentreKm(id, simMs, B[id].world)
      bodyQuaternion(id, simMs, this.planetMeshes[id]!.group.quaternion)
    }
    bodyQuaternion('sun', simMs, this.sun.mesh.quaternion)
    // Venus' cloud deck super-rotates (retrograde, ~4 days).
    this.venusAtmo.rotation.y = -((daysTT(simMs) / 4) % 1) * Math.PI * 2

    // Eye adaptation (log-space smoothing).
    const target = Math.min(ADAPT_MAX, Math.max(ADAPT_MIN, Math.pow(Math.max(camWorld.length(), 1) / AU_KM, ADAPT_EXPONENT)))
    if (!this.adaptInit) { this.adaptation = target; this.adaptInit = true }
    else this.adaptation = Math.exp(Math.log(this.adaptation) + (Math.log(target) - Math.log(this.adaptation)) * (1 - Math.exp(-dt / ADAPT_TAU)))
    this.sunLight.intensity = SUN_LIGHT_AT_1AU * AU_KM * AU_KM * this.adaptation
    this.earth.setLightGain(this.lightGainAt(B.earth.world))
    const ringGain = Math.min(1.2, this.lightGainAt(B.saturn.world))
    this.saturnRingMat.color.setScalar(ringGain)

    this.orbits.recompute(simMs)
    this.computeVelocities(simMs, simRate)
  }

  /** Central differences over ±0.5 s of sim time, scaled to real seconds. */
  private computeVelocities(simMs: number, simRate: number): void {
    const V = this.velocities
    const h = 500
    earthPositionKm(simMs + h, _e1, _m1)
    earthPositionKm(simMs - h, _e0, _m0)
    V.earth.subVectors(_e1, _e0).multiplyScalar(simRate)
    // The Moon is placed from the Live Earth chain (equinox of date): rotate
    // the ephemeris (J2000) geocentric velocity onto that direction so the
    // velocity matches how the placed Moon actually moves.
    _rv.subVectors(_m1, _m0).multiplyScalar(simRate)
    _mid.addVectors(_m1, _m0).normalize()
    if (this.moonPlacer.offset.lengthSq() > 0) _rv.applyQuaternion(_rq.setFromUnitVectors(_mid, _rl.copy(this.moonPlacer.offset).normalize()))
    V.moon.copy(V.earth).add(_rv)
    V.sun.set(0, 0, 0)
    for (const id of OUTER_PLANETS) {
      planetBarycentreKm(id, simMs + h, _e1)
      planetBarycentreKm(id, simMs - h, _e0)
      V[id].subVectors(_e1, _e0).multiplyScalar(simRate)
    }
  }

  /**
   * After the floating origin has applied: impostors, mesh visibility, glare
   * and orbit lines. `pxPerRad` converts angles to device pixels.
   */
  afterApply(camera: THREE.PerspectiveCamera, camWorld: THREE.Vector3, pxPerRad: number, dpr: number,
    toRender: (w: THREE.Vector3, out: THREE.Vector3) => THREE.Vector3): void {
    const B = this.bodies
    const sunWorld = B.sun.world
    const adaptMag = 2.5 * Math.log10(this.adaptation)
    for (let i = 0; i < this.list.length; i++) {
      const b = this.list[i]
      const rp = b.object.position          // render position (camera at origin)
      const d  = Math.max(rp.length(), 1e-6)
      b.discPx = 2 * Math.asin(Math.min(1, b.radius / Math.max(d, b.radius))) * pxPerRad
      // Apparent magnitude: distances in AU, phase angle at the body.
      _toSun.subVectors(sunWorld, b.world)
      _toObs.subVectors(camWorld, b.world)
      const rAU = Math.max(_toSun.length(), 1) / AU_KM
      const dAU = Math.max(_toObs.length(), 1) / AU_KM
      let ring = 0
      if (b.id === 'saturn') {
        bodyPole('saturn', 0, _tmp)   // pole drift is negligible for the magnitude
        ring = Math.asin(Math.min(1, Math.abs(_tmp.dot(_rel.copy(_toObs).normalize())))) * 180 / Math.PI
      }
      const alpha = b.id === 'sun' ? 0 : _toSun.angleTo(_toObs) * 180 / Math.PI
      b.magnitude = apparentMagnitude(b.id, rAU, dAU, alpha, ring)
      if (b.id === 'sun') {
        this.impostors.set(i, rp, b.radius, b.magnitude, b.discPx, dpr, 1.6)
      } else {
        this.impostors.set(i, rp, b.radius, b.magnitude - adaptMag, b.discPx, dpr)
        // Mesh only once it covers about a pixel (no sub-pixel shimmer).
        b.object.visible = b.discPx > 0.8 * dpr
      }
    }
    this.impostors.commit()
    this.sun.update(B.sun.object.position.length(), camera.fov)
    this.orbits.update(toRender, B.earth.world)
  }

  dispose(): void {
    this.sun.dispose()
    this.earth.dispose()
    this.moonDispose()
    for (const o of Object.values(this.planetMeshes)) o?.dispose()
    this.impostors.dispose()
    this.orbits.dispose()
  }
}
