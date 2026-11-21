import * as THREE from 'three'

// ── Camera rig: CHASE / COCKPIT / ORBIT ────────────────────────────────────
// The camera is the ship's position plus an offset. The offset (world axes,
// km) is driven by a critically damped spring with an explicit velocity, so:
//   • there is no positional lag behind the ship at any speed (the offset is
//     relative — at 100 c the camera is still exactly where it should be);
//   • camera-mode changes, orbit drags and the speed-dependent distance are
//     always smooth (no overshoot, no wobble, never a jump);
//   • the rig's velocity is known exactly, which the continuity check uses.
//
// CHASE   — behind and above the ship, looking parallel to its heading, so
//           the ship sits low in the frame and the view ahead is clear. The
//           distance is set so the ~16 m ship spans ~10 % of the view height,
//           and eases ~20 % further back at cruise speeds.
// COCKPIT — inside the dome, looking along the heading; the ship fades out
//           as the camera moves in (hidden once inside), HUD only.
// ORBIT   — the whole chase rig rotates about the ship with drag / the right
//           stick, and springs back to the chase view when released.

export type CameraMode = 'chase' | 'cockpit' | 'orbit'
export const CAMERA_MODES: readonly CameraMode[] = ['chase', 'cockpit', 'orbit']

/** Chase geometry (km): distance behind, height above. */
export const CHASE_DISTANCE_KM = 0.068
export const CHASE_HEIGHT_KM   = 0.0168
/** Cockpit eye point (km, ship-local). */
const COCKPIT_EYE = new THREE.Vector3(0, 0.0026, -0.0015)
/** Extra chase distance at cruise speeds. */
const SPEED_PULLBACK = 0.2
/** Spring rates (1/s). */
const OMEGA: Record<CameraMode, number> = { chase: 10, cockpit: 12, orbit: 12 }
const OMEGA_ROT   = 12
const OMEGA_DIST  = 2.5
const OMEGA_ORBIT = 5
const ORBIT_PITCH_LIMIT = 1.35

const _t  = new THREE.Vector3()
const _a  = new THREE.Vector3()
const _q  = new THREE.Quaternion()
const _qo = new THREE.Quaternion()
const _e  = new THREE.Euler()

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

/** Semi-implicit critically damped spring for a scalar (allocation-free). */
class Spring1 {
  x = 0
  v = 0
  step(target: number, omega: number, dt: number): number {
    this.v += (omega * omega * (target - this.x) - 2 * omega * this.v) * dt
    this.x += this.v * dt
    return this.x
  }
}

export class CameraRig {
  mode: CameraMode = 'chase'
  /** Camera position relative to the ship centre (world axes, km). */
  readonly offset    = new THREE.Vector3()
  /** Its velocity (km/s). */
  readonly offsetVel = new THREE.Vector3()
  /** Camera orientation (world). */
  readonly quaternion = new THREE.Quaternion()
  /** 0 (hidden) … 1: ship opacity, fading out as the camera moves inside it. */
  shipOpacity = 1
  /** Orbit angles (rad), each with its spring. */
  private readonly yawS = new Spring1()
  private readonly pitchS = new Spring1()
  get orbitYaw(): number { return this.yawS.x }
  get orbitPitch(): number { return this.pitchS.x }
  /** True while the player is dragging / holding the orbit stick. */
  dragging = false
  private stickX = 0
  private stickY = 0
  /** Distance factor (eases with speed). */
  private readonly distS = new Spring1()
  get distFactor(): number { return this.distS.x }
  private readonly shipRadius: number

  constructor(shipRadiusKm: number) {
    this.shipRadius = shipRadiusKm
    this.distS.x = 1
  }

  /** Target offset (ship-local, km) and local orientation for the current mode. */
  private localTarget(outOffset: THREE.Vector3, outQuat: THREE.Quaternion): void {
    if (this.mode === 'cockpit') {
      outOffset.copy(COCKPIT_EYE)
      outQuat.identity()
      return
    }
    outOffset.set(0, CHASE_HEIGHT_KM, CHASE_DISTANCE_KM).multiplyScalar(this.distFactor)
    if (this.orbitYaw !== 0 || this.orbitPitch !== 0) {
      outQuat.setFromEuler(_e.set(this.orbitPitch, this.orbitYaw, 0, 'YXZ'))
      outOffset.applyQuaternion(outQuat)
    } else {
      outQuat.identity()
    }
  }

  /** Snap to the target for the current mode (spawn / teleport). */
  reset(shipQuat: THREE.Quaternion): void {
    this.yawS.x = this.yawS.v = this.pitchS.x = this.pitchS.v = 0
    this.dragging = false
    this.distS.v = 0
    this.localTarget(_t, _qo)
    this.offset.copy(_t).applyQuaternion(shipQuat)
    this.offsetVel.set(0, 0, 0)
    this.quaternion.copy(shipQuat).multiply(_qo)
    this.updateOpacity()
  }

  setMode(mode: CameraMode): void {
    this.mode = mode
    if (mode !== 'orbit') this.dragging = false
  }

  cycle(): CameraMode {
    const i = CAMERA_MODES.indexOf(this.mode)
    this.setMode(CAMERA_MODES[(i + 1) % CAMERA_MODES.length])
    return this.mode
  }

  /** Mouse / touch drag (pixels → radians), orbit mode only. */
  drag(dxPx: number, dyPx: number, radPerPx = 0.006): void {
    if (this.mode !== 'orbit') return
    this.dragging = true
    this.yawS.x  -= dxPx * radPerPx
    this.pitchS.x = Math.max(-ORBIT_PITCH_LIMIT, Math.min(ORBIT_PITCH_LIMIT, this.pitchS.x - dyPx * radPerPx))
    this.yawS.v = this.pitchS.v = 0
  }

  endDrag(): void { this.dragging = false; this.stickX = this.stickY = 0 }

  /** Right-stick orbit input (−1..1), orbit mode only. */
  stick(x: number, y: number): void {
    if (this.mode !== 'orbit') return
    this.stickX = x; this.stickY = y
    this.dragging = x !== 0 || y !== 0
  }

  private updateOpacity(): void {
    const d = this.offset.length()
    this.shipOpacity = smoothstep(this.shipRadius * 1.2, this.shipRadius * 3.5, d)
  }

  /**
   * Advance the rig. `speed` is the ship's speed (km/s) for the pull-back.
   */
  update(dt: number, shipQuat: THREE.Quaternion, speedKmS: number): void {
    // Orbit angles: driven by the stick / drag, spring back to 0 when released.
    if (this.mode === 'orbit' && (this.stickX !== 0 || this.stickY !== 0)) {
      this.yawS.x  -= this.stickX * 2.2 * dt
      this.pitchS.x = Math.max(-ORBIT_PITCH_LIMIT, Math.min(ORBIT_PITCH_LIMIT, this.pitchS.x + this.stickY * 1.6 * dt))
      this.yawS.v = this.pitchS.v = 0
    } else if (!this.dragging || this.mode !== 'orbit') {
      this.yawS.step(0, OMEGA_ORBIT, dt)
      this.pitchS.step(0, OMEGA_ORBIT, dt)
    }
    // Distance eases out with speed (log scale: ~3 km/s → 1, ~30 000 km/s → 1.2).
    const lv = Math.log10(Math.max(speedKmS, 1e-6))
    this.distS.step(1 + SPEED_PULLBACK * smoothstep(0.5, 4.5, lv), OMEGA_DIST, dt)

    // Offset spring (world axes) toward the rotated local target.
    this.localTarget(_t, _qo)
    _t.applyQuaternion(shipQuat)
    const w = OMEGA[this.mode]
    _a.subVectors(_t, this.offset).multiplyScalar(w * w).addScaledVector(this.offsetVel, -2 * w)
    this.offsetVel.addScaledVector(_a, dt)
    this.offset.addScaledVector(this.offsetVel, dt)

    // Orientation: exponential slerp toward ship × local.
    _q.copy(shipQuat).multiply(_qo)
    this.quaternion.slerp(_q, 1 - Math.exp(-dt * OMEGA_ROT))
    this.updateOpacity()
  }
}
