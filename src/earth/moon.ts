import * as THREE from 'three'
import { createMoonResult, moonPosition } from './astro'
import type { MoonResult } from './astro'
import { latLonToLocal } from './geo'

// ── Real-time Moon placement ────────────────────────────────────────────────
// The Moon is placed in the direction it really has as seen from Earth's
// centre: the sublunar point (where the Moon is at the zenith) is converted to
// Earth-local space and rotated by the live Earth orientation. Because the
// Earth is oriented against the scene Sun, the Sun–Earth–Moon angle — and so
// the phase lit by the scene's DirectionalLight — matches the real sky.
// Distance is `orbitRadius` (the caller's choice of scale) or, with
// orbitRadius = 'true', the real Earth–Moon distance in km from the series.
//
// The placer only orients the Moon and computes `offset` (Earth → Moon, world
// axes); the caller positions it (Earth world position + offset), so it works
// with camera-relative rendering where the Earth's Object3D position is not a
// world position.
//
// Tidal locking: the near side (texture lon 0°, local +X, see geo.ts) is
// turned toward Earth, with lunar north kept close to Earth's north.
// Optical libration (±7°) is ignored.

const _dir   = new THREE.Vector3()
const _north = new THREE.Vector3()
const _bx    = new THREE.Vector3()
const _by    = new THREE.Vector3()
const _bz    = new THREE.Vector3()
const _m     = new THREE.Matrix4()

export interface MoonPlacer {
  /** Latest ephemeris (phase, elongation, …) — read-only. */
  readonly state: MoonResult
  /** Earth → Moon vector in world axes (updated by update()). */
  readonly offset: THREE.Vector3
  /** Recompute if sim time moved more than the threshold (or `force`). */
  update(simMs: number, force?: boolean): void
}

export function createMoonPlacer(
  moon:        THREE.Object3D,
  earthGroup:  THREE.Object3D,
  orbitRadius: number | 'true',
  // The Moon moves ~0.5°/h across the sky; at a compact display distance 10
  // sim-seconds is far below a pixel. At true scale it moves ~1 km/s, so the
  // flight scene passes 0 (update every frame).
  THRESHOLD_MS = 10_000,
): MoonPlacer {
  const state  = createMoonResult()
  const offset = new THREE.Vector3()
  let lastMs   = NaN

  return {
    state,
    offset,
    update(simMs: number, force = false) {
      if (!force && Math.abs(simMs - lastMs) < THRESHOLD_MS) return
      lastMs = simMs
      moonPosition(simMs, state)

      // Direction Earth→Moon in world space.
      latLonToLocal(state.sublunarLat, state.sublunarLon, 1, _dir).applyQuaternion(earthGroup.quaternion)
      offset.copy(_dir).multiplyScalar(orbitRadius === 'true' ? state.distanceKm : orbitRadius)

      // Tidal lock: local +X → toward Earth, local +Y → Earth's north (⟂).
      _north.set(0, 1, 0).applyQuaternion(earthGroup.quaternion)
      _bx.copy(_dir).negate()
      _by.copy(_north).addScaledVector(_bx, -_north.dot(_bx)).normalize()
      _bz.crossVectors(_bx, _by)
      _m.makeBasis(_bx, _by, _bz)
      moon.quaternion.setFromRotationMatrix(_m)
    },
  }
}
