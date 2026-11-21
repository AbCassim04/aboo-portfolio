// ── Low-cost solar / lunar ephemeris ────────────────────────────────────────
// Pure maths, no three.js and no allocations in the hot functions (they write
// into caller-owned result objects), so they are safe to call every frame and
// can be unit-checked directly with `node` (see scripts/verify-earth.ts).
//
// Sun:  NOAA solar-position algorithm (Meeus, "Astronomical Algorithms" ch. 25,
//       low-accuracy series). Declination good to ~0.01°, equation of time to
//       a few seconds, which is far below one texel of the Earth texture.
// Moon: Meeus ch. 47 truncated to the 13 largest longitude terms, 6 latitude
//       terms and 11 distance terms. Error ≲ 0.3° in longitude, i.e. the phase
//       angle is right to well under an hour (a mean synodic month alone is off
//       by up to ~14 h), and ≲ 0.1 % (a few hundred km) in distance.
//
// Longitudes are degrees east, in [-180, 180). Latitudes degrees north.

const DEG = Math.PI / 180
const RAD = 180 / Math.PI

/** Julian Day for a Unix epoch time in milliseconds. */
export function julianDay(ms: number): number {
  return ms / 86400000 + 2440587.5
}

/** Wrap an angle in degrees to [-180, 180). */
export function wrap180(deg: number): number {
  const d = ((deg + 180) % 360 + 360) % 360
  return d - 180
}

function wrap360(deg: number): number {
  return ((deg % 360) + 360) % 360
}

/** Greenwich mean sidereal time in degrees, [0, 360). (Meeus 12.4) */
export function gmstDeg(ms: number): number {
  const jd = julianDay(ms)
  const T  = (jd - 2451545.0) / 36525
  return wrap360(280.46061837 + 360.98564736629 * (jd - 2451545.0) + T * T * (0.000387933 - T / 38710000))
}

export interface SubsolarResult {
  /** Subsolar latitude = solar declination (deg). */
  lat: number
  /** Subsolar longitude (deg east). */
  lon: number
  /** Equation of time in minutes (apparent − mean solar time). */
  eotMin: number
  /** Apparent ecliptic longitude of the Sun (deg). */
  eclLon: number
  /** True obliquity of the ecliptic (deg). */
  obliquity: number
}

export function createSubsolarResult(): SubsolarResult {
  return { lat: 0, lon: 0, eotMin: 0, eclLon: 0, obliquity: 23.44 }
}

/**
 * Point on Earth where the Sun is at the zenith, from solar declination and the
 * equation of time:  lon = −15° · (UTC_hours − 12 + EoT/60).
 */
export function subsolarPoint(ms: number, out: SubsolarResult): SubsolarResult {
  const jd = julianDay(ms)
  const T  = (jd - 2451545.0) / 36525

  const L0 = wrap360(280.46646 + T * (36000.76983 + T * 0.0003032))   // geometric mean longitude
  const M  = 357.52911 + T * (35999.05029 - 0.0001537 * T)            // mean anomaly
  const e  = 0.016708634 - T * (0.000042037 + 0.0000001267 * T)        // orbital eccentricity
  const Mr = M * DEG

  const C = Math.sin(Mr) * (1.914602 - T * (0.004817 + 0.000014 * T))
          + Math.sin(2 * Mr) * (0.019993 - 0.000101 * T)
          + Math.sin(3 * Mr) * 0.000289
  const trueLon = L0 + C
  const omega   = 125.04 - 1934.136 * T
  const appLon  = trueLon - 0.00569 - 0.00478 * Math.sin(omega * DEG)

  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60
  const eps  = eps0 + 0.00256 * Math.cos(omega * DEG)
  const epsR = eps * DEG

  const decl = Math.asin(Math.sin(epsR) * Math.sin(appLon * DEG)) * RAD

  const y    = Math.tan(epsR / 2) ** 2
  const L0r  = L0 * DEG
  const eot  = 4 * RAD * (
      y * Math.sin(2 * L0r)
    - 2 * e * Math.sin(Mr)
    + 4 * e * y * Math.sin(Mr) * Math.cos(2 * L0r)
    - 0.5 * y * y * Math.sin(4 * L0r)
    - 1.25 * e * e * Math.sin(2 * Mr)
  )

  const utcHours = (((ms / 3600000) % 24) + 24) % 24
  out.lat       = decl
  out.lon       = wrap180(-15 * (utcHours - 12 + eot / 60))
  out.eotMin    = eot
  out.eclLon    = wrap360(appLon)
  out.obliquity = eps
  return out
}

export interface MoonResult {
  /** Geocentric ecliptic longitude / latitude (deg). */
  eclLon: number
  eclLat: number
  /** Right ascension / declination (deg). */
  ra:  number
  dec: number
  /** Earth-centre to Moon-centre distance (km). */
  distanceKm: number
  /** Point on Earth with the Moon at the zenith (geocentric). */
  sublunarLat: number
  sublunarLon: number
  /** Sun–Earth–Moon elongation (deg, 0 = new, 180 = full). */
  elongation: number
  /** Illuminated fraction of the disc, 0..1. */
  illumination: number
  /** Phase as Moon − Sun ecliptic longitude, [0, 360): 0 new, 90 first quarter, 180 full. */
  phase: number
  /** True if the Moon is waxing (phase < 180°). */
  waxing: boolean
}

export function createMoonResult(): MoonResult {
  return {
    eclLon: 0, eclLat: 0, ra: 0, dec: 0, distanceKm: 385000.56, sublunarLat: 0, sublunarLon: 0,
    elongation: 0, illumination: 0, phase: 0, waxing: true,
  }
}

const _sun = createSubsolarResult()

/** Geocentric Moon position and phase (Meeus ch. 47, truncated). */
export function moonPosition(ms: number, out: MoonResult): MoonResult {
  const jd = julianDay(ms)
  const T  = (jd - 2451545.0) / 36525

  const Lp = 218.3164477 + 481267.88123421 * T   // Moon mean longitude
  const D  = (297.8501921 + 445267.1114034 * T) * DEG   // mean elongation
  const M  = (357.5291092 + 35999.0502909 * T) * DEG    // Sun mean anomaly
  const Mp = (134.9633964 + 477198.8675055 * T) * DEG   // Moon mean anomaly
  const F  = (93.2720950 + 483202.0175233 * T) * DEG    // argument of latitude
  const E  = 1 - 0.002516 * T - 0.0000074 * T * T       // eccentricity factor

  const lon = Lp
    + 6.288774 * Math.sin(Mp)
    + 1.274027 * Math.sin(2 * D - Mp)
    + 0.658314 * Math.sin(2 * D)
    + 0.213618 * Math.sin(2 * Mp)
    - 0.185116 * E * Math.sin(M)
    - 0.114332 * Math.sin(2 * F)
    + 0.058793 * Math.sin(2 * D - 2 * Mp)
    + 0.057066 * E * Math.sin(2 * D - M - Mp)
    + 0.053322 * Math.sin(2 * D + Mp)
    + 0.045758 * E * Math.sin(2 * D - M)
    - 0.040923 * E * Math.sin(M - Mp)
    - 0.034720 * Math.sin(D)
    - 0.030383 * E * Math.sin(M + Mp)

  const lat =
      5.128122 * Math.sin(F)
    + 0.280602 * Math.sin(Mp + F)
    + 0.277693 * Math.sin(Mp - F)
    + 0.173237 * Math.sin(2 * D - F)
    + 0.055413 * Math.sin(2 * D - Mp + F)
    + 0.046271 * Math.sin(2 * D - Mp - F)

  // Distance: Meeus 47 Σr, largest terms (units of 0.001 km).
  const sr =
    - 20905355 * Math.cos(Mp)
    -  3699111 * Math.cos(2 * D - Mp)
    -  2955968 * Math.cos(2 * D)
    -   569925 * Math.cos(2 * Mp)
    +   246158 * Math.cos(2 * D - 2 * Mp)
    -   204586 * E * Math.cos(2 * D - M)
    -   170733 * Math.cos(2 * D + Mp)
    -   152138 * E * Math.cos(2 * D - M - Mp)
    -   129620 * E * Math.cos(M - Mp)
    +   108743 * Math.cos(D)
    +   104755 * E * Math.cos(M + Mp)

  const sun  = subsolarPoint(ms, _sun)
  const epsR = sun.obliquity * DEG
  const lr   = lon * DEG
  const br   = lat * DEG

  const ra  = Math.atan2(Math.sin(lr) * Math.cos(epsR) - Math.tan(br) * Math.sin(epsR), Math.cos(lr)) * RAD
  const dec = Math.asin(Math.sin(br) * Math.cos(epsR) + Math.cos(br) * Math.sin(epsR) * Math.sin(lr)) * RAD

  // Elongation from the angle between the Sun and Moon ecliptic directions.
  const sl = sun.eclLon * DEG
  const cosEl = Math.cos(br) * Math.cos(lr - sl)
  const elong = Math.acos(Math.max(-1, Math.min(1, cosEl))) * RAD

  out.eclLon       = wrap360(lon)
  out.eclLat       = lat
  out.ra           = wrap360(ra)
  out.dec          = dec
  out.distanceKm   = 385000.56 + sr / 1000
  out.sublunarLat  = dec
  out.sublunarLon  = wrap180(ra - gmstDeg(ms))
  out.elongation   = elong
  out.illumination = (1 - Math.cos(elong * DEG)) / 2
  out.phase        = wrap360(out.eclLon - sun.eclLon)
  out.waxing       = out.phase < 180
  return out
}

/** Human-readable name for a phase angle (MoonResult.phase, degrees). */
export function moonPhaseName(phase: number): string {
  const p = wrap360(phase)
  const d = Math.min(p, 360 - p)          // 0 at new, 180 at full
  const waxing = p < 180
  if (d < 6)   return 'New Moon'
  if (d > 174) return 'Full Moon'
  if (d < 84)  return waxing ? 'Waxing Crescent' : 'Waning Crescent'
  if (d < 96)  return waxing ? 'First Quarter'   : 'Last Quarter'
  return waxing ? 'Waxing Gibbous' : 'Waning Gibbous'
}

/**
 * Independent solar elevation (deg) at a site — used only by the verification
 * script to cross-check the 3D orientation against a textbook formula.
 */
export function solarElevationDeg(ms: number, latDeg: number, lonDeg: number): number {
  const s  = subsolarPoint(ms, createSubsolarResult())
  const ha = (lonDeg - s.lon) * DEG          // hour angle
  const la = latDeg * DEG
  const de = s.lat * DEG
  return Math.asin(Math.sin(la) * Math.sin(de) + Math.cos(la) * Math.cos(de) * Math.cos(ha)) * RAD
}
