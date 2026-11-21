import * as THREE from 'three'

// ── Portfolio zone & spawn ──────────────────────────────────────────────────
// A deliberately non-realistic, compact zone near Earth holding the portfolio
// destinations (About / Skills / Projects / Contact) and the M87* portal.
//
// Everything is laid out in a frame tied to the Sun–Earth line, so the
// arrangement looks the same on any date: the spawn point sits SPAWN_DISTANCE
// from Earth's centre at a Sun–Earth–spawn angle of SPAWN_PHASE (so Earth is
// seen two-thirds lit, terminator and city lights included), in the ecliptic
// plane. From the spawn, "forward" looks at Earth; destinations are placed by
// range / azimuth / elevation in that view so they are visible from spawn,
// to the right of Earth and nearer than it. The frame rides with Earth and
// turns with the Sun direction (~1°/day).

export const SPAWN_DISTANCE_KM = 30_000
export const SPAWN_PHASE_DEG   = 70
/** Destination geometry: old scene unit → km (markers ~250–520 km across). */
export const MARKER_KM_PER_UNIT = 400

export interface ZoneFrame {
  /** Spawn point (world, km). */
  spawn:   THREE.Vector3
  /** Unit vectors: toward Earth from spawn, right, up. */
  forward: THREE.Vector3
  right:   THREE.Vector3
  up:      THREE.Vector3
}

export function createZoneFrame(): ZoneFrame {
  return { spawn: new THREE.Vector3(), forward: new THREE.Vector3(), right: new THREE.Vector3(), up: new THREE.Vector3() }
}

const _s = new THREE.Vector3()
const _t = new THREE.Vector3()
const Y  = new THREE.Vector3(0, 1, 0)

/** Frame for Earth at `earthWorld` (Sun at the origin). Allocation-free. */
export function computeZoneFrame(earthWorld: THREE.Vector3, out: ZoneFrame): ZoneFrame {
  // Sunward direction projected on the ecliptic plane, and the in-plane normal.
  _s.copy(earthWorld).negate().setY(0).normalize()
  _t.crossVectors(Y, _s)
  const ph = SPAWN_PHASE_DEG * Math.PI / 180
  // Spawn direction from Earth.
  out.forward.copy(_s).multiplyScalar(Math.cos(ph)).addScaledVector(_t, Math.sin(ph))
  out.spawn.copy(earthWorld).addScaledVector(out.forward, SPAWN_DISTANCE_KM)
  out.forward.negate()                                // spawn → Earth
  out.right.crossVectors(out.forward, Y).normalize()
  out.up.crossVectors(out.right, out.forward)
  return out
}

/** Point at `rangeKm` from the spawn in view direction (azimuth right +, elevation up +). */
export function zoneViewPoint(f: ZoneFrame, rangeKm: number, azDeg: number, elDeg: number, out: THREE.Vector3): THREE.Vector3 {
  const az = azDeg * Math.PI / 180, el = elDeg * Math.PI / 180
  return out.copy(f.spawn)
    .addScaledVector(f.forward, rangeKm * Math.cos(el) * Math.cos(az))
    .addScaledVector(f.right,   rangeKm * Math.cos(el) * Math.sin(az))
    .addScaledVector(f.up,      rangeKm * Math.sin(el))
}

/** Direction (unit) for azimuth/elevation in the zone view. */
export function zoneViewDir(f: ZoneFrame, azDeg: number, elDeg: number, out: THREE.Vector3): THREE.Vector3 {
  const az = azDeg * Math.PI / 180, el = elDeg * Math.PI / 180
  return out.copy(f.forward).multiplyScalar(Math.cos(el) * Math.cos(az))
    .addScaledVector(f.right, Math.cos(el) * Math.sin(az))
    .addScaledVector(f.up, Math.sin(el))
}

/** Where each destination sits, seen from the spawn (Earth is at azimuth 0). */
export const ZONE_PLACEMENT: Record<string, { range: number; az: number; el: number }> = {
  CONTACT:  { range:  8_500, az: 27, el: -5 },
  ABOUT:    { range:  9_500, az: 24, el:  3 },
  PROJECTS: { range: 11_000, az: 15, el: 10 },
  SKILLS:   { range: 12_500, az: 31, el: 13 },
  'M87*':   { range: 16_000, az: 37, el: 17 },
}

/** Initial heading from the spawn: Earth sits ~13° left of centre, the zone to the right. */
export const SPAWN_VIEW = { az: 13, el: 5 }
