// Turn brightness-temperature fields into one RGBA cloud texture.
//
// 1. Geostationary blend: GIBS satellites (sharp, 10-min) are averaged with
//    view-angle weights that taper from 60° to 76° off nadir, so the seams
//    between satellites — and between GIBS and the base layer — are soft
//    cross-fades rather than lines. Where the GIBS weight is < 1 the base layer
//    (GMGSI, or the EUMETSAT ring) fills in; in the Meteosat sector it is the
//    only geostationary source.
// 2. Clear-sky reference: IR sees the surface as well as clouds, so "cloud" is
//    "colder than the clear-sky surface would be here". The reference is the
//    warm tail of the local temperature distribution (85th percentile per
//    ~1.4° block, max over a ~7° neighbourhood, smoothed), capped at 8 K above
//    the block's own warm tail so hot deserts don't make neighbouring clear
//    ground look cloudy.
// 3. Opacity rises from 6 K to 30 K below that reference; brightness rises
//    with cloud-top height (colder = thicker-looking, brighter).
// 4. Beyond ~64° latitude geostationary IR degrades (grazing view, cold
//    surfaces) and GMGSI ends at 72.7°, so it fades out by 72.5°; MODIS daily
//    cloud fraction takes over, and the static cloud map fills anything left.

import { H, N, ROW_WEIGHT, W, angleFromSubpoint, blurWrap, despeckle, latOfRow, lonOfCol, sampleCoarse, smoothstep } from './grid.mjs'
import { viewWeight } from './gibs.mjs'

// Every operational geostationary imager in the global ring (GOES-East,
// GOES-West, Himawari, Meteosat 0°, Meteosat IODC). Beyond ~68° from the
// nearest one, IR limb cooling makes clear sky read as cloud.
const RING_SUBLONS = [-75.2, -137.2, 140.7, 0, 45.5]
const DEG = Math.PI / 180

const BLOCK = 16
const BW = W / BLOCK, BH = H / BLOCK

/**
 * @param base   { bt, time } | null       global base layer
 * @param geos   [{ bt, time, sat }]        GIBS satellites
 * @returns { bt, timeSum, geoWeightSum }   blended BT + per-pixel time·weight
 */
export function blendGeostationary(base, geos) {
  const bt = new Float32Array(N).fill(NaN)
  const tPix = new Float64Array(N).fill(NaN)       // per-pixel observation time
  const contrib = geos.map(() => 0)
  let baseContrib = 0

  const wRow = new Float32Array(geos.length)
  for (let y = 0; y < H; y++) {
    const lat = latOfRow(y)
    const rw = ROW_WEIGHT[y]
    for (let x = 0; x < W; x++) {
      const i = y * W + x
      const lon = lonOfCol(x)
      let sw = 0, swb = 0, swt = 0
      for (let k = 0; k < geos.length; k++) {
        const v = geos[k].bt[i]
        wRow[k] = 0
        if (Number.isNaN(v)) continue
        const w = viewWeight(angleFromSubpoint(lat, lon, geos[k].sat.subLon))
        if (w <= 0) continue
        wRow[k] = w
        sw += w; swb += w * v; swt += w * geos[k].time
      }
      const b = base ? base.bt[i] : NaN
      const hasBase = !Number.isNaN(b)
      if (sw > 0) {
        const g = Math.min(1, sw)
        const btG = swb / sw, tG = swt / sw
        const gEff = hasBase ? g : 1
        bt[i]   = hasBase ? g * btG + (1 - g) * b : btG
        tPix[i] = hasBase ? g * tG + (1 - g) * base.time : tG
        for (let k = 0; k < geos.length; k++) if (wRow[k]) contrib[k] += rw * gEff * wRow[k] / sw
        if (hasBase) baseContrib += rw * (1 - g)
      } else if (hasBase) {
        bt[i] = b
        tPix[i] = base.time
        baseContrib += rw
      }
    }
  }
  let area = 0
  for (let y = 0; y < H; y++) area += ROW_WEIGHT[y] * W
  // GIBS overview imagery carries isolated impulse pixels (e.g. −58 °C single
  // pixels in clear tropical ocean); remove them before cloud detection.
  const { out, replaced } = despeckle(bt, W, H, 8)
  return { bt: out, tPix, contrib: contrib.map((c) => c / area), baseContrib: baseContrib / area, despeckled: replaced }
}

/** Clear-sky brightness temperature on a coarse BW×BH grid (K, NaN = unknown). */
export function clearSky(bt) {
  const p85 = new Float32Array(BW * BH).fill(NaN)
  const vals = new Float32Array(BLOCK * BLOCK)
  for (let by = 0; by < BH; by++) {
    for (let bx = 0; bx < BW; bx++) {
      let n = 0
      for (let yy = 0; yy < BLOCK; yy++) {
        const o = (by * BLOCK + yy) * W + bx * BLOCK
        for (let xx = 0; xx < BLOCK; xx++) { const v = bt[o + xx]; if (!Number.isNaN(v)) vals[n++] = v }
      }
      if (n >= 24) {
        const s = vals.subarray(0, n).sort()
        p85[by * BW + bx] = s[Math.min(n - 1, Math.floor(n * 0.85))]
      }
    }
  }
  // Neighbourhood max (±2 blocks, wraps in longitude), capped by local warm tail + 8 K.
  const R = 2
  const ref = new Float32Array(BW * BH).fill(NaN)
  for (let by = 0; by < BH; by++) {
    for (let bx = 0; bx < BW; bx++) {
      let m = -Infinity
      for (let dy = -R; dy <= R; dy++) {
        const yy = by + dy
        if (yy < 0 || yy >= BH) continue
        for (let dx = -R; dx <= R; dx++) {
          const v = p85[yy * BW + ((bx + dx + BW) % BW)]
          if (v > m) m = v
        }
      }
      const own = p85[by * BW + bx]
      ref[by * BW + bx] = m === -Infinity ? NaN : Number.isNaN(own) ? m : Math.min(m, own + 8)
    }
  }
  // Fill unknown blocks from the zonal median, then smooth.
  for (let by = 0; by < BH; by++) {
    const row = []
    for (let bx = 0; bx < BW; bx++) { const v = ref[by * BW + bx]; if (!Number.isNaN(v)) row.push(v) }
    if (!row.length) continue
    row.sort((a, b) => a - b)
    const med = row[row.length >> 1]
    for (let bx = 0; bx < BW; bx++) if (Number.isNaN(ref[by * BW + bx])) ref[by * BW + bx] = med
  }
  return blurWrap(ref, BW, BH, 2, 2)
}

/**
 * Compose the final texture.
 * @returns { rgba: Uint8Array(N·4), weights: { geo, polar, static } (area fractions), timeMean }
 */
export function composeClouds({ geo, polar, staticOpacity }) {
  const rgba = new Uint8Array(N * 4)
  const ref = geo ? clearSky(geo.bt) : null
  let aGeo = 0, aPolar = 0, aStatic = 0, area = 0
  let tSum = 0, tW = 0

  for (let y = 0; y < H; y++) {
    const lat = latOfRow(y)
    const rw  = ROW_WEIGHT[y]
    const latFade = 1 - smoothstep(64, 72.5, Math.abs(lat))
    const cosLat  = Math.cos(lat * DEG)
    for (let x = 0; x < W; x++) {
      const i = y * W + x
      let bestCos = -1
      for (const sl of RING_SUBLONS) bestCos = Math.max(bestCos, cosLat * Math.cos((lonOfCol(x) - sl) * DEG))
      const viewFade = 1 - smoothstep(68, 78, Math.acos(bestCos) / DEG)
      let oGeo = 0, bGeo = 0.9, cGeo = 0
      if (geo && !Number.isNaN(geo.bt[i])) {
        const tc = sampleCoarse(ref, BW, BH, x, y)
        const d  = tc - geo.bt[i]
        oGeo = smoothstep(7, 32, d)
        bGeo = 0.80 + 0.20 * smoothstep(12, 60, d)
        cGeo = Math.min(latFade, viewFade)
      }
      let oRest, bRest = 0.92, fromPolar = false
      const cf = polar ? polar.cf[i] : NaN
      if (!Number.isNaN(cf)) {
        oRest = smoothstep(0.2, 1.0, cf) * 0.85
        fromPolar = true
      } else {
        oRest = staticOpacity[i]
        bRest = 0.94
      }
      const o = cGeo * oGeo + (1 - cGeo) * oRest
      const b = cGeo * bGeo + (1 - cGeo) * bRest
      const B = Math.round(b * 255)
      rgba[i * 4] = B; rgba[i * 4 + 1] = B; rgba[i * 4 + 2] = B
      rgba[i * 4 + 3] = Math.round(Math.max(0, Math.min(1, o)) * 255)

      area   += rw
      aGeo   += rw * cGeo
      if (fromPolar) aPolar += rw * (1 - cGeo)
      else           aStatic += rw * (1 - cGeo)
      if (cGeo > 0 && Number.isFinite(geo.tPix[i])) { tSum += rw * cGeo * geo.tPix[i]; tW += rw * cGeo }
      if (fromPolar && cGeo < 1) { tSum += rw * (1 - cGeo) * polar.time; tW += rw * (1 - cGeo) }
    }
  }
  return {
    rgba,
    weights: { geo: aGeo / area, polar: aPolar / area, static: aStatic / area },
    timeMean: tW > 0 ? tSum / tW : NaN,
  }
}
