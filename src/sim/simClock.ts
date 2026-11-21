// ── Shared simulation clock ─────────────────────────────────────────────────
// Single source of "what time is it in the simulation". Everything that depends
// on real-world time (Earth rotation, seasons, Moon phase today; a full orbital
// system later) reads from here instead of from Date.now(), so time controls
// apply everywhere at once.
//
// Model: simulated time advances linearly from an anchor —
//   simMs = anchorSim + (Date.now() − anchorReal) · speed
// and is re-anchored whenever the speed or pause state changes, so changes are
// continuous (no jumps). "Live" means locked to the wall clock at speed ×1.
//
// Reads are allocation-free (getSimTimeMs); state changes notify subscribers,
// which makes this usable with React's useSyncExternalStore.

export interface SimClockState {
  /** Following the wall clock (speed ×1, not paused). */
  readonly live:   boolean
  readonly paused: boolean
  /** Simulated seconds per real second. */
  readonly speed:  number
}

type Listener = () => void

let anchorReal = Date.now()
let anchorSim  = anchorReal
let speed      = 1
let paused     = false
let live       = true
let state: SimClockState = { live, paused, speed }
const listeners = new Set<Listener>()

function commit(): void {
  state = { live, paused, speed }
  for (const l of listeners) l()
}

function reanchor(): void {
  const now = Date.now()
  anchorSim  = getSimTimeMs()
  anchorReal = now
}

/** Current simulated time, Unix epoch milliseconds. Allocation-free. */
export function getSimTimeMs(): number {
  if (live)   return Date.now()
  if (paused) return anchorSim
  return anchorSim + (Date.now() - anchorReal) * speed
}

/** Current simulated time as a Date (allocates — not for per-frame use). */
export function getSimDate(): Date {
  return new Date(getSimTimeMs())
}

/** Snapshot of the clock controls. Stable reference until the next change. */
export function getSimClockState(): SimClockState {
  return state
}

/** Return to real time: sim = wall clock, ×1, running. */
export function goLive(): void {
  live = true; paused = false; speed = 1
  anchorReal = anchorSim = Date.now()
  commit()
}

/** Run at `multiplier` sim-seconds per real second from the current sim time. */
export function setSpeed(multiplier: number): void {
  reanchor()
  speed  = multiplier
  paused = false
  live   = false
  commit()
}

export function pause(): void {
  if (paused) return
  reanchor()
  paused = true
  live   = false
  commit()
}

export function resume(): void {
  if (!paused) return
  anchorReal = Date.now()
  paused = false
  commit()
}

export function togglePause(): void {
  if (paused) resume()
  else pause()
}

/** Jump to an absolute sim time (keeps the current speed / pause state). */
export function setSimTime(ms: number): void {
  anchorSim  = ms
  anchorReal = Date.now()
  live       = false
  commit()
}

/** Subscribe to control changes (not ticks). Returns an unsubscribe function. */
export function subscribeSimClock(listener: Listener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
