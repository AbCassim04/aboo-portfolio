import * as THREE from 'three'
import type { FloatingOrigin } from '../space/floatingOrigin'
import { MARKER_KM_PER_UNIT, ZONE_PLACEMENT, zoneViewPoint } from '../space/portfolioZone'
import type { ZoneFrame } from '../space/portfolioZone'

// ── Portfolio destinations (wireframe markers + labels + glow) ──────────────
// Same look as before, scaled by MARKER_KM_PER_UNIT and placed in the
// portfolio zone (see space/portfolioZone.ts). World positions are float64;
// the floating origin derives their render positions.

export interface Destination {
  name:  string
  color: number
  shape: string
  size:  number   // old scene units (× MARKER_KM_PER_UNIT km)
}

export const DESTINATIONS: Destination[] = [
  { name: 'ABOUT',    color: 0x7721B1, shape: 'icosahedron',  size: 1.2 },
  { name: 'SKILLS',   color: 0x3B8BD4, shape: 'octahedron',   size: 1.0 },
  { name: 'PROJECTS', color: 0x22c55e, shape: 'dodecahedron', size: 1.3 },
  { name: 'CONTACT',  color: 0xD7E2EA, shape: 'torusknot',    size: 0.8 },
  { name: 'M87*',     color: 0x1a0030, shape: 'torusknot',    size: 0.6 },
]

/** Landing / approach radius around a destination (km); 6 old units before. */
export const LANDING_RADIUS_KM = 6 * MARKER_KM_PER_UNIT

// Every shader here includes the log-depth chunks (see space/depth.ts).
const GLOW_VERT = `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vNormal;
varying vec3 vViewPosition;
void main() {
  vNormal = normalize(normalMatrix * normal);
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vViewPosition = -mvPosition.xyz;
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
}`

const GLOW_FRAG = `
#include <logdepthbuf_pars_fragment>
uniform vec3 uColor;
uniform float uIntensity;
varying vec3 vNormal;
varying vec3 vViewPosition;
void main() {
  #include <logdepthbuf_fragment>
  vec3 normal  = normalize(vNormal);
  vec3 viewDir = normalize(vViewPosition);
  float fresnel = pow(1.0 - abs(dot(normal, viewDir)), 3.0);
  float glow    = fresnel * uIntensity;
  gl_FragColor  = vec4(uColor, glow * 0.6);
}`

function createGlowMaterial(color: THREE.Color, intensity = 1.2): THREE.ShaderMaterial {
  const mat = new THREE.ShaderMaterial({
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
  mat.name = 'destination-glow'
  return mat
}


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

export interface Destinations {
  /** World position (km) of each destination, in DESTINATIONS order. */
  world: THREE.Vector3[]
  /** Place everything for this frame (world space). */
  update(t: number, k: number, frame: ZoneFrame): void
  /** After the floating origin has applied: billboard the labels toward `camRender`. */
  faceCamera(camRender: THREE.Vector3): void
  dispose(): void
}

export function createDestinations(scene: THREE.Scene, origin: FloatingOrigin, isMobile: boolean): Destinations {
  const U = MARKER_KM_PER_UNIT
  const groups:     THREE.Group[]          = []
  const labels:     THREE.Mesh[]           = []
  const allGeos:    THREE.BufferGeometry[] = []
  const allMats:    THREE.Material[]       = []
  const textures:   THREE.CanvasTexture[]  = []
  const world:      THREE.Vector3[]        = []
  const labelWorld: THREE.Vector3[]        = []
  const glowWorld:  THREE.Vector3[]        = []
  const lightWorld: THREE.Vector3[]        = []
  const base:       THREE.Vector3[]        = []
  const labelGeo = new THREE.PlaneGeometry(4 * U, 1.0 * U)

  for (const cfg of DESTINATIONS) {
    const size  = cfg.size * U
    const group = new THREE.Group()
    group.name  = 'dest-' + cfg.name

    const coreGeo = createGeometry(cfg.shape, size * 0.4)
    const coreMat = new THREE.MeshBasicMaterial({ color: cfg.color, transparent: true, opacity: 0.15 })
    group.add(new THREE.Mesh(coreGeo, coreMat))
    const shellGeo = createGeometry(cfg.shape, size)
    const edgeGeo  = new THREE.EdgesGeometry(shellGeo)
    const wireMat  = new THREE.LineBasicMaterial({ color: cfg.color, transparent: true, opacity: 0.9 })
    group.add(new THREE.LineSegments(edgeGeo, wireMat))
    const auraGeo = createGeometry(cfg.shape, size * 1.1)
    const auraMat = new THREE.MeshBasicMaterial({ color: cfg.color, transparent: true, opacity: 0.05, side: THREE.BackSide })
    group.add(new THREE.Mesh(auraGeo, auraMat))
    allGeos.push(coreGeo, shellGeo, edgeGeo, auraGeo)
    allMats.push(coreMat, wireMat, auraMat)
    scene.add(group)
    groups.push(group)
    world.push(origin.track(group, new THREE.Vector3()))
    base.push(new THREE.Vector3())

    // Coloured point light for ambiance (range 10 old units).
    const pLight = new THREE.PointLight(cfg.color, 0.2, 10 * U)
    scene.add(pLight)
    lightWorld.push(origin.track(pLight, new THREE.Vector3()))

    // Fresnel glow aura (1.3× size, world-aligned, no rotation).
    const glowGeo  = createGeometry(cfg.shape, size * 1.3)
    const glowMat  = createGlowMaterial(new THREE.Color(cfg.color), isMobile ? 0.7 : 1.2)
    const glowMesh = new THREE.Mesh(glowGeo, glowMat)
    scene.add(glowMesh)
    allGeos.push(glowGeo); allMats.push(glowMat)
    glowWorld.push(origin.track(glowMesh, new THREE.Vector3()))

    // Label (scene child, billboarded toward the camera).
    const labelTex = makeDestLabel(cfg.name, cfg.color)
    const labelMat = new THREE.MeshBasicMaterial({ map: labelTex, transparent: true, depthWrite: false, side: THREE.DoubleSide })
    const label    = new THREE.Mesh(labelGeo, labelMat)
    scene.add(label)
    labels.push(label)
    allMats.push(labelMat); textures.push(labelTex)
    labelWorld.push(origin.track(label, new THREE.Vector3()))
  }

  return {
    world,
    update(t: number, k: number, frame: ZoneFrame) {
      for (let i = 0; i < DESTINATIONS.length; i++) {
        const cfg = DESTINATIONS[i]
        const p   = ZONE_PLACEMENT[cfg.name]
        zoneViewPoint(frame, p.range, p.az, p.el, base[i])
        const g = groups[i]
        g.rotation.x += 0.005 * k
        g.rotation.y += 0.008 * k
        g.rotation.z += 0.003 * k
        g.scale.setScalar(1 + Math.sin(t * 0.8 + i) * 0.03)
        // Gentle bob along the zone's "up".
        world[i].copy(base[i]).addScaledVector(frame.up, Math.sin(t * 0.5 + i) * 0.2 * U)
        glowWorld[i].copy(world[i])
        lightWorld[i].copy(base[i])
        labelWorld[i].copy(world[i]).addScaledVector(frame.up, (cfg.size + 1.5) * U)
      }
    },
    faceCamera(camRender: THREE.Vector3) {
      for (const label of labels) label.lookAt(camRender)
    },
    dispose() {
      for (const g of allGeos) g.dispose()
      for (const m of allMats) m.dispose()
      labelGeo.dispose()
      for (const tx of textures) tx.dispose()
    },
  }
}
