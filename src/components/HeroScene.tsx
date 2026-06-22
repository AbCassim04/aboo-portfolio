import { useEffect, useRef } from 'react'
import * as THREE from 'three'

// ── Top-level desktop defaults (overridden per-device inside useEffect) ────
const NODE_COUNT_DESKTOP = 80
const SPHERE_RADIUS = 3.5
const NEAREST_K = 3
const NODE_COLORS = [0x7721b1, 0x3b8bd4, 0x7721b1, 0x3b8bd4, 0xbbccd7]

function pickNodeColor(i: number) {
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

export default function HeroScene() {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // ── Mobile detection ────────────────────────────────────────
    const isMobile = window.innerWidth < 768

    // ── Scene & Camera ──────────────────────────────────────────
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(
      60,
      container.clientWidth / container.clientHeight,
      0.1,
      500,
    )
    camera.position.z = isMobile ? 10 : 8

    // ── Renderer ────────────────────────────────────────────────
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1 : 2))
    renderer.setSize(container.clientWidth, container.clientHeight)
    renderer.setClearColor(0x000000, 0)
    container.appendChild(renderer.domElement)

    // ══════════════════════════════════════════════════════════
    // 1. STAR FIELD — 200 (mobile) / 600 (desktop)
    // ══════════════════════════════════════════════════════════
    const starCount = isMobile ? 200 : 600
    const starVerts: number[] = []
    for (let i = 0; i < starCount; i++) {
      const theta = Math.random() * Math.PI * 2
      const phi = Math.acos(2 * Math.random() - 1)
      const r = 40 + Math.random() * 40
      starVerts.push(
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.sin(phi) * Math.sin(theta),
        r * Math.cos(phi),
      )
    }
    const starGeo = new THREE.BufferGeometry()
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starVerts, 3))
    const starMat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.18,
      transparent: true,
      opacity: 0.8,
      sizeAttenuation: true,
    })
    const stars = new THREE.Points(starGeo, starMat)
    scene.add(stars)

    // ══════════════════════════════════════════════════════════
    // 2. NEBULA GLOW — 2 (mobile) / 3 (desktop)
    // ══════════════════════════════════════════════════════════
    const allNebulaConfigs = [
      { color: 0x2a0a4a, opacity: 0.10, z: -3.5, ry: 0.3 },
      { color: 0x0a1a3a, opacity: 0.08, z: -4.0, ry: -0.5 },
      { color: 0x1a0a2e, opacity: 0.12, z: -5.0, ry: 0.8 },
    ]
    const nebulaConfigs = isMobile
      ? allNebulaConfigs.slice(0, 2)
      : allNebulaConfigs
    const nebulaPlanes: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial }[] = []
    const nebulaGeo = new THREE.PlaneGeometry(10, 10)
    for (const cfg of nebulaConfigs) {
      const mat = new THREE.MeshBasicMaterial({
        color: cfg.color,
        transparent: true,
        opacity: cfg.opacity,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
      const mesh = new THREE.Mesh(nebulaGeo, mat)
      mesh.position.z = cfg.z
      mesh.rotation.y = cfg.ry
      mesh.rotation.z = Math.random() * Math.PI
      scene.add(mesh)
      nebulaPlanes.push({ mesh, mat })
    }

    // ══════════════════════════════════════════════════════════
    // 3. NEURAL NETWORK CONSTELLATION — 40 (mobile) / 80 (desktop)
    // ══════════════════════════════════════════════════════════
    const nodeCount = isMobile ? 40 : NODE_COUNT_DESKTOP
    const positions: THREE.Vector3[] = []
    const nodeGroup = new THREE.Group()
    const nodeMats: THREE.MeshBasicMaterial[] = []
    const nodeGeo = new THREE.SphereGeometry(0.04, 8, 8)

    for (let i = 0; i < nodeCount; i++) {
      const pos = randomInSphere(SPHERE_RADIUS)
      positions.push(pos)
      const mat = new THREE.MeshBasicMaterial({ color: pickNodeColor(i) })
      nodeMats.push(mat)
      const mesh = new THREE.Mesh(nodeGeo, mat)
      mesh.position.copy(pos)
      nodeGroup.add(mesh)
    }

    const lineVerts: number[] = []
    for (let i = 0; i < nodeCount; i++) {
      const nearest = positions
        .map((p, j) => ({ j, d: positions[i].distanceTo(p) }))
        .filter(({ j }) => j !== i)
        .sort((a, b) => a.d - b.d)
        .slice(0, NEAREST_K)
      for (const { j } of nearest) {
        lineVerts.push(
          positions[i].x, positions[i].y, positions[i].z,
          positions[j].x, positions[j].y, positions[j].z,
        )
      }
    }
    const lineGeo = new THREE.BufferGeometry()
    lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(lineVerts, 3))
    const lineMat = new THREE.LineBasicMaterial({
      color: 0xd7e2ea,
      transparent: true,
      opacity: 0.15,
    })
    nodeGroup.add(new THREE.LineSegments(lineGeo, lineMat))
    scene.add(nodeGroup)

    // ══════════════════════════════════════════════════════════
    // 4. UFOs — 1 (mobile) / 3 (desktop)
    // ══════════════════════════════════════════════════════════
    const allUFOConfigs = [
      {
        radius: 0.18, saucerColor: 0x3d1466, domeColor: 0x7721b1,
        rimColor: 0x5a2090, orbitR: 6, tiltX: 0, tiltZ: 0, speed: 0.004,
      },
      {
        radius: 0.12, saucerColor: 0x0a2a4a, domeColor: 0x3b8bd4,
        rimColor: 0x1a4a6a, orbitR: 8, tiltX: Math.PI / 6, tiltZ: 0, speed: 0.003,
      },
      {
        radius: 0.08, saucerColor: 0x0d3b35, domeColor: 0x1a5a50,
        rimColor: 0x1a5a50, orbitR: 10, tiltX: -Math.PI / 9, tiltZ: 0.2, speed: 0.005,
      },
    ]
    const ufoConfigs = isMobile ? allUFOConfigs.slice(0, 1) : allUFOConfigs

    // Shared light geometry across all UFOs
    const sharedLightGeo = new THREE.SphereGeometry(0.02, 6, 6)
    const lightColors = [0xffffff, 0x7721b1, 0xffffff, 0x7721b1]

    const ufos: UFOData[] = []
    for (const cfg of ufoConfigs) {
      const { radius: r } = cfg

      const pivot = new THREE.Object3D()
      pivot.rotation.x = cfg.tiltX
      pivot.rotation.z = cfg.tiltZ

      const ufoGroup = new THREE.Group()
      ufoGroup.position.x = cfg.orbitR

      // Saucer — flattened sphere
      const saucerGeo = new THREE.SphereGeometry(r, 32, 16)
      const saucerMat = new THREE.MeshBasicMaterial({ color: cfg.saucerColor })
      const saucerMesh = new THREE.Mesh(saucerGeo, saucerMat)
      saucerMesh.scale.y = 0.35
      ufoGroup.add(saucerMesh)

      // Dome — smaller sphere on top
      const domeGeo = new THREE.SphereGeometry(r * 0.45, 16, 8)
      const domeMat = new THREE.MeshBasicMaterial({ color: cfg.domeColor })
      const domeMesh = new THREE.Mesh(domeGeo, domeMat)
      domeMesh.position.y = r * 0.3
      ufoGroup.add(domeMesh)

      // Equatorial rim — flat torus at y = 0
      const rimGeo = new THREE.TorusGeometry(r * 1.1, 0.02, 8, 32)
      const rimMat = new THREE.MeshBasicMaterial({
        color: cfg.rimColor,
        transparent: true,
        opacity: 0.35,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
      const rimMesh = new THREE.Mesh(rimGeo, rimMat)
      rimMesh.rotation.x = Math.PI / 2
      ufoGroup.add(rimMesh)

      // 4 landing lights — each with its own material for independent pulsing
      const lightMats: THREE.MeshBasicMaterial[] = []
      for (let l = 0; l < 4; l++) {
        const angle = (l / 4) * Math.PI * 2
        const lMat = new THREE.MeshBasicMaterial({
          color: lightColors[l],
          transparent: true,
          opacity: 0.7,
        })
        lightMats.push(lMat)
        const lMesh = new THREE.Mesh(sharedLightGeo, lMat)
        lMesh.position.set(
          r * 0.7 * Math.cos(angle),
          -r * 0.2,
          r * 0.7 * Math.sin(angle),
        )
        ufoGroup.add(lMesh)
      }

      pivot.add(ufoGroup)
      scene.add(pivot)

      ufos.push({
        pivot, ufoGroup, lightMats,
        saucerGeo, domeGeo, rimGeo,
        saucerMat, domeMat, rimMat,
        speed: cfg.speed,
      })
    }

    // ══════════════════════════════════════════════════════════
    // 5. COSMIC DUST — 50/group (mobile) / 150/group (desktop)
    // ══════════════════════════════════════════════════════════
    const dustPerGroup = isMobile ? 50 : 150
    const dustColors = [0x7721b1, 0x3b8bd4]
    const dustGroups: THREE.Points[] = []
    const dustGeos: THREE.BufferGeometry[] = []
    const dustMats: THREE.PointsMaterial[] = []

    for (let c = 0; c < 2; c++) {
      const verts: number[] = []
      for (let i = 0; i < dustPerGroup; i++) {
        const pos = randomInSphere(5)
        verts.push(pos.x, pos.y, pos.z)
      }
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
      const mat = new THREE.PointsMaterial({
        color: dustColors[c],
        size: 0.025,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
      })
      const pts = new THREE.Points(geo, mat)
      scene.add(pts)
      dustGroups.push(pts)
      dustGeos.push(geo)
      dustMats.push(mat)
    }

    // ══════════════════════════════════════════════════════════
    // 6. SHOOTING STARS — desktop only
    // ══════════════════════════════════════════════════════════
    const shootingStars: ShootingStar[] = []

    function spawnShootingStar() {
      const spread = 8
      const side = Math.floor(Math.random() * 4)
      const start = new THREE.Vector3()
      switch (side) {
        case 0: start.set(-spread - Math.random(), (Math.random() - 0.5) * spread, (Math.random() - 0.5) * 2); break
        case 1: start.set( spread + Math.random(), (Math.random() - 0.5) * spread, (Math.random() - 0.5) * 2); break
        case 2: start.set((Math.random() - 0.5) * spread,  spread + Math.random(), (Math.random() - 0.5) * 2); break
        default: start.set((Math.random() - 0.5) * spread, -spread - Math.random(), (Math.random() - 0.5) * 2)
      }
      const dir = new THREE.Vector3(
        -start.x * 0.5 + (Math.random() - 0.5),
        -start.y * 0.5 + (Math.random() - 0.5),
        (Math.random() - 0.5) * 0.5,
      ).normalize()
      const tailLength = 0.6 + Math.random() * 0.6
      const end = start.clone().addScaledVector(dir, tailLength)
      const geo = new THREE.BufferGeometry().setFromPoints([start, end])
      const mat = new THREE.LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.9,
      })
      const line = new THREE.Line(geo, mat)
      scene.add(line)
      shootingStars.push({ line, mat, geo, progress: 0, direction: dir, start: start.clone() })
    }

    let shootingStarTimer = 0
    const SHOOT_INTERVAL = 3.0
    const SHOOT_DURATION = 1.5

    // ── Resize handler ──────────────────────────────────────────
    const onResize = () => {
      const w = container.clientWidth
      const h = container.clientHeight
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
    }
    const ro = new ResizeObserver(onResize)
    ro.observe(container)

    // ── Animation loop ──────────────────────────────────────────
    let frameId: number
    let t = 0
    let lastTime = performance.now()

    const animate = () => {
      frameId = requestAnimationFrame(animate)

      const now = performance.now()
      const dt = Math.min((now - lastTime) / 1000, 0.05)
      lastTime = now
      t += dt

      // Constellation
      nodeGroup.rotation.y += 0.003
      nodeGroup.rotation.x = Math.sin(t * 0.3) * 0.12
      nodeGroup.scale.setScalar(1 + Math.sin(t * 0.5) * 0.03)

      // Stars
      stars.rotation.y += 0.00008
      stars.rotation.x += 0.00004

      // Nebula
      for (const { mesh } of nebulaPlanes) {
        mesh.rotation.z += 0.0003
      }

      // UFOs — orbit + wobble + per-light independent pulse
      for (let i = 0; i < ufos.length; i++) {
        const u = ufos[i]
        u.pivot.rotation.y += u.speed
        u.ufoGroup.rotation.z = Math.sin(t * 0.8 + i) * 0.15
        for (let l = 0; l < u.lightMats.length; l++) {
          u.lightMats[l].opacity =
            Math.sin(t * 3 + i * 1.5 + l) * 0.35 + 0.65
        }
      }

      // Cosmic dust
      for (const d of dustGroups) {
        d.rotation.y += 0.001
        d.rotation.x = Math.sin(t * 0.2) * 0.05
      }

      // Shooting stars — desktop only
      if (!isMobile) {
        shootingStarTimer += dt
        if (shootingStarTimer >= SHOOT_INTERVAL) {
          shootingStarTimer = 0
          spawnShootingStar()
        }

        for (let i = shootingStars.length - 1; i >= 0; i--) {
          const star = shootingStars[i]
          star.progress += dt / SHOOT_DURATION
          const p = Math.min(star.progress, 1)

          star.mat.opacity = Math.max(0, 1 - p * 1.2) * 0.9

          const travelDist = p * 6
          const headPos = star.start.clone().addScaledVector(star.direction, travelDist)
          const tailPos = star.start.clone().addScaledVector(star.direction, Math.max(0, travelDist - 0.7))
          const posAttr = star.geo.getAttribute('position') as THREE.BufferAttribute
          posAttr.setXYZ(0, tailPos.x, tailPos.y, tailPos.z)
          posAttr.setXYZ(1, headPos.x, headPos.y, headPos.z)
          posAttr.needsUpdate = true

          if (p >= 1) {
            scene.remove(star.line)
            star.geo.dispose()
            star.mat.dispose()
            shootingStars.splice(i, 1)
          }
        }
      }

      renderer.render(scene, camera)
    }
    animate()

    // ── Visibility-based pause ──────────────────────────────────
    const onVisibilityChange = () => {
      if (document.hidden) {
        cancelAnimationFrame(frameId)
      } else {
        lastTime = performance.now()   // prevent dt spike on resume
        animate()
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    // ── Cleanup ─────────────────────────────────────────────────
    return () => {
      cancelAnimationFrame(frameId)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      renderer.setAnimationLoop(null)
      ro.disconnect()
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement)
      }
      renderer.dispose()

      nodeGeo.dispose()
      lineGeo.dispose()
      lineMat.dispose()
      for (const mat of nodeMats) mat.dispose()

      starGeo.dispose()
      starMat.dispose()

      nebulaGeo.dispose()
      for (const { mat } of nebulaPlanes) mat.dispose()

      sharedLightGeo.dispose()
      for (const u of ufos) {
        u.saucerGeo.dispose()
        u.domeGeo.dispose()
        u.rimGeo.dispose()
        u.saucerMat.dispose()
        u.domeMat.dispose()
        u.rimMat.dispose()
        for (const lm of u.lightMats) lm.dispose()
      }

      for (const g of dustGeos) g.dispose()
      for (const m of dustMats) m.dispose()

      for (const s of shootingStars) {
        s.geo.dispose()
        s.mat.dispose()
      }
    }
  }, [])

  return (
    <div
      ref={containerRef}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
    />
  )
}
