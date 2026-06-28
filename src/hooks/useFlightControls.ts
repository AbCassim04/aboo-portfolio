import { useEffect, useRef } from 'react'

export interface FlightInput {
  thrust:    number   // 0 to 1
  brake:     number   // 0 to 1
  yaw:       number   // -1 to 1
  pitch:     number   // -1 to 1
  roll:      number   // -1 to 1
  vertical:  number   // -1 to 1  (Shift = up, Ctrl = down)
  boost:     boolean
  land:      boolean
  pitchUp:   boolean  // mobile touch
  pitchDown: boolean  // mobile touch
}

export function useFlightControls(): React.MutableRefObject<FlightInput> {
  const inputRef = useRef<FlightInput>({ thrust: 0, brake: 0, yaw: 0, pitch: 0, roll: 0, vertical: 0, boost: false, land: false, pitchUp: false, pitchDown: false })

  useEffect(() => {
    // On touch devices the keyboard loop would overwrite button-set values every frame.
    // Touch buttons write directly to inputRef, so skip the loop entirely on mobile.
    const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0
    if (isTouch) return

    const keys = new Set<string>()

    let boostOn = false

    const onKeyDown = (e: KeyboardEvent) => {
      keys.add(e.code)
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight'].includes(e.code)) {
        e.preventDefault()
      }
      if (e.code === 'Space' && !e.repeat) {
        boostOn = !boostOn
        inputRef.current.boost = boostOn
      }
    }
    const onKeyUp = (e: KeyboardEvent) => keys.delete(e.code)

    let rafId: number

    const loop = () => {
      const inp = inputRef.current

      inp.thrust   = (keys.has('KeyW') || keys.has('ArrowUp'))    ? 1 : 0
      inp.brake    = (keys.has('KeyS') || keys.has('ArrowDown'))  ? 1 : 0
      inp.yaw      = keys.has('KeyA') || keys.has('ArrowLeft')    ? -1
                   : keys.has('KeyD') || keys.has('ArrowRight')   ?  1 : 0
      inp.pitch    = keys.has('KeyQ') ? -1 : keys.has('KeyE') ? 1 : 0
      inp.roll     = keys.has('KeyZ') ? -1 : keys.has('KeyX') ? 1 : 0
      inp.vertical = (keys.has('ShiftLeft') || keys.has('ShiftRight'))     ?  1
                   : (keys.has('ControlLeft') || keys.has('ControlRight')) ? -1 : 0
      inp.land   = keys.has('KeyF')

      rafId = requestAnimationFrame(loop)
    }

    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('keyup',   onKeyUp)
    rafId = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(rafId)
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('keyup',   onKeyUp)
    }
  }, [])

  return inputRef
}
