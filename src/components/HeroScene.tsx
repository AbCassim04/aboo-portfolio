import { useEffect, useRef } from 'react'
import * as THREE from 'three'

const NODE_COUNT = 80
const PARTICLE_COUNT = 200
const SPHERE_RADIUS = 2
const NEAREST_K = 3

const NODE_COLORS = [0x7721b1, 0x3b8bd4, 0x7721b1, 0x3b8bd4, 0xbbccd7]

function pickColor(i: number) {
  // ~40% purple, ~40% blue, ~20% white highlight
  if (i % 5 === 4) return NODE_COLORS[4]
  return NODE_COLORS[i % 2]
}

function randomInSphere(r: number): THREE.Vector3 {
  // uniform distribution inside sphere via rejection sampling
  while (true) {
    const v = new THREE.Vector3(
      (Math.random() - 0.5) * 2,
      (Math.random() - 0.5) * 2,
      (Math.random() - 0.5) * 2,
    )
    if (v.length() <= 1) return v.multiplyScalar(r)
  }
}

export default function HeroScene() {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // ── Scene & Camera ────────────────────────────────────────
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(
      60,
      container.clientWidth / container.clientHeight,
      0.1,
      100,
    )
    camera.position.z = 5

    // ── Renderer ──────────────────────────────────────────────
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(container.clientWidth, container.clientHeight)
    renderer.setClearColor(0x000000, 0)
    container.appendChild(renderer.domElement)

    // ── Nodes ─────────────────────────────────────────────────
    const positions: THREE.Vector3[] = []
    const nodeGroup = new THREE.Group()

    const nodeMaterial = (color: number) =>
      new THREE.MeshBasicMaterial({ color })
    const nodeGeo = new THREE.SphereGeometry(0.04, 8, 8)

    for (let i = 0; i < NODE_COUNT; i++) {
      const pos = randomInSphere(SPHERE_RADIUS)
      positions.push(pos)
      const mesh = new THREE.Mesh(nodeGeo, nodeMaterial(pickColor(i)))
      mesh.position.copy(pos)
      nodeGroup.add(mesh)
    }

    // ── Edges (K nearest neighbours) ─────────────────────────
    const lineVerts: number[] = []
    for (let i = 0; i < NODE_COUNT; i++) {
      const distances = positions
        .map((p, j) => ({ j, d: positions[i].distanceTo(p) }))
        .filter(({ j }) => j !== i)
        .sort((a, b) => a.d - b.d)
        .slice(0, NEAREST_K)

      for (const { j } of distances) {
        lineVerts.push(
          positions[i].x, positions[i].y, positions[i].z,
          positions[j].x, positions[j].y, positions[j].z,
        )
      }
    }

    const lineGeo = new THREE.BufferGeometry()
    lineGeo.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(lineVerts, 3),
    )
    const lineMat = new THREE.LineBasicMaterial({
      color: 0xd7e2ea,
      transparent: true,
      opacity: 0.15,
    })
    const lines = new THREE.LineSegments(lineGeo, lineMat)
    nodeGroup.add(lines)
    scene.add(nodeGroup)

    // ── Particle field ────────────────────────────────────────
    const particleVerts: number[] = []
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      particleVerts.push(
        (Math.random() - 0.5) * 10,
        (Math.random() - 0.5) * 10,
        (Math.random() - 0.5) * 10,
      )
    }
    const particleGeo = new THREE.BufferGeometry()
    particleGeo.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(particleVerts, 3),
    )
    const particleMat = new THREE.PointsMaterial({
      color: 0xbbccd7,
      size: 0.022,
      transparent: true,
      opacity: 0.55,
    })
    const particles = new THREE.Points(particleGeo, particleMat)
    scene.add(particles)

    // ── Resize handler ────────────────────────────────────────
    const onResize = () => {
      if (!container) return
      const w = container.clientWidth
      const h = container.clientHeight
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
    }
    const ro = new ResizeObserver(onResize)
    ro.observe(container)

    // ── Animation loop ────────────────────────────────────────
    let frameId: number
    let t = 0

    const animate = () => {
      frameId = requestAnimationFrame(animate)
      t += 0.01

      // Y rotation + gentle X wobble
      nodeGroup.rotation.y += 0.003
      nodeGroup.rotation.x = Math.sin(t * 0.3) * 0.12

      // Breathing scale
      const breathe = 1 + Math.sin(t * 0.5) * 0.03
      nodeGroup.scale.setScalar(breathe)

      // Particles drift slowly
      particles.rotation.y += 0.0004
      particles.rotation.x += 0.0002

      renderer.render(scene, camera)
    }
    animate()

    // ── Cleanup ───────────────────────────────────────────────
    return () => {
      cancelAnimationFrame(frameId)
      ro.disconnect()
      container.removeChild(renderer.domElement)
      renderer.dispose()
      nodeGeo.dispose()
      lineGeo.dispose()
      lineMat.dispose()
      particleGeo.dispose()
      particleMat.dispose()
      // dispose per-node materials
      nodeGroup.children.forEach((child) => {
        if (child instanceof THREE.Mesh) {
          ;(child.material as THREE.Material).dispose()
        }
      })
    }
  }, [])

  return <div ref={containerRef} className="w-full h-full" />
}
