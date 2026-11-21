import * as THREE from 'three'
import { BODY_PHYSICAL, bodyPole } from '../space/ephemeris'

// ── Decorative spacecraft positions (pure functions of sim time) ───────────
// Pure so navigation can predict where they will be (fast travel aims at the
// arrival-time position) and take exact velocities.
//
// ISS: circular orbit at 420 km, 51.6° to Earth's equator, real 92.7 min
// period, node fixed in inertial space (decorative — the real node regresses
// ~5°/day; Live Sky will make it real).
// JWST: Sun–Earth L2, 1.5 million km anti-sunward of Earth, on a slow
// decorative halo.

export const ISS_ALTITUDE_KM = 420
export const ISS_PERIOD_S    = 92.7 * 60
const ISS_INCLINATION        = 51.6 * Math.PI / 180
export const JWST_L2_KM      = 1.5e6
const JWST_HALO_KM           = 250_000
const JWST_HALO_DAYS         = 180

const _p = new THREE.Vector3()
const _n = new THREE.Vector3()
const _a = new THREE.Vector3()
const _b = new THREE.Vector3()
const _u = new THREE.Vector3()
const _w = new THREE.Vector3()
const X  = new THREE.Vector3(1, 0, 0)
const Y  = new THREE.Vector3(0, 1, 0)

export interface IssFrame {
  /** Unit radial direction from Earth, orbit normal, along-track direction. */
  radial: THREE.Vector3
  normal: THREE.Vector3
  along:  THREE.Vector3
}

export function createIssFrame(): IssFrame {
  return { radial: new THREE.Vector3(), normal: new THREE.Vector3(), along: new THREE.Vector3() }
}

/** ISS world position (km) given Earth's world position at the same sim time. */
export function issWorldAt(simMs: number, earthWorld: THREE.Vector3, out: THREE.Vector3, frame?: IssFrame): THREE.Vector3 {
  bodyPole('earth', simMs, _p)
  _n.copy(X).addScaledVector(_p, -X.dot(_p)).normalize()            // ascending node (inertial)
  _b.crossVectors(_n, _p)
  _a.copy(_p).multiplyScalar(Math.cos(ISS_INCLINATION)).addScaledVector(_b, Math.sin(ISS_INCLINATION))  // orbit normal
  const th = (((simMs / 1000) % ISS_PERIOD_S) / ISS_PERIOD_S) * Math.PI * 2
  _b.crossVectors(_a, _n)                                           // in-plane, 90° ahead of the node
  _u.copy(_n).multiplyScalar(Math.cos(th)).addScaledVector(_b, Math.sin(th))
  if (frame) {
    frame.radial.copy(_u)
    frame.normal.copy(_a)
    frame.along.crossVectors(_a, _u)
  }
  return out.copy(earthWorld).addScaledVector(_u, BODY_PHYSICAL.earth.radius + ISS_ALTITUDE_KM)
}

/** JWST world position (km) given Earth's world position at the same sim time. */
export function jwstWorldAt(simMs: number, earthWorld: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  _u.copy(earthWorld).normalize()                                   // anti-sunward
  _w.crossVectors(Y, _u).normalize()
  const ph = (simMs / 86_400_000 / JWST_HALO_DAYS) * Math.PI * 2
  out.copy(earthWorld).addScaledVector(_u, JWST_L2_KM).addScaledVector(_w, Math.cos(ph) * JWST_HALO_KM)
  out.y += Math.sin(ph) * JWST_HALO_KM * 0.6
  return out
}
