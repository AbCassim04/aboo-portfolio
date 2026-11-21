import * as THREE from 'three'
import { FLIGHT, quatLookingAlong } from './shipModel'
import type { ShipModel, Surface } from './shipModel'

// ── Autopilot ──────────────────────────────────────────────────────────────
// Flies to the target's arrival point with the CRUISE model (so it inherits
// cruise's guarantee: the gap to every standoff sphere only ever shrinks
// exponentially), turning smoothly, and finally settles onto the arrival
// point with a critically damped spring, facing the arrival look direction.
//
// Steering: aim at the arrival point A unless the straight line to it passes
// through a keep-out sphere (the target's arrival sphere when approaching
// from its far side, or any other body's safety shell) — then aim at a
// detour point beside that sphere, recomputed every frame, so the ship
// curves around and reaches A from the outside. Speed is reduced while the
// ship is not yet facing where it wants to go.

const TURN_TAU   = 0.55
const TURN_RATE  = 1.5
const SETTLE_OMEGA = 2.2
/** Enter the settle phase within this fraction of the arrival distance. */
const SETTLE_FRAC = 0.02

const _toA  = new THREE.Vector3()
const _dir  = new THREE.Vector3()
const _fwd  = new THREE.Vector3()
const _q    = new THREE.Quaternion()
const _cp   = new THREE.Vector3()
const _n    = new THREE.Vector3()
const _acc  = new THREE.Vector3()

export interface AutopilotGoal {
  /** Arrival point and target centre (frame-local, km). */
  arrival: THREE.Vector3
  centre:  THREE.Vector3
  /** Arrival distance from the centre (km). */
  arrivalDist: number
  /** Look direction at arrival (world axes). */
  look:    THREE.Vector3
  /** Velocity of the arrival point relative to the frame (km/s). */
  vel:     THREE.Vector3
  /** Target surface id (its standoff is the arrival distance), or null for points in space. */
  targetSurface: string | null
  /** Steering keep-out radius for a surface (0 = ignore). */
  keepOut: (s: Surface) => number
}

export class Autopilot {
  active = false
  phase: 'cruise' | 'settle' = 'cruise'
  targetId = ''
  /** Current aim (frame-local) and whether it is a detour point. */
  readonly aim = new THREE.Vector3()
  detour: string | null = null
  elapsed = 0

  start(targetId: string): void {
    this.active = true
    this.phase = 'cruise'
    this.targetId = targetId
    this.detour = null
    this.elapsed = 0
  }

  stop(): void { this.active = false; this.detour = null }

  /**
   * One frame. Returns true once arrived (settled). `surfaces` must have their
   * standoffs set for this target (the target's = its arrival distance).
   */
  step(dt: number, ship: ShipModel, surfaces: readonly Surface[], goal: AutopilotGoal): boolean {
    this.elapsed += dt
    const p = ship.position
    _toA.subVectors(goal.arrival, p)
    const distA = _toA.length()

    if (this.phase === 'cruise' && distA < Math.max(SETTLE_FRAC * goal.arrivalDist, 0.002)) this.phase = 'settle'

    if (this.phase === 'settle') {
      // Critically damped spring onto the (moving) arrival point.
      _acc.copy(_toA).multiplyScalar(SETTLE_OMEGA * SETTLE_OMEGA)
        .addScaledVector(_n.subVectors(ship.velocity, goal.vel), -2 * SETTLE_OMEGA)
      ship.velocity.addScaledVector(_acc, dt)
      p.addScaledVector(ship.velocity, dt)
      quatLookingAlong(_dir.copy(goal.look).normalize(), _q)
      ship.turnToward(_q, dt, TURN_TAU, TURN_RATE)
      ship.limit.kind = 'approach'; ship.limit.id = goal.targetSurface; ship.limit.target = 0
      const relV = _n.subVectors(ship.velocity, goal.vel).length()
      const done = distA < Math.max(1e-4 * goal.arrivalDist, 2e-6) && relV < Math.max(1e-4 * goal.arrivalDist, 1e-5)
      return done || (this.elapsed > 1 && distA < 1e-3 * goal.arrivalDist && relV < 1e-3 * goal.arrivalDist && ship.quaternion.angleTo(_q) < 0.01)
    }

    // Detour if the straight line to A passes through a keep-out sphere.
    this.detour = null
    this.aim.copy(goal.arrival)
    let worst = 0
    for (const s of surfaces) {
      const K = goal.keepOut(s)
      if (K <= 0) continue
      _cp.subVectors(s.local, p)
      const t = distA > 0 ? Math.min(1, Math.max(0, _cp.dot(_toA) / (distA * distA))) : 0
      _cp.copy(p).addScaledVector(_toA, t)            // closest point on the segment
      const d = _cp.distanceTo(s.local)
      if (d >= K) continue
      const depth = (K - d) / K
      if (depth <= worst) continue
      worst = depth
      _n.subVectors(_cp, s.local)
      if (_n.lengthSq() < 1e-12 * K * K) _n.set(0, 1, 0).addScaledVector(_toA, -_toA.y / Math.max(distA * distA, 1e-30))
      _n.normalize()
      this.aim.copy(s.local).addScaledVector(_n, K * 1.45)
      this.detour = s.id
    }

    _dir.subVectors(this.aim, p)
    const distAim = _dir.length()
    if (distAim > 1e-12) _dir.divideScalar(distAim)
    quatLookingAlong(_dir, _q)
    ship.turnToward(_q, dt, TURN_TAU, TURN_RATE)
    ship.forward(_fwd)
    const facing = Math.max(0, _fwd.dot(_dir))
    const throttle = facing * facing * facing * facing
    // Final approach: cap the speed by the distance to A (exponential approach).
    const cap = this.detour ? Infinity : Math.max(distA, 0) / FLIGHT.TAU
    ship.stepCruise(dt, surfaces, throttle, null, cap, goal.targetSurface)
    return false
  }

  /** Rough time to arrival (s) at distance `d` (km) to the arrival point. */
  static etaS(d: number, arrivalDist: number): number {
    const dSettle = Math.max(SETTLE_FRAC * arrivalDist, 0.002)
    const capD = FLIGHT.CRUISE_CAP * FLIGHT.TAU
    const settle = 3.5 / SETTLE_OMEGA
    if (d <= dSettle) return settle * Math.min(1, d / dSettle)
    if (d > capD) return (d - capD) / FLIGHT.CRUISE_CAP + FLIGHT.TAU * (1 + Math.log(capD / dSettle)) + settle
    return FLIGHT.TAU * Math.log(d / dSettle) + settle
  }
}
