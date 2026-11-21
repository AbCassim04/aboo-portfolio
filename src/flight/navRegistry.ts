import * as THREE from 'three'
import { BODY_PHYSICAL, earthPositionKm, planetBarycentreKm } from '../space/ephemeris'
import type { PlanetId } from '../space/ephemeris'
import { MARKER_KM_PER_UNIT, ZONE_PLACEMENT, computeZoneFrame, createZoneFrame, zoneViewPoint } from '../space/portfolioZone'
import { DESTINATIONS } from './destinations'
import { issWorldAt, jwstWorldAt } from './satellites'
import { ISS_SIZE_KM, JWST_SIZE_KM } from './models'

// ── Navigation registry ─────────────────────────────────────────────────────
// The single list of navigable things: every body, the ISS and JWST, the
// asteroid-belt zone, the portfolio zone, its destinations and the M87*
// portal. Each entry has an id, a display name, a type, a radius and an info
// key (src/data/planetData.ts); positions come from navPositionAt() for any
// sim time (pure functions of the ephemeris), so navigation can aim at where
// something will be. Next / previous target follows NAV_ENTRIES order.

export type NavType = 'star' | 'planet' | 'moon' | 'station' | 'telescope' | 'region' | 'zone' | 'portfolio' | 'portal'

export interface NavEntry {
  id:       string
  name:     string
  type:     NavType
  /** Physical radius (km); markers: their size; regions: 0. */
  radiusKm: number
  /** CSS colour for markers, map and radar. */
  color:    string
}

const P = BODY_PHYSICAL
const dest = (name: string): NavEntry => {
  const d = DESTINATIONS.find(x => x.name === name)!
  return {
    id: name, name: name === 'M87*' ? 'M87*' : name[0] + name.slice(1).toLowerCase(),
    type: name === 'M87*' ? 'portal' : 'portfolio',
    radiusKm: d.size * MARKER_KM_PER_UNIT, color: name === 'M87*' ? '#8b5cf6' : '#' + d.color.toString(16).padStart(6, '0'),
  }
}

export const NAV_ENTRIES: NavEntry[] = [
  { id: 'sun',     name: 'The Sun', type: 'star',      radiusKm: P.sun.radius,     color: '#ffcc33' },
  { id: 'mercury', name: 'Mercury', type: 'planet',    radiusKm: P.mercury.radius, color: '#b0a89f' },
  { id: 'venus',   name: 'Venus',   type: 'planet',    radiusKm: P.venus.radius,   color: '#e8c9a0' },
  { id: 'earth',   name: 'Earth',   type: 'planet',    radiusKm: P.earth.radius,   color: '#3b8bd4' },
  { id: 'moon',    name: 'The Moon', type: 'moon',     radiusKm: P.moon.radius,    color: '#d8d4cc' },
  { id: 'iss',     name: 'ISS',     type: 'station',   radiusKm: ISS_SIZE_KM / 2,  color: '#e6e9ef' },
  { id: 'jwst',    name: 'JWST',    type: 'telescope', radiusKm: JWST_SIZE_KM / 2, color: '#f3c86b' },
  { id: 'zone',    name: 'Portfolio Zone', type: 'zone', radiusKm: 0,              color: '#9b4fc0' },
  dest('ABOUT'), dest('SKILLS'), dest('PROJECTS'), dest('CONTACT'), dest('M87*'),
  { id: 'mars',    name: 'Mars',    type: 'planet',    radiusKm: P.mars.radius,    color: '#c0562b' },
  { id: 'belt',    name: 'Asteroid Belt', type: 'region', radiusKm: 0,             color: '#b9a07a' },
  { id: 'jupiter', name: 'Jupiter', type: 'planet',    radiusKm: P.jupiter.radius, color: '#d8a06a' },
  { id: 'saturn',  name: 'Saturn',  type: 'planet',    radiusKm: P.saturn.radius,  color: '#e6cd8f' },
  { id: 'uranus',  name: 'Uranus',  type: 'planet',    radiusKm: P.uranus.radius,  color: '#a6e2e6' },
  { id: 'neptune', name: 'Neptune', type: 'planet',    radiusKm: P.neptune.radius, color: '#3f66cc' },
]

export const NAV_BY_ID: Record<string, NavEntry> = Object.fromEntries(NAV_ENTRIES.map(e => [e.id, e]))

export function isBodyId(id: string): boolean {
  return id in BODY_PHYSICAL
}

/** Context for positions that are not pure ephemeris. */
export interface NavContext {
  /** The belt target point (world, km): chosen when the belt is targeted. */
  beltPoint: THREE.Vector3
  /** Live Moon − ephemeris Moon (the Moon is placed by the Live Earth chain). */
  moonCorrection: THREE.Vector3
}

const _e  = new THREE.Vector3()
const _m  = new THREE.Vector3()
const _zf = createZoneFrame()

/**
 * World position (km) of a navigable thing at `simMs`. Destinations are the
 * marker centres without their decorative bob.
 */
export function navPositionAt(id: string, simMs: number, ctx: NavContext, out: THREE.Vector3): THREE.Vector3 {
  switch (id) {
    case 'sun':   return out.set(0, 0, 0)
    case 'earth': return earthPositionKm(simMs, out)
    case 'moon':  earthPositionKm(simMs, out, _m); return out.add(_m).add(ctx.moonCorrection)
    case 'iss':   earthPositionKm(simMs, _e); return issWorldAt(simMs, _e, out)
    case 'jwst':  earthPositionKm(simMs, _e); return jwstWorldAt(simMs, _e, out)
    case 'belt':  return out.copy(ctx.beltPoint)
    case 'zone':  earthPositionKm(simMs, _e); computeZoneFrame(_e, _zf); return out.copy(_zf.spawn)
    default: {
      const p = ZONE_PLACEMENT[id]
      if (p) { earthPositionKm(simMs, _e); computeZoneFrame(_e, _zf); return zoneViewPoint(_zf, p.range, p.az, p.el, out) }
      return planetBarycentreKm(id as PlanetId, simMs, out)
    }
  }
}
