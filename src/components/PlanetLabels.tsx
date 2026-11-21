import { useEffect, useRef } from 'react'

export interface LabelItem { key: string; name: string; colorCss: string }

// One entry per item, in the same order. The flight loop writes
// screen-space pixel coordinates + visibility here every frame; this component
// reads it in its own rAF loop and moves the DOM nodes directly (no per-frame
// React re-render).
export interface PlanetLabelDatum {
  x:       number
  y:       number
  visible: boolean
}

interface PlanetLabelsProps {
  items:    LabelItem[]
  dataRef:  React.MutableRefObject<PlanetLabelDatum[]>
  onSelect: (key: string) => void
  /** Highlight the current target. */
  targetKey?: string | null
}

export default function PlanetLabels({ items, dataRef, onSelect, targetKey }: PlanetLabelsProps) {
  const nodeRefs = useRef<(HTMLDivElement | null)[]>([])
  const boxRefs  = useRef<(HTMLButtonElement | null)[]>([])

  useEffect(() => {
    let rafId: number
    const loop = () => {
      const data = dataRef.current
      for (let i = 0; i < nodeRefs.current.length; i++) {
        const node = nodeRefs.current[i]
        const box  = boxRefs.current[i]
        const d    = data[i]
        if (!node || !d) continue
        node.style.transform = `translate(${d.x}px, ${d.y}px)`
        node.style.opacity   = d.visible ? '1' : '0'
        if (box) box.style.pointerEvents = d.visible ? 'auto' : 'none'
      }
      rafId = requestAnimationFrame(loop)
    }
    rafId = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(rafId)
  }, [dataRef])

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 16, pointerEvents: 'none', overflow: 'hidden' }}>
      {items.map((p, i) => (
        <div
          key={p.key}
          ref={(el) => { nodeRefs.current[i] = el }}
          style={{
            position:   'absolute',
            left:       0,
            top:        0,
            opacity:    0,
            transform:  'translate(-9999px, -9999px)',
            transition: 'opacity 0.3s ease',
            willChange: 'transform, opacity',
          }}
        >
          {/* Connecting reticle line from the label box down to the planet point */}
          <div
            style={{
              position:   'absolute',
              left:       0,
              top:        -13,
              width:      1,
              height:     13,
              background: `linear-gradient(to bottom, ${p.colorCss}, rgba(139,92,246,0.15))`,
              transform:  'translateX(-0.5px)',
            }}
          />
          {/* Anchor dot at the planet's projected position */}
          <div
            style={{
              position:     'absolute',
              left:         -3,
              top:          -3,
              width:        6,
              height:       6,
              borderRadius: '50%',
              background:   p.colorCss,
              boxShadow:    `0 0 6px ${p.colorCss}`,
            }}
          />
          {/* Label chip — sits above the line, horizontally centred on the anchor */}
          <button
            ref={(el) => { boxRefs.current[i] = el }}
            className="planet-label-chip"
            data-label={p.key}
            onClick={() => onSelect(p.key)}
            style={{
              position:      'absolute',
              left:          0,
              top:           -13,
              transform:     'translate(-50%, -100%)',
              display:       'flex',
              alignItems:    'center',
              gap:           '0.4rem',
              whiteSpace:    'nowrap',
              padding:       '0.32rem 0.7rem',
              borderRadius:  '999px',
              background:    'rgba(20,8,40,0.6)',
              border:        p.key === targetKey ? '1px solid rgba(125,249,255,0.85)' : '1px solid rgba(139,92,246,0.55)',
              backdropFilter:'blur(6px)',
              color:         '#e8ddff',
              fontFamily:    'Kanit, sans-serif',
              fontSize:      '0.68rem',
              fontWeight:    500,
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              cursor:        'pointer',
              pointerEvents: 'none',
              boxShadow:     '0 0 12px rgba(139,92,246,0.35)',
            }}
          >
            <span
              style={{
                width:        8,
                height:       8,
                borderRadius: '50%',
                background:   p.colorCss,
                boxShadow:    `0 0 6px ${p.colorCss}`,
                flexShrink:   0,
              }}
            />
            {p.name}
          </button>
        </div>
      ))}
    </div>
  )
}
