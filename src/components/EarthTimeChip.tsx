import { useEffect, useState, useSyncExternalStore } from 'react'
import type { CSSProperties } from 'react'
import {
  getSimClockState, getSimTimeMs, goLive, setSpeed, subscribeSimClock, togglePause,
} from '../sim/simClock'
import { createMoonResult, moonPhaseName, moonPosition } from '../earth/astro'
import type { CloudStatus } from '../earth/liveClouds'

// Small HUD chip: sim time / LIVE badge, time controls, cloud data age and
// credits for whichever live sources were actually used.

const SPEEDS = [60, 3600, 86400] as const

const fmtUtc = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric',
  hour: '2-digit', minute: '2-digit', hour12: false,
})
const fmtUtcShort = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
})

function formatAge(ms: number): string {
  if (!Number.isFinite(ms)) return '?'
  const min = Math.max(0, Math.round(ms / 60000))
  if (min < 60)  return `${min} min ago`
  const h = Math.round(min / 60)
  if (h < 48)    return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

function speedLabel(s: number): string {
  return s === 86400 ? '×86400' : s === 3600 ? '×3600' : s === 60 ? '×60' : `×${s}`
}

const moonState = createMoonResult()

interface Props {
  isMobile:    boolean
  cloudStatus: CloudStatus
  style?:      CSSProperties
}

export default function EarthTimeChip({ isMobile, cloudStatus, style }: Props) {
  const clock = useSyncExternalStore(subscribeSimClock, getSimClockState)
  const [open, setOpen] = useState(false)
  const [tick, setTick] = useState(() => ({ sim: getSimTimeMs(), real: Date.now() }))

  // Re-read the clock on a timer (faster while time is fast-forwarding).
  useEffect(() => {
    const ms = clock.live || clock.paused ? 1000 : 250
    const id = setInterval(() => setTick({ sim: getSimTimeMs(), real: Date.now() }), ms)
    return () => clearInterval(id)
  }, [clock])

  const simMs  = tick.sim
  const realMs = tick.real
  // Apply a control change and refresh the display without waiting a tick.
  const act = (fn: () => void) => () => { fn(); setTick({ sim: getSimTimeMs(), real: Date.now() }) }

  let cloudsShort = ''
  let cloudsLong  = ''
  let credits: string[] = []
  switch (cloudStatus.kind) {
    case 'loading':
      cloudsShort = 'clouds…'
      cloudsLong  = 'Clouds: loading'
      break
    case 'live': {
      const age   = formatAge(realMs - cloudStatus.dataTimeMs)
      cloudsShort = `clouds ${age}`
      cloudsLong  = clock.live
        ? `Clouds: satellite composite, ${age}${cloudStatus.previous ? ' (last good build)' : ''}`
        : `Clouds as of last update: ${fmtUtcShort.format(cloudStatus.dataTimeMs)} UTC (${age})`
      credits = cloudStatus.attribution
      break
    }
    case 'static':
      cloudsShort = 'clouds: static'
      cloudsLong  = 'Clouds: static map (live data unavailable)'
      break
    case 'none':
      cloudsShort = ''
      cloudsLong  = 'Clouds: unavailable'
  }

  moonPosition(simMs, moonState)
  const moonLine = `Moon: ${moonPhaseName(moonState.phase)}, ${Math.round(moonState.illumination * 100)}% lit`

  const badge = clock.live
    ? 'LIVE'
    : `${clock.paused ? '❚❚' : speedLabel(clock.speed)} ${fmtUtcShort.format(simMs)} UTC`

  const keepFocus = (e: React.MouseEvent) => e.preventDefault()   // Space stays "boost"

  const btn = (active: boolean): CSSProperties => ({
    flex:          '1 1 0',
    padding:       isMobile ? '0.45rem 0' : '0.3rem 0',
    borderRadius:  '6px',
    border:        `1px solid ${active ? 'rgba(125,249,255,0.55)' : 'rgba(215,226,234,0.14)'}`,
    background:    active ? 'rgba(125,249,255,0.10)' : 'rgba(255,255,255,0.03)',
    color:         active ? '#bff9ff' : 'rgba(215,226,234,0.75)',
    fontSize:      '0.6rem',
    letterSpacing: isMobile ? '0.02em' : '0.06em',
    fontFamily:    'inherit',
    cursor:        'pointer',
    touchAction:   'manipulation',
    minWidth:      0,
  })

  return (
    <div style={{ pointerEvents: 'auto', fontFamily: 'Kanit, Arial, sans-serif', ...style }}>
      <button
        type="button"
        onMouseDown={keepFocus}
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-label="Earth time and live cloud data"
        style={{
          display: 'flex', alignItems: 'center', gap: '0.45rem',
          padding: '0.32rem 0.7rem',
          borderRadius: '999px',
          border: '1px solid rgba(215,226,234,0.16)',
          background: 'rgba(12,12,12,0.5)',
          backdropFilter: 'blur(8px)',
          color: '#D7E2EA',
          fontSize: '0.62rem',
          letterSpacing: '0.08em',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          touchAction: 'manipulation',
          fontFamily: 'inherit',
          marginLeft: isMobile ? 'auto' : undefined,
        }}
      >
        <span style={{
          width: 6, height: 6, borderRadius: '50%', flex: '0 0 auto',
          background: clock.live ? '#4ade80' : clock.paused ? '#fbbf24' : '#7df9ff',
          boxShadow: clock.live ? '0 0 6px #4ade80' : 'none',
        }} />
        <span>{badge}</span>
        {cloudsShort && <span style={{ opacity: 0.5 }}>· {cloudsShort}</span>}
      </button>

      {open && (
        <div style={{
          marginTop: '0.35rem',
          width: isMobile ? '14.5rem' : '17rem',   // phones: clears the NAV radar on the left
          marginLeft: isMobile ? 'auto' : undefined,
          padding: '0.6rem 0.7rem',
          borderRadius: '10px',
          border: '1px solid rgba(215,226,234,0.12)',
          background: 'rgba(12,12,12,0.72)',
          backdropFilter: 'blur(10px)',
          color: 'rgba(215,226,234,0.8)',
          fontSize: '0.62rem',
          lineHeight: 1.5,
        }}>
          <div style={{ color: '#D7E2EA', letterSpacing: '0.04em' }}>
            {fmtUtc.format(simMs)} UTC
            {!clock.live && <span style={{ opacity: 0.55 }}> · {clock.paused ? 'paused' : speedLabel(clock.speed)}</span>}
          </div>

          <div style={{ display: 'flex', gap: '0.3rem', margin: '0.45rem 0' }}>
            <button type="button" onMouseDown={keepFocus} onClick={act(goLive)} style={btn(clock.live)}>LIVE</button>
            {SPEEDS.map(s => (
              <button key={s} type="button" onMouseDown={keepFocus} onClick={act(() => setSpeed(s))}
                style={btn(!clock.live && !clock.paused && clock.speed === s)}>
                {speedLabel(s)}
              </button>
            ))}
            <button type="button" onMouseDown={keepFocus} onClick={act(togglePause)}
              aria-label={clock.paused ? 'Resume' : 'Pause'} style={btn(clock.paused)}>
              {clock.paused ? '▶' : '❚❚'}
            </button>
          </div>

          <div>{cloudsLong}</div>
          <div style={{ opacity: 0.7 }}>{moonLine}</div>
          {credits.length > 0 && (
            <div style={{ marginTop: '0.3rem', opacity: 0.45, fontSize: '0.56rem' }}>
              Imagery: {credits.join(' · ')}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
