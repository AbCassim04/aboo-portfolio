import { useEffect, useRef } from 'react'
import * as THREE from 'three'

type SceneType = 'math' | 'code' | 'atom' | 'constellation'

interface MiniSceneProps {
  type: SceneType
  size?: number
}

export default function MiniScene({ type, size = 160 }: MiniSceneProps) {
  const mountRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    const isMobile = window.innerWidth < 768
    const renderSize = isMobile ? Math.round(size * 0.7) : size

    // ── Core Three.js setup ─────────────────────────────────────
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100)
    camera.position.z = 3

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true })
    renderer.setPixelRatio(isMobile ? 1 : Math.min(window.devicePixelRatio, 2))
    renderer.setSize(renderSize, renderSize)
    renderer.setClearColor(0x000000, 0)
    renderer.domElement.style.width = '100%'
    renderer.domElement.style.height = '100%'
    mount.appendChild(renderer.domElement)

    // ── Resource tracking for cleanup ────────────────────────────
    const geos: THREE.BufferGeometry[] = []
    const mats: THREE.Material[] = []
    const g = <T extends THREE.BufferGeometry>(geo: T): T => { geos.push(geo); return geo }
    const m = <T extends THREE.Material>(mat: T): T => { mats.push(mat); return mat }

    let t = 0
    let frameId: number
    let animateFn: () => void = () => {}

    // ── math ────────────────────────────────────────────────────
    if (type === 'math') {
      const outer = new THREE.Mesh(
        g(new THREE.IcosahedronGeometry(0.8, 0)),
        m(new THREE.MeshBasicMaterial({ color: 0x7721b1, wireframe: true, transparent: true, opacity: 0.8 })),
      )
      const inner = new THREE.Mesh(
        g(new THREE.OctahedronGeometry(0.3)),
        m(new THREE.MeshBasicMaterial({ color: 0x3b8bd4 })),
      )
      scene.add(outer, inner)

      const light = new THREE.PointLight(0x7721b1, 2, 10)
      light.position.set(2, 2, 2)
      scene.add(light)

      animateFn = () => {
        frameId = requestAnimationFrame(animateFn)
        outer.rotation.y += 0.008
        inner.rotation.y += 0.008
        inner.rotation.x -= 0.006
        renderer.render(scene, camera)
      }

    // ── code ────────────────────────────────────────────────────
    } else if (type === 'code') {
      const group = new THREE.Group()
      scene.add(group)

      const boxGeo = g(new THREE.BoxGeometry(1, 1, 1))
      group.add(new THREE.LineSegments(
        g(new THREE.EdgesGeometry(boxGeo)),
        m(new THREE.LineBasicMaterial({ color: 0x22c55e, transparent: true, opacity: 0.7 })),
      ))

      const lineColors = [0x7721b1, 0x3b8bd4, 0x22c55e]
      for (let i = 0; i < 3; i++) {
        const strip = new THREE.Mesh(
          g(new THREE.BoxGeometry(0.8, 0.04, 0.04)),
          m(new THREE.MeshBasicMaterial({ color: lineColors[i] })),
        )
        strip.position.y = (i - 1) * 0.25
        group.add(strip)
      }

      animateFn = () => {
        frameId = requestAnimationFrame(animateFn)
        t += 0.016
        group.rotation.y += 0.006
        group.rotation.x = Math.sin(t * 0.8) * 0.2
        renderer.render(scene, camera)
      }

    // ── atom ────────────────────────────────────────────────────
    } else if (type === 'atom') {
      const group = new THREE.Group()
      scene.add(group)

      group.add(new THREE.Mesh(
        g(new THREE.SphereGeometry(0.25, 16, 16)),
        m(new THREE.MeshBasicMaterial({ color: 0xd7e2ea })),
      ))

      // Shared torus geometry — one ring per orbit, different rotation
      const torusGeo = g(new THREE.TorusGeometry(0.7, 0.012, 8, 64))
      const orbitalAngles = [0, Math.PI / 3, (2 * Math.PI) / 3]
      for (const angle of orbitalAngles) {
        const ring = new THREE.Mesh(
          torusGeo,
          m(new THREE.MeshBasicMaterial({ color: 0x7721b1, transparent: true, opacity: 0.7 })),
        )
        ring.rotation.x = angle
        group.add(ring)
      }

      // Electron meshes — positions updated each frame
      const electronGeo = g(new THREE.SphereGeometry(0.07, 8, 8))
      const electrons: THREE.Mesh[] = []
      for (let i = 0; i < 3; i++) {
        const e = new THREE.Mesh(electronGeo, m(new THREE.MeshBasicMaterial({ color: 0x3b8bd4 })))
        group.add(e)
        electrons.push(e)
      }

      animateFn = () => {
        frameId = requestAnimationFrame(animateFn)
        t += 0.016
        group.rotation.y += 0.005
        const r = 0.7
        for (let i = 0; i < 3; i++) {
          const a = orbitalAngles[i]
          const phase = t + (i * 2 * Math.PI) / 3
          // Follow the torus ring: ring is in XY plane then rotated around X by `a`
          electrons[i].position.set(
            r * Math.cos(phase),
            r * Math.sin(phase) * Math.cos(a),
            r * Math.sin(phase) * Math.sin(a),
          )
        }
        renderer.render(scene, camera)
      }

    // ── constellation ───────────────────────────────────────────
    } else {
      const group = new THREE.Group()
      scene.add(group)

      // 12 random points within unit sphere scaled to radius 0.9
      const pts: THREE.Vector3[] = []
      while (pts.length < 12) {
        const v = new THREE.Vector3(
          (Math.random() - 0.5) * 2,
          (Math.random() - 0.5) * 2,
          (Math.random() - 0.5) * 2,
        )
        if (v.length() <= 1) pts.push(v.multiplyScalar(0.9))
      }

      // Connect each point to its 2 nearest neighbours
      const edgeVerts: number[] = []
      for (let i = 0; i < pts.length; i++) {
        pts
          .map((p, j) => ({ j, d: pts[i].distanceTo(p) }))
          .filter(x => x.j !== i)
          .sort((a, b) => a.d - b.d)
          .slice(0, 2)
          .forEach(({ j }) => {
            edgeVerts.push(pts[i].x, pts[i].y, pts[i].z, pts[j].x, pts[j].y, pts[j].z)
          })
      }
      const edgeGeo = g(new THREE.BufferGeometry())
      edgeGeo.setAttribute('position', new THREE.Float32BufferAttribute(edgeVerts, 3))
      group.add(new THREE.LineSegments(
        edgeGeo,
        m(new THREE.LineBasicMaterial({ color: 0xd7e2ea, transparent: true, opacity: 0.3 })),
      ))

      // Node spheres — alternating purple / blue
      const nodeGeo = g(new THREE.SphereGeometry(0.04, 6, 6))
      const nodeColors = [0x7721b1, 0x3b8bd4]
      for (let i = 0; i < pts.length; i++) {
        const node = new THREE.Mesh(nodeGeo, m(new THREE.MeshBasicMaterial({ color: nodeColors[i % 2] })))
        node.position.copy(pts[i])
        group.add(node)
      }

      // 20 background star particles scattered at radius ~2
      const starVerts: number[] = []
      for (let i = 0; i < 20; i++) {
        const theta = Math.random() * Math.PI * 2
        const phi = Math.acos(2 * Math.random() - 1)
        const r = 1.5 + Math.random() * 0.5
        starVerts.push(
          r * Math.sin(phi) * Math.cos(theta),
          r * Math.sin(phi) * Math.sin(theta),
          r * Math.cos(phi),
        )
      }
      const starGeo = g(new THREE.BufferGeometry())
      starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starVerts, 3))
      group.add(new THREE.Points(
        starGeo,
        m(new THREE.PointsMaterial({ color: 0xffffff, size: 0.02, transparent: true, opacity: 0.8 })),
      ))

      animateFn = () => {
        frameId = requestAnimationFrame(animateFn)
        t += 0.016
        group.rotation.y += 0.004
        group.rotation.x = Math.sin(t * 0.4) * 0.15
        renderer.render(scene, camera)
      }
    }

    animateFn()

    // ── Cleanup ──────────────────────────────────────────────────
    return () => {
      cancelAnimationFrame(frameId)
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement)
      renderer.dispose()
      for (const geo of geos) geo.dispose()
      for (const mat of mats) mat.dispose()
    }
  }, [type, size])

  return <div ref={mountRef} style={{ width: '100%', aspectRatio: '1 / 1' }} />
}
