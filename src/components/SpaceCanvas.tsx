import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import type { CameraTransitionState } from '../hooks/useCameraNavigation'
import LoadingScreen from './LoadingScreen'

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

// ── Earth / Moon ───────────────────────────────────────────────────────────

const HUB_EARTH_RADIUS      = 30
const HUB_EARTH_POS         = new THREE.Vector3(-80, -20, -120)
const HUB_MOON_RADIUS       = 7
const HUB_MOON_ORBIT_RADIUS = 60
const HUB_MOON_ORBIT_SPEED  = 0.0003

function createEarth(loader: THREE.TextureLoader): { group: THREE.Group; earthMesh: THREE.Mesh; cloudMesh: THREE.Mesh; dispose: () => void } {
  const group = new THREE.Group()
  const base  = import.meta.env.BASE_URL

  const dayTex   = loader.load(base + 'earth/earth-day.jpg')
  const cloudTex = loader.load(base + 'earth/earth-clouds.jpg')
  dayTex.colorSpace   = THREE.SRGBColorSpace
  cloudTex.colorSpace = THREE.SRGBColorSpace

  const earthGeo = new THREE.SphereGeometry(HUB_EARTH_RADIUS, 64, 64)
  const earthMat = new THREE.MeshBasicMaterial({ map: dayTex, side: THREE.DoubleSide, transparent: false, depthWrite: true })
  const earthMesh = new THREE.Mesh(earthGeo, earthMat)
  group.add(earthMesh)

  const cloudGeo = new THREE.SphereGeometry(HUB_EARTH_RADIUS + 0.5, 64, 64)
  const cloudMat = new THREE.MeshBasicMaterial({ map: cloudTex, side: THREE.DoubleSide, transparent: true, opacity: 0.35, depthWrite: false })
  const cloudMesh = new THREE.Mesh(cloudGeo, cloudMat)
  group.add(cloudMesh)

  const atmoGeo = new THREE.SphereGeometry(HUB_EARTH_RADIUS + 2, 64, 64)
  const atmoMat = new THREE.ShaderMaterial({
    vertexShader:   `varying vec3 vNormal; void main() { vNormal = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying vec3 vNormal; void main() { float i = pow(0.65 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 3.0); gl_FragColor = vec4(0.3, 0.6, 1.0, 1.0) * i; }`,
    side: THREE.BackSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
  })
  group.add(new THREE.Mesh(atmoGeo, atmoMat))

  group.position.copy(HUB_EARTH_POS)
  group.rotation.z = 0.4101

  return {
    group, earthMesh, cloudMesh,
    dispose: () => {
      earthGeo.dispose(); earthMat.dispose()
      cloudGeo.dispose(); cloudMat.dispose()
      atmoGeo.dispose();  atmoMat.dispose()
      dayTex.dispose();   cloudTex.dispose()
    },
  }
}

function createMoon(loader: THREE.TextureLoader): { mesh: THREE.Mesh; dispose: () => void } {
  const base    = import.meta.env.BASE_URL
  const moonTex = loader.load(base + 'earth/8k_moon.jpg')
  moonTex.colorSpace = THREE.SRGBColorSpace

  const moonGeo = new THREE.SphereGeometry(HUB_MOON_RADIUS, 64, 64)
  const moonMat = new THREE.MeshPhongMaterial({
    map:       moonTex,
    shininess: 5,
    side:      THREE.DoubleSide,
  })
  const mesh = new THREE.Mesh(moonGeo, moonMat)
  return {
    mesh,
    dispose: () => { moonGeo.dispose(); moonMat.dispose(); moonTex.dispose() },
  }
}

function createMercury(loader: THREE.TextureLoader): { group: THREE.Group; mesh: THREE.Mesh; dispose: () => void } {
  const base       = import.meta.env.BASE_URL
  const mercuryTex = loader.load(base + 'earth/8k_mercury.jpg')
  mercuryTex.colorSpace = THREE.SRGBColorSpace
  const group      = new THREE.Group()
  const mercuryGeo = new THREE.SphereGeometry(4, 64, 64)
  const mercuryMat = new THREE.MeshPhongMaterial({ map: mercuryTex, shininess: 5, side: THREE.DoubleSide })
  const mesh       = new THREE.Mesh(mercuryGeo, mercuryMat)
  group.add(mesh)
  group.rotation.z = 0.034
  return { group, mesh, dispose: () => { mercuryGeo.dispose(); mercuryMat.dispose(); mercuryTex.dispose() } }
}

function createVenus(loader: THREE.TextureLoader): { group: THREE.Group; mesh: THREE.Mesh; atmoMesh: THREE.Mesh; dispose: () => void } {
  const base     = import.meta.env.BASE_URL
  const venusTex = loader.load(base + 'earth/8k_venus_surface.jpg')
  const atmoTex  = loader.load(base + 'earth/4k_venus_atmosphere.jpg')
  venusTex.colorSpace = THREE.SRGBColorSpace
  atmoTex.colorSpace  = THREE.SRGBColorSpace
  const group    = new THREE.Group()
  const venusGeo = new THREE.SphereGeometry(9, 64, 64)
  const venusMat = new THREE.MeshPhongMaterial({ map: venusTex, shininess: 8, side: THREE.DoubleSide })
  const mesh     = new THREE.Mesh(venusGeo, venusMat)
  group.add(mesh)
  const atmoGeo  = new THREE.SphereGeometry(9.3, 64, 64)
  const atmoMat  = new THREE.MeshPhongMaterial({ map: atmoTex, shininess: 3, side: THREE.DoubleSide, transparent: true, opacity: 0.7, depthWrite: false })
  const atmoMesh = new THREE.Mesh(atmoGeo, atmoMat)
  group.add(atmoMesh)
  group.rotation.z = 3.096
  return { group, mesh, atmoMesh, dispose: () => { venusGeo.dispose(); venusMat.dispose(); atmoGeo.dispose(); atmoMat.dispose(); venusTex.dispose(); atmoTex.dispose() } }
}

function createMars(loader: THREE.TextureLoader): { group: THREE.Group; mesh: THREE.Mesh; dispose: () => void } {
  const base    = import.meta.env.BASE_URL
  const marsTex = loader.load(base + 'earth/8k_mars.jpg')
  marsTex.colorSpace = THREE.SRGBColorSpace
  const group   = new THREE.Group()
  const marsGeo = new THREE.SphereGeometry(5, 64, 64)
  const marsMat = new THREE.MeshPhongMaterial({ map: marsTex, shininess: 5, side: THREE.DoubleSide })
  const mesh    = new THREE.Mesh(marsGeo, marsMat)
  group.add(mesh)
  group.rotation.z = 0.4396
  return { group, mesh, dispose: () => { marsGeo.dispose(); marsMat.dispose(); marsTex.dispose() } }
}

function createJupiter(loader: THREE.TextureLoader): { group: THREE.Group; mesh: THREE.Mesh; dispose: () => void } {
  const base       = import.meta.env.BASE_URL
  const jupiterTex = loader.load(base + 'earth/8k_jupiter.jpg')
  jupiterTex.colorSpace = THREE.SRGBColorSpace
  const group      = new THREE.Group()
  const jupiterGeo = new THREE.SphereGeometry(45, 64, 64)
  const jupiterMat = new THREE.MeshPhongMaterial({ map: jupiterTex, shininess: 10, side: THREE.DoubleSide })
  const mesh       = new THREE.Mesh(jupiterGeo, jupiterMat)
  group.add(mesh)
  group.rotation.z = 0.0546
  return { group, mesh, dispose: () => { jupiterGeo.dispose(); jupiterMat.dispose(); jupiterTex.dispose() } }
}

function createSaturn(loader: THREE.TextureLoader): { group: THREE.Group; mesh: THREE.Mesh; dispose: () => void } {
  const base      = import.meta.env.BASE_URL
  const saturnTex = loader.load(base + 'earth/8k_saturn.jpg')
  const ringTex   = loader.load(base + 'earth/8k_saturn_ring_alpha.png')
  saturnTex.colorSpace = THREE.SRGBColorSpace
  ringTex.colorSpace   = THREE.SRGBColorSpace
  const group     = new THREE.Group()
  const saturnGeo = new THREE.SphereGeometry(35, 64, 64)
  const saturnMat = new THREE.MeshPhongMaterial({ map: saturnTex, shininess: 10, side: THREE.DoubleSide })
  const mesh      = new THREE.Mesh(saturnGeo, saturnMat)
  group.add(mesh)
  const ringInner = 45, ringOuter = 84
  const ringGeo   = new THREE.RingGeometry(ringInner, ringOuter, 128)
  const pos = ringGeo.attributes.position as THREE.BufferAttribute
  const uv  = ringGeo.attributes.uv as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) {
    const r = Math.sqrt(pos.getX(i) ** 2 + pos.getY(i) ** 2)
    uv.setXY(i, (r - ringInner) / (ringOuter - ringInner), 0.5)
  }
  const ringMat  = new THREE.MeshBasicMaterial({ map: ringTex, side: THREE.DoubleSide, transparent: true, depthWrite: false, opacity: 1.0 })
  const ringMesh = new THREE.Mesh(ringGeo, ringMat)
  ringMesh.rotation.x = Math.PI / 2.5
  group.add(ringMesh)
  group.rotation.z = 0.4665
  return { group, mesh, dispose: () => { saturnGeo.dispose(); saturnMat.dispose(); ringGeo.dispose(); ringMat.dispose(); saturnTex.dispose(); ringTex.dispose() } }
}

function createUranus(loader: THREE.TextureLoader): { group: THREE.Group; mesh: THREE.Mesh; dispose: () => void } {
  const base      = import.meta.env.BASE_URL
  const uranusTex = loader.load(base + 'earth/2k_uranus.jpg')
  uranusTex.colorSpace = THREE.SRGBColorSpace
  const group     = new THREE.Group()
  const uranusGeo = new THREE.SphereGeometry(20, 64, 64)
  const uranusMat = new THREE.MeshPhongMaterial({ map: uranusTex, shininess: 8, side: THREE.DoubleSide })
  const mesh      = new THREE.Mesh(uranusGeo, uranusMat)
  group.add(mesh)
  group.rotation.z = 1.706
  return { group, mesh, dispose: () => { uranusGeo.dispose(); uranusMat.dispose(); uranusTex.dispose() } }
}

function createNeptune(loader: THREE.TextureLoader): { group: THREE.Group; mesh: THREE.Mesh; dispose: () => void } {
  const base       = import.meta.env.BASE_URL
  const neptuneTex = loader.load(base + 'earth/2k_neptune.jpg')
  neptuneTex.colorSpace = THREE.SRGBColorSpace
  const group      = new THREE.Group()
  const neptuneGeo = new THREE.SphereGeometry(19, 64, 64)
  const neptuneMat = new THREE.MeshPhongMaterial({ map: neptuneTex, shininess: 8, side: THREE.DoubleSide })
  const mesh       = new THREE.Mesh(neptuneGeo, neptuneMat)
  group.add(mesh)
  group.rotation.z = 0.4942
  return { group, mesh, dispose: () => { neptuneGeo.dispose(); neptuneMat.dispose(); neptuneTex.dispose() } }
}

// ── Scene constants ────────────────────────────────────────────────────────

const NODE_COUNT_DESKTOP = 80
const SPHERE_RADIUS = 3.5
const NEAREST_K = 3
const NODE_COLORS = [0x7721b1, 0x3b8bd4, 0x7721b1, 0x3b8bd4, 0xbbccd7]

function pickNodeColor(i: number): number {
  if (i % 5 === 4) return NODE_COLORS[4]
  return NODE_COLORS[i % 2]
}

function randomInSphere(r: number): THREE.Vector3 {
  while (true) {
    const v = new THREE.Vector3(
      (Math.random() - 0.5) * 2,
      (Math.random() - 0.5) * 2,
      (Math.random() - 0.5) * 2,
    )
    if (v.length() <= 1) return v.multiplyScalar(r)
  }
}

function createLabelTexture(text: string, color: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 64
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = color
  ctx.font = 'bold 28px Kanit, Arial, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, 128, 32)
  const texture = new THREE.CanvasTexture(canvas)
  texture.needsUpdate = true
  return texture
}

// ── Types ──────────────────────────────────────────────────────────────────

interface ShootingStar {
  line: THREE.Line
  mat: THREE.LineBasicMaterial
  geo: THREE.BufferGeometry
  progress: number
  direction: THREE.Vector3
  start: THREE.Vector3
}

interface UFOData {
  pivot: THREE.Object3D
  ufoGroup: THREE.Group
  lightMats: THREE.MeshBasicMaterial[]
  saucerGeo: THREE.SphereGeometry
  domeGeo: THREE.SphereGeometry
  rimGeo: THREE.TorusGeometry
  saucerMat: THREE.MeshBasicMaterial
  domeMat: THREE.MeshBasicMaterial
  rimMat: THREE.MeshBasicMaterial
  speed: number
}

export interface SpaceCanvasProps {
  cameraStateRef: React.MutableRefObject<CameraTransitionState>
  currentZone: string
  onTransitionComplete: () => void
}

// ── Component ──────────────────────────────────────────────────────────────

export default function SpaceCanvas({ cameraStateRef, currentZone, onTransitionComplete }: SpaceCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [loadProgress, setLoadProgress] = useState(0)
  const [loadDone,     setLoadDone]     = useState(false)

  // Keep mutable refs in sync so animation loop always reads latest values
  const currentZoneRef = useRef(currentZone)
  const onCompleteRef  = useRef(onTransitionComplete)
  useEffect(() => { currentZoneRef.current = currentZone }, [currentZone])
  useEffect(() => { onCompleteRef.current  = onTransitionComplete }, [onTransitionComplete])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const isMobile = window.innerWidth < 768

    const loadingManager = new THREE.LoadingManager(
      () => setLoadDone(true),
      (_url, loaded, total) => setLoadProgress((loaded / total) * 100),
    )
    const sharedLoader = new THREE.TextureLoader(loadingManager)

    // ── Scene & Camera ─────────────────────────────────────────────────────
    const scene  = new THREE.Scene()
    const w = container.clientWidth
    const h = container.clientHeight
    const camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 2000)
    camera.position.set(0, 0, 18)
    camera.lookAt(0, 0, 0)

    // ── Renderer ────────────────────────────────────────────────────────────
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1 : 2))
    renderer.setSize(w, h)
    renderer.setClearColor(0x000000, 0)
    container.appendChild(renderer.domElement)

    // ── 1. SKYBOX ────────────────────────────────────────────────────────────
    const base = import.meta.env.BASE_URL

    const starsTex = sharedLoader.load(base + 'stars/8k_stars.jpg')
    const skyGeo1  = new THREE.SphereGeometry(1800, 64, 64)
    const skyMat1  = new THREE.MeshBasicMaterial({ map: starsTex, side: THREE.BackSide })
    scene.add(new THREE.Mesh(skyGeo1, skyMat1))

    const milkyTex = sharedLoader.load(base + 'stars/8k_stars_milky_way.jpg')
    const skyGeo2  = new THREE.SphereGeometry(1700, 64, 64)
    const skyMat2  = new THREE.MeshBasicMaterial({
      map: milkyTex, side: THREE.BackSide, transparent: true,
      opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false,
    })
    scene.add(new THREE.Mesh(skyGeo2, skyMat2))

    // ── 2. NEBULA ────────────────────────────────────────────────────────────
    const nebulaPlanes:    THREE.Mesh[]                  = []
    const nebulaMobileMats: THREE.MeshBasicMaterial[]   = []
    let nebulaBgGeo: THREE.BufferGeometry | null         = null
    let nebulaBgMat: THREE.ShaderMaterial | null         = null

    if (isMobile) {
      const mobileNebulaConfigs = [
        { color: 0x2a0a4a, opacity: 0.06, z: -1.6,  ry:  0.3 },
        { color: 0x0a1a3a, opacity: 0.06, z: -18.0, ry: -0.5 },
        { color: 0x1a0a2e, opacity: 0.06, z: -32.0, ry:  0.8 },
      ]
      const flatGeo = new THREE.PlaneGeometry(8, 8)
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

    // ── 4. CONSTELLATION ────────────────────────────────────────────────────
    const nodeCount     = isMobile ? 40 : NODE_COUNT_DESKTOP
    const nodePositions: THREE.Vector3[] = []
    const nodeGroup     = new THREE.Group()
    const nodeMats:     THREE.MeshBasicMaterial[] = []
    const nodeGeo       = new THREE.SphereGeometry(0.04, 8, 8)

    for (let i = 0; i < nodeCount; i++) {
      const pos = randomInSphere(isMobile ? 2 : SPHERE_RADIUS)
      nodePositions.push(pos)
      const mat = new THREE.MeshBasicMaterial({ color: pickNodeColor(i) })
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
        lineVerts.push(nodePositions[i].x, nodePositions[i].y, nodePositions[i].z, nodePositions[j].x, nodePositions[j].y, nodePositions[j].z)
      }
    }
    const lineGeo = new THREE.BufferGeometry()
    lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(lineVerts, 3))
    const lineMat = new THREE.LineBasicMaterial({ color: 0xd7e2ea, transparent: true, opacity: 0.15 })
    nodeGroup.add(new THREE.LineSegments(lineGeo, lineMat))
    scene.add(nodeGroup)

    // ── 5. UFOs ─────────────────────────────────────────────────────────────
    const allUFOConfigs = [
      { radius: 0.18, saucerColor: 0x3d1466, domeColor: 0x7721b1, rimColor: 0x5a2090, orbitR: isMobile ? 3.5 : 6,  tiltX: 0,            tiltZ: 0,   speed: 0.004 },
      { radius: 0.12, saucerColor: 0x0a2a4a, domeColor: 0x3b8bd4, rimColor: 0x1a4a6a, orbitR: isMobile ? 4.5 : 8,  tiltX: Math.PI / 6,  tiltZ: 0,   speed: 0.003 },
      { radius: 0.08, saucerColor: 0x0d3b35, domeColor: 0x1a5a50, rimColor: 0x1a5a50, orbitR: isMobile ? 5.0 : 10, tiltX: -Math.PI / 9, tiltZ: 0.2, speed: 0.005 },
    ]
    const ufoConfigs     = isMobile ? allUFOConfigs.slice(0, 1) : allUFOConfigs
    const sharedLightGeo = new THREE.SphereGeometry(0.02, 6, 6)
    const lightColors    = [0xffffff, 0x7721b1, 0xffffff, 0x7721b1]
    const ufos: UFOData[] = []

    for (const cfg of ufoConfigs) {
      const { radius: r } = cfg
      const pivot    = new THREE.Object3D()
      pivot.rotation.x = cfg.tiltX
      pivot.rotation.z = cfg.tiltZ
      const ufoGroup = new THREE.Group()
      ufoGroup.position.x = cfg.orbitR

      const saucerGeo  = new THREE.SphereGeometry(r, 32, 16)
      const saucerMat  = new THREE.MeshBasicMaterial({ color: cfg.saucerColor })
      const saucerMesh = new THREE.Mesh(saucerGeo, saucerMat)
      saucerMesh.scale.y = 0.35
      ufoGroup.add(saucerMesh)

      const domeGeo  = new THREE.SphereGeometry(r * 0.45, 16, 8)
      const domeMat  = new THREE.MeshBasicMaterial({ color: cfg.domeColor })
      const domeMesh = new THREE.Mesh(domeGeo, domeMat)
      domeMesh.position.y = r * 0.3
      ufoGroup.add(domeMesh)

      const rimGeo  = new THREE.TorusGeometry(r * 1.1, 0.02, 8, 32)
      const rimMat  = new THREE.MeshBasicMaterial({ color: cfg.rimColor, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false })
      const rimMesh = new THREE.Mesh(rimGeo, rimMat)
      rimMesh.rotation.x = Math.PI / 2
      ufoGroup.add(rimMesh)

      const lightMats: THREE.MeshBasicMaterial[] = []
      for (let l = 0; l < 4; l++) {
        const angle = (l / 4) * Math.PI * 2
        const lMat  = new THREE.MeshBasicMaterial({ color: lightColors[l], transparent: true, opacity: 0.7 })
        lightMats.push(lMat)
        const lMesh = new THREE.Mesh(sharedLightGeo, lMat)
        lMesh.position.set(r * 0.7 * Math.cos(angle), -r * 0.2, r * 0.7 * Math.sin(angle))
        ufoGroup.add(lMesh)
      }

      pivot.add(ufoGroup)
      scene.add(pivot)
      ufos.push({ pivot, ufoGroup, lightMats, saucerGeo, domeGeo, rimGeo, saucerMat, domeMat, rimMat, speed: cfg.speed })
    }

    // ── 6. COSMIC DUST ──────────────────────────────────────────────────────
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

    // ── 7. JOURNEY DUST CLOUDS ──────────────────────────────────────────────
    const journeyDustConfigs = [
      { z: -10, r: 4, count: isMobile ? 80 : 200, color: 0x7721b1 },
      { z: -20, r: 5, count: isMobile ? 80 : 200, color: 0x3b8bd4 },
      { z: -35, r: 6, count: isMobile ? 60 : 150, color: 0xbbccd7 },
    ]
    const journeyDust:     THREE.Points[]         = []
    const journeyDustGeos: THREE.BufferGeometry[] = []
    const journeyDustMats: THREE.PointsMaterial[] = []

    for (const cfg of journeyDustConfigs) {
      const verts: number[] = []
      for (let i = 0; i < cfg.count; i++) {
        const pos = randomInSphere(cfg.r)
        verts.push(pos.x, pos.y, pos.z + cfg.z)
      }
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
      const mat = new THREE.PointsMaterial({ color: cfg.color, size: 0.025, transparent: true, opacity: 0.45, depthWrite: false })
      const pts = new THREE.Points(geo, mat)
      scene.add(pts)
      journeyDust.push(pts)
      journeyDustGeos.push(geo)
      journeyDustMats.push(mat)
    }

    // ── 8. SHOOTING STARS (desktop only) ────────────────────────────────────
    const shootingStars: ShootingStar[] = []
    const SHOOT_INTERVAL = 3.0
    const SHOOT_DURATION = 1.5
    let shootingStarTimer = 0

    function spawnShootingStar() {
      const spread = 8
      const side   = Math.floor(Math.random() * 4)
      const start  = new THREE.Vector3()
      switch (side) {
        case 0: start.set(-spread - Math.random(), (Math.random() - 0.5) * spread, (Math.random() - 0.5) * 2); break
        case 1: start.set( spread + Math.random(), (Math.random() - 0.5) * spread, (Math.random() - 0.5) * 2); break
        case 2: start.set((Math.random() - 0.5) * spread,  spread + Math.random(), (Math.random() - 0.5) * 2); break
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

    // ── 9. DESTINATION MARKERS ──────────────────────────────────────────────
    const markerConfigs = [
      { name: 'ABOUT',    pos: [-12,  2, 0] as [number,number,number], labelPos: [-12,  4.5, 0] as [number,number,number], color: '#7721B1', hex: 0x7721b1, shape: 'icosahedron',  size: 1.2 },
      { name: 'SKILLS',   pos: [ 12, -1, 0] as [number,number,number], labelPos: [ 12,  1.5, 0] as [number,number,number], color: '#3B8BD4', hex: 0x3b8bd4, shape: 'octahedron',   size: 1.0 },
      { name: 'PROJECTS', pos: [  0, 10, 0] as [number,number,number], labelPos: [  0, 12.5, 0] as [number,number,number], color: '#22c55e', hex: 0x22c55e, shape: 'dodecahedron', size: 1.3 },
      { name: 'CONTACT',  pos: [  0,-10, 0] as [number,number,number], labelPos: [  0, -7.5, 0] as [number,number,number], color: '#D7E2EA', hex: 0xd7e2ea, shape: 'torusknot',   size: 0.7 },
    ]

    const markerMeshes:    THREE.LineSegments[]      = []
    const markerLabels:    THREE.Mesh[]              = []
    const markerGeos:      THREE.BufferGeometry[]    = []
    const markerEdgeGeos:  THREE.BufferGeometry[]    = []
    const markerLineMats:  THREE.LineBasicMaterial[] = []
    const markerLabelMats: THREE.MeshBasicMaterial[] = []
    const markerTextures:  THREE.CanvasTexture[]     = []
    const markerGlowGeos:  THREE.BufferGeometry[]    = []
    const markerGlowMats:  THREE.ShaderMaterial[]    = []
    const sharedLabelGeo   = new THREE.PlaneGeometry(3, 0.75)

    for (const cfg of markerConfigs) {
      let geo: THREE.BufferGeometry
      switch (cfg.shape) {
        case 'icosahedron':  geo = new THREE.IcosahedronGeometry(cfg.size, 0);         break
        case 'octahedron':   geo = new THREE.OctahedronGeometry(cfg.size);             break
        case 'dodecahedron': geo = new THREE.DodecahedronGeometry(cfg.size, 0);        break
        default:             geo = new THREE.TorusKnotGeometry(cfg.size, 0.25, 64, 8); break
      }
      const edgeGeo = new THREE.EdgesGeometry(geo)
      const lineMat = new THREE.LineBasicMaterial({ color: cfg.hex, transparent: true, opacity: 0.8 })
      const mesh    = new THREE.LineSegments(edgeGeo, lineMat)
      mesh.position.set(...cfg.pos)
      scene.add(mesh)
      markerMeshes.push(mesh)
      markerGeos.push(geo)
      markerEdgeGeos.push(edgeGeo)
      markerLineMats.push(lineMat)

      // Atmospheric glow aura (1.3× size, Fresnel shader, no rotation)
      let glowGeoBase: THREE.BufferGeometry
      switch (cfg.shape) {
        case 'icosahedron':  glowGeoBase = new THREE.IcosahedronGeometry(cfg.size * 1.3, 0);               break
        case 'octahedron':   glowGeoBase = new THREE.OctahedronGeometry(cfg.size * 1.3);                   break
        case 'dodecahedron': glowGeoBase = new THREE.DodecahedronGeometry(cfg.size * 1.3, 0);              break
        default:             glowGeoBase = new THREE.TorusKnotGeometry(cfg.size * 1.3, 0.25 * 1.3, 64, 8); break
      }
      const glowMat  = createGlowMaterial(new THREE.Color(cfg.hex), isMobile ? 0.7 : 1.2)
      const glowMesh = new THREE.Mesh(glowGeoBase, glowMat)
      glowMesh.position.set(...cfg.pos)
      scene.add(glowMesh)
      markerGlowGeos.push(glowGeoBase)
      markerGlowMats.push(glowMat)

      const texture  = createLabelTexture(cfg.name, cfg.color)
      const labelMat = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, side: THREE.DoubleSide })
      const label    = new THREE.Mesh(sharedLabelGeo, labelMat)
      label.position.set(...cfg.labelPos)
      scene.add(label)
      markerLabels.push(label)
      markerLabelMats.push(labelMat)
      markerTextures.push(texture)
    }

    // ── 10. Earth (decorative) ───────────────────────────────────────────────
    const earthObj = createEarth(sharedLoader)
    scene.add(earthObj.group)

    const moonObj = createMoon(sharedLoader)
    scene.add(moonObj.mesh)
    let moonAngle = 0

    // ── 10.5. Planets (static decorative) ────────────────────────────────────
    const mercuryObj = createMercury(sharedLoader)
    mercuryObj.group.position.set(60, 15, -50)
    scene.add(mercuryObj.group)

    const venusObj = createVenus(sharedLoader)
    venusObj.group.position.set(-80, -8, -70)
    scene.add(venusObj.group)

    const marsObj = createMars(sharedLoader)
    marsObj.group.position.set(-60, 30, 80)
    scene.add(marsObj.group)

    const jupiterObj = createJupiter(sharedLoader)
    jupiterObj.group.position.set(160, -20, -150)
    scene.add(jupiterObj.group)

    const saturnObj = createSaturn(sharedLoader)
    saturnObj.group.position.set(-150, 15, -130)
    scene.add(saturnObj.group)

    const uranusObj = createUranus(sharedLoader)
    uranusObj.group.position.set(50, 60, -180)
    scene.add(uranusObj.group)

    const neptuneObj = createNeptune(sharedLoader)
    neptuneObj.group.position.set(180, -15, 60)
    scene.add(neptuneObj.group)

    // ── 11. Sun ───────────────────────────────────────────────────────────────
    const sunTex      = sharedLoader.load(base + 'stars/8k_sun.jpg')
    const sunGeo      = new THREE.SphereGeometry(18, 64, 64)
    const sunMat      = new THREE.MeshBasicMaterial({ map: sunTex })
    const sunMesh     = new THREE.Mesh(sunGeo, sunMat)
    sunMesh.position.set(400, 100, 300)
    scene.add(sunMesh)

    const sunGlowGeo  = new THREE.SphereGeometry(22, 32, 32)
    const sunGlowMat  = new THREE.MeshBasicMaterial({
      color:       0xffffaa,
      transparent: true,
      opacity:     0.15,
      blending:    THREE.AdditiveBlending,
      depthWrite:  false,
      side:        THREE.BackSide,
    })
    const sunGlowMesh = new THREE.Mesh(sunGlowGeo, sunGlowMat)
    sunGlowMesh.position.set(400, 100, 300)
    scene.add(sunGlowMesh)

    const sunLight = new THREE.DirectionalLight(0xfff5e0, 3.0)
    sunLight.position.set(400, 100, 300)
    sunLight.target.position.set(0, 0, 0)
    scene.add(sunLight)
    scene.add(sunLight.target)

    // ── Resize ──────────────────────────────────────────────────────────────
    const onResize = () => {
      const rw = container.clientWidth
      const rh = container.clientHeight
      camera.aspect = rw / rh
      camera.updateProjectionMatrix()
      renderer.setSize(rw, rh)
    }
    const ro = new ResizeObserver(onResize)
    ro.observe(container)

    // ── Animation loop ───────────────────────────────────────────────────────
    let frameId: number
    let t        = 0
    let lastTime = performance.now()

    const animate = () => {
      frameId   = requestAnimationFrame(animate)
      const now = performance.now()
      const dt  = Math.min((now - lastTime) / 1000, 0.05)
      lastTime  = now
      t        += dt

      // ── Camera ────────────────────────────────────────────────────────────
      const camState = cameraStateRef.current

      if (camState.active) {
        camState.progress = Math.min(camState.progress + dt / 2.0, 1.0)
        const p    = camState.progress
        const ease = p * p * (3 - 2 * p)

        camera.position.set(
          camState.from.position[0] + (camState.to.position[0] - camState.from.position[0]) * ease,
          camState.from.position[1] + (camState.to.position[1] - camState.from.position[1]) * ease,
          camState.from.position[2] + (camState.to.position[2] - camState.from.position[2]) * ease,
        )
        camera.lookAt(
          camState.from.lookAt[0] + (camState.to.lookAt[0] - camState.from.lookAt[0]) * ease,
          camState.from.lookAt[1] + (camState.to.lookAt[1] - camState.from.lookAt[1]) * ease,
          camState.from.lookAt[2] + (camState.to.lookAt[2] - camState.from.lookAt[2]) * ease,
        )
        camera.fov = camState.from.fov + (camState.to.fov - camState.from.fov) * ease
        camera.updateProjectionMatrix()

        if (camState.progress >= 1.0) {
          camState.active        = false
          currentZoneRef.current = camState.toZone
          onCompleteRef.current()
        }
      } else if (currentZoneRef.current === 'hub') {
        const speed = isMobile ? 0.03 : 0.05
        camera.position.x = 18 * Math.cos(t * speed + Math.PI / 2)
        camera.position.z = 18 * Math.sin(t * speed + Math.PI / 2)
        camera.position.y = Math.sin(t * 0.08) * 0.5
        camera.lookAt(0, 0, 0)
      } else {
        const base = camState.to.position
        camera.position.set(base[0], base[1] + Math.sin(t * 0.5) * 0.1, base[2])
        camera.lookAt(camState.to.lookAt[0], camState.to.lookAt[1], camState.to.lookAt[2])
      }

      // ── Nebula ────────────────────────────────────────────────────────────
      if (nebulaBgMat) nebulaBgMat.uniforms['uTime'].value = t
      for (const mesh of nebulaPlanes) mesh.rotation.z += 0.0003

      // ── Constellation ─────────────────────────────────────────────────────
      nodeGroup.rotation.y += 0.003
      nodeGroup.rotation.x  = Math.sin(t * 0.3) * 0.12
      nodeGroup.scale.setScalar(1 + Math.sin(t * 0.5) * 0.03)

      // ── UFOs ──────────────────────────────────────────────────────────────
      for (let i = 0; i < ufos.length; i++) {
        const u = ufos[i]
        u.pivot.rotation.y    += u.speed
        u.ufoGroup.rotation.z  = Math.sin(t * 0.8 + i) * 0.15
        for (let l = 0; l < u.lightMats.length; l++) {
          u.lightMats[l].opacity = Math.sin(t * 3 + i * 1.5 + l) * 0.35 + 0.65
        }
      }

      // ── Dust ──────────────────────────────────────────────────────────────
      for (const d of dustGroups) {
        d.rotation.y += 0.001
        d.rotation.x  = Math.sin(t * 0.2) * 0.05
      }
      for (let i = 0; i < journeyDust.length; i++) {
        journeyDust[i].rotation.y += 0.0008
        journeyDust[i].rotation.x  = Math.sin(t * 0.15 + i) * 0.04
      }

      // ── Destination markers ───────────────────────────────────────────────
      for (const m of markerMeshes) {
        m.rotation.x += 0.005
        m.rotation.y += 0.008
      }
      for (const label of markerLabels) {
        label.lookAt(camera.position)
      }

      // ── Shooting stars (desktop only) ─────────────────────────────────────
      if (!isMobile) {
        shootingStarTimer += dt
        if (shootingStarTimer >= SHOOT_INTERVAL) { shootingStarTimer = 0; spawnShootingStar() }
        for (let i = shootingStars.length - 1; i >= 0; i--) {
          const star        = shootingStars[i]
          star.progress    += dt / SHOOT_DURATION
          const p           = Math.min(star.progress, 1)
          star.mat.opacity  = Math.max(0, 1 - p * 1.2) * 0.9
          const travelDist  = p * 6
          const headPos     = star.start.clone().addScaledVector(star.direction, travelDist)
          const tailPos     = star.start.clone().addScaledVector(star.direction, Math.max(0, travelDist - 0.7))
          const posAttr     = star.geo.getAttribute('position') as THREE.BufferAttribute
          posAttr.setXYZ(0, tailPos.x, tailPos.y, tailPos.z)
          posAttr.setXYZ(1, headPos.x, headPos.y, headPos.z)
          posAttr.needsUpdate = true
          if (p >= 1) {
            scene.remove(star.line)
            star.geo.dispose(); star.mat.dispose()
            shootingStars.splice(i, 1)
          }
        }
      }

      // ── Earth, Moon & Sun ─────────────────────────────────────────────────
      earthObj.earthMesh.rotation.y += 0.0003
      earthObj.cloudMesh.rotation.y += 0.0005
      sunMesh.rotation.y            += 0.0001
      moonAngle += HUB_MOON_ORBIT_SPEED
      moonObj.mesh.position.set(
        HUB_EARTH_POS.x + Math.cos(moonAngle) * HUB_MOON_ORBIT_RADIUS,
        HUB_EARTH_POS.y + Math.sin(moonAngle * 0.2) * 8,
        HUB_EARTH_POS.z + Math.sin(moonAngle) * HUB_MOON_ORBIT_RADIUS,
      )
      moonObj.mesh.rotation.y    += 0.0002
      mercuryObj.mesh.rotation.y += 0.0008
      venusObj.mesh.rotation.y   -= 0.0001
      venusObj.atmoMesh.rotation.y -= 0.00015
      marsObj.mesh.rotation.y    += 0.0004
      jupiterObj.mesh.rotation.y += 0.001
      saturnObj.mesh.rotation.y  += 0.0009
      uranusObj.mesh.rotation.y  += 0.0003
      neptuneObj.mesh.rotation.y += 0.00035

      renderer.render(scene, camera)
    }
    animate()

    // ── Visibility pause ─────────────────────────────────────────────────────
    const onVisibilityChange = () => {
      if (document.hidden) cancelAnimationFrame(frameId)
      else { lastTime = performance.now(); animate() }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    // ── Cleanup ──────────────────────────────────────────────────────────────
    return () => {
      cancelAnimationFrame(frameId)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      ro.disconnect()
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement)
      renderer.dispose()

      skyGeo1.dispose(); skyMat1.dispose(); starsTex.dispose()
      skyGeo2.dispose(); skyMat2.dispose(); milkyTex.dispose()
      nebulaBgGeo?.dispose(); nebulaBgMat?.dispose()
      for (const m of nebulaMobileMats) m.dispose()
      nodeGeo.dispose(); lineGeo.dispose(); lineMat.dispose()
      for (const mat of nodeMats) mat.dispose()
      sharedLightGeo.dispose()
      for (const u of ufos) {
        u.saucerGeo.dispose(); u.domeGeo.dispose(); u.rimGeo.dispose()
        u.saucerMat.dispose(); u.domeMat.dispose(); u.rimMat.dispose()
        for (const lm of u.lightMats) lm.dispose()
      }
      for (const g of dustGeos) g.dispose()
      for (const m of dustMats) m.dispose()
      for (const g of journeyDustGeos) g.dispose()
      for (const m of journeyDustMats) m.dispose()
      for (const s of shootingStars) { s.geo.dispose(); s.mat.dispose() }
      for (const g of markerGeos) g.dispose()
      for (const g of markerEdgeGeos) g.dispose()
      for (const m of markerLineMats) m.dispose()
      for (const g of markerGlowGeos) g.dispose()
      for (const m of markerGlowMats) m.dispose()
      sharedLabelGeo.dispose()
      for (const m of markerLabelMats) m.dispose()
      for (const tx of markerTextures) tx.dispose()
      earthObj.dispose()
      moonObj.dispose()
      mercuryObj.dispose()
      venusObj.dispose()
      marsObj.dispose()
      jupiterObj.dispose()
      saturnObj.dispose()
      uranusObj.dispose()
      neptuneObj.dispose()
      sunGeo.dispose(); sunMat.dispose(); sunTex.dispose()
      sunGlowGeo.dispose(); sunGlowMat.dispose()
    }
  }, [cameraStateRef])

  return (
    <>
      <div
        ref={containerRef}
        style={{ position: 'fixed', inset: 0, width: '100%', height: '100vh', zIndex: 0 }}
      />
      <LoadingScreen progress={loadProgress} done={loadDone} />
    </>
  )
}
