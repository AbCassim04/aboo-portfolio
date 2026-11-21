import * as THREE from 'three'
import { C_KM_S } from './units'

// ── Ship flight model (true scale) ─────────────────────────────────────────
// Replaces the old scene-unit physics. Units: km, seconds. The ship's
// position and velocity are relative to the floating-origin frame (which
// rides with the host body), so "at rest" means at rest relative to the host.
//
// MANUAL — real speeds that scale with altitude above the nearest surface:
//   v_max = clamp(K_ALT · altitude, V_MIN, MANUAL_CAP)
// (≈ 20 m/s when 200 m from the ISS hull, ~2 400 km/s at the spawn point,
// capped at 1 c). Thrust accelerates at v_max / DRAG_TAU so the terminal
// speed is v_max at every altitude; the old drag / brake / turn time
// constants are kept so the handling feels the same. Above v_max the excess
// decays smoothly (never a jump).
//
// CRUISE — the ship flies along its heading at
//   target = min(CRUISE_CAP, altitude / TAU)            ("open space" rule)
// and, for every surface i it is closing on, the closing speed is limited to
//   (v_ship − v_i) · n̂_i ≤ (d_i − standoff_i) / TAU    ("approach" rule)
// so the gap to each body's standoff sphere shrinks at most exponentially
// with time constant TAU: it is impossible to overshoot or crash. The
// standoff is the body's arrival distance (or a smaller safety shell, see
// FlightMode). The approach rule is a hard limit (a fast brake within one
// frame time constant), the open-space rule a smooth target.
//
// Every update is continuous in speed and position: speed changes go through
// exponential approaches, never assignments.

export const FLIGHT = {
  /** Manual top speed per km of altitude (1/s): 10 % of your altitude per second. */
  K_ALT:       0.1,
  /** Manual floor (km/s): 5 m/s, so you can always move away from anything. */
  V_MIN:       0.005,
  /** Manual ceiling (km/s): 1 c. */
  MANUAL_CAP:  C_KM_S,
  /** CRUISE_CAP (km/s): 100 c. */
  CRUISE_CAP:  100 * C_KM_S,
  /** TAU (s): cruise speed = distance to the nearest surface / TAU. */
  TAU:         1.0,
  /** Manual drag time constant (s) — the old 0.98 per 60 Hz frame. */
  DRAG_TAU:    0.85,
  /** Manual brake time constant (s) — the old 0.95 per frame. */
  BRAKE_TAU:   0.33,
  /** Manual: decay of speed above v_max (s). */
  OVER_TAU:    0.35,
  /** Cruise: approach to a higher target speed (s). */
  ACCEL_TAU:   0.6,
  /** Cruise: approach to a lower target speed (s). */
  DECEL_TAU:   0.5,
  /** Cruise: brake when above the approach (safety) limit (s). */
  SAFE_TAU:    0.12,
  /** Cruise: decay of velocity across the heading (s). */
  LATERAL_TAU: 0.5,
  /** Rotation: the old 0.012 rad/frame² (rad/s²), 0.88/frame drag, 0.04 rad/frame cap. */
  TURN_ACCEL:  43.2,
  TURN_DRAG_TAU: 0.13,
  TURN_CAP:    2.4,
} as const

export interface ShipInput {
  thrust:   number
  brake:    number
  yaw:      number
  pitch:    number
  roll:     number
  vertical: number
  pitchUp:  boolean
  pitchDown: boolean
}

/** Something with a surface, positioned relative to the ship's frame. */
export interface Surface {
  id:       string
  /** Centre, frame-local (km). Owned by the caller. */
  local:    THREE.Vector3
  /** Velocity relative to the frame (km/s). */
  vel:      THREE.Vector3
  /** Surface radius (km). */
  radius:   number
  /** Cruise standoff: closest allowed centre distance (km). */
  standoff: number
  /** Hard surface (planet/star): the ship is never allowed inside it. */
  solid:    boolean
}

export interface CruiseLimit {
  /** What sets the target: 'cap' (100 c), 'open' (altitude / TAU) or 'approach'. */
  kind:   'cap' | 'open' | 'approach' | 'throttle'
  /** Surface responsible (nearest for 'open'; the limiting body for 'approach'). */
  id:     string | null
  /** Resulting target speed (km/s). */
  target: number
}

const _fwd = new THREE.Vector3()
const _up  = new THREE.Vector3()
const _n   = new THREE.Vector3()
const _lat = new THREE.Vector3()
const _ax  = new THREE.Vector3()
const _dq  = new THREE.Quaternion()
const _m   = new THREE.Matrix4()
const _o   = new THREE.Vector3()
const _Y   = new THREE.Vector3(0, 1, 0)
const _X   = new THREE.Vector3(1, 0, 0)

/** Ship orientation whose forward (local −Z) points along unit `f`, level relative to ecliptic north. */
export function quatLookingAlong(f: THREE.Vector3, out: THREE.Quaternion, up: THREE.Vector3 = _Y): THREE.Quaternion {
  // Degenerate when f ∥ up: fall back to +X as up.
  const u = Math.abs(f.dot(up)) > 0.9999 ? _X : up
  _m.lookAt(_o.set(0, 0, 0), f, u)
  return out.setFromRotationMatrix(_m)
}

export class ShipModel {
  /** Frame-local position (km). */
  readonly position = new THREE.Vector3()
  /** Velocity relative to the frame / host (km/s). */
  readonly velocity = new THREE.Vector3()
  readonly quaternion = new THREE.Quaternion()
  /** Body rates (rad/s): x pitch, y yaw, z roll. */
  readonly angularVelocity = new THREE.Vector3()

  // ── Derived, refreshed by sense() ──
  /** Altitude above the nearest surface (km), its id and centre distance. */
  altitude = Infinity
  nearestId = ''
  /** Manual top speed at the current altitude (km/s). */
  vMax: number = FLIGHT.V_MIN
  /** Last cruise limiter (cruise / autopilot only). */
  readonly limit: CruiseLimit = { kind: 'cap', id: null, target: FLIGHT.CRUISE_CAP }

  forward(out: THREE.Vector3): THREE.Vector3 { return out.set(0, 0, -1).applyQuaternion(this.quaternion) }
  up(out: THREE.Vector3): THREE.Vector3 { return out.set(0, 1, 0).applyQuaternion(this.quaternion) }

  /**
   * Altitude above the nearest surface, from the frame-local surfaces. For
   * non-solid things (spacecraft, wireframe markers you can fly through) the
   * altitude is at least half the centre distance, so you never crawl inside one.
   */
  sense(surfaces: readonly Surface[]): void {
    let best = Infinity, id = ''
    for (const s of surfaces) {
      const d = this.position.distanceTo(s.local)
      const alt = s.solid ? d - s.radius : Math.max(d - s.radius, 0.5 * d)
      if (alt < best) { best = alt; id = s.id }
    }
    this.altitude  = Math.max(0, best)
    this.nearestId = id
    this.vMax = Math.min(FLIGHT.MANUAL_CAP, Math.max(FLIGHT.V_MIN, FLIGHT.K_ALT * this.altitude))
  }

  /** Steering from the player's input (body rates with the old feel). */
  rotate(dt: number, inp: ShipInput): void {
    const av = this.angularVelocity
    const a  = FLIGHT.TURN_ACCEL * dt
    av.y -= inp.yaw * a
    av.x -= inp.pitch * a
    av.z -= inp.roll * a
    if (inp.pitchUp)   av.x += a
    if (inp.pitchDown) av.x -= a
    av.multiplyScalar(Math.exp(-dt / FLIGHT.TURN_DRAG_TAU))
    const c = FLIGHT.TURN_CAP
    av.set(Math.max(-c, Math.min(c, av.x)), Math.max(-c, Math.min(c, av.y)), Math.max(-c, Math.min(c, av.z)))
    this.integrateRates(dt)
  }

  private integrateRates(dt: number): void {
    const w = this.angularVelocity.length()
    if (w * dt < 1e-12) return
    _ax.copy(this.angularVelocity).divideScalar(w)
    _dq.setFromAxisAngle(_ax, w * dt)
    this.quaternion.multiply(_dq).normalize()
  }

  /**
   * Turn smoothly toward a target orientation (autopilot / fast travel):
   * exponential approach with time constant `tau`, at most `maxRate` rad/s.
   * Body rates are bled off so manual steering resumes from rest.
   */
  turnToward(target: THREE.Quaternion, dt: number, tau = 0.6, maxRate = 1.2): void {
    const ang = this.quaternion.angleTo(target)
    if (ang > 1e-9) {
      const step = Math.min(ang * (1 - Math.exp(-dt / tau)), maxRate * dt)
      this.quaternion.rotateTowards(target, step)
    }
    this.angularVelocity.multiplyScalar(Math.exp(-dt / FLIGHT.TURN_DRAG_TAU))
  }

  /** MANUAL: altitude-scaled thrust, drag, brake, vertical strafe. Call sense() first. */
  stepManual(dt: number, inp: ShipInput): void {
    this.rotate(dt, inp)
    const vmax = this.vMax
    const acc  = vmax / FLIGHT.DRAG_TAU
    const v    = this.velocity
    this.forward(_fwd)
    this.up(_up)
    if (inp.thrust > 0)    v.addScaledVector(_fwd, acc * inp.thrust * dt)
    if (inp.vertical !== 0) v.addScaledVector(_up, acc * 0.8 * inp.vertical * dt)
    v.multiplyScalar(Math.exp(-dt / FLIGHT.DRAG_TAU))
    if (inp.brake > 0) v.multiplyScalar(Math.exp(-dt * inp.brake / FLIGHT.BRAKE_TAU))
    const s = v.length()
    if (s > vmax) v.multiplyScalar((vmax + (s - vmax) * Math.exp(-dt / FLIGHT.OVER_TAU)) / s)
    this.position.addScaledVector(v, dt)
  }

  /**
   * Cruise speed limits along the current heading (fills this.limit and
   * returns the approach limit).
   */
  cruiseTarget(surfaces: readonly Surface[], throttle: number, extraCap = Infinity, extraId: string | null = null): number {
    this.forward(_fwd)
    const open = Math.min(FLIGHT.CRUISE_CAP, Math.max(FLIGHT.V_MIN, this.altitude / FLIGHT.TAU))
    let safe = Infinity, safeId: string | null = null
    for (const s of surfaces) {
      _n.subVectors(s.local, this.position)
      const d = _n.length()
      if (d < 1e-12) continue
      _n.divideScalar(d)
      const cos = _fwd.dot(_n)
      if (cos <= 1e-4) continue
      const gap = Math.max(0, d - s.standoff)
      const lim = Math.max(0, (gap / FLIGHT.TAU + s.vel.dot(_n)) / cos)
      if (lim < safe) { safe = lim; safeId = s.id }
    }
    let target = open
    let kind: CruiseLimit['kind'] = open >= FLIGHT.CRUISE_CAP ? 'cap' : 'open'
    let id: string | null = kind === 'open' ? this.nearestId : null
    if (safe < target)     { target = safe; kind = 'approach'; id = safeId }
    if (extraCap < target) { target = extraCap; kind = 'approach'; id = extraId }
    if (throttle < 1 && target * throttle < target) { target *= throttle; kind = 'throttle' }
    this.limit.kind = kind; this.limit.id = id; this.limit.target = target
    return Math.min(safe, extraCap)
  }

  /**
   * CRUISE: fly along the heading at the cruise target speed. `steer` turns
   * the ship from input (manual cruise); autopilot turns it itself and passes
   * null. `extraCap` adds a speed cap (autopilot: distance to the aim point / TAU).
   */
  stepCruise(dt: number, surfaces: readonly Surface[], throttle: number, steer: ShipInput | null,
    extraCap = Infinity, extraId: string | null = null): void {
    if (steer) this.rotate(dt, steer)
    const safe   = this.cruiseTarget(surfaces, throttle, extraCap, extraId)
    const target = this.limit.target
    const v = this.velocity
    this.forward(_fwd)
    let along = v.dot(_fwd)
    _lat.copy(v).addScaledVector(_fwd, -along)
    if (target > along) along += (target - along) * (1 - Math.exp(-dt / FLIGHT.ACCEL_TAU))
    else along = Math.max(target, along * Math.exp(-dt / FLIGHT.DECEL_TAU))
    // Hard approach limit: brake within SAFE_TAU (continuous, never a jump).
    if (along > safe) along = Math.max(safe, along * Math.exp(-dt / FLIGHT.SAFE_TAU))
    _lat.multiplyScalar(Math.exp(-dt / FLIGHT.LATERAL_TAU))
    v.copy(_fwd).multiplyScalar(along).add(_lat)
    this.position.addScaledVector(v, dt)
  }

  /** Coast with velocity decaying (time constant tau): used for safe drop-outs. */
  stepCoast(dt: number, tau: number): void {
    this.velocity.multiplyScalar(Math.exp(-dt / tau))
    this.position.addScaledVector(this.velocity, dt)
    this.angularVelocity.multiplyScalar(Math.exp(-dt / FLIGHT.TURN_DRAG_TAU))
    this.integrateRates(dt)
  }

  /**
   * Hard backstop: keep the ship outside solid surfaces (removes the inward
   * velocity). Returns true if it had to act (should never happen in cruise).
   */
  keepOutside(surfaces: readonly Surface[], margin: (s: Surface) => number): boolean {
    let acted = false
    for (const s of surfaces) {
      if (!s.solid) continue
      const min = s.radius + margin(s)
      _n.subVectors(this.position, s.local)
      const d = _n.length()
      if (d >= min || d < 1e-12) continue
      _n.divideScalar(d)
      this.position.copy(s.local).addScaledVector(_n, min)
      const dot = this.velocity.dot(_n)
      if (dot < 0) this.velocity.addScaledVector(_n, -dot)
      acted = true
    }
    return acted
  }
}

/** True if the player is giving any flight input (cancels autopilot). */
export function hasManualInput(inp: ShipInput): boolean {
  return inp.thrust > 0 || inp.brake > 0 || inp.yaw !== 0 || inp.pitch !== 0 || inp.roll !== 0
    || inp.vertical !== 0 || inp.pitchUp || inp.pitchDown
}
