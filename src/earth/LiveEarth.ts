import * as THREE from 'three'
import { createSubsolarResult, subsolarPoint } from './astro'
import { latLonToLocal, orientTowardSun } from './geo'
import { fetchLiveCloudManifest } from './liveClouds'
import type { CloudStatus, LiveCloudManifest } from './liveClouds'
import { getSimTimeMs } from '../sim/simClock'

// ── Live Earth ──────────────────────────────────────────────────────────────
// Self-contained, real-time Earth: oriented to the real subsolar point from the
// shared sim clock, day/night shading with city lights only on the night side,
// a twilight band, a sun-aware atmosphere, and a cloud layer that uses the
// live satellite composite from public/live/ when available (static map
// otherwise). Drop-in for the hub: `createLiveEarth(loader, isMobile)` returns
// the same { group, earthMesh, cloudMesh, dispose } shape as the old factory
// and keeps itself up to date from onBeforeRender, so no loop code is needed.
//
// Earth textures: bobbyroe/threejs-earth (MIT).

export interface LiveEarthOptions {
  radius?:         number
  /** Unit vector from Earth toward the Sun (world space). */
  sunDirection?:   THREE.Vector3
  /** Alternatively derive the sun direction from this light. */
  sunLight?:       THREE.DirectionalLight
  /** Used for anisotropy and to pre-upload a late-arriving cloud texture. */
  renderer?:       THREE.WebGLRenderer
  /** Try public/live/ (default true). */
  liveClouds?:     boolean
  /** Give up waiting for live clouds after this long (default 6000 ms). */
  liveTimeoutMs?:  number
  onCloudStatus?:  (status: CloudStatus) => void
  /** Small marker parented to the Earth, or false. Default: Johannesburg. */
  pin?:            { lat: number; lon: number } | false
}

export interface LiveEarth {
  group:          THREE.Group
  earthMesh:      THREE.Mesh
  cloudMesh:      THREE.Mesh
  atmosphereMesh: THREE.Mesh
  pinMesh:        THREE.Mesh | null
  radius:         number
  /** Re-orient for `simMs` (no-op if sim time moved < 1 s, unless forced). */
  update(simMs: number, force?: boolean): void
  getCloudStatus(): CloudStatus
  dispose(): void
}

const JOHANNESBURG = { lat: -26.2041, lon: 28.0473 }
const ORIENT_THRESHOLD_MS = 1000   // Earth turns 0.004° per second

// ── Shaders ─────────────────────────────────────────────────────────────────

const CLOUD_VERT = /* glsl */`
varying vec2 vUv;
varying vec3 vWorldNormal;
void main() {
  vUv = uv;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`

const CLOUD_FRAG = /* glsl */`
uniform sampler2D uCloudTex;
uniform float uLuma;      // 1 = static greyscale map (alpha from luminance)
uniform float uOpacity;
uniform vec3  uSunDir;
varying vec2 vUv;
varying vec3 vWorldNormal;
void main() {
  vec4  t      = texture2D(uCloudTex, vUv);
  float luma   = dot(t.rgb, vec3(0.299, 0.587, 0.114));
  float a      = mix(t.a, smoothstep(0.08, 0.85, luma), uLuma);
  vec3  albedo = mix(t.rgb, vec3(0.96), uLuma);
  float mu     = dot(normalize(vWorldNormal), uSunDir);
  // Cloud tops stay lit a little past the ground terminator.
  float lit    = smoothstep(-0.10, 0.30, mu);
  float zd     = (mu + 0.02) / 0.07;   // (no pow(): undefined for negative bases)
  vec3  dusk   = vec3(1.0, 0.50, 0.24) * exp(-zd * zd);
  // Faint "moonlit" floor so night-side clouds read as silhouettes.
  vec3  col    = albedo * (vec3(1.0, 0.97, 0.92) * lit * 1.1 + dusk * 0.35 + vec3(0.022, 0.026, 0.040));
  gl_FragColor = vec4(col, a * uOpacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`

const ATMO_VERT = /* glsl */`
varying vec3 vNormal;
varying vec3 vWorldNormal;
void main() {
  vNormal      = normalize(normalMatrix * normal);
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position  = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`

const ATMO_FRAG = /* glsl */`
uniform vec3 uSunDir;
varying vec3 vNormal;
varying vec3 vWorldNormal;
void main() {
  float intensity = pow(max(0.65 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 0.0), 3.0);
  float mu   = dot(normalize(vWorldNormal), uSunDir);
  float lit  = smoothstep(-0.30, 0.45, mu);
  vec3  day  = vec3(0.30, 0.60, 1.00);
  vec3  dark = vec3(0.04, 0.07, 0.18);
  vec3  col  = mix(dark, day, lit);
  float z = (mu + 0.05) / 0.16;
  col += vec3(1.0, 0.45, 0.18) * exp(-z * z) * 0.45;
  gl_FragColor = vec4(col, 1.0) * intensity * mix(0.18, 1.0, lit);
}`

// Injected into MeshPhongMaterial so the Earth keeps three.js lighting (sun,
// ambient, the UFO headlight) while adding the day/night-specific terms.
const EARTH_VERT_PARS = /* glsl */`
varying vec3 vLeWorldNormal;`
const EARTH_VERT_MAIN = /* glsl */`
#include <beginnormal_vertex>
vLeWorldNormal = normalize(mat3(modelMatrix) * objectNormal);`

const EARTH_FRAG_PARS = /* glsl */`
uniform vec3      uSunDir;
uniform sampler2D uCloudTex;
uniform float     uCloudLuma;
uniform float     uNightIntensity;
varying vec3      vLeWorldNormal;`

const EARTH_FRAG_AFTER_MAP = /* glsl */`
#include <map_fragment>
float leMu = dot(normalize(vLeWorldNormal), uSunDir);
// Ocean mask from the (linear) day colour: blue clearly above red/green.
float leOcean = smoothstep(0.015, 0.06, diffuseColor.b - max(diffuseColor.r, diffuseColor.g));`

const EARTH_FRAG_SPECULAR = /* glsl */`
#include <specularmap_fragment>
specularStrength = leOcean;`

const EARTH_FRAG_EMISSIVE = /* glsl */`
#include <emissivemap_fragment>
// City lights: only once the Sun is a few degrees below the horizon, dimmed
// where the (live) cloud layer is thick.
vec4  leCloud  = texture2D(uCloudTex, vMapUv);
float leCloudA = mix(leCloud.a, smoothstep(0.08, 0.85, dot(leCloud.rgb, vec3(0.299, 0.587, 0.114))), uCloudLuma);
float leNight  = 1.0 - smoothstep(-0.16, 0.02, leMu);
totalEmissiveRadiance *= leNight * (1.0 - 0.85 * leCloudA) * uNightIntensity;`

const EARTH_FRAG_OUTGOING = /* glsl */`
// Twilight: faint warm band straddling the terminator.
float leZ  = (leMu - 0.015) / 0.075;
float leTw = exp(-leZ * leZ);
outgoingLight += vec3(1.0, 0.48, 0.22) * leTw * 0.10 * (diffuseColor.rgb + 0.08);
// Blue haze toward the sunlit limb.
float leFres = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 3.0);
outgoingLight += vec3(0.30, 0.55, 1.00) * leFres * smoothstep(-0.15, 0.45, leMu) * 0.30;
#include <opaque_fragment>`

// ── Factory ─────────────────────────────────────────────────────────────────

export function createLiveEarth(
  loader:   THREE.TextureLoader,
  isMobile: boolean,
  opts:     LiveEarthOptions = {},
): LiveEarth {
  const R        = opts.radius ?? 10
  const base     = import.meta.env.BASE_URL
  const manager  = loader.manager
  const segs     = isMobile ? 48 : 96
  const maxAniso = opts.renderer ? Math.min(8, opts.renderer.capabilities.getMaxAnisotropy()) : 4

  const sunDir = new THREE.Vector3(-1, 0, 0)
  const setSunFromOptions = () => {
    if (opts.sunDirection) sunDir.copy(opts.sunDirection).normalize()
    else if (opts.sunLight) sunDir.subVectors(opts.sunLight.position, opts.sunLight.target.position).normalize()
  }
  setSunFromOptions()
  let sunResolved = !!(opts.sunDirection || opts.sunLight)

  const group = new THREE.Group()

  // ── Surface ──
  const dayTex   = loader.load(base + 'earth/earth-day.jpg')
  const nightTex = loader.load(base + 'earth/earth-night.jpg')
  for (const t of [dayTex, nightTex]) { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = maxAniso }

  // 1×1 transparent placeholder until a cloud texture is ready.
  const blankClouds = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1, THREE.RGBAFormat)
  blankClouds.needsUpdate = true

  const shared = {
    uSunDir:         { value: sunDir },
    uCloudTex:       { value: blankClouds as THREE.Texture },
    uCloudLuma:      { value: 0 },
    uNightIntensity: { value: 1.25 },
  }

  const earthGeo = new THREE.SphereGeometry(R, segs, segs / 2)
  const earthMat = new THREE.MeshPhongMaterial({
    map:               dayTex,
    emissiveMap:       nightTex,
    emissive:          new THREE.Color(0xffd9a8),
    emissiveIntensity: 1.0,
    specular:          new THREE.Color(0x3a4a5c),
    shininess:         28,
  })
  earthMat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + EARTH_VERT_PARS)
      .replace('#include <beginnormal_vertex>', EARTH_VERT_MAIN)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + EARTH_FRAG_PARS)
      .replace('#include <map_fragment>', EARTH_FRAG_AFTER_MAP)
      .replace('#include <specularmap_fragment>', EARTH_FRAG_SPECULAR)
      .replace('#include <emissivemap_fragment>', EARTH_FRAG_EMISSIVE)
      .replace('#include <opaque_fragment>', EARTH_FRAG_OUTGOING)
  }
  earthMat.customProgramCacheKey = () => 'live-earth-v1'
  const earthMesh = new THREE.Mesh(earthGeo, earthMat)
  earthMesh.name = 'LiveEarthSurface'
  group.add(earthMesh)

  // ── Clouds (share the Earth frame — no independent drift) ──
  const cloudGeo = new THREE.SphereGeometry(R * 1.008, segs, segs / 2)
  const cloudMat = new THREE.ShaderMaterial({
    vertexShader:   CLOUD_VERT,
    fragmentShader: CLOUD_FRAG,
    uniforms: {
      uCloudTex: shared.uCloudTex,
      uLuma:     shared.uCloudLuma,
      uSunDir:   shared.uSunDir,
      uOpacity:  { value: 0.95 },
    },
    transparent: true,
    depthWrite:  false,
  })
  const cloudMesh = new THREE.Mesh(cloudGeo, cloudMat)
  cloudMesh.name = 'LiveEarthClouds'
  group.add(cloudMesh)

  // ── Atmosphere rim ──
  const atmoGeo = new THREE.SphereGeometry(R * 1.1, isMobile ? 32 : 64, isMobile ? 16 : 32)
  const atmoMat = new THREE.ShaderMaterial({
    vertexShader:   ATMO_VERT,
    fragmentShader: ATMO_FRAG,
    uniforms:       { uSunDir: shared.uSunDir },
    side:           THREE.BackSide,
    blending:       THREE.AdditiveBlending,
    transparent:    true,
    depthWrite:     false,
  })
  const atmosphereMesh = new THREE.Mesh(atmoGeo, atmoMat)
  group.add(atmosphereMesh)

  // ── Calibration pin ──
  let pinMesh: THREE.Mesh | null = null
  let pinGeo:  THREE.BufferGeometry | null = null
  let pinMat:  THREE.Material | null = null
  const pin = opts.pin === undefined ? JOHANNESBURG : opts.pin
  if (pin) {
    pinGeo  = new THREE.SphereGeometry(R * 0.006, 8, 6)
    pinMat  = new THREE.MeshBasicMaterial({ color: 0xffc46b })
    pinMesh = new THREE.Mesh(pinGeo, pinMat)
    pinMesh.name = 'LiveEarthPin'
    latLonToLocal(pin.lat, pin.lon, R * 1.002, pinMesh.position)
    group.add(pinMesh)
  }

  // ── Orientation ──
  const sub    = createSubsolarResult()
  let lastMs   = NaN
  const update = (simMs: number, force = false) => {
    if (!force && Math.abs(simMs - lastMs) < ORIENT_THRESHOLD_MS) return
    lastMs = simMs
    subsolarPoint(simMs, sub)
    orientTowardSun(sub.lat, sub.lon, sunDir, group.quaternion)
  }
  update(getSimTimeMs(), true)

  // Self-update when rendered, so a host loop doesn't have to. Also pins the
  // meshes' local rotation, which makes any legacy "spin" code a no-op.
  earthMesh.onBeforeRender = (_r, scene) => {
    if (!sunResolved) {
      scene.traverse((o) => {
        if (!sunResolved && (o as THREE.DirectionalLight).isDirectionalLight) {
          const l = o as THREE.DirectionalLight
          sunDir.subVectors(l.position, l.target.position).normalize()
          sunResolved = true
          lastMs = NaN
        }
      })
    }
    earthMesh.rotation.set(0, 0, 0)
    cloudMesh.rotation.set(0, 0, 0)
    update(getSimTimeMs())
  }

  // ── Cloud texture: live → static → none ──
  let status: CloudStatus = { kind: 'loading' }
  const setStatus = (s: CloudStatus) => { status = s; opts.onCloudStatus?.(s) }
  let cloudTex: THREE.Texture | null = null
  let disposed = false

  const applyCloudTexture = (tex: THREE.Texture, luma: boolean) => {
    tex.anisotropy = maxAniso
    if (opts.renderer) opts.renderer.initTexture(tex)
    const prev = cloudTex
    cloudTex = tex
    shared.uCloudTex.value  = tex
    shared.uCloudLuma.value = luma ? 1 : 0
    if (prev && prev !== tex) prev.dispose()
  }

  // The loading screen waits on this item; it is ended exactly once, at the
  // latest after liveTimeoutMs, so a slow or missing live texture never hangs it.
  const ITEM = 'live-earth:clouds'
  let released = false
  const release = () => {
    if (released) return
    released = true
    manager.itemEnd(ITEM)
  }
  manager.itemStart(ITEM)
  const timeoutMs = opts.liveTimeoutMs ?? 6000
  const releaseTimer = setTimeout(release, timeoutMs)

  const loadStatic = (reason: 'no-manifest' | 'no-live-data' | 'texture-error') => {
    if (disposed) return
    // Before the deadline, route through the shared loader so the loading
    // screen accounts for it; after, load quietly and swap in on arrival.
    const l = released ? new THREE.TextureLoader() : loader
    const url = base + (isMobile ? 'earth/earth-clouds-4k.jpg' : 'earth/earth-clouds.jpg')
    l.load(
      url,
      (tex) => {
        if (disposed) { tex.dispose(); return }
        tex.colorSpace = THREE.NoColorSpace   // used as raw coverage, not colour
        applyCloudTexture(tex, true)
        setStatus({ kind: 'static', reason })
      },
      undefined,
      () => { if (!disposed) setStatus({ kind: 'none' }) },
    )
    release()
  }

  const loadLive = (manifest: LiveCloudManifest) => {
    const c = manifest.clouds
    if (!c) { loadStatic('no-live-data'); return }
    const f   = isMobile ? c.files.mobile : c.files.desktop
    const url = `${base}live/${f.file}?v=${encodeURIComponent(manifest.generatedAt ?? c.dataTime)}`
    // Not routed through the manager: the manual item above covers it, and a
    // late arrival must not re-trigger the GPU pre-warm.
    new THREE.TextureLoader().load(
      url,
      (tex) => {
        if (disposed) { tex.dispose(); return }
        tex.colorSpace = THREE.SRGBColorSpace
        applyCloudTexture(tex, false)
        setStatus({
          kind:        'live',
          dataTimeMs:  Date.parse(c.dataTime),
          builtAtMs:   Date.parse(manifest.generatedAt ?? c.dataTime),
          previous:    c.status === 'previous',
          attribution: c.attribution,
        })
        release()
      },
      undefined,
      () => loadStatic('texture-error'),
    )
  }

  if (opts.liveClouds === false) {
    loadStatic('no-manifest')
  } else {
    void fetchLiveCloudManifest(base, timeoutMs).then((m) => {
      if (disposed) return
      if (m) loadLive(m)
      else loadStatic('no-manifest')
    })
  }

  return {
    group, earthMesh, cloudMesh, atmosphereMesh, pinMesh, radius: R,
    update,
    getCloudStatus: () => status,
    dispose: () => {
      disposed = true
      clearTimeout(releaseTimer)
      release()
      earthGeo.dispose(); earthMat.dispose()
      cloudGeo.dispose(); cloudMat.dispose()
      atmoGeo.dispose();  atmoMat.dispose()
      pinGeo?.dispose();  pinMat?.dispose()
      dayTex.dispose();   nightTex.dispose()
      cloudTex?.dispose(); blankClouds.dispose()
      earthMesh.onBeforeRender = () => {}
    },
  }
}
