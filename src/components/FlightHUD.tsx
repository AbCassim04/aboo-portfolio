import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft } from 'lucide-react'
import nipplejs from 'nipplejs'
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
  const radarRef = useRef<HTMLCanvasElement>(null)

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

  // Dual joystick — NippleJS
  useEffect(() => {
    if (!isMobile) return

    const leftZone  = document.getElementById('left-joystick-zone')
    const rightZone = document.getElementById('right-joystick-zone')
    if (!leftZone || !rightZone) return

    const leftManager = nipplejs.create({
      zone:        leftZone,
      mode:        'static',
      position:    { left: '50%', top: '50%' },
      color:       '#9b4fc0',
      size:        120,
      restOpacity: 0.5,
    })

    const rightManager = nipplejs.create({
      zone:        rightZone,
      mode:        'static',
      position:    { left: '50%', top: '50%' },
      color:       '#9b4fc0',
      size:        120,
      restOpacity: 0.5,
    })

    leftManager.on('start', () => {
      document.querySelectorAll('#left-joystick-zone .nipple').forEach(el => {
        el.classList.add('active')
        el.classList.remove('inactive')
      })
    })
    leftManager.on('move', (evt) => {
      const { x, y } = evt.data.vector
      inputRef.current.yaw    =  x
      inputRef.current.thrust =  y > 0 ? y : 0
      inputRef.current.brake  =  y < 0 ? -y : 0
    })
    leftManager.on('end', () => {
      document.querySelectorAll('#left-joystick-zone .nipple').forEach(el => {
        el.classList.add('inactive')
        el.classList.remove('active')
      })
      inputRef.current.yaw    = 0
      inputRef.current.thrust = 0
      inputRef.current.brake  = 0
    })

    rightManager.on('start', () => {
      document.querySelectorAll('#right-joystick-zone .nipple').forEach(el => {
        el.classList.add('active')
        el.classList.remove('inactive')
      })
    })
    rightManager.on('move', (evt) => {
      const { y } = evt.data.vector
      inputRef.current.vertical = -y
    })
    rightManager.on('end', () => {
      document.querySelectorAll('#right-joystick-zone .nipple').forEach(el => {
        el.classList.add('inactive')
        el.classList.remove('active')
      })
      inputRef.current.vertical = 0
    })

    return () => {
      leftManager.destroy()
      rightManager.destroy()
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
    width:        '80px',
    height:       '80px',
    borderRadius: '12px',
    background:   'rgba(155,79,192,0.25)',
    border:       '1px solid rgba(155,79,192,0.5)',
    color:        '#c4b5fd',
    fontSize:     '0.75rem',
    display:      'flex',
    alignItems:   'center',
    justifyContent: 'center',
    touchAction:  'none',
    userSelect:   'none',
    cursor:       'pointer',
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
          <style>{`
            .nipple .front {
              background: rgba(155, 79, 192, 0.8) !important;
              border: 2px solid rgba(196, 181, 253, 0.9) !important;
              box-shadow: 0 0 12px rgba(155, 79, 192, 0.6) !important;
            }
            .nipple .back {
              background: rgba(155, 79, 192, 0.15) !important;
              border: 1px solid rgba(155, 79, 192, 0.4) !important;
            }
            .nipple {
              transition: opacity 0.5s ease !important;
            }
            .nipple.inactive {
              opacity: 0.15 !important;
            }
            .nipple.active {
              opacity: 1.0 !important;
            }
          `}</style>

          {/* Left joystick zone */}
          <div
            id="left-joystick-zone"
            style={{
              position:      'absolute',
              bottom:        '5rem',
              left:          0,
              width:         '55%',
              height:        '260px',
              pointerEvents: 'auto',
              touchAction:   'none',
            }}
          />

          {/* Right joystick zone */}
          <div
            id="right-joystick-zone"
            style={{
              position:      'absolute',
              bottom:        '5rem',
              right:         0,
              width:         '55%',
              height:        '260px',
              pointerEvents: 'auto',
              touchAction:   'none',
            }}
          />

          {/* BOOST + LAND */}
          <div style={{
            position:  'absolute',
            bottom:    '1rem',
            left:      '50%',
            transform: 'translateX(-50%)',
            display:   'flex',
            gap:       '1rem',
            zIndex:    100,
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
                letterSpacing: '0.1em',
                pointerEvents: 'auto',
              }}
            >BOOST</button>
            <button
              onTouchStart={() => { inputRef.current.land = true }}
              onTouchEnd={()  => { inputRef.current.land = false }}
              onTouchCancel={() => { inputRef.current.land = false }}
              style={{
                ...arrowBtnStyle,
                background:    'rgba(34,197,94,0.3)',
                border:        '1px solid rgba(34,197,94,0.6)',
                letterSpacing: '0.1em',
                pointerEvents: 'auto',
              }}
            >LAND</button>
          </div>
        </>
      )}

    </div>
  )
}
