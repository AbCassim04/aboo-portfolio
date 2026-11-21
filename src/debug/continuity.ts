import * as THREE from 'three'

// ── Camera continuity monitor (debug hook only) ────────────────────────────
// Acceptance: the camera's per-frame movement never exceeds its expected
// movement (velocity × dt) by more than 1 % — no single-frame jumps, ever.
//
// Measured relative to the body the frame rode with during the frame (the
// "step host" H), which is what the eye sees and keeps the test sensitive
// (in the heliocentric frame a jump would hide inside Earth's 30 km/s):
//
//   actual   = |(cam − H)ₙ − (cam − H)ₙ₋₁|
//   expected = |ship term + rig term + entry term|
//
// ship term: what the flight integrator applied over the frame (velocity
// after the step × dt for manual/cruise/autopilot/coast; the mean of the
// analytic path velocities at both ends × dt for fast travel); rig term:
// camera-offset spring velocity × dt; entry term: the entry sweep's analytic
// velocity (trapezoid). ratio = actual / (expected + 1 cm); a frame is
// flagged if ratio > 1.01 (the 1 cm absorbs float64 rounding of
// heliocentric positions when at rest).
//
// Events (mode / camera / host changes, fast-travel start / end / cancel) get
// the worst ratio over a window of frames starting at the event.

export interface ContinuityEvent {
  type: string; detail: string; frame: number; maxRatio: number; maxErrRatio: number; frames: number
}

const ABS_TOL_KM = 1e-5
const RATIO_LIMIT = 1.01
const EVENT_WINDOW = 6
const MAX_EVENTS = 200

export class ContinuityMonitor {
  frame = 0
  checked = 0
  flagged = 0
  maxRatio = 0
  maxErrRatio = 0
  worst: Record<string, unknown> | null = null
  readonly events: ContinuityEvent[] = []
  /** The last flagged samples, with context. */
  readonly flaggedLog: Record<string, unknown>[] = []
  private readonly open: ContinuityEvent[] = []
  private readonly prevRel = new THREE.Vector3()
  private prevValid = false
  private readonly _d = new THREE.Vector3()

  /** Forget the previous sample (deliberate discontinuity: spawn / dev teleport). */
  invalidate(): void { this.prevValid = false }

  reset(): void {
    this.checked = this.flagged = 0
    this.maxRatio = this.maxErrRatio = 0
    this.worst = null
    this.events.length = 0
    this.open.length = 0
    this.flaggedLog.length = 0
  }

  event(type: string, detail: string): void {
    const e: ContinuityEvent = { type, detail, frame: this.frame, maxRatio: 0, maxErrRatio: 0, frames: 0 }
    this.events.push(e)
    if (this.events.length > MAX_EVENTS) this.events.shift()
    this.open.push(e)
  }

  /**
   * @param relNow   camera − step host, now (km)
   * @param expected expected displacement relative to the step host (km)
   * @param relNext  camera − current host (after any switch), stored for the next frame
   */
  sample(relNow: THREE.Vector3, expected: THREE.Vector3, relNext: THREE.Vector3, ctx: () => Record<string, unknown>): void {
    this.frame++
    if (this.prevValid) {
      this._d.subVectors(relNow, this.prevRel)
      const actual = this._d.length()
      const exp    = expected.length()
      // ratio = actual / (expected + 1 cm): the centimetre absorbs float64
      // rounding of heliocentric positions when (nearly) at rest.
      const ratio  = actual / (exp + ABS_TOL_KM)
      const err    = this._d.sub(expected).length() / (exp + ABS_TOL_KM)
      this.checked++
      const bad = ratio > RATIO_LIMIT
      if (bad) {
        this.flagged++
        this.flaggedLog.push({ frame: this.frame, ratio, actualKm: actual, expectedKm: exp, ...ctx() })
        if (this.flaggedLog.length > 30) this.flaggedLog.shift()
      }
      if (ratio > this.maxRatio) {
        this.maxRatio = ratio
        this.worst = { frame: this.frame, ratio, actualKm: actual, expectedKm: exp, ...ctx() }
      }
      this.maxErrRatio = Math.max(this.maxErrRatio, err)
      const r = ratio, e = err
      for (let i = this.open.length - 1; i >= 0; i--) {
        const ev = this.open[i]
        ev.maxRatio = Math.max(ev.maxRatio, r)
        ev.maxErrRatio = Math.max(ev.maxErrRatio, e)
        ev.frames++
        if (ev.frames >= EVENT_WINDOW) this.open.splice(i, 1)
      }
    }
    this.prevRel.copy(relNext)
    this.prevValid = true
  }

  summary(): Record<string, unknown> {
    return {
      frames: this.frame, checked: this.checked, flagged: this.flagged,
      maxRatio: this.maxRatio, maxErrRatio: this.maxErrRatio, worst: this.worst, flaggedLog: this.flaggedLog.map(e => ({ ...e })),
      events: this.events.map(e => ({ ...e })),
    }
  }
}
