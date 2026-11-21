// Global "base" IR layers that include the Meteosat sector (Africa, Europe,
// Indian Ocean), which GIBS lacks:
//   1. NOAA GMGSI longwave IR — hourly global mosaic of GOES-E/W, Himawari and
//      Meteosat, ~8 km, Mercator to ±72.7°, NetCDF4 on the NOAA Open Data
//      Dissemination bucket (public S3, no credentials).
//   2. EUMETSAT "Geostationary Ring IR10.8 – Multimission" via EUMETView WMS —
//      3-hourly, ±81°. Used only if GMGSI is unavailable.

import { createRequire } from 'node:module'
import { H, N, W, latOfRow, lonOfCol } from './grid.mjs'
import { fetchRetry, iso, log } from './util.mjs'

const require = createRequire(import.meta.url)
const sharp = require('sharp')
const hdf5  = require('jsfive')

// ── GMGSI ───────────────────────────────────────────────────────────────────

const GMGSI_BUCKET = 'https://noaa-gmgsi-pds.s3.amazonaws.com'

/**
 * GMGSI stores 0–255 "brightness" counts. They follow the McIDAS IR
 * brightness mapping (verified against GIBS band-13 temperatures to ~1 K):
 *   T = 330 − c/2   for c ≤ 176,   T = 418 − c   for c > 176.
 */
const countToK = (c) => (c <= 176 ? 330 - c / 2 : 418 - c)

async function listGmgsi(nowMs) {
  for (let h = 0; h <= 6; h++) {
    const t = new Date(nowMs - h * 3600_000)
    const prefix = `GMGSI_LW/${t.getUTCFullYear()}/${String(t.getUTCMonth() + 1).padStart(2, '0')}/${String(t.getUTCDate()).padStart(2, '0')}/${String(t.getUTCHours()).padStart(2, '0')}/`
    const { text } = await fetchRetry(`${GMGSI_BUCKET}/?list-type=2&prefix=${prefix}`, { as: 'text', timeoutMs: 30_000, label: `GMGSI list ${prefix}` })
    const keys = [...text.matchAll(/<Key>([^<]+\.nc)<\/Key>/g)].map((m) => m[1]).sort()
    if (keys.length) return keys[keys.length - 1]
  }
  throw new Error('no GMGSI file in the last 6 hours')
}

export async function fetchGmgsi(nowMs) {
  const key = await listGmgsi(nowMs)
  const { buffer } = await fetchRetry(`${GMGSI_BUCKET}/${key}`, { timeoutMs: 240_000, label: 'GMGSI download' })
  log(`  GMGSI ${key.split('/').pop()} (${(buffer.length / 1e6).toFixed(1)} MB)`)

  const f    = new hdf5.File(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), key)
  const data = f.get('data').value
  const lat  = f.get('lat').value
  const lon  = f.get('lon').value
  const [, sh, sw] = f.get('data').shape
  const time = Number(f.get('time').value[0]) * 1000

  // lat is constant along rows (Mercator spacing, descending); lon constant
  // along columns, increasing, with column 0 at +180 (= −180).
  const lats = new Float64Array(sh)
  for (let r = 0; r < sh; r++) lats[r] = lat[r * sw + 1]
  const lon1 = lon[1], step = (lon[sw - 1] - lon[1]) / (sw - 2)
  const lon0 = lon1 - step                       // column 0 as a −180° column

  // Counts ≥ 240 (< 180 K) are colder than any real cloud top (the coldest
  // tropical overshooting tops in GMGSI sit around count 236): they are space
  // or the extreme limb where a disc ends without a neighbouring satellite.
  // Mask them, plus a few pixels around them so the limb gradient goes too.
  const SPACE = 240, GROW = 6
  const bad = new Uint8Array(sh * sw)
  for (let r = 0; r < sh; r++) {
    for (let c = 0; c < sw; c++) {
      if (data[r * sw + c] < SPACE) continue
      for (let dr = -GROW; dr <= GROW; dr++) {
        const rr = r + dr
        if (rr < 0 || rr >= sh) continue
        for (let dc = -GROW; dc <= GROW; dc++) bad[rr * sw + ((c + dc + sw) % sw)] = 1
      }
    }
  }
  const bt = new Float32Array(N).fill(NaN)
  const val = (r, c) => {
    const i = r * sw + ((c % sw) + sw) % sw
    const v = data[i]
    return v > 0 && v < SPACE && !bad[i] ? countToK(v) : NaN
  }
  for (let y = 0; y < H; y++) {
    const la = latOfRow(y)
    if (la > lats[0] || la < lats[sh - 1]) continue
    let lo = 0, hi = sh - 1                      // binary search, lats descending
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (lats[m] >= la) lo = m; else hi = m }
    const fy = (lats[lo] - la) / (lats[lo] - lats[hi])
    for (let x = 0; x < W; x++) {
      const gx = (lonOfCol(x) - lon0) / step
      const c0 = Math.floor(gx), fx = gx - c0
      const a = val(lo, c0), b = val(lo, c0 + 1), c = val(hi, c0), d = val(hi, c0 + 1)
      const v = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy
      if (Number.isFinite(v)) bt[y * W + x] = v
      else {                                      // nearest valid neighbour at holes / edges
        const n = [[a, (1 - fx) * (1 - fy)], [b, fx * (1 - fy)], [c, (1 - fx) * fy], [d, fx * fy]]
          .filter(([q]) => Number.isFinite(q)).sort((p, q) => q[1] - p[1])
        if (n.length) bt[y * W + x] = n[0][0]
      }
    }
  }
  return { bt, time, id: 'gmgsi', label: 'NOAA GMGSI longwave IR (GOES, Himawari, Meteosat)', credit: 'NOAA GMGSI', file: key }
}

// ── EUMETSAT geostationary ring (fallback) ──────────────────────────────────

const EUM_WMS   = 'https://view.eumetsat.int/geoserver/wms'
const EUM_LAYER = 'mumi:worldcloudmap_ir108'

// Grey level → brightness temperature (K). Fitted by quantile matching against
// a simultaneous GMGSI field (2026-11-21 00Z): the WMS stretch is non-linear.
const EUM_GREY_TO_K = [
  [0, 330], [22, 319.5], [66, 295], [70, 292.5], [77, 286], [85, 278], [93, 270],
  [103, 262.5], [114, 256.5], [127, 250.5], [143, 244.5], [162, 236], [184, 228], [255, 195],
]
const eumLut = new Float32Array(256)
for (let g = 0; g < 256; g++) {
  let k = 0
  while (k < EUM_GREY_TO_K.length - 2 && EUM_GREY_TO_K[k + 1][0] < g) k++
  const [g0, t0] = EUM_GREY_TO_K[k], [g1, t1] = EUM_GREY_TO_K[k + 1]
  eumLut[g] = t0 + (t1 - t0) * Math.max(0, Math.min(1, (g - g0) / (g1 - g0)))
}

export async function fetchEumetsatRing() {
  const { text } = await fetchRetry(`${EUM_WMS}?service=WMS&request=GetCapabilities&version=1.3.0`, { as: 'text', timeoutMs: 60_000, label: 'EUMETView capabilities' })
  const i = text.indexOf(`<Name>${EUM_LAYER}</Name>`)
  const dim = i >= 0 ? text.slice(i, i + 4000).match(/<Dimension name="time" default="([^"]+)"/) : null
  if (!dim) throw new Error('layer or time dimension not found')
  const time = Date.parse(dim[1])
  const p = new URLSearchParams({
    SERVICE: 'WMS', REQUEST: 'GetMap', VERSION: '1.3.0', LAYERS: EUM_LAYER, STYLES: '',
    CRS: 'EPSG:4326', BBOX: '-90,-180,90,180', WIDTH: String(W), HEIGHT: String(H),
    FORMAT: 'image/png', TIME: iso(time),
  })
  const { buffer } = await fetchRetry(`${EUM_WMS}?${p}`, { timeoutMs: 300_000, label: 'EUMETView GetMap' })
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  if (info.width !== W || info.height !== H) throw new Error(`unexpected size ${info.width}×${info.height}`)
  const bt = new Float32Array(N).fill(NaN)
  for (let i2 = 0; i2 < N; i2++) if (data[i2 * 4 + 3] >= 250) bt[i2] = eumLut[data[i2 * 4]]
  return { bt, time, id: 'eumetsat-ring', label: 'EUMETSAT geostationary ring IR10.8 (multi-mission)', credit: 'EUMETSAT' }
}
