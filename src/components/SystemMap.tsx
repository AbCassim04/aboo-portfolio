import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { CSSProperties } from 'react'
import * as THREE from 'three'
import { X, RotateCcw } from 'lucide-react'
import { AU_KM, centuriesTT, createElements, elementsAt, orbitPointAtE } from '../space/ephemeris'
import type { PlanetId } from '../space/ephemeris'
import { NAV_BY_ID } from '../flight/navRegistry'
import { MAP_ITEMS } from '../flight/navUi'
import type { MapData, MapDebug } from '../flight/navUi'
import { getSimClockState, getSimTimeMs, goLive, setSpeed, subscribeSimClock, togglePause } from '../sim/simClock'

// ── System map ─────────────────────────────────────────────────────────────
// Sun-centred overlay: every planet at its current sim-time position on its
// real osculating ellipse (inclination included — the view is tilted so it
// shows), the belt zone, the Moon's orbit and the portfolio zone around
// Earth, the ship and its direction of motion. Radial distances are
// log-scaled (directions preserved) so Mercury and Neptune are both
// tappable. Pan (drag), zoom (wheel / pinch), time controls in the footer.
//
// Tappable items are DOM buttons ("chips") placed every frame by a greedy
// collision-free layout around their anchor dots (leader lines when moved
// away), so nothing overlaps at any size. Tapping one opens its info card
// with Fast travel / Autopilot / Set target.

const PLANETS: PlanetId[] = ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune']
const ITEM_LABEL: Record<string, string> = {
  sun: 'Sun', mercury: 'Mercury', venus: 'Venus', earth: 'Earth', moon: 'Moon', zone: 'Portfolio',
  mars: 'Mars', belt: 'Asteroid belt', jupiter: 'Jupiter', saturn: 'Saturn', uranus: 'Uranus', neptune: 'Neptune',
}
const DOT_R: Record<string, number> = { sun: 7, jupiter: 5, saturn: 5, earth: 4.5, uranus: 4, neptune: 4, venus: 4, mars: 3.5, mercury: 3, moon: 2.5, zone: 3, belt: 0 }

// Log radial scale: L(r) = log10(1 + r/R0) / log10(1 + RMAX/R0), 0..1.
const R0   = 0.1 * AU_KM
const RMAX = 32 * AU_KM
const LNORM = Math.log10(1 + RMAX / R0)
const L = (r: number) => Math.log10(1 + r / R0) / LNORM
const TILT = 0.5                       // rad: view elevation 90° − 29°
const CT = Math.cos(TILT), ST = Math.sin(TILT)
const HEADER = 54
const FOOTER_D = 64
const FOOTER_M = 104

const SPEEDS = [60, 3600, 86400] as const
const speedLabel = (s: number) => (s === 86400 ? '×86400' : s === 3600 ? '×3600' : s === 60 ? '×60' : `×${s}`)
const fmtUtc = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })

interface Props {
  open:      boolean
  isMobile:  boolean
  dataRef:   React.MutableRefObject<MapData>
  debugRef:  React.MutableRefObject<MapDebug | null>
  onClose:   () => void
  onSelect:  (id: string) => void
}

interface View { zoom: number; panX: number; panY: number }

function TimeRow({ isMobile }: { isMobile: boolean }) {
  const clock = useSyncExternalStore(subscribeSimClock, getSimClockState)
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), clock.live || clock.paused ? 1000 : 250)
    return () => clearInterval(id)
  }, [clock])
  const btn = (active: boolean): CSSProperties => ({
    flex: '1 1 0', minWidth: 0, height: isMobile ? 36 : 30, borderRadius: 8,
    border: `1px solid ${active ? 'rgba(125,249,255,0.55)' : 'rgba(215,226,234,0.16)'}`,
    background: active ? 'rgba(125,249,255,0.12)' : 'rgba(255,255,255,0.04)',
    color: active ? '#bff9ff' : 'rgba(215,226,234,0.8)', fontSize: '0.66rem', fontFamily: 'inherit', cursor: 'pointer',
    touchAction: 'manipulation',
  })
  return (
    <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? 6 : 12, alignItems: isMobile ? 'stretch' : 'center', width: '100%' }}>
      <div style={{ color: '#D7E2EA', fontSize: '0.7rem', letterSpacing: '0.05em', whiteSpace: 'nowrap', textAlign: isMobile ? 'center' : 'left' }}>
        {fmtUtc.format(getSimTimeMs())} UTC{!clock.live && <span style={{ opacity: 0.55 }}> · {clock.paused ? 'paused' : speedLabel(clock.speed)}</span>}
      </div>
      <div style={{ display: 'flex', gap: 6, flex: 1 }}>
        <button type="button" data-map="time-live" onClick={goLive} style={btn(clock.live)}>LIVE</button>
        {SPEEDS.map(s => (
          <button key={s} type="button" data-map={`time-${s}`} onClick={() => setSpeed(s)} style={btn(!clock.live && !clock.paused && clock.speed === s)}>{speedLabel(s)}</button>
        ))}
        <button type="button" data-map="time-pause" onClick={togglePause} aria-label={clock.paused ? 'Resume' : 'Pause'} style={btn(clock.paused)}>{clock.paused ? '▶' : '❚❚'}</button>
      </div>
    </div>
  )
}

export default function SystemMap({ open, isMobile, dataRef, debugRef, onClose, onSelect }: Props) {
  const rootRef   = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const chipRefs  = useRef<Record<string, HTMLButtonElement | null>>({})
  const viewRef   = useRef<View>({ zoom: 1, panX: 0, panY: 0 })

  // ── Render loop (only while open) ──
  useEffect(() => {
    if (!open) { debugRef.current = null; return }
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const el = createElements()
    const orbitPts: Record<string, THREE.Vector3[]> = {}
    let orbitsMs = NaN
    const tmp = new THREE.Vector3()
    let beltAngle: number | null = null
    let raf = 0

    const recomputeOrbits = (simMs: number) => {
      const T = centuriesTT(simMs)
      for (const id of PLANETS) {
        elementsAt(id, T, el)
        const pts: THREE.Vector3[] = []
        for (let i = 0; i < 160; i++) {
          orbitPointAtE(el, (i / 160) * Math.PI * 2, AU_KM, tmp)
          const r = tmp.length()
          pts.push(tmp.clone().multiplyScalar(L(r) / r))
        }
        orbitPts[id] = pts
      }
      orbitsMs = simMs
    }

    const draw = () => {
      raf = requestAnimationFrame(draw)
      const d = dataRef.current
      const W = window.innerWidth, H = window.innerHeight
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
        canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr)
      }
      if (!(Math.abs(d.simMs - orbitsMs) < 86_400_000)) recomputeOrbits(d.simMs)
      const footer = isMobile ? FOOTER_M : FOOTER_D
      const top = HEADER, bottom = H - footer
      const v = viewRef.current
      const S  = 0.47 * Math.min(W, bottom - top) * v.zoom
      const cx = W / 2 + v.panX, cy = (top + bottom) / 2 + v.panY
      const map = (m: THREE.Vector3): [number, number] => [cx + m.x * S, cy + (m.z * CT - m.y * ST) * S]
      const proj = (w: THREE.Vector3): [number, number] => {
        const r = w.length()
        if (r < 1) return [cx, cy]
        tmp.copy(w).multiplyScalar(L(r) / r)
        return map(tmp)
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, W, H)

      // Belt band.
      const r1 = L(2.2 * AU_KM) * S, r2 = L(3.3 * AU_KM) * S
      ctx.beginPath()
      ctx.ellipse(cx, cy, r2, r2 * CT, 0, 0, Math.PI * 2)
      ctx.ellipse(cx, cy, r1, r1 * CT, 0, 0, Math.PI * 2, true)
      ctx.fillStyle = 'rgba(185,160,122,0.10)'
      ctx.fill()

      // Orbits.
      ctx.lineWidth = 1
      for (const id of PLANETS) {
        const pts = orbitPts[id]
        ctx.beginPath()
        for (let i = 0; i <= pts.length; i++) {
          const [x, y] = map(pts[i % pts.length])
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
        }
        ctx.strokeStyle = 'rgba(215,226,234,0.16)'
        ctx.stroke()
      }

      // Anchors.
      const anchors: Record<string, [number, number]> = {}
      for (const id of ['sun', ...PLANETS]) anchors[id] = proj(d.pos[id])
      const [ex, ey] = anchors.earth
      const moonPx = Math.min(44, Math.max(16, 0.07 * S))
      tmp.subVectors(d.pos.moon, d.pos.earth).normalize()
      anchors.moon = [ex + tmp.x * moonPx, ey + (tmp.z * CT - tmp.y * ST) * moonPx]
      const zv = d.zoneDir
      anchors.zone = [ex + zv.x * moonPx * 0.55, ey + (zv.z * CT - zv.y * ST) * moonPx * 0.55]
      // Belt anchor: on the band, at the angle farthest from the other anchors (fixed while open).
      const rb = L(2.75 * AU_KM) * S
      if (beltAngle === null) {
        let best = -1
        for (let k = 0; k < 32; k++) {
          const a = (k / 32) * Math.PI * 2
          const bx = cx + Math.cos(a) * rb, by = cy + Math.sin(a) * rb * CT
          let m = Infinity
          for (const id of Object.keys(anchors)) m = Math.min(m, Math.hypot(anchors[id][0] - bx, anchors[id][1] - by))
          if (m > best) { best = m; beltAngle = a }
        }
      }
      anchors.belt = [cx + Math.cos(beltAngle!) * rb, cy + Math.sin(beltAngle!) * rb * CT]

      // Moon orbit and zone.
      ctx.beginPath(); ctx.ellipse(ex, ey, moonPx, moonPx * CT, 0, 0, Math.PI * 2)
      ctx.strokeStyle = 'rgba(216,212,204,0.28)'; ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([])

      // Dots.
      for (const id of MAP_ITEMS) {
        const r = DOT_R[id]
        if (!r) continue
        const [x, y] = anchors[id]
        const c = NAV_BY_ID[id]?.color ?? '#ccc'
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2)
        ctx.fillStyle = c
        if (id === 'sun') { ctx.shadowColor = '#ffcc33'; ctx.shadowBlur = 14 }
        ctx.fill(); ctx.shadowBlur = 0
        if (id === 'saturn') { ctx.beginPath(); ctx.ellipse(x, y, r * 2.1, r * 0.8, -0.3, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(230,205,143,0.7)'; ctx.stroke() }
      }
      if (d.targetId && anchors[d.targetId]) {
        const [x, y] = anchors[d.targetId]
        ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI * 2)
        ctx.strokeStyle = 'rgba(125,249,255,0.85)'; ctx.lineWidth = 1.5; ctx.stroke(); ctx.lineWidth = 1
      }

      // Ship: local log placement near Earth (same scale as the Moon), else heliocentric.
      tmp.subVectors(d.ship, d.pos.earth)
      const de = tmp.length()
      let sx: number, sy: number
      if (de < 2.5e6) {
        const k = moonPx * Math.min(1.6, Math.log10(1 + de / 1000) / Math.log10(1 + 384_400 / 1000)) / Math.max(de, 1e-9)
        sx = ex + tmp.x * k; sy = ey + (tmp.z * CT - tmp.y * ST) * k
      } else {
        ;[sx, sy] = proj(d.ship)
      }
      const vv = d.shipVel
      let ang = -Math.PI / 2
      const vxs = vv.x, vys = vv.z * CT - vv.y * ST
      if (Math.hypot(vxs, vys) > 1e-9) ang = Math.atan2(vys, vxs)
      ctx.save(); ctx.translate(sx, sy); ctx.rotate(ang)
      ctx.beginPath(); ctx.moveTo(7, 0); ctx.lineTo(-5, -4.5); ctx.lineTo(-2.5, 0); ctx.lineTo(-5, 4.5); ctx.closePath()
      ctx.fillStyle = '#7df9ff'; ctx.shadowColor = '#7df9ff'; ctx.shadowBlur = 8; ctx.fill(); ctx.shadowBlur = 0
      if (Math.hypot(vxs, vys) > 1e-9) { ctx.beginPath(); ctx.moveTo(9, 0); ctx.lineTo(24, 0); ctx.strokeStyle = 'rgba(125,249,255,0.6)'; ctx.stroke() }
      ctx.restore()

      // ── Chip layout (greedy, collision-free) ──
      const placed: { x: number; y: number; w: number; h: number }[] = []
      const dbgItems: MapDebug['items'] = []
      const bounds = { x0: 6, y0: top + 4, x1: W - 6, y1: bottom - 4 }
      const dotRects = MAP_ITEMS.filter(id => DOT_R[id] > 0).map(id => ({ id, x: anchors[id][0] - 7, y: anchors[id][1] - 7, w: 14, h: 14 }))
      const ov = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }, gap = 3) =>
        Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) + gap) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) + gap)
      const radii = [10, 22, 38, 58, 82, 110, 145]
      const angles = [0, 180, -40, 40, -90, 90, -140, 140, -20, 20, -160, 160, -65, 65, -115, 115].map(a => a * Math.PI / 180)
      for (const id of MAP_ITEMS) {
        const chip = chipRefs.current[id]
        if (!chip) continue
        const w = chip.offsetWidth, h = chip.offsetHeight
        const [ax, ay] = anchors[id]
        let best: { x: number; y: number; cost: number } | null = null
        for (const rr of radii) {
          for (const a of angles) {
            const x = ax + Math.cos(a) * (rr + w / 2) - w / 2
            const y = ay + Math.sin(a) * (rr + h / 2) - h / 2
            const r = { x, y, w, h }
            let cost = 0
            if (x < bounds.x0 || y < bounds.y0 || x + w > bounds.x1 || y + h > bounds.y1) cost += 1e6
            for (const p of placed) cost += ov(r, p) * 10
            for (const dr of dotRects) if (dr.id !== id) cost += ov(r, dr, 2)
            if (!best || cost < best.cost) best = { x, y, cost }
            if (cost === 0) break
          }
          if (best && best.cost === 0) break
        }
        const b = best!
        placed.push({ x: b.x, y: b.y, w, h })
        chip.style.transform = `translate(${b.x.toFixed(1)}px, ${b.y.toFixed(1)}px)`
        // Leader line from the anchor to the chip's nearest point.
        const nx = Math.max(b.x, Math.min(ax, b.x + w)), ny = Math.max(b.y, Math.min(ay, b.y + h))
        if (Math.hypot(nx - ax, ny - ay) > 6) {
          ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(nx, ny)
          ctx.strokeStyle = 'rgba(196,181,253,0.35)'; ctx.stroke()
        }
        dbgItems.push({ id, anchor: [ax, ay], rect: [b.x, b.y, w, h], clear: b.cost === 0 })
      }
      debugRef.current = { open: true, width: W, height: H, zoom: v.zoom, items: dbgItems }
    }
    draw()
    return () => cancelAnimationFrame(raf)
  }, [open, isMobile, dataRef, debugRef])

  // ── Pan / zoom ──
  useEffect(() => {
    if (!open) return
    const canvas = canvasRef.current
    if (!canvas) return
    const pts = new Map<number, { x: number; y: number }>()
    let pinchD = 0
    const onDown = (e: PointerEvent) => { pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); canvas.setPointerCapture(e.pointerId); if (pts.size === 2) { const [a, b] = [...pts.values()]; pinchD = Math.hypot(a.x - b.x, a.y - b.y) } }
    const onMove = (e: PointerEvent) => {
      const p = pts.get(e.pointerId)
      if (!p) return
      const v = viewRef.current
      if (pts.size === 1) { v.panX += e.clientX - p.x; v.panY += e.clientY - p.y }
      p.x = e.clientX; p.y = e.clientY
      if (pts.size === 2) {
        const [a, b] = [...pts.values()]
        const dd = Math.hypot(a.x - b.x, a.y - b.y)
        if (pinchD > 0) zoomAbout((a.x + b.x) / 2, (a.y + b.y) / 2, dd / pinchD)
        pinchD = dd
      }
    }
    const onUp = (e: PointerEvent) => { pts.delete(e.pointerId); pinchD = 0 }
    const zoomAbout = (x: number, y: number, f: number) => {
      const v = viewRef.current
      const z = Math.min(12, Math.max(0.6, v.zoom * f))
      const k = z / v.zoom
      const W = window.innerWidth, H = window.innerHeight
      const footer = isMobile ? FOOTER_M : FOOTER_D
      const ox = W / 2 + v.panX, oy = (HEADER + H - footer) / 2 + v.panY
      v.panX += (x - ox) * (1 - k); v.panY += (y - oy) * (1 - k)
      v.zoom = z
    }
    const onWheel = (e: WheelEvent) => { e.preventDefault(); zoomAbout(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015)) }
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointercancel', onUp)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onUp)
      canvas.removeEventListener('wheel', onWheel)
    }
  }, [open, isMobile])

  if (!open) return null
  const footer = isMobile ? FOOTER_M : FOOTER_D
  return (
    <div ref={rootRef} data-map="root" style={{
      position: 'fixed', inset: 0, zIndex: 1500, background: 'rgba(4,2,12,0.86)', backdropFilter: 'blur(3px)',
      fontFamily: 'Kanit, sans-serif', color: '#D7E2EA', overflow: 'hidden',
    }}>
      <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none', cursor: 'grab' }} />

      {/* Header */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: HEADER, display: 'flex', alignItems: 'center', gap: 10, padding: '0 12px', pointerEvents: 'none' }}>
        <div style={{ letterSpacing: '0.22em', fontSize: '0.8rem', fontWeight: 600 }}>SYSTEM MAP</div>
        <div style={{ opacity: 0.45, fontSize: '0.6rem', letterSpacing: '0.08em', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>distances log-scaled · tap a body</div>
        <button type="button" data-map="reset" aria-label="Reset view" onClick={() => { viewRef.current = { zoom: 1, panX: 0, panY: 0 } }}
          style={{ pointerEvents: 'auto', width: 40, height: 40, borderRadius: '50%', border: '1px solid rgba(215,226,234,0.2)', background: 'rgba(255,255,255,0.04)', color: '#D7E2EA', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          <RotateCcw size={16} />
        </button>
        <button type="button" data-map="close" aria-label="Close map" onClick={onClose}
          style={{ pointerEvents: 'auto', width: 44, height: 44, borderRadius: '50%', border: '1px solid rgba(139,92,246,0.5)', background: 'rgba(139,92,246,0.15)', color: '#e8ddff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          <X size={20} />
        </button>
      </div>

      {/* Chips */}
      {MAP_ITEMS.map(id => (
        <button key={id} type="button" data-map={`chip-${id}`}
          ref={(e) => { chipRefs.current[id] = e }}
          onClick={() => onSelect(id)}
          style={{
            position: 'absolute', left: 0, top: 0, transform: 'translate(-9999px, -9999px)',
            height: isMobile ? 30 : 26, padding: isMobile ? '0 0.6rem' : '0 0.55rem', borderRadius: 999,
            display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
            border: `1px solid ${NAV_BY_ID[id]?.color ?? '#999'}88`, background: 'rgba(20,8,40,0.78)',
            color: '#e8ddff', fontSize: isMobile ? '0.66rem' : '0.64rem', letterSpacing: '0.1em', textTransform: 'uppercase',
            cursor: 'pointer', fontFamily: 'inherit', touchAction: 'manipulation',
          }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: NAV_BY_ID[id]?.color ?? '#999', flexShrink: 0 }} />
          {ITEM_LABEL[id]}
        </button>
      ))}

      {/* Footer: time controls */}
      <div data-map="footer" style={{
        position: 'absolute', left: 0, right: 0, bottom: 0, height: footer, boxSizing: 'border-box',
        padding: isMobile ? '8px 12px 12px' : '0 16px', display: 'flex', alignItems: 'center',
        borderTop: '1px solid rgba(215,226,234,0.08)', background: 'rgba(4,2,12,0.6)',
      }}>
        <TimeRow isMobile={isMobile} />
      </div>
    </div>
  )
}
