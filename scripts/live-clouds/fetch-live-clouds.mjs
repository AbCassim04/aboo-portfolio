#!/usr/bin/env node
// Build the live cloud texture for the flight-mode Earth.
//
//   npm run fetch:clouds                       → public/live/{clouds-4096.webp, clouds-2048.webp, manifest.json}
//   npm run fetch:clouds -- --debug <dir>      → also writes greyscale previews of each stage
//   npm run fetch:clouds -- --previous <url>   → site base URL to re-use if every source fails
//                                                 (the workflow passes the GitHub Pages URL; env LIVE_PREVIOUS_URL works too)
//   npm run fetch:clouds -- --skip gmgsi,goes-west,polar   (testing the fallback chain)
//
// Fallback chain (each step degrades independently, nothing here fails the build):
//   GIBS GOES-E/GOES-W/Himawari (10-min) ─┐
//   NOAA GMGSI hourly global (→ EUMETSAT ring if GMGSI is down) ─┴→ geostationary blend
//   MODIS daily cloud fraction → polar caps;  static cloud map → anything left
//   < 50% geostationary coverage → re-use the last deployed build → else manifest "clouds: null"
//   (the app then uses the static texture).

import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { H, N, W, globalFraction } from './lib/grid.mjs'
import { GEO_SATS, fetchGeoSat, fetchPolar } from './lib/gibs.mjs'
import { fetchEumetsatRing, fetchGmgsi } from './lib/base.mjs'
import { blendGeostationary, composeClouds } from './lib/compose.mjs'
import { fetchRetry, iso, log, setDeadline } from './lib/util.mjs'

const require = createRequire(import.meta.url)
const sharp = require('sharp')

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback
}
const OUT      = path.resolve(arg('out', path.join(ROOT, 'public/live')))
const DEBUG    = arg('debug')
const PREVIOUS = arg('previous', process.env.LIVE_PREVIOUS_URL || null)
const SKIP     = new Set((arg('skip', '') || '').split(',').filter(Boolean))
setDeadline(Number(arg('deadline-min', 9)) * 60_000)

const MIN_GEO_COVERAGE = 0.5
const FILES = {
  desktop: { file: 'clouds-4096.webp', width: 4096, height: 2048 },
  mobile:  { file: 'clouds-2048.webp', width: 2048, height: 1024 },
}

async function writeDebug(name, values, scale = (v) => v) {
  if (!DEBUG) return
  fs.mkdirSync(DEBUG, { recursive: true })
  const g = Buffer.alloc(N)
  for (let i = 0; i < N; i++) { const v = scale(values[i]); g[i] = Number.isFinite(v) ? Math.max(0, Math.min(255, Math.round(v * 255))) : 0 }
  await sharp(g, { raw: { width: W, height: H, channels: 1 } }).resize(2048, 1024).png().toFile(path.join(DEBUG, name))
}

async function staticOpacity() {
  const { data } = await sharp(path.join(ROOT, 'public/earth/earth-clouds-4k.jpg'))
    .resize(W, H, { fit: 'fill' }).greyscale().raw().toBuffer({ resolveWithObject: true })
  const o = new Float32Array(N)
  for (let i = 0; i < N; i++) {
    // Same curve the runtime shader uses for the static map.
    const t = Math.max(0, Math.min(1, (data[i] / 255 - 0.08) / (0.85 - 0.08)))
    o[i] = t * t * (3 - 2 * t)
  }
  return o
}

async function writeOutputs(rgba) {
  fs.mkdirSync(OUT, { recursive: true })
  const img = sharp(Buffer.from(rgba.buffer), { raw: { width: W, height: H, channels: 4 } })
  const out = {}
  for (const [key, f] of Object.entries(FILES)) {
    const tmp = path.join(OUT, f.file + '.tmp')
    await img.clone()
      .resize(f.width, f.height, { kernel: 'lanczos3' })
      .webp({ quality: 75, alphaQuality: 70, effort: 6, smartSubsample: true })   // ~1.3 MB / ~0.75 MB
      .toFile(tmp)
    fs.renameSync(tmp, path.join(OUT, f.file))
    out[key] = { ...f, bytes: fs.statSync(path.join(OUT, f.file)).size }
  }
  return out
}

function writeManifest(manifest) {
  fs.mkdirSync(OUT, { recursive: true })
  const tmp = path.join(OUT, 'manifest.json.tmp')
  fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2) + '\n')
  fs.renameSync(tmp, path.join(OUT, 'manifest.json'))
}

/** Re-use the currently deployed build (files + manifest) if it exists. */
async function reusePrevious(reason, sources) {
  if (!PREVIOUS) return false
  const base = PREVIOUS.endsWith('/') ? PREVIOUS : PREVIOUS + '/'
  try {
    const { text } = await fetchRetry(`${base}live/manifest.json`, { as: 'text', timeoutMs: 30_000, label: 'previous manifest' })
    const prev = JSON.parse(text)
    if (!prev?.clouds?.files) throw new Error('previous build has no live clouds')
    // Don't resurrect data older than two days.
    if (Date.now() - Date.parse(prev.clouds.dataTime) > 48 * 3600_000) throw new Error('previous live data is older than 48 h')
    fs.mkdirSync(OUT, { recursive: true })
    for (const f of Object.values(prev.clouds.files)) {
      if (!/^[\w.-]+$/.test(f.file)) throw new Error(`bad file name ${f.file}`)
      const { buffer } = await fetchRetry(`${base}live/${f.file}`, { timeoutMs: 120_000, label: `previous ${f.file}` })
      fs.writeFileSync(path.join(OUT, f.file), buffer)
    }
    writeManifest({
      ...prev,
      clouds: {
        ...prev.clouds,
        status:  'previous',
        sources: [{ id: 'previous-build', label: `Re-used build from ${prev.generatedAt} (${reason})`, time: prev.clouds.dataTime, ok: true, coverage: 1 }, ...sources],
      },
    })
    log(`re-used previous build (${reason})`)
    return true
  } catch (err) {
    log(`previous build not usable: ${err.message}`)
    return false
  }
}

async function main() {
  const now = Date.now()
  log(`building live clouds for ${iso(now)} → ${path.relative(process.cwd(), OUT) || OUT}`)
  const sources = []
  const note = (id, label, extra) => sources.push({ id, label, time: null, ok: false, coverage: 0, ...extra })

  // Kick off everything independent in parallel. Every task is wrapped so it
  // settles to { ok, value | error } immediately — a source failing early must
  // never surface as an unhandled rejection while others are still running.
  const settle = (p) => p.then((value) => ({ ok: true, value }), (error) => ({ ok: false, error }))
  const run = (id, fn) => (SKIP.has(id)
    ? Promise.resolve({ ok: false, error: new Error('skipped') })
    : settle(Promise.resolve().then(fn)))

  const geoP = GEO_SATS.map((sat) => run(sat.id, () => fetchGeoSat(sat, now)))
  // Base layer: GMGSI, falling back to the EUMETSAT ring as soon as GMGSI fails.
  const baseP = run('gmgsi', () => fetchGmgsi(now)).then(async (r) => {
    if (r.ok) return { ...r, failed: [] }
    const failed = [{ id: 'gmgsi', label: 'NOAA GMGSI longwave IR', error: r.error }]
    const e = await run('eumetsat', () => fetchEumetsatRing())
    if (!e.ok) failed.push({ id: 'eumetsat-ring', label: 'EUMETSAT geostationary ring IR10.8', error: e.error })
    return { ...e, failed }
  })
  const polarP  = run('polar', () => fetchPolar(now))
  const staticP = settle(staticOpacity())

  const geos = []
  ;(await Promise.all(geoP)).forEach((r, k) => {
    const sat = GEO_SATS[k]
    if (r.ok) { geos.push(r.value); log(`ok   ${sat.id} ${iso(r.value.time)}`) }
    else { note(sat.id, sat.label, { note: r.error?.message }); log(`FAIL ${sat.id}: ${r.error?.message}`) }
  })

  const baseR = await baseP
  for (const f of baseR.failed) { log(`FAIL ${f.id}: ${f.error?.message}`); note(f.id, f.label, { note: f.error?.message }) }
  const base = baseR.ok ? baseR.value : null
  if (base) log(`ok   ${base.id} ${iso(base.time)}`)

  const polarR = await polarP
  const polar  = polarR.ok ? polarR.value : null
  if (polar) log(`ok   MODIS polar (${polar.layers.join(', ')})`)
  else {
    log(`FAIL MODIS polar: ${polarR.error?.message}`)
    note('modis-polar', 'MODIS cloud fraction (polar caps)', { note: polarR.error?.message })
  }

  const staticR = await staticP
  if (!staticR.ok) log(`static cloud map unavailable (${staticR.error?.message}) — uncovered areas stay clear`)
  const stat = staticR.ok ? staticR.value : new Float32Array(N)

  let geo = null
  if (geos.length || base) {
    geo = blendGeostationary(base, geos)
    geos.forEach((g, k) => sources.push({ id: g.sat.id, label: g.sat.label, credit: g.sat.credit, time: iso(g.time), ok: true, coverage: +geo.contrib[k].toFixed(4) }))
    if (base) sources.push({ id: base.id, label: base.label, credit: base.credit, time: iso(base.time), ok: true, coverage: +geo.baseContrib.toFixed(4) })
    await writeDebug('debug-bt.png', geo.bt, (v) => (320 - v) / 130)
  }

  const geoCoverage = geo ? globalFraction(Float32Array.from(geo.bt, (v) => (Number.isNaN(v) ? 0 : 1))) : 0
  log(`geostationary coverage ${(geoCoverage * 100).toFixed(1)}% of the globe`)
  if (geoCoverage < MIN_GEO_COVERAGE) {
    const reason = `geostationary coverage only ${(geoCoverage * 100).toFixed(0)}%`
    if (await reusePrevious(reason, sources)) return
    writeManifest({ version: 1, generatedAt: iso(now), clouds: null, note: reason, sources })
    log('no usable live data — manifest says clouds: null (app uses the static map)')
    return
  }

  const { rgba, weights, timeMean } = composeClouds({ geo, polar, staticOpacity: stat })
  if (polar) sources.push({ id: 'modis-polar', label: `MODIS cloud fraction, polar caps (${polar.layers.join(', ')})`, credit: 'NASA MODIS', time: iso(polar.time), ok: true, coverage: +weights.polar.toFixed(4) })
  if (weights.static > 0.0005) sources.push({ id: 'static', label: 'Static cloud map (no live data here)', time: null, ok: true, coverage: +weights.static.toFixed(4) })

  if (DEBUG) {
    const a = new Float32Array(N)
    for (let i = 0; i < N; i++) a[i] = rgba[i * 4 + 3] / 255
    await writeDebug('debug-opacity.png', a)
  }
  const files = await writeOutputs(rgba)

  const used = sources.filter((s) => s.ok && s.time)
  const times = used.map((s) => Date.parse(s.time))
  const credits = ['NASA GIBS', ...new Set(used.map((s) => s.credit).filter(Boolean))]
  if (!used.some((s) => s.id.startsWith('goes') || s.id === 'himawari' || s.id === 'modis-polar')) credits.shift()

  writeManifest({
    version:     1,
    generatedAt: iso(now),
    clouds: {
      status:         'live',
      dataTime:       iso(Number.isFinite(timeMean) ? timeMean : Math.max(...times)),
      oldestDataTime: iso(Math.min(...times)),
      newestDataTime: iso(Math.max(...times)),
      files,
      sources,
      attribution:    credits,
      staticFraction: +weights.static.toFixed(4),
    },
  })
  log(`wrote ${Object.values(files).map((f) => `${f.file} (${(f.bytes / 1e6).toFixed(2)} MB)`).join(', ')} + manifest.json`)
  log(`coverage: geostationary ${(weights.geo * 100).toFixed(1)}%, MODIS ${(weights.polar * 100).toFixed(1)}%, static ${(weights.static * 100).toFixed(1)}%`)
}

// Last-resort guard: a stray rejection must not kill the run before the
// manifest is written (main() itself settles every source).
process.on('unhandledRejection', (err) => log(`unhandled rejection: ${err?.message ?? err}`))

main().catch(async (err) => {
  // Never fail the build: record the problem and let the app use static clouds.
  console.error('live clouds: unexpected error —', err?.stack ?? err)
  try {
    if (!(await reusePrevious('unexpected error', []))) {
      writeManifest({ version: 1, generatedAt: iso(Date.now()), clouds: null, note: String(err?.message ?? err) })
    }
  } catch { /* nothing else to do */ }
}).finally(() => { process.exitCode = 0 })
