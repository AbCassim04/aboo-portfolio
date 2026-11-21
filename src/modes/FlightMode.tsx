import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader }  from 'three/addons/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import { useFlightControls } from '../hooks/useFlightControls'
import { useUFOPhysics }     from '../hooks/useUFOPhysics'
import { AsteroidField, MAIN_BELT_CONFIG } from '../systems/AsteroidField'
import {
  createMercury, createVenus, createMars, createJupiter,
  createSaturn, createUranus, createNeptune,
} from '../utils/planetFactories'
import FlightHUD             from '../components/FlightHUD'
import type { PlanetDot, SolarBody } from '../components/FlightHUD'
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
import { createLiveEarth }   from '../earth/LiveEarth'
import { createMoonPlacer }  from '../earth/moon'
import { pickLatLon }        from '../earth/geo'
import type { CloudStatus }  from '../earth/liveClouds'
import { getSimTimeMs }      from '../sim/simClock'

// ── GLSL shaders ───────────────────────────────────────────────────────────

const GLOW_VERT = `
varying vec3 vNormal;
varying vec3 vViewPosition;
void main() {
  vNormal = normalize(normalMatrix * normal);
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vViewPosition = -mvPosition.xyz;
  gl_Position = projectionMatrix * mvPosition;
}`

const GLOW_FRAG = `
uniform vec3 uColor;
uniform float uIntensity;
varying vec3 vNormal;
varying vec3 vViewPosition;
void main() {
  vec3 normal  = normalize(vNormal);
  vec3 viewDir = normalize(vViewPosition);
  float fresnel = pow(1.0 - abs(dot(normal, viewDir)), 3.0);
  float glow    = fresnel * uIntensity;
  gl_FragColor  = vec4(uColor, glow * 0.6);
}`

const NEBULA_VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 1.0);
}`

const NEBULA_FRAG = `
uniform float uTime;
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform vec3 uColor3;
varying vec2 vUv;
vec3 mod289(vec3 x) { return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v) {
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g  = step(x0.yzx, x0.xyz);
  vec3 l  = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
    i.z + vec4(0.0, i1.z, i2.z, 1.0))
    + i.y + vec4(0.0, i1.y, i2.y, 1.0))
    + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3  ns = n_ * D.wyz - D.xzx;
  vec4  j  = p - 49.0 * floor(p * ns.z * ns.z);
  vec4  x_ = floor(j * ns.z);
  vec4  y_ = floor(j - 7.0 * x_);
  vec4  x  = x_ * ns.x + ns.yyyy;
  vec4  y  = y_ * ns.x + ns.yyyy;
  vec4  h  = 1.0 - abs(x) - abs(y);
  vec4 b0  = vec4(x.xy, y.xy);
  vec4 b1  = vec4(x.zw, y.zw);
  vec4 s0  = floor(b0)*2.0 + 1.0;
  vec4 s1  = floor(b1)*2.0 + 1.0;
  vec4 sh  = -step(h, vec4(0.0));
  vec4 a0  = b0.xzyw + s0.xzyw*sh.xxyy;
  vec4 a1  = b1.xzyw + s1.xzyw*sh.zzww;
  vec3 p0  = vec3(a0.xy, h.x);
  vec3 p1  = vec3(a0.zw, h.y);
  vec3 p2  = vec3(a1.xy, h.z);
  vec3 p3  = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}
float fbm(vec3 p) {
  float val = 0.0; float amp = 0.5; float freq = 1.0;
  for (int i = 0; i < 5; i++) { val += amp * snoise(p * freq); amp *= 0.5; freq *= 2.0; }
  return val;
}
void main() {
  vec2 uv = vUv - 0.5;
  vec3 p1 = vec3(uv * 2.0,       uTime * 0.012);
  vec3 p2 = vec3(uv * 4.0 + 0.3, uTime * 0.008);
  vec3 p3 = vec3(uv * 1.0 - 0.5, uTime * 0.005);
  float n1 = fbm(p1) * 0.5 + 0.5;
  float n2 = fbm(p2) * 0.5 + 0.5;
  float n3 = fbm(p3) * 0.5 + 0.5;
  float cloud = n1 * 0.5 + n2 * 0.3 + n3 * 0.2;
  cloud = smoothstep(0.35, 0.75, cloud);
  vec3 color = mix(uColor1, uColor2, n1);
  color = mix(color, uColor3, n2 * 0.5);
  float vignette = clamp(1.0 - length(uv) * 1.2, 0.0, 1.0);
  gl_FragColor = vec4(color, cloud * 0.12 * vignette);
}`

function createNebulaBackground(): THREE.Mesh {
  const geo  = new THREE.PlaneGeometry(2, 2)
  const mat  = new THREE.ShaderMaterial({
    vertexShader:   NEBULA_VERT,
    fragmentShader: NEBULA_FRAG,
    uniforms: {
      uTime:   { value: 0 },
      uColor1: { value: new THREE.Color('#2a0a4a') },
      uColor2: { value: new THREE.Color('#0a1a3a') },
      uColor3: { value: new THREE.Color('#1a0a2e') },
    },
    transparent: true,
    depthWrite:  false,
    depthTest:   false,
    blending:    THREE.AdditiveBlending,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.frustumCulled = false
  mesh.renderOrder   = -1
  return mesh
}

function createGlowMaterial(color: THREE.Color, intensity = 1.2): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader:   GLOW_VERT,
    fragmentShader: GLOW_FRAG,
    uniforms: {
      uColor:     { value: color },
      uIntensity: { value: intensity },
    },
    transparent: true,
    depthWrite:  false,
    side:        THREE.FrontSide,
    blending:    THREE.AdditiveBlending,
  })
}

function createStarField(isMobile: boolean): { points: THREE.Points; mat: THREE.ShaderMaterial; dispose: () => void } {
  const count     = isMobile ? 3000 : 8000
  const positions = new Float32Array(count * 3)
  const colors    = new Float32Array(count * 3)
  const sizes     = new Float32Array(count)
  const phases    = new Float32Array(count)
  const speeds    = new Float32Array(count)

  for (let i = 0; i < count; i++) {
    let x: number, y: number, z: number
    if (Math.random() < 0.6) {
      const theta = Math.random() * Math.PI * 2
      const phi   = (Math.random() - 0.5) * 0.6
      const r     = 9500 + Math.random() * 500
      x = r * Math.cos(phi) * Math.cos(theta)
      y = r * Math.sin(phi)
      z = r * Math.cos(phi) * Math.sin(theta)
    } else {
      const theta = Math.random() * Math.PI * 2
      const phi   = Math.acos(2 * Math.random() - 1)
      const r     = 9500 + Math.random() * 500
      x = r * Math.sin(phi) * Math.cos(theta)
      y = r * Math.cos(phi)
      z = r * Math.sin(phi) * Math.sin(theta)
    }
    positions[i * 3] = x; positions[i * 3 + 1] = y; positions[i * 3 + 2] = z

    const rnd = Math.random()
    if      (rnd < 0.80) { colors[i*3]=1.0; colors[i*3+1]=1.0;  colors[i*3+2]=1.0  }
    else if (rnd < 0.90) { colors[i*3]=0.7; colors[i*3+1]=0.8;  colors[i*3+2]=1.0  }
    else if (rnd < 0.97) { colors[i*3]=1.0; colors[i*3+1]=0.95; colors[i*3+2]=0.7  }
    else                 { colors[i*3]=1.0; colors[i*3+1]=0.7;  colors[i*3+2]=0.4  }

    const sz = Math.random()
    sizes[i] = sz < 0.90 ? 1.0 + Math.random() * 1.5 : sz < 0.99 ? 3.0 + Math.random() * 2.0 : 6.0 + Math.random() * 3.0

    phases[i] = Math.random() * Math.PI * 2
    speeds[i] = 0.5 + Math.random() * 2.5
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('color',    new THREE.BufferAttribute(colors,    3))
  geo.setAttribute('size',     new THREE.BufferAttribute(sizes,     1))
  geo.setAttribute('phase',    new THREE.BufferAttribute(phases,    1))
  geo.setAttribute('speed',    new THREE.BufferAttribute(speeds,    1))

  const mat = new THREE.ShaderMaterial({
    uniforms:     { time: { value: 0 } },
    vertexColors: true,
    transparent:  true,
    depthWrite:   false,
    blending:     THREE.AdditiveBlending,
    vertexShader: `
      attribute float size;
      attribute float phase;
      attribute float speed;
      uniform   float time;
      varying   vec3  vColor;
      varying   float vAlpha;
      void main() {
        vColor = color;
        float twinkle = 0.75 + 0.25 * sin(time * speed + phase);
        vAlpha = twinkle;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * twinkle * (600.0 / -mvPosition.z);
        gl_Position  = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      varying vec3  vColor;
      varying float vAlpha;
      void main() {
        float dist = length(gl_PointCoord - vec2(0.5));
        if (dist > 0.5) discard;
        float alpha = smoothstep(0.5, 0.1, dist) * vAlpha;
        gl_FragColor = vec4(vColor, alpha);
      }
    `,
  })

  const points = new THREE.Points(geo, mat)
  points.frustumCulled = false
  return { points, mat, dispose: () => { geo.dispose(); mat.dispose() } }
}

// ── Earth / Moon / ISS constants ──────────────────────────────────────────
const EARTH_RADIUS       = 10
const EARTH_POS          = new THREE.Vector3(0, 0, 0)
const EARTH_BUFFER       = 12
const MOON_RADIUS        = 3
const MOON_ORBIT_RADIUS  = 30
const ISS_ORBIT_RADIUS   = 22
const ISS_ORBIT_SPEED    = 0.048    // rad/s (was 0.0008 rad/frame at 60 fps)
const ISS_SCALE          = 0.1
const JWST_ORBIT_RADIUS  = 30
const JWST_ORBIT_SPEED   = 0.018    // rad/s (was 0.0003 rad/frame)
const JWST_SCALE         = 0.08
const ASTRONAUT_ORBIT_RADIUS = 35
const ASTRONAUT_SPEED        = 0.036                  // rad/s (was 0.0006 rad/frame)
const ASTRONAUT_TUMBLE       = [0.06, 0.048, 0.03]    // rad/s about x, y, z (was 0.001/0.0008/0.0005 per frame)
const ASTRONAUT_SCALE        = 3.0
// Start just ahead-right of the spawn view so he drifts in front of the player
// after the loading screen lifts (0.3π started him off-screen left, drifting behind).
const ASTRONAUT_START_ANGLE  = -0.35
// Fill light kept on the viewer's side of the astronaut (outside his mesh).
const ASTRONAUT_LIGHT_OFFSET    = 6
const ASTRONAUT_LIGHT_INTENSITY = 30
const ASTRONAUT_LIGHT_RANGE     = 12

// Animation rates that used to be applied once per frame were tuned at 60 fps.
// The loop now scales them by k = dt · REF_FPS (dt = clamped frame time), so
// they look the same at 60 fps and no longer speed up on 120/144 Hz screens.
const REF_FPS      = 60
const TRAIL_STEP   = 1 / REF_FPS   // trails keep one sample per 1/60 s
const HUD_INTERVAL = 0.1           // React HUD state updates at ~10 Hz

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

// ── Universe constants (match SpaceCanvas) ─────────────────────────────────
const NODE_COUNT_DESKTOP = 80
const SPHERE_RADIUS      = 3.5
const NEAREST_K          = 3
const NODE_COLORS        = [0x7721b1, 0x3b8bd4, 0x7721b1, 0x3b8bd4, 0xbbccd7]

function pickNodeColor(i: number): number {
  return i % 5 === 4 ? NODE_COLORS[4] : NODE_COLORS[i % 2]
}

function randomInSphere(r: number): THREE.Vector3 {
  while (true) {
    const v = new THREE.Vector3((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2)
    if (v.length() <= 1) return v.multiplyScalar(r)
  }
}

interface ShootingStar {
  line:      THREE.Line
  mat:       THREE.LineBasicMaterial
  geo:       THREE.BufferGeometry
  progress:  number
  direction: THREE.Vector3
  start:     THREE.Vector3
}

// ── Wireframe destinations ─────────────────────────────────────────────────
interface Destination {
  name:  string
  pos:   [number, number, number]
  color: number
  shape: string
  size:  number
}

const DESTINATIONS: Destination[] = [
  { name: 'ABOUT',    pos: [-6,  22,  -4], color: 0x7721B1, shape: 'icosahedron',  size: 1.2 },
  { name: 'SKILLS',   pos: [ 6,  22,  -4], color: 0x3B8BD4, shape: 'octahedron',   size: 1.0 },
  { name: 'PROJECTS', pos: [ 0,  26,   4], color: 0x22c55e, shape: 'dodecahedron', size: 1.3 },
  { name: 'CONTACT',  pos: [ 0,  18,   0], color: 0xD7E2EA, shape: 'torusknot',    size: 0.8 },
  { name: 'M87*',     pos: [ 0,  30, -10], color: 0x1a0030, shape: 'torusknot',    size: 0.6 },
]

function createGeometry(shape: string, size: number): THREE.BufferGeometry {
  switch (shape) {
    case 'icosahedron':  return new THREE.IcosahedronGeometry(size, 0)
    case 'octahedron':   return new THREE.OctahedronGeometry(size)
    case 'dodecahedron': return new THREE.DodecahedronGeometry(size, 0)
    default:             return new THREE.TorusKnotGeometry(size, size * 0.3, 64, 8)
  }
}

function makeDestLabel(text: string, hexColor: number): THREE.CanvasTexture {
  const canvas  = document.createElement('canvas')
  canvas.width  = 256
  canvas.height = 64
  const ctx     = canvas.getContext('2d')!
  ctx.clearRect(0, 0, 256, 64)
  ctx.font         = 'bold 28px Kanit, Arial, sans-serif'
  ctx.fillStyle    = '#' + hexColor.toString(16).padStart(6, '0')
  ctx.textAlign    = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, 128, 32)
  const tex       = new THREE.CanvasTexture(canvas)
  tex.needsUpdate = true
  return tex
}

function createMoon(loader: THREE.TextureLoader, isMobile: boolean): { mesh: THREE.Mesh; dispose: () => void } {
  const base    = import.meta.env.BASE_URL
  const moonTex = loader.load(base + 'earth/8k_moon.jpg')
  moonTex.colorSpace = THREE.SRGBColorSpace
  const INNER_SEGS = isMobile ? 32 : 64

  const moonGeo = new THREE.SphereGeometry(MOON_RADIUS, INNER_SEGS, INNER_SEGS)
  const moonMat = new THREE.MeshPhongMaterial({
    map:       moonTex,
    shininess: 5,
    side:      THREE.FrontSide,
  })
  const mesh = new THREE.Mesh(moonGeo, moonMat)
  return {
    mesh,
    dispose: () => { moonGeo.dispose(); moonMat.dispose(); moonTex.dispose() },
  }
}

// ── GLB helpers ─────────────────────────────────────────────────────────────

/** Dispose a material and every texture it references (deduplicated). */
function disposeMaterial(mat: THREE.Material, seenTextures: Set<THREE.Texture>): void {
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
function disposeObjectTree(root: THREE.Object3D): void {
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

interface LoadedModel { group: THREE.Group; dispose: () => void }

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

function noShadows(group: THREE.Object3D): void {
  group.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (mesh.isMesh) { mesh.castShadow = false; mesh.receiveShadow = false }
  })
}

function createISS(manager?: THREE.LoadingManager): Promise<LoadedModel> {
  return loadGLB('iss.glb', 'ISS', manager, (group) => {
    group.scale.setScalar(ISS_SCALE)
    noShadows(group)
  })
}

function createJWST(manager?: THREE.LoadingManager): Promise<LoadedModel> {
  return loadGLB('jwst.glb', 'JWST', manager, (group) => {
    group.scale.setScalar(JWST_SCALE)
    noShadows(group)
  })
}

function createAstronaut(manager?: THREE.LoadingManager): Promise<LoadedModel> {
  return loadGLB('astronaut-compressed.glb', 'Astronaut', manager, (group) => {
    // The GLB root node (Sketchfab_model) has a baked-in matrix that
    // translates the model ~(177, 283, -438) in local space with scale ~0.00143.
    // Without normalisation the model appears thousands of units from the orbit.
    // Fix: compute the bounding box, shift child[0] so the model is centred at
    // the group origin, then scale the group so the model is ASTRONAUT_SCALE units.
    group.updateMatrixWorld(true)
    const rawBox    = new THREE.Box3().setFromObject(group)
    const rawCenter = rawBox.getCenter(new THREE.Vector3())
    const rawSize   = rawBox.getSize(new THREE.Vector3())
    const maxDim    = Math.max(rawSize.x, rawSize.y, rawSize.z)

    // Shift the Sketchfab root child so the model is centred at (0,0,0)
    if (group.children[0]) {
      group.children[0].position.sub(rawCenter)
      group.children[0].updateMatrix()
    }

    // Scale so the tallest axis equals ASTRONAUT_SCALE world units
    group.scale.setScalar(maxDim > 0 ? ASTRONAUT_SCALE / maxDim : ASTRONAUT_SCALE)

    // KHR_materials_pbrSpecularGlossiness is unsupported in Three.js r184, so
    // every mesh gets one shared lit MeshStandardMaterial (lit by the sun plus
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
      mesh.castShadow    = false
      mesh.receiveShadow = false
      mesh.frustumCulled = false
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const m of mats) if (m) originals.add(m)
      mesh.material = replacement
    })
    const textures = new Set<THREE.Texture>()
    for (const m of originals) disposeMaterial(m, textures)
  })
}

interface FlightModeProps {
  onExit:            () => void
  onEnterBlackHole:  () => void
}

export default function FlightMode({ onExit, onEnterBlackHole }: FlightModeProps) {
  const containerRef        = useRef<HTMLDivElement>(null)
  const onExitRef           = useRef(onExit)
  const onEnterBlackHoleRef = useRef(onEnterBlackHole)
  useEffect(() => { onExitRef.current = onExit }, [onExit])
  useEffect(() => { onEnterBlackHoleRef.current = onEnterBlackHole }, [onEnterBlackHole])

  const inputRef               = useFlightControls()
  const { ufoStateRef, update } = useUFOPhysics(inputRef)

  const [speed,         setSpeed]         = useState(0)
  const [isBoosting,    setIsBoosting]    = useState(false)
  const [nearestPlanet, setNearestPlanet] = useState<{ name: string; distance: number } | null>(null)
  const [ufoXY,         setUfoXY]         = useState({ x: 0, y: 0 })
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
    if (ufoLightRef.current) ufoLightRef.current.intensity = lightOnRef.current ? 60 : 0
    setLightOn(lightOnRef.current)
  }

  const isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0

  const planetDots = useMemo<PlanetDot[]>(
    () => DESTINATIONS.map(d => ({
      name:  d.name,
      x:     d.pos[0],
      y:     d.pos[1],
      color: '#' + d.color.toString(16).padStart(6, '0'),
    })),
    [],
  )

  // Solar-system bodies for the NAV radar (static world positions).
  const solarBodies = useMemo<SolarBody[]>(
    () => PLANET_DATA.map(p => ({
      key:   p.key,
      abbr:  p.abbr,
      name:  p.name,
      x:     p.position[0],
      y:     p.position[1],
      color: p.colorCss,
      isSun: !!p.isSun,
    })),
    [],
  )

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // Real asset-loading progress is tracked through this manager (textures +
    // GLBs are all routed through it). onProgress reports 0–1 but is capped at
    // 0.95 — the final 5% is reserved for the GPU pre-warm step (see onLoad),
    // so "100%" only ever means "shaders compiled and textures uploaded".
    let gpuWarmed = false
    const loadingManager = new THREE.LoadingManager()
    loadingManager.onProgress = (_url, loaded, total) => {
      if (gpuWarmed) return
      setLoadProgress(total > 0 ? Math.min(loaded / total, 0.95) : 0)
    }
    const sharedLoader = new THREE.TextureLoader(loadingManager)

    // ── Scene / Camera / Renderer ──────────────────────────────────────────
    const scene    = new THREE.Scene()
    const camera   = new THREE.PerspectiveCamera(65, container.clientWidth / container.clientHeight, 0.1, 13000)
    const renderer = new THREE.WebGLRenderer({ antialias: !isMobile })
    renderer.setSize(container.clientWidth, container.clientHeight)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1.5 : 2))
    renderer.setClearColor(0x0c0c0c, 1)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.0
    container.appendChild(renderer.domElement)

    camera.position.set(0, 0, 18)
    camera.lookAt(0, 0, 0)

    // ── GPU pre-warm ───────────────────────────────────────────────────────
    // Once every tracked texture has loaded, force Three.js to compile all
    // shader programs and upload all textures to the GPU while the loading
    // screen is still covering the canvas. This removes the entry lag spike
    // that used to happen when the GPU was hit with everything on the first
    // visible frame. Progress only reaches 1.0 after two real frames have
    // rendered post-compile.
    loadingManager.onLoad = () => {
      if (gpuWarmed) return
      gpuWarmed = true
      renderer.compile(scene, camera)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setLoadProgress(1))
      })
    }

    // ── Lights (for UFO shading) ───────────────────────────────────────────
    const ambientLight = new THREE.AmbientLight(0x111122, 0.08)
    scene.add(ambientLight)
    const sunLight = new THREE.DirectionalLight(0xfff5e0, 3.5)
    sunLight.position.set(-4000, 0, 0)
    sunLight.target.position.set(0, 0, 0)
    scene.add(sunLight)
    scene.add(sunLight.target)
    const rimLight = new THREE.PointLight(0x7721b1, 0.3, 50)
    rimLight.position.set(-15, -5, -10)
    scene.add(rimLight)

    // ── 1. Skybox — 3-layer NASA JPL star maps ────────────────────────────
    const base      = import.meta.env.BASE_URL
    const skyLoader = new THREE.TextureLoader(loadingManager)

    const SKY_SEGS = isMobile ? 16 : 32

    const milkyTex  = skyLoader.load(base + 'stars/8k_stars_milky_way.jpg')
    milkyTex.colorSpace = THREE.SRGBColorSpace
    const milkyGeo  = new THREE.SphereGeometry(10000, SKY_SEGS, SKY_SEGS)
    const milkyMat  = new THREE.MeshBasicMaterial({ map: milkyTex, side: THREE.BackSide, transparent: true, opacity: 0.9 })
    const milkyMesh = new THREE.Mesh(milkyGeo, milkyMat)
    scene.add(milkyMesh)

    const starField = createStarField(isMobile)
    scene.add(starField.points)
    const starClock = new THREE.Clock()

    // ── 2. Nebula ─────────────────────────────────────────────────────────
    const nebulaPlanes:     THREE.Mesh[]                = []
    const nebulaMobileMats: THREE.MeshBasicMaterial[]  = []
    let nebulaBgGeo: THREE.BufferGeometry | null        = null
    let nebulaBgMat: THREE.ShaderMaterial | null        = null

    if (isMobile) {
      const mobileNebulaConfigs = [
        { color: 0x2a0a4a, opacity: 0.06, z:  -8.0, ry:  0.3 },
        { color: 0x0a1a3a, opacity: 0.06, z: -20.0, ry: -0.5 },
        { color: 0x1a0a2e, opacity: 0.06, z: -35.0, ry:  0.8 },
      ]
      const flatGeo = new THREE.PlaneGeometry(25, 25)
      nebulaBgGeo = flatGeo
      for (const nc of mobileNebulaConfigs) {
        const mat  = new THREE.MeshBasicMaterial({ color: nc.color, transparent: true, opacity: nc.opacity, side: THREE.DoubleSide, depthWrite: false })
        const mesh = new THREE.Mesh(flatGeo, mat)
        mesh.position.z = nc.z
        mesh.rotation.y = nc.ry
        mesh.rotation.z = Math.random() * Math.PI
        scene.add(mesh)
        nebulaPlanes.push(mesh)
        nebulaMobileMats.push(mat)
      }
    } else {
      const nbg  = createNebulaBackground()
      scene.add(nbg)
      nebulaBgGeo = nbg.geometry
      nebulaBgMat = nbg.material as THREE.ShaderMaterial
    }

    // ── 4. Neural network constellation ────────────────────────────────────
    const nodeCount     = isMobile ? 40 : NODE_COUNT_DESKTOP
    const nodePositions: THREE.Vector3[] = []
    const nodeGroup     = new THREE.Group()
    const nodeMats:     THREE.MeshBasicMaterial[] = []
    const nodeGeo       = new THREE.SphereGeometry(0.04, 8, 8)

    for (let i = 0; i < nodeCount; i++) {
      const pos = randomInSphere(isMobile ? 2 : SPHERE_RADIUS)
      nodePositions.push(pos)
      const mat  = new THREE.MeshBasicMaterial({ color: pickNodeColor(i) })
      nodeMats.push(mat)
      const mesh = new THREE.Mesh(nodeGeo, mat)
      mesh.position.copy(pos)
      nodeGroup.add(mesh)
    }

    const lineVerts: number[] = []
    for (let i = 0; i < nodeCount; i++) {
      const nearest = nodePositions
        .map((p, j) => ({ j, d: nodePositions[i].distanceTo(p) }))
        .filter(({ j }) => j !== i)
        .sort((a, b) => a.d - b.d)
        .slice(0, NEAREST_K)
      for (const { j } of nearest) {
        lineVerts.push(nodePositions[i].x, nodePositions[i].y, nodePositions[i].z,
                       nodePositions[j].x, nodePositions[j].y, nodePositions[j].z)
      }
    }
    const lineGeo = new THREE.BufferGeometry()
    lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(lineVerts, 3))
    const lineMat = new THREE.LineBasicMaterial({ color: 0xd7e2ea, transparent: true, opacity: 0.15 })
    nodeGroup.add(new THREE.LineSegments(lineGeo, lineMat))
    scene.add(nodeGroup)

    // ── 5. Cosmic dust ─────────────────────────────────────────────────────
    const dustPerGroup = isMobile ? 50 : 150
    const dustColors   = [0x7721b1, 0x3b8bd4]
    const dustGroups:  THREE.Points[]         = []
    const dustGeos:    THREE.BufferGeometry[] = []
    const dustMats:    THREE.PointsMaterial[] = []

    for (let c = 0; c < 2; c++) {
      const verts: number[] = []
      for (let i = 0; i < dustPerGroup; i++) {
        const pos = randomInSphere(5)
        verts.push(pos.x, pos.y, pos.z)
      }
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
      const mat = new THREE.PointsMaterial({ color: dustColors[c], size: 0.025, transparent: true, opacity: 0.55, depthWrite: false })
      const pts = new THREE.Points(geo, mat)
      scene.add(pts)
      dustGroups.push(pts)
      dustGeos.push(geo)
      dustMats.push(mat)
    }

    // ── 6. Journey dust clouds ─────────────────────────────────────────────
    const journeyConfigs = [
      { z: -10, r: 4, count: isMobile ? 80  : 200, color: 0x7721b1 },
      { z: -20, r: 5, count: isMobile ? 80  : 200, color: 0x3b8bd4 },
      { z: -35, r: 6, count: isMobile ? 60  : 150, color: 0xbbccd7 },
    ]
    const journeyDust:     THREE.Points[]         = []
    const journeyDustGeos: THREE.BufferGeometry[] = []
    const journeyDustMats: THREE.PointsMaterial[] = []

    for (const jc of journeyConfigs) {
      const verts: number[] = []
      for (let i = 0; i < jc.count; i++) {
        const pos = randomInSphere(jc.r)
        verts.push(pos.x, pos.y, pos.z + jc.z)
      }
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
      const mat = new THREE.PointsMaterial({ color: jc.color, size: 0.025, transparent: true, opacity: 0.45, depthWrite: false })
      const pts = new THREE.Points(geo, mat)
      scene.add(pts)
      journeyDust.push(pts)
      journeyDustGeos.push(geo)
      journeyDustMats.push(mat)
    }

    // ── 7. Shooting stars (desktop only) ───────────────────────────────────
    const shootingStars:  ShootingStar[] = []
    const SHOOT_INTERVAL = 3.0
    const SHOOT_DURATION = 1.5
    let shootTimer       = 0

    function spawnShootingStar() {
      const spread = 8
      const side   = Math.floor(Math.random() * 4)
      const start  = new THREE.Vector3()
      switch (side) {
        case 0:  start.set(-spread - Math.random(), (Math.random() - 0.5) * spread, (Math.random() - 0.5) * 2); break
        case 1:  start.set( spread + Math.random(), (Math.random() - 0.5) * spread, (Math.random() - 0.5) * 2); break
        case 2:  start.set((Math.random() - 0.5) * spread,  spread + Math.random(), (Math.random() - 0.5) * 2); break
        default: start.set((Math.random() - 0.5) * spread, -spread - Math.random(), (Math.random() - 0.5) * 2)
      }
      const dir     = new THREE.Vector3(-start.x * 0.5 + (Math.random() - 0.5), -start.y * 0.5 + (Math.random() - 0.5), (Math.random() - 0.5) * 0.5).normalize()
      const tailLen = 0.6 + Math.random() * 0.6
      const end     = start.clone().addScaledVector(dir, tailLen)
      const geo     = new THREE.BufferGeometry().setFromPoints([start, end])
      const mat     = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 })
      const line    = new THREE.Line(geo, mat)
      scene.add(line)
      shootingStars.push({ line, mat, geo, progress: 0, direction: dir, start: start.clone() })
    }

    // ── 8. Wireframe destinations ──────────────────────────────────────────
    const destGroups:     THREE.Group[]          = []
    const destOriginalY:  number[]               = []
    const destLabels:     THREE.Mesh[]           = []
    const destAllGeos:    THREE.BufferGeometry[] = []
    const destAllMats:    THREE.Material[]       = []
    const destTextures:   THREE.CanvasTexture[]  = []
    const destGlowGeos:   THREE.BufferGeometry[] = []
    const destGlowMats:   THREE.ShaderMaterial[] = []
    const destGlowMeshes: THREE.Mesh[]           = []
    const destLabelGeo    = new THREE.PlaneGeometry(4, 1.0)

    for (let i = 0; i < DESTINATIONS.length; i++) {
      const cfg   = DESTINATIONS[i]
      const group = new THREE.Group()
      group.position.set(...cfg.pos)
      destOriginalY.push(cfg.pos[1])

      // Inner solid core (40% size, low opacity)
      const coreGeo = createGeometry(cfg.shape, cfg.size * 0.4)
      const coreMat = new THREE.MeshBasicMaterial({ color: cfg.color, transparent: true, opacity: 0.15 })
      group.add(new THREE.Mesh(coreGeo, coreMat))
      destAllGeos.push(coreGeo)
      destAllMats.push(coreMat)

      // Wireframe shell
      const shellGeo = createGeometry(cfg.shape, cfg.size)
      const edgeGeo  = new THREE.EdgesGeometry(shellGeo)
      const wireMat  = new THREE.LineBasicMaterial({ color: cfg.color, transparent: true, opacity: 0.9 })
      group.add(new THREE.LineSegments(edgeGeo, wireMat))
      destAllGeos.push(shellGeo, edgeGeo)
      destAllMats.push(wireMat)

      // Outer aura (slightly larger, very faint)
      const auraGeo = createGeometry(cfg.shape, cfg.size * 1.1)
      const auraMat = new THREE.MeshBasicMaterial({ color: cfg.color, transparent: true, opacity: 0.05, side: THREE.BackSide })
      group.add(new THREE.Mesh(auraGeo, auraMat))
      destAllGeos.push(auraGeo)
      destAllMats.push(auraMat)

      // Colored point light for scene ambiance
      const pLight = new THREE.PointLight(cfg.color, 0.2, 10)
      pLight.position.set(...cfg.pos)
      scene.add(pLight)

      // Atmospheric glow aura (1.3× size, Fresnel shader, world-space — no rotation)
      const glowGeo  = createGeometry(cfg.shape, cfg.size * 1.3)
      const glowMat  = createGlowMaterial(new THREE.Color(cfg.color), isMobile ? 0.7 : 1.2)
      const glowMesh = new THREE.Mesh(glowGeo, glowMat)
      glowMesh.position.set(...cfg.pos)
      scene.add(glowMesh)
      destGlowGeos.push(glowGeo)
      destGlowMats.push(glowMat)
      destGlowMeshes.push(glowMesh)

      scene.add(group)
      destGroups.push(group)

      // Label as a scene child (not group child) for correct billboarding
      const labelTex = makeDestLabel(cfg.name, cfg.color)
      const labelMat = new THREE.MeshBasicMaterial({ map: labelTex, transparent: true, depthWrite: false, side: THREE.DoubleSide })
      const label    = new THREE.Mesh(destLabelGeo, labelMat)
      label.position.set(cfg.pos[0], cfg.pos[1] + cfg.size + 1.5, cfg.pos[2])
      scene.add(label)
      destLabels.push(label)
      destAllMats.push(labelMat)
      destTextures.push(labelTex)
    }

    // ── 9. UFO mesh ────────────────────────────────────────────────────────
    const ufoGroup  = new THREE.Group()

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

    ufoGroup.position.copy(ufoStateRef.current.position)
    scene.add(ufoGroup)

    const ufoSpotLight = new THREE.SpotLight(0xffffff, 0, 600, Math.PI / 5, 0.2, 1.2)
    ufoSpotLight.position.set(0, 0, 0)
    ufoGroup.add(ufoSpotLight)
    const ufoSpotLightTarget = new THREE.Object3D()
    ufoSpotLightTarget.position.set(0, 0, -10)
    ufoGroup.add(ufoSpotLightTarget)
    ufoSpotLight.target = ufoSpotLightTarget
    ufoLightRef.current = ufoSpotLight

    // ── 10. Particle trail (desktop only) ──────────────────────────────────
    const TRAIL_COUNT = 80
    let trailGeo: THREE.BufferGeometry | null = null
    let trailMat: THREE.PointsMaterial  | null = null
    let trailPos: Float32Array          | null = null

    if (!isMobile) {
      trailPos = new Float32Array(TRAIL_COUNT * 3)
      const p0 = ufoStateRef.current.position
      for (let i = 0; i < TRAIL_COUNT * 3; i += 3) {
        trailPos[i] = p0.x; trailPos[i+1] = p0.y; trailPos[i+2] = p0.z
      }
      trailGeo = new THREE.BufferGeometry()
      trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3))
      trailMat = new THREE.PointsMaterial({ color: 0x9b4fc0, size: 0.08, sizeAttenuation: true, transparent: true, opacity: 0 })
      scene.add(new THREE.Points(trailGeo, trailMat))
    }

    // Boost trail — bright cyan, additive, fades in/out with boost toggle
    const BOOST_TRAIL_COUNT = isMobile ? 30 : 60
    let boostTrailGeo: THREE.BufferGeometry | null = null
    let boostTrailMat: THREE.PointsMaterial | null = null
    let boostTrailPos: Float32Array         | null = null

    {
      const p0 = ufoStateRef.current.position
      boostTrailPos = new Float32Array(BOOST_TRAIL_COUNT * 3)
      for (let i = 0; i < BOOST_TRAIL_COUNT * 3; i += 3) {
        boostTrailPos[i] = p0.x; boostTrailPos[i+1] = p0.y; boostTrailPos[i+2] = p0.z
      }
      boostTrailGeo = new THREE.BufferGeometry()
      boostTrailGeo.setAttribute('position', new THREE.BufferAttribute(boostTrailPos, 3))
      boostTrailMat = new THREE.PointsMaterial({
        color:           0x7df9ff,
        size:            isMobile ? 0.14 : 0.2,
        sizeAttenuation: true,
        transparent:     true,
        opacity:         0,
        blending:        THREE.AdditiveBlending,
        depthWrite:      false,
      })
      scene.add(new THREE.Points(boostTrailGeo, boostTrailMat))
    }

    // ── 11. Boundary sphere ────────────────────────────────────────────────
    const boundGeo = new THREE.SphereGeometry(9000, 16, 12)
    const boundMat = new THREE.MeshBasicMaterial({ color: 0x7721b1, wireframe: true, transparent: true, opacity: 0.02 })
    scene.add(new THREE.Mesh(boundGeo, boundMat))

    // ── 12. Earth (decorative) ────────────────────────────────────────────
    // Real-time Earth (shared module): oriented from the sim clock so the real
    // subsolar point faces the Sun at x=−4000; the light itself never moves.
    const earthObj = createLiveEarth(sharedLoader, isMobile, {
      radius:        EARTH_RADIUS,
      sunLight,
      renderer,
      onCloudStatus: setCloudStatus,
    })
    earthObj.group.position.copy(EARTH_POS)
    scene.add(earthObj.group)

    const moonObj = createMoon(sharedLoader, isMobile)
    scene.add(moonObj.mesh)
    const moonPlacer = createMoonPlacer(moonObj.mesh, earthObj.group, MOON_ORBIT_RADIUS)
    moonPlacer.update(getSimTimeMs(), true)

    // DEV: double-click the globe to log its lat/lon (calibration aid).
    const pickRay   = new THREE.Raycaster()
    const pickNdc   = new THREE.Vector2()
    const onPickDbl = (e: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect()
      pickNdc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1)
      pickRay.setFromCamera(pickNdc, camera)
      const ll = pickLatLon(pickRay, earthObj.earthMesh)
      if (ll) console.info(`[earth] lat ${ll.lat.toFixed(3)}°, lon ${ll.lon.toFixed(3)}°`)
    }
    if (import.meta.env.DEV) renderer.domElement.addEventListener('dblclick', onPickDbl)

    // GLB models are loaded well after the initial scene so their parsing never
    // competes with the first-frame render / GPU pre-warm. A model can finish
    // after the player has left flight mode: `unmounted` (set in cleanup) makes
    // the callback dispose it instead of adding it to the discarded scene.
    let unmounted = false
    const ignoreLoadError = () => { /* already logged by loadGLB */ }
    const disposeLate = (name: string, dispose: () => void) => {
      dispose()
      if (import.meta.env.DEV) console.debug(`[flight] ${name} finished loading after exit — disposed`)
    }

    let issGroup:   THREE.Group | null = null
    let issAngle    = 0
    let issDispose: (() => void) | null = null
    const issTimer = setTimeout(() => {
      createISS(loadingManager).then(({ group, dispose }) => {
        if (unmounted) { disposeLate('ISS', dispose); return }
        issGroup   = group
        issDispose = dispose
        scene.add(issGroup)
      }, ignoreLoadError)
    }, 8000)

    let jwstGroup:   THREE.Group | null = null
    let jwstAngle    = 0
    let jwstDispose: (() => void) | null = null
    let jwstTimer:   ReturnType<typeof setTimeout> | null = null
    if (!isMobile) {
      jwstTimer = setTimeout(() => {
        createJWST(loadingManager).then(({ group, dispose }) => {
          if (unmounted) { disposeLate('JWST', dispose); return }
          jwstGroup   = group
          jwstDispose = dispose
          scene.add(jwstGroup)
        }, ignoreLoadError)
      }, 12000)
    }

    let astronautGroup:   THREE.Group | null = null
    let astronautAngle    = ASTRONAUT_START_ANGLE
    let astronautDispose: (() => void) | null = null
    const astronautTimer = setTimeout(() => {
      createAstronaut(loadingManager).then(({ group, dispose }) => {
        if (unmounted) { disposeLate('astronaut', dispose); return }
        astronautGroup   = group
        astronautDispose = dispose
        scene.add(astronautGroup)
        const astronautLight = new THREE.PointLight(0xfff5e0, ASTRONAUT_LIGHT_INTENSITY, ASTRONAUT_LIGHT_RANGE)
        astronautGroup.userData.light = astronautLight
        scene.add(astronautLight)
      }, ignoreLoadError)
    }, 10000)

    // ── 12.5. Planets (static decorative) ────────────────────────────────
    const mercuryObj = createMercury(sharedLoader, isMobile)
    mercuryObj.group.position.set(-2800, 0, 20)
    scene.add(mercuryObj.group)

    const venusObj = createVenus(sharedLoader, isMobile)
    venusObj.group.position.set(-2000, 0, -30)
    scene.add(venusObj.group)

    const marsObj = createMars(sharedLoader, isMobile)
    marsObj.group.position.set(800, 0, 20)
    scene.add(marsObj.group)

    const jupiterObj = createJupiter(sharedLoader, isMobile)
    jupiterObj.group.position.set(2500, 0, -40)
    scene.add(jupiterObj.group)

    const saturnObj = createSaturn(sharedLoader, isMobile)
    saturnObj.group.position.set(4000, 0, 30)
    scene.add(saturnObj.group)

    const uranusObj = createUranus(sharedLoader, isMobile)
    uranusObj.group.position.set(6000, 0, -20)
    scene.add(uranusObj.group)

    const neptuneObj = createNeptune(sharedLoader, isMobile)
    neptuneObj.group.position.set(8000, 0, 10)
    scene.add(neptuneObj.group)

    // Asteroid belt
    const asteroidBelt = new AsteroidField(MAIN_BELT_CONFIG, isMobile)
    asteroidBelt.addToScene(scene)

    // ── 13. Sun ───────────────────────────────────────────────────────────
    const sunTexture = sharedLoader.load(base + 'stars/8k_sun.jpg')
    const sunGeo     = new THREE.SphereGeometry(140, 64, 64)
    const sunMat     = new THREE.MeshBasicMaterial({ map: sunTexture })
    const sunMesh    = new THREE.Mesh(sunGeo, sunMat)
    sunMesh.position.set(-4000, 0, 0)
    scene.add(sunMesh)

    // ── Planet identification: map each PLANET_DATA key to its live 3D object ──
    // (positions are read from these objects every frame for labels + detection)
    const planetObjects: Record<string, THREE.Object3D> = {
      sun:     sunMesh,
      mercury: mercuryObj.group,
      venus:   venusObj.group,
      earth:   earthObj.group,
      mars:    marsObj.group,
      jupiter: jupiterObj.group,
      saturn:  saturnObj.group,
      uranus:  uranusObj.group,
      neptune: neptuneObj.group,
    }
    const _projV = new THREE.Vector3()

    const SUN_SEGS = isMobile ? 16 : 32
    const coronaGeo = new THREE.SphereGeometry(161, SUN_SEGS, SUN_SEGS)
    const coronaMat = new THREE.MeshBasicMaterial({
      color:       0xff9900,
      transparent: true,
      opacity:     0.55,
      blending:    THREE.AdditiveBlending,
      depthWrite:  false,
      side:        THREE.BackSide,
    })
    coronaGeo.translate(-4000, 0, 0)
    scene.add(new THREE.Mesh(coronaGeo, coronaMat))

    const sunGlowGeo = new THREE.SphereGeometry(175, SUN_SEGS, SUN_SEGS)
    const sunGlowMat = new THREE.MeshBasicMaterial({
      color:       0xffffaa,
      transparent: true,
      opacity:     0.7,
      blending:    THREE.AdditiveBlending,
      depthWrite:  false,
      side:        THREE.BackSide,
    })
    sunGlowGeo.translate(-4000, 0, 0)
    scene.add(new THREE.Mesh(sunGlowGeo, sunGlowMat))

    const sunBloom1Geo = new THREE.SphereGeometry(240, SUN_SEGS, SUN_SEGS)
    const sunBloom1Mat = new THREE.MeshBasicMaterial({
      color:       0xff8800,
      transparent: true,
      opacity:     0.35,
      blending:    THREE.AdditiveBlending,
      depthWrite:  false,
      side:        THREE.BackSide,
    })
    sunBloom1Geo.translate(-4000, 0, 0)
    scene.add(new THREE.Mesh(sunBloom1Geo, sunBloom1Mat))

    const sunBloom2Geo = new THREE.SphereGeometry(350, SUN_SEGS, SUN_SEGS)
    const sunBloom2Mat = new THREE.MeshBasicMaterial({
      color:       0xffffff,
      transparent: true,
      opacity:     0.12,
      blending:    THREE.AdditiveBlending,
      depthWrite:  false,
      side:        THREE.BackSide,
    })
    sunBloom2Geo.translate(-4000, 0, 0)
    scene.add(new THREE.Mesh(sunBloom2Geo, sunBloom2Mat))

    // Faint path line along X axis connecting all planets
    const pathGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-4500, 0, 0),
      new THREE.Vector3(8500,  0, 0),
    ])
    const pathMat = new THREE.LineBasicMaterial({
      color:       0x334455,
      transparent: true,
      opacity:     0.15,
      depthWrite:  false,
    })
    scene.add(new THREE.Line(pathGeo, pathMat))

    // ── Entry animation ────────────────────────────────────────────────────
    let entryProgress = 0
    const ENTRY_DUR   = 2.0
    let entryDone     = false
    const entryStartV = new THREE.Vector3(0, 0, 18)

    // Pre-allocated follow vectors
    const camFollowPos = new THREE.Vector3()
    const camLookAt    = new THREE.Vector3()
    const camOffset    = new THREE.Vector3()

    // Misc loop state
    let landingFired = false
    let hudClock     = 0
    let trailClock   = 0
    let fpsCount     = 0
    let fpsLast      = performance.now()

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

      // Physics
      update(dt)

      // ── Earth surface repulsion ──────────────────────────────────────────
      const toUFO = ufoStateRef.current.position.clone().sub(EARTH_POS)
      const distToEarth = toUFO.length()
      if (distToEarth < EARTH_RADIUS + EARTH_BUFFER) {
        const pushDir = toUFO.normalize()
        ufoStateRef.current.position.copy(EARTH_POS).addScaledVector(pushDir, EARTH_RADIUS + EARTH_BUFFER)
        const dot = ufoStateRef.current.velocity.dot(pushDir)
        if (dot < 0) ufoStateRef.current.velocity.addScaledVector(pushDir, -dot)
      }

      // ── Jupiter surface repulsion ────────────────────────────────────────
      const toUFOJupiter = ufoStateRef.current.position.clone().sub(jupiterObj.group.position)
      if (toUFOJupiter.length() < 125) {
        ufoStateRef.current.position.copy(jupiterObj.group.position).addScaledVector(toUFOJupiter.normalize(), 125)
        const dot = ufoStateRef.current.velocity.dot(toUFOJupiter.normalize())
        if (dot < 0) ufoStateRef.current.velocity.addScaledVector(toUFOJupiter.normalize(), -dot)
      }

      // ── Saturn repulsion (including rings) ───────────────────────────────
      const toUFOSaturn = ufoStateRef.current.position.clone().sub(saturnObj.group.position)
      if (toUFOSaturn.length() < 230) {
        ufoStateRef.current.position.copy(saturnObj.group.position).addScaledVector(toUFOSaturn.normalize(), 230)
        const dot = ufoStateRef.current.velocity.dot(toUFOSaturn.normalize())
        if (dot < 0) ufoStateRef.current.velocity.addScaledVector(toUFOSaturn.normalize(), -dot)
      }

      const state  = ufoStateRef.current
      const ufoPos = state.position
      const ufoRot = state.rotation

      // ── Universe animations ────────────────────────────────────────────
      if (nebulaBgMat) nebulaBgMat.uniforms['uTime'].value = t
      for (const mesh of nebulaPlanes) mesh.rotation.z += 0.0003 * k
      milkyMesh.rotation.y += 0.00002 * k
      starField.mat.uniforms.time.value = starClock.getElapsedTime()
      starField.points.rotation.y += 0.000002 * k

      nodeGroup.rotation.y += 0.003 * k
      nodeGroup.rotation.x  = Math.sin(t * 0.3) * 0.12
      nodeGroup.scale.setScalar(1 + Math.sin(t * 0.5) * 0.03)

      for (const d of dustGroups) {
        d.rotation.y += 0.001 * k
        d.rotation.x  = Math.sin(t * 0.2) * 0.05
      }
      for (let i = 0; i < journeyDust.length; i++) {
        journeyDust[i].rotation.y += 0.0008 * k
        journeyDust[i].rotation.x  = Math.sin(t * 0.15 + i) * 0.04
      }

      // Earth + Moon follow the shared sim clock (both no-op until the sim
      // time has moved enough to matter).
      const simMs = getSimTimeMs()
      earthObj.update(simMs)
      moonPlacer.update(simMs)
      sunMesh.rotation.y += 0.0001 * k
      if (issGroup) {
        issAngle += ISS_ORBIT_SPEED * dt
        issGroup.position.set(
          earthObj.group.position.x + Math.cos(issAngle) * ISS_ORBIT_RADIUS,
          earthObj.group.position.y + Math.sin(issAngle * 0.3) * 3,
          earthObj.group.position.z + Math.sin(issAngle) * ISS_ORBIT_RADIUS,
        )
        issGroup.rotation.y = -issAngle + Math.PI / 2
      }
      if (jwstGroup) {
        jwstAngle += JWST_ORBIT_SPEED * dt
        jwstGroup.position.set(
          earthObj.group.position.x + Math.cos(jwstAngle + Math.PI) * JWST_ORBIT_RADIUS,
          earthObj.group.position.y + Math.sin(jwstAngle * 0.2) * 4,
          earthObj.group.position.z + Math.sin(jwstAngle + Math.PI) * JWST_ORBIT_RADIUS,
        )
        jwstGroup.rotation.y = -jwstAngle + Math.PI / 2
      }
      if (astronautGroup) {
        astronautAngle += ASTRONAUT_SPEED * dt
        astronautGroup.position.set(
          earthObj.group.position.x + Math.cos(astronautAngle) * ASTRONAUT_ORBIT_RADIUS,
          earthObj.group.position.y + Math.sin(astronautAngle * 0.5) * 5,
          earthObj.group.position.z + Math.sin(astronautAngle) * ASTRONAUT_ORBIT_RADIUS,
        )
        astronautGroup.rotation.x += ASTRONAUT_TUMBLE[0] * dt
        astronautGroup.rotation.y += ASTRONAUT_TUMBLE[1] * dt
        astronautGroup.rotation.z += ASTRONAUT_TUMBLE[2] * dt
        if (astronautGroup.userData.light) {
          // Keep the fill light between the astronaut and the camera. At his centre
          // it sat inside the mesh and could only light inward-facing faces, so the
          // side you actually see (usually his night side: the UFO spawns on Earth's
          // dark side) rendered near-black against black space.
          (astronautGroup.userData.light as THREE.PointLight).position
            .subVectors(camera.position, astronautGroup.position)
            .setLength(ASTRONAUT_LIGHT_OFFSET)
            .add(astronautGroup.position)
        }
      }
      mercuryObj.mesh.rotation.y   += 0.0008  * k
      venusObj.mesh.rotation.y     -= 0.0001  * k
      venusObj.atmoMesh.rotation.y -= 0.00015 * k
      marsObj.mesh.rotation.y      += 0.0004  * k
      jupiterObj.mesh.rotation.y   += 0.001   * k
      saturnObj.mesh.rotation.y    += 0.0009  * k
      uranusObj.mesh.rotation.y    += 0.0003  * k
      neptuneObj.mesh.rotation.y   += 0.00035 * k
      asteroidBelt.update(camera.position, dt)

      // Shooting stars (desktop)
      if (!isMobile) {
        shootTimer += dt
        if (shootTimer >= SHOOT_INTERVAL) { shootTimer = 0; spawnShootingStar() }
        for (let i = shootingStars.length - 1; i >= 0; i--) {
          const star       = shootingStars[i]
          star.progress   += dt / SHOOT_DURATION
          const p          = Math.min(star.progress, 1)
          star.mat.opacity = Math.max(0, 1 - p * 1.2) * 0.9
          const travelDist = p * 6
          const headPos    = star.start.clone().addScaledVector(star.direction, travelDist)
          const tailPos    = star.start.clone().addScaledVector(star.direction, Math.max(0, travelDist - 0.7))
          const posAttr    = star.geo.getAttribute('position') as THREE.BufferAttribute
          posAttr.setXYZ(0, tailPos.x, tailPos.y, tailPos.z)
          posAttr.setXYZ(1, headPos.x, headPos.y, headPos.z)
          posAttr.needsUpdate = true
          if (p >= 1) { scene.remove(star.line); star.geo.dispose(); star.mat.dispose(); shootingStars.splice(i, 1) }
        }
      }

      // ── UFO mesh sync ──────────────────────────────────────────────────
      ufoGroup.position.copy(ufoPos)
      ufoGroup.rotation.copy(ufoRot)

      // Pulsing lights
      const lightOp = entryDone ? (0.5 + 0.5 * Math.sin(t * 8)) * 0.8 : 0
      for (const m of ufoLightMats) m.opacity = lightOp

      // Trails: fixed 60 Hz sampling, so their length in time is frame-rate independent.
      const boostOn = inputRef.current.boost
      trailClock += dt
      const trailSteps = Math.floor(trailClock / TRAIL_STEP)
      trailClock -= trailSteps * TRAIL_STEP
      if (trailPos && trailGeo && trailMat) {
        advanceTrail(trailPos, TRAIL_COUNT, trailSteps, ufoPos)
        trailGeo.attributes.position.needsUpdate = true
        trailMat.opacity = entryDone ? (boostOn ? 0.15 : 0.55) : 0
      }
      if (boostTrailPos && boostTrailGeo && boostTrailMat) {
        advanceTrail(boostTrailPos, BOOST_TRAIL_COUNT, trailSteps, ufoPos)
        boostTrailGeo.attributes.position.needsUpdate = true
        const targetOp = entryDone && boostOn ? 0.85 : 0
        boostTrailMat.opacity += (targetOp - boostTrailMat.opacity) * (1 - Math.pow(1 - 0.08, k))
      }

      // ── Destination animations ─────────────────────────────────────────
      for (let i = 0; i < destGroups.length; i++) {
        const g = destGroups[i]
        g.rotation.x += 0.005 * k
        g.rotation.y += 0.008 * k
        g.rotation.z += 0.003 * k
        g.position.y = destOriginalY[i] + Math.sin(t * 0.5 + i) * 0.2
        g.scale.setScalar(1 + Math.sin(t * 0.8 + i) * 0.03)
        destLabels[i].position.y    = g.position.y + DESTINATIONS[i].size + 1.5
        destGlowMeshes[i].position.y = g.position.y
      }
      for (const label of destLabels) {
        label.lookAt(camera.position)
      }

      // ── Entry animation / camera follow ────────────────────────────────
      if (!entryDone) {
        entryProgress += dt / ENTRY_DUR
        const ep   = Math.min(entryProgress, 1)
        const ease = ep * ep * (3 - 2 * ep)

        saucerMat.opacity = ease
        domeMat.opacity   = ease * 0.9
        rimMat.opacity    = ease * 0.5

        camOffset.set(0, 0.8, 2.5).applyEuler(ufoRot)
        camFollowPos.copy(ufoPos).add(camOffset)
        camera.position.lerpVectors(entryStartV, camFollowPos, ease)
        camLookAt.set(0, 0, -2).applyEuler(ufoRot).add(ufoPos)
        camera.lookAt(camLookAt)

        if (ep >= 1) entryDone = true
      } else {
        camOffset.set(0, 0.8, 2.5).applyEuler(ufoRot)
        camFollowPos.copy(ufoPos).add(camOffset)
        camera.position.lerp(camFollowPos, 1 - Math.pow(1 - 0.1, k))   // 0.1 per frame at 60 fps
        camLookAt.set(0, 0, -2).applyEuler(ufoRot).add(ufoPos)
        camera.lookAt(camLookAt)
      }

      // ── Planet labels + detection (every frame for smooth tracking) ──────
      const cw = container.clientWidth
      const ch = container.clientHeight
      let nearestBodyKey:     string | null = null
      let nearestBodyInRange: boolean       = false
      let nearestBodyDist:    number        = Infinity
      for (let i = 0; i < PLANET_DATA.length; i++) {
        const pd  = PLANET_DATA[i]
        const obj = planetObjects[pd.key]
        const ld  = planetLabelDataRef.current[i]
        if (!obj) { ld.visible = false; continue }
        const dist = obj.position.distanceTo(ufoPos)
        if (dist < nearestBodyDist) {
          nearestBodyDist    = dist
          nearestBodyKey     = pd.key
          nearestBodyInRange = dist < pd.detectionRadius
        }
        if (dist >= pd.detectionRadius) { ld.visible = false; continue }
        // Project the planet's world position to screen pixels.
        _projV.copy(obj.position).project(camera)
        ld.x       = (_projV.x * 0.5 + 0.5) * cw
        ld.y       = (-_projV.y * 0.5 + 0.5) * ch
        ld.visible = _projV.z < 1   // false when the planet is behind the camera
      }

      // ── HUD at ~10 fps ─────────────────────────────────────────────────
      hudClock += dt
      if (hudClock >= HUD_INTERVAL) {
        hudClock = 0
        setActiveBodyKey(nearestBodyInRange ? nearestBodyKey : null)
        const vel      = state.velocity.length()
        const topSpeed = inputRef.current.boost ? 3.2 : 0.4
        setSpeed(Math.min(vel / topSpeed, 1))
        setIsBoosting(inputRef.current.boost)
        setUfoXY({ x: ufoPos.x, y: ufoPos.y })

        let minDist = Infinity, minLabel = ''
        for (const dest of DESTINATIONS) {
          const dx = ufoPos.x - dest.pos[0]
          const dy = ufoPos.y - dest.pos[1]
          const dz = ufoPos.z - dest.pos[2]
          const d  = Math.sqrt(dx*dx + dy*dy + dz*dz)
          if (d < minDist) { minDist = d; minLabel = dest.name }
        }
        setNearestPlanet(minDist < 6 ? { name: minLabel, distance: minDist } : null)

        if (!landingFired && inputRef.current.land && minDist < 6) {
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

      renderer.render(scene, camera)
    }

    animate()

    let localLightOn = false
    const handleLightKey = (e: KeyboardEvent) => {
      if (e.code === 'KeyL' && !e.repeat) {
        localLightOn = !localLightOn
        ufoSpotLight.intensity = localLightOn ? 60 : 0
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
      cancelAnimationFrame(rafId)
      clearTimeout(issTimer)
      if (jwstTimer) clearTimeout(jwstTimer)
      clearTimeout(astronautTimer)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('keydown', handleLightKey)
      renderer.domElement.removeEventListener('dblclick', onPickDbl)

      for (const g of destAllGeos) g.dispose()
      for (const m of destAllMats) m.dispose()
      destLabelGeo.dispose()
      for (const tx of destTextures) tx.dispose()
      for (const g of destGlowGeos) g.dispose()
      for (const m of destGlowMats) m.dispose()

      milkyGeo.dispose();  milkyMat.dispose();  milkyTex.dispose()
      starField.dispose()
      nebulaBgGeo?.dispose(); nebulaBgMat?.dispose()
      for (const m of nebulaMobileMats) m.dispose()
      nodeGeo.dispose(); lineGeo.dispose(); lineMat.dispose()
      for (const m of nodeMats) m.dispose()
      for (const g of dustGeos) g.dispose()
      for (const m of dustMats) m.dispose()
      for (const g of journeyDustGeos) g.dispose()
      for (const m of journeyDustMats) m.dispose()
      for (const s of shootingStars) { s.geo.dispose(); s.mat.dispose() }

      saucerGeo.dispose(); saucerMat.dispose()
      domeGeo.dispose();   domeMat.dispose()
      rimGeo.dispose();    rimMat.dispose()
      lightGeo.dispose()
      for (const m of ufoLightMats) m.dispose()

      trailGeo?.dispose(); trailMat?.dispose()
      boostTrailGeo?.dispose(); boostTrailMat?.dispose()

      boundGeo.dispose(); boundMat.dispose()

      earthObj.dispose()
      moonObj.dispose()
      if (issDispose)       issDispose()
      if (jwstDispose)      jwstDispose()
      if (astronautDispose) astronautDispose()
      mercuryObj.dispose()
      venusObj.dispose()
      marsObj.dispose()
      jupiterObj.dispose()
      saturnObj.dispose()
      uranusObj.dispose()
      neptuneObj.dispose()
      sunGeo.dispose(); sunMat.dispose(); sunTexture.dispose()
      coronaGeo.dispose(); coronaMat.dispose()
      sunGlowGeo.dispose(); sunGlowMat.dispose()
      pathGeo.dispose(); pathMat.dispose()
      asteroidBelt.dispose()

      renderer.dispose()
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement)
    }
  // Long-lived render loop: mount once. Deps are refs, setters, or per-mount constants.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // intentional: all refs are stable; isMobile is constant per mount

  const nearestIsBlackHole = nearestPlanet?.name === 'M87*'

  return (
    <div ref={containerRef} style={{ position: 'fixed', inset: 0, width: '100vw', height: '100vh' }}>
      {!loadDone && <LoadingScreen progress={loadProgress} onComplete={() => setLoadDone(true)} />}
      <FlightHUD
        speed={speed}
        isBoosting={isBoosting}
        nearestPlanet={nearestIsBlackHole ? null : nearestPlanet}
        ufoX={ufoXY.x}
        ufoY={ufoXY.y}
        planetDots={planetDots}
        solarBodies={solarBodies}
        activeBodyKey={activeBodyKey}
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
