import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader }  from 'three/addons/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import { useFlightControls } from '../hooks/useFlightControls'
import { useUFOPhysics }     from '../hooks/useUFOPhysics'
import { AsteroidField, MAIN_BELT_CONFIG } from '../systems/AsteroidField'
import FlightHUD             from '../components/FlightHUD'
import type { PlanetDot }    from '../components/FlightHUD'
import LoadingScreen         from '../components/LoadingScreen'
import AboutOverlay          from '../overlays/AboutOverlay'
import SkillsOverlay         from '../overlays/SkillsOverlay'
import ProjectsOverlay       from '../overlays/ProjectsOverlay'
import ContactOverlay        from '../overlays/ContactOverlay'
import type { Zone as NavZone } from '../hooks/useCameraNavigation'

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

// ── Earth / Moon / ISS constants ──────────────────────────────────────────
const EARTH_RADIUS       = 10
const EARTH_POS          = new THREE.Vector3(0, 0, 0)
const EARTH_BUFFER       = 12
const MOON_RADIUS        = 3
const MOON_ORBIT_RADIUS  = 30
const MOON_ORBIT_SPEED   = 0.003
const ISS_ORBIT_RADIUS   = 22
const ISS_ORBIT_SPEED    = 0.0008
const ISS_SCALE          = 0.1
const JWST_ORBIT_RADIUS  = 30
const JWST_ORBIT_SPEED   = 0.0003
const JWST_SCALE         = 0.08
const ASTRONAUT_ORBIT_RADIUS = 22
const ASTRONAUT_SPEED        = 0.0006
const ASTRONAUT_SCALE        = 0.5

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

// Earth textures: bobbyroe/threejs-earth (MIT)
function createEarth(loader: THREE.TextureLoader, isMobile: boolean): {
  group:     THREE.Group
  earthMesh: THREE.Mesh
  cloudMesh: THREE.Mesh
  dispose:   () => void
} {
  const group = new THREE.Group()
  const INNER_SEGS = isMobile ? 32 : 64

  const base      = import.meta.env.BASE_URL
  const dayTex    = loader.load(base + 'earth/earth-day.jpg')
  const nightTex  = loader.load(base + 'earth/earth-night.jpg')
  const cloudTex  = loader.load(base + 'earth/earth-clouds.jpg')

  dayTex.colorSpace   = THREE.SRGBColorSpace
  nightTex.colorSpace = THREE.SRGBColorSpace
  cloudTex.colorSpace = THREE.SRGBColorSpace

  const earthGeo = new THREE.SphereGeometry(EARTH_RADIUS, INNER_SEGS, INNER_SEGS)
  const earthMat = new THREE.MeshPhongMaterial({
    map:               dayTex,
    emissiveMap:       nightTex,
    emissive:          new THREE.Color(0xffffff),
    emissiveIntensity: 0.6,
    shininess:         10,
    side:              THREE.FrontSide,
    depthWrite:        true,
  })
  const earthMesh = new THREE.Mesh(earthGeo, earthMat)
  group.add(earthMesh)

  const cloudGeo = new THREE.SphereGeometry(EARTH_RADIUS + 0.5, INNER_SEGS, INNER_SEGS)
  const cloudMat = new THREE.MeshPhongMaterial({
    map:         cloudTex,
    transparent: true,
    opacity:     0.35,
    depthWrite:  false,
    side:        THREE.DoubleSide,
  })
  const cloudMesh = new THREE.Mesh(cloudGeo, cloudMat)
  group.add(cloudMesh)

  const atmoGeo = new THREE.SphereGeometry(EARTH_RADIUS + 1, INNER_SEGS, INNER_SEGS)
  const atmoMat = new THREE.ShaderMaterial({
    vertexShader: `
      varying vec3 vNormal;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      varying vec3 vNormal;
      void main() {
        float intensity = pow(0.65 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 3.0);
        gl_FragColor = vec4(0.3, 0.6, 1.0, 1.0) * intensity;
      }`,
    side:        THREE.BackSide,
    blending:    THREE.AdditiveBlending,
    transparent: true,
    depthWrite:  false,
  })
  group.add(new THREE.Mesh(atmoGeo, atmoMat))

  group.position.copy(EARTH_POS)
  group.rotation.z = 0.4101

  return {
    group,
    earthMesh,
    cloudMesh,
    dispose: () => {
      earthGeo.dispose(); earthMat.dispose()
      cloudGeo.dispose(); cloudMat.dispose()
      atmoGeo.dispose();  atmoMat.dispose()
      dayTex.dispose();   nightTex.dispose();  cloudTex.dispose()
    },
  }
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

function createMercury(loader: THREE.TextureLoader, isMobile: boolean): { group: THREE.Group; mesh: THREE.Mesh; dispose: () => void } {
  const base       = import.meta.env.BASE_URL
  const mercuryTex = loader.load(base + 'earth/8k_mercury.jpg')
  mercuryTex.colorSpace = THREE.SRGBColorSpace
  const group      = new THREE.Group()
  const INNER_SEGS = isMobile ? 32 : 64
  const mercuryGeo = new THREE.SphereGeometry(4, INNER_SEGS, INNER_SEGS)
  const mercuryMat = new THREE.MeshPhongMaterial({ map: mercuryTex, shininess: 5, side: THREE.FrontSide })
  const mesh       = new THREE.Mesh(mercuryGeo, mercuryMat)
  group.add(mesh)
  group.rotation.z = 0.034
  return { group, mesh, dispose: () => { mercuryGeo.dispose(); mercuryMat.dispose(); mercuryTex.dispose() } }
}

function createVenus(loader: THREE.TextureLoader, isMobile: boolean): { group: THREE.Group; mesh: THREE.Mesh; atmoMesh: THREE.Mesh; dispose: () => void } {
  const base     = import.meta.env.BASE_URL
  const venusTex = loader.load(base + 'earth/8k_venus_surface.jpg')
  const atmoTex  = loader.load(base + 'earth/4k_venus_atmosphere.jpg')
  venusTex.colorSpace = THREE.SRGBColorSpace
  atmoTex.colorSpace  = THREE.SRGBColorSpace
  const group    = new THREE.Group()
  const INNER_SEGS = isMobile ? 32 : 64
  const venusGeo = new THREE.SphereGeometry(9, INNER_SEGS, INNER_SEGS)
  const venusMat = new THREE.MeshPhongMaterial({ map: venusTex, shininess: 8, side: THREE.FrontSide })
  const mesh     = new THREE.Mesh(venusGeo, venusMat)
  group.add(mesh)
  const atmoGeo  = new THREE.SphereGeometry(9.8, INNER_SEGS, INNER_SEGS)
  const atmoMat  = new THREE.MeshPhongMaterial({ map: atmoTex, shininess: 3, side: THREE.DoubleSide, transparent: true, opacity: 0.7, depthWrite: false })
  const atmoMesh = new THREE.Mesh(atmoGeo, atmoMat)
  group.add(atmoMesh)
  group.rotation.z = 3.096
  return { group, mesh, atmoMesh, dispose: () => { venusGeo.dispose(); venusMat.dispose(); atmoGeo.dispose(); atmoMat.dispose(); venusTex.dispose(); atmoTex.dispose() } }
}

function createMars(loader: THREE.TextureLoader, isMobile: boolean): { group: THREE.Group; mesh: THREE.Mesh; dispose: () => void } {
  const base    = import.meta.env.BASE_URL
  const marsTex = loader.load(base + 'earth/8k_mars.jpg')
  marsTex.colorSpace = THREE.SRGBColorSpace
  const group   = new THREE.Group()
  const INNER_SEGS = isMobile ? 32 : 64
  const marsGeo = new THREE.SphereGeometry(7, INNER_SEGS, INNER_SEGS)
  const marsMat = new THREE.MeshPhongMaterial({ map: marsTex, shininess: 5, side: THREE.FrontSide })
  const mesh    = new THREE.Mesh(marsGeo, marsMat)
  group.add(mesh)
  group.rotation.z = 0.4396
  return { group, mesh, dispose: () => { marsGeo.dispose(); marsMat.dispose(); marsTex.dispose() } }
}

function createJupiter(loader: THREE.TextureLoader, isMobile: boolean): { group: THREE.Group; mesh: THREE.Mesh; dispose: () => void } {
  const base       = import.meta.env.BASE_URL
  const jupiterTex = loader.load(base + 'earth/8k_jupiter.jpg')
  jupiterTex.colorSpace = THREE.SRGBColorSpace
  const group      = new THREE.Group()
  const OUTER_SEGS = isMobile ? 16 : 32
  const jupiterGeo = new THREE.SphereGeometry(110, OUTER_SEGS, OUTER_SEGS)
  const jupiterMat = new THREE.MeshPhongMaterial({ map: jupiterTex, shininess: 10, side: THREE.FrontSide })
  const mesh       = new THREE.Mesh(jupiterGeo, jupiterMat)
  group.add(mesh)
  group.rotation.z = 0.0546
  return { group, mesh, dispose: () => { jupiterGeo.dispose(); jupiterMat.dispose(); jupiterTex.dispose() } }
}

function createSaturn(loader: THREE.TextureLoader, isMobile: boolean): { group: THREE.Group; mesh: THREE.Mesh; dispose: () => void } {
  const base      = import.meta.env.BASE_URL
  const saturnTex = loader.load(base + 'earth/8k_saturn.jpg')
  const ringTex   = loader.load(base + 'earth/8k_saturn_ring_alpha.png')
  saturnTex.colorSpace = THREE.SRGBColorSpace
  ringTex.colorSpace   = THREE.SRGBColorSpace
  const group     = new THREE.Group()
  const OUTER_SEGS = isMobile ? 16 : 32
  const RING_SEGS  = isMobile ? 64 : 128
  const saturnGeo = new THREE.SphereGeometry(90, OUTER_SEGS, OUTER_SEGS)
  const saturnMat = new THREE.MeshPhongMaterial({ map: saturnTex, shininess: 10, side: THREE.FrontSide })
  const mesh      = new THREE.Mesh(saturnGeo, saturnMat)
  group.add(mesh)
  const ringInner = 117, ringOuter = 216
  const ringGeo   = new THREE.RingGeometry(ringInner, ringOuter, RING_SEGS)
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

function createUranus(loader: THREE.TextureLoader, isMobile: boolean): { group: THREE.Group; mesh: THREE.Mesh; dispose: () => void } {
  const base      = import.meta.env.BASE_URL
  const uranusTex = loader.load(base + 'earth/2k_uranus.jpg')
  uranusTex.colorSpace = THREE.SRGBColorSpace
  const group     = new THREE.Group()
  const OUTER_SEGS = isMobile ? 16 : 32
  const uranusGeo = new THREE.SphereGeometry(40, OUTER_SEGS, OUTER_SEGS)
  const uranusMat = new THREE.MeshPhongMaterial({ map: uranusTex, shininess: 8, side: THREE.FrontSide })
  const mesh      = new THREE.Mesh(uranusGeo, uranusMat)
  group.add(mesh)
  group.rotation.z = 1.706
  return { group, mesh, dispose: () => { uranusGeo.dispose(); uranusMat.dispose(); uranusTex.dispose() } }
}

function createNeptune(loader: THREE.TextureLoader, isMobile: boolean): { group: THREE.Group; mesh: THREE.Mesh; dispose: () => void } {
  const base       = import.meta.env.BASE_URL
  const neptuneTex = loader.load(base + 'earth/2k_neptune.jpg')
  neptuneTex.colorSpace = THREE.SRGBColorSpace
  const group      = new THREE.Group()
  const OUTER_SEGS = isMobile ? 16 : 32
  const neptuneGeo = new THREE.SphereGeometry(38, OUTER_SEGS, OUTER_SEGS)
  const neptuneMat = new THREE.MeshPhongMaterial({ map: neptuneTex, shininess: 8, side: THREE.FrontSide })
  const mesh       = new THREE.Mesh(neptuneGeo, neptuneMat)
  group.add(mesh)
  group.rotation.z = 0.4942
  return { group, mesh, dispose: () => { neptuneGeo.dispose(); neptuneMat.dispose(); neptuneTex.dispose() } }
}

function createISS(): Promise<{ group: THREE.Group; dispose: () => void }> {
  return new Promise((resolve, reject) => {
    const base        = import.meta.env.BASE_URL
    const dracoLoader = new DRACOLoader()
    dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/')
    const loader = new GLTFLoader()
    loader.setDRACOLoader(dracoLoader)
    loader.load(
      base + 'models/iss.glb',
      (gltf) => {
        console.log('✅ ISS loaded successfully', gltf.scene)
        const group = gltf.scene
        group.scale.setScalar(ISS_SCALE)
        group.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            const mesh = child as THREE.Mesh
            mesh.castShadow    = false
            mesh.receiveShadow = false
          }
        })
        dracoLoader.dispose()
        resolve({
          group,
          dispose: () => {
            group.traverse((child) => {
              if ((child as THREE.Mesh).isMesh) {
                const mesh = child as THREE.Mesh
                mesh.geometry?.dispose()
                if (Array.isArray(mesh.material)) {
                  mesh.material.forEach(m => m.dispose())
                } else {
                  mesh.material?.dispose()
                }
              }
            })
          },
        })
      },
      (progress) => { console.log('ISS loading:', progress.loaded, '/', progress.total) },
      (error)    => { console.error('❌ ISS failed to load', error); reject(error) },
    )
  })
}

function createJWST(): Promise<{ group: THREE.Group; dispose: () => void }> {
  return new Promise((resolve, reject) => {
    const base        = import.meta.env.BASE_URL
    const dracoLoader = new DRACOLoader()
    dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/')
    const loader = new GLTFLoader()
    loader.setDRACOLoader(dracoLoader)
    loader.load(
      base + 'models/jwst.glb',
      (gltf) => {
        console.log('✅ JWST loaded successfully', gltf.scene)
        const group = gltf.scene
        group.scale.setScalar(JWST_SCALE)
        group.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            const mesh = child as THREE.Mesh
            mesh.castShadow    = false
            mesh.receiveShadow = false
          }
        })
        dracoLoader.dispose()
        resolve({
          group,
          dispose: () => {
            group.traverse((child) => {
              if ((child as THREE.Mesh).isMesh) {
                const mesh = child as THREE.Mesh
                mesh.geometry?.dispose()
                if (Array.isArray(mesh.material)) {
                  mesh.material.forEach(m => m.dispose())
                } else {
                  mesh.material?.dispose()
                }
              }
            })
          },
        })
      },
      (progress) => { console.log('JWST loading:', progress.loaded, '/', progress.total) },
      (error)    => { console.error('❌ JWST failed to load', error); reject(error) },
    )
  })
}

function createAstronaut(): Promise<{ group: THREE.Group; dispose: () => void }> {
  return new Promise((resolve, reject) => {
    const base        = import.meta.env.BASE_URL
    const dracoLoader = new DRACOLoader()
    dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/')
    const loader = new GLTFLoader()
    loader.setDRACOLoader(dracoLoader)
    loader.load(
      base + 'models/astronaut-compressed.glb',
      (gltf) => {
        console.log('✅ Astronaut loaded')
        const group = gltf.scene
        group.scale.setScalar(ASTRONAUT_SCALE)
        group.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            const mesh = child as THREE.Mesh
            mesh.castShadow    = false
            mesh.receiveShadow = false
            const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
            mats.forEach(m => {
              if (m) {
                m.side = THREE.DoubleSide
                if ((m as THREE.MeshStandardMaterial).color) {
                  (m as THREE.MeshStandardMaterial).color.set(0xcccccc)
                }
                m.needsUpdate = true
              }
            })
          }
        })
        dracoLoader.dispose()
        resolve({
          group,
          dispose: () => {
            group.traverse((child) => {
              if ((child as THREE.Mesh).isMesh) {
                const mesh = child as THREE.Mesh
                mesh.geometry?.dispose()
                if (Array.isArray(mesh.material)) {
                  mesh.material.forEach(m => m.dispose())
                } else {
                  mesh.material?.dispose()
                }
              }
            })
          },
        })
      },
      undefined,
      (error) => { console.error('❌ Astronaut failed to load', error); reject(error) },
    )
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

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const loadingManager = new THREE.LoadingManager(
      () => setLoadDone(true),
      (_url, loaded, total) => setLoadProgress((loaded / total) * 100),
    )
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
    const skyLoader = new THREE.TextureLoader()

    const SKY_SEGS = isMobile ? 16 : 32

    const milkyTex  = skyLoader.load(base + 'stars/8k_stars_milky_way.jpg')
    milkyTex.colorSpace = THREE.SRGBColorSpace
    const milkyGeo  = new THREE.SphereGeometry(10000, SKY_SEGS, SKY_SEGS)
    const milkyMat  = new THREE.MeshBasicMaterial({ map: milkyTex, side: THREE.BackSide, transparent: true, opacity: 0.9 })
    const milkyMesh = new THREE.Mesh(milkyGeo, milkyMat)
    scene.add(milkyMesh)

    const hippTex  = skyLoader.load(base + 'stars/hipp8.jpg')
    const hippGeo  = new THREE.SphereGeometry(11000, SKY_SEGS, SKY_SEGS)
    const hippMat  = new THREE.MeshBasicMaterial({ map: hippTex, side: THREE.BackSide, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false })
    const hippMesh = new THREE.Mesh(hippGeo, hippMat)
    if (!isMobile) {
      scene.add(hippMesh)
    }

    const tychoTex  = skyLoader.load(base + 'stars/tycho8.jpg')
    const tychoGeo  = new THREE.SphereGeometry(12000, SKY_SEGS, SKY_SEGS)
    const tychoMat  = new THREE.MeshBasicMaterial({ map: tychoTex, side: THREE.BackSide, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false })
    const tychoMesh = new THREE.Mesh(tychoGeo, tychoMat)
    scene.add(tychoMesh)

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
    const earthObj = createEarth(sharedLoader, isMobile)
    scene.add(earthObj.group)

    const moonObj = createMoon(sharedLoader, isMobile)
    scene.add(moonObj.mesh)
    let moonAngle = 0

    let issGroup:   THREE.Group | null = null
    let issAngle    = 0
    let issDispose: (() => void) | null = null
    createISS().then(({ group, dispose }) => {
      issGroup   = group
      issDispose = dispose
      scene.add(issGroup)
    })

    let jwstGroup:   THREE.Group | null = null
    let jwstAngle    = 0
    let jwstDispose: (() => void) | null = null
    if (!isMobile) {
      setTimeout(() => {
        createJWST().then(({ group, dispose }) => {
          jwstGroup   = group
          jwstDispose = dispose
          scene.add(jwstGroup)
        })
      }, 3000)
    }

    let astronautGroup:   THREE.Group | null = null
    let astronautAngle    = Math.PI * 0.3
    let astronautDispose: (() => void) | null = null
    setTimeout(() => {
      createAstronaut().then(({ group, dispose }) => {
        astronautGroup   = group
        astronautDispose = dispose
        scene.add(astronautGroup)
        const astronautLight = new THREE.PointLight(0xffffff, 0.3, 50)
        astronautGroup.userData.light = astronautLight
        scene.add(astronautLight)
      })
    }, 2000)

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
    let hudFrame     = 0
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

      // DEV FPS
      if (import.meta.env.DEV) {
        fpsCount++
        if (now - fpsLast >= 1000) { setFps(fpsCount); fpsCount = 0; fpsLast = now }
      }

      // Physics
      update()

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
      for (const mesh of nebulaPlanes) mesh.rotation.z += 0.0003
      milkyMesh.rotation.y += 0.00002
      if (!isMobile) hippMesh.rotation.y += 0.000015
      tychoMesh.rotation.y += 0.00001

      nodeGroup.rotation.y += 0.003
      nodeGroup.rotation.x  = Math.sin(t * 0.3) * 0.12
      nodeGroup.scale.setScalar(1 + Math.sin(t * 0.5) * 0.03)

      for (const d of dustGroups) {
        d.rotation.y += 0.001
        d.rotation.x  = Math.sin(t * 0.2) * 0.05
      }
      for (let i = 0; i < journeyDust.length; i++) {
        journeyDust[i].rotation.y += 0.0008
        journeyDust[i].rotation.x  = Math.sin(t * 0.15 + i) * 0.04
      }

      // Earth rotation
      earthObj.earthMesh.rotation.y += 0.0003
      earthObj.cloudMesh.rotation.y += 0.0005
      sunMesh.rotation.y            += 0.0001
      moonAngle += MOON_ORBIT_SPEED
      moonObj.mesh.position.set(
        EARTH_POS.x + Math.cos(moonAngle) * MOON_ORBIT_RADIUS,
        EARTH_POS.y + Math.sin(moonAngle * 0.2) * 8,
        EARTH_POS.z + Math.sin(moonAngle) * MOON_ORBIT_RADIUS,
      )
      moonObj.mesh.rotation.y    += 0.0002
      if (issGroup) {
        issAngle += ISS_ORBIT_SPEED
        issGroup.position.set(
          earthObj.group.position.x + Math.cos(issAngle) * ISS_ORBIT_RADIUS,
          earthObj.group.position.y + Math.sin(issAngle * 0.3) * 3,
          earthObj.group.position.z + Math.sin(issAngle) * ISS_ORBIT_RADIUS,
        )
        issGroup.rotation.y = -issAngle + Math.PI / 2
      }
      if (jwstGroup) {
        jwstAngle += JWST_ORBIT_SPEED
        jwstGroup.position.set(
          earthObj.group.position.x + Math.cos(jwstAngle + Math.PI) * JWST_ORBIT_RADIUS,
          earthObj.group.position.y + Math.sin(jwstAngle * 0.2) * 4,
          earthObj.group.position.z + Math.sin(jwstAngle + Math.PI) * JWST_ORBIT_RADIUS,
        )
        jwstGroup.rotation.y = -jwstAngle + Math.PI / 2
      }
      if (astronautGroup) {
        astronautAngle += ASTRONAUT_SPEED
        astronautGroup.position.set(
          earthObj.group.position.x + Math.cos(astronautAngle) * ASTRONAUT_ORBIT_RADIUS,
          earthObj.group.position.y + Math.sin(astronautAngle * 0.5) * 5,
          earthObj.group.position.z + Math.sin(astronautAngle) * ASTRONAUT_ORBIT_RADIUS,
        )
        astronautGroup.rotation.x += 0.001
        astronautGroup.rotation.y += 0.0008
        astronautGroup.rotation.z += 0.0005
        if (astronautGroup.userData.light) {
          (astronautGroup.userData.light as THREE.PointLight).position.copy(astronautGroup.position)
        }
      }
      mercuryObj.mesh.rotation.y += 0.0008
      venusObj.mesh.rotation.y   -= 0.0001
      venusObj.atmoMesh.rotation.y -= 0.00015
      marsObj.mesh.rotation.y    += 0.0004
      jupiterObj.mesh.rotation.y += 0.001
      saturnObj.mesh.rotation.y  += 0.0009
      uranusObj.mesh.rotation.y  += 0.0003
      neptuneObj.mesh.rotation.y += 0.00035
      asteroidBelt.update()

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

      // Trail
      const boostOn = inputRef.current.boost
      if (trailPos && trailGeo && trailMat) {
        for (let i = TRAIL_COUNT - 1; i > 0; i--) {
          trailPos[i*3]   = trailPos[(i-1)*3]
          trailPos[i*3+1] = trailPos[(i-1)*3+1]
          trailPos[i*3+2] = trailPos[(i-1)*3+2]
        }
        trailPos[0] = ufoPos.x; trailPos[1] = ufoPos.y; trailPos[2] = ufoPos.z
        trailGeo.attributes.position.needsUpdate = true
        trailMat.opacity = entryDone ? (boostOn ? 0.15 : 0.55) : 0
      }
      if (boostTrailPos && boostTrailGeo && boostTrailMat) {
        for (let i = BOOST_TRAIL_COUNT - 1; i > 0; i--) {
          boostTrailPos[i*3]   = boostTrailPos[(i-1)*3]
          boostTrailPos[i*3+1] = boostTrailPos[(i-1)*3+1]
          boostTrailPos[i*3+2] = boostTrailPos[(i-1)*3+2]
        }
        boostTrailPos[0] = ufoPos.x; boostTrailPos[1] = ufoPos.y; boostTrailPos[2] = ufoPos.z
        boostTrailGeo.attributes.position.needsUpdate = true
        const targetOp = entryDone && boostOn ? 0.85 : 0
        boostTrailMat.opacity += (targetOp - boostTrailMat.opacity) * 0.08
      }

      // ── Destination animations ─────────────────────────────────────────
      for (let i = 0; i < destGroups.length; i++) {
        const g = destGroups[i]
        g.rotation.x += 0.005
        g.rotation.y += 0.008
        g.rotation.z += 0.003
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
        camera.position.lerp(camFollowPos, 0.1)
        camLookAt.set(0, 0, -2).applyEuler(ufoRot).add(ufoPos)
        camera.lookAt(camLookAt)
      }

      // ── HUD at ~10 fps ─────────────────────────────────────────────────
      hudFrame++
      if (hudFrame % 6 === 0) {
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

    const onResize = () => {
      const w = container.clientWidth, h = container.clientHeight
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
    }
    window.addEventListener('resize', onResize)

    return () => {
      cancelAnimationFrame(rafId)
      window.removeEventListener('resize', onResize)

      for (const g of destAllGeos) g.dispose()
      for (const m of destAllMats) m.dispose()
      destLabelGeo.dispose()
      for (const tx of destTextures) tx.dispose()
      for (const g of destGlowGeos) g.dispose()
      for (const m of destGlowMats) m.dispose()

      milkyGeo.dispose();  milkyMat.dispose();  milkyTex.dispose()
      hippGeo.dispose();   hippMat.dispose();   hippTex.dispose()
      tychoGeo.dispose();  tychoMat.dispose();  tychoTex.dispose()
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
  }, []) // intentional: all refs are stable; isMobile is constant per mount

  const nearestIsBlackHole = nearestPlanet?.name === 'M87*'

  return (
    <div ref={containerRef} style={{ position: 'fixed', inset: 0, width: '100vw', height: '100vh' }}>
      <LoadingScreen progress={loadProgress} done={loadDone} />
      <FlightHUD
        speed={speed}
        isBoosting={isBoosting}
        nearestPlanet={nearestIsBlackHole ? null : nearestPlanet}
        ufoX={ufoXY.x}
        ufoY={ufoXY.y}
        planetDots={planetDots}
        onExit={onExit}
        inputRef={inputRef}
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
