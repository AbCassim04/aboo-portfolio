// NASA GIBS sources (no key):
//  • GOES-East / GOES-West / Himawari ABI·AHI Band 13 "Clean IR" (10.3 µm),
//    10-minute cadence, ~30–40 min latency. Colour-mapped PNG → brightness
//    temperature through the published GIBS colour map.
//  • MODIS Aqua/Terra cloud fraction (daily, polar-orbiting) for the polar caps
//    that geostationary satellites cannot see well.

import { createRequire } from 'node:module'
import { H, N, W, angleFromSubpoint, blurWrap, latOfRow, lonOfCol, pushPullFill } from './grid.mjs'
import { buildPaletteInverse, fetchRetry, iso, latestFromDomain, log } from './util.mjs'

const require = createRequire(import.meta.url)
const sharp = require('sharp')

const GIBS     = 'https://gibs.earthdata.nasa.gov'
const WMS      = `${GIBS}/wms/epsg4326/best/wms.cgi`
const DOMAINS  = (layer, tms, range) => `${GIBS}/wmts/epsg4326/best/1.0.0/${layer}/default/${tms}/all/${range}.xml`
const IR_CMAP  = `${GIBS}/colormaps/v1.3/Clean_Longwave_Infrared_Window_Band.xml`
const CF_CMAP  = `${GIBS}/colormaps/v1.3/MODIS_Cloud_Fraction.xml`

export const GEO_SATS = [
  // Nominal sub-satellite longitudes (operational positions as of 2025–26).
  { id: 'goes-east', label: 'GOES-East ABI band 13 (NASA GIBS)', credit: 'NOAA GOES', layer: 'GOES-East_ABI_Band13_Clean_Infrared', subLon: -75.2 },
  { id: 'goes-west', label: 'GOES-West ABI band 13 (NASA GIBS)', credit: 'NOAA GOES', layer: 'GOES-West_ABI_Band13_Clean_Infrared', subLon: -137.2 },
  { id: 'himawari',  label: 'Himawari AHI band 13 (NASA GIBS)',  credit: 'JMA Himawari', layer: 'Himawari_AHI_Band13_Clean_Infrared', subLon: 140.7 },
]

/** Seam taper: full weight within 60° of the sub-satellite point, 0 by 76°. */
export function viewWeight(angleDeg) {
  if (angleDeg <= 60) return 1
  if (angleDeg >= 76) return 0
  const t = (76 - angleDeg) / 16
  return t * t * (3 - 2 * t)
}

async function latestTime(layer, tms, spanMs, nowMs, daily = false) {
  const fmt = (ms) => (daily ? iso(ms).slice(0, 10) : iso(ms))
  const range = `${fmt(nowMs - spanMs)}--${fmt(nowMs)}`
  const { text } = await fetchRetry(DOMAINS(layer, tms, range), { as: 'text', timeoutMs: 30_000, label: `${layer} domains` })
  const dom = text.match(/<Domain>([^<]*)<\/Domain>/)
  if (!dom) throw new Error('no time domain')
  const t = latestFromDomain(dom[1])
  if (!Number.isFinite(t)) throw new Error(`unparseable domain "${dom[1]}"`)
  return t
}

function wmsUrl(layer, timeStr, bbox, width, height) {
  const p = new URLSearchParams({
    SERVICE: 'WMS', REQUEST: 'GetMap', VERSION: '1.3.0', LAYERS: layer, STYLES: '',
    CRS: 'EPSG:4326', BBOX: bbox, WIDTH: String(width), HEIGHT: String(height),
    FORMAT: 'image/png', TRANSPARENT: 'TRUE', TIME: timeStr,
  })
  return `${WMS}?${p}`
}

let irInverse = null
async function getIrInverse() {
  if (!irInverse) {
    const { text } = await fetchRetry(IR_CMAP, { as: 'text', timeoutMs: 30_000, label: 'IR colour map' })
    irInverse = buildPaletteInverse(text, { toValue: (lo, hi) => (lo + hi) / 2 + 273.15 })   // °C → K
  }
  return irInverse
}

/**
 * Fetch one geostationary satellite's latest complete image onto the master
 * grid. Returns { bt: Float32Array (NaN = no data), time, sat } or throws.
 */
export async function fetchGeoSat(sat, nowMs) {
  const inverse = await getIrInverse()
  let t = await latestTime(sat.layer, '2km', 6 * 3600_000, nowMs)
  for (let attempt = 0; attempt < 5; attempt++, t -= 10 * 60_000) {
    const { buffer } = await fetchRetry(wmsUrl(sat.layer, iso(t), '-90,-180,90,180', W, H), {
      timeoutMs: 120_000, label: `${sat.id} ${iso(t)}`,
    })
    const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    if (info.width !== W || info.height !== H) throw new Error(`unexpected size ${info.width}×${info.height}`)

    const bt = new Float32Array(N).fill(NaN)
    let inDisk = 0, validInDisk = 0
    for (let y = 0; y < H; y++) {
      const lat = latOfRow(y)
      for (let x = 0; x < W; x++) {
        const i = y * W + x
        const p = i * 4
        const core = angleFromSubpoint(lat, lonOfCol(x), sat.subLon) < 55
        if (core) inDisk++
        if (data[p + 3] < 250) continue          // transparent / anti-aliased disc edge
        bt[i] = inverse(data[p], data[p + 1], data[p + 2])
        if (core) validInDisk++
      }
    }
    const completeness = inDisk ? validInDisk / inDisk : 0
    if (completeness >= 0.9) return { bt, time: t, sat }
    log(`  ${sat.id} ${iso(t)} only ${(completeness * 100).toFixed(0)}% complete — trying the previous slot`)
  }
  throw new Error('no complete image in the last five slots')
}

// ── MODIS cloud fraction (polar caps) ────────────────────────────────────────

const POLAR_LAYERS = [
  { layer: 'MODIS_Aqua_Cloud_Fraction_Night',  label: 'Aqua night'  },
  { layer: 'MODIS_Aqua_Cloud_Fraction_Day',    label: 'Aqua day'    },
  { layer: 'MODIS_Terra_Cloud_Fraction_Day',   label: 'Terra day'   },
]
export const POLAR_EDGE = 55   // fetch |lat| ≥ 55°

/**
 * Daily MODIS cloud fraction for the two polar caps on the master grid.
 * Returns { cf: Float32Array (0..1, NaN = none), time, layers } or throws.
 */
export async function fetchPolar(nowMs) {
  const { text } = await fetchRetry(CF_CMAP, { as: 'text', timeoutMs: 30_000, label: 'cloud-fraction colour map' })
  const inverse = buildPaletteInverse(text)
  const rows = Math.round((90 - POLAR_EDGE) / 180 * H)
  const sum = new Float32Array(N), cnt = new Uint8Array(N)
  const used = []
  let newest = NaN

  for (const L of POLAR_LAYERS) {
    try {
      const day = await latestTime(L.layer, '2km', 3 * 86400_000, nowMs, true)
      const date = iso(day).slice(0, 10)
      for (const [bbox, y0] of [[`${POLAR_EDGE},-180,90,180`, 0], [`-90,-180,${-POLAR_EDGE},180`, H - rows]]) {
        const { buffer } = await fetchRetry(wmsUrl(L.layer, date, bbox, W, rows), { timeoutMs: 90_000, label: `${L.label} ${date}` })
        const { data } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
        for (let yy = 0; yy < rows; yy++) {
          for (let x = 0; x < W; x++) {
            const p = (yy * W + x) * 4
            if (data[p + 3] < 250) continue
            const i = (y0 + yy) * W + x
            sum[i] += inverse(data[p], data[p + 1], data[p + 2]) / 100
            cnt[i]++
          }
        }
      }
      used.push(`${L.label} ${date}`)
      // Daily composite of swaths from that UTC day: nominal time = midday,
      // but never later than ~3 h ago (MODIS near-real-time latency).
      newest = Math.max(Number.isFinite(newest) ? newest : 0, Math.min(nowMs - 3 * 3600_000, day + 12 * 3600_000))
    } catch (err) {
      log(`  polar ${L.label}: ${err.message}`)
    }
  }
  if (!used.length) throw new Error('no MODIS cloud-fraction layer available')
  // Swaths in a daily composite are hours apart and leave gaps at lower
  // latitudes: fill the gaps from coarser levels and soften the swath seams.
  const cf = new Float32Array(N).fill(NaN)
  for (const y0 of [0, H - rows]) {
    const band = new Float32Array(W * rows)
    for (let k = 0; k < W * rows; k++) { const i = y0 * W + k; band[k] = cnt[i] ? sum[i] / cnt[i] : NaN }
    const filled = blurWrap(pushPullFill(band, W, rows), W, rows, 6, 2)
    cf.set(filled, y0 * W)
  }
  return { cf, time: newest, layers: used }
}
