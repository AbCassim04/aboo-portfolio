import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import { findInfo } from '../data/planetData'

export interface InfoActions {
  onFastTravel: () => void
  onAutopilot:  () => void
  onSetTarget:  () => void
  /** Already the current target. */
  isTarget:     boolean
  /** Current distance, formatted (optional). */
  distance?:    string
}

interface PlanetInfoPanelProps {
  planetKey: string | null
  onClose:   () => void
  /** Navigation actions (Fast travel / Autopilot / Set target). */
  actions?:  InfoActions | null
}

export default function PlanetInfoPanel({ planetKey, onClose, actions }: PlanetInfoPanelProps) {
  const [isMobile] = useState(() => 'ontouchstart' in window || navigator.maxTouchPoints > 0)
  const planet = findInfo(planetKey)
  const actBtn = (primary: boolean): React.CSSProperties => ({
    flex: '1 1 0', minWidth: 0, height: 44, borderRadius: 12, cursor: 'pointer', fontFamily: 'Kanit, sans-serif',
    fontSize: '0.68rem', letterSpacing: '0.12em', fontWeight: 600, touchAction: 'manipulation',
    border: `1px solid ${primary ? 'rgba(125,249,255,0.6)' : 'rgba(139,92,246,0.5)'}`,
    background: primary ? 'rgba(125,249,255,0.12)' : 'rgba(139,92,246,0.12)',
    color: primary ? '#bff9ff' : '#e8ddff',
  })

  return (
    <AnimatePresence>
      {planet && (
        <motion.div
          key="planet-info-backdrop"
          data-info="backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          onClick={onClose}
          style={{
            position:       'fixed',
            inset:          0,
            zIndex:         2000,
            display:        'flex',
            alignItems:     isMobile ? 'stretch' : 'center',
            justifyContent: 'center',
            padding:        isMobile ? 0 : '1.5rem',
            background:     'rgba(4,2,10,0.55)',
            backdropFilter: 'blur(4px)',
          }}
        >
          <motion.div
            key="planet-info-panel"
            initial={{ opacity: 0, y: isMobile ? 40 : 24, scale: isMobile ? 1 : 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: isMobile ? 40 : 24, scale: isMobile ? 1 : 0.96 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            onClick={(e) => e.stopPropagation()}
            style={{
              position:      'relative',
              width:         isMobile ? '100%' : 'min(480px, 100%)',
              maxWidth:      isMobile ? '100%' : 480,
              maxHeight:     isMobile ? '100%' : '85vh',
              height:        isMobile ? '100%' : 'auto',
              overflowY:     'auto',
              background:    'linear-gradient(160deg, rgba(24,10,44,0.96), rgba(10,6,22,0.96))',
              border:        '1px solid rgba(139,92,246,0.4)',
              borderRadius:  isMobile ? 0 : '20px',
              boxShadow:     '0 0 40px rgba(119,33,177,0.35)',
              color:         '#e8ddff',
              fontFamily:    'Kanit, sans-serif',
              padding:       isMobile ? '4.5rem 1.5rem 2.5rem' : '2.25rem',
            }}
          >
            {/* Close button — always accessible, 44×44 touch target */}
            <button
              onClick={onClose}
              aria-label="Close"
              style={{
                position:       'absolute',
                top:            isMobile ? '1rem' : '1.1rem',
                right:          isMobile ? '1rem' : '1.1rem',
                width:          44,
                height:         44,
                display:        'flex',
                alignItems:     'center',
                justifyContent: 'center',
                borderRadius:   '50%',
                background:     'rgba(139,92,246,0.15)',
                border:         '1px solid rgba(139,92,246,0.5)',
                color:          '#e8ddff',
                cursor:         'pointer',
              }}
            >
              <X size={20} />
            </button>

            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.35rem' }}>
              <span
                style={{
                  width:        16,
                  height:       16,
                  borderRadius: '50%',
                  background:   planet.colorCss,
                  boxShadow:    `0 0 14px ${planet.colorCss}`,
                  flexShrink:   0,
                }}
              />
              <h2
                style={{
                  margin:        0,
                  fontSize:      'clamp(1.8rem, 6vw, 2.6rem)',
                  fontWeight:    800,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  lineHeight:    1,
                }}
              >
                {planet.name}
              </h2>
            </div>
            <p
              style={{
                margin:        '0 0 1.5rem 0',
                color:         '#c4b5fd',
                fontSize:      '0.8rem',
                letterSpacing: '0.22em',
                textTransform: 'uppercase',
              }}
            >
              {planet.subtitle}
            </p>

            {/* Navigation actions */}
            {actions && (
              <div data-info="actions" style={{ display: 'flex', gap: '0.5rem', margin: '0 0 1.25rem 0' }}>
                <button data-info="fasttravel" onClick={actions.onFastTravel} style={actBtn(true)}>FAST TRAVEL</button>
                <button data-info="autopilot" onClick={actions.onAutopilot} style={actBtn(false)}>AUTOPILOT</button>
                <button data-info="target" onClick={actions.onSetTarget} style={actBtn(false)}>
                  {actions.isTarget ? 'TARGETED ✓' : 'SET TARGET'}
                </button>
              </div>
            )}
            {actions?.distance && (
              <p style={{ margin: '-0.6rem 0 1.1rem 0', color: 'rgba(215,226,234,0.55)', fontSize: '0.72rem', letterSpacing: '0.08em' }}>
                Distance: <span data-info="distance" style={{ color: '#fff' }}>{actions.distance}</span>
              </p>
            )}

            {/* Stat rows */}
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {planet.stats.map((s) => (
                <div
                  key={s.label}
                  style={{
                    display:        'flex',
                    justifyContent: 'space-between',
                    alignItems:     'baseline',
                    gap:            '1rem',
                    padding:        '0.6rem 0',
                    borderTop:      '1px solid rgba(139,92,246,0.15)',
                  }}
                >
                  <span style={{ color: 'rgba(215,226,234,0.55)', fontSize: '0.72rem', letterSpacing: '0.12em', textTransform: 'uppercase', flexShrink: 0 }}>
                    {s.label}
                  </span>
                  <span style={{ color: '#ffffff', fontSize: '0.9rem', textAlign: 'right', fontWeight: 500 }}>
                    {s.value}
                  </span>
                </div>
              ))}
            </div>

            {/* Fun fact */}
            <div
              style={{
                marginTop:    '1.5rem',
                padding:      '1rem 1.1rem',
                borderRadius: '14px',
                background:   'rgba(119,33,177,0.14)',
                border:       '1px solid rgba(139,92,246,0.3)',
              }}
            >
              <div style={{ color: '#c4b5fd', fontSize: '0.65rem', letterSpacing: '0.24em', textTransform: 'uppercase', marginBottom: '0.4rem' }}>
                Fun fact
              </div>
              <p style={{ margin: 0, color: '#e8ddff', fontSize: '0.92rem', lineHeight: 1.5, fontWeight: 300 }}>
                {planet.funFact}
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
