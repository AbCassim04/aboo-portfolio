import { useEffect, useRef } from 'react'
import type { TargetMarkerDatum } from '../flight/navUi'

// Target lock marker: a reticle on the target while it is on screen, an arrow
// at the screen edge pointing toward it while it is off screen (including
// behind the camera). The flight loop writes `dataRef` every frame; this
// component moves its DOM nodes in its own rAF loop (no React re-render).

export default function TargetMarker({ dataRef }: { dataRef: React.MutableRefObject<TargetMarkerDatum> }) {
  const rootRef  = useRef<HTMLDivElement>(null)
  const retRef   = useRef<HTMLDivElement>(null)
  const arrowRef = useRef<HTMLDivElement>(null)
  const textRef  = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let raf = 0
    let lastText = ''
    const loop = () => {
      raf = requestAnimationFrame(loop)
      const d = dataRef.current
      const root = rootRef.current, ret = retRef.current, arrow = arrowRef.current, text = textRef.current
      if (!root || !ret || !arrow || !text) return
      root.style.display = d.visible ? 'block' : 'none'
      if (!d.visible) return
      root.style.transform = `translate(${d.x.toFixed(1)}px, ${d.y.toFixed(1)}px)`
      root.dataset.onscreen = d.onScreen ? '1' : '0'
      root.dataset.angle = d.angle.toFixed(2)
      ret.style.display   = d.onScreen ? 'block' : 'none'
      arrow.style.display = d.onScreen ? 'none' : 'block'
      arrow.style.transform = `translate(-50%, -50%) rotate(${d.angle.toFixed(2)}deg)`
      const t = `${d.name} · ${d.dist}`
      if (t !== lastText) { text.textContent = t; lastText = t }
      // Keep the label inside the screen when the arrow hugs an edge.
      const W = window.innerWidth
      const right = d.x > W - 140
      text.style.left  = right ? 'auto' : '18px'
      text.style.right = right ? '18px' : 'auto'
      text.style.top   = d.y < 60 ? '16px' : '-34px'
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [dataRef])

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 17, pointerEvents: 'none', overflow: 'hidden' }}>
      <div ref={rootRef} data-hud-target="marker" style={{ position: 'absolute', left: 0, top: 0, display: 'none' }}>
        <div ref={retRef} style={{ position: 'absolute', left: -18, top: -18, width: 36, height: 36 }}>
          <svg width="36" height="36" viewBox="-18 -18 36 36">
            <path d="M -16 -8 L -16 -16 L -8 -16 M 8 -16 L 16 -16 L 16 -8 M 16 8 L 16 16 L 8 16 M -8 16 L -16 16 L -16 8"
              fill="none" stroke="#7df9ff" strokeWidth="1.6" />
            <circle r="1.6" fill="#7df9ff" />
          </svg>
        </div>
        <div ref={arrowRef} style={{ position: 'absolute', left: 0, top: 0, display: 'none' }}>
          <svg width="30" height="30" viewBox="-15 -15 30 30" style={{ display: 'block' }}>
            <path d="M 12 0 L -7 -9 L -3 0 L -7 9 Z" fill="rgba(125,249,255,0.9)" stroke="rgba(10,20,30,0.6)" strokeWidth="1" />
          </svg>
        </div>
        <div ref={textRef} data-hud-target="label" style={{
          position: 'absolute', whiteSpace: 'nowrap', color: '#bff9ff', fontFamily: 'Kanit, sans-serif',
          fontSize: '0.64rem', letterSpacing: '0.12em', textTransform: 'uppercase',
          background: 'rgba(8,16,24,0.55)', border: '1px solid rgba(125,249,255,0.35)', borderRadius: 999, padding: '0.15rem 0.55rem',
        }} />
      </div>
    </div>
  )
}
