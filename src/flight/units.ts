// ── HUD readouts with automatic units ──────────────────────────────────────
// Pure formatting helpers (no three.js, no DOM) so the debug hook and the
// acceptance tests can use exactly what the HUD shows.
//
//   distance: < 1 km → m · < 0.1 AU → km · otherwise AU; plus light-time
//   speed:    < 1 km/s → m/s · < 0.1 c → km/s · otherwise multiples of c
//   ETA:      s · min s · h min · d h

export const AU_KM  = 149_597_870.7
export const C_KM_S = 299_792.458

/** Distance thresholds (km). */
export const DIST_M_BELOW_KM  = 1
export const DIST_AU_FROM_KM  = 0.1 * AU_KM
/** Speed thresholds (km/s). */
export const SPEED_MS_BELOW   = 1
export const SPEED_C_FROM     = 0.1 * C_KM_S

const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })

function sig(x: number, digits: number): string {
  if (x === 0) return '0'
  const d = Math.max(0, digits - 1 - Math.floor(Math.log10(Math.abs(x))))
  return x.toFixed(Math.min(d, 6))
}

export type DistanceUnit = 'm' | 'km' | 'AU'
export type SpeedUnit = 'm/s' | 'km/s' | 'c'

export function distanceUnit(km: number): DistanceUnit {
  const a = Math.abs(km)
  return a < DIST_M_BELOW_KM ? 'm' : a < DIST_AU_FROM_KM ? 'km' : 'AU'
}

/** "850 m", "12,400 km", "4.21 AU". */
export function formatDistance(km: number): string {
  if (!Number.isFinite(km)) return '—'
  switch (distanceUnit(km)) {
    case 'm':  return `${nf0.format(km * 1000)} m`
    case 'km': return `${nf0.format(km)} km`
    case 'AU': return `${sig(km / AU_KM, km / AU_KM < 10 ? 3 : 4)} AU`
  }
}

/** Light travel time for a distance: "0.04 light-s", "8.3 light-min", "4.1 light-h". */
export function formatLightTime(km: number): string {
  if (!Number.isFinite(km)) return ''
  const s = Math.abs(km) / C_KM_S
  if (s < 60)   return `${sig(s, s < 1 ? 2 : 3)} light-s`
  if (s < 3600) return `${sig(s / 60, 3)} light-min`
  return `${sig(s / 3600, 3)} light-h`
}

export function speedUnit(kmS: number): SpeedUnit {
  const a = Math.abs(kmS)
  return a < SPEED_MS_BELOW ? 'm/s' : a < SPEED_C_FROM ? 'km/s' : 'c'
}

/** "12 m/s", "7.66 km/s", "4,200 km/s", "0.25 c", "100 c". */
export function formatSpeed(kmS: number): string {
  if (!Number.isFinite(kmS)) return '—'
  switch (speedUnit(kmS)) {
    case 'm/s': {
      const ms = kmS * 1000
      return `${ms === 0 ? '0' : ms < 10 ? ms.toFixed(1) : nf0.format(ms)} m/s`
    }
    case 'km/s': return kmS < 100 ? `${sig(kmS, 3)} km/s` : `${nf0.format(kmS)} km/s`
    case 'c': {
      const c = kmS / C_KM_S
      return `${c < 10 ? c.toFixed(2) : nf0.format(c)} c`
    }
  }
}

/** "8 s", "3 min 20 s", "2 h 05 min", "3 d 4 h", "—" when unknown. */
export function formatEta(s: number | null): string {
  if (s === null || !Number.isFinite(s) || s < 0) return '—'
  if (s < 10)    return `${s.toFixed(1)} s`
  if (s < 60)    return `${Math.round(s)} s`
  if (s < 3600)  { const m = Math.floor(s / 60); return `${m} min ${String(Math.round(s - m * 60)).padStart(2, '0')} s` }
  if (s < 86400) { const h = Math.floor(s / 3600); return `${h} h ${String(Math.round((s - h * 3600) / 60)).padStart(2, '0')} min` }
  const d = Math.floor(s / 86400)
  return `${d} d ${Math.round((s - d * 86400) / 3600)} h`
}
