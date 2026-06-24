import { motion, AnimatePresence } from 'framer-motion'

interface LoadingScreenProps {
  progress: number   // 0–100
  done:     boolean
}

// Stable star field — generated once at module level
const STARS = Array.from({ length: 90 }, (_, i) => ({
  id:       i,
  x:        Math.random() * 100,
  y:        Math.random() * 100,
  size:     Math.random() * 1.4 + 0.4,
  delay:    Math.random() * 4,
  duration: Math.random() * 2 + 1.8,
  opacity:  Math.random() * 0.5 + 0.1,
}))

export default function LoadingScreen({ progress, done }: LoadingScreenProps) {
  const pct = Math.round(progress)

  return (
    <AnimatePresence>
      {!done && (
        <motion.div
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, scale: 1.04 }}
          transition={{ duration: 1.6, ease: [0.4, 0, 0.2, 1] }}
          style={{
            position:       'fixed',
            inset:          0,
            background:     '#0c0c0c',
            display:        'flex',
            flexDirection:  'column',
            alignItems:     'center',
            justifyContent: 'center',
            zIndex:         9999,
            overflow:       'hidden',
            fontFamily:     'Kanit, sans-serif',
          }}
        >

          {/* ── Star field ── */}
          {STARS.map(s => (
            <motion.div
              key={s.id}
              style={{
                position:     'absolute',
                left:         `${s.x}%`,
                top:          `${s.y}%`,
                width:        s.size,
                height:       s.size,
                borderRadius: '50%',
                background:   '#fff',
                pointerEvents:'none',
              }}
              animate={{ opacity: [s.opacity, s.opacity * 5, s.opacity] }}
              transition={{ duration: s.duration, delay: s.delay, repeat: Infinity, ease: 'easeInOut' }}
            />
          ))}

          {/* ── Deep space radial vignette ── */}
          <div style={{
            position:   'absolute',
            inset:      0,
            background: 'radial-gradient(ellipse 60% 60% at 50% 42%, transparent 0%, rgba(12,12,12,0.7) 100%)',
            pointerEvents: 'none',
          }} />

          {/* ── Engine ambient glow on background ── */}
          <motion.div
            style={{
              position:     'absolute',
              top:          '55%',
              left:         '50%',
              transform:    'translate(-50%, -50%)',
              width:        320,
              height:       320,
              borderRadius: '50%',
              background:   'radial-gradient(circle, rgba(124,58,237,0.12) 0%, transparent 70%)',
              pointerEvents:'none',
            }}
            animate={{ opacity: [0.6, 1, 0.6], scale: [0.85, 1.1, 0.85] }}
            transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
          />

          {/* ── Rocket ── */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1, ease: 'easeOut' }}
          >
            <motion.div
              animate={{ y: [-9, 9, -9], rotate: [-0.6, 0.6, -0.6] }}
              transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
              style={{ position: 'relative', marginBottom: '3.2rem' }}
            >
              <svg width="88" height="170" viewBox="0 0 88 170" fill="none" xmlns="http://www.w3.org/2000/svg">

                {/* Exhaust halo */}
                <motion.ellipse
                  cx="44" cy="148"
                  rx={28} ry={22}
                  fill="url(#exhaustHalo)"
                  initial={{ ry: 22, opacity: 0.5 }}
                  animate={{ ry: [20, 28, 17, 26, 20], opacity: [0.5, 0.85, 0.4, 0.75, 0.5] }}
                  transition={{ duration: 0.28, repeat: Infinity }}
                />

                {/* Flame — outer (orange) */}
                <motion.ellipse
                  cx="44" cy="130"
                  rx={11} ry={24}
                  fill="url(#flameOuter)"
                  initial={{ rx: 11, ry: 24 }}
                  animate={{ ry: [24, 30, 20, 27, 24], rx: [11, 9, 12, 10, 11] }}
                  transition={{ duration: 0.19, repeat: Infinity }}
                />
                {/* Flame — mid (yellow) */}
                <motion.ellipse
                  cx="44" cy="126"
                  rx={6.5} ry={17}
                  fill="url(#flameMid)"
                  initial={{ ry: 17, opacity: 0.9 }}
                  animate={{ ry: [17, 22, 14, 19, 17], opacity: [0.9, 1, 0.8, 1, 0.9] }}
                  transition={{ duration: 0.15, repeat: Infinity }}
                />
                {/* Flame — core (white) */}
                <motion.ellipse
                  cx="44" cy="122"
                  rx={3} ry={10}
                  fill="#ffffff"
                  initial={{ ry: 10, opacity: 1 }}
                  animate={{ ry: [10, 13, 8, 11, 10], opacity: [1, 0.88, 1, 0.92, 1] }}
                  transition={{ duration: 0.11, repeat: Infinity }}
                />

                {/* Left fin */}
                <path d="M26 98 L8 130 L26 118 Z" fill="url(#finGrad)" />
                {/* Right fin */}
                <path d="M62 98 L80 130 L62 118 Z" fill="url(#finGrad)" />

                {/* Main body */}
                <ellipse cx="44" cy="72" rx="22" ry="44" fill="url(#bodyGrad)" />

                {/* Body specular highlight */}
                <ellipse cx="36" cy="60" rx="4" ry="22" fill="rgba(255,255,255,0.07)" />

                {/* Body panel seams */}
                <line x1="44" y1="110" x2="44" y2="95" stroke="rgba(167,139,250,0.18)" strokeWidth="0.7" />
                <line x1="32" y1="88" x2="56" y2="88" stroke="rgba(167,139,250,0.14)" strokeWidth="0.7" />
                <line x1="30" y1="100" x2="58" y2="100" stroke="rgba(167,139,250,0.14)" strokeWidth="0.7" />

                {/* Nose cone */}
                <path d="M44 10 L22 52 Q44 38 66 52 Z" fill="url(#noseGrad)" />

                {/* Window ring */}
                <circle cx="44" cy="67" r="12" fill="#160f2e" stroke="#7c3aed" strokeWidth="1.5" />
                {/* Window glass */}
                <circle cx="44" cy="67" r="9" fill="url(#windowGrad)" />
                {/* Window inner pulse */}
                <motion.circle
                  cx="44" cy="67" r={7}
                  fill="none"
                  stroke="#a78bfa"
                  strokeWidth="0.8"
                  initial={{ r: 7, opacity: 0.3 }}
                  animate={{ opacity: [0.3, 0.9, 0.3], r: [6, 7.5, 6] }}
                  transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
                />
                {/* Stars in window */}
                <circle cx="41" cy="64" r="1.2" fill="#c4b5fd" opacity="0.9" />
                <circle cx="46" cy="69" r="0.8" fill="#a78bfa" opacity="0.6" />
                <circle cx="43" cy="70" r="0.5" fill="#e9d5ff" opacity="0.4" />

                <defs>
                  <linearGradient id="bodyGrad" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%"   stopColor="#6d28d9" />
                    <stop offset="40%"  stopColor="#c4b5fd" />
                    <stop offset="100%" stopColor="#5b21b6" />
                  </linearGradient>
                  <linearGradient id="noseGrad" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%"   stopColor="#7c3aed" />
                    <stop offset="55%"  stopColor="#a78bfa" />
                    <stop offset="100%" stopColor="#5b21b6" />
                  </linearGradient>
                  <linearGradient id="finGrad" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%"   stopColor="#7c3aed" />
                    <stop offset="100%" stopColor="#3b0764" />
                  </linearGradient>
                  <radialGradient id="windowGrad" cx="35%" cy="35%" r="65%">
                    <stop offset="0%"   stopColor="#2e1065" />
                    <stop offset="100%" stopColor="#0a0520" />
                  </radialGradient>
                  <radialGradient id="exhaustHalo" cx="50%" cy="0%" r="100%">
                    <stop offset="0%"   stopColor="#7c3aed" stopOpacity="0.45" />
                    <stop offset="100%" stopColor="#7c3aed" stopOpacity="0" />
                  </radialGradient>
                  <linearGradient id="flameOuter" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor="#fb923c" />
                    <stop offset="80%"  stopColor="#dc2626" stopOpacity="0.3" />
                    <stop offset="100%" stopColor="#dc2626" stopOpacity="0" />
                  </linearGradient>
                  <linearGradient id="flameMid" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor="#fef08a" />
                    <stop offset="70%"  stopColor="#fb923c" stopOpacity="0.5" />
                    <stop offset="100%" stopColor="#fb923c" stopOpacity="0" />
                  </linearGradient>
                </defs>
              </svg>
            </motion.div>
          </motion.div>

          {/* ── LOADING UNIVERSE label ── */}
          <motion.p
            initial={{ opacity: 0, letterSpacing: '0.9em' }}
            animate={{ opacity: 1, letterSpacing: '0.38em' }}
            transition={{ duration: 1.4, delay: 0.4, ease: [0.4, 0, 0.2, 1] }}
            style={{
              color:         '#c4b5fd',
              fontSize:      '0.72rem',
              textTransform: 'uppercase',
              fontWeight:    300,
              margin:        0,
              marginBottom:  '1.6rem',
            }}
          >
            Loading Universe
          </motion.p>

          {/* ── Progress bar ── */}
          <motion.div
            initial={{ opacity: 0, scaleX: 0.6 }}
            animate={{ opacity: 1, scaleX: 1 }}
            transition={{ duration: 0.9, delay: 0.25 }}
            style={{
              width:        '260px',
              height:       '2px',
              background:   'rgba(196,181,253,0.1)',
              borderRadius: '2px',
              position:     'relative',
              marginBottom: '1rem',
            }}
          >
            {/* Fill */}
            <motion.div
              style={{
                position:     'absolute',
                top:          0,
                left:         0,
                height:       '100%',
                borderRadius: '2px',
                background:   'linear-gradient(90deg, #4c1d95 0%, #7c3aed 60%, #c4b5fd 100%)',
                boxShadow:    '0 0 8px 1px rgba(124,58,237,0.6)',
              }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.35, ease: 'easeOut' }}
            />
            {/* Lead glow dot */}
            <motion.div
              style={{
                position:     'absolute',
                top:          '50%',
                transform:    'translate(-50%, -50%)',
                width:        6,
                height:       6,
                borderRadius: '50%',
                background:   '#e9d5ff',
                boxShadow:    '0 0 10px 4px rgba(196,181,253,0.9)',
              }}
              animate={{ left: `${progress}%` }}
              transition={{ duration: 0.35, ease: 'easeOut' }}
            />
          </motion.div>

          {/* ── Percentage ── */}
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6 }}
            style={{
              color:              'rgba(196,181,253,0.38)',
              fontSize:           '0.62rem',
              letterSpacing:      '0.22em',
              margin:             0,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {String(pct).padStart(3, '0')} %
          </motion.p>

        </motion.div>
      )}
    </AnimatePresence>
  )
}
