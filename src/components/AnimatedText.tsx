import { useRef } from 'react'
import { useScroll, useTransform, motion, type MotionValue } from 'framer-motion'

interface CharProps {
  char: string
  progress: MotionValue<number>
  start: number
  end: number
}

function AnimatedChar({ char, progress, start, end }: CharProps) {
  const opacity = useTransform(progress, [start, end], [0.2, 1])
  return <motion.span style={{ opacity }}>{char}</motion.span>
}

interface AnimatedTextProps {
  text: string
  className?: string
  style?: React.CSSProperties
}

export default function AnimatedText({ text, className, style }: AnimatedTextProps) {
  const ref = useRef<HTMLParagraphElement>(null)
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start 0.8', 'end 0.2'],
  })

  const chars = text.split('')

  return (
    <p ref={ref} className={`relative ${className ?? ''}`} style={style}>
      <span aria-hidden className="invisible">{text}</span>
      <span className="absolute inset-0" aria-label={text}>
        {chars.map((char, i) => (
          <AnimatedChar
            key={i}
            char={char}
            progress={scrollYProgress}
            start={i / chars.length}
            end={(i + 1) / chars.length}
          />
        ))}
      </span>
    </p>
  )
}
