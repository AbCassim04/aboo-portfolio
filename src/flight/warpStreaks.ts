import * as THREE from 'three'

// ── Warp streaks (fast travel) ─────────────────────────────────────────────
// Lines in the sky pass (camera-centred, so at infinity): each star direction
// d is stretched away from the direction of travel v (tail = d − v·k), so
// stars ahead stay short and stars to the side stream past. Opacity follows
// the jump's warp intensity, which drops to zero at drop-out, so the stars
// snap back to points. Built-in LineBasicMaterial (log-depth safe).

const RADIUS = 9000

export class WarpStreaks {
  readonly object: THREE.LineSegments
  private readonly dirs: Float32Array
  private readonly pos:  Float32Array
  private readonly col:  Float32Array
  private readonly geo:  THREE.BufferGeometry
  private readonly mat:  THREE.LineBasicMaterial
  private readonly n:    number

  constructor(n: number) {
    this.n = n
    this.dirs = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u)
      this.dirs[i * 3] = s * Math.cos(a); this.dirs[i * 3 + 1] = u; this.dirs[i * 3 + 2] = s * Math.sin(a)
    }
    this.pos = new Float32Array(n * 6)
    this.col = new Float32Array(n * 8)
    this.geo = new THREE.BufferGeometry()
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage))
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage))
    this.mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending })
    this.object = new THREE.LineSegments(this.geo, this.mat)
    this.object.frustumCulled = false
    this.object.renderOrder = 5
    this.object.visible = false
  }

  /** @param intensity 0..1  @param v unit direction of travel (world) */
  update(intensity: number, v: THREE.Vector3): void {
    this.object.visible = intensity > 0.003
    if (!this.object.visible) return
    const k = 0.45 * intensity
    for (let i = 0; i < this.n; i++) {
      const dx = this.dirs[i * 3], dy = this.dirs[i * 3 + 1], dz = this.dirs[i * 3 + 2]
      let tx = dx - v.x * k, ty = dy - v.y * k, tz = dz - v.z * k
      const tl = Math.hypot(tx, ty, tz) || 1
      tx /= tl; ty /= tl; tz /= tl
      const o = i * 6
      this.pos[o] = dx * RADIUS; this.pos[o + 1] = dy * RADIUS; this.pos[o + 2] = dz * RADIUS
      this.pos[o + 3] = tx * RADIUS; this.pos[o + 4] = ty * RADIUS; this.pos[o + 5] = tz * RADIUS
      const c = i * 8
      const b = 0.55 + 0.45 * ((i * 7919) % 97) / 97
      this.col[c] = 0.75 * b; this.col[c + 1] = 0.88 * b; this.col[c + 2] = b; this.col[c + 3] = intensity
      this.col[c + 4] = 0.5 * b; this.col[c + 5] = 0.6 * b; this.col[c + 6] = b; this.col[c + 7] = 0
    }
    ;(this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true
    ;(this.geo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true
  }

  dispose(): void { this.geo.dispose(); this.mat.dispose() }
}
