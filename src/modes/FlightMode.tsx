import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useFlightControls } from '../hooks/useFlightControls'
import { useUFOPhysics }     from '../hooks/useUFOPhysics'
import FlightHUD             from '../components/FlightHUD'
import type { PlanetDot }    from '../components/FlightHUD'

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
  { name: 'ABOUT',    pos: [-12,  2,  0], color: 0x7721B1, shape: 'icosahedron',  size: 3.0 },
  { name: 'SKILLS',   pos: [ 12, -1,  0], color: 0x3B8BD4, shape: 'octahedron',   size: 2.5 },
  { name: 'PROJECTS', pos: [  0, 10,  0], color: 0x22c55e, shape: 'dodecahedron', size: 3.2 },
  { name: 'CONTACT',  pos: [  0,-10,  0], color: 0xD7E2EA, shape: 'torusknot',    size: 2.0 },
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

interface FlightModeProps {
  onExit: () => void
}

export default function FlightMode({ onExit }: FlightModeProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const onExitRef    = useRef(onExit)
  useEffect(() => { onExitRef.current = onExit }, [onExit])

  const inputRef               = useFlightControls()
  const { ufoStateRef, update } = useUFOPhysics(inputRef)

  const [speed,         setSpeed]         = useState(0)
  const [isBoosting,    setIsBoosting]    = useState(false)
  const [nearestPlanet, setNearestPlanet] = useState<{ name: string; distance: number } | null>(null)
  const [ufoXY,         setUfoXY]         = useState({ x: 0, y: 0 })
  const [fps,           setFps]           = useState(0)

  const isMobile = window.innerWidth < 768

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

    // ── Scene / Camera / Renderer ──────────────────────────────────────────
    const scene    = new THREE.Scene()
    const camera   = new THREE.PerspectiveCamera(65, container.clientWidth / container.clientHeight, 0.1, 200)
    const renderer = new THREE.WebGLRenderer({ antialias: !isMobile })
    renderer.setSize(container.clientWidth, container.clientHeight)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1.5 : 2))
    renderer.setClearColor(0x0c0c0c, 1)
    container.appendChild(renderer.domElement)

    camera.position.set(0, 0, 18)
    camera.lookAt(0, 0, 0)

    // ── Lights (for UFO shading) ───────────────────────────────────────────
    scene.add(new THREE.AmbientLight(0x112233, 1.5))
    const sunLight = new THREE.PointLight(0xffffff, 2.0, 80)
    sunLight.position.set(20, 10, 5)
    scene.add(sunLight)
    const rimLight = new THREE.PointLight(0x7721b1, 0.8, 50)
    rimLight.position.set(-15, -5, -10)
    scene.add(rimLight)

    // ── 1. Main star field ─────────────────────────────────────────────────
    const starCount = isMobile ? 150 : 600
    const starVerts: number[] = []
    for (let i = 0; i < starCount; i++) {
      const theta = Math.random() * Math.PI * 2
      const phi   = Math.acos(2 * Math.random() - 1)
      const r     = 40 + Math.random() * 40
      starVerts.push(r * Math.sin(phi) * Math.cos(theta), r * Math.sin(phi) * Math.sin(theta), r * Math.cos(phi))
    }
    const starGeo = new THREE.BufferGeometry()
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starVerts, 3))
    const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.018, transparent: true, opacity: 0.8, sizeAttenuation: true })
    const stars   = new THREE.Points(starGeo, starMat)
    scene.add(stars)

    // ── 2. Deep space stars ────────────────────────────────────────────────
    const deepCount = isMobile ? 100 : 400
    const deepVerts: number[] = []
    for (let i = 0; i < deepCount; i++) {
      const theta  = Math.random() * Math.PI * 2
      const phi    = Math.acos(2 * Math.random() - 1)
      const r      = 30 + Math.random() * 30
      const zShift = -(10 + Math.random() * 40)
      deepVerts.push(r * Math.sin(phi) * Math.cos(theta), r * Math.sin(phi) * Math.sin(theta), r * Math.cos(phi) + zShift)
    }
    const deepStarGeo = new THREE.BufferGeometry()
    deepStarGeo.setAttribute('position', new THREE.Float32BufferAttribute(deepVerts, 3))
    const deepStarMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.018, transparent: true, opacity: 0.6, sizeAttenuation: true })
    const deepStars   = new THREE.Points(deepStarGeo, deepStarMat)
    scene.add(deepStars)

    // ── 3. Nebula planes ───────────────────────────────────────────────────
    const nebulaGeo     = new THREE.PlaneGeometry(25, 25)
    const nebulaConfigs = [
      { color: 0x2a0a4a, opacity: 0.06, z:  -8.0, ry:  0.3 },
      { color: 0x0a1a3a, opacity: 0.05, z: -20.0, ry: -0.5 },
      { color: 0x1a0a2e, opacity: 0.07, z: -35.0, ry:  0.8 },
    ]
    const nebulaPlanes: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial }[] = []
    for (const nc of nebulaConfigs) {
      const mat  = new THREE.MeshBasicMaterial({ color: nc.color, transparent: true, opacity: nc.opacity, side: THREE.DoubleSide, depthWrite: false })
      const mesh = new THREE.Mesh(nebulaGeo, mat)
      mesh.position.z = nc.z
      mesh.rotation.y = nc.ry
      mesh.rotation.z = Math.random() * Math.PI
      scene.add(mesh)
      nebulaPlanes.push({ mesh, mat })
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
    const destGroups:    THREE.Group[]          = []
    const destOriginalY: number[]               = []
    const destLabels:    THREE.Mesh[]           = []
    const destAllGeos:   THREE.BufferGeometry[] = []
    const destAllMats:   THREE.Material[]       = []
    const destTextures:  THREE.CanvasTexture[]  = []
    const destLabelGeo   = new THREE.PlaneGeometry(4, 1.0)

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
      const pLight = new THREE.PointLight(cfg.color, 0.5, 10)
      pLight.position.set(...cfg.pos)
      scene.add(pLight)

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

    // ── 11. Boundary sphere ────────────────────────────────────────────────
    const boundGeo = new THREE.SphereGeometry(30, 16, 12)
    const boundMat = new THREE.MeshBasicMaterial({ color: 0x7721b1, wireframe: true, transparent: true, opacity: 0.02 })
    scene.add(new THREE.Mesh(boundGeo, boundMat))

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

      const state  = ufoStateRef.current
      const ufoPos = state.position
      const ufoRot = state.rotation

      // ── Universe animations (match SpaceCanvas exactly) ────────────────
      stars.rotation.y     += 0.00008
      stars.rotation.x     += 0.00004
      deepStars.rotation.y += 0.00006

      for (const { mesh } of nebulaPlanes) mesh.rotation.z += 0.0003

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
      if (trailPos && trailGeo && trailMat) {
        for (let i = TRAIL_COUNT - 1; i > 0; i--) {
          trailPos[i*3]   = trailPos[(i-1)*3]
          trailPos[i*3+1] = trailPos[(i-1)*3+1]
          trailPos[i*3+2] = trailPos[(i-1)*3+2]
        }
        trailPos[0] = ufoPos.x; trailPos[1] = ufoPos.y; trailPos[2] = ufoPos.z
        trailGeo.attributes.position.needsUpdate = true
        trailMat.opacity = entryDone ? 0.6 : 0
      }

      // ── Destination animations ─────────────────────────────────────────
      for (let i = 0; i < destGroups.length; i++) {
        const g = destGroups[i]
        g.rotation.x += 0.005
        g.rotation.y += 0.008
        g.rotation.z += 0.003
        g.position.y = destOriginalY[i] + Math.sin(t * 0.5 + i) * 0.2
        g.scale.setScalar(1 + Math.sin(t * 0.8 + i) * 0.03)
        destLabels[i].position.y = g.position.y + DESTINATIONS[i].size + 1.5
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
        const topSpeed = inputRef.current.boost ? 0.8 : 0.4
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
          onExitRef.current()
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

      starGeo.dispose();     starMat.dispose()
      deepStarGeo.dispose(); deepStarMat.dispose()
      nebulaGeo.dispose()
      for (const { mat } of nebulaPlanes) mat.dispose()
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

      boundGeo.dispose(); boundMat.dispose()

      renderer.dispose()
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement)
    }
  }, []) // intentional: all refs are stable; isMobile is constant per mount

  return (
    <div ref={containerRef} style={{ position: 'fixed', inset: 0, width: '100vw', height: '100vh' }}>
      <FlightHUD
        speed={speed}
        isBoosting={isBoosting}
        nearestPlanet={nearestPlanet}
        ufoX={ufoXY.x}
        ufoY={ufoXY.y}
        planetDots={planetDots}
        onExit={onExit}
        inputRef={inputRef}
      />
      {import.meta.env.DEV && fps > 0 && (
        <div style={{
          position: 'fixed', top: '1rem', left: '50%', transform: 'translateX(-50%)',
          color: 'rgba(215,226,234,0.35)', fontSize: '0.65rem', zIndex: 30, pointerEvents: 'none',
        }}>
          {fps} FPS
        </div>
      )}
    </div>
  )
}
