import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft } from 'lucide-react'
import type { FlightInput } from '../hooks/useFlightControls'

export interface PlanetDot {
  name: string; x: number; y: number; color: string
}

interface FlightHUDProps {
  speed:         number
  isBoosting:    boolean
  nearestPlanet: { name: string; distance: number } | null
  ufoX:          number
  ufoY:          number
  planetDots:    PlanetDot[]
  onExit:        () => void
  inputRef:      React.MutableRefObject<FlightInput>
}

const RADAR_SIZE   = 120
const RADAR_SCALE  = 56 / 32  // 56px from center = 32 world units

export default function FlightHUD({
  speed, isBoosting, nearestPlanet, ufoX, ufoY, planetDots, onExit, inputRef,
}: FlightHUDProps) {
  const [isMobile] = useState(() => 'ontouchstart' in window || navigator.maxTouchPoints > 0)
  const [boostNotif, setBoostNotif] = useState<string | null>(null)
  const [leftKnob,   setLeftKnob]   = useState({ x: 0, y: 0 })
  const [rightKnob,  setRightKnob]  = useState({ x: 0, y: 0 })
  const radarRef      = useRef<HTMLCanvasElement>(null)
  const leftStickRef  = useRef<{ active: boolean; x: number; y: number }>({ active: false, x: 0, y: 0 })
  const rightStickRef = useRef<{ active: boolean; x: number; y: number }>({ active: false, x: 0, y: 0 })
  const leftTouchId   = useRef<number | null>(null)
  const rightTouchId  = useRef<number | null>(null)
  const leftBaseRef   = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const rightBaseRef  = useRef<{ x: number; y: number }>({ x: 0, y: 0 })

  // Draw radar whenever position or planets change
  useEffect(() => {
    const canvas = radarRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const cx = RADAR_SIZE / 2
    const cy = RADAR_SIZE / 2

    ctx.clearRect(0, 0, RADAR_SIZE, RADAR_SIZE)

    // Clipping circle
    ctx.save()
    ctx.beginPath()
    ctx.arc(cx, cy, 58, 0, Math.PI * 2)
    ctx.clip()

    // Background
    ctx.fillStyle = 'rgba(12,12,12,0.75)'
    ctx.fill()

    // Grid rings
    ctx.strokeStyle = 'rgba(215,226,234,0.07)'
    ctx.lineWidth   = 1
    for (const r of [20, 40]) {
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke()
    }

    // Planet dots
    for (const p of planetDots) {
      const dx = (p.x - ufoX) * RADAR_SCALE
      const dy = -(p.y - ufoY) * RADAR_SCALE
      if (Math.hypot(dx, dy) > 54) continue
      ctx.beginPath()
      ctx.arc(cx + dx, cy + dy, 4, 0, Math.PI * 2)
      ctx.fillStyle = p.color
      ctx.fill()
      // label
      ctx.font      = '8px Arial, sans-serif'
      ctx.fillStyle = 'rgba(215,226,234,0.5)'
      ctx.textAlign = 'center'
      ctx.fillText(p.name, cx + dx, cy + dy - 7)
    }

    ctx.restore()

    // Outer ring
    ctx.beginPath()
    ctx.arc(cx, cy, 58, 0, Math.PI * 2)
    ctx.strokeStyle = 'rgba(215,226,234,0.15)'
    ctx.lineWidth   = 1.5
    ctx.stroke()

    // UFO dot
    ctx.beginPath()
    ctx.arc(cx, cy, 3, 0, Math.PI * 2)
    ctx.fillStyle = '#ffffff'
    ctx.fill()

    ctx.beginPath()
    ctx.arc(cx, cy, 6, 0, Math.PI * 2)
    ctx.strokeStyle = 'rgba(119,33,177,0.8)'
    ctx.lineWidth   = 1.5
    ctx.stroke()
  }, [ufoX, ufoY, planetDots])

  // Dual joystick touch handling
  useEffect(() => {
    if (!isMobile) return

    const DEAD_ZONE  = 10
    const MAX_RADIUS = 50

    function clamp(v: number, min: number, max: number) { return Math.max(min, Math.min(max, v)) }
    // Squaring keeps the sign but makes small deflections far less sensitive
    function curve(v: number) { return v * Math.abs(v) }

    function onTouchStart(e: TouchEvent) {
      for (const t of Array.from(e.changedTouches)) {
        const isLeft = t.clientX < window.innerWidth / 2
        if (isLeft && leftTouchId.current === null) {
          leftTouchId.current  = t.identifier
          leftBaseRef.current  = { x: t.clientX, y: t.clientY }
          leftStickRef.current = { active: true, x: 0, y: 0 }
        } else if (!isLeft && rightTouchId.current === null) {
          rightTouchId.current  = t.identifier
          rightBaseRef.current  = { x: t.clientX, y: t.clientY }
          rightStickRef.current = { active: true, x: 0, y: 0 }
        }
      }
    }

    function onTouchMove(e: TouchEvent) {
      e.preventDefault()
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === leftTouchId.current) {
          const dx   = t.clientX - leftBaseRef.current.x
          const dy   = t.clientY - leftBaseRef.current.y
          const dist = Math.sqrt(dx*dx + dy*dy)
          const cx   = dist > MAX_RADIUS ? (dx/dist)*MAX_RADIUS : dx
          const cy   = dist > MAX_RADIUS ? (dy/dist)*MAX_RADIUS : dy
          setLeftKnob({ x: cx, y: cy })
          const nx = clamp(dx / MAX_RADIUS, -1, 1)
          const ny = clamp(dy / MAX_RADIUS, -1, 1)
          inputRef.current.yaw    = Math.abs(dx) > DEAD_ZONE ? curve(nx) : 0
          inputRef.current.thrust = Math.abs(dy) > DEAD_ZONE && dy < 0 ? curve(-ny) : 0
          inputRef.current.brake  = Math.abs(dy) > DEAD_ZONE && dy > 0 ? curve(ny)  : 0
        }
        if (t.identifier === rightTouchId.current) {
          const dx   = t.clientX - rightBaseRef.current.x
          const dy   = t.clientY - rightBaseRef.current.y
          const dist = Math.sqrt(dx*dx + dy*dy)
          const cx   = dist > MAX_RADIUS ? (dx/dist)*MAX_RADIUS : dx
          const cy   = dist > MAX_RADIUS ? (dy/dist)*MAX_RADIUS : dy
          setRightKnob({ x: cx, y: cy })
          const ny = clamp(dy / MAX_RADIUS, -1, 1)
          const nx = clamp(dx / MAX_RADIUS, -1, 1)
          inputRef.current.vertical = Math.abs(dy) > DEAD_ZONE ? curve(-ny) : 0
          inputRef.current.pitch    = Math.abs(dx) > DEAD_ZONE ? curve(nx)  : 0
        }
      }
    }

    function onTouchEnd(e: TouchEvent) {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === leftTouchId.current) {
          leftTouchId.current         = null
          leftStickRef.current.active = false
          setLeftKnob({ x: 0, y: 0 })
          inputRef.current.yaw    = 0
          inputRef.current.thrust = 0
          inputRef.current.brake  = 0
        }
        if (t.identifier === rightTouchId.current) {
          rightTouchId.current         = null
          rightStickRef.current.active = false
          setRightKnob({ x: 0, y: 0 })
          inputRef.current.pitch    = 0
          inputRef.current.vertical = 0
        }
      }
    }

    window.addEventListener('touchstart',  onTouchStart, { passive: false })
    window.addEventListener('touchmove',   onTouchMove,  { passive: false })
    window.addEventListener('touchend',    onTouchEnd,   { passive: false })
    window.addEventListener('touchcancel', onTouchEnd,   { passive: false })

    return () => {
      window.removeEventListener('touchstart',  onTouchStart)
      window.removeEventListener('touchmove',   onTouchMove)
      window.removeEventListener('touchend',    onTouchEnd)
      window.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [isMobile, inputRef])

  // Poll inputRef for boost changes to drive the notification toast
  useEffect(() => {
    let prev = false
    const id = setInterval(() => {
      const curr = inputRef.current.boost
      if (curr !== prev) {
        prev = curr
        setBoostNotif(curr ? '⚡ SUPER SPEED ACTIVATED' : '⚡ SUPER SPEED DEACTIVATED')
        setTimeout(() => setBoostNotif(null), 1500)
      }
    }, 50)
    return () => clearInterval(id)
  }, [inputRef])

  const speedPct = Math.round(speed * 100)

  const arrowBtnStyle: React.CSSProperties = {
    width: '52px', height: '52px',
    borderRadius: '12px',
    background: 'rgba(155,79,192,0.25)',
    border: '1px solid rgba(155,79,192,0.5)',
    color: '#c4b5fd',
    fontSize: '1.2rem',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    touchAction: 'none',
    userSelect: 'none',
    cursor: 'pointer',
    WebkitUserSelect: 'none',
    pointerEvents: 'auto',
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 20, pointerEvents: 'none' }}>

      {/* Exit button — top right */}
      <div style={{ position: 'absolute', top: '1.5rem', right: '1.5rem', pointerEvents: 'auto' }}>
        <motion.button
          onClick={onExit}
          style={{
            display:        'flex',
            alignItems:     'center',
            gap:            '0.5rem',
            padding:        '0.6rem 1.2rem',
            border:         '1px solid rgba(215,226,234,0.2)',
            background:     'rgba(12,12,12,0.5)',
            backdropFilter: 'blur(8px)',
            borderRadius:   '999px',
            color:          '#D7E2EA',
            fontSize:       '0.75rem',
            textTransform:  'uppercase',
            letterSpacing:  '0.1em',
            cursor:         'pointer',
          }}
          whileHover={{ background: 'rgba(215,226,234,0.1)' }}
          transition={{ duration: 0.2 }}
        >
          <ArrowLeft size={14} />
          Return to Hub
        </motion.button>
      </div>

      {/* Landing prompt — top center */}
      <AnimatePresence>
        {nearestPlanet && nearestPlanet.distance < 6 && (
          <motion.div
            key="landing"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3 }}
            style={{
              position:       'absolute',
              top:            '1.5rem',
              left:           '50%',
              transform:      'translateX(-50%)',
              background:     'rgba(119,33,177,0.15)',
              backdropFilter: 'blur(12px)',
              border:         '1px solid rgba(119,33,177,0.4)',
              borderRadius:   '12px',
              padding:        '0.6rem 1.2rem',
              color:          '#D7E2EA',
              fontSize:       '0.8rem',
              textAlign:      'center',
              whiteSpace:     'nowrap',
            }}
          >
            <span style={{ opacity: 0.7 }}>Approaching </span>
            <strong>{nearestPlanet.name}</strong>
            {isMobile ? (
              <span style={{ opacity: 0.5 }}> — tap LAND to enter</span>
            ) : (
              <>
                <span style={{ opacity: 0.5 }}> — Press </span>
                <kbd style={{ background: 'rgba(215,226,234,0.1)', borderRadius: '4px', padding: '0 5px' }}>F</kbd>
                <span style={{ opacity: 0.5 }}> to land</span>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Boost notification toast — fades out after 1.5s */}
      <AnimatePresence>
        {boostNotif && (
          <motion.div
            key={boostNotif}
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25 }}
            style={{
              position:      'absolute',
              top:           '4rem',
              left:          '50%',
              transform:     'translateX(-50%)',
              background:    'rgba(139,92,246,0.2)',
              border:        '1px solid rgba(139,92,246,0.8)',
              borderRadius:  '8px',
              padding:       '0.4rem 1.2rem',
              color:         '#c4b5fd',
              fontSize:      '0.75rem',
              letterSpacing: '0.3em',
              fontFamily:    'Kanit, sans-serif',
              boxShadow:     '0 0 20px rgba(139,92,246,0.5)',
              pointerEvents: 'none',
              whiteSpace:    'nowrap',
            }}
          >
            {boostNotif}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Speed bar — bottom center, desktop only */}
      {!isMobile && (
        <div style={{
          position:    'absolute',
          bottom:      '2rem',
          left:        '50%',
          transform:   'translateX(-50%)',
          display:     'flex',
          flexDirection: 'column',
          alignItems:  'center',
          gap:         '0.35rem',
        }}>
          <span style={{ color: 'rgba(215,226,234,0.4)', fontSize: '0.65rem', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
            {isBoosting ? 'BOOST' : 'SPEED'}
          </span>
          <div style={{
            width:        '140px',
            height:       '4px',
            background:   'rgba(215,226,234,0.1)',
            borderRadius: '999px',
            overflow:     'hidden',
          }}>
            <div style={{
              width:        `${speedPct}%`,
              height:       '100%',
              background:   isBoosting
                ? 'linear-gradient(90deg, #7721B1, #D7E2EA)'
                : 'linear-gradient(90deg, #7721B1, #3B8BD4)',
              borderRadius: '999px',
              transition:   'width 0.1s ease, background 0.3s ease',
            }} />
          </div>
          <span style={{ color: 'rgba(215,226,234,0.3)', fontSize: '0.6rem', letterSpacing: '0.08em' }}>
            {speedPct}%
          </span>
        </div>
      )}

      {/* Controls hint — above radar, desktop only */}
      {!isMobile && (
        <div style={{
          position:       'absolute',
          bottom:         '11.5rem',
          right:          '1.5rem',
          background:     'rgba(12, 12, 12, 0.5)',
          backdropFilter: 'blur(8px)',
          border:         '1px solid rgba(215, 226, 234, 0.1)',
          borderRadius:   '8px',
          padding:        '0.65rem 0.8rem',
          pointerEvents:  'none',
        }}>
          {([
            ['W / S',        'thrust / brake'],
            ['A / D',        'turn left / right'],
            ['Q / E',        'pitch up / down'],
            ['Z / X',        'roll'],
            ['SHIFT / CTRL', 'ascend / descend'],
            ['SPACE',        'boost'],
            ['F',            'land'],
          ] as [string, string][]).map(([key, desc]) => (
            <div key={key} style={{ display: 'flex', gap: '0.75rem', justifyContent: 'space-between', lineHeight: 1.75 }}>
              <span style={{ color: 'rgba(215,226,234,0.8)', fontSize: '0.68rem', fontFamily: 'monospace', minWidth: '5.5rem' }}>{key}</span>
              <span style={{ color: 'rgba(215,226,234,0.4)', fontSize: '0.68rem' }}>{desc}</span>
            </div>
          ))}
        </div>
      )}

      {/* Radar — bottom right */}
      <div style={{
        position: 'absolute',
        bottom:   '1.5rem',
        right:    '1.5rem',
        display:  'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap:      '0.3rem',
      }}>
        <canvas
          ref={radarRef}
          width={RADAR_SIZE}
          height={RADAR_SIZE}
          style={{ display: 'block', borderRadius: '50%' }}
        />
        <span style={{ color: 'rgba(215,226,234,0.3)', fontSize: '0.6rem', letterSpacing: '0.1em' }}>NAV</span>
      </div>

      {/* Dual joystick — mobile only */}
      {isMobile && (
        <>
          {/* Left joystick — thrust + yaw */}
          <div style={{
            position:       'absolute',
            bottom:         '7rem',
            left:           '2rem',
            width:          '120px',
            height:         '120px',
            borderRadius:   '50%',
            background:     'rgba(155,79,192,0.12)',
            border:         '1px solid rgba(155,79,192,0.35)',
            pointerEvents:  'none',
            touchAction:    'none',
          }}>
            <div style={{
              width:        '40px',
              height:       '40px',
              borderRadius: '50%',
              background:   'rgba(155,79,192,0.7)',
              border:       '2px solid rgba(196,181,253,0.8)',
              pointerEvents: 'none',
              position:     'absolute',
              top:          '50%',
              left:         '50%',
              marginTop:    '-20px',
              marginLeft:   '-20px',
              transform:    `translate(${leftKnob.x}px, ${leftKnob.y}px)`,
              transition:   leftTouchId.current !== null ? 'none' : 'transform 0.15s ease',
            }} />
            <div style={{ position: 'absolute', top: '4px', fontSize: '0.55rem', color: 'rgba(196,181,253,0.5)', letterSpacing: '0.1em' }}>FWD</div>
            <div style={{ position: 'absolute', bottom: '4px', fontSize: '0.55rem', color: 'rgba(196,181,253,0.5)', letterSpacing: '0.1em' }}>BRAKE</div>
            <div style={{ position: 'absolute', left: '4px', fontSize: '0.55rem', color: 'rgba(196,181,253,0.5)', letterSpacing: '0.1em' }}>◄</div>
            <div style={{ position: 'absolute', right: '4px', fontSize: '0.55rem', color: 'rgba(196,181,253,0.5)', letterSpacing: '0.1em' }}>►</div>
          </div>

          {/* Right joystick — pitch + vertical */}
          <div style={{
            position:       'absolute',
            bottom:         '7rem',
            right:          '2rem',
            width:          '120px',
            height:         '120px',
            borderRadius:   '50%',
            background:     'rgba(155,79,192,0.12)',
            border:         '1px solid rgba(155,79,192,0.35)',
            pointerEvents:  'none',
            touchAction:    'none',
          }}>
            <div style={{
              width:        '40px',
              height:       '40px',
              borderRadius: '50%',
              background:   'rgba(155,79,192,0.7)',
              border:       '2px solid rgba(196,181,253,0.8)',
              pointerEvents: 'none',
              position:     'absolute',
              top:          '50%',
              left:         '50%',
              marginTop:    '-20px',
              marginLeft:   '-20px',
              transform:    `translate(${rightKnob.x}px, ${rightKnob.y}px)`,
              transition:   rightTouchId.current !== null ? 'none' : 'transform 0.15s ease',
            }} />
            <div style={{ position: 'absolute', top: '4px', fontSize: '0.55rem', color: 'rgba(196,181,253,0.5)', letterSpacing: '0.1em' }}>UP</div>
            <div style={{ position: 'absolute', bottom: '4px', fontSize: '0.55rem', color: 'rgba(196,181,253,0.5)', letterSpacing: '0.1em' }}>DOWN</div>
            <div style={{ position: 'absolute', left: '4px', fontSize: '0.55rem', color: 'rgba(196,181,253,0.5)', letterSpacing: '0.1em' }}>◄</div>
            <div style={{ position: 'absolute', right: '4px', fontSize: '0.55rem', color: 'rgba(196,181,253,0.5)', letterSpacing: '0.1em' }}>►</div>
          </div>

          {/* BOOST + LAND — bottom center */}
          <div style={{
            position:  'absolute',
            bottom:    '1.5rem',
            left:      '50%',
            transform: 'translateX(-50%)',
            display:   'flex',
            gap:       '1rem',
          }}>
            <button
              onTouchStart={() => {
                const newBoost = !inputRef.current.boost
                inputRef.current.boost = newBoost
                setBoostNotif(newBoost ? '⚡ SUPER SPEED ACTIVATED' : '⚡ SUPER SPEED DEACTIVATED')
                setTimeout(() => setBoostNotif(null), 1500)
              }}
              style={{
                ...arrowBtnStyle,
                background:    'rgba(139,92,246,0.3)',
                border:        '1px solid rgba(139,92,246,0.6)',
                fontSize:      '0.6rem',
                letterSpacing: '0.1em',
                width:         '64px',
                pointerEvents: 'auto',
              }}
            >BOOST</button>
            <button
              onTouchStart={() => { inputRef.current.land = true }}
              onTouchEnd={() => { inputRef.current.land = false }}
              onTouchCancel={() => { inputRef.current.land = false }}
              style={{
                ...arrowBtnStyle,
                background:    'rgba(34,197,94,0.3)',
                border:        '1px solid rgba(34,197,94,0.6)',
                fontSize:      '0.6rem',
                letterSpacing: '0.1em',
                width:         '64px',
                pointerEvents: 'auto',
              }}
            >LAND</button>
          </div>
        </>
      )}

    </div>
  )
}
