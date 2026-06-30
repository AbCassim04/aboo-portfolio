import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft } from 'lucide-react'
import type { FlightInput } from '../hooks/useFlightControls'
import Joystick from './Joystick'

export interface PlanetDot {
  name: string; x: number; y: number; color: string
}

interface FlightHUDProps {
  speed:          number
  isBoosting:     boolean
  nearestPlanet:  { name: string; distance: number } | null
  ufoX:           number
  ufoY:           number
  planetDots:     PlanetDot[]
  onExit:         () => void
  inputRef:       React.MutableRefObject<FlightInput>
  onToggleLight?: () => void
  lightOn?:       boolean
}

const RADAR_SIZE  = 120
const RADAR_SCALE = 56 / 32

export default function FlightHUD({
  speed, isBoosting, nearestPlanet, ufoX, ufoY, planetDots, onExit, inputRef,
  onToggleLight, lightOn,
}: FlightHUDProps) {
  const [isMobile]   = useState(() => 'ontouchstart' in window || navigator.maxTouchPoints > 0)
  const [boostNotif, setBoostNotif] = useState<string | null>(null)
  const radarRef = useRef<HTMLCanvasElement>(null)

  // Radar canvas
  useEffect(() => {
    const canvas = radarRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const cx = RADAR_SIZE / 2
    const cy = RADAR_SIZE / 2

    ctx.clearRect(0, 0, RADAR_SIZE, RADAR_SIZE)
    ctx.save()
    ctx.beginPath()
    ctx.arc(cx, cy, 58, 0, Math.PI * 2)
    ctx.clip()

    ctx.fillStyle = 'rgba(12,12,12,0.75)'
    ctx.fill()

    ctx.strokeStyle = 'rgba(215,226,234,0.07)'
    ctx.lineWidth   = 1
    for (const r of [20, 40]) {
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke()
    }

    for (const p of planetDots) {
      const dx = (p.x - ufoX) * RADAR_SCALE
      const dy = -(p.y - ufoY) * RADAR_SCALE
      if (Math.hypot(dx, dy) > 54) continue
      ctx.beginPath()
      ctx.arc(cx + dx, cy + dy, 4, 0, Math.PI * 2)
      ctx.fillStyle = p.color
      ctx.fill()
      ctx.font      = '8px Arial, sans-serif'
      ctx.fillStyle = 'rgba(215,226,234,0.5)'
      ctx.textAlign = 'center'
      ctx.fillText(p.name, cx + dx, cy + dy - 7)
    }

    ctx.restore()

    ctx.beginPath()
    ctx.arc(cx, cy, 58, 0, Math.PI * 2)
    ctx.strokeStyle = 'rgba(215,226,234,0.15)'
    ctx.lineWidth   = 1.5
    ctx.stroke()

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

  // Boost toast polling
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

  const btnBase: React.CSSProperties = {
    width:          '80px',
    height:         '80px',
    borderRadius:   '14px',
    color:          '#c4b5fd',
    fontSize:       '0.72rem',
    fontWeight:     600,
    letterSpacing:  '0.1em',
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'center',
    touchAction:    'none',
    userSelect:     'none',
    WebkitUserSelect: 'none',
    cursor:         'pointer',
    pointerEvents:  'auto',
    border:         '1px solid',
    backdropFilter: 'blur(6px)',
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 20, pointerEvents: 'none' }}>

      {/* Exit */}
      <div style={{ position: 'absolute', top: '1.5rem', right: '1.5rem', pointerEvents: 'auto' }}>
        <motion.button
          onClick={onExit}
          style={{
            display: 'flex', alignItems: 'center', gap: '0.5rem',
            padding: '0.6rem 1.2rem',
            border: '1px solid rgba(215,226,234,0.2)',
            background: 'rgba(12,12,12,0.5)',
            backdropFilter: 'blur(8px)',
            borderRadius: '999px',
            color: '#D7E2EA',
            fontSize: '0.75rem',
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
            cursor: 'pointer',
          }}
          whileHover={{ background: 'rgba(215,226,234,0.1)' }}
          transition={{ duration: 0.2 }}
        >
          <ArrowLeft size={14} />
          Return to Hub
        </motion.button>
      </div>

      {/* Landing prompt */}
      <AnimatePresence>
        {nearestPlanet && nearestPlanet.distance < 6 && (
          <motion.div
            key="landing"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3 }}
            style={{
              position: 'absolute', top: '1.5rem', left: '50%',
              transform: 'translateX(-50%)',
              background: 'rgba(119,33,177,0.15)',
              backdropFilter: 'blur(12px)',
              border: '1px solid rgba(119,33,177,0.4)',
              borderRadius: '12px',
              padding: '0.6rem 1.2rem',
              color: '#D7E2EA', fontSize: '0.8rem',
              textAlign: 'center', whiteSpace: 'nowrap',
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

      {/* Boost toast */}
      <AnimatePresence>
        {boostNotif && (
          <motion.div
            key={boostNotif}
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25 }}
            style={{
              position: 'absolute', top: '4rem', left: '50%',
              transform: 'translateX(-50%)',
              background: 'rgba(139,92,246,0.2)',
              border: '1px solid rgba(139,92,246,0.8)',
              borderRadius: '8px', padding: '0.4rem 1.2rem',
              color: '#c4b5fd', fontSize: '0.75rem',
              letterSpacing: '0.3em', fontFamily: 'Kanit, sans-serif',
              boxShadow: '0 0 20px rgba(139,92,246,0.5)',
              pointerEvents: 'none', whiteSpace: 'nowrap',
            }}
          >
            {boostNotif}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Speed bar — desktop only */}
      {!isMobile && (
        <div style={{
          position: 'absolute', bottom: '2rem', left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.35rem',
        }}>
          <span style={{ color: 'rgba(215,226,234,0.4)', fontSize: '0.65rem', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
            {isBoosting ? 'BOOST' : 'SPEED'}
          </span>
          <div style={{ width: '140px', height: '4px', background: 'rgba(215,226,234,0.1)', borderRadius: '999px', overflow: 'hidden' }}>
            <div style={{
              width: `${speedPct}%`, height: '100%',
              background: isBoosting
                ? 'linear-gradient(90deg, #7721B1, #D7E2EA)'
                : 'linear-gradient(90deg, #7721B1, #3B8BD4)',
              borderRadius: '999px',
              transition: 'width 0.1s ease, background 0.3s ease',
            }} />
          </div>
          <span style={{ color: 'rgba(215,226,234,0.3)', fontSize: '0.6rem', letterSpacing: '0.08em' }}>{speedPct}%</span>
        </div>
      )}

      {/* Controls hint — desktop only */}
      {!isMobile && (
        <div style={{
          position: 'absolute', bottom: '11.5rem', right: '1.5rem',
          background: 'rgba(12,12,12,0.5)', backdropFilter: 'blur(8px)',
          border: '1px solid rgba(215,226,234,0.1)', borderRadius: '8px',
          padding: '0.65rem 0.8rem', pointerEvents: 'none',
        }}>
          {([
            ['W / S',        'thrust / brake'],
            ['A / D',        'turn left / right'],
            ['Q / E',        'pitch up / down'],
            ['Z / X',        'roll'],
            ['SHIFT / CTRL', 'ascend / descend'],
            ['SPACE',        'boost'],
            ['F',            'land'],
            ['L',            'toggle headlight'],
          ] as [string, string][]).map(([key, desc]) => (
            <div key={key} style={{ display: 'flex', gap: '0.75rem', justifyContent: 'space-between', lineHeight: 1.75 }}>
              <span style={{ color: 'rgba(215,226,234,0.8)', fontSize: '0.68rem', fontFamily: 'monospace', minWidth: '5.5rem' }}>{key}</span>
              <span style={{ color: 'rgba(215,226,234,0.4)', fontSize: '0.68rem' }}>{desc}</span>
            </div>
          ))}
        </div>
      )}

      {/* Radar */}
      <div style={{
        position: 'absolute', bottom: '1.5rem', right: '1.5rem',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.3rem',
      }}>
        <canvas ref={radarRef} width={RADAR_SIZE} height={RADAR_SIZE}
          style={{ display: 'block', borderRadius: '50%' }} />
        <span style={{ color: 'rgba(215,226,234,0.3)', fontSize: '0.6rem', letterSpacing: '0.1em' }}>NAV</span>
      </div>

      {/* Mobile controls */}
      {isMobile && (
        <>
          {/* Left joystick — thrust / yaw */}
          <div style={{
            position: 'absolute', bottom: '5rem', left: '0.5rem',
            pointerEvents: 'auto',
          }}>
            <Joystick
              id="left-joystick"
              size={180}
              onMove={(x, y) => {
                inputRef.current.yaw    =  x
                inputRef.current.thrust =  y > 0 ?  y : 0
                inputRef.current.brake  =  y < 0 ? -y : 0
              }}
              onEnd={() => {
                inputRef.current.yaw    = 0
                inputRef.current.thrust = 0
                inputRef.current.brake  = 0
              }}
            />
          </div>

          {/* Right joystick — vertical only */}
          <div style={{
            position: 'absolute', bottom: '5rem', right: '0.5rem',
            pointerEvents: 'auto',
          }}>
            <Joystick
              id="right-joystick"
              size={180}
              onMove={(_x, y) => {
                inputRef.current.vertical = y
              }}
              onEnd={() => {
                inputRef.current.vertical = 0
              }}
            />
          </div>

          {/* BOOST + LAND — top-left column */}
          <div style={{
            position:      'absolute',
            top:           '4.5rem',
            left:          '1rem',
            display:       'flex',
            flexDirection: 'column',
            gap:           '0.75rem',
            zIndex:        100,
            pointerEvents: 'auto',
            alignItems:    'flex-start',
          }}>
            <button
              onTouchStart={() => {
                const newBoost = !inputRef.current.boost
                inputRef.current.boost = newBoost
                setBoostNotif(newBoost ? '⚡ SUPER SPEED ACTIVATED' : '⚡ SUPER SPEED DEACTIVATED')
                setTimeout(() => setBoostNotif(null), 1500)
              }}
              style={{
                ...btnBase,
                background:  'rgba(139,92,246,0.18)',
                borderColor: 'rgba(139,92,246,0.6)',
              }}
            >BOOST</button>
            <button
              onTouchStart={() => { inputRef.current.land = true }}
              onTouchEnd={()   => { inputRef.current.land = false }}
              onTouchCancel={() => { inputRef.current.land = false }}
              style={{
                ...btnBase,
                background:  'rgba(34,197,94,0.18)',
                borderColor: 'rgba(34,197,94,0.6)',
                color:       '#86efac',
              }}
            >LAND</button>

            {/* LIGHT — pill toggle, visually distinct from the nav buttons */}
            {onToggleLight && (
              <button
                onTouchStart={onToggleLight}
                style={{
                  marginTop:        '0.25rem',
                  padding:          '0.45rem 1.1rem',
                  borderRadius:     '999px',
                  background:       lightOn ? 'rgba(255,255,150,0.12)' : 'rgba(255,255,255,0.04)',
                  border:           lightOn
                                      ? '1px solid rgba(255,255,150,0.55)'
                                      : '1px solid rgba(215,226,234,0.15)',
                  color:            lightOn ? 'rgba(255,255,150,0.9)' : 'rgba(215,226,234,0.35)',
                  fontSize:         '0.58rem',
                  letterSpacing:    '0.18em',
                  cursor:           'pointer',
                  pointerEvents:    'auto',
                  touchAction:      'none',
                  userSelect:       'none',
                  WebkitUserSelect: 'none' as React.CSSProperties['WebkitUserSelect'],
                  backdropFilter:   'blur(4px)',
                  fontFamily:       'Kanit, sans-serif',
                  fontWeight:       400,
                }}
              >LIGHT</button>
            )}
          </div>
        </>
      )}

    </div>
  )
}
