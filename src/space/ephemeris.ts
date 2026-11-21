import * as THREE from 'three'
import { createMoonResult, moonPosition } from '../earth/astro.ts'
import type { MoonResult } from '../earth/astro.ts'

// ── Solar-system ephemeris (true scale, km) ─────────────────────────────────
//
// Frame: heliocentric ecliptic J2000. Scene axes: X = ecliptic x (J2000
// equinox), Y = ecliptic north, Z = −ecliptic y (right-handed). 1 unit = 1 km.
//
// Planets: E. M. Standish, "Keplerian Elements for Approximate Positions of
// the Major Planets" (JPL), Table 1, valid 1800–2050 AD. Stated heliocentric
// accuracy: Mercury–Mars and Neptune tens of arcseconds, Jupiter/Saturn a few
// hundred (≈ 1–4 million km). Elements are for planetary system barycentres;
// "EM Bary" is the Earth–Moon barycentre, from which Earth is offset using the
// Moon. Moon: the geocentric Meeus series in earth/astro.ts (equinox of date,
// precessed here to J2000) at its real distance.
//
// Orientation: IAU WGCCRE 2015 (Archinal et al. 2018) pole directions and
// prime-meridian angles (periodic terms omitted).
//
// Everything here is allocation-free in the hot paths (results written into
// caller-owned objects) and three.js is only used for Vector3/Quaternion, so
// scripts/verify-earth.ts can check it directly with node.

export const AU_KM          = 149_597_870.7
export const C_KM_S         = 299_792.458
/** TT − UTC (32.184 s + 37 leap seconds since 2017). */
export const TT_MINUS_UTC_S = 69.184
/** M_moon / (M_earth + M_moon). */
export const MOON_MASS_FRACTION = 0.0121505856
/** Mean obliquity of the ecliptic at J2000 (deg). */
export const OBLIQUITY_J2000 = 23.439291111

const DEG = Math.PI / 180

export type PlanetId = 'mercury' | 'venus' | 'earth' | 'mars' | 'jupiter' | 'saturn' | 'uranus' | 'neptune'
export type BodyId = 'sun' | PlanetId | 'moon'

export const PLANET_IDS: readonly PlanetId[] = ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune']

//                a (AU)        e            I (deg)        L (deg)            ϖ (deg)         Ω (deg)
// rates per Julian century
type Row = readonly [number, number, number, number, number, number]
const STANDISH: Record<PlanetId, readonly [Row, Row]> = {
  mercury: [[ 0.38709927, 0.20563593,  7.00497902, 252.25032350,  77.45779628,  48.33076593],
            [ 0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081]],
  venus:   [[ 0.72333566, 0.00677672,  3.39467605, 181.97909950, 131.60246718,  76.67984255],
            [ 0.00000390, -0.00004107, -0.00078890, 58517.81538729, 0.00268329, -0.27769418]],
  // Earth–Moon barycentre
  earth:   [[ 1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193,   0.0],
            [ 0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364,   0.0]],
  mars:    [[ 1.52371034, 0.09339410,  1.84969142,  -4.55343205, -23.94362959,  49.55953891],
            [ 0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343]],
  jupiter: [[ 5.20288700, 0.04838624,  1.30439695,  34.39644051,  14.72847983, 100.47390909],
            [-0.00011607, -0.00013253, -0.00183714, 3034.74612775,  0.21252668,   0.20469106]],
  saturn:  [[ 9.53667594, 0.05386179,  2.48599187,  49.95424423,  92.59887831, 113.66242448],
            [-0.00125060, -0.00050991,  0.00193609, 1222.49362201, -0.41897216,  -0.28867794]],
  uranus:  [[19.18916464, 0.04725744,  0.77263783, 313.23810451, 170.95427630,  74.01692503],
            [-0.00196176, -0.00004397, -0.00242939,  428.48202785,  0.40805281,   0.04240589]],
  neptune: [[30.06992276, 0.00859048,  1.77004347, -55.12002969,  44.96476227, 131.78422574],
            [ 0.00026291, 0.00005105,  0.00035372,  218.45945325, -0.32241464,  -0.00508664]],
}

/** 2000-01-01T12:00:00 (JD 2451545.0) as Unix milliseconds. */
const J2000_MS = 946_728_000_000

/**
 * Days (TT) since J2000.0 for a Unix time in milliseconds (UTC). Computed
 * directly from milliseconds: going through the absolute Julian Day
 * (~2.46 million) quantises time to ~0.04 ms, a metre-sized per-frame jitter
 * in planet positions at true scale.
 */
export function daysTT(ms: number): number {
  return (ms + TT_MINUS_UTC_S * 1000 - J2000_MS) / 86_400_000
}

/** Julian centuries (TT) since J2000.0. */
export function centuriesTT(ms: number): number {
  return daysTT(ms) / 36525
}

/** Write ecliptic-J2000 coordinates (any unit) into a scene vector. */
export function eclToScene(x: number, y: number, z: number, out: THREE.Vector3): THREE.Vector3 {
  return out.set(x, z, -y)
}

export interface OrbitalElements {
  /** Semi-major axis (AU), eccentricity, inclination / longitude of perihelion / node (rad). */
  a: number; e: number; I: number; varpi: number; Omega: number
  /** Mean longitude (rad). */
  L: number
}

export function createElements(): OrbitalElements {
  return { a: 1, e: 0, I: 0, varpi: 0, Omega: 0, L: 0 }
}

/** Osculating (approximate) elements of `id` at T centuries TT. */
export function elementsAt(id: PlanetId, T: number, out: OrbitalElements): OrbitalElements {
  const [e0, r] = STANDISH[id]
  out.a     = e0[0] + r[0] * T
  out.e     = e0[1] + r[1] * T
  out.I     = (e0[2] + r[2] * T) * DEG
  out.L     = (e0[3] + r[3] * T) * DEG
  out.varpi = (e0[4] + r[4] * T) * DEG
  out.Omega = (e0[5] + r[5] * T) * DEG
  return out
}

/** Solve Kepler's equation E − e sin E = M (radians). */
export function solveKepler(M: number, e: number): number {
  let E = M + e * Math.sin(M)
  for (let i = 0; i < 8; i++) {
    const dE = (M - (E - e * Math.sin(E))) / (1 - e * Math.cos(E))
    E += dE
    if (Math.abs(dE) < 1e-12) break
  }
  return E
}

/**
 * Position on the orbit described by `el` at eccentric anomaly E, in scene
 * coordinates scaled by `scale` (AU → `scale` units).
 */
export function orbitPointAtE(el: OrbitalElements, E: number, scale: number, out: THREE.Vector3): THREE.Vector3 {
  const w  = el.varpi - el.Omega
  const xp = el.a * (Math.cos(E) - el.e)
  const yp = el.a * Math.sqrt(1 - el.e * el.e) * Math.sin(E)
  const cw = Math.cos(w), sw = Math.sin(w)
  const cO = Math.cos(el.Omega), sO = Math.sin(el.Omega)
  const cI = Math.cos(el.I), sI = Math.sin(el.I)
  const x = (cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp
  const y = (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp
  const z = (sw * sI) * xp + (cw * sI) * yp
  return eclToScene(x * scale, y * scale, z * scale, out)
}

const _el = createElements()

/**
 * Heliocentric scene position (km) of a planet's system barycentre ('earth' =
 * Earth–Moon barycentre) at Unix time `ms`.
 */
export function planetBarycentreKm(id: PlanetId, ms: number, out: THREE.Vector3): THREE.Vector3 {
  elementsAt(id, centuriesTT(ms), _el)
  let M = (_el.L - _el.varpi) % (2 * Math.PI)
  if (M > Math.PI) M -= 2 * Math.PI
  if (M < -Math.PI) M += 2 * Math.PI
  return orbitPointAtE(_el, solveKepler(M, _el.e), AU_KM, out)
}

/** General precession in longitude since J2000 (deg), IAU 2006. */
export function precessionDeg(T: number): number {
  return (5028.796195 * T + 1.1054348 * T * T) / 3600
}

const _moon = createMoonResult()

/**
 * Geocentric Moon position (km, scene axes, J2000 ecliptic) from the Meeus
 * series: longitude of date precessed back to J2000. `res` receives the full
 * series result if given.
 */
export function moonGeocentricKm(ms: number, out: THREE.Vector3, res: MoonResult = _moon): THREE.Vector3 {
  moonPosition(ms, res)
  const lon = (res.eclLon - precessionDeg(centuriesTT(ms))) * DEG
  const lat = res.eclLat * DEG
  const r   = res.distanceKm
  return eclToScene(r * Math.cos(lat) * Math.cos(lon), r * Math.cos(lat) * Math.sin(lon), r * Math.sin(lat), out)
}

const _moonGeo = new THREE.Vector3()

/** Heliocentric Earth position (km): EM barycentre − μ · geocentric Moon. */
export function earthPositionKm(ms: number, out: THREE.Vector3, moonGeoOut?: THREE.Vector3): THREE.Vector3 {
  const mg = moonGeoOut ?? _moonGeo
  moonGeocentricKm(ms, mg)
  planetBarycentreKm('earth', ms, out)
  return out.addScaledVector(mg, -MOON_MASS_FRACTION)
}

// ── IAU orientation ─────────────────────────────────────────────────────────

export interface PoleAndMeridian { ra: number; dec: number; W: number }

/** IAU WGCCRE 2015 pole (ICRF RA/Dec, deg) and prime-meridian angle W (deg). */
export function iauOrientation(id: BodyId, ms: number, out: PoleAndMeridian): PoleAndMeridian {
  const d = daysTT(ms)
  const T = d / 36525
  switch (id) {
    case 'sun':     out.ra = 286.13;                    out.dec = 63.87;                    out.W = 84.176 + 14.1844000 * d; break
    case 'mercury': out.ra = 281.0103 - 0.0328 * T;     out.dec = 61.4155 - 0.0049 * T;     out.W = 329.5988 + 6.1385108 * d; break
    case 'venus':   out.ra = 272.76;                    out.dec = 67.16;                    out.W = 160.20 - 1.4813688 * d; break
    case 'earth':   out.ra = 0.00 - 0.641 * T;          out.dec = 90.00 - 0.557 * T;        out.W = 190.147 + 360.9856235 * d; break
    case 'mars':    out.ra = 317.269202 - 0.10927547 * T; out.dec = 54.432516 - 0.05827105 * T; out.W = 176.049863 + 350.891982443297 * d; break
    case 'jupiter': out.ra = 268.056595 - 0.006499 * T; out.dec = 64.495303 + 0.002413 * T; out.W = 284.95 + 870.5360000 * d; break
    case 'saturn':  out.ra = 40.589 - 0.036 * T;        out.dec = 83.537 - 0.004 * T;       out.W = 38.90 + 810.7939024 * d; break
    case 'uranus':  out.ra = 257.311;                   out.dec = -15.175;                  out.W = 203.81 - 501.1600928 * d; break
    case 'neptune': {
      const N = (357.85 + 52.316 * T) * DEG
      out.ra  = 299.36 + 0.70 * Math.sin(N)
      out.dec = 43.46 - 0.51 * Math.cos(N)
      out.W   = 249.978 + 541.1397757 * d - 0.48 * Math.sin(N)
      break
    }
    case 'moon':    // Tidally locked; orientation handled relative to Earth (earth/moon.ts).
      out.ra = 269.9949 + 0.0031 * T; out.dec = 66.5392 + 0.0130 * T; out.W = 38.3213 + 13.17635815 * d; break
  }
  return out
}

/** ICRF equatorial unit vector (RA/Dec, deg) → scene axes (ecliptic J2000). */
export function equatorialToScene(raDeg: number, decDeg: number, out: THREE.Vector3): THREE.Vector3 {
  const a = raDeg * DEG, d = decDeg * DEG, e = OBLIQUITY_J2000 * DEG
  const xq = Math.cos(d) * Math.cos(a), yq = Math.cos(d) * Math.sin(a), zq = Math.sin(d)
  return eclToScene(xq, yq * Math.cos(e) + zq * Math.sin(e), -yq * Math.sin(e) + zq * Math.cos(e), out)
}

const _po  = { ra: 0, dec: 0, W: 0 }
const _P   = new THREE.Vector3()
const _N   = new THREE.Vector3()
const _E   = new THREE.Vector3()
const _X   = new THREE.Vector3()
const _Z   = new THREE.Vector3()
const _Qeq = new THREE.Vector3()
const _M4  = new THREE.Matrix4()

/** Spin axis (north pole) of a body in scene axes. */
export function bodyPole(id: BodyId, ms: number, out: THREE.Vector3): THREE.Vector3 {
  iauOrientation(id, ms, _po)
  return equatorialToScene(_po.ra, _po.dec, out)
}

/**
 * Body-fixed orientation: local +Y → north pole, local +X → prime meridian
 * (longitude 0), east longitudes at local (cos λ, 0, −sin λ) — the texture
 * convention documented in earth/geo.ts.
 */
export function bodyQuaternion(id: BodyId, ms: number, out: THREE.Quaternion): THREE.Quaternion {
  iauOrientation(id, ms, _po)
  equatorialToScene(_po.ra, _po.dec, _P)
  equatorialToScene(0, 90, _Qeq)                              // ICRF north pole
  _N.crossVectors(_Qeq, _P)                                   // ascending node of the body equator
  if (_N.lengthSq() < 1e-12) _N.set(1, 0, 0)
  _N.normalize()
  _E.crossVectors(_P, _N)
  const W = _po.W * DEG
  _X.copy(_N).multiplyScalar(Math.cos(W)).addScaledVector(_E, Math.sin(W))
  _Z.copy(_N).multiplyScalar(Math.sin(W)).addScaledVector(_E, -Math.cos(W))
  _M4.makeBasis(_X, _P, _Z)
  return out.setFromRotationMatrix(_M4)
}

// ── Apparent magnitude (Mallama & Hilton 2018, simplified) ──────────────────

/**
 * Apparent visual magnitude of a body at heliocentric distance r (AU), observer
 * distance delta (AU) and phase angle alpha (deg). For Saturn, `ringTiltDeg`
 * is the planetocentric latitude of the observer (ring opening angle).
 */
export function apparentMagnitude(id: BodyId, r: number, delta: number, alpha: number, ringTiltDeg = 0): number {
  if (id === 'sun') return -26.74 + 5 * Math.log10(delta)
  const d = 5 * Math.log10(Math.max(r * delta, 1e-12))
  const a = alpha
  switch (id) {
    case 'mercury': return -0.613 + d + 6.3280e-2 * a - 1.6336e-3 * a * a + 3.3644e-5 * a ** 3 - 3.4265e-7 * a ** 4 + 1.6893e-9 * a ** 5 - 3.0334e-12 * a ** 6
    case 'venus':   return -4.384 + d - 1.044e-3 * a + 3.687e-4 * a * a - 2.814e-6 * a ** 3 + 8.938e-9 * a ** 4
    case 'earth':   return -3.99 + d - 1.060e-3 * a + 2.054e-4 * a * a
    case 'mars':    return -1.601 + d + 2.267e-2 * a - 1.302e-4 * a * a
    case 'jupiter': return -9.395 + d - 3.7e-4 * a + 6.16e-4 * a * a
    case 'saturn': {
      const sb = Math.sin(Math.abs(ringTiltDeg) * DEG)
      return -8.914 + d - 1.825 * sb + 2.6e-2 * a - 0.378 * sb * Math.exp(-2.25 * a)
    }
    case 'uranus':  return -7.110 + d + 6.587e-3 * a + 1.045e-4 * a * a
    case 'neptune': return -7.00 + d + 7.944e-3 * a + 9.617e-5 * a * a
    case 'moon':    return 0.21 + d + 0.026 * a + 4.0e-9 * a ** 4
  }
}

// ── Physical data ───────────────────────────────────────────────────────────

export interface BodyPhysical {
  /** Equatorial radius (km). */
  radius:      number
  /** Polar radius (km). */
  polarRadius: number
  /** GM (km³/s²). */
  gm:          number
}

export const BODY_PHYSICAL: Record<BodyId, BodyPhysical> = {
  sun:     { radius: 696_000,  polarRadius: 696_000,  gm: 1.32712440018e11 },
  mercury: { radius: 2_439.7,  polarRadius: 2_439.7,  gm: 22_031.86 },
  venus:   { radius: 6_051.8,  polarRadius: 6_051.8,  gm: 324_858.59 },
  earth:   { radius: 6_371,    polarRadius: 6_371,    gm: 398_600.44 },
  moon:    { radius: 1_737.4,  polarRadius: 1_737.4,  gm: 4_902.80 },
  mars:    { radius: 3_396.2,  polarRadius: 3_376.2,  gm: 42_828.37 },
  jupiter: { radius: 71_492,   polarRadius: 66_854,   gm: 126_686_534 },
  saturn:  { radius: 60_268,   polarRadius: 54_364,   gm: 37_931_187 },
  uranus:  { radius: 25_559,   polarRadius: 24_973,   gm: 5_793_939 },
  neptune: { radius: 24_764,   polarRadius: 24_341,   gm: 6_836_529 },
}

/** Laplace sphere-of-influence radius (km) about `id` (semi-major axis based). */
export function sphereOfInfluenceKm(id: BodyId): number {
  if (id === 'sun') return Infinity
  if (id === 'moon') return 66_100
  const a = STANDISH[id][0][0] * AU_KM
  return a * Math.pow(BODY_PHYSICAL[id].gm / BODY_PHYSICAL.sun.gm, 0.4)
}

/** Hill-sphere radius (km) of `id` about the Sun (Moon: about Earth). */
export function hillRadiusKm(id: BodyId): number {
  if (id === 'sun') return Infinity
  if (id === 'moon') return 384_400 * Math.cbrt(BODY_PHYSICAL.moon.gm / (3 * BODY_PHYSICAL.earth.gm))
  const a = STANDISH[id][0][0] * AU_KM
  return a * Math.cbrt(BODY_PHYSICAL[id].gm / (3 * BODY_PHYSICAL.sun.gm))
}

/** Saturn's main rings as mapped by public/earth/8k_saturn_ring_alpha.png (km). */
export const SATURN_RING_TEXTURE_INNER_KM = 70_322
export const SATURN_RING_TEXTURE_OUTER_KM = 140_839
