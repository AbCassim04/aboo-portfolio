// Shared helpers for the live-cloud pipeline: logging, time-boxed fetches with
// retries, and a small global deadline so the whole run is bounded.

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const START = Date.now()
// Dev only: LIVE_CLOUDS_CACHE=<dir> keeps downloaded bodies so re-runs while
// tuning don't re-download (the workflow never sets it).
const CACHE = process.env.LIVE_CLOUDS_CACHE || null
let deadline = START + 9 * 60_000

export function setDeadline(ms) { deadline = START + ms }
export function timeLeft() { return deadline - Date.now() }

export function log(...args) {
  const t = ((Date.now() - START) / 1000).toFixed(1).padStart(6)
  console.log(`[${t}s]`, ...args)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const USER_AGENT = 'aboo-portfolio-live-clouds/1.0 (+https://github.com/AbCassim04/aboo-portfolio)'

/**
 * fetch() with a per-attempt timeout, retries with backoff, and the global
 * deadline. Resolves to { buffer | text, res } or throws after the last try.
 */
export async function fetchRetry(url, { as = 'buffer', timeoutMs = 60_000, retries = 2, label = url } = {}) {
  const cacheFile = CACHE ? path.join(CACHE, crypto.createHash('sha1').update(url).digest('hex')) : null
  if (cacheFile && fs.existsSync(cacheFile)) {
    const body = fs.readFileSync(cacheFile)
    return { res: null, [as === 'text' ? 'text' : 'buffer']: as === 'text' ? body.toString('utf8') : body }
  }
  const result = await fetchUncached(url, { as, timeoutMs, retries, label })
  if (cacheFile) {
    fs.mkdirSync(CACHE, { recursive: true })
    fs.writeFileSync(cacheFile, as === 'text' ? result.text : result.buffer)
  }
  return result
}

async function fetchUncached(url, { as, timeoutMs, retries, label }) {
  let lastErr
  for (let attempt = 0; attempt <= retries; attempt++) {
    const budget = Math.min(timeoutMs, timeLeft())
    if (budget < 2000) throw new Error(`deadline reached before ${label}`)
    try {
      const res = await fetch(url, {
        signal:  AbortSignal.timeout(budget),
        headers: { 'User-Agent': USER_AGENT },
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = as === 'text' ? await res.text() : Buffer.from(await res.arrayBuffer())
      return { res, [as === 'text' ? 'text' : 'buffer']: body }
    } catch (err) {
      lastErr = err
      const msg = err?.name === 'TimeoutError' ? `timeout after ${budget} ms` : (err?.message ?? String(err))
      log(`  ${label}: attempt ${attempt + 1} failed (${msg})`)
      // 4xx other than 429 will not get better on retry.
      if (/^HTTP 4(?!29)/.test(err?.message ?? '')) break
      if (attempt < retries) await sleep(1500 * (attempt + 1))
    }
  }
  throw lastErr
}

/** Run async tasks with a concurrency limit; returns results in order. */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i], i)
    }
  })
  await Promise.all(workers)
  return out
}

export const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z')

/**
 * Parse a GIBS/WMTS time domain string such as
 * "2026-11-20T18:00:00Z/2026-11-20T19:40:00Z/PT10M,2026-11-20T20:00:00Z/…"
 * or "2026-11-18/2026-11-20/P1D" and return the latest instant (ms).
 */
export function latestFromDomain(domain) {
  let best = NaN
  for (const part of domain.split(',')) {
    const pieces = part.trim().split('/')
    const end = pieces.length >= 2 ? pieces[1] : pieces[0]
    const ms = Date.parse(end.length === 10 ? end + 'T00:00:00Z' : end)
    if (Number.isFinite(ms) && !(ms <= best)) best = ms
  }
  return best
}

/**
 * Inverse of a GIBS colour map (ColorMap v1.3 XML): RGB → data value.
 * GIBS overview tiles / WMS output are area-averaged, so colours between two
 * palette entries occur. Grey-ramp colours are interpolated linearly (the ramp
 * is monotonic); anything else snaps to the nearest palette colour.
 */
export function buildPaletteInverse(xml, { toValue = (lo, hi) => (lo + hi) / 2 } = {}) {
  const entries = []
  const re = /<ColorMapEntry\s+rgb="(\d+),(\d+),(\d+)"\s+transparent="false"[^>]*?(?:sourceValue|value)="([^"]*)"/g
  for (const m of xml.matchAll(re)) {
    const v = m[4].trim()
    let value
    const iv = v.match(/^[[(]\s*([-+\dINF.]+)\s*,\s*([-+\dINF.]+)\s*[\])]$/)
    if (iv) {
      let lo = parseFloat(iv[1]); let hi = parseFloat(iv[2])
      if (!Number.isFinite(lo)) lo = hi - 1
      if (!Number.isFinite(hi)) hi = lo + 1
      value = toValue(lo, hi)
    } else {
      value = parseFloat(v)
    }
    if (!Number.isFinite(value)) continue
    entries.push({ r: +m[1], g: +m[2], b: +m[3], value })
  }
  if (entries.length < 2) throw new Error('colour map has no usable entries')

  const exact = new Map()
  for (const e of entries) exact.set((e.r << 16) | (e.g << 8) | e.b, e.value)

  // Grey ramp (r = g = b), excluding pure white which some maps reuse at an extreme.
  const greys = entries.filter((e) => e.r === e.g && e.g === e.b && e.r < 255).sort((a, b) => a.r - b.r)
  const greyLut = new Float32Array(256).fill(NaN)
  if (greys.length >= 2) {
    for (let g = greys[0].r; g <= greys[greys.length - 1].r; g++) {
      let k = 0
      while (k < greys.length - 2 && greys[k + 1].r < g) k++
      const a = greys[k], b = greys[k + 1]
      const f = b.r === a.r ? 0 : (g - a.r) / (b.r - a.r)
      greyLut[g] = a.value + (b.value - a.value) * Math.max(0, Math.min(1, f))
    }
  }

  const cache = new Map()
  return function lookup(r, g, b) {
    const key = (r << 16) | (g << 8) | b
    const hit = exact.get(key)
    if (hit !== undefined) return hit
    if (r === g && g === b && !Number.isNaN(greyLut[r])) return greyLut[r]
    let v = cache.get(key)
    if (v === undefined) {
      let best = Infinity
      for (const e of entries) {
        const d = (e.r - r) ** 2 + (e.g - g) ** 2 + (e.b - b) ** 2
        if (d < best) { best = d; v = e.value }
      }
      cache.set(key, v)
    }
    return v
  }
}
