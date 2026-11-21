import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { useFlightControls } from '../hooks/useFlightControls'
import { useUFOPhysics }     from '../hooks/useUFOPhysics'
import FlightHUD             from '../components/FlightHUD'
import type { RadarBlip }    from '../components/FlightHUD'
import LoadingScreen         from '../components/LoadingScreen'
import PlanetLabels          from '../components/PlanetLabels'
import type { PlanetLabelDatum } from '../components/PlanetLabels'
import PlanetInfoPanel       from '../components/PlanetInfoPanel'
import { PLANET_DATA }       from '../data/planetData'
import AboutOverlay          from '../overlays/AboutOverlay'
import SkillsOverlay         from '../overlays/SkillsOverlay'
import ProjectsOverlay       from '../overlays/ProjectsOverlay'
import ContactOverlay        from '../overlays/ContactOverlay'
import type { Zone as NavZone } from '../hooks/useCameraNavigation'
import { pickLatLon }        from '../earth/geo'
import type { CloudStatus }  from '../earth/liveClouds'
import { getSimTimeMs }      from '../sim/simClock'
import { DEBUG_ENABLED, registerDebugProvider, setDebugReady } from '../debug/spaceon'
import { FloatingOrigin }    from '../space/floatingOrigin'
import { CAMERA_FAR, CAMERA_NEAR, findMissingDepthChunks } from '../space/depth'
import { AU_KM, BODY_PHYSICAL, C_KM_S, hillRadiusKm, sphereOfInfluenceKm } from '../space/ephemeris'
import type { BodyId } from '../space/ephemeris'
import { SolarSystem }       from '../space/solarSystem'
import { BeltBand, LocalBeltField } from '../space/belt'
import {
  MARKER_KM_PER_UNIT, SPAWN_VIEW, computeZoneFrame, createZoneFrame, zoneViewDir,
} from '../space/portfolioZone'
import { createSky }         from '../flight/sky'
import { createAstronaut, createISS, createJWST } from '../flight/models'
import { DESTINATIONS, LANDING_RADIUS_KM, createDestinations } from '../flight/destinations'

// ── Flight mode: the real solar system at true scale ───────────────────────
// 1 world unit = 1 km; heliocentric ecliptic J2000 (Sun at the origin, scene
// XZ = ecliptic, +Y = ecliptic north). See docs/TRUE_SCALE_PLAN.md.
//
// Rendering is camera-relative (FloatingOrigin): the camera stays at (0,0,0)
// and every tracked object's render position is derived each frame from its
// float64 world position. The ship lives in the floating-origin frame, which
// rides with the "host" body whose sphere of influence the ship is in, so it
// stays put relative to Earth (or Mars, …) while that body orbits the Sun.

// ── Ship & camera ──────────────────────────────────────────────────────────
// The UFO is ~16 m across: its geometry is authored in old scene units and
// scaled by UFO_KM_PER_UNIT. Until the flight model is replaced (Milestone 3)
// the old physics runs with its rates scaled by SPEED_KM_PER_UNIT, the same
// scale as the portfolio zone, so flying around the zone feels as before.
const UFO_KM_PER_UNIT   = 0.02
const SPEED_KM_PER_UNIT = MARKER_KM_PER_UNIT
const CAM_OFFSET        = new THREE.Vector3(0, 0.8, 2.5).multiplyScalar(UFO_KM_PER_UNIT)
const CAM_LOOK          = new THREE.Vector3(0, 0, -2).multiplyScalar(UFO_KM_PER_UNIT)
/** Headlight: the old 60 at ~10 units, rescaled for the 16 m ship (decay 1.2). */
const HEADLIGHT_ON      = 60 * Math.pow(UFO_KM_PER_UNIT, 1.2)

/** Closest approach to a body's centre (km): above the atmosphere for Earth. */
function minApproachKm(id: BodyId): number {
  const r = BODY_PHYSICAL[id].radius
  if (id === 'earth') return r + 150
  if (id === 'sun')   return r * 1.5
  return r * 1.003 + 5
}

// ── Decorative objects ─────────────────────────────────────────────────────
const ISS_ALTITUDE_KM   = 420
const ISS_PERIOD_S      = 92.7 * 60
const ISS_INCLINATION   = 51.6 * Math.PI / 180
const JWST_L2_KM        = 1.5e6
const JWST_HALO_KM      = 250_000
const JWST_HALO_DAYS    = 180
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
 * The smallest region containing the ship wins; otherwise the Sun.
 */
const HOST_CANDIDATES: BodyId[] = ['moon', 'mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune']
const SOI: Partial<Record<BodyId, number>> = Object.fromEntries(
  HOST_CANDIDATES.map(id => [id, Math.max(sphereOfInfluenceKm(id), 1.25 * hillRadiusKm(id))]))

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

const _push = new THREE.Vector3()
/** Keep `pos` at least `minDist` from `center`, removing inward velocity. */
function pushOut(pos: THREE.Vector3, vel: THREE.Vector3, center: THREE.Vector3, minDist: number): void {
  _push.subVectors(pos, center)
  if (_push.length() >= minDist) return
  _push.normalize()
  pos.copy(center).addScaledVector(_push, minDist)
  const dot = vel.dot(_push)
  if (dot < 0) vel.addScaledVector(_push, -dot)
}

const _lookM  = new THREE.Matrix4()
const _lookO  = new THREE.Vector3()
const _lookUp = new THREE.Vector3(0, 1, 0)
const _lookR  = new THREE.Vector3()
/**
 * Ship Euler (XYZ) whose forward (local −Z) points along unit `f`, kept level
 * (no roll about the forward axis relative to ecliptic north). The follow
 * camera looks ~10° below the ship's forward, so whatever the ship points at
 * sits just above the ship in the view, clear of it.
 */
function eulerLookingAlong(f: THREE.Vector3, out: THREE.Euler): THREE.Euler {
  _lookR.copy(f)
  _lookM.lookAt(_lookO.set(0, 0, 0), _lookR, _lookUp)
  return out.setFromRotationMatrix(_lookM, 'XYZ')
}

interface FlightModeProps {
  onExit:            () => void
  onEnterBlackHole:  () => void
}

interface RadarState { dots: RadarBlip[]; bodies: RadarBlip[] }

export default function FlightMode({ onExit, onEnterBlackHole }: FlightModeProps) {
  const containerRef        = useRef<HTMLDivElement>(null)
  const onExitRef           = useRef(onExit)
  const onEnterBlackHoleRef = useRef(onEnterBlackHole)
  useEffect(() => { onExitRef.current = onExit }, [onExit])
  useEffect(() => { onEnterBlackHoleRef.current = onEnterBlackHole }, [onEnterBlackHole])

  const inputRef               = useFlightControls()
  const { ufoStateRef, update } = useUFOPhysics(inputRef, { speedScale: SPEED_KM_PER_UNIT, boundary: false })

  const [speed,         setSpeed]         = useState(0)
  const [isBoosting,    setIsBoosting]    = useState(false)
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
    PLANET_DATA.map(() => ({ x: 0, y: 0, visible: false })),
  )

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
    solar.update(getSimTimeMs(), _camWorld.set(AU_KM, 0, 0), 1 / 60)

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

    // ── Ship: frame-relative, riding with its host body ───────────────────
    let hostId: BodyId = 'earth'
    origin.switchHost(B.earth.world)
    const state = ufoStateRef.current
    origin.toLocal(zone.spawn, state.position)
    state.velocity.set(0, 0, 0)
    state.angularVelocity.set(0, 0, 0)
    eulerLookingAlong(zoneViewDir(zone, SPAWN_VIEW.az, SPAWN_VIEW.el, _tmp), state.rotation)
    const shipWorld = new THREE.Vector3()
    const updateShipWorld = () => { shipWorld.addVectors(origin.frame, state.position) }
    updateShipWorld()

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
      for (let i = 0; i < buf.length; i += 3) { buf[i] = state.position.x; buf[i + 1] = state.position.y; buf[i + 2] = state.position.z }
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
    const BOOST_TRAIL_COUNT = isMobile ? 30 : 60
    const boostTrailPos = new Float32Array(BOOST_TRAIL_COUNT * 3)
    fillTrail(boostTrailPos)
    const boostTrailGeo = new THREE.BufferGeometry()
    boostTrailGeo.setAttribute('position', new THREE.BufferAttribute(boostTrailPos, 3))
    const boostTrailMat = new THREE.PointsMaterial({
      color: 0x7df9ff, size: (isMobile ? 0.14 : 0.2) * UFO_KM_PER_UNIT, sizeAttenuation: true,
      transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
    })
    const boostPts = new THREE.Points(boostTrailGeo, boostTrailMat)
    boostPts.frustumCulled = false
    scene.add(boostPts)
    trailObjects.push(boostPts)

    // Frame shifts (recentre / host switch): re-express frame-relative state.
    const offShift = origin.onShift((dx, dy, dz) => {
      state.position.x -= dx; state.position.y -= dy; state.position.z -= dz
      if (trailPos) shiftTrail(trailPos, dx, dy, dz)
      shiftTrail(boostTrailPos, dx, dy, dz)
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
    const issWorld       = new THREE.Vector3()
    const jwstWorld      = new THREE.Vector3()
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
    // ISS orbit plane: 51.6° to Earth's equator, node fixed (decorative).
    const issNode    = new THREE.Vector3()
    const issAxis    = new THREE.Vector3()
    const issQ       = new THREE.Quaternion()
    const earthNorth = new THREE.Vector3()

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
    const _projV = new THREE.Vector3()

    // ── Camera ─────────────────────────────────────────────────────────────
    // Follows the ship rigidly in position (no lag: the ship is metres across
    // and may move thousands of km per frame) with the old 0.1-per-frame
    // smoothing on the offset's orientation, so turns still swing the view.
    let entryProgress = 0
    let entryDone     = false
    const camOffsetW     = new THREE.Vector3()    // smoothed offset (world axes)
    const camOffsetT     = new THREE.Vector3()    // target offset
    const camLookAt      = new THREE.Vector3()    // world
    const camFollowL     = new THREE.Vector3()    // frame-local follow position
    const entryStartL    = new THREE.Vector3()
    const prevCamWorld   = new THREE.Vector3()
    const _prevCamRender = new THREE.Vector3()
    const _fwd           = new THREE.Vector3()
    camOffsetW.copy(CAM_OFFSET).applyEuler(state.rotation)
    origin.cameraLocal.copy(state.position).add(camOffsetW)

    // Misc loop state
    let landingFired = false
    let hudClock     = 0
    let trailClock   = 0
    let fpsCount     = 0
    let fpsLast      = performance.now()
    const nearest    = { id: 'earth' as BodyId, distance: 0, altitude: 0 }

    // ── Dev-only teleport (temporary, until fast travel exists) ───────────
    const DEG = Math.PI / 180
    const TELEPORT_TARGETS = ['spawn', 'overview', 'belt', 'sun', ...HOST_CANDIDATES, 'iss', 'jwst', ...DESTINATIONS.map(d => d.name)]
    const teleport = (id: string, fill = 0.4): string => {
      if (id === 'spawn') {
        hostId = 'earth'; origin.switchHost(B.earth.world)
        computeZoneFrame(B.earth.world, zone)
        origin.toLocal(zone.spawn, state.position)
        eulerLookingAlong(zoneViewDir(zone, SPAWN_VIEW.az, SPAWN_VIEW.el, _tmp), state.rotation)
      } else if (id === 'belt') {
        // 2.7 AU from the Sun, in the ecliptic, at Earth's current longitude, looking along the orbit.
        hostId = 'sun'; origin.switchHost(B.sun.world)
        _tmp.copy(B.earth.world).setY(0).normalize().multiplyScalar(2.7 * AU_KM)
        origin.toLocal(_tmp, state.position)
        eulerLookingAlong(_tmp2.set(-_tmp.z, 0, _tmp.x).normalize(), state.rotation)
      } else if (id === 'overview') {
        // 3 AU above the Sun, looking down at the inner system (orbits, belt).
        hostId = 'sun'; origin.switchHost(B.sun.world)
        _tmp.set(0.35 * AU_KM, 3 * AU_KM, 0.6 * AU_KM)
        origin.toLocal(_tmp, state.position)
        eulerLookingAlong(_tmp2.copy(_tmp).negate().normalize(), state.rotation)
      } else if (id === 'iss' || id === 'jwst') {
        // 250 m (ISS) / 60 m (JWST) from the model on its sunward side. The
        // ship rides with Earth, so the ISS (7.7 km/s) passes by quickly.
        const w = id === 'iss' ? issWorld : jwstWorld
        if (!(id === 'iss' ? issGroup : jwstGroup)) return `${id} model not loaded yet`
        _tmp.copy(w).negate().normalize().add(_tmp2.set(0, 0.3, 0)).normalize()
        hostId = 'earth'; origin.switchHost(B.earth.world)
        origin.toLocal(_render.copy(w).addScaledVector(_tmp, id === 'iss' ? 0.25 : 0.06), state.position)
        eulerLookingAlong(_tmp.negate(), state.rotation)
      } else if (DESTINATIONS.some(d => d.name === id)) {
        // 1 500 km in front of a portfolio destination (inside landing range).
        const w = destinations.world[DESTINATIONS.findIndex(d => d.name === id)]
        hostId = 'earth'; origin.switchHost(B.earth.world)
        _tmp.subVectors(zone.spawn, w).normalize()
        origin.toLocal(_render.copy(w).addScaledVector(_tmp, 1_500), state.position)
        eulerLookingAlong(_tmp.negate(), state.rotation)
      } else if (id in B) {
        const b = B[id as BodyId]
        // Sunlit side (Sun ~35° to the side behind the camera), the body
        // filling ~`fill` of the view height; for the Sun, 12 radii away.
        const dist = b.id === 'sun' ? b.radius * 12 : b.radius / Math.sin(fill * camera.fov * DEG / 2)
        if (b.id === 'sun') _tmp.set(1, 0.2, 0)
        else _tmp.subVectors(B.sun.world, b.world)
        _tmp.normalize().applyAxisAngle(_tmp2.set(0, 1, 0), 35 * DEG)
        _tmp.y += 0.18
        _tmp.normalize()
        hostId = b.id
        origin.switchHost(b.world)
        origin.toLocal(_render.copy(b.world).addScaledVector(_tmp, dist), state.position)
        eulerLookingAlong(_tmp.negate(), state.rotation)
      } else {
        return `unknown target "${id}" — try: ${TELEPORT_TARGETS.join(', ')}`
      }
      state.velocity.set(0, 0, 0)
      state.angularVelocity.set(0, 0, 0)
      camOffsetW.copy(CAM_OFFSET).applyEuler(state.rotation)
      origin.cameraLocal.copy(state.position).add(camOffsetW)
      entryDone = true
      fillTrail(boostTrailPos)
      if (trailPos) fillTrail(trailPos)
      return `teleported to ${id}`
    }
    if (import.meta.env.DEV) {
      (window as unknown as { __spaceonDev?: unknown }).__spaceonDev = Object.freeze({
        /** Teleport next to a body (sun, mercury … neptune, moon), into the belt, or back to spawn. */
        teleport,
        targets: TELEPORT_TARGETS,
      })
    }

    // ── Debug hook provider (read-only; no-op unless the hook is enabled) ──
    const dbgFps = { fps: 0, count: 0, last: performance.now(), frames: 0 }
    const r3 = (v: THREE.Vector3): number[] => [v.x, v.y, v.z]
    const _dbgFwd = new THREE.Vector3()
    const _dbgVel = new THREE.Vector3()
    const unregisterDebug = registerDebugProvider('flight', () => {
      const info = renderer.info
      const bodies: Record<string, unknown> = {}
      solar.list.forEach((b, i) => {
        bodies[b.id] = {
          position: r3(b.world), distanceKm: b.world.distanceTo(shipWorld), discPx: b.discPx,
          magnitude: b.magnitude, impostorAlpha: solar.impostors.alphaOf(i), meshVisible: b.object.visible,
        }
      })
      const destinationsOut: Record<string, number[]> = {}
      DESTINATIONS.forEach((d, i) => { destinationsOut[d.name] = r3(destinations.world[i]) })
      camera.getWorldDirection(_dbgFwd)
      origin.getCameraWorld(_camWorld)
      const vKmS = state.velocity.length() * REF_FPS
      const out = {
        units:      'km',
        ship: {
          position: r3(shipWorld), velocityKmS: r3(_dbgVel.copy(state.velocity).multiplyScalar(REF_FPS)),
          speedKmS: vKmS, speedC: vKmS / C_KM_S, host: hostId,
          rotation: [state.rotation.x, state.rotation.y, state.rotation.z],
          distanceFromSunAU: shipWorld.length() / AU_KM,
        },
        camera:      { position: r3(_camWorld), forward: r3(_dbgFwd), fov: camera.fov, near: camera.near, far: camera.far },
        nearestBody: { id: nearest.id, distanceKm: nearest.distance, altitudeKm: nearest.altitude },
        target:      null,
        travelMode:  inputRef.current.boost ? 'boost' : 'manual',
        overlay:     currentZoneRef.current,
        fps:         dbgFps.fps,
        frames:      dbgFps.frames,
        adaptation:  solar.adaptation,
        cloudStatus: solar.earth.getCloudStatus(),
        assets:      { loaded: dbgAssets.loaded, total: dbgAssets.total, failed: [...dbgAssets.failed] },
        models:      { iss: !!issGroup, jwst: !!jwstGroup || isMobile, astronaut: !!astronautGroup },
        decorative: {
          iss:       issGroup ? { position: r3(issWorld), altitudeKm: issWorld.distanceTo(B.earth.world) - BODY_PHYSICAL.earth.radius } : null,
          jwst:      jwstGroup ? { position: r3(jwstWorld), distanceFromEarthKm: jwstWorld.distanceTo(B.earth.world) } : null,
          astronaut: astronautGroup ? { position: r3(astronautWorld), distanceFromShipKm: astronautWorld.distanceTo(shipWorld) } : null,
        },
        belt: { zoneDensity: localBelt.density, localFieldActive: localBelt.root.visible, rocksDrawn: localBelt.visibleCount },
        renderer: {
          calls: info.render.calls, triangles: info.render.triangles, points: info.render.points, lines: info.render.lines,
          textures: info.memory.textures, geometries: info.memory.geometries, programs: info.programs?.length ?? 0,
        },
        floatingOrigin: {
          frame: r3(origin.frame), cameraLocal: r3(origin.cameraLocal), host: hostId,
          tracked: origin.trackedCount, renderCamera: r3(camera.position),
        },
        depth: {
          logarithmic: renderer.capabilities.logarithmicDepthBuffer, near: camera.near, far: camera.far,
          missingChunks: findMissingDepthChunks([scene, skyScene]),
        },
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
      origin.getCameraWorld(prevCamWorld)
      solar.update(simMs, prevCamWorld, dt)
      origin.carry(B[hostId].world)

      // ── Ship physics (frame-relative) and surfaces ───────────────────────
      update(dt)
      for (const b of solar.list) {
        pushOut(state.position, state.velocity, origin.toLocal(b.world, _tmp), minApproachKm(b.id))
      }
      updateShipWorld()

      // Host: the smallest sphere of influence containing the ship (with
      // hysteresis); otherwise the Sun.
      let newHost: BodyId = 'sun'
      let best = Infinity
      for (const id of HOST_CANDIDATES) {
        const soi = SOI[id]!
        if (shipWorld.distanceTo(B[id].world) < soi * (id === hostId ? 1.05 : 0.98) && soi < best) { best = soi; newHost = id }
      }
      if (newHost !== hostId) { hostId = newHost; origin.switchHost(B[hostId].world); updateShipWorld() }

      // Nearest body surface.
      let bestAlt = Infinity
      for (const b of solar.list) {
        const d = shipWorld.distanceTo(b.world)
        if (d - b.radius < bestAlt) { bestAlt = d - b.radius; nearest.id = b.id; nearest.distance = d; nearest.altitude = d - b.radius }
      }

      // ── Portfolio zone, destinations, decorative objects (world) ─────────
      computeZoneFrame(B.earth.world, zone)
      destinations.update(t, k, zone)
      if (astronautGroup) {
        astronautWorld.copy(zone.spawn)
          .addScaledVector(zone.right,   ASTRONAUT_SPAWN_OFFSET.x + Math.sin(t * 0.11) * 0.004)
          .addScaledVector(zone.up,      ASTRONAUT_SPAWN_OFFSET.y + Math.sin(t * 0.07 + 1) * 0.002)
          .addScaledVector(zone.forward, ASTRONAUT_SPAWN_OFFSET.z)
        astronautGroup.rotation.x += ASTRONAUT_TUMBLE[0] * dt
        astronautGroup.rotation.y += ASTRONAUT_TUMBLE[1] * dt
        astronautGroup.rotation.z += ASTRONAUT_TUMBLE[2] * dt
      }
      earthNorth.set(0, 1, 0).applyQuaternion(solar.earth.group.quaternion)
      if (issGroup) {
        // Decorative circular orbit at 420 km, 51.6° to the equator, real period.
        issNode.set(1, 0, 0).applyQuaternion(solar.earth.group.quaternion)
        issAxis.copy(earthNorth).applyAxisAngle(issNode, ISS_INCLINATION)
        const ang = ((simMs / 1000) % ISS_PERIOD_S) / ISS_PERIOD_S * Math.PI * 2
        _tmp.copy(issNode).applyQuaternion(issQ.setFromAxisAngle(issAxis, ang))
        issWorld.copy(B.earth.world).addScaledVector(_tmp, BODY_PHYSICAL.earth.radius + ISS_ALTITUDE_KM)
        issGroup.up.copy(_tmp)                                // radial "up"
        _tmp2.crossVectors(issAxis, _tmp)                     // along-track
        issGroup.quaternion.setFromUnitVectors(_render.set(1, 0, 0), _tmp2)
      }
      if (jwstGroup) {
        // Sun–Earth L2, 1.5 million km anti-sunward, on a slow decorative halo.
        _tmp.copy(B.earth.world).normalize()                  // anti-sunward
        _tmp2.set(0, 1, 0).cross(_tmp).normalize()
        const ph = (simMs / 86_400_000 / JWST_HALO_DAYS) * Math.PI * 2
        jwstWorld.copy(B.earth.world).addScaledVector(_tmp, JWST_L2_KM)
          .addScaledVector(_tmp2, Math.cos(ph) * JWST_HALO_KM)
        jwstWorld.y += Math.sin(ph) * JWST_HALO_KM * 0.6
        // Sunshield facing the Sun.
        jwstGroup.quaternion.setFromUnitVectors(_render.set(0, 1, 0), _tmp.negate())
      }

      // ── Belt ────────────────────────────────────────────────────────────
      beltBand.update(simMs)
      localBelt.prepare(prevCamWorld)

      // ── Sky ─────────────────────────────────────────────────────────────
      sky.update(t)

      // ── UFO mesh, lights, trails ────────────────────────────────────────
      ufoGroup.rotation.copy(state.rotation)
      const lightOp = entryDone ? (0.5 + 0.5 * Math.sin(t * 8)) * 0.8 : 0
      for (const m of ufoLightMats) m.opacity = lightOp
      const boostOn = inputRef.current.boost
      trailClock += dt
      const trailSteps = Math.floor(trailClock / TRAIL_STEP)
      trailClock -= trailSteps * TRAIL_STEP
      if (trailPos && trailGeo && trailMat) {
        advanceTrail(trailPos, TRAIL_COUNT, trailSteps, state.position)
        trailGeo.attributes.position.needsUpdate = true
        trailMat.opacity = entryDone ? (boostOn ? 0.15 : 0.55) : 0
      }
      advanceTrail(boostTrailPos, BOOST_TRAIL_COUNT, trailSteps, state.position)
      boostTrailGeo.attributes.position.needsUpdate = true
      boostTrailMat.opacity += ((entryDone && boostOn ? 0.85 : 0) - boostTrailMat.opacity) * (1 - Math.pow(1 - 0.08, k))

      // ── Camera (frame-local) ────────────────────────────────────────────
      camOffsetT.copy(CAM_OFFSET).applyEuler(state.rotation)
      camOffsetW.lerp(camOffsetT, 1 - Math.pow(1 - 0.1, k))   // 0.1 per frame at 60 fps
      camFollowL.copy(state.position).add(camOffsetW)
      camLookAt.copy(CAM_LOOK).applyEuler(state.rotation).add(shipWorld)
      if (!entryDone) {
        entryProgress += dt / ENTRY_DUR
        const ep   = Math.min(entryProgress, 1)
        const ease = ep * ep * (3 - 2 * ep)
        saucerMat.opacity = ease
        domeMat.opacity   = ease * 0.9
        rimMat.opacity    = ease * 0.5
        // Sweep in from just above Earth's day side to the ship.
        _tmp.copy(zone.forward).negate().addScaledVector(zone.up, 0.35).normalize()
        origin.toLocal(_tmp2.copy(B.earth.world).addScaledVector(_tmp, BODY_PHYSICAL.earth.radius * 1.8), entryStartL)
        origin.cameraLocal.lerpVectors(entryStartL, camFollowL, ease)
        if (ep >= 1) entryDone = true
      } else {
        origin.cameraLocal.copy(camFollowL)
      }
      origin.recenter()

      // ── Floating origin: world → camera-relative render positions ───────
      origin.apply()
      for (const tp of trailObjects) origin.localToRender(_render.set(0, 0, 0), tp.position)
      camera.lookAt(origin.toRender(camLookAt, _render))
      camera.updateMatrixWorld()
      origin.getCameraWorld(_camWorld)

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
      const cw = container.clientWidth
      const ch = container.clientHeight
      let nearestBodyKey:     string | null = null
      let nearestBodyInRange: boolean       = false
      let nearestBodyDist:    number        = Infinity
      for (let i = 0; i < PLANET_DATA.length; i++) {
        const pd  = PLANET_DATA[i]
        const b   = planetBodies[i]
        const ld  = planetLabelDataRef.current[i]
        const dist = b.world.distanceTo(shipWorld)
        if (dist < nearestBodyDist) {
          nearestBodyDist    = dist
          nearestBodyKey     = pd.key
          nearestBodyInRange = dist < pd.detectionRadius
        }
        if (dist >= pd.detectionRadius) { ld.visible = false; continue }
        _projV.copy(b.object.position).project(camera)
        ld.x       = (_projV.x * 0.5 + 0.5) * cw
        ld.y       = (-_projV.y * 0.5 + 0.5) * ch
        ld.visible = _projV.z < 1   // false when the body is behind the camera
      }

      // ── HUD at ~10 fps ─────────────────────────────────────────────────
      hudClock += dt
      if (hudClock >= HUD_INTERVAL) {
        hudClock = 0
        setActiveBodyKey(nearestBodyInRange ? nearestBodyKey : null)
        const vel      = state.velocity.length()
        const topSpeed = (inputRef.current.boost ? 3.2 : 0.4) * SPEED_KM_PER_UNIT
        setSpeed(Math.min(vel / topSpeed, 1))
        setIsBoosting(inputRef.current.boost)
        setInBelt(localBelt.density > 0.03)

        // Radar: heading-up, positions relative to the ship (km; the HUD log-scales them).
        _fwd.set(0, 0, -1).applyEuler(state.rotation)
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

        if (!landingFired && inputRef.current.land && minDist < LANDING_RADIUS_KM) {
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

      // Sky first (always behind), then the world over a cleared depth buffer.
      renderer.info.reset()
      renderer.clear()
      renderer.render(skyScene, camera)
      renderer.clearDepth()
      renderer.render(scene, camera)
    }

    animate()

    let localLightOn = false
    const handleLightKey = (e: KeyboardEvent) => {
      if (e.code === 'KeyL' && !e.repeat) {
        localLightOn = !localLightOn
        ufoSpotLight.intensity = localLightOn ? HEADLIGHT_ON : 0
        setLightOn(localLightOn)
        lightOnRef.current = localLightOn
      }
    }
    window.addEventListener('keydown', handleLightKey)

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
      window.removeEventListener('keydown', handleLightKey)
      renderer.domElement.removeEventListener('dblclick', onPickDbl)

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
      boostTrailGeo.dispose(); boostTrailMat.dispose()
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
        speed={speed}
        isBoosting={isBoosting}
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
      <PlanetLabels dataRef={planetLabelDataRef} onSelect={setSelectedPlanet} />
      <PlanetInfoPanel planetKey={selectedPlanet} onClose={() => setSelectedPlanet(null)} />
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
