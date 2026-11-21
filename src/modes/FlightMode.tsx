import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { useFlightControls }  from '../hooks/useFlightControls'
import FlightHUD              from '../components/FlightHUD'
import type { HudReadout, RadarBlip } from '../components/FlightHUD'
import LoadingScreen          from '../components/LoadingScreen'
import PlanetLabels           from '../components/PlanetLabels'
import type { PlanetLabelDatum } from '../components/PlanetLabels'
import PlanetInfoPanel        from '../components/PlanetInfoPanel'
import SystemMap              from '../components/SystemMap'
import TargetMarker           from '../components/TargetMarker'
import { createMapData, createTargetMarkerDatum } from '../flight/navUi'
import type { MapData, MapDebug, TargetMarkerDatum } from '../flight/navUi'
import { EXTRA_INFO, PLANET_DATA } from '../data/planetData'
import type { PlanetDatum } from '../data/planetData'
import AboutOverlay           from '../overlays/AboutOverlay'
import SkillsOverlay          from '../overlays/SkillsOverlay'
import ProjectsOverlay        from '../overlays/ProjectsOverlay'
import ContactOverlay         from '../overlays/ContactOverlay'
import type { Zone as NavZone } from '../hooks/useCameraNavigation'
import { pickLatLon }         from '../earth/geo'
import type { CloudStatus }   from '../earth/liveClouds'
import { getSimClockState, getSimTimeMs, goLive, setSpeed as setSimSpeed } from '../sim/simClock'
import { DEBUG_ENABLED, registerDebugProvider, setDebugReady } from '../debug/spaceon'
import { ContinuityMonitor }  from '../debug/continuity'
import { FloatingOrigin }     from '../space/floatingOrigin'
import { CAMERA_FAR, CAMERA_NEAR, findMissingDepthChunks } from '../space/depth'
import { AU_KM, BODY_PHYSICAL, C_KM_S, earthPositionKm, hillRadiusKm, sphereOfInfluenceKm } from '../space/ephemeris'
import type { BodyId } from '../space/ephemeris'
import { SolarSystem }        from '../space/solarSystem'
import { BeltBand, LocalBeltField } from '../space/belt'
import {
  MARKER_KM_PER_UNIT, SPAWN_VIEW, ZONE_PLACEMENT, computeZoneFrame, createZoneFrame, zoneViewDir, zoneViewPoint,
} from '../space/portfolioZone'
import { createSky }          from '../flight/sky'
import { ISS_SIZE_KM, JWST_SIZE_KM, createAstronaut, createISS, createJWST } from '../flight/models'
import { DESTINATIONS, LANDING_RADIUS_KM, createDestinations } from '../flight/destinations'
import { FLIGHT, ShipModel, hasManualInput, quatLookingAlong } from '../flight/shipModel'
import type { Surface } from '../flight/shipModel'
import { CameraRig }          from '../flight/cameraRig'
import type { CameraMode }    from '../flight/cameraRig'
import { createIssFrame, issWorldAt, jwstWorldAt, ISS_PERIOD_S, ISS_ALTITUDE_KM } from '../flight/satellites'
import { formatDistance, formatEta, formatLightTime, formatSpeed } from '../flight/units'
import { NAV_BY_ID, NAV_ENTRIES, isBodyId, navPositionAt } from '../flight/navRegistry'
import type { NavContext } from '../flight/navRegistry'
import { Autopilot } from '../flight/autopilot'
import { FAST_TRAVEL_SECONDS, FastTravel } from '../flight/fastTravel'
import type { Obstacle } from '../flight/fastTravel'
import { WarpStreaks } from '../flight/warpStreaks'
import { closeWhoosh, playWhoosh } from '../flight/whoosh'
import type { WhooshHandle } from '../flight/whoosh'

// ── Flight mode: the real solar system at true scale ───────────────────────
// 1 world unit = 1 km; heliocentric ecliptic J2000 (Sun at the origin, scene
// XZ = ecliptic, +Y = ecliptic north). See docs/TRUE_SCALE_PLAN.md.
//
// Rendering is camera-relative (FloatingOrigin): the camera stays at (0,0,0)
// and every tracked object's render position is derived each frame from its
// float64 world position. The ship lives in the floating-origin frame, which
// rides with the "host" (the body — or spacecraft — whose region the ship is
// in), so it stays put relative to Earth (or Mars, the ISS, …) while that
// body moves. Switching host keeps the ship's world velocity, so crossing a
// region boundary never jumps.
//
// Flight model: src/flight/shipModel.ts (MANUAL / CRUISE). Camera:
// src/flight/cameraRig.ts (CHASE / COCKPIT / ORBIT). Navigation: registry
// (src/flight/navRegistry.ts), target lock + edge arrow, AUTOPILOT
// (src/flight/autopilot.ts), FAST TRAVEL (src/flight/fastTravel.ts) and the
// system map (src/components/SystemMap.tsx).

// ── Ship ───────────────────────────────────────────────────────────────────
// The UFO is ~16 m across (19 m at the rim): its geometry is authored in old
// scene units and scaled by UFO_KM_PER_UNIT.
const UFO_KM_PER_UNIT = 0.02
const SHIP_RADIUS_KM  = 0.48 * UFO_KM_PER_UNIT
/** Headlight: the old 60 at ~10 units, rescaled for the 16 m ship (decay 1.2). */
const HEADLIGHT_ON    = 60 * Math.pow(UFO_KM_PER_UNIT, 1.2)

export type TravelMode = 'manual' | 'cruise' | 'autopilot' | 'fasttravel'

/** Closest approach to a body's centre (km): above the atmosphere for Earth. */
function minApproachKm(id: BodyId): number {
  const r = BODY_PHYSICAL[id].radius
  if (id === 'earth') return r + 150
  if (id === 'sun')   return r * 1.5
  return r * 1.003 + 5
}

// ── Arrival framing ────────────────────────────────────────────────────────
/** A body seen from its arrival distance fills this fraction of the view (smaller FOV dimension). */
const ARRIVAL_FILL = 0.4
/** The Sun: a safe, glare-limited distance (radii). */
const SUN_ARRIVAL_RADII = 12
/** Spacecraft / portfolio markers: arrival distances (km). */
const ISS_ARRIVAL_KM  = 0.25
const JWST_ARRIVAL_KM = 0.06
const DEST_ARRIVAL_KM = 1_500
/** Arrivals look this far below the target, so it sits just above the (low-framed) ship. */
const ARRIVAL_PITCH = 7 * Math.PI / 180

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

/** Half the smaller field-of-view dimension (rad) of a perspective camera. */
function halfFovMin(camera: THREE.PerspectiveCamera): number {
  const v = camera.fov * Math.PI / 360
  return Math.min(v, Math.atan(Math.tan(v) * camera.aspect))
}

/** Centre distance at which a sphere of `radius` spans ARRIVAL_FILL of the smaller view dimension. */
function fillDistanceKm(radius: number, camera: THREE.PerspectiveCamera): number {
  const alpha = Math.atan(ARRIVAL_FILL * Math.tan(halfFovMin(camera)))
  return radius / Math.sin(alpha)
}

// ── Decorative objects ─────────────────────────────────────────────────────
/** Astronaut near the spawn point (km): right, up, ahead of the ship in the spawn view. */
const ASTRONAUT_SPAWN_OFFSET = new THREE.Vector3(0.012, 0.004, 0.055)
const ASTRONAUT_TUMBLE       = [0.06, 0.048, 0.03]                        // rad/s about x, y, z
// Viewer-side fill light (outside his mesh), rescaled from the old 30 / 6 / 12 units.
const ASTRONAUT_LIGHT_OFFSET    = 0.003
const ASTRONAUT_LIGHT_INTENSITY = 30 * UFO_KM_PER_UNIT * UFO_KM_PER_UNIT
const ASTRONAUT_LIGHT_RANGE     = 0.006

// Animation rates that used to be applied once per frame were tuned at 60 fps.
// The loop scales them by k = dt · REF_FPS (dt = clamped frame time), so they
// look the same at 60 fps and don't speed up on 120/144 Hz screens.
const REF_FPS      = 60
const TRAIL_STEP   = 1 / REF_FPS   // trails keep one sample per 1/60 s
const HUD_INTERVAL = 0.1           // React HUD state updates at ~10 Hz
const ENTRY_DUR    = 2.0

/**
 * Bodies that can host the ship's frame (the ship rides along with its host).
 * Riding along is a viewing frame, not orbital mechanics, so the region is
 * generous: 1.25 × the Hill radius (at least the sphere of influence). For
 * Earth that is ~1.9 million km, which keeps JWST's L2 halo in Earth's frame.
 * The ISS and JWST host a small region of their own, so you can park next to
 * them. The smallest region containing the ship wins; otherwise the Sun.
 */
const HOST_BODIES: BodyId[] = ['moon', 'mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune']
const SOI: Partial<Record<BodyId, number>> = Object.fromEntries(
  HOST_BODIES.map(id => [id, Math.max(sphereOfInfluenceKm(id), 1.25 * hillRadiusKm(id))]))
const SPACECRAFT_REGION_KM = 30

const HOST_NAMES: Record<string, string> = {
  sun: 'Sun', mercury: 'Mercury', venus: 'Venus', earth: 'Earth', moon: 'Moon', mars: 'Mars',
  jupiter: 'Jupiter', saturn: 'Saturn', uranus: 'Uranus', neptune: 'Neptune', iss: 'ISS', jwst: 'JWST',
}

/**
 * Advance a position trail by `steps` fixed-interval samples. Slot 0 is the
 * live head (`to`); new samples are interpolated from the previous head so a
 * long frame doesn't leave gaps. With 0 steps only the head moves.
 */
function advanceTrail(buf: Float32Array, count: number, steps: number, to: THREE.Vector3): void {
  const n = Math.min(steps, count - 1)
  if (n > 0) {
    const fx = buf[0], fy = buf[1], fz = buf[2]
    buf.copyWithin(n * 3, 0, (count - n) * 3)
    for (let s = 0; s < n; s++) {
      const f = 1 - s / n
      buf[s * 3]     = fx + (to.x - fx) * f
      buf[s * 3 + 1] = fy + (to.y - fy) * f
      buf[s * 3 + 2] = fz + (to.z - fz) * f
    }
  } else {
    buf[0] = to.x; buf[1] = to.y; buf[2] = to.z
  }
}

/** Re-express frame-relative trail samples after the frame moved by (dx, dy, dz). */
function shiftTrail(buf: Float32Array, dx: number, dy: number, dz: number): void {
  for (let i = 0; i < buf.length; i += 3) { buf[i] -= dx; buf[i + 1] -= dy; buf[i + 2] -= dz }
}

/** Destination name → index in DESTINATIONS. */
const DEST_INDEX: Record<string, number> = Object.fromEntries(DESTINATIONS.map((d, i) => [d.name, i]))

/** In-flight labels: the Sun and planets, plus the Moon, ISS and JWST. */
const LABEL_ITEMS: PlanetDatum[] = [...PLANET_DATA, ...EXTRA_INFO.filter(e => e.key === 'moon' || e.key === 'iss' || e.key === 'jwst')]

/** Navigation command from the UI (map, info card) to the flight loop. */
interface NavCommand { kind: 'target' | 'autopilot' | 'fasttravel'; id: string }

interface FlightModeProps {
  onExit:            () => void
  onEnterBlackHole:  () => void
}

interface RadarState { dots: RadarBlip[]; bodies: RadarBlip[] }

const INITIAL_READOUT: HudReadout = {
  mode: 'manual', camera: 'chase', speed: '0 m/s', speedKmS: 0, speedRef: 'Earth', speedFrac: 0,
  distLabel: 'Earth', dist: '—', distKm: NaN, light: '', eta: '—', etaS: null, limitedBy: null,
  target: null, detour: null,
}

export default function FlightMode({ onExit, onEnterBlackHole }: FlightModeProps) {
  const containerRef        = useRef<HTMLDivElement>(null)
  const onExitRef           = useRef(onExit)
  const onEnterBlackHoleRef = useRef(onEnterBlackHole)
  useEffect(() => { onExitRef.current = onExit }, [onExit])
  useEffect(() => { onEnterBlackHoleRef.current = onEnterBlackHole }, [onEnterBlackHole])

  const inputRef = useFlightControls()

  const [readout,       setReadout]       = useState<HudReadout>(INITIAL_READOUT)
  const [nearestPlanet, setNearestPlanet] = useState<{ name: string; distance: number } | null>(null)
  const [radar,         setRadar]         = useState<RadarState>({ dots: [], bodies: [] })
  const [inBelt,        setInBelt]        = useState(false)
  const [fps,           setFps]           = useState(0)
  const [loadProgress,  setLoadProgress]  = useState(0)
  const [loadDone,      setLoadDone]      = useState(false)
  const [lightOn,       setLightOn]       = useState(false)
  const [cloudStatus,   setCloudStatus]   = useState<CloudStatus>({ kind: 'loading' })
  const lightOnRef  = useRef(false)
  const ufoLightRef = useRef<THREE.SpotLight | null>(null)

  // ── Planet identification system ──────────────────────────────────────────
  const [selectedPlanet, setSelectedPlanet] = useState<string | null>(null)
  const [activeBodyKey,  setActiveBodyKey]  = useState<string | null>(null)
  // Screen-space label positions written every frame by the flight loop.
  const planetLabelDataRef = useRef<PlanetLabelDatum[]>(
    LABEL_ITEMS.map(() => ({ x: 0, y: 0, visible: false })),
  )

  // ── Navigation UI state ───────────────────────────────────────────────────
  const [mapOpen,   setMapOpen]   = useState(false)
  const [targetKey, setTargetKey] = useState<string | null>(null)
  const mapOpenRef      = useRef(false)
  const navCmdRef       = useRef<NavCommand[]>([])
  const mapDataRef      = useRef<MapData>(createMapData())
  const mapDebugRef     = useRef<MapDebug | null>(null)
  const targetMarkerRef = useRef<TargetMarkerDatum>(createTargetMarkerDatum())
  const distanceToRef   = useRef<(id: string) => string>(() => '')
  const openMap = (open: boolean) => { mapOpenRef.current = open; setMapOpen(open) }
  const openMapRef = useRef(openMap)
  useEffect(() => { openMapRef.current = openMap })
  const [selectedDist, setSelectedDist] = useState('')
  const selectInfo = (key: string) => { setSelectedPlanet(key); setSelectedDist(distanceToRef.current(key)) }
  const navCommand = (kind: NavCommand['kind'], id: string) => {
    navCmdRef.current.push({ kind, id })
    setSelectedPlanet(null)
    openMap(false)
  }

  type Zone = 'flight' | 'about' | 'skills' | 'projects' | 'contact'
  const [currentZone,    setCurrentZone]    = useState<Zone>('flight')
  const [isTransitioning, setIsTransitioning] = useState(false)
  const currentZoneRef = useRef<Zone>('flight')

  const navigateTo = (zone: Zone) => {
    setIsTransitioning(true)
    setTimeout(() => {
      setCurrentZone(zone)
      currentZoneRef.current = zone
      setIsTransitioning(false)
    }, 300)
  }

  const toggleLight = () => {
    lightOnRef.current = !lightOnRef.current
    if (ufoLightRef.current) ufoLightRef.current.intensity = lightOnRef.current ? HEADLIGHT_ON : 0
    setLightOn(lightOnRef.current)
  }
  const toggleLightRef = useRef(toggleLight)
  useEffect(() => { toggleLightRef.current = toggleLight })

  const isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // Real asset-loading progress is tracked through this manager (textures +
    // GLBs are all routed through it). onProgress reports 0–1 but is capped at
    // 0.95 — the final 5% is reserved for the GPU pre-warm step (see onLoad),
    // so "100%" only ever means "shaders compiled and textures uploaded".
    let gpuWarmed = false
    const loadingManager = new THREE.LoadingManager()
    // Debug-hook bookkeeping (only touched when the hook is enabled).
    const dbgAssets = { loaded: 0, total: 0, failed: [] as string[] }
    loadingManager.onProgress = (_url, loaded, total) => {
      if (DEBUG_ENABLED) { dbgAssets.loaded = loaded; dbgAssets.total = total }
      if (gpuWarmed) return
      setLoadProgress(total > 0 ? Math.min(loaded / total, 0.95) : 0)
    }
    if (DEBUG_ENABLED) loadingManager.onError = (url) => { dbgAssets.failed.push(url) }
    const sharedLoader = new THREE.TextureLoader(loadingManager)

    // ── Scene / Camera / Renderer ──────────────────────────────────────────
    // Two scenes, rendered in this order every frame:
    //   skyScene — stars, Milky Way, nebula: drawn first, centred on the
    //              camera (so infinitely far), then the depth buffer is
    //              cleared, so they are always behind everything;
    //   scene    — the world, camera-relative (see FloatingOrigin).
    const scene    = new THREE.Scene()
    const skyScene = new THREE.Scene()
    const camera   = new THREE.PerspectiveCamera(65, container.clientWidth / container.clientHeight, CAMERA_NEAR, CAMERA_FAR)
    const renderer = new THREE.WebGLRenderer({ antialias: !isMobile, logarithmicDepthBuffer: true })
    renderer.setSize(container.clientWidth, container.clientHeight)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1.5 : 2))
    renderer.setClearColor(0x0c0c0c, 1)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.0
    renderer.autoClear = false          // cleared once per frame, before the sky pass
    renderer.info.autoReset = false     // stats cover both passes (reset per frame)
    container.appendChild(renderer.domElement)

    // ── Floating origin ────────────────────────────────────────────────────
    const origin    = new FloatingOrigin()
    const _camWorld = new THREE.Vector3()   // scratch: camera world position
    const _render   = new THREE.Vector3()   // scratch: a render-space point
    const _tmp      = new THREE.Vector3()
    const _tmp2     = new THREE.Vector3()
    const toRender  = (w: THREE.Vector3, out: THREE.Vector3) => origin.toRender(w, out)

    // ── Lights ────────────────────────────────────────────────────────────
    // The Sun's point light lives in SolarSystem; a faint ambient keeps night
    // sides from being pure black.
    scene.add(new THREE.AmbientLight(0x111122, 0.08))

    // ── Sky ───────────────────────────────────────────────────────────────
    const sky = createSky(sharedLoader, isMobile)
    for (const o of sky.objects) skyScene.add(o)

    // ── Solar system (true scale) ─────────────────────────────────────────
    const solar = new SolarSystem(scene, origin, sharedLoader, { isMobile, renderer, onCloudStatus: setCloudStatus })
    const B = solar.bodies
    const simRateNow = (): number => {
      const c = getSimClockState()
      return c.live ? 1 : c.paused ? 0 : c.speed
    }
    solar.update(getSimTimeMs(), _camWorld.set(AU_KM, 0, 0), 1 / 60, simRateNow())

    // ── Asteroid belt ─────────────────────────────────────────────────────
    const beltBand = new BeltBand(isMobile)
    scene.add(beltBand.group)
    origin.track(beltBand.group, new THREE.Vector3(0, 0, 0))
    beltBand.setPointSize(2.0 * renderer.getPixelRatio())
    const localBelt = new LocalBeltField(isMobile)
    scene.add(localBelt.root)
    origin.track(localBelt.root, localBelt.rootWorld)

    // ── Portfolio zone & destinations ─────────────────────────────────────
    const zone = createZoneFrame()
    computeZoneFrame(B.earth.world, zone)
    const destinations = createDestinations(scene, origin, isMobile)

    // ── Spacecraft (positions are pure functions of sim time) ─────────────
    const issWorld  = new THREE.Vector3()
    const issVel    = new THREE.Vector3()
    const issFrame  = createIssFrame()
    const jwstWorld = new THREE.Vector3()
    const jwstVel   = new THREE.Vector3()
    const updateSpacecraft = (simMs: number, rate: number) => {
      issWorldAt(simMs, B.earth.world, issWorld, issFrame)
      // v = v_earth + ω × r (circular orbit), per real second.
      issVel.copy(issFrame.along).multiplyScalar((BODY_PHYSICAL.earth.radius + ISS_ALTITUDE_KM) * 2 * Math.PI / ISS_PERIOD_S * rate)
        .add(solar.velocities.earth)
      jwstWorldAt(simMs, B.earth.world, jwstWorld)
      // JWST: central difference with Earth extrapolated linearly over ±0.5 s.
      const vE = solar.velocities.earth, r = Math.max(rate, 1e-9)
      _tmp.copy(B.earth.world).addScaledVector(vE, 0.5 / r)
      jwstWorldAt(simMs + 500, _tmp, _tmp2)
      _tmp.copy(B.earth.world).addScaledVector(vE, -0.5 / r)
      jwstWorldAt(simMs - 500, _tmp, _render)
      jwstVel.subVectors(_tmp2, _render).multiplyScalar(rate)
    }
    updateSpacecraft(getSimTimeMs(), simRateNow())

    // ── Host frames ───────────────────────────────────────────────────────
    interface Host { id: string; world: THREE.Vector3; vel: THREE.Vector3; region: number }
    const ZERO = new THREE.Vector3()
    const HOSTS: Host[] = [
      ...HOST_BODIES.map(id => ({ id, world: B[id].world, vel: solar.velocities[id], region: SOI[id]! })),
      { id: 'iss',  world: issWorld,  vel: issVel,  region: SPACECRAFT_REGION_KM },
      { id: 'jwst', world: jwstWorld, vel: jwstVel, region: SPACECRAFT_REGION_KM },
    ]
    const SUN_HOST: Host = { id: 'sun', world: B.sun.world, vel: ZERO, region: Infinity }
    const hostById = (id: string): Host => HOSTS.find(h => h.id === id) ?? SUN_HOST
    let host: Host = hostById('earth')

    // ── Ship: frame-relative, riding with its host ────────────────────────
    const ship = new ShipModel()
    let travel: TravelMode = 'manual'
    origin.switchHost(host.world)
    origin.toLocal(zone.spawn, ship.position)
    quatLookingAlong(zoneViewDir(zone, SPAWN_VIEW.az, SPAWN_VIEW.el, _tmp), ship.quaternion)
    const shipWorld = new THREE.Vector3()
    const updateShipWorld = () => { shipWorld.addVectors(origin.frame, ship.position) }
    updateShipWorld()

    // ── Surfaces (cruise limits, manual speed scaling, hard backstop) ─────
    // Cruise standoff (closest allowed centre distance) blends with how
    // directly the ship is heading at each surface: a heading line that hits
    // it (impact parameter < 0.6 R) → the arrival distance (cruise stops you
    // there, framed like an arrival); a line that misses it (> 1.15 R) → a
    // safety shell, so you fly past instead of stalling on a sphere you were
    // never going to hit. The
    // blend is continuous in heading and position, so the limit never jumps.
    const surfaces: Surface[] = []
    const surfWorld: THREE.Vector3[] = []
    const surfVelW:  THREE.Vector3[] = []
    const surfR:     number[] = []      // physical radius (km)
    const surfShell: number[] = []      // safety shell (km)
    const addSurface = (id: string, world: THREE.Vector3, velW: THREE.Vector3, radius: number, solid: boolean, physR: number, shell: number) => {
      surfaces.push({ id, local: new THREE.Vector3(), vel: new THREE.Vector3(), radius, standoff: radius, solid })
      surfWorld.push(world); surfVelW.push(velW); surfR.push(physR); surfShell.push(shell)
    }
    /** Destination velocities (world, km/s): the zone turns with the Sun–Earth line. */
    const destVel = DESTINATIONS.map(() => new THREE.Vector3())
    const destVelOf = (i: number) => destVel[i]
    for (const b of solar.list) {
      const r = BODY_PHYSICAL[b.id].radius
      addSurface(b.id, b.world, solar.velocities[b.id], minApproachKm(b.id), true, r,
        b.id === 'sun' ? 3 * r : Math.max(minApproachKm(b.id) * 1.02, 1.15 * r))
    }
    addSurface('iss',  issWorld,  issVel,  ISS_SIZE_KM / 2,  false, ISS_SIZE_KM / 2, 0.08)
    addSurface('jwst', jwstWorld, jwstVel, JWST_SIZE_KM / 2, false, JWST_SIZE_KM / 2, 0.03)
    DESTINATIONS.forEach((d, i) => {
      const r = d.size * MARKER_KM_PER_UNIT
      addSurface(d.name, destinations.world[i], destVelOf(i), r, false, r, 1.2 * r)
    })
    /** Arrival distance (centre, km): where arrivals drop out and cruise stops when aimed at it. */
    const arrivalKm = (id: string): number => {
      if (id === 'sun')  return BODY_PHYSICAL.sun.radius * SUN_ARRIVAL_RADII
      if (id === 'iss')  return ISS_ARRIVAL_KM
      if (id === 'jwst') return JWST_ARRIVAL_KM
      if (id in BODY_PHYSICAL) return fillDistanceKm(BODY_PHYSICAL[id as BodyId].radius, camera)
      return DEST_ARRIVAL_KM
    }
    const _hd = new THREE.Vector3()
    const _rel = new THREE.Vector3()
    const _tA  = new THREE.Vector3()
    // With a target: the target's standoff is its arrival distance; a body
    // whose arrival sphere contains the target's arrival point only keeps you
    // at its safety shell (or just inside the arrival point, e.g. the ISS
    // below Earth's shell), so it never stops you short of the target.
    const updateSurfaces = () => {
      ship.forward(_hd)
      const tSurf = targetSurface(targetId)
      if (targetId) liveCentre(targetId, _tA).add(arrival.offset)
      for (let i = 0; i < surfaces.length; i++) {
        const s = surfaces[i]
        origin.toLocal(surfWorld[i], s.local)
        s.vel.subVectors(surfVelW[i], host.vel)
        const arrivalI = Math.max(s.radius, arrivalKm(s.id))
        if (s.id === tSurf) { s.standoff = Math.max(s.radius, arrival.dist); continue }
        if (targetId) {
          const dA = _tA.distanceTo(surfWorld[i])
          if (dA < arrivalI) { s.standoff = Math.max(s.radius, Math.min(surfShell[i], dA * 0.98)); continue }
        }
        // Impact parameter of the heading ray (behind the ship → a miss).
        _rel.subVectors(s.local, ship.position)
        const along = _rel.dot(_hd)
        const b = along > 0 ? _rel.addScaledVector(_hd, -along).length() : Infinity
        const R = surfR[i]
        const w = 1 - smoothstep(0.6 * R, 1.15 * R, b)
        s.standoff = Math.max(s.radius, surfShell[i] + (arrivalI - surfShell[i]) * w)
      }
    }
    /** Autopilot steering keep-out radius per surface. */
    const surfIndex: Record<string, number> = Object.fromEntries(surfaces.map((s, i) => [s.id, i]))
    const apKeepOut = (s: Surface): number => {
      if (s.id === targetSurface(targetId)) return arrival.dist * 0.995
      if (!s.solid) return 0
      const i = surfIndex[s.id]
      const dA = targetId ? _tA.distanceTo(surfWorld[i]) : Infinity
      return Math.min(surfShell[i] * 1.3, Math.max(s.radius, dA * 0.98))
    }

    // ── Navigation: registry positions, target, arrival framing ───────────
    const navCtx: NavContext = { beltPoint: new THREE.Vector3(2.7 * AU_KM, 0, 0), moonCorrection: new THREE.Vector3() }
    let targetId: string | null = null
    /** Arrival offset from the target centre (world axes), look direction, distance. */
    const arrival = { offset: new THREE.Vector3(0, 0, 1), look: new THREE.Vector3(0, 0, -1), dist: 1 }
    const destBase = DESTINATIONS.map(() => new THREE.Vector3())
    // The zone turns with the Sun–Earth line: destination velocities (world,
    // km/s) by central difference with Earth extrapolated over ±0.5 sim-s.
    const _zf0 = createZoneFrame(), _zf1 = createZoneFrame()
    const _zp0 = new THREE.Vector3(), _zp1 = new THREE.Vector3(), _ze = new THREE.Vector3()
    const updateZoneVelocities = (rate: number) => {
      const vE = solar.velocities.earth
      if (rate === 0) { for (const v of destVel) v.set(0, 0, 0); return }
      computeZoneFrame(_ze.copy(B.earth.world).addScaledVector(vE, 0.5 / rate), _zf1)
      computeZoneFrame(_ze.copy(B.earth.world).addScaledVector(vE, -0.5 / rate), _zf0)
      for (let i = 0; i < DESTINATIONS.length; i++) {
        const p = ZONE_PLACEMENT[DESTINATIONS[i].name]
        zoneViewPoint(_zf1, p.range, p.az, p.el, _zp1)
        zoneViewPoint(_zf0, p.range, p.az, p.el, _zp0)
        destVel[i].subVectors(_zp1, _zp0).multiplyScalar(rate)
      }
    }
    const zoneTmp  = createZoneFrame()
    const _e0 = new THREE.Vector3(), _m0 = new THREE.Vector3()
    const updateMoonCorrection = (simMs: number) => {
      earthPositionKm(simMs, _e0, _m0)
      navCtx.moonCorrection.copy(B.moon.world).sub(_e0).sub(_m0)
    }
    /** Centre an arrival is framed around: Earth for the portfolio zone, else the thing itself. */
    const centreIdOf = (id: string) => (id === 'zone' ? 'earth' : id)
    const liveCentre = (id: string, out: THREE.Vector3): THREE.Vector3 => {
      const c = centreIdOf(id)
      if (c in B) return out.copy(B[c as BodyId].world)
      if (c === 'iss')  return out.copy(issWorld)
      if (c === 'jwst') return out.copy(jwstWorld)
      if (c === 'belt') return out.copy(navCtx.beltPoint)
      const i = DEST_INDEX[c] ?? -1
      return out.copy(i >= 0 ? destBase[i] : B.earth.world)
    }
    const liveCentreVel = (id: string, out: THREE.Vector3): THREE.Vector3 => {
      const c = centreIdOf(id)
      if (c in B) return out.copy(solar.velocities[c as BodyId])
      if (c === 'iss')  return out.copy(issVel)
      if (c === 'jwst') return out.copy(jwstVel)
      if (c === 'belt') return out.set(0, 0, 0)
      const i = DEST_INDEX[c] ?? -1
      return out.copy(i >= 0 ? destVel[i] : solar.velocities.earth)
    }
    const centreAt = (id: string) => (simMs: number, out: THREE.Vector3) => navPositionAt(centreIdOf(id), simMs, navCtx, out)
    /** Where the target marker points: the thing itself (the zone: its spawn point). */
    const displayWorld = (id: string, out: THREE.Vector3): THREE.Vector3 => (id === 'zone' ? out.copy(zone.spawn) : liveCentre(id, out))
    /** The target's own surface (its cruise standoff is the arrival distance), or null for places. */
    const targetSurface = (id: string | null): string | null => (!id || id === 'zone' || id === 'belt') ? null : id
    const radiusOf = (id: string) => (isBodyId(id) ? BODY_PHYSICAL[id as BodyId].radius : (NAV_BY_ID[id]?.radiusKm ?? 0))
    /** Distance to a navigable thing (surface for bodies; the belt: radial distance to its middle). */
    const distanceTo = (id: string): number => {
      if (id === 'belt') return Math.abs(Math.hypot(shipWorld.x, shipWorld.z) - 2.75 * AU_KM)
      return Math.max(0, shipWorld.distanceTo(displayWorld(id, _tmp)) - radiusOf(id))
    }
    distanceToRef.current = (id: string) => formatDistance(distanceTo(id))

    const _ac = new THREE.Vector3(), _ad = new THREE.Vector3(), _ah = new THREE.Vector3()
    /**
     * Arrival framing for `id` at sim time `simMs`: offset from the centre and
     * look direction. Bodies: on the sunlit side with the Sun ~35° off the
     * line behind the camera, at the distance where the body fills
     * ARRIVAL_FILL of the smaller view dimension; the Sun: 12 radii toward
     * the departure side; spacecraft: tens of metres sunward; portfolio
     * markers: 1 500 km toward the spawn; the zone: the spawn view.
     */
    const computeArrival = (id: string, simMs: number, from: THREE.Vector3) => {
      const o = arrival.offset, look = arrival.look
      if (id === 'zone') {
        earthPositionKm(simMs, _ac)
        computeZoneFrame(_ac, zoneTmp)
        o.subVectors(zoneTmp.spawn, _ac)
        zoneViewDir(zoneTmp, SPAWN_VIEW.az, SPAWN_VIEW.el, look)
      } else if (id === 'belt') {
        o.subVectors(from, navCtx.beltPoint)
        if (o.lengthSq() < 1) o.set(1, 0, 0)
        o.normalize().multiplyScalar(2_000)
        _ah.crossVectors(B.earth.world, solar.velocities.earth)
        if (_ah.lengthSq() < 1e-6) _ah.set(0, 1, 0)
        look.crossVectors(_ah.normalize(), navCtx.beltPoint).normalize()
      } else if (DESTINATIONS.some(d => d.name === id)) {
        navPositionAt(id, simMs, navCtx, _ac)
        earthPositionKm(simMs, _ad); computeZoneFrame(_ad, zoneTmp)
        o.subVectors(zoneTmp.spawn, _ac).normalize().multiplyScalar(DEST_ARRIVAL_KM)
        look.copy(o).negate().normalize()
      } else if (id === 'iss' || id === 'jwst') {
        navPositionAt(id, simMs, navCtx, _ac)
        o.copy(_ac).negate().normalize().add(_ad.set(0, 0.3, 0)).normalize().multiplyScalar(id === 'iss' ? ISS_ARRIVAL_KM : JWST_ARRIVAL_KM)
        look.copy(o).negate().normalize()
      } else if (id === 'sun') {
        o.copy(from)
        if (o.lengthSq() < 1) o.set(1, 0, 0)
        o.normalize()
        o.y += 0.2
        o.normalize().multiplyScalar(BODY_PHYSICAL.sun.radius * SUN_ARRIVAL_RADII)
        look.copy(o).negate().normalize()
      } else {
        navPositionAt(id, simMs, navCtx, _ac)
        o.copy(_ac).negate().normalize().applyAxisAngle(_ad.set(0, 1, 0), 35 * Math.PI / 180)
        o.y += 0.18
        o.normalize().multiplyScalar(fillDistanceKm(BODY_PHYSICAL[id as BodyId].radius, camera))
        look.copy(o).negate().normalize()
      }
      arrival.dist = o.length()
      if (id !== 'zone' && id !== 'belt') {
        // Pitch the view down a little: the target sits above the ship.
        _ah.crossVectors(look, _ad.set(0, 1, 0))
        if (_ah.lengthSq() < 1e-9) _ah.set(1, 0, 0)
        look.applyAxisAngle(_ah.normalize(), -ARRIVAL_PITCH)
      }
    }

    /** Bodies fast travel keeps clear of (predicted positions). */
    const FT_OBSTACLES: Obstacle[] = solar.list.map(b => ({
      id: b.id, radius: b.radius, at: (ms: number, out: THREE.Vector3) => navPositionAt(b.id, ms, navCtx, out),
    }))

    const setTarget = (id: string | null) => {
      if (id === targetId) return
      if (id === 'belt') {
        navCtx.beltPoint.copy(shipWorld).setY(0)
        if (navCtx.beltPoint.lengthSq() < 1) navCtx.beltPoint.set(1, 0, 0)
        navCtx.beltPoint.normalize().multiplyScalar(2.7 * AU_KM)
      }
      targetId = id
      if (id) { updateMoonCorrection(getSimTimeMs()); computeArrival(id, getSimTimeMs(), shipWorld) }
      setTargetKey(id)
      mapDataRef.current.targetId = id
    }
    const cycleTarget = (dir: 1 | -1) => {
      const n = NAV_ENTRIES.length
      const i = targetId ? NAV_ENTRIES.findIndex(e => e.id === targetId) : (dir > 0 ? -1 : 0)
      setTarget(NAV_ENTRIES[(((i + dir) % n) + n) % n].id)
    }

    // ── Autopilot & fast travel ────────────────────────────────────────────
    const ap = new Autopilot()
    const ft = new FastTravel()
    const apGoal = {
      arrival: new THREE.Vector3(), centre: new THREE.Vector3(), arrivalDist: 1, look: new THREE.Vector3(),
      vel: new THREE.Vector3(), targetSurface: null as string | null, keepOut: apKeepOut,
    }
    const _ftC  = new THREE.Vector3()
    const _ftCV = new THREE.Vector3()
    const _ftP  = new THREE.Vector3()
    const _ftV  = new THREE.Vector3()
    const ftPrevVel = new THREE.Vector3()
    const ftPrevRelVel    = new THREE.Vector3()
    const ftPrevCentreVel = new THREE.Vector3()
    const _ftM = new THREE.Vector3()
    /** The current host's velocity at the end of the previous frame. */
    const hostVelPrev = new THREE.Vector3()
    const warpDir   = new THREE.Vector3(0, 0, -1)
    let whooshH: WhooshHandle | null = null
    /**
     * A jump requested during a frame starts at the end of that frame: the
     * plan is made from the state the next frame continues from (bodies at
     * this frame's sim time), exactly like a jump started between frames.
     */
    let pendingJump: string | null = null
    let dropoutTau = 0.3
    let dropoutT = 0

    const startAutopilot = (id: string) => {
      if (travel === 'fasttravel') return
      setTarget(id)
      updateMoonCorrection(getSimTimeMs())
      computeArrival(id, getSimTimeMs(), shipWorld)
      ap.start(id)
      setTravel('autopilot')
    }
    const startFastTravel = (id: string) => {
      if (travel === 'fasttravel' && ft.phase === 'jump') return
      ap.stop()
      setTarget(id)
      const sim0 = getSimTimeMs(), rate = simRateNow()
      updateMoonCorrection(sim0)
      // Aim at where the target will be when we arrive (sim time).
      computeArrival(id, sim0 + FAST_TRAVEL_SECONDS * 1000 * rate, shipWorld)
      liveCentre(id, _ftC); liveCentreVel(id, _ftCV)
      _ftV.copy(ship.velocity).add(host.vel)
      ft.plan(id, shipWorld, _ftV, _ftC, _ftCV, arrival.offset, arrival.look, Math.max(ship.altitude * 0.5, 1),
        centreAt(id), sim0, rate, FT_OBSTACLES)
      ftPrevVel.copy(_ftV)
      ft.relVelAt(0, ftPrevRelVel)
      ftPrevCentreVel.copy(_ftCV)
      setTravel('fasttravel')
      cont?.event('ft', `start→${id}`)
      whooshH?.stop()
      whooshH = playWhoosh(FAST_TRAVEL_SECONDS)
    }
    const cancelTravel = () => {
      if (travel === 'autopilot') {
        const settling = ap.phase === 'settle'
        ap.stop()
        setTravel(settling || ship.velocity.length() <= ship.vMax ? 'manual' : 'cruise')
      } else if (travel === 'fasttravel' && ft.phase === 'jump') {
        // Drop out where you are: coast with exponentially decaying speed over
        // at most 30 % of the free distance ahead and 10 % of the distance to
        // the target (never into anything).
        const v = ship.velocity.length()
        let free = Infinity
        if (v > 0) {
          _ftV.copy(ship.velocity).divideScalar(v)
          for (const s of surfaces) {
            if (!s.solid) continue
            const R = Math.max(s.standoff, s.radius * 1.5)
            _ftC.subVectors(s.local, ship.position)
            const along = _ftC.dot(_ftV)
            if (along <= 0) continue
            const b2 = _ftC.lengthSq() - along * along
            if (b2 > R * R) continue
            free = Math.min(free, Math.max(0, along - Math.sqrt(R * R - b2)))
          }
          free = Math.min(free, 0.1 / 0.3 * shipWorld.distanceTo(liveCentre(ft.targetId, _ftP)))
        }
        dropoutTau = v > 0 ? Math.min(0.5, Math.max(0.002, 0.3 * free / v)) : 0.3
        dropoutT = 0
        ft.phase = 'dropout'
        whooshH?.stop(); whooshH = null
        cont?.event('ft', `cancel@${ft.progress.toFixed(2)}`)
      }
    }
    const NO_INPUT = { thrust: 0, brake: 0, yaw: 0, pitch: 0, roll: 0, vertical: 0, pitchUp: false, pitchDown: false }
    const _qLook = new THREE.Quaternion()

    // ── Warp streaks (sky pass) ────────────────────────────────────────────
    const streaks = new WarpStreaks(isMobile ? 300 : 700)
    skyScene.add(streaks.object)


    // ── UFO mesh (old geometry, scaled to ~16 m) ──────────────────────────
    const ufoGroup  = new THREE.Group()
    ufoGroup.scale.setScalar(UFO_KM_PER_UNIT)
    const saucerGeo = new THREE.SphereGeometry(0.4, 32, 16)
    const saucerMat = new THREE.MeshLambertMaterial({ color: 0x7721b1, transparent: true, opacity: 0 })
    const saucer    = new THREE.Mesh(saucerGeo, saucerMat)
    saucer.scale.y  = 0.28
    ufoGroup.add(saucer)
    const domeGeo = new THREE.SphereGeometry(0.18, 16, 8)
    const domeMat = new THREE.MeshLambertMaterial({ color: 0x3b8bd4, transparent: true, opacity: 0 })
    const dome    = new THREE.Mesh(domeGeo, domeMat)
    dome.position.y = 0.09
    ufoGroup.add(dome)
    const rimGeo = new THREE.TorusGeometry(0.45, 0.03, 8, 32)
    const rimMat = new THREE.MeshBasicMaterial({ color: 0x9b4fc0, transparent: true, opacity: 0 })
    const rim    = new THREE.Mesh(rimGeo, rimMat)
    rim.rotation.x = Math.PI / 2
    ufoGroup.add(rim)
    const lightGeo      = new THREE.SphereGeometry(0.03, 6, 6)
    const ufoLightMats: THREE.MeshBasicMaterial[] = []
    for (let l = 0; l < 4; l++) {
      const angle = (l / 4) * Math.PI * 2
      const lMat  = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 })
      const lMesh = new THREE.Mesh(lightGeo, lMat)
      lMesh.position.set(0.3 * Math.cos(angle), -0.09, 0.3 * Math.sin(angle))
      ufoGroup.add(lMesh)
      ufoLightMats.push(lMat)
    }
    scene.add(ufoGroup)
    origin.track(ufoGroup, shipWorld)
    // Headlight: range and falloff rescaled with the ship (≈ tens of metres).
    const ufoSpotLight = new THREE.SpotLight(0xffffff, 0, 600 * UFO_KM_PER_UNIT, Math.PI / 5, 0.2, 1.2)
    ufoGroup.add(ufoSpotLight)
    const ufoSpotLightTarget = new THREE.Object3D()
    ufoSpotLightTarget.position.set(0, 0, -10)
    ufoGroup.add(ufoSpotLightTarget)
    ufoSpotLight.target = ufoSpotLightTarget
    ufoLightRef.current = ufoSpotLight

    // ── Trails (frame-relative samples; shifted when the frame shifts) ────
    const TRAIL_COUNT = 80
    const trailObjects: THREE.Points[] = []
    let trailGeo: THREE.BufferGeometry | null = null
    let trailMat: THREE.PointsMaterial  | null = null
    let trailPos: Float32Array          | null = null
    const fillTrail = (buf: Float32Array) => {
      for (let i = 0; i < buf.length; i += 3) { buf[i] = ship.position.x; buf[i + 1] = ship.position.y; buf[i + 2] = ship.position.z }
    }
    if (!isMobile) {
      trailPos = new Float32Array(TRAIL_COUNT * 3)
      fillTrail(trailPos)
      trailGeo = new THREE.BufferGeometry()
      trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3))
      trailMat = new THREE.PointsMaterial({ color: 0x9b4fc0, size: 0.08 * UFO_KM_PER_UNIT, sizeAttenuation: true, transparent: true, opacity: 0 })
      const trailPts = new THREE.Points(trailGeo, trailMat)
      trailPts.frustumCulled = false
      scene.add(trailPts)
      trailObjects.push(trailPts)
    }
    const CRUISE_TRAIL_COUNT = isMobile ? 30 : 60
    const cruiseTrailPos = new Float32Array(CRUISE_TRAIL_COUNT * 3)
    fillTrail(cruiseTrailPos)
    const cruiseTrailGeo = new THREE.BufferGeometry()
    cruiseTrailGeo.setAttribute('position', new THREE.BufferAttribute(cruiseTrailPos, 3))
    const cruiseTrailMat = new THREE.PointsMaterial({
      color: 0x7df9ff, size: (isMobile ? 0.14 : 0.2) * UFO_KM_PER_UNIT, sizeAttenuation: true,
      transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
    })
    const cruisePts = new THREE.Points(cruiseTrailGeo, cruiseTrailMat)
    cruisePts.frustumCulled = false
    scene.add(cruisePts)
    trailObjects.push(cruisePts)

    // Frame shifts (recentre / host switch): re-express frame-relative state.
    const offShift = origin.onShift((dx, dy, dz) => {
      ship.position.x -= dx; ship.position.y -= dy; ship.position.z -= dz
      if (trailPos) shiftTrail(trailPos, dx, dy, dz)
      shiftTrail(cruiseTrailPos, dx, dy, dz)
    })

    // ── Decorative models ─────────────────────────────────────────────────
    // GLB models load well after the initial scene so their parsing never
    // competes with the first-frame render / GPU pre-warm. A model can finish
    // after the player has left flight mode: `unmounted` (set in cleanup) makes
    // the callback dispose it instead of adding it to the discarded scene.
    let unmounted = false
    const ignoreLoadError = () => { /* already logged by loadGLB */ }
    const disposeLate = (name: string, dispose: () => void) => {
      dispose()
      if (import.meta.env.DEV) console.debug(`[flight] ${name} finished loading after exit — disposed`)
    }
    const astronautWorld = new THREE.Vector3()
    let issGroup:       THREE.Group | null = null
    let jwstGroup:      THREE.Group | null = null
    let astronautGroup: THREE.Group | null = null
    let astronautLight: THREE.PointLight | null = null
    const lateDisposers: (() => void)[] = []
    const issTimer = setTimeout(() => {
      createISS(loadingManager).then(({ group, dispose }) => {
        if (unmounted) { disposeLate('ISS', dispose); return }
        issGroup = group; lateDisposers.push(dispose)
        scene.add(group); origin.track(group, issWorld)
      }, ignoreLoadError)
    }, 8000)
    let jwstTimer: ReturnType<typeof setTimeout> | null = null
    if (!isMobile) {
      jwstTimer = setTimeout(() => {
        createJWST(loadingManager).then(({ group, dispose }) => {
          if (unmounted) { disposeLate('JWST', dispose); return }
          jwstGroup = group; lateDisposers.push(dispose)
          scene.add(group); origin.track(group, jwstWorld)
        }, ignoreLoadError)
      }, 12000)
    }
    const astronautTimer = setTimeout(() => {
      createAstronaut(loadingManager).then(({ group, dispose }) => {
        if (unmounted) { disposeLate('astronaut', dispose); return }
        astronautGroup = group; lateDisposers.push(dispose)
        scene.add(group); origin.track(group, astronautWorld)
        astronautLight = new THREE.PointLight(0xfff5e0, ASTRONAUT_LIGHT_INTENSITY, ASTRONAUT_LIGHT_RANGE)
        scene.add(astronautLight)
      }, ignoreLoadError)
    }, 10000)

    // ── GPU pre-warm ───────────────────────────────────────────────────────
    // Once every tracked texture has loaded, compile every shader program and
    // upload textures while the loading screen still covers the canvas (with
    // everything temporarily visible, so far/hidden bodies and the belt field
    // are included). Progress reaches 1.0 only after two real frames.
    loadingManager.onLoad = () => {
      if (gpuWarmed) return
      gpuWarmed = true
      const hidden: THREE.Object3D[] = []
      scene.traverse((o) => { if (!o.visible) { hidden.push(o); o.visible = true } })
      renderer.compile(skyScene, camera)
      renderer.compile(scene, camera)
      for (const o of hidden) o.visible = false
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setLoadProgress(1))
      })
    }

    // DEV: double-click the globe to log its lat/lon (calibration aid).
    const pickRay   = new THREE.Raycaster()
    const pickNdc   = new THREE.Vector2()
    const onPickDbl = (e: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect()
      pickNdc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1)
      pickRay.setFromCamera(pickNdc, camera)
      const ll = pickLatLon(pickRay, solar.earth.earthMesh)
      if (ll) console.info(`[earth] lat ${ll.lat.toFixed(3)}°, lon ${ll.lon.toFixed(3)}°`)
    }
    if (import.meta.env.DEV) renderer.domElement.addEventListener('dblclick', onPickDbl)

    // ── Planet identification ─────────────────────────────────────────────
    const planetBodies = PLANET_DATA.map(pd => B[pd.key as BodyId])
    const labelWorld = LABEL_ITEMS.map(pd => pd.key === 'iss' ? issWorld : pd.key === 'jwst' ? jwstWorld : B[pd.key as BodyId].world)
    const _projV = new THREE.Vector3()
    const _tw    = new THREE.Vector3()
    const _tv    = new THREE.Vector3()
    const _camQi = new THREE.Quaternion()

    // ── Camera rig ─────────────────────────────────────────────────────────
    const rig = new CameraRig(SHIP_RADIUS_KM)
    rig.reset(ship.quaternion)
    let entryProgress = 0
    let entryDone     = false
    const entryStartL = new THREE.Vector3()
    const entryOff    = new THREE.Vector3()   // entry sweep offset (frame-local)
    const entryVel    = new THREE.Vector3()   // its analytic velocity (km/s)
    const entryVelPrev = new THREE.Vector3()
    const prevCamWorld   = new THREE.Vector3()
    const _prevCamRender = new THREE.Vector3()
    const _fwd           = new THREE.Vector3()
    const _lookQ         = new THREE.Quaternion()
    const _lookM         = new THREE.Matrix4()
    origin.cameraLocal.copy(ship.position).add(rig.offset)

    // Orbit camera: mouse / touch drag on the canvas.
    let dragId: number | null = null
    let dragX = 0, dragY = 0
    const onPointerDown = (e: PointerEvent) => {
      if (rig.mode !== 'orbit' || dragId !== null || (e.pointerType === 'mouse' && e.button !== 0)) return
      dragId = e.pointerId; dragX = e.clientX; dragY = e.clientY
      renderer.domElement.setPointerCapture(e.pointerId)
    }
    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerId !== dragId) return
      rig.drag(e.clientX - dragX, e.clientY - dragY)
      dragX = e.clientX; dragY = e.clientY
    }
    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerId !== dragId) return
      dragId = null
      rig.endDrag()
    }
    renderer.domElement.style.touchAction = 'none'
    renderer.domElement.addEventListener('pointerdown', onPointerDown)
    renderer.domElement.addEventListener('pointermove', onPointerMove)
    renderer.domElement.addEventListener('pointerup', onPointerUp)
    renderer.domElement.addEventListener('pointercancel', onPointerUp)

    // Misc loop state
    let landingFired = false
    let hudClock     = 0
    let trailClock   = 0
    let fpsCount     = 0
    let fpsLast      = performance.now()
    const nearest    = { id: 'earth' as BodyId, distance: 0, altitude: 0 }

    // ── Continuity monitor (debug hook only) ───────────────────────────────
    const cont = DEBUG_ENABLED ? new ContinuityMonitor() : null
    const _relNow  = new THREE.Vector3()
    const _relNext = new THREE.Vector3()
    const _expect  = new THREE.Vector3()
    const shipStepDisp = new THREE.Vector3()   // expected ship displacement (step host frame)
    const _dbgShipRel = new THREE.Vector3(), dbgPrevShipRel = new THREE.Vector3(), dbgPrevRig = new THREE.Vector3()

    // ── Mode changes ───────────────────────────────────────────────────────
    const setTravel = (m: TravelMode) => {
      if (m === travel) return
      cont?.event('mode', `${travel}→${m}`)
      travel = m
    }
    const setCamera = (m: CameraMode) => {
      if (m === rig.mode) return
      cont?.event('camera', `${rig.mode}→${m}`)
      rig.setMode(m)
    }

    // ── Dev-only helpers (stripped from production builds) ─────────────────
    const DEG = Math.PI / 180
    const TELEPORT_TARGETS = ['spawn', 'overview', 'belt', 'sun', ...HOST_BODIES, 'iss', 'jwst', ...DESTINATIONS.map(d => d.name)]
    const placeShip = (hostId: string, world: THREE.Vector3, lookDir: THREE.Vector3) => {
      host = hostById(hostId)
      origin.switchHost(host.world)
      origin.toLocal(world, ship.position)
      quatLookingAlong(_tmp2.copy(lookDir).normalize(), ship.quaternion)
      ship.velocity.set(0, 0, 0)
      ship.angularVelocity.set(0, 0, 0)
      travel = 'manual'
      ap.stop()
      ft.active = false
      whooshH?.stop(); whooshH = null
      rig.reset(ship.quaternion)
      origin.cameraLocal.copy(ship.position).add(rig.offset)
      entryDone = true
      entryOff.set(0, 0, 0); entryVel.set(0, 0, 0); entryVelPrev.set(0, 0, 0)
      fillTrail(cruiseTrailPos)
      if (trailPos) fillTrail(trailPos)
      updateShipWorld()
      cont?.invalidate()
    }
    const teleport = (id: string, fill = ARRIVAL_FILL): string => {
      const look = new THREE.Vector3()
      const at   = new THREE.Vector3()
      if (id === 'spawn') {
        computeZoneFrame(B.earth.world, zone)
        placeShip('earth', zone.spawn, zoneViewDir(zone, SPAWN_VIEW.az, SPAWN_VIEW.el, look))
      } else if (id === 'belt') {
        // 2.7 AU from the Sun, in the ecliptic, at Earth's current longitude, looking along the orbit.
        at.copy(B.earth.world).setY(0).normalize().multiplyScalar(2.7 * AU_KM)
        placeShip('sun', at, look.set(-at.z, 0, at.x))
      } else if (id === 'overview') {
        // 3 AU above the Sun, looking down at the inner system (orbits, belt).
        at.set(0.35 * AU_KM, 3 * AU_KM, 0.6 * AU_KM)
        placeShip('sun', at, look.copy(at).negate())
      } else if (id === 'iss' || id === 'jwst') {
        // 250 m (ISS) / 60 m (JWST) from the craft on its sunward side.
        const w = id === 'iss' ? issWorld : jwstWorld
        look.copy(w).negate().normalize().add(_tmp.set(0, 0.3, 0)).normalize()
        at.copy(w).addScaledVector(look, id === 'iss' ? ISS_ARRIVAL_KM : JWST_ARRIVAL_KM)
        placeShip(id, at, look.negate())
      } else if (DESTINATIONS.some(d => d.name === id)) {
        // In front of a portfolio destination (inside landing range).
        const w = destinations.world[DESTINATIONS.findIndex(d => d.name === id)]
        look.subVectors(zone.spawn, w).normalize()
        at.copy(w).addScaledVector(look, DEST_ARRIVAL_KM)
        placeShip('earth', at, look.negate())
      } else if (id in B) {
        const b = B[id as BodyId]
        // Sunlit side (Sun ~35° to the side behind the camera), the body
        // filling `fill` of the smaller view dimension; for the Sun, 12 radii away.
        const alpha = Math.atan(fill * Math.tan(halfFovMin(camera)))
        const dist = b.id === 'sun' ? b.radius * SUN_ARRIVAL_RADII : b.radius / Math.sin(alpha)
        if (b.id === 'sun') look.set(1, 0.2, 0)
        else look.subVectors(B.sun.world, b.world)
        look.normalize().applyAxisAngle(_tmp.set(0, 1, 0), 35 * DEG)
        look.y += 0.18
        look.normalize()
        at.copy(b.world).addScaledVector(look, dist)
        placeShip(b.id === 'sun' ? 'sun' : b.id, at, look.negate())
      } else {
        return `unknown target "${id}" — try: ${TELEPORT_TARGETS.join(', ')}`
      }
      return `teleported to ${id}`
    }
    /** Point the ship at a body / spacecraft / destination (instant; testing aid). */
    const aim = (id: string): string => {
      const w = id in B ? B[id as BodyId].world : id === 'iss' ? issWorld : id === 'jwst' ? jwstWorld
        : DESTINATIONS.some(d => d.name === id) ? destinations.world[DESTINATIONS.findIndex(d => d.name === id)] : null
      if (!w) return `unknown target "${id}"`
      quatLookingAlong(_tmp.subVectors(w, shipWorld).normalize(), ship.quaternion)
      ship.angularVelocity.set(0, 0, 0)
      return `aimed at ${id}`
    }
    if (import.meta.env.DEV) {
      (window as unknown as { __spaceonDev?: unknown }).__spaceonDev = Object.freeze({
        /** Teleport next to a body (sun, mercury … neptune, moon), a spacecraft, a destination, into the belt, or back to spawn. */
        teleport,
        targets: TELEPORT_TARGETS,
        aim,
        resetContinuity: () => cont?.reset(),
        /** Navigation (tests): same paths as the keys / map. */
        setTarget: (id: string | null) => { setTarget(id); return targetId },
        autopilot: (id: string) => { startAutopilot(id); return travel },
        fastTravel: (id: string) => { startFastTravel(id); return travel },
        cancel: () => { cancelTravel(); return travel },
        /** Point the ship at the target, then turn it by yaw / pitch (deg, body axes). */
        orient: (yawDeg: number, pitchDeg: number) => {
          if (!targetId) return 'no target'
          quatLookingAlong(_tmp.subVectors(displayWorld(targetId, _tw), shipWorld).normalize(), ship.quaternion)
          ship.quaternion.multiply(_qLook.setFromEuler(new THREE.Euler(pitchDeg * DEG, yawDeg * DEG, 0, 'YXZ')))
          ship.angularVelocity.set(0, 0, 0)
          return 'oriented'
        },
        /** Cheap per-frame snapshot for tests (ship / camera world, speed, mode, bodies). */
        peek: () => {
          origin.getCameraWorld(_camWorld)
          const bodies: Record<string, { p: number[]; r: number; arrival: number }> = {}
          for (const b of solar.list) bodies[b.id] = { p: [b.world.x, b.world.y, b.world.z], r: b.radius, arrival: arrivalKm(b.id) }
          return {
            ship: [shipWorld.x, shipWorld.y, shipWorld.z], camera: [_camWorld.x, _camWorld.y, _camWorld.z],
            speedKmS: ship.velocity.length(), travel, host: host.id, camMode: rig.mode, limit: { ...ship.limit }, bodies,
          }
        },
        simSpeed: (x: number) => { if (x === 1) goLive(); else setSimSpeed(x) },
      })
    }

    // ── Debug hook provider (read-only; no-op unless the hook is enabled) ──
    const dbgFps = { fps: 0, count: 0, last: performance.now(), frames: 0 }
    const r3 = (v: THREE.Vector3): number[] => [v.x, v.y, v.z]
    const _dbgFwd = new THREE.Vector3()
    const _dbgVel = new THREE.Vector3()
    const _dbgP   = new THREE.Vector3()
    let lastReadout: HudReadout = INITIAL_READOUT
    const _dbgUp = new THREE.Vector3()
    const _dbgRight = new THREE.Vector3()
    /** How a body is framed from the camera (arrival checks). */
    const framing = (id: string) => {
      if (!isBodyId(id)) return null
      origin.getCameraWorld(_camWorld)
      camera.getWorldDirection(_dbgFwd)
      const C = B[id as BodyId].world, R = BODY_PHYSICAL[id as BodyId].radius
      const d = _camWorld.distanceTo(C)
      const alpha = Math.asin(Math.min(1, R / d))
      const deg = (a: THREE.Vector3, b: THREE.Vector3) => a.angleTo(b) * 180 / Math.PI
      return {
        distanceKm: d, distanceRadii: d / R,
        discFracMin: Math.tan(alpha) / Math.tan(halfFovMin(camera)),
        discFracVertical: Math.tan(alpha) / Math.tan(camera.fov * Math.PI / 360),
        phaseDeg: id === 'sun' ? 0 : deg(_dbgVel.subVectors(B.sun.world, C), _dbgP.subVectors(_camWorld, C)),
        sunFromForwardDeg: id === 'sun' ? 0 : deg(_dbgFwd, _dbgVel.subVectors(B.sun.world, _camWorld)),
        centreOffAxisDeg: deg(_dbgFwd, _dbgP.subVectors(C, _camWorld)),
      }
    }
    /** Ship's vertical extent on screen (fraction of the view height), from its projected vertices. */
    const measureShipScreen = () => {
      let minY = Infinity, maxY = -Infinity, minX = Infinity, maxX = -Infinity
      ufoGroup.updateMatrixWorld(true)
      ufoGroup.traverse((o) => {
        const m = o as THREE.Mesh
        if (!m.isMesh || m.geometry === lightGeo) return
        const pos = m.geometry.getAttribute('position')
        for (let i = 0; i < pos.count; i++) {
          _dbgP.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld).project(camera)
          if (_dbgP.z > 1) continue
          minY = Math.min(minY, _dbgP.y); maxY = Math.max(maxY, _dbgP.y)
          minX = Math.min(minX, _dbgP.x); maxX = Math.max(maxX, _dbgP.x)
        }
      })
      if (!Number.isFinite(minY)) return null
      return {
        heightFrac: (maxY - minY) / 2, widthFrac: (maxX - minX) / 2,
        centreFromTop: 0.5 - (maxY + minY) / 4, visible: ufoGroup.visible, opacity: rig.shipOpacity,
      }
    }
    const unregisterDebug = registerDebugProvider('flight', () => {
      const info = renderer.info
      const bodies: Record<string, unknown> = {}
      solar.list.forEach((b, i) => {
        bodies[b.id] = {
          position: r3(b.world), distanceKm: b.world.distanceTo(shipWorld), discPx: b.discPx,
          magnitude: b.magnitude, impostorAlpha: solar.impostors.alphaOf(i), meshVisible: b.object.visible,
          arrivalKm: arrivalKm(b.id), velocityKmS: r3(solar.velocities[b.id]),
        }
      })
      const destinationsOut: Record<string, number[]> = {}
      DESTINATIONS.forEach((d, i) => { destinationsOut[d.name] = r3(destinations.world[i]) })
      camera.getWorldDirection(_dbgFwd)
      origin.getCameraWorld(_camWorld)
      const vKmS = ship.velocity.length()
      ship.forward(_fwd)
      const out = {
        units:      'km',
        ship: {
          position: r3(shipWorld), velocityKmS: r3(ship.velocity), speedKmS: vKmS, speedC: vKmS / C_KM_S,
          worldVelocityKmS: r3(_dbgVel.copy(ship.velocity).add(host.vel)),
          host: host.id, forward: r3(_fwd),
          quaternion: [ship.quaternion.x, ship.quaternion.y, ship.quaternion.z, ship.quaternion.w],
          distanceFromSunAU: shipWorld.length() / AU_KM,
          altitudeKm: ship.altitude, altitudeOf: ship.nearestId, manualMaxKmS: ship.vMax,
        },
        travelMode:  travel,
        cruise:      { limitKind: ship.limit.kind, limitedBy: ship.limit.id, targetKmS: ship.limit.target, capKmS: FLIGHT.CRUISE_CAP, tau: FLIGHT.TAU },
        cameraMode:  rig.mode,
        cameraRig:   { offsetKm: r3(rig.offset), offsetLengthKm: rig.offset.length(), shipOpacity: rig.shipOpacity, orbitYaw: rig.orbitYaw, orbitPitch: rig.orbitPitch, distFactor: rig.distFactor },
        shipScreen:  measureShipScreen(),
        hud:         lastReadout,
        camera:      {
          position: r3(_camWorld), forward: r3(_dbgFwd), up: r3(_dbgUp.set(0, 1, 0).applyQuaternion(camera.quaternion)),
          right: r3(_dbgRight.set(1, 0, 0).applyQuaternion(camera.quaternion)),
          fov: camera.fov, aspect: camera.aspect, near: camera.near, far: camera.far, width: container.clientWidth, height: container.clientHeight,
        },
        nearestBody: { id: nearest.id, distanceKm: nearest.distance, altitudeKm: nearest.altitude },
        target:      targetId ? {
          id: targetId, name: NAV_BY_ID[targetId].name, distanceKm: distanceTo(targetId),
          centre: r3(liveCentre(targetId, _dbgP)), arrivalOffsetKm: r3(arrival.offset), arrivalDistanceKm: arrival.dist,
          arrivalLook: r3(arrival.look), etaS: lastReadout.etaS, framing: framing(targetId),
        } : null,
        autopilot:   { active: ap.active, phase: ap.phase, target: ap.targetId, detour: ap.detour, elapsedS: ap.elapsed },
        fastTravel:  {
          active: ft.active, phase: ft.phase, target: ft.targetId, elapsedS: ft.t, durationS: ft.T, progress: ft.progress,
          warp: ft.warp, plannedClearanceRadii: ft.plannedClearance, plannedClearanceBody: ft.plannedClearanceId, sweep: ft.sweepLabel,
          dropoutTauS: dropoutTau,
        },
        map:         mapDebugRef.current ? { ...mapDebugRef.current, items: mapDebugRef.current.items.map(i => ({ ...i })) } : { open: false },
        targetMarker: { ...targetMarkerRef.current },
        overlay:     currentZoneRef.current,
        fps:         dbgFps.fps,
        frames:      dbgFps.frames,
        adaptation:  solar.adaptation,
        cloudStatus: solar.earth.getCloudStatus(),
        assets:      { loaded: dbgAssets.loaded, total: dbgAssets.total, failed: [...dbgAssets.failed] },
        models:      { iss: !!issGroup, jwst: !!jwstGroup || isMobile, astronaut: !!astronautGroup },
        decorative: {
          iss:       { position: r3(issWorld), altitudeKm: issWorld.distanceTo(B.earth.world) - BODY_PHYSICAL.earth.radius, speedRelEarthKmS: _dbgVel.subVectors(issVel, solar.velocities.earth).length() },
          jwst:      { position: r3(jwstWorld), distanceFromEarthKm: jwstWorld.distanceTo(B.earth.world) },
          astronaut: astronautGroup ? { position: r3(astronautWorld), distanceFromShipKm: astronautWorld.distanceTo(shipWorld) } : null,
        },
        belt: { zoneDensity: localBelt.density, localFieldActive: localBelt.root.visible, rocksDrawn: localBelt.visibleCount },
        renderer: {
          calls: info.render.calls, triangles: info.render.triangles, points: info.render.points, lines: info.render.lines,
          textures: info.memory.textures, geometries: info.memory.geometries, programs: info.programs?.length ?? 0,
        },
        floatingOrigin: {
          frame: r3(origin.frame), cameraLocal: r3(origin.cameraLocal), host: host.id,
          tracked: origin.trackedCount, renderCamera: r3(camera.position),
        },
        depth: {
          logarithmic: renderer.capabilities.logarithmicDepthBuffer, near: camera.near, far: camera.far,
          missingChunks: findMissingDepthChunks([scene, skyScene]),
        },
        continuity: cont ? cont.summary() : null,
        bodies,
        destinations: destinationsOut,
        spawn: r3(zone.spawn),
      }
      return JSON.parse(JSON.stringify(out))
    })
    setDebugReady(false)

    // ── Animation loop ─────────────────────────────────────────────────────
    let rafId:    number
    let prevTime: number = performance.now()
    let t = 0

    const animate = () => {
      rafId = requestAnimationFrame(animate)

      const now = performance.now()
      const dt  = Math.min((now - prevTime) / 1000, 0.05)
      prevTime  = now
      t        += dt
      const k   = dt * REF_FPS   // frame-equivalents at the 60 fps the old rates assumed

      // DEV FPS
      if (import.meta.env.DEV) {
        fpsCount++
        if (now - fpsLast >= 1000) { setFps(fpsCount); fpsCount = 0; fpsLast = now }
      }
      if (DEBUG_ENABLED) {
        dbgFps.frames++
        dbgFps.count++
        if (now - dbgFps.last >= 1000) { dbgFps.fps = dbgFps.count * 1000 / (now - dbgFps.last); dbgFps.count = 0; dbgFps.last = now }
      }

      // ── Bodies for this sim time; the frame rides with the host ─────────
      const simMs = getSimTimeMs()
      const rate  = simRateNow()
      origin.getCameraWorld(prevCamWorld)
      solar.update(simMs, prevCamWorld, dt, rate)
      updateSpacecraft(simMs, rate)
      computeZoneFrame(B.earth.world, zone)
      destinations.update(t, k, zone)
      for (let i = 0; i < DESTINATIONS.length; i++) {
        const p = ZONE_PLACEMENT[DESTINATIONS[i].name]
        zoneViewPoint(zone, p.range, p.az, p.el, destBase[i])
      }
      updateZoneVelocities(rate)
      origin.carry(host.world)
      updateShipWorld()          // the frame moved with the host: refresh before anything reads it
      updateSurfaces()
      ship.sense(surfaces)

      // ── Discrete actions & navigation commands ──────────────────────────
      const inp = inputRef.current
      const overlayOpen = currentZoneRef.current !== 'flight'
      while (inp.actions.length) {
        const a = inp.actions.shift()!
        if (a === 'cruise') {
          if (travel === 'autopilot') { ap.stop(); setTravel('cruise') }
          else if (travel !== 'fasttravel') setTravel(travel === 'cruise' ? 'manual' : 'cruise')
        }
        else if (a === 'camera') setCamera(rig.mode === 'chase' ? 'cockpit' : rig.mode === 'cockpit' ? 'orbit' : 'chase')
        else if (a === 'light')  toggleLightRef.current()
        else if (a === 'map')    openMapRef.current(!mapOpenRef.current)
        else if (a === 'cancel') { if (mapOpenRef.current) openMapRef.current(false); else cancelTravel() }
        else if (a === 'autopilot') {
          if (travel === 'autopilot') cancelTravel()
          else if (targetId) startAutopilot(targetId)
          else openMapRef.current(true)
        }
        else if (a === 'jump') { if (targetId) pendingJump = targetId }
        else if (a === 'next') cycleTarget(1)
        else if (a === 'prev') cycleTarget(-1)
      }
      while (navCmdRef.current.length) {
        const c = navCmdRef.current.shift()!
        if (c.kind === 'target') setTarget(c.id)
        else if (c.kind === 'autopilot') startAutopilot(c.id)
        else pendingJump = c.id
      }
      // Flight axes are ignored while the map is open.
      const steerInp = mapOpenRef.current ? NO_INPUT : inp
      if (travel === 'autopilot' && hasManualInput(steerInp)) cancelTravel()   // any manual input cancels autopilot

      // ── Ship (frame-relative), stepped in the current host's frame ──────
      const stepHost = host
      let pathDriven = false
      let warp = 0
      if (!entryDone || overlayOpen) {
        // Hold still during the entry sweep / while an overlay is open.
        ship.velocity.multiplyScalar(Math.exp(-dt / FLIGHT.BRAKE_TAU))
        ship.position.addScaledVector(ship.velocity, dt)
      } else if (travel === 'fasttravel' && ft.phase === 'jump') {
        // Path-driven: P(t) = C(t) + rel(t) (world), velocity analytic.
        ft.t = Math.min(ft.T, ft.t + dt)
        liveCentre(ft.targetId, _ftC)
        ft.relAt(ft.t, _ftP).add(_ftC)
        liveCentreVel(ft.targetId, _ftCV)
        ft.relVelAt(ft.t, _ftV)
        if (_ftV.lengthSq() > 1e-18) warpDir.copy(_ftV).normalize()
        // Expected displacement relative to the step host (continuity check):
        // Simpson's rule on the path's analytic relative velocity, plus the
        // trapezoid of (centre − host) velocity — at ×86 400 these velocities
        // turn by hundreds of km/s per frame.
        ft.relVelAt(Math.max(0, ft.t - 0.5 * dt), _ftM)
        shipStepDisp.copy(ftPrevRelVel).addScaledVector(_ftM, 4).add(_ftV).multiplyScalar(dt / 6)
          .addScaledVector(_ftCV, 0.5 * dt).addScaledVector(ftPrevCentreVel, 0.5 * dt)
          .addScaledVector(host.vel, -0.5 * dt).addScaledVector(hostVelPrev, -0.5 * dt)
        ftPrevRelVel.copy(_ftV)
        ftPrevCentreVel.copy(_ftCV)
        _ftV.add(_ftCV)
        origin.toLocal(_ftP, ship.position)
        ship.velocity.copy(_ftV).sub(host.vel)
        ftPrevVel.copy(_ftV)
        pathDriven = true
        warp = ft.warp
        // Face the target, blending into the arrival look direction at the end.
        _tmp.subVectors(_ftC, _ftP)
        if (_tmp.lengthSq() > 1e-18) {
          _tmp.normalize().lerp(ft.look, smoothstep(0.7, 1, ft.progress))
          if (_tmp.lengthSq() > 1e-12) ship.turnToward(quatLookingAlong(_tmp.normalize(), _qLook), dt, 0.35, 2.5)
        }
        if (ft.t >= ft.T) {
          ft.active = false
          whooshH = null
          cont?.event('ft', `end@${ft.targetId}`)
          setTravel('manual')
        }
      } else if (travel === 'fasttravel') {
        // Dropping out of a cancelled jump.
        ship.stepCoast(dt, dropoutTau)
        dropoutT += dt
        if ((dropoutT > 3 * dropoutTau && ship.velocity.length() <= ship.vMax) || dropoutT > 40 * dropoutTau) { ft.active = false; setTravel('manual') }
      } else if (travel === 'autopilot') {
        liveCentre(ap.targetId, _ftC)
        origin.toLocal(_ftC, apGoal.centre)
        apGoal.arrival.copy(apGoal.centre).add(arrival.offset)
        liveCentreVel(ap.targetId, apGoal.vel).sub(host.vel)
        apGoal.arrivalDist = arrival.dist
        apGoal.look.copy(arrival.look)
        apGoal.targetSurface = targetSurface(ap.targetId)
        if (ap.step(dt, ship, surfaces, apGoal)) {
          ap.stop()
          cont?.event('ap', `arrived@${ap.targetId}`)
          setTravel('manual')
        }
      } else if (travel === 'cruise') {
        ship.stepCruise(dt, surfaces, steerInp.brake > 0 ? 1 - steerInp.brake : 1, steerInp)
      } else {
        ship.stepManual(dt, steerInp)
      }
      if (!pathDriven) {
        ship.keepOutside(surfaces, () => 0)
        shipStepDisp.copy(ship.velocity).multiplyScalar(dt)
        ftPrevVel.copy(ship.velocity).add(host.vel)
      }
      updateShipWorld()

      // Host: the smallest region containing the ship (with hysteresis);
      // otherwise the Sun. The ship keeps its world velocity across the switch.
      let newHost: Host = SUN_HOST
      for (const h of HOSTS) {
        if (shipWorld.distanceTo(h.world) < h.region * (h === host ? 1.05 : 0.98) && h.region < newHost.region) newHost = h
      }
      if (newHost !== host) {
        ship.velocity.add(host.vel).sub(newHost.vel)
        cont?.event('host', `${host.id}→${newHost.id}`)
        host = newHost
        origin.switchHost(host.world)
        updateShipWorld()
      }

      hostVelPrev.copy(host.vel)

      // Nearest body surface (true altitude).
      let bestAlt = Infinity
      for (const b of solar.list) {
        const d = shipWorld.distanceTo(b.world)
        if (d - b.radius < bestAlt) { bestAlt = d - b.radius; nearest.id = b.id; nearest.distance = d; nearest.altitude = d - b.radius }
      }

      // ── Decorative objects (world) ──────────────────────────────────────
      if (astronautGroup) {
        astronautWorld.copy(zone.spawn)
          .addScaledVector(zone.right,   ASTRONAUT_SPAWN_OFFSET.x + Math.sin(t * 0.11) * 0.004)
          .addScaledVector(zone.up,      ASTRONAUT_SPAWN_OFFSET.y + Math.sin(t * 0.07 + 1) * 0.002)
          .addScaledVector(zone.forward, ASTRONAUT_SPAWN_OFFSET.z)
        astronautGroup.rotation.x += ASTRONAUT_TUMBLE[0] * dt
        astronautGroup.rotation.y += ASTRONAUT_TUMBLE[1] * dt
        astronautGroup.rotation.z += ASTRONAUT_TUMBLE[2] * dt
      }
      if (issGroup) {
        // Model +X along track, radial "up".
        issGroup.up.copy(issFrame.radial)
        issGroup.quaternion.setFromUnitVectors(_render.set(1, 0, 0), issFrame.along)
      }
      if (jwstGroup) {
        // Sunshield facing the Sun.
        jwstGroup.quaternion.setFromUnitVectors(_render.set(0, 1, 0), _tmp.copy(jwstWorld).negate().normalize())
      }

      // ── Belt ────────────────────────────────────────────────────────────
      beltBand.update(simMs)
      localBelt.prepare(prevCamWorld)

      // ── Sky ─────────────────────────────────────────────────────────────
      sky.update(t)
      streaks.update(warp, warpDir)

      // ── UFO mesh, lights, trails ────────────────────────────────────────
      ufoGroup.quaternion.copy(ship.quaternion)
      const speed = ship.velocity.length()
      rig.stick(inp.orbitX, inp.orbitY)
      rig.update(dt, ship.quaternion, speed)
      const lightOp = entryDone ? (0.5 + 0.5 * Math.sin(t * 8)) * 0.8 : 0
      const op = rig.shipOpacity
      for (const m of ufoLightMats) m.opacity = lightOp * op
      const cruiseOn = travel === 'cruise'
      trailClock += dt
      const trailSteps = Math.floor(trailClock / TRAIL_STEP)
      trailClock -= trailSteps * TRAIL_STEP
      if (trailPos && trailGeo && trailMat) {
        advanceTrail(trailPos, TRAIL_COUNT, trailSteps, ship.position)
        trailGeo.attributes.position.needsUpdate = true
        trailMat.opacity = entryDone ? (cruiseOn ? 0.15 : 0.55) * op : 0
      }
      advanceTrail(cruiseTrailPos, CRUISE_TRAIL_COUNT, trailSteps, ship.position)
      cruiseTrailGeo.attributes.position.needsUpdate = true
      cruiseTrailMat.opacity += ((entryDone && cruiseOn ? 0.85 * op : 0) - cruiseTrailMat.opacity) * (1 - Math.pow(1 - 0.08, k))

      // ── Camera (frame-local): ship + rig offset (+ entry sweep) ─────────
      let entryEase = 1
      entryVelPrev.copy(entryVel)
      if (!entryDone) {
        entryProgress += dt / ENTRY_DUR
        const ep   = Math.min(entryProgress, 1)
        entryEase  = ep * ep * (3 - 2 * ep)
        const dEase = ep < 1 ? 6 * ep * (1 - ep) / ENTRY_DUR : 0
        // Sweep in from just above Earth's day side to the ship.
        _tmp.copy(zone.forward).negate().addScaledVector(zone.up, 0.35).normalize()
        origin.toLocal(_tmp2.copy(B.earth.world).addScaledVector(_tmp, BODY_PHYSICAL.earth.radius * 1.8), entryStartL)
        _tmp.copy(ship.position).add(rig.offset)
        entryOff.subVectors(entryStartL, _tmp)
        entryVel.copy(entryOff).multiplyScalar(-dEase)
        entryOff.multiplyScalar(1 - entryEase)
        if (ep >= 1) { entryDone = true; entryOff.set(0, 0, 0); entryVel.set(0, 0, 0) }
      }
      saucerMat.opacity = entryEase * op
      domeMat.opacity   = entryEase * 0.9 * op
      rimMat.opacity    = entryEase * 0.5 * op
      ufoGroup.visible  = op > 0.01
      origin.cameraLocal.copy(ship.position).add(rig.offset).add(entryOff)
      origin.recenter()

      // ── Floating origin: world → camera-relative render positions ───────
      origin.apply()
      for (const tp of trailObjects) origin.localToRender(_render.set(0, 0, 0), tp.position)
      if (entryDone) {
        camera.quaternion.copy(rig.quaternion)
      } else {
        // During the sweep look at a point ahead of the ship, blending into the rig.
        ship.forward(_fwd)
        _tmp.copy(ship.position).addScaledVector(_fwd, 0.04)
        origin.localToRender(_tmp, _render)

        _lookQ.setFromRotationMatrix(_lookM.lookAt(_tmp2.set(0, 0, 0), _render, ship.up(_tmp)))
        camera.quaternion.copy(_lookQ).slerp(rig.quaternion, entryEase)
      }
      camera.updateMatrixWorld()
      origin.getCameraWorld(_camWorld)

      // ── Target marker: reticle on screen, edge arrow off screen ─────────
      const cw = container.clientWidth
      const ch = container.clientHeight
      const tm = targetMarkerRef.current
      if (targetId && !mapOpenRef.current) {
        displayWorld(targetId, _tw)
        origin.toRender(_tw, _render)
        _camQi.copy(camera.quaternion).invert()
        _tmp.copy(_render).applyQuaternion(_camQi)            // camera space (−Z ahead)
        let onScreen = false
        if (_tmp.z < 0) {
          _projV.copy(_render).project(camera)
          const sx = (_projV.x * 0.5 + 0.5) * cw, sy = (-_projV.y * 0.5 + 0.5) * ch
          if (sx > 28 && sx < cw - 28 && sy > 28 && sy < ch - 28) { onScreen = true; tm.x = sx; tm.y = sy }
        }
        if (!onScreen) {
          // Screen direction toward the target: (x, −y) in camera space, in
          // front or behind alike; the arrow sits where that ray meets the
          // inset screen edge.
          let dx = _tmp.x, dy = -_tmp.y
          if (Math.hypot(dx, dy) < 1e-12 * _tmp.length()) { dx = 0; dy = 1 }
          const hw = cw / 2 - 40, hh = ch / 2 - 40
          const kk = Math.min(hw / Math.max(Math.abs(dx), 1e-30), hh / Math.max(Math.abs(dy), 1e-30))
          tm.x = cw / 2 + dx * kk; tm.y = ch / 2 + dy * kk
          tm.angle = Math.atan2(dy, dx) * 180 / Math.PI
        }
        tm.onScreen = onScreen
        tm.visible = true
        tm.name = NAV_BY_ID[targetId].name
      } else {
        tm.visible = false
      }
      if (mapOpenRef.current) {
        const md = mapDataRef.current
        md.simMs = simMs
        for (const b of solar.list) md.pos[b.id].copy(b.world)
        md.zoneDir.subVectors(zone.spawn, B.earth.world).normalize()
        md.ship.copy(shipWorld)
        md.shipVel.copy(ship.velocity)
        md.targetId = targetId
      }

      // ── Continuity sample (debug only) ──────────────────────────────────
      if (cont) {
        // Camera − step host, now; and camera − current host for the next frame.
        _relNow.subVectors(origin.frame, stepHost.world).add(origin.cameraLocal)
        _relNext.subVectors(origin.frame, host.world).add(origin.cameraLocal)
        _expect.copy(shipStepDisp).addScaledVector(rig.offsetVel, dt)
          .addScaledVector(entryVel, 0.5 * dt).addScaledVector(entryVelPrev, 0.5 * dt)
        // Component split (ship vs camera rig) for diagnosing flagged frames.
        _dbgShipRel.subVectors(origin.frame, stepHost.world).add(ship.position)
        const shipActual = _dbgShipRel.distanceTo(dbgPrevShipRel), rigActual = rig.offset.distanceTo(dbgPrevRig)
        const shipExp = shipStepDisp.length(), rigExp = rig.offsetVel.length() * dt
        cont.sample(_relNow, _expect, _relNext, () => ({
          travel, camera: rig.mode, host: host.id, stepHost: stepHost.id, speedKmS: speed, ft: ft.active ? ft.progress : null,
          shipActualKm: shipActual, shipExpectedKm: shipExp, rigActualKm: rigActual, rigExpectedKm: rigExp,
        }))
        dbgPrevShipRel.subVectors(origin.frame, host.world).add(ship.position)
        dbgPrevRig.copy(rig.offset)
      }

      // Device pixels per radian (disc sizes, LOD).
      const pxPerRad = (renderer.domElement.height / 2) / Math.tan(camera.fov * Math.PI / 360)
      solar.afterApply(camera, _camWorld, pxPerRad, renderer.getPixelRatio(), toRender)
      if (localBelt.root.visible) {
        localBelt.afterApply(t, pxPerRad, _tmp.copy(localBelt.rootWorld).negate().normalize(),
          Math.min(2, solar.lightGainAt(localBelt.rootWorld)))
      }

      // Billboards and the astronaut's fill light face the previous camera.
      origin.toRender(prevCamWorld, _prevCamRender)
      destinations.faceCamera(_prevCamRender)
      if (astronautGroup && astronautLight) {
        // Keep the fill light between the astronaut and the camera, outside his mesh.
        astronautLight.position.subVectors(_prevCamRender, astronautGroup.position)
          .setLength(ASTRONAUT_LIGHT_OFFSET).add(astronautGroup.position)
      }

      // ── Planet labels + detection (every frame for smooth tracking) ──────
      let nearestBodyKey:     string | null = null
      let nearestBodyInRange: boolean       = false
      let nearestBodyDist:    number        = Infinity
      for (let i = 0; i < LABEL_ITEMS.length; i++) {
        const pd  = LABEL_ITEMS[i]
        const lw  = labelWorld[i]
        const ld  = planetLabelDataRef.current[i]
        const dist = lw.distanceTo(shipWorld)
        if (i < PLANET_DATA.length && dist < nearestBodyDist) {
          nearestBodyDist    = dist
          nearestBodyKey     = pd.key
          nearestBodyInRange = dist < pd.detectionRadius
        }
        if (dist >= pd.detectionRadius) { ld.visible = false; continue }
        _projV.copy(origin.toRender(lw, _render)).project(camera)
        ld.x       = (_projV.x * 0.5 + 0.5) * cw
        ld.y       = (-_projV.y * 0.5 + 0.5) * ch
        ld.visible = _projV.z < 1   // false when the body is behind the camera
      }

      // ── HUD at ~10 fps ─────────────────────────────────────────────────
      hudClock += dt
      if (hudClock >= HUD_INTERVAL) {
        hudClock = 0
        setActiveBodyKey(targetId && planetBodies.some(b => b.id === targetId) ? targetId : nearestBodyInRange ? nearestBodyKey : null)
        const cap = travel === 'manual' ? ship.vMax : FLIGHT.CRUISE_CAP
        const lim = (travel === 'cruise' || travel === 'autopilot') && (ship.limit.kind === 'open' || ship.limit.kind === 'approach') && ship.limit.target < FLIGHT.CRUISE_CAP * 0.99
          ? (NAV_BY_ID[ship.limit.id ?? '']?.name ?? HOST_NAMES[ship.limit.id ?? ''] ?? ship.limit.id) : null
        let distLabel = HOST_NAMES[nearest.id] ?? nearest.id
        let distKm    = nearest.altitude
        let relSpeed  = speed
        let speedRef  = HOST_NAMES[host.id] ?? host.id
        let etaS: number | null = null
        if (targetId) {
          const e = NAV_BY_ID[targetId]
          distLabel = e.name
          distKm    = distanceTo(targetId)
          liveCentreVel(targetId, _tv)
          _tmp.copy(ship.velocity).add(host.vel).sub(_tv)
          relSpeed  = _tmp.length()
          speedRef  = e.name
          liveCentre(targetId, _tw)
          if (travel === 'fasttravel') etaS = ft.phase === 'jump' ? ft.T - ft.t : null
          else if (travel === 'autopilot') etaS = Autopilot.etaS(shipWorld.distanceTo(_ac.copy(_tw).add(arrival.offset)), arrival.dist)
          else {
            // Closing speed toward the target centre; ETA to its arrival distance.
            const dC = shipWorld.distanceTo(_tw)
            const closing = -_tmp.dot(_ad.subVectors(shipWorld, _tw).divideScalar(Math.max(dC, 1e-12)))
            const remaining = Math.max(0, dC - arrival.dist)
            etaS = closing > 1e-9 && remaining > 0 ? remaining / closing : null
          }
          targetMarkerRef.current.dist = formatDistance(distKm)
        }
        lastReadout = {
          mode: travel, camera: rig.mode,
          speed: formatSpeed(relSpeed), speedKmS: relSpeed, speedRef,
          speedFrac: Math.min(1, speed / Math.max(cap, 1e-9)),
          distLabel, dist: formatDistance(distKm), distKm,
          light: formatLightTime(distKm), eta: formatEta(etaS), etaS, limitedBy: lim,
          target: targetId ? NAV_BY_ID[targetId].name : null,
          detour: travel === 'autopilot' && ap.detour ? (NAV_BY_ID[ap.detour]?.name ?? ap.detour) : null,
          droppingOut: travel === 'fasttravel' && ft.phase === 'dropout',
        }
        setReadout(lastReadout)
        setInBelt(localBelt.density > 0.03)

        // Radar: heading-up, positions relative to the ship (km; the HUD log-scales them).
        ship.forward(_fwd)
        const psi = Math.atan2(-_fwd.x, -_fwd.z)
        const cr = Math.cos(psi), sr = Math.sin(psi)
        const blipXY = (w: THREE.Vector3) => {
          _tmp.subVectors(w, shipWorld)
          return { x: _tmp.x * cr - _tmp.z * sr, y: -(_tmp.x * sr + _tmp.z * cr) }
        }
        setRadar({
          dots:   DESTINATIONS.map((d, i) => ({
            key: d.name, label: d.name, name: d.name, color: '#' + d.color.toString(16).padStart(6, '0'), isSun: false,
            ...blipXY(destinations.world[i]),
          })),
          bodies: PLANET_DATA.map((p, i) => ({
            key: p.key, label: p.abbr, name: p.name, color: p.colorCss, isSun: !!p.isSun, ...blipXY(planetBodies[i].world),
          })),
        })

        let minDist = Infinity, minLabel = ''
        for (let i = 0; i < DESTINATIONS.length; i++) {
          const d = destinations.world[i].distanceTo(shipWorld)
          if (d < minDist) { minDist = d; minLabel = DESTINATIONS[i].name }
        }
        setNearestPlanet(minDist < LANDING_RADIUS_KM ? { name: minLabel, distance: minDist } : null)

        if (!landingFired && inp.land && minDist < LANDING_RADIUS_KM) {
          landingFired = true
          if (minLabel === 'M87*') {
            onEnterBlackHoleRef.current()
          } else if (minLabel === 'ABOUT') {
            navigateTo('about')
          } else if (minLabel === 'SKILLS') {
            navigateTo('skills')
          } else if (minLabel === 'PROJECTS') {
            navigateTo('projects')
          } else if (minLabel === 'CONTACT') {
            navigateTo('contact')
          }
        }
        // Reset landingFired when overlay is closed so user can land again
        if (landingFired && currentZoneRef.current === 'flight') {
          landingFired = false
        }
      }

      if (pendingJump) { const id = pendingJump; pendingJump = null; startFastTravel(id) }

      // Sky first (always behind), then the world over a cleared depth buffer.
      renderer.info.reset()
      renderer.clear()
      renderer.render(skyScene, camera)
      renderer.clearDepth()
      renderer.render(scene, camera)
    }

    animate()

    const onResize = () => {
      const w = container.clientWidth, h = container.clientHeight
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
    }
    window.addEventListener('resize', onResize)

    return () => {
      unmounted = true
      unregisterDebug()
      setDebugReady(false)
      if (import.meta.env.DEV) delete (window as unknown as { __spaceonDev?: unknown }).__spaceonDev
      cancelAnimationFrame(rafId)
      clearTimeout(issTimer)
      if (jwstTimer) clearTimeout(jwstTimer)
      clearTimeout(astronautTimer)
      offShift()
      window.removeEventListener('resize', onResize)
      renderer.domElement.removeEventListener('dblclick', onPickDbl)
      renderer.domElement.removeEventListener('pointerdown', onPointerDown)
      renderer.domElement.removeEventListener('pointermove', onPointerMove)
      renderer.domElement.removeEventListener('pointerup', onPointerUp)
      renderer.domElement.removeEventListener('pointercancel', onPointerUp)

      destinations.dispose()
      sky.dispose()
      solar.dispose()
      beltBand.dispose()
      localBelt.dispose()
      saucerGeo.dispose(); saucerMat.dispose()
      domeGeo.dispose();   domeMat.dispose()
      rimGeo.dispose();    rimMat.dispose()
      lightGeo.dispose()
      for (const m of ufoLightMats) m.dispose()
      trailGeo?.dispose(); trailMat?.dispose()
      cruiseTrailGeo.dispose(); cruiseTrailMat.dispose()
      streaks.dispose()
      whooshH?.stop()
      closeWhoosh()
      for (const d of lateDisposers) d()

      renderer.dispose()
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement)
    }
  // Long-lived render loop: mount once. Deps are refs, setters, or per-mount constants.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // intentional: all refs are stable; isMobile is constant per mount

  const nearestIsBlackHole = nearestPlanet?.name === 'M87*'

  return (
    <div ref={containerRef} style={{ position: 'fixed', inset: 0, width: '100vw', height: '100vh' }}>
      {!loadDone && <LoadingScreen progress={loadProgress} onComplete={() => { setLoadDone(true); setDebugReady(true) }} />}
      <FlightHUD
        readout={readout}
        nearestPlanet={nearestIsBlackHole ? null : nearestPlanet}
        radarDots={radar.dots}
        radarBodies={radar.bodies}
        activeBodyKey={activeBodyKey}
        inBelt={inBelt}
        onExit={onExit}
        inputRef={inputRef}
        onToggleLight={toggleLight}
        lightOn={lightOn}
        cloudStatus={cloudStatus}
      />
      <PlanetLabels items={LABEL_ITEMS} dataRef={planetLabelDataRef} onSelect={selectInfo} targetKey={targetKey} />
      <TargetMarker dataRef={targetMarkerRef} />
      <SystemMap open={mapOpen} isMobile={isMobile} dataRef={mapDataRef} debugRef={mapDebugRef}
        onClose={() => openMap(false)} onSelect={selectInfo} />
      <PlanetInfoPanel
        planetKey={selectedPlanet}
        onClose={() => setSelectedPlanet(null)}
        actions={selectedPlanet && NAV_BY_ID[selectedPlanet] ? {
          onFastTravel: () => navCommand('fasttravel', selectedPlanet),
          onAutopilot:  () => navCommand('autopilot', selectedPlanet),
          onSetTarget:  () => navCommand('target', selectedPlanet),
          isTarget:     targetKey === selectedPlanet,
          distance:     selectedDist,
        } : null}
      />
      {nearestIsBlackHole && (
        <div style={{
          position: 'absolute', top: '1.5rem', left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(26,0,48,0.7)', backdropFilter: 'blur(12px)',
          border: '1px solid rgba(139,92,246,0.5)', borderRadius: '12px',
          padding: '0.6rem 1.2rem', color: '#c4b5fd', fontSize: '0.8rem',
          textAlign: 'center', whiteSpace: 'nowrap', pointerEvents: 'none',
          transition: 'opacity 0.3s',
        }}>
          <span style={{ opacity: 0.8 }}>M87* Event Horizon</span>
          <span style={{ opacity: 0.5 }}> — Press </span>
          <kbd style={{ background: 'rgba(196,181,253,0.1)', borderRadius: '4px', padding: '0 5px' }}>F</kbd>
          <span style={{ opacity: 0.5 }}> to enter</span>
        </div>
      )}
      {import.meta.env.DEV && fps > 0 && (
        <div style={{
          position: 'fixed', top: '1rem', left: '50%', transform: 'translateX(-50%)',
          color: 'rgba(215,226,234,0.35)', fontSize: '0.65rem', zIndex: 30, pointerEvents: 'none',
        }}>
          {fps} FPS
        </div>
      )}
      <AboutOverlay
        currentZone={currentZone as NavZone}
        isTransitioning={isTransitioning}
        navigateTo={(zone) => navigateTo(zone as Zone)}
      />
      <SkillsOverlay
        currentZone={currentZone as NavZone}
        isTransitioning={isTransitioning}
        navigateTo={(zone) => navigateTo(zone as Zone)}
      />
      <ProjectsOverlay
        currentZone={currentZone as NavZone}
        isTransitioning={isTransitioning}
        navigateTo={(zone) => navigateTo(zone as Zone)}
      />
      <ContactOverlay
        currentZone={currentZone as NavZone}
        isTransitioning={isTransitioning}
        navigateTo={(zone) => navigateTo(zone as Zone)}
      />
      {currentZone !== 'flight' && (
        <button
          onClick={() => navigateTo('flight')}
          style={{
            position:      'fixed',
            top:           '1.25rem',
            right:         '1.25rem',
            zIndex:        1000,
            background:    'rgba(0,0,0,0.5)',
            border:        '1px solid rgba(255,255,255,0.2)',
            borderRadius:  '999px',
            color:         '#D7E2EA',
            padding:       '0.5rem 1.2rem',
            fontSize:      '0.8rem',
            letterSpacing: '0.15em',
            cursor:        'pointer',
            fontFamily:    'Kanit, sans-serif',
          }}
        >
          ← BACK TO SPACE
        </button>
      )}
    </div>
  )
}
