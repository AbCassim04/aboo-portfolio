import { useRef } from 'react'
import * as THREE from 'three'
import type { FlightInput } from './useFlightControls'

export interface UFOState {
  position:        THREE.Vector3
  velocity:        THREE.Vector3
  rotation:        THREE.Euler
  angularVelocity: THREE.Vector3
}

const TURN_RATE    = 0.012  // rad/frame — deliberate turns, not spin
const ANGULAR_DRAG = 0.88   // higher drag so rotation stops quickly when key released
const AV_CAP       = 0.04   // max rad/frame per axis
const DRAG         = 0.98
const ACCEL        = 0.006
const MAX_SPEED    = 0.4
const MAX_SPEED_BOOST = 0.8

const _forward = new THREE.Vector3()
const _pull    = new THREE.Vector3()

export function useUFOPhysics(
  inputRef: React.MutableRefObject<FlightInput>,
): { ufoStateRef: React.MutableRefObject<UFOState>; update: () => void } {
  const ufoStateRef = useRef<UFOState>({
    position:        new THREE.Vector3(30, 0, 30),
    velocity:        new THREE.Vector3(),
    rotation:        new THREE.Euler(),
    angularVelocity: new THREE.Vector3(),
  })

  const update = () => {
    const state = ufoStateRef.current
    const inp   = inputRef.current

    // Forward vector in world space (UFO faces -Z locally)
    _forward.set(0, 0, -1).applyEuler(state.rotation)

    // Thrust / brake
    if (inp.thrust > 0) state.velocity.addScaledVector(_forward, ACCEL * inp.thrust)
    if (inp.brake  > 0) state.velocity.multiplyScalar(0.95)

    // Vertical (world-space Y — more intuitive than local frame)
    if (inp.vertical !== 0) state.velocity.y += inp.vertical * ACCEL * 0.8

    // Speed clamp
    const topSpeed = inp.boost ? MAX_SPEED_BOOST : MAX_SPEED
    if (state.velocity.length() > topSpeed) state.velocity.setLength(topSpeed)

    // Angular inputs
    state.angularVelocity.y -= inp.yaw   * TURN_RATE
    state.angularVelocity.x -= inp.pitch * TURN_RATE
    state.angularVelocity.z -= inp.roll  * TURN_RATE
    if (inp.pitchUp)   state.angularVelocity.x += TURN_RATE
    if (inp.pitchDown) state.angularVelocity.x -= TURN_RATE

    // Drag
    state.velocity.multiplyScalar(DRAG)
    state.angularVelocity.multiplyScalar(ANGULAR_DRAG)

    // Cap angular velocity per axis
    state.angularVelocity.x = Math.max(-AV_CAP, Math.min(AV_CAP, state.angularVelocity.x))
    state.angularVelocity.y = Math.max(-AV_CAP, Math.min(AV_CAP, state.angularVelocity.y))
    state.angularVelocity.z = Math.max(-AV_CAP, Math.min(AV_CAP, state.angularVelocity.z))

    // Integrate
    state.position.add(state.velocity)
    state.rotation.x += state.angularVelocity.x
    state.rotation.y += state.angularVelocity.y
    state.rotation.z += state.angularVelocity.z

    // Soft boundary pull at 2580u, hard clamp at 2600u
    const dist = state.position.length()
    if (dist > 2580) {
      _pull.copy(state.position).normalize().multiplyScalar(-0.012)
      state.velocity.add(_pull)
    }
    if (dist > 2600) state.position.normalize().multiplyScalar(2600)
  }

  return { ufoStateRef, update }
}
