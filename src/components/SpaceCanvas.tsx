import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import type { CameraTransitionState } from '../hooks/useCameraNavigation'

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

  // Keep mutable refs in sync so animation loop always reads latest values
  const currentZoneRef = useRef(currentZone)
  const onCompleteRef  = useRef(onTransitionComplete)
  useEffect(() => { currentZoneRef.current = currentZone }, [currentZone])
  useEffect(() => { onCompleteRef.current  = onTransitionComplete }, [onTransitionComplete])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const isMobile = window.innerWidth < 768

    // ── Scene & Camera ─────────────────────────────────────────────────────
    const scene  = new THREE.Scene()
    const w = container.clientWidth
    const h = container.clientHeight
    const camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 500)
    camera.position.set(0, 0, 18)
    camera.lookAt(0, 0, 0)

    // ── Renderer ────────────────────────────────────────────────────────────
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1 : 2))
    renderer.setSize(w, h)
    renderer.setClearColor(0x000000, 0)
    container.appendChild(renderer.domElement)

    // ── 1. MAIN STAR FIELD ──────────────────────────────────────────────────
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

    // ── 2. DEEP SPACE STARS ─────────────────────────────────────────────────
    const deepStarCount = isMobile ? 100 : 400
    const deepStarVerts: number[] = []
    for (let i = 0; i < deepStarCount; i++) {
      const theta  = Math.random() * Math.PI * 2
      const phi    = Math.acos(2 * Math.random() - 1)
      const r      = 30 + Math.random() * 30
      const zShift = -(10 + Math.random() * 40)
      deepStarVerts.push(
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.sin(phi) * Math.sin(theta),
        r * Math.cos(phi) + zShift,
      )
    }
    const deepStarGeo = new THREE.BufferGeometry()
    deepStarGeo.setAttribute('position', new THREE.Float32BufferAttribute(deepStarVerts, 3))
    const deepStarMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.018, transparent: true, opacity: 0.6, sizeAttenuation: true })
    const deepStars   = new THREE.Points(deepStarGeo, deepStarMat)
    scene.add(deepStars)

    // ── 3. NEBULA PLANES ────────────────────────────────────────────────────
    const nebulaConfigs = [
      { color: 0x2a0a4a, opacity: 0.10, z: -1.6,  ry:  0.3 },
      { color: 0x0a1a3a, opacity: 0.08, z: -18.0, ry: -0.5 },
      { color: 0x1a0a2e, opacity: 0.12, z: -32.0, ry:  0.8 },
    ]
    const nebulaGeo    = new THREE.PlaneGeometry(isMobile ? 8 : 12, isMobile ? 8 : 12)
    const nebulaPlanes: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial }[] = []
    for (const cfg of nebulaConfigs) {
      const mat  = new THREE.MeshBasicMaterial({ color: cfg.color, transparent: true, opacity: cfg.opacity, side: THREE.DoubleSide, depthWrite: false })
      const mesh = new THREE.Mesh(nebulaGeo, mat)
      mesh.position.z = cfg.z
      mesh.rotation.y = cfg.ry
      mesh.rotation.z = Math.random() * Math.PI
      scene.add(mesh)
      nebulaPlanes.push({ mesh, mat })
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

      const texture  = createLabelTexture(cfg.name, cfg.color)
      const labelMat = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, side: THREE.DoubleSide })
      const label    = new THREE.Mesh(sharedLabelGeo, labelMat)
      label.position.set(...cfg.labelPos)
      scene.add(label)
      markerLabels.push(label)
      markerLabelMats.push(labelMat)
      markerTextures.push(texture)
    }

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

      // ── Stars ─────────────────────────────────────────────────────────────
      stars.rotation.y     += 0.00008
      stars.rotation.x     += 0.00004
      deepStars.rotation.y += 0.00006

      // ── Nebula ────────────────────────────────────────────────────────────
      for (const { mesh } of nebulaPlanes) mesh.rotation.z += 0.0003

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

      starGeo.dispose(); starMat.dispose()
      deepStarGeo.dispose(); deepStarMat.dispose()
      nebulaGeo.dispose()
      for (const { mat } of nebulaPlanes) mat.dispose()
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
      sharedLabelGeo.dispose()
      for (const m of markerLabelMats) m.dispose()
      for (const tx of markerTextures) tx.dispose()
    }
  }, [cameraStateRef])

  return (
    <div
      ref={containerRef}
      style={{ position: 'fixed', inset: 0, width: '100%', height: '100vh', zIndex: 0 }}
    />
  )
}
