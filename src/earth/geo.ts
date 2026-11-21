import * as THREE from 'three'

// ── Earth-local geographic frame ────────────────────────────────────────────
//
// VERIFIED CONVENTION (scripts/verify-earth.ts checks every line of this):
//
// three.js SphereGeometry (phiStart = 0, phiLength = 2π) places a vertex with
// texture coordinate (u, v) at
//     x = −cos(2πu)·sinθ,  y = cosθ,  z = sin(2πu)·sinθ,   θ = π·(1 − v)
// so u = 0 → −X, u = 0.25 → +Z, u = 0.5 → +X, u = 0.75 → −Z, v = 1 → +Y.
//
// The Earth textures in public/earth are standard equirectangular maps:
// u = 0 at 180°W, u = 0.5 at the Greenwich meridian, u increasing eastward;
// top row (v = 1 after the default flipY) at 90°N. Hence lon = 360°·u − 180°,
// lat = 90° − 180°·(1 − v), and in the Earth mesh's local space:
//
//     lon   0°      → +X        lat +90° (North Pole) → +Y
//     lon  90°E     → −Z        lat −90° (South Pole) → −Y
//     lon  90°W     → +Z
//     lon 180°      → −X
//
//     local(lat, lon) = ( cos lat · cos lon,  sin lat,  −cos lat · sin lon )
//
// This matches the view from outside (east to the right when north is up), so
// the maps are not mirrored. The same convention holds for the Moon texture
// (near side, selenographic lon 0°, at u = 0.5 → +X).

const DEG = Math.PI / 180
const RAD = 180 / Math.PI

/** Unit vector (times `radius`) in Earth-local space for a lat/lon in degrees. */
export function latLonToLocal(latDeg: number, lonDeg: number, radius: number, out: THREE.Vector3): THREE.Vector3 {
  const la = latDeg * DEG
  const lo = lonDeg * DEG
  const c  = Math.cos(la)
  return out.set(c * Math.cos(lo) * radius, Math.sin(la) * radius, -c * Math.sin(lo) * radius)
}

export interface LatLon { lat: number; lon: number }

/** Inverse of latLonToLocal (radius is ignored). */
export function localToLatLon(v: THREE.Vector3, out: LatLon = { lat: 0, lon: 0 }): LatLon {
  const r = v.length()
  if (r === 0) { out.lat = 0; out.lon = 0; return out }
  out.lat = Math.asin(Math.max(-1, Math.min(1, v.y / r))) * RAD
  out.lon = Math.atan2(-v.z, v.x) * RAD
  return out
}

/** Texture UV for a lat/lon (equirectangular, three.js flipY convention). */
export function latLonToUv(latDeg: number, lonDeg: number, out: THREE.Vector2): THREE.Vector2 {
  return out.set((lonDeg + 180) / 360, (latDeg + 90) / 180)
}

// ── Orientation ─────────────────────────────────────────────────────────────
// Rotate the Earth so that the subsolar point faces the Sun. That fixes two of
// the three rotational degrees of freedom; the remaining one (spin about the
// Earth→Sun axis) is chosen so the North Pole leans as close to world +Y as
// possible, i.e. the axis lies in the plane spanned by the sun direction and
// +Y and is tilted by the declination toward (northern summer) or away from
// (northern winter) the Sun. With the Sun on −X this gives
//     north = (−sin δ, cos δ, 0).

const _s  = new THREE.Vector3()
const _n  = new THREE.Vector3()
const _e2 = new THREE.Vector3()
const _e3 = new THREE.Vector3()
const _f1 = new THREE.Vector3()
const _f2 = new THREE.Vector3()
const _f3 = new THREE.Vector3()
const _mLocal = new THREE.Matrix4()
const _mWorld = new THREE.Matrix4()
const _up = new THREE.Vector3(0, 1, 0)

/**
 * Quaternion that rotates Earth-local space so that the local direction of
 * (subLat, subLon) points along `sunDir` (unit vector from Earth toward the Sun,
 * in the parent's space) with the North Pole leaning toward `up` (default +Y).
 * Passing the true spin axis as `up` gives the real orientation: the subsolar
 * point is matched exactly and the pole lands on `up` to within the small
 * inconsistency between the two (≪ 0.1°).
 */
export function orientTowardSun(
  subLatDeg: number, subLonDeg: number, sunDir: THREE.Vector3, out: THREE.Quaternion,
  up: THREE.Vector3 = _up,
): THREE.Quaternion {
  // Local orthonormal frame: e1 = subsolar direction, e2 = north ⟂ e1.
  latLonToLocal(subLatDeg, subLonDeg, 1, _s)
  _n.set(0, 1, 0)
  _e2.copy(_n).addScaledVector(_s, -_n.dot(_s)).normalize()
  _e3.crossVectors(_s, _e2)

  // World frame: f1 = sun direction, f2 = +Y ⟂ f1 (falls back to +Z if the
  // sun were ever placed straight overhead).
  _f1.copy(sunDir).normalize()
  _f2.copy(up).addScaledVector(_f1, -up.dot(_f1))
  if (_f2.lengthSq() < 1e-8) _f2.set(0, 0, 1).addScaledVector(_f1, -_f1.z)
  _f2.normalize()
  _f3.crossVectors(_f1, _f2)

  // R = F · Eᵀ  (E, F orthonormal → Eᵀ = E⁻¹)
  _mLocal.makeBasis(_s, _e2, _e3).transpose()
  _mWorld.makeBasis(_f1, _f2, _f3).multiply(_mLocal)
  return out.setFromRotationMatrix(_mWorld)
}

// ── Picking ─────────────────────────────────────────────────────────────────

const _hits: THREE.Intersection[] = []
const _local = new THREE.Vector3()

/**
 * Raycast against the Earth mesh and return the geographic coordinates of the
 * first hit, or null. `earthMesh` must be the textured sphere (its local frame
 * is the geographic frame documented above).
 */
export function pickLatLon(raycaster: THREE.Raycaster, earthMesh: THREE.Object3D, out: LatLon = { lat: 0, lon: 0 }): LatLon | null {
  _hits.length = 0
  raycaster.intersectObject(earthMesh, false, _hits)
  if (_hits.length === 0) return null
  _local.copy(_hits[0].point)
  earthMesh.worldToLocal(_local)
  return localToLatLon(_local, out)
}
