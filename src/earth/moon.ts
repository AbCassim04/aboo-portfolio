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
// Distance is kept at a compact display radius (real ratio would be ~60 R⊕).
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
  /** Recompute if sim time moved more than the threshold (or `force`). */
  update(simMs: number, force?: boolean): void
}

export function createMoonPlacer(
  moon:        THREE.Object3D,
  earthGroup:  THREE.Object3D,
  orbitRadius: number,
): MoonPlacer {
  const state = createMoonResult()
  let lastMs  = NaN
  // The Moon moves ~0.5°/h across the sky; 10 sim-seconds is far below a pixel.
  const THRESHOLD_MS = 10_000

  return {
    state,
    update(simMs: number, force = false) {
      if (!force && Math.abs(simMs - lastMs) < THRESHOLD_MS) return
      lastMs = simMs
      moonPosition(simMs, state)

      // Direction Earth→Moon in world space.
      latLonToLocal(state.sublunarLat, state.sublunarLon, 1, _dir).applyQuaternion(earthGroup.quaternion)
      moon.position.copy(earthGroup.position).addScaledVector(_dir, orbitRadius)

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
