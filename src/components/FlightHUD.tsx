import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft } from 'lucide-react'
import type { FlightInput } from '../hooks/useFlightControls'
import Joystick from './Joystick'
import EarthTimeChip from './EarthTimeChip'
import type { CloudStatus } from '../earth/liveClouds'

// Something plotted on the NAV radar: position relative to the ship in km,
// heading-up (x = right, y = ahead) in the ecliptic plane.
export interface RadarBlip {
  key: string; label: string; name: string; color: string; isSun: boolean; x: number; y: number
}

interface FlightHUDProps {
  speed:          number
  isBoosting:     boolean
  /** Set only while within landing range of a destination. */
  nearestPlanet:  { name: string; distance: number } | null
  radarDots:      RadarBlip[]
  radarBodies?:   RadarBlip[]
  activeBodyKey?: string | null
  /** Inside the asteroid belt (local field active). */
  inBelt?:        boolean
  onExit:         () => void
  inputRef:       React.MutableRefObject<FlightInput>
  onToggleLight?: () => void
  lightOn?:       boolean
  cloudStatus?:   CloudStatus
}

const RADAR_SIZE  = 120
// Log-scaled range: radius = R · log10(1 + d/D0) / log10(1 + DMAX/D0), so
// the portfolio zone (~10⁴ km), the Moon (~4·10⁵ km) and Neptune (~4.5·10⁹ km)
// all fit on one 58 px dial; bearings are true.
const RADAR_R    = 52
const RADAR_D0   = 1_000
const RADAR_DMAX = 7.5e9
function radarRadius(dKm: number): number {
  return RADAR_R * Math.log10(1 + dKm / RADAR_D0) / Math.log10(1 + RADAR_DMAX / RADAR_D0)
}
function radarXY(b: RadarBlip): [number, number] {
  const d = Math.hypot(b.x, b.y)
  if (d === 0) return [0, 0]
  const r = Math.min(RADAR_R, radarRadius(d))
  return [(b.x / d) * r, -(b.y / d) * r]
}

export default function FlightHUD({
  speed, isBoosting, nearestPlanet, radarDots, radarBodies, activeBodyKey, inBelt,
  onExit, inputRef, onToggleLight, lightOn, cloudStatus,
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

    // Range rings at 10⁴ km, 10⁶ km and 1 AU.
    ctx.strokeStyle = 'rgba(215,226,234,0.07)'
    ctx.lineWidth   = 1
    for (const d of [1e4, 1e6, 1.496e8]) {
      ctx.beginPath(); ctx.arc(cx, cy, radarRadius(d), 0, Math.PI * 2); ctx.stroke()
    }

    // Portfolio destinations (small, close to the centre near Earth).
    for (const p of radarDots) {
      const [dx, dy] = radarXY(p)
      ctx.beginPath()
      ctx.arc(cx + dx, cy + dy, 2.5, 0, Math.PI * 2)
      ctx.fillStyle = p.color
      ctx.fill()
    }

    // Solar-system bodies at their log-scaled range and true bearing. The Sun
    // is a larger warm dot; the body the player is nearest to is highlighted
    // with its full name.
    if (radarBodies && radarBodies.length) {
      for (const b of radarBodies) {
        const [sx, sy] = radarXY(b)
        const px = cx + sx, py = cy + sy
        const isActive = b.key === activeBodyKey
        const r = b.isSun ? 5 : isActive ? 4 : 3

        ctx.beginPath()
        ctx.arc(px, py, r, 0, Math.PI * 2)
        ctx.fillStyle = b.isSun ? '#ffcc33' : b.color
        if (b.isSun || isActive) {
          ctx.shadowColor = b.isSun ? '#ffcc33' : b.color
          ctx.shadowBlur  = 6
        }
        ctx.fill()
        ctx.shadowBlur = 0

        ctx.font      = isActive ? 'bold 8px Kanit, Arial, sans-serif' : '7px Kanit, Arial, sans-serif'
        ctx.fillStyle = isActive ? '#e8ddff' : 'rgba(215,226,234,0.55)'
        ctx.textAlign = 'center'
        ctx.fillText(isActive ? b.name : b.label, px, py - r - 3)
      }
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
  }, [radarDots, radarBodies, activeBodyKey])

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

      {/* Earth time / live-cloud chip — top-left on desktop; on phones it sits
          under the Exit button, clear of the radar column (top-left), the
          joysticks and BOOST/LAND (bottom) */}
      {cloudStatus && (
        <EarthTimeChip
          isMobile={isMobile}
          cloudStatus={cloudStatus}
          style={{
            position: 'absolute',
            ...(isMobile
              ? { top: '4.3rem', right: '1rem', display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }
              : { top: '1.5rem', left: '1.5rem' }),
          }}
        />
      )}

      {/* Landing prompt */}
      <AnimatePresence>
        {nearestPlanet && (
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

      {/* Belt notice: the local asteroid field is far denser than the real belt */}
      <AnimatePresence>
        {inBelt && (
          <motion.div
            key="belt-note"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
            style={{
              position: 'absolute', top: isMobile ? '9.5rem' : '1.5rem', left: '50%',
              transform: 'translateX(-50%)', marginTop: isMobile ? 0 : '3.2rem',
              color: 'rgba(215,226,234,0.55)', fontSize: '0.62rem', letterSpacing: '0.14em',
              textTransform: 'uppercase', whiteSpace: 'nowrap', pointerEvents: 'none',
              background: 'rgba(12,12,12,0.35)', borderRadius: '999px', padding: '0.25rem 0.8rem',
              border: '1px solid rgba(215,226,234,0.1)',
            }}
          >
            Asteroid belt · local density exaggerated
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

      {/* Radar — bottom-right on desktop, top-left on mobile */}
      <div style={{
        position: 'absolute',
        ...(isMobile ? { top: '1.5rem', left: '1rem' } : { bottom: '1.5rem', right: '1.5rem' }),
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.3rem',
      }}>
        <canvas ref={radarRef} width={RADAR_SIZE} height={RADAR_SIZE}
          style={{ display: 'block', borderRadius: '50%' }} />
        <span style={{ color: 'rgba(215,226,234,0.3)', fontSize: '0.6rem', letterSpacing: '0.1em' }}>NAV</span>

        {/* LIGHT toggle sits directly below the radar on mobile */}
        {isMobile && onToggleLight && (
          <button
            onTouchStart={onToggleLight}
            style={{
              marginTop:        '0.3rem',
              padding:          '0.4rem 1rem',
              borderRadius:     '999px',
              background:       lightOn ? 'rgba(255,255,150,0.10)' : 'rgba(255,255,255,0.03)',
              border:           lightOn
                                  ? '1px solid rgba(255,255,150,0.5)'
                                  : '1px solid rgba(215,226,234,0.12)',
              color:            lightOn ? 'rgba(255,255,150,0.85)' : 'rgba(215,226,234,0.3)',
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

          {/* BOOST + LAND — bottom-center, more transparent */}
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
                ...btnBase,
                background:  'rgba(139,92,246,0.08)',
                borderColor: 'rgba(139,92,246,0.3)',
              }}
            >BOOST</button>
            <button
              onTouchStart={() => { inputRef.current.land = true }}
              onTouchEnd={()   => { inputRef.current.land = false }}
              onTouchCancel={() => { inputRef.current.land = false }}
              style={{
                ...btnBase,
                background:  'rgba(34,197,94,0.08)',
                borderColor: 'rgba(34,197,94,0.3)',
                color:       '#86efac',
              }}
            >LAND</button>
          </div>
        </>
      )}

    </div>
  )
}
