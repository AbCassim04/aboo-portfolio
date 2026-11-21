import { useRef } from 'react'
import * as THREE from 'three'
import type { FlightInput } from './useFlightControls'

export interface UFOState {
  position:        THREE.Vector3
  velocity:        THREE.Vector3
  rotation:        THREE.Euler
  angularVelocity: THREE.Vector3
}

// Tuning constants are expressed per 60 fps reference frame; update(dt) scales
// them by k = dt · 60 (and per-frame decay factors by ^k), so handling is the
// same as before at 60 fps and no longer faster on high-refresh displays.
const REF_FPS      = 60
const TURN_RATE    = 0.012  // rad/frame — deliberate turns, not spin
const ANGULAR_DRAG = 0.88   // higher drag so rotation stops quickly when key released
const AV_CAP       = 0.04   // max rad/frame per axis
const DRAG         = 0.98
const ACCEL        = 0.006
const MAX_SPEED    = 0.4
const MAX_SPEED_BOOST = MAX_SPEED * 8.0

const _forward = new THREE.Vector3()
const _pull    = new THREE.Vector3()

export interface UFOPhysicsOptions {
  /**
   * Multiplies every linear rate (acceleration, top speed): world units per
   * old scene unit. The true-scale scene uses this until the flight model is
   * replaced (Milestone 3). Default 1.
   */
  speedScale?: number
  /** Soft/hard spherical boundary at 8980/9000 units around the origin (default true). */
  boundary?:   boolean
}

export function useUFOPhysics(
  inputRef: React.MutableRefObject<FlightInput>,
  opts: UFOPhysicsOptions = {},
): { ufoStateRef: React.MutableRefObject<UFOState>; update: (dt?: number) => void } {
  const S = opts.speedScale ?? 1
  const boundary = opts.boundary ?? true
  const ufoStateRef = useRef<UFOState>({
    position:        new THREE.Vector3(30, 0, 30),
    velocity:        new THREE.Vector3(),
    rotation:        new THREE.Euler(),
    angularVelocity: new THREE.Vector3(),
  })

  /** Advance by `dt` seconds (callers pass the clamped frame time). */
  const update = (dt = 1 / REF_FPS) => {
    const state = ufoStateRef.current
    const inp   = inputRef.current
    const k     = dt * REF_FPS

    // Forward vector in world space (UFO faces -Z locally)
    _forward.set(0, 0, -1).applyEuler(state.rotation)

    // Thrust / brake
    const accel = (inp.boost ? ACCEL * 8 : ACCEL) * S
    if (inp.thrust > 0) state.velocity.addScaledVector(_forward, accel * inp.thrust * k)
    if (inp.brake  > 0) state.velocity.multiplyScalar(Math.pow(0.95, k))

    // Vertical (world-space Y — more intuitive than local frame)
    if (inp.vertical !== 0) state.velocity.y += inp.vertical * ACCEL * S * 0.8 * k

    // Speed clamp
    const topSpeed = (inp.boost ? MAX_SPEED_BOOST : MAX_SPEED) * S
    if (state.velocity.length() > topSpeed) state.velocity.setLength(topSpeed)

    // Angular inputs
    state.angularVelocity.y -= inp.yaw   * TURN_RATE * k
    state.angularVelocity.x -= inp.pitch * TURN_RATE * k
    state.angularVelocity.z -= inp.roll  * TURN_RATE * k
    if (inp.pitchUp)   state.angularVelocity.x += TURN_RATE * k
    if (inp.pitchDown) state.angularVelocity.x -= TURN_RATE * k

    // Drag
    state.velocity.multiplyScalar(Math.pow(DRAG, k))
    state.angularVelocity.multiplyScalar(Math.pow(ANGULAR_DRAG, k))

    // Cap angular velocity per axis
    state.angularVelocity.x = Math.max(-AV_CAP, Math.min(AV_CAP, state.angularVelocity.x))
    state.angularVelocity.y = Math.max(-AV_CAP, Math.min(AV_CAP, state.angularVelocity.y))
    state.angularVelocity.z = Math.max(-AV_CAP, Math.min(AV_CAP, state.angularVelocity.z))

    // Integrate (velocity is in units per reference frame)
    state.position.addScaledVector(state.velocity, k)
    state.rotation.x += state.angularVelocity.x * k
    state.rotation.y += state.angularVelocity.y * k
    state.rotation.z += state.angularVelocity.z * k

    // Soft boundary pull at 8980u, hard clamp at 9000u
    if (!boundary) return
    const dist = state.position.length()
    if (dist > 8980) {
      _pull.copy(state.position).normalize().multiplyScalar(-0.012 * k)
      state.velocity.add(_pull)
    }
    if (dist > 9000) state.position.normalize().multiplyScalar(9000)
  }

  return { ufoStateRef, update }
}
