import { motion, AnimatePresence } from 'framer-motion'

interface LoadingScreenProps {
  progress: number   // 0–100
  done:     boolean
}

export default function LoadingScreen({ progress, done }: LoadingScreenProps) {
  return (
    <AnimatePresence>
      {!done && (
        <motion.div
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1.2 }}
          style={{
            position:       'fixed',
            inset:          0,
            background:     '#0c0c0c',
            display:        'flex',
            flexDirection:  'column',
            alignItems:     'center',
            justifyContent: 'center',
            zIndex:         9999,
            gap:            '2rem',
          }}
        >
          {/* Rocket */}
          <motion.div
            animate={{ y: [-10, 10, -10] }}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
            style={{ fontSize: '4rem', filter: 'drop-shadow(0 0 20px #9b4fc0)' }}
          >
            <svg width="80" height="120" viewBox="0 0 80 120" fill="none" xmlns="http://www.w3.org/2000/svg">
              {/* Body */}
              <ellipse cx="40" cy="50" rx="18" ry="35" fill="#c4b5fd"/>
              {/* Nose */}
              <path d="M40 5 L22 38 Q40 28 58 38 Z" fill="#a78bfa"/>
              {/* Window */}
              <circle cx="40" cy="45" r="8" fill="#1e1b4b" stroke="#7c3aed" strokeWidth="2"/>
              <circle cx="40" cy="45" r="4" fill="#4c1d95" opacity="0.8"/>
              {/* Left fin */}
              <path d="M22 70 L10 95 L22 85 Z" fill="#7c3aed"/>
              {/* Right fin */}
              <path d="M58 70 L70 95 L58 85 Z" fill="#7c3aed"/>
              {/* Flame outer */}
              <motion.ellipse
                cx="40" cy="92"
                rx="10" ry="18"
                fill="#f97316"
                animate={{ ry: [18, 24, 16, 22, 18], opacity: [0.9, 1, 0.8, 1, 0.9] }}
                transition={{ duration: 0.3, repeat: Infinity }}
              />
              {/* Flame inner */}
              <motion.ellipse
                cx="40" cy="90"
                rx="5" ry="12"
                fill="#fef08a"
                animate={{ ry: [12, 16, 10, 14, 12], opacity: [1, 0.9, 1, 0.8, 1] }}
                transition={{ duration: 0.2, repeat: Infinity }}
              />
            </svg>
          </motion.div>

          {/* Title */}
          <div style={{
            color:         '#c4b5fd',
            fontSize:      '0.85rem',
            letterSpacing: '0.3em',
            textTransform: 'uppercase',
            fontFamily:    'Kanit, sans-serif',
          }}>
            Loading Universe
          </div>

          {/* Progress bar */}
          <div style={{
            width:        '200px',
            height:       '3px',
            background:   'rgba(196,181,253,0.15)',
            borderRadius: '2px',
            overflow:     'hidden',
          }}>
            <motion.div
              style={{
                height:       '100%',
                background:   'linear-gradient(90deg, #7c3aed, #c4b5fd)',
                borderRadius: '2px',
              }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.3 }}
            />
          </div>

          {/* Percentage */}
          <div style={{
            color:         'rgba(196,181,253,0.5)',
            fontSize:      '0.75rem',
            fontFamily:    'Kanit, sans-serif',
            letterSpacing: '0.2em',
          }}>
            {Math.round(progress)}%
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
