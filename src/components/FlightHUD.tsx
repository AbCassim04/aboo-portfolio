import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft } from 'lucide-react'
import type { FlightAction, FlightInput } from '../hooks/useFlightControls'
import Joystick from './Joystick'
import EarthTimeChip from './EarthTimeChip'
import type { CloudStatus } from '../earth/liveClouds'

// Something plotted on the NAV radar: position relative to the ship in km,
// heading-up (x = right, y = ahead) in the ecliptic plane.
export interface RadarBlip {
  key: string; label: string; name: string; color: string; isSun: boolean; x: number; y: number
}

/** HUD readouts, formatted by the flight loop (src/flight/units.ts) at ~10 Hz. */
export interface HudReadout {
  mode:      'manual' | 'cruise' | 'autopilot' | 'fasttravel'
  camera:    'chase' | 'cockpit' | 'orbit'
  /** Relative speed, formatted, and what it is relative to. */
  speed:     string
  speedKmS:  number
  speedRef:  string
  /** 0..1 of the current mode's top speed. */
  speedFrac: number
  /** Distance line: label (body / target), formatted distance and light-time. */
  distLabel: string
  dist:      string
  /** Raw distance (km) and ETA (s, null = none) behind the formatted strings. */
  distKm:    number
  light:     string
  eta:       string
  etaS:      number | null
  /** Cruise held back by this body (null when not limited). */
  limitedBy: string | null
  /** Current target (name) or null; detour around this body (autopilot). */
  target:    string | null
  detour:    string | null
  /** Coasting out of a cancelled fast travel. */
  droppingOut?: boolean
}

interface FlightHUDProps {
  readout:        HudReadout
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

const MODE_LABEL: Record<HudReadout['mode'], string> = {
  manual: 'MANUAL', cruise: 'CRUISE', autopilot: 'AUTOPILOT', fasttravel: 'FAST TRAVEL',
}
const CAMERA_LABEL: Record<HudReadout['camera'], string> = { chase: 'CHASE', cockpit: 'COCKPIT', orbit: 'ORBIT' }

// Mobile layout (all sizes in px, verified at 390×844): joysticks in the
// bottom corners, one row of action buttons above them, the readout strip
// and notices above that; radar top-left, exit + time chip top-right.
const M_JOY      = 150
const M_JOY_BOT  = 12
const M_BTN_H    = 46
const M_BTN_BOT  = M_JOY_BOT + M_JOY + 10
const M_STRIP_BOT = M_BTN_BOT + M_BTN_H + 8

export default function FlightHUD({
  readout, nearestPlanet, radarDots, radarBodies, activeBodyKey, inBelt,
  onExit, inputRef, onToggleLight, lightOn, cloudStatus,
}: FlightHUDProps) {
  const [isMobile]   = useState(() => 'ontouchstart' in window || navigator.maxTouchPoints > 0)
  const [toast, setToast] = useState<string | null>(null)
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

  // Mode / camera change toasts.
  const prevMode = useRef(readout.mode)
  const prevCam  = useRef(readout.camera)
  useEffect(() => {
    let msg: string | null = null
    if (readout.mode !== prevMode.current) {
      msg = readout.mode === 'cruise' ? 'CRUISE ENGAGED' : readout.mode === 'manual' ? 'MANUAL FLIGHT' : MODE_LABEL[readout.mode]
      prevMode.current = readout.mode
    }
    if (readout.camera !== prevCam.current) {
      msg = `CAMERA · ${CAMERA_LABEL[readout.camera]}`
      prevCam.current = readout.camera
    }
    if (!msg) return
    setToast(msg)
    const id = setTimeout(() => setToast(null), 1500)
    return () => clearTimeout(id)
  }, [readout.mode, readout.camera])

  const pushAction = (a: FlightAction) => { inputRef.current.actions.push(a) }
  const orbitMode = readout.camera === 'orbit'
  const travelling = readout.mode === 'autopilot' || readout.mode === 'fasttravel'
  const cruiseLike = readout.mode !== 'manual'

  const btnBase: CSSProperties = {
    height:         `${M_BTN_H}px`,
    flex:           '1 1 0',
    minWidth:       0,
    borderRadius:   '12px',
    color:          '#c4b5fd',
    fontSize:       '0.62rem',
    fontWeight:     600,
    letterSpacing:  '0.08em',
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
    fontFamily:     'Kanit, sans-serif',
    padding:        0,
  }

  // Mouse clicks must not leave a HUD button focused (Space would re-click it).
  const keepFocus = (e: React.MouseEvent) => e.preventDefault()
  const navBtn = (on: boolean): CSSProperties => ({
    flex: '1 1 auto', height: 26, padding: '0 0.5rem', borderRadius: 8, cursor: on ? 'pointer' : 'default',
    border: `1px solid ${on ? 'rgba(125,249,255,0.4)' : 'rgba(215,226,234,0.14)'}`,
    background: on ? 'rgba(125,249,255,0.08)' : 'rgba(255,255,255,0.03)',
    color: on ? '#bff9ff' : 'rgba(215,226,234,0.55)', fontSize: '0.6rem', letterSpacing: '0.1em',
    fontFamily: 'Kanit, sans-serif', whiteSpace: 'nowrap',
  })

  // ── Readout block (desktop panel / mobile strip) ──
  const modeColor = readout.mode === 'manual' ? '#c4b5fd' : '#7df9ff'
  const readoutDesktop = (
    <div data-hud="readout" style={{
      position: 'absolute', bottom: '1.5rem', left: '50%', transform: 'translateX(-50%)',
      minWidth: '17rem', padding: '0.6rem 0.9rem', borderRadius: '12px',
      background: 'rgba(12,12,12,0.5)', backdropFilter: 'blur(8px)', border: '1px solid rgba(215,226,234,0.1)',
      color: '#D7E2EA', fontFamily: 'Kanit, sans-serif', fontSize: '0.68rem', letterSpacing: '0.06em',
      display: 'flex', flexDirection: 'column', gap: '0.3rem', pointerEvents: 'none',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
        <span data-hud="mode" style={{ color: modeColor, letterSpacing: '0.18em', fontWeight: 600 }}>{MODE_LABEL[readout.mode]}</span>
        <span data-hud="camera" style={{ opacity: 0.45, letterSpacing: '0.14em' }}>CAM {CAMERA_LABEL[readout.camera]}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
        <span data-hud="speed" style={{ fontSize: '1.05rem', fontWeight: 500, letterSpacing: '0.02em' }}>{readout.speed}</span>
        <span style={{ opacity: 0.45 }}>rel. {readout.speedRef}</span>
      </div>
      <div style={{ width: '100%', height: '3px', background: 'rgba(215,226,234,0.1)', borderRadius: '999px', overflow: 'hidden' }}>
        <div style={{
          width: `${Math.round(readout.speedFrac * 100)}%`, height: '100%', borderRadius: '999px',
          background: cruiseLike ? 'linear-gradient(90deg, #3B8BD4, #7df9ff)' : 'linear-gradient(90deg, #7721B1, #3B8BD4)',
          transition: 'width 0.1s ease',
        }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
        <span><span style={{ opacity: 0.55 }}>{readout.distLabel}</span> <span data-hud="dist">{readout.dist}</span></span>
        <span data-hud="light" style={{ opacity: 0.45 }}>{readout.light}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
        <span><span style={{ opacity: 0.55 }}>ETA</span> <span data-hud="eta">{readout.eta}</span></span>
        {readout.limitedBy && (
          <span data-hud="limited" style={{ color: '#fbbf24', opacity: 0.85 }}>◆ slowed near {readout.limitedBy}</span>
        )}
        {readout.detour && (
          <span data-hud="detour" style={{ color: '#7df9ff', opacity: 0.8 }}>↷ around {readout.detour}</span>
        )}
      </div>
      <div style={{ display: 'flex', gap: '0.35rem', marginTop: '0.2rem', pointerEvents: 'auto' }}>
        <button data-hud="d-prev" onMouseDown={keepFocus} onClick={() => pushAction('prev')} title="Previous target ([)" style={{ ...navBtn(false), flex: '0 0 2.2rem' }}>◀</button>
        <span data-hud="target" style={{ flex: 1, alignSelf: 'center', textAlign: 'center', color: readout.target ? '#bff9ff' : 'rgba(215,226,234,0.4)', letterSpacing: '0.12em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {readout.target ? `◎ ${readout.target.toUpperCase()}` : 'NO TARGET'}
        </span>
        <button data-hud="d-next" onMouseDown={keepFocus} onClick={() => pushAction('next')} title="Next target (] or T)" style={{ ...navBtn(false), flex: '0 0 2.2rem' }}>▶</button>
      </div>
      <div style={{ display: 'flex', gap: '0.35rem', pointerEvents: 'auto' }}>
        <button data-hud="d-map" onMouseDown={keepFocus} onClick={() => pushAction('map')} style={navBtn(false)}>MAP · M</button>
        {travelling ? (
          <button data-hud="d-cancel" onMouseDown={keepFocus} onClick={() => pushAction('cancel')} style={{ ...navBtn(true), borderColor: 'rgba(248,113,113,0.6)', color: '#fecaca', background: 'rgba(248,113,113,0.12)' }}>CANCEL · ESC</button>
        ) : (
          <>
            <button data-hud="d-ap" onMouseDown={keepFocus} disabled={!readout.target} onClick={() => pushAction('autopilot')} style={navBtn(!!readout.target)}>AUTOPILOT · P</button>
            <button data-hud="d-jump" onMouseDown={keepFocus} disabled={!readout.target} onClick={() => pushAction('jump')} style={navBtn(!!readout.target)}>JUMP · J</button>
          </>
        )}
      </div>
    </div>
  )

  const readoutMobile = (
    <div data-hud="readout" style={{
      position: 'absolute', bottom: `${M_STRIP_BOT}px`, left: '50%', transform: 'translateX(-50%)',
      width: 'calc(100% - 24px)', maxWidth: '360px', padding: '0.35rem 0.6rem', borderRadius: '10px',
      background: 'rgba(12,12,12,0.5)', backdropFilter: 'blur(8px)', border: '1px solid rgba(215,226,234,0.1)',
      color: '#D7E2EA', fontFamily: 'Kanit, sans-serif', fontSize: '0.6rem', letterSpacing: '0.05em',
      display: 'flex', flexDirection: 'column', gap: '0.15rem', pointerEvents: 'none', boxSizing: 'border-box',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', whiteSpace: 'nowrap' }}>
        <span data-hud="mode" style={{ color: modeColor, fontWeight: 600, letterSpacing: '0.14em' }}>{MODE_LABEL[readout.mode]}</span>
        <span><span data-hud="speed" style={{ fontWeight: 500 }}>{readout.speed}</span> <span style={{ opacity: 0.45 }}>rel. {readout.speedRef}</span></span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', whiteSpace: 'nowrap' }}>
        <span><span style={{ opacity: 0.55 }}>{readout.distLabel}</span> <span data-hud="dist">{readout.dist}</span> <span data-hud="light" style={{ opacity: 0.45 }}>{readout.light}</span></span>
        <span><span style={{ opacity: 0.55 }}>ETA</span> <span data-hud="eta">{readout.eta}</span></span>
      </div>
      {readout.limitedBy && (
        <div data-hud="limited" style={{ color: '#fbbf24', opacity: 0.85 }}>◆ cruise slowed near {readout.limitedBy}</div>
      )}
    </div>
  )

  // Notices: desktop at the top centre; mobile stacked above the readout strip.
  const notices: ReactNode[] = []
  if (toast) notices.push(
    <motion.div key={'toast-' + toast} data-hud="toast" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }} style={{
        background: 'rgba(139,92,246,0.2)', border: '1px solid rgba(139,92,246,0.8)', borderRadius: '8px',
        padding: '0.35rem 1rem', color: '#c4b5fd', fontSize: '0.7rem', letterSpacing: '0.28em',
        boxShadow: '0 0 20px rgba(139,92,246,0.45)', whiteSpace: 'nowrap',
      }}>{toast}</motion.div>,
  )
  if (readout.mode === 'fasttravel' && readout.target) notices.push(
    <motion.div key="ft-note" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}
      data-hud="ft-note" style={{
        color: '#bff9ff', fontSize: '0.66rem', letterSpacing: '0.2em', whiteSpace: 'nowrap',
        background: 'rgba(8,24,32,0.55)', border: '1px solid rgba(125,249,255,0.45)', borderRadius: 999, padding: '0.3rem 0.9rem',
      }}>
      {readout.droppingOut ? 'DROPPING OUT OF FAST TRAVEL' : <>FAST TRAVEL → {readout.target.toUpperCase()} · {readout.eta}{isMobile ? '' : ' · ESC to cancel'}</>}
    </motion.div>,
  )
  if (nearestPlanet) notices.push(
    <motion.div key="landing" data-hud="landing" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.3 }} style={{
        background: 'rgba(119,33,177,0.15)', backdropFilter: 'blur(12px)', border: '1px solid rgba(119,33,177,0.4)',
        borderRadius: '12px', padding: isMobile ? '0.4rem 0.9rem' : '0.6rem 1.2rem', color: '#D7E2EA',
        fontSize: isMobile ? '0.7rem' : '0.8rem', textAlign: 'center', whiteSpace: 'nowrap',
      }}>
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
    </motion.div>,
  )
  if (inBelt) notices.push(
    <motion.div key="belt-note" data-hud="belt-note" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }} style={{
        color: 'rgba(215,226,234,0.55)', fontSize: '0.62rem', letterSpacing: '0.14em', textTransform: 'uppercase',
        whiteSpace: 'nowrap', background: 'rgba(12,12,12,0.35)', borderRadius: '999px', padding: '0.25rem 0.8rem',
        border: '1px solid rgba(215,226,234,0.1)',
      }}>
      Asteroid belt · local density exaggerated
    </motion.div>,
  )

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 20, pointerEvents: 'none' }}>

      {/* Exit */}
      <div style={{ position: 'absolute', top: '1.5rem', right: isMobile ? '1rem' : '1.5rem', pointerEvents: 'auto' }}>
        <motion.button
          data-hud="exit"
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
          under the Exit button, clear of the radar column (top-left) */}
      {cloudStatus && (
        <div data-hud="time-chip" style={{
          position: 'absolute',
          ...(isMobile ? { top: '4.3rem', right: '1rem' } : { top: '1.5rem', left: '1.5rem' }),
        }}>
          <EarthTimeChip
            isMobile={isMobile}
            cloudStatus={cloudStatus}
            style={isMobile ? { display: 'flex', flexDirection: 'column', alignItems: 'flex-end' } : {}}
          />
        </div>
      )}

      {/* Notices */}
      <div style={{
        position: 'absolute', left: '50%', transform: 'translateX(-50%)',
        ...(isMobile ? { bottom: `${M_STRIP_BOT + 72}px` } : { top: '1.5rem' }),
        display: 'flex', flexDirection: isMobile ? 'column-reverse' : 'column', alignItems: 'center', gap: '0.4rem',
      }}>
        <AnimatePresence>{notices}</AnimatePresence>
      </div>

      {/* Cockpit reticle */}
      {readout.camera === 'cockpit' && (
        <svg width="44" height="44" viewBox="-22 -22 44 44" style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', opacity: 0.55 }}>
          <circle r="9" fill="none" stroke="#c4b5fd" strokeWidth="1" />
          <path d="M -20 0 L -13 0 M 13 0 L 20 0 M 0 -20 L 0 -13 M 0 13 L 0 20" stroke="#c4b5fd" strokeWidth="1" />
          <circle r="1.2" fill="#e8ddff" />
        </svg>
      )}

      {/* Readouts */}
      {isMobile ? readoutMobile : readoutDesktop}

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
            ['SHIFT / CTRL', 'up / down'],
            ['SPACE',        'cruise ↔ manual'],
            ['M',            'system map'],
            ['T  [ ]',       'next / previous target'],
            ['P',            'autopilot to target'],
            ['J',            'fast travel to target'],
            ['ESC',          'cancel autopilot / jump'],
            ['C',            'camera (chase / cockpit / orbit)'],
            ['DRAG',         'orbit camera (orbit mode)'],
            ['F',            'land'],
            ['L',            'headlight'],
          ] as [string, string][]).map(([key, desc]) => (
            <div key={key} style={{ display: 'flex', gap: '0.75rem', justifyContent: 'space-between', lineHeight: 1.75 }}>
              <span style={{ color: 'rgba(215,226,234,0.8)', fontSize: '0.68rem', fontFamily: 'monospace', minWidth: '5.5rem' }}>{key}</span>
              <span style={{ color: 'rgba(215,226,234,0.4)', fontSize: '0.68rem' }}>{desc}</span>
            </div>
          ))}
        </div>
      )}

      {/* Radar — bottom-right on desktop, top-left on mobile */}
      <div data-hud="radar" style={{
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
            data-hud="btn-light"
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
          <div data-hud="joy-left" style={{
            position: 'absolute', bottom: `${M_JOY_BOT}px`, left: '6px',
            pointerEvents: 'auto',
          }}>
            <Joystick
              id="left-joystick"
              size={M_JOY}
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

          {/* Right joystick — up / down; orbits the camera in ORBIT mode */}
          <div data-hud="joy-right" style={{
            position: 'absolute', bottom: `${M_JOY_BOT}px`, right: '6px',
            pointerEvents: 'auto',
          }}>
            <Joystick
              id="right-joystick"
              size={M_JOY}
              onMove={(x, y) => {
                if (orbitMode) { inputRef.current.orbitX = x; inputRef.current.orbitY = y; inputRef.current.vertical = 0 }
                else { inputRef.current.vertical = y; inputRef.current.orbitX = 0; inputRef.current.orbitY = 0 }
              }}
              onEnd={() => {
                inputRef.current.vertical = 0
                inputRef.current.orbitX = 0
                inputRef.current.orbitY = 0
              }}
            />
            <div style={{ position: 'absolute', top: '-0.9rem', width: '100%', textAlign: 'center', color: 'rgba(215,226,234,0.35)', fontSize: '0.5rem', letterSpacing: '0.14em', fontFamily: 'Kanit, sans-serif' }}>
              {orbitMode ? 'ORBIT CAM' : 'UP / DOWN'}
            </div>
          </div>

          {/* Action row — above the joysticks */}
          <div data-hud="action-row" style={{
            position:  'absolute',
            bottom:    `${M_BTN_BOT}px`,
            left:      '12px',
            right:     '12px',
            display:   'flex',
            gap:       '8px',
            zIndex:    100,
          }}>
            <button
              data-hud="btn-cruise"
              onTouchStart={() => pushAction('cruise')}
              style={{
                ...btnBase,
                background:  readout.mode === 'cruise' ? 'rgba(125,249,255,0.16)' : 'rgba(139,92,246,0.08)',
                borderColor: readout.mode === 'cruise' ? 'rgba(125,249,255,0.6)' : 'rgba(139,92,246,0.3)',
                color:       readout.mode === 'cruise' ? '#bff9ff' : '#c4b5fd',
              }}
            >CRUISE</button>
            <button
              data-hud="btn-land"
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
            <button
              data-hud="btn-cam"
              onTouchStart={() => pushAction('camera')}
              style={{ ...btnBase, background: 'rgba(59,139,212,0.08)', borderColor: 'rgba(59,139,212,0.35)', color: '#9cc6ff' }}
            >CAM</button>
            <button
              data-hud="btn-map"
              onTouchStart={() => pushAction('map')}
              style={{ ...btnBase, background: 'rgba(255,204,51,0.07)', borderColor: 'rgba(255,204,51,0.35)', color: '#ffe08a' }}
            >MAP</button>
            <button
              data-hud="btn-ap"
              onTouchStart={() => pushAction(travelling ? 'cancel' : readout.target ? 'autopilot' : 'map')}
              style={{
                ...btnBase,
                background:  travelling ? 'rgba(248,113,113,0.12)' : 'rgba(125,249,255,0.07)',
                borderColor: travelling ? 'rgba(248,113,113,0.55)' : 'rgba(125,249,255,0.35)',
                color:       travelling ? '#fecaca' : '#bff9ff',
              }}
            >{travelling ? 'STOP' : 'AUTO'}</button>
          </div>
        </>
      )}

    </div>
  )
}
