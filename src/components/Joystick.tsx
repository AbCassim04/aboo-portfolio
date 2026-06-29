import { useRef, useState, useCallback } from 'react'

interface JoystickProps {
  size?:      number   // rendered px
  maxTravel?: number   // SVG units (viewBox is -70 to 70)
  id?:        string
  onMove:     (x: number, y: number) => void  // normalized -1..1
  onEnd:      () => void
}

export default function Joystick({
  size      = 180,
  maxTravel = 44,
  id,
  onMove,
  onEnd,
}: JoystickProps) {
  const svgRef  = useRef<SVGSVGElement>(null)
  const touchId = useRef<number | null>(null)
  const [knob,   setKnob]   = useState({ x: 0, y: 0 })
  const [active, setActive] = useState(false)

  const getVec = useCallback((clientX: number, clientY: number) => {
    const rect = svgRef.current!.getBoundingClientRect()
    // Convert from screen px to SVG units (viewBox is 140 wide = -70..70)
    const dx = (clientX - rect.left  - rect.width  / 2) * (140 / size)
    const dy = (clientY - rect.top   - rect.height / 2) * (140 / size)
    const len = Math.sqrt(dx * dx + dy * dy)
    if (len > maxTravel) {
      const s = maxTravel / len
      return { x: dx * s, y: dy * s }
    }
    return { x: dx, y: dy }
  }, [size, maxTravel])

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    e.preventDefault()
    if (touchId.current !== null) return
    const t = e.changedTouches[0]
    touchId.current = t.identifier
    const v = getVec(t.clientX, t.clientY)
    setKnob(v)
    setActive(true)
    onMove(v.x / maxTravel, -(v.y / maxTravel))
  }, [getVec, maxTravel, onMove])

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    e.preventDefault()
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i]
      if (t.identifier === touchId.current) {
        const v = getVec(t.clientX, t.clientY)
        setKnob(v)
        onMove(v.x / maxTravel, -(v.y / maxTravel))
        break
      }
    }
  }, [getVec, maxTravel, onMove])

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    e.preventDefault()
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === touchId.current) {
        touchId.current = null
        setKnob({ x: 0, y: 0 })
        setActive(false)
        onEnd()
        break
      }
    }
  }, [onEnd])

  // Colours that dim when idle, brighten when active
  const ring    = active ? 'rgba(155,79,192,0.9)'  : 'rgba(155,79,192,0.28)'
  const ringMid = active ? 'rgba(155,79,192,0.45)' : 'rgba(155,79,192,0.12)'
  const cross   = active ? 'rgba(155,79,192,0.4)'  : 'rgba(155,79,192,0.1)'
  const bracket = active ? 'rgba(196,181,253,0.95)': 'rgba(196,181,253,0.22)'
  const tickDim = active ? 'rgba(155,79,192,0.55)' : 'rgba(155,79,192,0.18)'
  const tickBrt = active ? 'rgba(196,181,253,0.9)' : 'rgba(196,181,253,0.35)'
  const dot     = active ? 'rgba(196,181,253,0.85)': 'rgba(155,79,192,0.25)'
  const center  = active ? 'rgba(155,79,192,0.6)'  : 'rgba(155,79,192,0.18)'

  // 24 tick marks at every 15°
  const ticks = Array.from({ length: 24 }, (_, i) => {
    const a       = (i * 15 * Math.PI) / 180
    const isCard  = i % 6 === 0   // 0°, 90°, 180°, 270°
    const isMajor = i % 3 === 0   // every 45°
    const r1 = 62
    const r2 = isCard ? 52 : isMajor ? 57 : 59
    return {
      x1: Math.cos(a) * r1, y1: Math.sin(a) * r1,
      x2: Math.cos(a) * r2, y2: Math.sin(a) * r2,
      stroke: isCard ? tickBrt : tickDim,
      width:  isCard ? 1.5    : isMajor ? 1 : 0.5,
    }
  })

  const uid = id ?? 'js'

  return (
    <svg
      ref={svgRef}
      id={id}
      width={size}
      height={size}
      viewBox="-70 -70 140 140"
      style={{ touchAction: 'none', overflow: 'visible', display: 'block' }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
    >
      <defs>
        <radialGradient id={`rg-${uid}`} cx="35%" cy="30%" r="70%">
          <stop offset="0%"   stopColor="rgba(230,210,255,0.95)" />
          <stop offset="60%"  stopColor="rgba(140,60,200,0.9)" />
          <stop offset="100%" stopColor="rgba(80,20,130,0.85)" />
        </radialGradient>
        <filter id={`glow-${uid}`} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id={`ringGlow-${uid}`} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="1.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Outer ambient halo — active only */}
      {active && (
        <circle r="67" fill="none"
          stroke="rgba(155,79,192,0.1)" strokeWidth="14" />
      )}

      {/* Tick marks */}
      {ticks.map((t, i) => (
        <line key={i}
          x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2}
          stroke={t.stroke} strokeWidth={t.width}
          strokeLinecap="round" />
      ))}

      {/* Outer ring */}
      <circle r="62" fill="none" stroke={ring} strokeWidth="1"
        filter={active ? `url(#ringGlow-${uid})` : undefined} />

      {/* Mid dashed reference ring */}
      <circle r="44" fill="none" stroke={ringMid}
        strokeWidth="0.5" strokeDasharray="3 7" />

      {/* Inner reference ring */}
      <circle r="18" fill="none" stroke={cross} strokeWidth="0.5" />

      {/* Crosshair — 4 segments, gap around inner ring */}
      <line x1="-62" y1="0" x2="-20" y2="0" stroke={cross} strokeWidth="0.5" />
      <line x1="20"  y1="0" x2="62"  y2="0" stroke={cross} strokeWidth="0.5" />
      <line x1="0" y1="-62" x2="0" y2="-20" stroke={cross} strokeWidth="0.5" />
      <line x1="0" y1="20"  x2="0" y2="62"  stroke={cross} strokeWidth="0.5" />

      {/* Cardinal dots on mid ring */}
      <circle cx="0"   cy="-44" r="1.5" fill={dot} />
      <circle cx="44"  cy="0"   r="1.5" fill={dot} />
      <circle cx="0"   cy="44"  r="1.5" fill={dot} />
      <circle cx="-44" cy="0"   r="1.5" fill={dot} />

      {/* HUD corner brackets */}
      <path d="M -52,-62 L -62,-62 L -62,-52" fill="none" stroke={bracket} strokeWidth="1.5" strokeLinecap="round" />
      <path d="M  52,-62 L  62,-62 L  62,-52" fill="none" stroke={bracket} strokeWidth="1.5" strokeLinecap="round" />
      <path d="M -52, 62 L -62, 62 L -62, 52" fill="none" stroke={bracket} strokeWidth="1.5" strokeLinecap="round" />
      <path d="M  52, 62 L  62, 62 L  62, 52" fill="none" stroke={bracket} strokeWidth="1.5" strokeLinecap="round" />

      {/* Center reference pip */}
      <circle r="2" fill={center} />

      {/* Knob */}
      <g transform={`translate(${knob.x},${knob.y})`}
         filter={active ? `url(#glow-${uid})` : undefined}>
        {/* Outer ring */}
        <circle r="18" fill="none"
          stroke={active ? 'rgba(196,181,253,1.0)' : 'rgba(196,181,253,0.45)'}
          strokeWidth="1" />
        {/* Body */}
        <circle r="13" fill={`url(#rg-${uid})`}
          opacity={active ? 1 : 0.55} />
        {/* Inner detail ring */}
        <circle r="7" fill="none"
          stroke="rgba(220,200,255,0.35)" strokeWidth="0.5" />
        {/* Centre pip */}
        <circle r="2.5"
          fill={active ? 'white' : 'rgba(220,200,255,0.7)'} />
      </g>
    </svg>
  )
}
