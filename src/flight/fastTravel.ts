import * as THREE from 'three'

// ── Fast travel ────────────────────────────────────────────────────────────
// Any distance in FAST_TRAVEL_SECONDS. The path is expressed relative to the
// target's moving centre C(t):
//
//   P(t) = C(t) + ρ(s)·dir(s) + D(t),   s = t / T
//
// • Radial distance ρ eases in two-sided log space: with u ∈ [0,1] the radial
//   progress, q(u) = ln(1 + u·L/εA) − ln(1 + (1−u)·L/εB) (L = |ρA − ρ0|) runs
//   linearly in a C² ease of time, so the distance from the start grows
//   exponentially (you leave quickly) and the distance to the arrival point
//   shrinks exponentially (you decelerate as you arrive, and the target grows
//   from a dot into a disc). εA is the departure scale, εB the arrival scale.
// • The direction sweeps from the start direction to the arrival direction
//   (slerp through an intermediate direction M), paced by log-distance
//   progress, so swinging round to the sunlit side happens on a sphere around
//   the target that never comes closer than the arrival distance.
// • D(t) = Δv·τ·(1 − e^(−t/τ))·(1 − E(s)) carries the ship's velocity at the
//   start (relative to C) and fades out, so speed never jumps when a jump
//   begins (even with the sim clock at ×86 400, where "at rest near Earth"
//   means moving millions of km per second relative to the target).
// • Because the path rides with C(t), it arrives exactly at the target's
//   position at the arrival time, moving with it (zero relative speed).
//
// Planning tries a set of sweeps (shortest arc, long way round, over the
// poles; early / even / late timing) and samples each against every body at
// the sim times it would pass them (predicted positions), keeping the
// preferred one that stays clear (≥ PLAN_CLEARANCE radii), else the clearest.

export const FAST_TRAVEL_SECONDS = 6
/** Planner margin (radii); the acceptance floor is 1.1. */
const PLAN_CLEARANCE = 1.3
const SAMPLES = 180
const DRIFT_TAU = 0.4

export interface Obstacle {
  id:     string
  radius: number
  /** World position at a sim time. */
  at:     (simMs: number, out: THREE.Vector3) => THREE.Vector3
}

/** Quintic smootherstep: zero velocity and acceleration at both ends. */
function ease5(s: number): number {
  const x = Math.min(1, Math.max(0, s))
  return x * x * x * (x * (x * 6 - 15) + 10)
}
function smoothstep(x: number): number {
  const t = Math.min(1, Math.max(0, x))
  return t * t * (3 - 2 * t)
}

const _a = new THREE.Vector3()
const _b = new THREE.Vector3()
const _c = new THREE.Vector3()
const _d = new THREE.Vector3()
const _q = new THREE.Quaternion()

/** Rotate unit `from` toward unit `to` by fraction f (slerp, stable for antiparallel via `fallbackAxis`). */
function slerpDir(from: THREE.Vector3, to: THREE.Vector3, f: number, fallbackAxis: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  const cos = Math.min(1, Math.max(-1, from.dot(to)))
  const ang = Math.acos(cos)
  if (ang < 1e-9) return out.copy(from)
  _a.crossVectors(from, to)
  if (_a.lengthSq() < 1e-16) _a.copy(fallbackAxis)
  _a.normalize()
  _q.setFromAxisAngle(_a, ang * f)
  return out.copy(from).applyQuaternion(_q)
}

export interface SweepChoice { label: string; mid: THREE.Vector3; pow: number }

export class FastTravel {
  active = false
  /** 'jump' while travelling; 'dropout' while coasting out of a cancelled jump. */
  phase: 'jump' | 'dropout' = 'jump'
  targetId = ''
  /** Elapsed / total (s). */
  t = 0
  readonly T = FAST_TRAVEL_SECONDS
  /** Planned minimum clearance (radii) and the body it is against. */
  plannedClearance = Infinity
  plannedClearanceId = ''
  sweepLabel = ''

  private rho0 = 1
  private rhoA = 1
  private L = 0
  private epsA = 1
  private epsB = 1
  private q0 = 0
  private q1 = 0
  private logSpan = 0
  private readonly dir0 = new THREE.Vector3()
  private readonly dirA = new THREE.Vector3()
  private readonly mid  = new THREE.Vector3()
  private readonly fallback = new THREE.Vector3(0, 1, 0)
  private pow = 1
  private readonly driftV = new THREE.Vector3()
  /** Final look direction (world). */
  readonly look = new THREE.Vector3()
  /** Arrival offset from the centre (world, km). */
  readonly arrivalOffset = new THREE.Vector3()

  /**
   * Plan a jump.
   * @param start      ship world position now
   * @param startVel   ship world velocity now (km/s)
   * @param centreNow  target centre world position now
   * @param centreVel  target centre world velocity now (km/s)
   * @param arrival    arrival offset from the centre at the arrival time (km)
   * @param look       look direction at arrival
   * @param depScale   departure scale εA (km): roughly the distance to the nearest surface
   * @param centreAt   predicted centre position at a sim time
   * @param simMs0     sim time now; `simRate` sim seconds per real second
   * @param obstacles  bodies to stay clear of
   */
  plan(targetId: string, start: THREE.Vector3, startVel: THREE.Vector3, centreNow: THREE.Vector3, centreVel: THREE.Vector3,
    arrival: THREE.Vector3, look: THREE.Vector3, depScale: number,
    centreAt: (simMs: number, out: THREE.Vector3) => THREE.Vector3,
    simMs0: number, simRate: number, obstacles: readonly Obstacle[]): void {
    this.active = true
    this.phase = 'jump'
    this.targetId = targetId
    this.t = 0
    this.arrivalOffset.copy(arrival)
    this.look.copy(look).normalize()
    _b.subVectors(start, centreNow)
    this.rho0 = Math.max(_b.length(), 1e-6)
    this.dir0.copy(_b).divideScalar(this.rho0)
    this.rhoA = Math.max(arrival.length(), 1e-6)
    this.dirA.copy(arrival).divideScalar(this.rhoA)
    this.L = Math.abs(this.rhoA - this.rho0)
    this.epsA = Math.max(1e-3, Math.min(depScale, this.L))
    this.epsB = Math.max(1e-3, Math.min(this.rhoA * 0.5, this.L))
    this.q0 = -Math.log1p(this.L / this.epsB)
    this.q1 = Math.log1p(this.L / this.epsA)
    this.logSpan = Math.log(this.rho0 / this.rhoA)
    this.driftV.subVectors(startVel, centreVel)

    // Candidate sweeps: shortest arc, the long way, over either pole of the
    // plane containing both directions; each with even / early / late timing.
    _c.addVectors(this.dir0, this.dirA)
    if (_c.lengthSq() < 1e-8) _c.set(0, 1, 0).addScaledVector(this.dir0, -this.dir0.y)
    const shortMid = _c.clone().normalize()
    _d.crossVectors(this.dir0, this.dirA)
    if (_d.lengthSq() < 1e-12) _d.set(0, 1, 0).cross(this.dir0)
    if (_d.lengthSq() < 1e-12) _d.set(1, 0, 0)
    _d.normalize()
    const north = _d.clone().multiplyScalar(_d.y >= 0 ? 1 : -1)
    const mids: [string, THREE.Vector3][] = [
      ['short', shortMid],
      ['north', shortMid.clone().add(north.clone().multiplyScalar(1.2)).normalize()],
      ['south', shortMid.clone().add(north.clone().multiplyScalar(-1.2)).normalize()],
      ['long',  shortMid.clone().negate()],
    ]
    const pows = [1, 0.45, 2.2]
    const T = this.T
    // Predicted obstacle and centre positions per sample time.
    const simAt = (k: number) => simMs0 + (k / SAMPLES) * T * 1000 * simRate
    const centres: THREE.Vector3[] = []
    const obsPos: THREE.Vector3[][] = []
    for (let k = 0; k <= SAMPLES; k++) {
      centres.push(centreAt(simAt(k), new THREE.Vector3()))
      obsPos.push(obstacles.map(o => o.at(simAt(k), new THREE.Vector3())))
    }
    let best: { clr: number; id: string; label: string; mid: THREE.Vector3; pow: number } | null = null
    const p0 = new THREE.Vector3(), p1 = new THREE.Vector3(), rel = new THREE.Vector3()
    outer:
    for (const [label, mid] of mids) {
      for (const pow of pows) {
        this.mid.copy(mid); this.pow = pow
        let clr = Infinity, clrId = ''
        for (let k = 0; k <= SAMPLES; k++) {
          this.relAt((k / SAMPLES) * T, rel)
          p1.copy(centres[k]).add(rel)
          if (k > 0) {
            // Segment p0→p1 against each obstacle (positions at sample k).
            for (let i = 0; i < obstacles.length; i++) {
              const o = obsPos[k][i]
              _a.subVectors(p1, p0)
              const len2 = _a.lengthSq()
              const tt = len2 > 0 ? Math.min(1, Math.max(0, _b.subVectors(o, p0).dot(_a) / len2)) : 0
              const d = _b.copy(p0).addScaledVector(_a, tt).distanceTo(o) / obstacles[i].radius
              if (d < clr) { clr = d; clrId = obstacles[i].id }
            }
          }
          p0.copy(p1)
        }
        if (!best || clr > best.clr) best = { clr, id: clrId, label: `${label}/${pow}`, mid: mid.clone(), pow }
        if (clr >= PLAN_CLEARANCE) { best = { clr, id: clrId, label: `${label}/${pow}`, mid: mid.clone(), pow }; break outer }
      }
    }
    this.mid.copy(best!.mid)
    this.pow = best!.pow
    this.plannedClearance = best!.clr
    this.plannedClearanceId = best!.id
    this.sweepLabel = best!.label
  }

  /** Radial progress u ∈ [0,1] at elapsed time te. */
  private progressAt(te: number): number {
    const E = ease5(te / this.T)
    const q = this.q0 + (this.q1 - this.q0) * E
    if (E <= 0) return 0
    if (E >= 1) return 1
    let lo = 0, hi = 1
    for (let i = 0; i < 60; i++) {
      const u = 0.5 * (lo + hi)
      const qu = Math.log1p(u * this.L / this.epsA) - Math.log1p((1 - u) * this.L / this.epsB)
      if (qu < q) lo = u; else hi = u
    }
    return 0.5 * (lo + hi)
  }

  /** Position relative to the target centre at elapsed time te (world axes, km). */
  relAt(te: number, out: THREE.Vector3): THREE.Vector3 {
    const u   = this.progressAt(te)
    const rho = this.rho0 + (this.rhoA - this.rho0) * u
    // Sweep progress: log-distance progress (or radial progress if ρ barely changes).
    const w   = Math.abs(this.logSpan) > 0.7 ? Math.log(this.rho0 / rho) / this.logSpan : u
    const ws  = Math.pow(smoothstep(w), this.pow)
    if (ws < 0.5) slerpDir(this.dir0, this.mid, ws * 2, this.fallback, out)
    else slerpDir(this.mid, this.dirA, ws * 2 - 1, this.fallback, out)
    out.multiplyScalar(rho)
    const s = te / this.T
    const drift = DRIFT_TAU * (1 - Math.exp(-te / DRIFT_TAU)) * (1 - ease5(s))
    return out.addScaledVector(this.driftV, drift)
  }

  /** d(rel)/dt at te (km/s), central difference (one-sided at the ends). */
  relVelAt(te: number, out: THREE.Vector3): THREE.Vector3 {
    const h = 1e-4
    const t1 = Math.min(this.T, te + h), t0 = Math.max(0, te - h)
    this.relAt(t1, out)
    this.relAt(t0, _c)
    return out.sub(_c).divideScalar(t1 - t0)
  }

  /** Progress 0..1 of the jump. */
  get progress(): number { return Math.min(1, this.t / this.T) }

  /** Warp intensity for star streaks / audio (0 at the ends, peak mid-jump). */
  get warp(): number {
    if (!this.active || this.phase !== 'jump') return 0
    const s = this.progress
    return smoothstep(s / 0.18) * (1 - smoothstep((s - 0.8) / 0.17))
  }
}
