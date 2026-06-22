import { useState } from 'react'
import { motion, useTransform, useMotionValueEvent, type MotionValue } from 'framer-motion'

interface AboutOverlayProps {
  scrollProgress: MotionValue<number>
}

const ABOUT_TEXT =
  "Third-year Computer Science and Mathematics student at Wits University. I build full-stack products, conduct AI safety research, and apply deep mathematical thinking to real engineering problems. Currently exploring machine learning and mechanistic interpretability. Let's build something that matters."

function AnimatedChar({
  char,
  scrollProgress,
  start,
  end,
}: {
  char: string
  scrollProgress: MotionValue<number>
  start: number
  end: number
}) {
  const opacity = useTransform(scrollProgress, [start, end], [0.15, 1])
  return <motion.span style={{ opacity }}>{char}</motion.span>
}

function ScrollRangeText({
  text,
  scrollProgress,
  start,
  end,
  className,
  style,
}: {
  text: string
  scrollProgress: MotionValue<number>
  start: number
  end: number
  className?: string
  style?: React.CSSProperties
}) {
  const chars = text.split('')
  return (
    <p className={`relative ${className ?? ''}`} style={style}>
      <span aria-hidden className="invisible">{text}</span>
      <span className="absolute inset-0" aria-label={text}>
        {chars.map((char, i) => {
          const charStart = start + (i / chars.length) * (end - start)
          const charEnd = start + ((i + 0.5) / chars.length) * (end - start)
          return (
            <AnimatedChar
              key={i}
              char={char}
              scrollProgress={scrollProgress}
              start={charStart}
              end={charEnd}
            />
          )
        })}
      </span>
    </p>
  )
}

export default function AboutOverlay({ scrollProgress }: AboutOverlayProps) {
  const opacity = useTransform(scrollProgress, [0.22, 0.27, 0.35, 0.40], [0, 1, 1, 0])
  const [interactive, setInteractive] = useState(false)
  useMotionValueEvent(opacity, 'change', (v) => setInteractive(v > 0.01))

  return (
    <motion.div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10,
        opacity,
        pointerEvents: interactive ? 'auto' : 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
      }}
    >
      <div
        style={{
          background: 'rgba(12, 12, 12, 0.75)',
          backdropFilter: 'blur(4px)',
          borderRadius: '24px',
          padding: 'clamp(1.5rem, 4vw, 3rem)',
          maxWidth: '640px',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          gap: 'clamp(1rem, 3vw, 2rem)',
          border: '1px solid rgba(215,226,234,0.08)',
        }}
      >
        <h2
          className="hero-heading font-black uppercase text-center"
          style={{ fontSize: 'clamp(2.5rem, 10vw, 120px)' }}
        >
          About me
        </h2>

        <ScrollRangeText
          text={ABOUT_TEXT}
          scrollProgress={scrollProgress}
          start={0.27}
          end={0.34}
          className="text-[#D7E2EA] font-medium text-center leading-relaxed"
          style={{ fontSize: 'clamp(0.9rem, 1.8vw, 1.25rem)' }}
        />
      </div>
    </motion.div>
  )
}
