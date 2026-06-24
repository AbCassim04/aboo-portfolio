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
  const radarRef  = useRef<HTMLCanvasElement>(null)

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

      <button
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 9999,
          background: 'red',
          color: 'white',
          padding: '20px',
          fontSize: '20px',
          pointerEvents: 'auto',
        }}
        onTouchStart={() => { console.log('TOUCH WORKS'); inputRef.current.thrust = 1 }}
        onTouchEnd={() => { inputRef.current.thrust = 0 }}
        onClick={() => { console.log('CLICK WORKS'); inputRef.current.thrust = 1 }}
      >
        TEST BUTTON
      </button>

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

      {/* Arrow controls — mobile only */}
      {isMobile && (
        <>
          {/* Left side — 4 directional arrows */}
          <div style={{
            position: 'absolute', bottom: '6rem', left: '1.5rem',
            display: 'grid',
            gridTemplateColumns: '52px 52px 52px',
            gridTemplateRows: '52px 52px',
            gap: '0.4rem',
            pointerEvents: 'auto',
          }}>
            <div style={{ gridColumn: '2', gridRow: '1' }}>
              <button
                onTouchStart={() => { inputRef.current.thrust = 1 }}
                onTouchEnd={() => { inputRef.current.thrust = 0 }}
                onTouchCancel={() => { inputRef.current.thrust = 0 }}
                style={arrowBtnStyle}
              >▲</button>
            </div>
            <div style={{ gridColumn: '1', gridRow: '2' }}>
              <button
                onTouchStart={() => { inputRef.current.yaw = -1 }}
                onTouchEnd={() => { inputRef.current.yaw = 0 }}
                onTouchCancel={() => { inputRef.current.yaw = 0 }}
                style={arrowBtnStyle}
              >◄</button>
            </div>
            <div style={{ gridColumn: '2', gridRow: '2' }}>
              <button
                onTouchStart={() => { inputRef.current.brake = 1 }}
                onTouchEnd={() => { inputRef.current.brake = 0 }}
                onTouchCancel={() => { inputRef.current.brake = 0 }}
                style={arrowBtnStyle}
              >▼</button>
            </div>
            <div style={{ gridColumn: '3', gridRow: '2' }}>
              <button
                onTouchStart={() => { inputRef.current.yaw = 1 }}
                onTouchEnd={() => { inputRef.current.yaw = 0 }}
                onTouchCancel={() => { inputRef.current.yaw = 0 }}
                style={arrowBtnStyle}
              >►</button>
            </div>
          </div>

          {/* Right side — up/down */}
          <div style={{
            position: 'absolute', bottom: '6rem', right: '1.5rem',
            display: 'flex', flexDirection: 'column', gap: '0.4rem',
            pointerEvents: 'auto',
          }}>
            <button
              onTouchStart={() => { inputRef.current.vertical = 1 }}
              onTouchEnd={() => { inputRef.current.vertical = 0 }}
              onTouchCancel={() => { inputRef.current.vertical = 0 }}
              style={arrowBtnStyle}
            >↑</button>
            <button
              onTouchStart={() => { inputRef.current.vertical = -1 }}
              onTouchEnd={() => { inputRef.current.vertical = 0 }}
              onTouchCancel={() => { inputRef.current.vertical = 0 }}
              style={arrowBtnStyle}
            >↓</button>
          </div>

          {/* Bottom center — BOOST and LAND */}
          <div style={{
            position: 'absolute', bottom: '1.5rem', left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex', gap: '1rem',
            pointerEvents: 'auto',
          }}>
            <button
              onTouchStart={() => { inputRef.current.boost = true }}
              onTouchEnd={() => { inputRef.current.boost = false }}
              onTouchCancel={() => { inputRef.current.boost = false }}
              style={{ ...arrowBtnStyle, background: 'rgba(139,92,246,0.3)', border: '1px solid rgba(139,92,246,0.6)', fontSize: '0.6rem', letterSpacing: '0.1em', width: '64px' }}
            >BOOST</button>
            <button
              onTouchStart={() => { inputRef.current.land = true }}
              onTouchEnd={() => { inputRef.current.land = false }}
              onTouchCancel={() => { inputRef.current.land = false }}
              style={{ ...arrowBtnStyle, background: 'rgba(34,197,94,0.3)', border: '1px solid rgba(34,197,94,0.6)', fontSize: '0.6rem', letterSpacing: '0.1em', width: '64px' }}
            >LAND</button>
          </div>
        </>
      )}

    </div>
  )
}
