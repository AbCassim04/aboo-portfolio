import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowLeft } from 'lucide-react'
import * as bhRenderer from '../blackhole/renderer'
import LoadingScreen from '../components/LoadingScreen'

interface BlackHoleModeProps {
  onExit: () => void
}

export default function BlackHoleMode({ onExit }: BlackHoleModeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    bhRenderer.init(canvas, () => setReady(true))
    const onResize = () => bhRenderer.resize(window.innerWidth, window.innerHeight)
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      bhRenderer.dispose()
    }
  }, [])

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000', overflow: 'hidden' }}>
      {/* Black hole canvas */}
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute', inset: 0, width: '100%', height: '100%',
          opacity: ready ? 1 : 0, transition: 'opacity 1.2s ease',
          display: 'block',
        }}
        width={window.innerWidth}
        height={window.innerHeight}
      />

      {/* Loading screen */}
      <LoadingScreen progress={ready ? 100 : 0} done={ready} />

      {/* Exit button */}
      <AnimatePresence>
        {ready && (
          <motion.button
            key="exit"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.3 }}
            onClick={onExit}
            style={{
              position: 'absolute', top: '1.25rem', left: '1.25rem',
              display: 'flex', alignItems: 'center', gap: '0.5rem',
              padding: '0.5rem 0.875rem',
              background: 'rgba(0,0,0,0.55)', border: '1px solid rgba(139,92,246,0.4)',
              borderRadius: '0.5rem', color: '#c4b5fd',
              fontSize: '0.8rem', fontFamily: 'monospace', letterSpacing: '0.1em',
              cursor: 'pointer', backdropFilter: 'blur(8px)',
              transition: 'border-color 0.2s, background 0.2s',
            }}
            onMouseEnter={e => {
              ;(e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(139,92,246,0.8)'
              ;(e.currentTarget as HTMLButtonElement).style.background  = 'rgba(0,0,0,0.75)'
            }}
            onMouseLeave={e => {
              ;(e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(139,92,246,0.4)'
              ;(e.currentTarget as HTMLButtonElement).style.background  = 'rgba(0,0,0,0.55)'
            }}
          >
            <ArrowLeft size={14} />
            EXIT
          </motion.button>
        )}
      </AnimatePresence>

      {/* M87* label */}
      <AnimatePresence>
        {ready && (
          <motion.div
            key="label"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6, delay: 0.4 }}
            style={{
              position: 'absolute', bottom: '2rem', left: '50%', transform: 'translateX(-50%)',
              textAlign: 'center', pointerEvents: 'none',
            }}
          >
            <p style={{
              color: 'rgba(196,181,253,0.6)', fontFamily: 'monospace',
              fontSize: '0.7rem', letterSpacing: '0.3em', margin: 0,
            }}>
              M87* — MASS 6.5 × 10⁹ M☉ — DISTANCE 55 MLY
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
