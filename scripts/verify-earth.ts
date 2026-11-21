// Calibration proof for the live Earth: `npm run verify:earth [-- --render <dir>]`
//
// Checks (all against independent references, not against the code itself):
//   1. three.js SphereGeometry UV ↔ position matches geo.ts latLonToLocal.
//   2. Solar declination / equation of time at known dates (Meeus examples,
//      equinox and solstice instants, EoT extremes).
//   3. Subsolar longitude via EoT agrees with the sidereal-time route (RA − GMST).
//   4. 3D orientation: subsolar point faces the Sun, North Pole leans to +Y, and
//      the 3D solar elevation over London matches published sunrise/sunset times.
//   5. Moon phase at known new/full/quarter instants, and the 2024-04-08 eclipse
//      (sublunar ≈ subsolar).
//   6. True-scale ephemeris (planets, Earth, Moon) vs JPL Horizons at 4 dates.
//   7. True-scale Earth orientation: pole, sidereal rotation, London sun times.
//   8. Saturn's ring opening angle and apparent magnitudes vs Horizons.
// With --render it also writes an equirectangular day/night map for "now",
// produced through the full 3D chain, to compare with a real day/night map.

import * as THREE from 'three'
import {
  createMoonResult, createSubsolarResult, gmstDeg, moonPosition, subsolarPoint, wrap180,
} from '../src/earth/astro.ts'
import { latLonToLocal, localToLatLon, orientTowardSun } from '../src/earth/geo.ts'
import {
  TT_MINUS_UTC_S, apparentMagnitude, bodyPole, bodyQuaternion, earthPositionKm, eclToScene,
  moonGeocentricKm, planetBarycentreKm,
} from '../src/space/ephemeris.ts'
import type { BodyId, PlanetId } from '../src/space/ephemeris.ts'

let failures = 0
function check(name: string, ok: boolean, detail: string) {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`)
}
const t = (iso: string) => Date.parse(iso)
const DEG = Math.PI / 180

// ── 1. Sphere UV convention ─────────────────────────────────────────────────
{
  const geo = new THREE.SphereGeometry(1, 72, 36)
  const pos = geo.getAttribute('position')
  const uv  = geo.getAttribute('uv')
  const v   = new THREE.Vector3()
  const p   = new THREE.Vector3()
  let maxErr = 0
  for (let i = 0; i < pos.count; i++) {
    const lat = uv.getY(i) * 180 - 90
    const lon = uv.getX(i) * 360 - 180
    latLonToLocal(lat, lon, 1, v)
    p.fromBufferAttribute(pos, i)
    maxErr = Math.max(maxErr, v.distanceTo(p))
  }
  check('sphere UV → lat/lon → local matches SphereGeometry vertices', maxErr < 1e-6, `max err ${maxErr.toExponential(2)}`)
  const ll = localToLatLon(latLonToLocal(-26.2041, 28.0473, 10, new THREE.Vector3()))
  check('latLonToLocal / localToLatLon round trip (Johannesburg)', Math.abs(ll.lat + 26.2041) < 1e-9 && Math.abs(ll.lon - 28.0473) < 1e-9, `${ll.lat.toFixed(4)}, ${ll.lon.toFixed(4)}`)
  geo.dispose()
}

// ── 2. Declination and equation of time ─────────────────────────────────────
const s = createSubsolarResult()
{
  // Meeus example 25.a: 1992-10-13 0h TT → δ = −7.78507°
  subsolarPoint(t('1992-10-13T00:00:00Z'), s)
  check('Meeus 25.a declination', Math.abs(s.lat - -7.78507) < 0.01, `δ ${s.lat.toFixed(4)}° (ref −7.7851°)`)
  // Meeus example 28.b: 1992-10-13 0h → EoT = +13m42.6s
  check('Meeus 28.b equation of time', Math.abs(s.eotMin - 13.71) < 0.05, `EoT ${s.eotMin.toFixed(2)} min (ref +13.71)`)

  subsolarPoint(t('2024-03-20T03:06:00Z'), s)
  check('March equinox 2024-03-20 03:06Z', Math.abs(s.lat) < 0.02, `δ ${s.lat.toFixed(3)}°`)
  subsolarPoint(t('2024-06-20T20:51:00Z'), s)
  check('June solstice 2024-06-20 20:51Z', Math.abs(s.lat - 23.44) < 0.02, `δ ${s.lat.toFixed(3)}°`)
  subsolarPoint(t('2024-11-03T12:00:00Z'), s)
  check('EoT maximum early November ≈ +16.4 min', Math.abs(s.eotMin - 16.4) < 0.2, `${s.eotMin.toFixed(2)} min`)
  subsolarPoint(t('2024-02-11T12:00:00Z'), s)
  check('EoT minimum mid February ≈ −14.2 min', Math.abs(s.eotMin + 14.2) < 0.2, `${s.eotMin.toFixed(2)} min`)
  // 12:00 UTC on the equinox: EoT ≈ −7.4 min → Sun crosses 1.85°E at that instant.
  subsolarPoint(t('2024-03-20T12:00:00Z'), s)
  check('subsolar longitude 2024-03-20 12:00Z ≈ +1.85°', Math.abs(s.lon - 1.85) < 0.1, `${s.lon.toFixed(3)}° (EoT ${s.eotMin.toFixed(2)} min)`)
}

// ── 3. EoT route vs sidereal route ──────────────────────────────────────────
{
  let maxD = 0
  for (let ms = t('2025-01-01T00:00:00Z'); ms < t('2027-01-01T00:00:00Z'); ms += 7.3 * 86400000) {
    subsolarPoint(ms, s)
    const lam = s.eclLon * DEG, eps = s.obliquity * DEG
    const ra  = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam)) / DEG
    maxD = Math.max(maxD, Math.abs(wrap180(ra - gmstDeg(ms) - s.lon)))
  }
  check('subsolar lon: EoT formula vs RA − GMST (2025–2026)', maxD < 0.02, `max diff ${maxD.toFixed(4)}°`)
}

// ── 4. 3D orientation ───────────────────────────────────────────────────────
const sunDir = new THREE.Vector3(-1, 0, 0)    // flight mode: Sun at x = −4000
const q      = new THREE.Quaternion()
const tmp    = new THREE.Vector3()
function elevation3d(ms: number, lat: number, lon: number): number {
  subsolarPoint(ms, s)
  orientTowardSun(s.lat, s.lon, sunDir, q)
  latLonToLocal(lat, lon, 1, tmp).applyQuaternion(q)
  return Math.asin(tmp.dot(sunDir)) / DEG
}
{
  let worstSun = 0, worstPole = 0
  for (let ms = t('2026-01-01T00:00:00Z'); ms < t('2027-01-01T00:00:00Z'); ms += 3.7 * 86400000 + 4567000) {
    subsolarPoint(ms, s)
    orientTowardSun(s.lat, s.lon, sunDir, q)
    latLonToLocal(s.lat, s.lon, 1, tmp).applyQuaternion(q)
    worstSun = Math.max(worstSun, tmp.distanceTo(sunDir))
    tmp.set(0, 1, 0).applyQuaternion(q)
    worstPole = Math.max(worstPole, Math.hypot(tmp.x + Math.sin(s.lat * DEG), tmp.y - Math.cos(s.lat * DEG), tmp.z))
  }
  check('subsolar point faces the Sun (world −X)', worstSun < 1e-9, `max err ${worstSun.toExponential(2)}`)
  check('North Pole = (−sin δ, cos δ, 0) (upright, tilted by season)', worstPole < 1e-9, `max err ${worstPole.toExponential(2)}`)

  // Published London times (timeanddate.com, 2024-06-21): sunrise 04:43 BST,
  // sunset 21:21 BST. At rise/set the Sun's centre is at −0.833°.
  const LON_LAT = 51.5074, LON_LON = -0.1278
  const rise = elevation3d(t('2024-06-21T03:43:30Z'), LON_LAT, LON_LON)
  const set  = elevation3d(t('2024-06-21T20:21:30Z'), LON_LAT, LON_LON)
  check('London sunrise 2024-06-21 03:43Z (3D chain)', Math.abs(rise + 0.833) < 0.3, `elev ${rise.toFixed(2)}° (ref −0.83°)`)
  check('London sunset 2024-06-21 20:21Z (3D chain)', Math.abs(set + 0.833) < 0.3, `elev ${set.toFixed(2)}° (ref −0.83°)`)
  // Midsummer noon elevation at London = 90 − 51.51 + 23.44 = 61.93°.
  const noon = Math.max(...Array.from({ length: 121 }, (_, i) => elevation3d(t('2024-06-21T11:00:00Z') + i * 60000, LON_LAT, LON_LON)))
  check('London max elevation 2024-06-21 ≈ 61.93°', Math.abs(noon - 61.93) < 0.05, `${noon.toFixed(3)}°`)
  // Johannesburg at local midsummer (Dec solstice) noon: 90 − 26.20 − 23.44 + … ≈ 87.2° (Sun 2.8° north of zenith).
  const jnb = Math.max(...Array.from({ length: 121 }, (_, i) => elevation3d(t('2024-12-21T09:30:00Z') + i * 60000, -26.2041, 28.0473)))
  check('Johannesburg max elevation 2024-12-21 ≈ 87.24°', Math.abs(jnb - 87.24) < 0.05, `${jnb.toFixed(3)}°`)
}

// ── 5. Moon ─────────────────────────────────────────────────────────────────
{
  const m = createMoonResult()
  const cases: [string, string, number, number][] = [
    ['new moon + total solar eclipse', '2024-04-08T18:21:00Z',   0, 1.0],
    ['full moon + penumbral eclipse',  '2024-03-25T07:00:00Z', 180, 1.0],
    ['full moon',                      '2024-01-25T17:54:00Z', 180, 1.5],
    ['first quarter',                  '2024-01-18T03:53:00Z',  90, 1.0],
    ['last quarter',                   '2024-02-02T23:18:00Z',  90, 1.0],
  ]
  // Phases are defined by the Moon−Sun difference in ecliptic longitude (the
  // 3D elongation can stay ~5° short of 180° when the Moon is off the ecliptic).
  for (const [name, iso, ref, tol] of cases) {
    moonPosition(t(iso), m)
    subsolarPoint(t(iso), s)
    const dLon = Math.abs(wrap180(m.eclLon - s.eclLon))
    check(`Moon ${name} ${iso}`, Math.abs(dLon - ref) < tol, `Δλ ${dLon.toFixed(2)}° (ref ${ref}°), elongation ${m.elongation.toFixed(2)}°, ${(m.illumination * 100).toFixed(1)}% lit`)
  }
  // Greatest eclipse 2024-04-08 18:17:16Z near 25.3°N 104.1°W: the geocentric
  // sublunar and subsolar points nearly coincide (within the ~1° lunar parallax).
  moonPosition(t('2024-04-08T18:17:16Z'), m)
  subsolarPoint(t('2024-04-08T18:17:16Z'), s)
  const sep = Math.acos(latLonToLocal(m.sublunarLat, m.sublunarLon, 1, new THREE.Vector3()).dot(latLonToLocal(s.lat, s.lon, 1, tmp))) / DEG
  check('2024-04-08 eclipse: sublunar ≈ subsolar', sep < 1.0, `separation ${sep.toFixed(2)}°, subsolar ${s.lat.toFixed(2)}, ${s.lon.toFixed(2)}`)

  const now = Date.now()
  moonPosition(now, m)
  subsolarPoint(now, s)
  console.log(`\nNow ${new Date(now).toISOString()}: subsolar ${s.lat.toFixed(3)}°, ${s.lon.toFixed(3)}° (EoT ${s.eotMin.toFixed(2)} min); `
    + `Moon elongation ${m.elongation.toFixed(1)}°, ${(m.illumination * 100).toFixed(1)}% lit, ${m.waxing ? 'waxing' : 'waning'}`)
}

// ── 6. True-scale ephemeris vs JPL Horizons ─────────────────────────────────
// Reference: JPL Horizons API (ssd.jpl.nasa.gov, queried 2026-11-21), vector
// tables, ICRF, ecliptic & equinox of J2000, km, TDB epochs; heliocentric
// (500@10) for planet system barycentres 1–8 and Earth 399, geocentric
// (500@399) for the Moon 301. Rows: [JD TDB, x, y, z] (ecliptic axes).
// Tolerances follow Standish's stated accuracy for Table 1 (1800–2050), with
// margin: tens of arcseconds for the terrestrial planets and Neptune, a few
// hundred for Jupiter/Saturn (seen from the Sun).
const HORIZONS: Record<string, [number, number, number, number][]> = {
  mercury: [
    [2447892.5, 2.4491182804e+07, 3.9446809405e+07, 9.7326043715e+05],   // 1990-Jan-01
    [2451545.0, -1.9461726356e+07, -6.6913275264e+07, -3.6798543437e+06],   // 2000-Jan-01
    [2461365.5, -3.8919058357e+07, 3.1960524393e+07, 6.1814565901e+06],   // 2026-Nov-21
    [2466154.5, 2.4495087376e+06, -6.8936108874e+07, -5.8595505456e+06],   // 2040-Jan-01
  ],
  venus: [
    [2447892.5, 6.3704711788e+05, 1.0765095788e+08, 1.4311443857e+06],   // 1990-Jan-01
    [2451545.0, -1.0745649405e+08, -4.8850149759e+06, 6.1356342997e+06],   // 2000-Jan-01
    [2461365.5, 2.7794503940e+07, 1.0415906799e+08, -1.7230184166e+05],   // 2026-Nov-21
    [2466154.5, -1.0632605171e+08, -1.6818137888e+07, 5.9019101243e+06],   // 2040-Jan-01
  ],
  emb: [
    [2447892.5, -2.6667628258e+07, 1.4466434418e+08, 3.2894129290e+03],   // 1990-Jan-01
    [2451545.0, -2.6502576890e+07, 1.4469395563e+08, -1.7043319020e+02],   // 2000-Jan-01
    [2461365.5, 7.7655869897e+07, 1.2576240466e+08, -8.2705003863e+03],   // 2026-Nov-21
    [2466154.5, -2.4553824619e+07, 1.4504254102e+08, -1.2870901518e+04],   // 2040-Jan-01
  ],
  mars: [
    [2447892.5, -1.4605854805e+08, -1.7970572159e+08, -1.7078853775e+05],   // 1990-Jan-01
    [2451545.0, 2.0804814064e+08, -2.0070526282e+06, -5.1562889593e+06],   // 2000-Jan-01
    [2461365.5, -8.1911598003e+07, 2.2713124173e+08, 6.7682943525e+06],   // 2026-Nov-21
    [2466154.5, -4.3442610492e+07, 2.3444387323e+08, 5.9789816391e+06],   // 2040-Jan-01
  ],
  jupiter: [
    [2447892.5, -8.4837268873e+07, 7.6585878676e+08, -1.2694301486e+06],   // 1990-Jan-01
    [2451545.0, 5.9856758360e+08, 4.3960472849e+08, -1.5226860653e+07],   // 2000-Jan-01
    [2461365.5, -5.6485697449e+08, 5.6123730940e+08, 1.0306555641e+07],   // 2026-Nov-21
    [2466154.5, -8.0100924790e+08, 1.3280749068e+08, 1.7370191142e+07],   // 2040-Jan-01
  ],
  saturn: [
    [2447892.5, 4.2002037594e+08, -1.4400110195e+09, 8.4122620772e+06],   // 1990-Jan-01
    [2451545.0, 9.5838512422e+08, 9.8285645721e+08, -5.5213047492e+07],   // 2000-Jan-01
    [2461365.5, 1.3741778460e+09, 3.0586757600e+08, -6.0027615749e+07],   // 2026-Nov-21
    [2466154.5, -1.4206863635e+09, -1.2891925329e+08, 5.8794196323e+07],   // 2040-Jan-01
  ],
  uranus: [
    [2447892.5, 2.8635352274e+08, -2.8850008259e+09, -1.4419601672e+07],   // 1990-Jan-01
    [2451545.0, 2.1589750198e+09, -2.0546252472e+09, -3.5625489420e+07],   // 2000-Jan-01
    [2461365.5, 1.3090301860e+09, 2.5955681431e+09, -7.3332586739e+06],   // 2026-Nov-21
    [2466154.5, -1.4138212212e+09, 2.3949214101e+09, 2.7208264349e+07],   // 2040-Jan-01
  ],
  neptune: [
    [2447892.5, 9.5635232696e+08, -4.4165364353e+09, 6.8911888241e+07],   // 1990-Jan-01
    [2451545.0, 2.5150464285e+09, -3.7387145133e+09, 1.9032271940e+07],   // 2000-Jan-01
    [2461365.5, 4.4622665614e+09, 2.3051086400e+08, -1.0757899236e+08],   // 2026-Nov-21
    [2466154.5, 3.7782672967e+09, 2.3656155724e+09, -1.3578025226e+08],   // 2040-Jan-01
  ],
  earth: [
    [2447892.5, -2.6671493608e+07, 1.4466688468e+08, 3.2187214532e+03],   // 1990-Jan-01
    [2451545.0, -2.6499033677e+07, 1.4469729679e+08, -6.1114942595e+02],   // 2000-Jan-01
    [2461365.5, 7.7651355141e+07, 1.2576162902e+08, -8.5556697067e+03],   // 2026-Nov-21
    [2466154.5, -2.4551705057e+07, 1.4503811475e+08, -1.3178268430e+04],   // 2040-Jan-01
  ],
  moonGeo: [
    [2447892.5, 3.1812050439e+05, -2.0908448925e+05, 5.8179486318e+03],   // 1990-Jan-01
    [2451545.0, -2.9160838419e+05, -2.7497974167e+05, 3.6271196627e+04],   // 2000-Jan-01
    [2461365.5, 3.7156699513e+05, 6.3836067512e+04, 2.3469597106e+04],   // 2026-Nov-21
    [2466154.5, -1.7444114955e+05, 3.6428466884e+05, 2.5296471486e+04],   // 2040-Jan-01
  ],
}
{
  const v = new THREE.Vector3(), h = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3()
  const msFromJdTdb = (jd: number) => (jd - 2440587.5) * 86400000 - TT_MINUS_UTC_S * 1000
  const ecl = (r: number[], out: THREE.Vector3) => eclToScene(r[1], r[2], r[3], out)
  const angleTol: Record<string, number> = {
    mercury: 60, venus: 60, emb: 60, earth: 60, mars: 90, jupiter: 600, saturn: 900, uranus: 150, neptune: 150,
  }
  for (const [name, rows] of Object.entries(HORIZONS)) {
    if (name === 'moonGeo') continue
    let worstAng = 0, worstKm = 0
    for (const r of rows) {
      const ms = msFromJdTdb(r[0])
      if (name === 'earth') earthPositionKm(ms, v)
      else planetBarycentreKm((name === 'emb' ? 'earth' : name) as PlanetId, ms, v)
      ecl(r, h)
      worstAng = Math.max(worstAng, v.angleTo(h) / DEG * 3600)
      worstKm  = Math.max(worstKm, v.distanceTo(h))
    }
    check(`ephemeris ${name} vs Horizons (1990, 2000, 2026-11-21, 2040)`, worstAng < angleTol[name],
      `max ${worstAng.toFixed(1)}" heliocentric, ${(worstKm / 1000).toFixed(0)}k km (tol ${angleTol[name]}")`)
  }
  // Earth offset from the EM barycentre (Moon-driven, ~4 670 km).
  let worstOff = 0
  for (let i = 0; i < HORIZONS.earth.length; i++) {
    const ms = msFromJdTdb(HORIZONS.earth[i][0])
    earthPositionKm(ms, v); planetBarycentreKm('earth', ms, a); v.sub(a)
    ecl(HORIZONS.earth[i], h); ecl(HORIZONS.emb[i], b); h.sub(b)
    worstOff = Math.max(worstOff, v.distanceTo(h))
  }
  check('Earth − EM barycentre offset vs Horizons', worstOff < 60, `max error ${worstOff.toFixed(1)} km of ~4 670 km`)
  // Moon, geocentric: series (precessed to J2000) and the Live Earth chain.
  let worstMoonAng = 0, worstMoonKm = 0, worstChain = 0
  const q2 = new THREE.Quaternion(), pole = new THREE.Vector3(), sunD = new THREE.Vector3(), mres = createMoonResult()
  for (const r of HORIZONS.moonGeo) {
    const ms = msFromJdTdb(r[0])
    moonGeocentricKm(ms, v)
    ecl(r, h)
    worstMoonAng = Math.max(worstMoonAng, v.angleTo(h) / DEG)
    worstMoonKm  = Math.max(worstMoonKm, Math.abs(v.length() - h.length()))
    // Chain used in flight: sublunar point on the Earth oriented to the real
    // Sun with its true pole (earth/moon.ts + space/solarSystem.ts).
    earthPositionKm(ms, a)
    sunD.copy(a).negate().normalize()
    bodyPole('earth', ms, pole)
    subsolarPoint(ms, s)
    orientTowardSun(s.lat, s.lon, sunD, q2, pole)
    moonPosition(ms, mres)
    latLonToLocal(mres.sublunarLat, mres.sublunarLon, 1, b).applyQuaternion(q2)
    worstChain = Math.max(worstChain, b.angleTo(h) / DEG)
  }
  check('Moon direction (series → J2000) vs Horizons', worstMoonAng < 0.1, `max ${(worstMoonAng * 60).toFixed(2)}'`)
  check('Moon distance vs Horizons', worstMoonKm < 500, `max error ${worstMoonKm.toFixed(0)} km`)
  check('Moon direction via the Live Earth sublunar chain vs Horizons', worstChain < 0.5, `max ${worstChain.toFixed(3)}°`)
}

// ── 7. Earth orientation at true scale ──────────────────────────────────────
// Live Earth is oriented so the (verified) subsolar point faces the real Sun
// direction, with the pole hinted at the IAU spin axis. Check the pole lands
// on the IAU axis, the Greenwich meridian matches sidereal time, and London
// sunrise/sunset still come out right through this chain.
{
  const q3 = new THREE.Quaternion(), pole = new THREE.Vector3(), sunD = new THREE.Vector3(), e = new THREE.Vector3()
  const gm = new THREE.Vector3(), ref = new THREE.Vector3()
  const q2b = new THREE.Quaternion()
  let worstPole = 0, worstMer = 0, worstSun = 0
  const orient = (ms: number) => {
    earthPositionKm(ms, e)
    sunD.copy(e).negate().normalize()
    bodyPole('earth', ms, pole)
    subsolarPoint(ms, s)
    orientTowardSun(s.lat, s.lon, sunD, q3, pole)
  }
  for (let ms = t('2026-01-01T00:00:00Z'); ms < t('2027-01-01T00:00:00Z'); ms += 5.3 * 86400000 + 3333000) {
    orient(ms)
    worstPole = Math.max(worstPole, tmp.set(0, 1, 0).applyQuaternion(q3).angleTo(pole) / DEG)
    latLonToLocal(s.lat, s.lon, 1, tmp).applyQuaternion(q3)
    worstSun = Math.max(worstSun, tmp.angleTo(sunD) / DEG)
    // Greenwich (lon 0, on the equator) vs the IAU prime meridian W.
    gm.set(1, 0, 0).applyQuaternion(q3)
    bodyQuaternion('earth', ms, q2b)
    ref.set(1, 0, 0).applyQuaternion(q2b)
    worstMer = Math.max(worstMer, gm.angleTo(ref) / DEG)
  }
  check('true-scale Earth: subsolar point faces the real Sun', worstSun < 1e-6, `max ${worstSun.toExponential(1)}°`)
  check('true-scale Earth: pole on the IAU spin axis (2026)', worstPole < 0.1, `max ${worstPole.toFixed(4)}°`)
  check('true-scale Earth: Greenwich meridian vs IAU W (sidereal rotation)', worstMer < 0.3, `max ${worstMer.toFixed(3)}°`)
  const elevTS = (ms: number, lat: number, lon: number) => {
    orient(ms)
    latLonToLocal(lat, lon, 1, tmp).applyQuaternion(q3)
    return Math.asin(tmp.dot(sunD)) / DEG
  }
  const rise = elevTS(t('2024-06-21T03:43:30Z'), 51.5074, -0.1278)
  const set  = elevTS(t('2024-06-21T20:21:30Z'), 51.5074, -0.1278)
  check('true-scale chain: London sunrise 2024-06-21 03:43Z', Math.abs(rise + 0.833) < 0.3, `elev ${rise.toFixed(2)}° (ref −0.83°)`)
  check('true-scale chain: London sunset 2024-06-21 20:21Z', Math.abs(set + 0.833) < 0.3, `elev ${set.toFixed(2)}° (ref −0.83°)`)
}

// ── 8. Saturn's ring opening angle and apparent magnitudes vs Horizons ──────
// Horizons observer tables from the geocentre (QUANTITIES 9, 14, 24). Ring
// opening = Earth's Saturnicentric latitude; Horizons gives it planetodetic,
// converted here to planetocentric (flattening 0.09796).
{
  const satRef: [string, number][] = [['2026-11-21T00:00:00Z', -7.585570], ['2040-01-01T00:00:00Z', 9.601223], ['2000-01-01T12:00:00Z', -23.025474]]
  const sat = new THREE.Vector3(), e = new THREE.Vector3(), p = new THREE.Vector3()
  const f = 0.09796
  for (const [iso, detic] of satRef) {
    const ms = t(iso) - TT_MINUS_UTC_S * 1000
    planetBarycentreKm('saturn', ms, sat); earthPositionKm(ms, e)
    bodyPole('saturn', ms, p)
    const B = Math.asin(p.dot(e.sub(sat).normalize())) / DEG
    const centric = Math.atan((1 - f) * (1 - f) * Math.tan(detic * DEG)) / DEG
    check(`Saturn ring opening seen from Earth ${iso.slice(0, 10)}`, Math.abs(B - centric) < 0.3,
      `${B.toFixed(2)}° (Horizons ${centric.toFixed(2)}° planetocentric, ${detic.toFixed(2)}° planetodetic)`)
  }
  // [body, ISO (UT), Horizons APmag, r (AU), delta (AU), S-T-O (deg)]
  const mags: [BodyId, string, number, number, number, number][] = [
    ['mercury', '2026-11-21', -0.484, 0.339139019, 1.000868946, 78.0513],
    ['venus',   '2026-11-21', -4.878, 0.720624564, 0.363185078, 128.3756],
    ['mars',    '2026-11-21',  0.638, 1.614621540, 1.264395450, 37.7285],
    ['jupiter', '2026-11-21', -2.122, 5.323192990, 5.188841029, 10.6893],
    ['uranus',  '2026-11-21',  5.600, 19.43203764, 18.44788520, 0.2707],
    ['neptune', '2026-11-21',  7.713, 29.87684497, 29.32655366, 1.5842],
    ['moon',    '2026-11-21', -11.497, 0.989671848, 0.002525199, 48.5309],
    ['mercury', '2040-01-01', -1.157, 0.462771956, 1.442198119, 6.1294],
    ['venus',   '2040-01-01', -4.021, 0.720661994, 1.212722411, 54.1745],
    ['mars',    '2040-01-01', -1.584, 1.594336845, 0.612143215, 2.7256],
    ['jupiter', '2040-01-01', -2.083, 5.428749534, 5.192185609, 10.3173],
    ['neptune', '2040-01-01',  7.717, 29.81197332, 29.45080229, 1.7655],
  ]
  let worst = 0, worstName = ''
  for (const [id, , ref, r, dlt, a] of mags) {
    const d = Math.abs(apparentMagnitude(id, r, dlt, a) - ref)
    if (d > worst) { worst = d; worstName = id }
  }
  check('apparent magnitudes (7 bodies, 2 dates) vs Horizons APmag', worst < 0.25, `max |Δ| ${worst.toFixed(3)} mag (${worstName})`)
  // Saturn with its rings, 2026-11-21: Horizons 0.560 mag.
  {
    const ms = t('2026-11-21T00:00:00Z')
    planetBarycentreKm('saturn', ms, sat); earthPositionKm(ms, e); bodyPole('saturn', ms, p)
    const B = Math.asin(Math.abs(p.dot(tmp.copy(e).sub(sat).normalize()))) / DEG
    const m = apparentMagnitude('saturn', 9.419172706, 8.759207836, 4.6337, B)
    check('Saturn magnitude incl. rings 2026-11-21', Math.abs(m - 0.560) < 0.15, `${m.toFixed(3)} (Horizons 0.560, ring tilt ${B.toFixed(2)}°)`)
  }
}

// ── Optional: render a day/night map through the 3D chain ───────────────────
const ri = process.argv.indexOf('--render')
if (ri > 0 && process.argv[ri + 1]) {
  const { createRequire } = await import('node:module')
  const require = createRequire(import.meta.url)
  const sharp   = require('sharp')
  const path    = await import('node:path')
  const outDir  = process.argv[ri + 1]
  const ms      = process.argv[ri + 2] ? Date.parse(process.argv[ri + 2]) : Date.now()
  const W = 1024, H = 512
  const day = await sharp(path.resolve('public/earth/earth-day.jpg')).resize(W, H).removeAlpha().raw().toBuffer()
  subsolarPoint(ms, s)
  orientTowardSun(s.lat, s.lon, sunDir, q)
  const out = Buffer.alloc(W * H * 3)
  for (let y = 0; y < H; y++) {
    const lat = 90 - (y + 0.5) * 180 / H
    for (let x = 0; x < W; x++) {
      const lon = (x + 0.5) * 360 / W - 180
      latLonToLocal(lat, lon, 1, tmp).applyQuaternion(q)
      const mu    = tmp.dot(sunDir)
      const light = mu > 0.01 ? 1 : mu > -0.105 ? 0.55 : 0.25   // day / twilight (to −6°) / night
      const i = (y * W + x) * 3
      out[i] = day[i] * light; out[i + 1] = day[i + 1] * light; out[i + 2] = day[i + 2] * light
    }
  }
  const mark = (lat: number, lon: number, rgb: [number, number, number]) => {
    const cx = Math.round((lon + 180) / 360 * W), cy = Math.round((90 - lat) / 180 * H)
    for (let d = -6; d <= 6; d++) for (const [x, y] of [[cx + d, cy], [cx, cy + d]]) {
      if (x < 0 || x >= W || y < 0 || y >= H) continue
      out.set(rgb, (y * W + x) * 3)
    }
  }
  mark(s.lat, s.lon, [255, 220, 0])
  mark(-26.2041, 28.0473, [255, 60, 60])
  const file = path.join(outDir, `daynight-${new Date(ms).toISOString().slice(0, 16).replace(':', '')}Z.png`)
  await sharp(out, { raw: { width: W, height: H, channels: 3 } }).png().toFile(file)
  console.log(`\nwrote ${file} (yellow + = subsolar point, red + = Johannesburg pin)`)
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed')
process.exitCode = failures ? 1 : 0
