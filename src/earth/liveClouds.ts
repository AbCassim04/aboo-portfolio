// ── Live cloud manifest (written by scripts/live-clouds/fetch-live-clouds.mjs) ──
// The deploy workflow regenerates public/live/ every few hours. Everything here
// fails soft: a missing / malformed manifest simply means "use the static map".

export interface LiveCloudFile {
  file:   string
  width:  number
  height: number
  bytes:  number
}

export interface LiveCloudSource {
  id:        string
  label:     string
  /** Observation time of the data used (ISO 8601), or null if unknown. */
  time:      string | null
  ok:        boolean
  /** Fraction of the globe (area-weighted) this source contributed. */
  coverage:  number
  note?:     string
}

export interface LiveCloudManifest {
  version:     1
  generatedAt: string | null
  clouds: null | {
    /** 'live' = built this run; 'previous' = re-used the last deployed build. */
    status:          'live' | 'previous'
    /** Area-weighted mean observation time of the live data (ISO 8601). */
    dataTime:        string
    oldestDataTime:  string
    newestDataTime:  string
    files:           { desktop: LiveCloudFile; mobile: LiveCloudFile }
    sources:         LiveCloudSource[]
    /** Short credits for the sources actually used, e.g. "NASA GIBS". */
    attribution:     string[]
    /** Fraction of the globe that fell back to the static cloud map. */
    staticFraction:  number
  }
}

export type CloudStatus =
  | { kind: 'loading' }
  | {
      kind:        'live'
      dataTimeMs:  number
      builtAtMs:   number
      previous:    boolean
      attribution: string[]
    }
  | { kind: 'static'; reason: 'no-manifest' | 'no-live-data' | 'texture-error' }
  | { kind: 'none' }

function isFile(f: unknown): f is LiveCloudFile {
  const o = f as LiveCloudFile
  return !!o && typeof o.file === 'string' && /^[\w.-]+$/.test(o.file)
}

function isManifest(m: unknown): m is LiveCloudManifest {
  const o = m as LiveCloudManifest
  if (!o || o.version !== 1) return false
  if (o.clouds === null) return true
  const c = o.clouds
  return !!c && typeof c.dataTime === 'string' && !!c.files
    && isFile(c.files.desktop) && isFile(c.files.mobile) && Array.isArray(c.attribution)
}

/**
 * Fetch `${baseUrl}live/manifest.json`. Resolves null (never rejects) when the
 * manifest is absent, not JSON (e.g. a dev-server HTML fallback), malformed or
 * slower than `timeoutMs`.
 */
export async function fetchLiveCloudManifest(baseUrl: string, timeoutMs: number): Promise<LiveCloudManifest | null> {
  const ctrl  = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(baseUrl + 'live/manifest.json', { cache: 'no-cache', signal: ctrl.signal })
    if (!res.ok) return null
    if (!(res.headers.get('content-type') ?? '').includes('json')) return null
    const json: unknown = await res.json()
    return isManifest(json) ? json : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
