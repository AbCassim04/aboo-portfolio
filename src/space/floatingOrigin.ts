import * as THREE from 'three'

// ── Floating origin / camera-relative rendering ─────────────────────────────
//
// Authoritative positions are float64 JS numbers ("world" space). The GPU only
// ever sees positions relative to the camera, which sits at the render origin
// (0, 0, 0): every frame, each tracked object's render position is
//
//     render = (world − frame) − cameraLocal
//
// where `frame` is a float64 reference point and `cameraLocal` the camera's
// float64 offset from it. Keeping the camera as (frame + small local offset)
// instead of one big float64 vector means camera motion is resolved to the
// precision of the *local* offset (sub-micrometre for offsets below ~10⁴ km),
// and `world − frame` is exact for objects near the frame (Sterbenz), so an
// object 30 AU from the Sun can be viewed from 1 m without any jitter.
//
// Host body: the frame rides with a "host" (the body whose sphere of influence
// the ship is in). Every frame carry(hostWorld) moves the frame with the host
// *without* touching cameraLocal, so the camera, the ship and anything else
// stored frame-relative are carried along — e.g. the ship stays put relative
// to Earth while Earth moves 30 km/s around the Sun. The frame is
// hostWorld + offset, where the offset only ever changes in whole units.
//
// Recentring: when the camera strays more than RECENTER_DISTANCE from the
// frame, the offset moves by a whole number of units toward it, so
// frame + local is unchanged *exactly* — nothing visibly jumps. Switching host
// re-expresses the locals relative to the new host. Listeners are told about
// every shift (recentre / host switch) so other frame-relative state (the
// ship's local position, trails) can shift by the same amount.
//
// No per-frame allocations: apply() writes straight into Object3D.position.

/** Recentre when the camera is further than this from the frame origin (world units). */
export const RECENTER_DISTANCE = 1e4

export type FrameShiftListener = (dx: number, dy: number, dz: number) => void

interface Tracked {
  obj:   THREE.Object3D
  world: THREE.Vector3
}

export class FloatingOrigin {
  /** Float64 reference point (world) = hostWorld + offset. */
  readonly frame       = new THREE.Vector3()
  /** World position of the host the frame rides with (last carry / switch). */
  readonly hostWorld   = new THREE.Vector3()
  /** frame − hostWorld (whole units). */
  private readonly offset = new THREE.Vector3()
  /** Camera position relative to `frame` (float64). */
  readonly cameraLocal = new THREE.Vector3()

  private readonly tracked: Tracked[] = []
  private readonly listeners = new Set<FrameShiftListener>()

  /**
   * Track `obj`: its render position is derived from the returned world vector
   * on every apply(). The caller owns and updates the world vector. If `world`
   * is omitted the object's current position is taken as its world position.
   */
  track(obj: THREE.Object3D, world?: THREE.Vector3): THREE.Vector3 {
    const w = world ?? obj.position.clone()
    this.tracked.push({ obj, world: w })
    return w
  }

  untrack(obj: THREE.Object3D): void {
    const i = this.tracked.findIndex(t => t.obj === obj)
    if (i >= 0) this.tracked.splice(i, 1)
  }

  get trackedCount(): number { return this.tracked.length }

  /** World position of a tracked object (or null). */
  worldOf(obj: THREE.Object3D): THREE.Vector3 | null {
    for (const t of this.tracked) if (t.obj === obj) return t.world
    return null
  }

  onShift(fn: FrameShiftListener): () => void {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }

  /** Camera world position (float64 sum; only for coarse use such as LOD or HUD). */
  getCameraWorld(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.frame).add(this.cameraLocal)
  }

  /** Place the camera at a world position (precision limited to float64 of `world`). */
  setCameraWorld(world: THREE.Vector3): void {
    this.cameraLocal.subVectors(world, this.frame)
  }

  /**
   * Move the frame with its host (no listener calls): everything stored
   * frame-relative — camera, ship, trails — is carried along.
   */
  carry(hostWorld: THREE.Vector3): void {
    this.hostWorld.copy(hostWorld)
    this.frame.addVectors(hostWorld, this.offset)
  }

  /**
   * Ride with a different host from now on, keeping the camera (and every
   * frame-relative thing, via the listeners) where it is in world space.
   */
  switchHost(hostWorld: THREE.Vector3): void {
    const dx = (hostWorld.x - this.frame.x)
    const dy = (hostWorld.y - this.frame.y)
    const dz = (hostWorld.z - this.frame.z)
    this.hostWorld.copy(hostWorld)
    this.offset.set(0, 0, 0)
    this.frame.copy(hostWorld)
    this.cameraLocal.x -= dx; this.cameraLocal.y -= dy; this.cameraLocal.z -= dz
    for (const l of this.listeners) l(dx, dy, dz)
  }

  /**
   * If the camera has strayed more than RECENTER_DISTANCE from the frame,
   * move the frame by whole units toward it (exact). Returns true if it moved.
   */
  recenter(): boolean {
    const c = this.cameraLocal
    if (c.x * c.x + c.y * c.y + c.z * c.z <= RECENTER_DISTANCE * RECENTER_DISTANCE) return false
    this.shift(Math.round(c.x), Math.round(c.y), Math.round(c.z))
    return true
  }

  private shift(dx: number, dy: number, dz: number): void {
    this.offset.x += dx; this.offset.y += dy; this.offset.z += dz
    this.frame.x += dx; this.frame.y += dy; this.frame.z += dz
    this.cameraLocal.x -= dx; this.cameraLocal.y -= dy; this.cameraLocal.z -= dz
    for (const l of this.listeners) l(dx, dy, dz)
  }

  /** Camera-relative render position of a world point. */
  toRender(world: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    return out.set(
      (world.x - this.frame.x) - this.cameraLocal.x,
      (world.y - this.frame.y) - this.cameraLocal.y,
      (world.z - this.frame.z) - this.cameraLocal.z,
    )
  }

  /** Frame-relative ("local") position of a world point. */
  toLocal(world: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    return out.subVectors(world, this.frame)
  }

  /** Same as toRender for a frame-relative ("local") point. */
  localToRender(local: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    return out.set(local.x - this.cameraLocal.x, local.y - this.cameraLocal.y, local.z - this.cameraLocal.z)
  }

  /** Write every tracked object's render position. Call once per frame before rendering. */
  apply(): void {
    for (let i = 0; i < this.tracked.length; i++) {
      const t = this.tracked[i]
      this.toRender(t.world, t.obj.position)
    }
  }
}
