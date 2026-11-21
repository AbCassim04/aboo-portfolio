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
// With --render it also writes an equirectangular day/night map for "now",
// produced through the full 3D chain, to compare with a real day/night map.

import * as THREE from 'three'
import {
  createMoonResult, createSubsolarResult, gmstDeg, moonPosition, subsolarPoint, wrap180,
} from '../src/earth/astro.ts'
import { latLonToLocal, localToLatLon, orientTowardSun } from '../src/earth/geo.ts'

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
