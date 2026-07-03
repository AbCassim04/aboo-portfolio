import { useEffect, useRef, useState } from 'react'

interface LoadingScreenProps {
  progress:    number   // 0 to 1, driven by THREE.LoadingManager
  onComplete?: () => void
}

// ── Mission-briefing script ─────────────────────────────────────────────────
const LINES = [
  'ESTABLISHING ORBITAL COORDINATES...',
  'CALIBRATING GRAVITATIONAL SENSORS...',
  'SCANNING ASTEROID FIELDS...',
  'LOADING SOLAR CARTOGRAPHY...',
  'DETECTING CELESTIAL BODIES...',
  'WARMING UP WARP DRIVE...',
  'ALL SYSTEMS GO — INITIATING LAUNCH SEQUENCE',
]
// Per-line beep frequency (Hz)
const FREQS = [440, 523, 587, 659, 698, 784, 880]
// Loading-progress each line waits for before it starts typing.
// Lines 1-2 → 0-30%, 3-4 → 30-60%, 5-6 → 60-90%, line 7 → 100%.
const THRESHOLDS = [0, 0.15, 0.30, 0.45, 0.60, 0.75, 1.0]

const CHAR_MS = 40   // typewriter speed
const GAP_MS  = 400  // pause between lines

interface Star { x: number; y: number; size: number; dur: number; delay: number }
function makeStars(count: number): Star[] {
  return Array.from({ length: count }, () => ({
    x:     Math.random() * 100,
    y:     Math.random() * 100,
    size:  Math.random() * 1.6 + 0.6,
    dur:   Math.random() * 2.5 + 1.5,
    delay: Math.random() * 3,
  }))
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

export default function LoadingScreen({ progress, onComplete }: LoadingScreenProps) {
  const [isMobile]      = useState(() => 'ontouchstart' in window || navigator.maxTouchPoints > 0)
  const [stars]         = useState(() => makeStars(isMobile ? 20 : 50))
  const [typedCounts, setTypedCounts] = useState<number[]>(() => LINES.map(() => 0))
  const [activeLine,  setActiveLine]  = useState(-1)
  const [lineDone,    setLineDone]     = useState(false)
  const [flash,       setFlash]        = useState(false)
  const [fadeOut,     setFadeOut]      = useState(false)

  // Latest values read by the async boot sequence without re-triggering it.
  const progressRef   = useRef(progress)
  const onCompleteRef = useRef(onComplete)
  useEffect(() => { progressRef.current   = progress   }, [progress])
  useEffect(() => { onCompleteRef.current = onComplete }, [onComplete])

  useEffect(() => {
    let cancelled = false

    // ── Web Audio (best-effort — needs a prior user gesture; wrapped so a
    //    blocked AudioContext never breaks the loading screen) ──────────────
    let audioCtx: AudioContext | null = null
    let humGain:  GainNode | null     = null
    try {
      const AC = window.AudioContext
        || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (AC) {
        audioCtx = new AC()
        void audioCtx.resume?.()
        // Continuous low 40 Hz hum, very quiet.
        const humOsc = audioCtx.createOscillator()
        humGain = audioCtx.createGain()
        humOsc.type = 'sine'
        humOsc.frequency.value = 40
        humGain.gain.setValueAtTime(0.02, audioCtx.currentTime)
        humOsc.connect(humGain)
        humGain.connect(audioCtx.destination)
        humOsc.start()
      }
    } catch {
      audioCtx = null
    }

    const playBeep = (frequency: number, duration: number) => {
      if (!audioCtx) return
      try {
        const osc  = audioCtx.createOscillator()
        const gain = audioCtx.createGain()
        osc.connect(gain)
        gain.connect(audioCtx.destination)
        osc.frequency.value = frequency
        osc.type = 'sine'
        gain.gain.setValueAtTime(0.04, audioCtx.currentTime)
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration)
        osc.start(audioCtx.currentTime)
        osc.stop(audioCtx.currentTime + duration)
      } catch { /* ignore */ }
    }

    // Resolve once loading progress reaches a line's threshold.
    const waitForProgress = (threshold: number) => new Promise<void>(resolve => {
      const check = () => {
        if (cancelled || progressRef.current >= threshold - 1e-6) resolve()
        else setTimeout(check, 60)
      }
      check()
    })

    // Type one line character-by-character.
    const typeLine = (i: number) => new Promise<void>(resolve => {
      const len = LINES[i].length
      let ch = 0
      const step = () => {
        if (cancelled) return resolve()
        ch++
        setTypedCounts(prev => { const n = prev.slice(); n[i] = ch; return n })
        if (ch >= len) resolve()
        else setTimeout(step, CHAR_MS)
      }
      step()
    })

    const run = async () => {
      for (let i = 0; i < LINES.length; i++) {
        await waitForProgress(THRESHOLDS[i])   // gate on real loading progress
        if (cancelled) return
        setActiveLine(i)
        setLineDone(false)
        playBeep(FREQS[i], 0.15)
        await typeLine(i)
        if (cancelled) return
        setLineDone(true)
        await sleep(GAP_MS)
        if (cancelled) return
      }

      // ── Transition out ────────────────────────────────────────────────────
      await sleep(1200)
      if (cancelled) return
      setFlash(true)                            // progress bar flashes white
      await sleep(180)
      if (cancelled) return
      if (audioCtx && humGain) {
        try { humGain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.6) } catch { /* ignore */ }
      }
      setFadeOut(true)                          // whole screen fades to black
      await sleep(600)
      if (cancelled) return
      onCompleteRef.current?.()
    }
    run()

    return () => {
      cancelled = true
      try { audioCtx?.close() } catch { /* ignore */ }
    }
  }, [])

  const fontSize = isMobile ? '0.75rem' : '0.85rem'

  return (
    <div
      style={{
        position:   'fixed',
        inset:      0,
        zIndex:     9999,
        background: '#060410',
        overflow:   'hidden',
        fontFamily: "'Courier New', Courier, monospace",
      }}
    >
      {/* ── Star field ── */}
      {stars.map((s, i) => (
        <div
          key={i}
          style={{
            position:                'absolute',
            left:                    `${s.x}%`,
            top:                     `${s.y}%`,
            width:                   s.size,
            height:                  s.size,
            borderRadius:            '50%',
            background:              '#ffffff',
            pointerEvents:           'none',
            animationName:           'loadingStarTwinkle',
            animationDuration:       `${s.dur}s`,
            animationDelay:          `${s.delay}s`,
            animationIterationCount: 'infinite',
            animationTimingFunction: 'ease-in-out',
          }}
        />
      ))}

      {/* ── Portfolio wordmark ── */}
      <div
        style={{
          position:      'absolute',
          top:           '1.6rem',
          left:          0,
          right:         0,
          textAlign:     'center',
          color:         'rgba(190,190,205,0.4)',
          fontSize:      '0.68rem',
          letterSpacing: '0.4em',
          textTransform: 'uppercase',
          pointerEvents: 'none',
        }}
      >
        ABOO-PORTFOLIO
      </div>

      {/* ── Mission briefing lines ── */}
      <div
        style={{
          position:      'absolute',
          top:           '50%',
          left:          '50%',
          transform:     'translate(-50%, -50%)',
          width:         'min(90vw, 640px)',
          display:       'flex',
          flexDirection: 'column',
          gap:           '0.55rem',
        }}
      >
        {LINES.map((line, i) => {
          const started = typedCounts[i] > 0 || i === activeLine
          if (!started) return null
          const isLast    = i === LINES.length - 1
          const isActive  = i === activeLine
          const showCursor = isActive && !lineDone
          return (
            <div
              key={i}
              style={{
                fontSize,
                letterSpacing: '0.2em',
                color:         isLast ? '#ffffff' : '#22c55e',
                opacity:       isActive ? 1 : 0.4,
                transition:    'opacity 0.3s ease',
                whiteSpace:    'pre-wrap',
                lineHeight:    1.5,
                textShadow:    isLast ? '0 0 10px rgba(255,255,255,0.4)' : '0 0 8px rgba(34,197,94,0.35)',
              }}
            >
              {line.slice(0, typedCounts[i])}
              {showCursor && <span className="loading-cursor">|</span>}
            </div>
          )
        })}
      </div>

      {/* ── Bottom progress bar ── */}
      <div
        style={{
          position:   'absolute',
          left:       0,
          right:      0,
          bottom:     0,
          height:     3,
          background: 'rgba(255,255,255,0.06)',
        }}
      >
        <div
          style={{
            height:     '100%',
            width:      `${Math.min(Math.max(progress, 0), 1) * 100}%`,
            background: flash ? '#ffffff' : 'linear-gradient(90deg, #6d28d9 0%, #a78bfa 100%)',
            boxShadow:  flash ? '0 0 14px 2px rgba(255,255,255,0.9)' : '0 0 8px rgba(124,58,237,0.7)',
            transition: 'width 0.3s ease, background 0.15s ease, box-shadow 0.15s ease',
          }}
        />
      </div>

      {/* ── Fade-to-black on exit ── */}
      <div
        style={{
          position:      'absolute',
          inset:         0,
          background:    '#000000',
          opacity:       fadeOut ? 1 : 0,
          transition:    'opacity 0.6s ease',
          pointerEvents: 'none',
        }}
      />
    </div>
  )
}
