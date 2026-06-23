import * as THREE from 'three'

export function linearPart(m: THREE.Matrix4): THREE.Matrix3 {
  const e = m.elements
  return new THREE.Matrix3().set(
    e[0], e[4], e[8],
    e[1], e[5], e[9],
    e[2], e[6], e[10],
  )
}

function degToRad(a: number): number { return Math.PI * a / 180.0 }

const OBSERVER_DISTANCE_MIN = 1.5
const OBSERVER_ORBIT_MIN    = 3.0
const OBSERVER_DISTANCE_MAX = 30.0
const PLANET_ORBIT_MIN      = 3.0

export function clampObserverDistance(distance: number, motionEnabled: boolean): number {
  const minDistance = motionEnabled ? OBSERVER_ORBIT_MIN : OBSERVER_DISTANCE_MIN
  return Math.max(minDistance, Math.min(OBSERVER_DISTANCE_MAX, distance))
}

export function clampPlanetOrbitDistance(distance: number): number {
  return Math.max(PLANET_ORBIT_MIN, distance)
}

export interface ShaderParams {
  time_scale: number
  observer: {
    motion: boolean
    distance: number
    orbital_inclination: number
  }
  gravitational_time_dilation: boolean
  black_hole: { spin_enabled: boolean; spin: number; spin_strength: number }
}

export class Observer {
  position    = new THREE.Vector3(10, 0, 0)
  velocity    = new THREE.Vector3(0, 1, 0)
  orientation = new THREE.Matrix3()
  time        = 0.0

  orbitalFrame(): THREE.Matrix3 {
    const orbital_y = this.velocity.clone().normalize().multiplyScalar(4.0)
      .sub(this.position).normalize()
    const orbital_z = new THREE.Vector3().crossVectors(this.position, orbital_y).normalize()
    const orbital_x = new THREE.Vector3().crossVectors(orbital_y, orbital_z)
    return linearPart(
      new THREE.Matrix4().makeBasis(orbital_x, orbital_y, orbital_z),
    )
  }

  move(dt: number, params: ShaderParams): void {
    let scaledDt = dt * params.time_scale
    let r: number
    let v = 0

    if (params.observer.motion) {
      r = clampObserverDistance(params.observer.distance, true)
      params.observer.distance = r
      v = 1.0 / Math.sqrt(2.0 * (r - 1.0))
      const ang_vel = v * Math.sqrt(1.0 - 1.0 / r) / r
      const angle   = this.time * ang_vel
      const s = Math.sin(angle), c = Math.cos(angle)
      this.position.set(c * r, s * r, 0)
      this.velocity.set(-s * v, c * v, 0)
      const alpha       = degToRad(params.observer.orbital_inclination)
      const orbit_coords = new THREE.Matrix4().makeRotationY(alpha)
      this.position.applyMatrix4(orbit_coords)
      this.velocity.applyMatrix4(orbit_coords)
    } else {
      r = this.position.length()
    }

    if (params.gravitational_time_dilation) {
      if (v > 0) {
        scaledDt = scaledDt / Math.sqrt(Math.max(1.0 - 1.5 / r, 0.001))
      } else {
        scaledDt = scaledDt / Math.sqrt(Math.max(1.0 - 1.0 / r, 0.001))
      }
    }

    this.time += scaledDt
  }
}
