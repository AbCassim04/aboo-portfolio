import { motion, useTransform, type MotionValue } from 'framer-motion'

interface ScrollProgressProps {
  scrollProgress: MotionValue<number>
}

export default function ScrollProgress({ scrollProgress }: ScrollProgressProps) {
  const fillHeight = useTransform(scrollProgress, [0, 1], ['0%', '100%'])

  return (
    <div
      style={{
        position: 'fixed',
        right: '14px',
        top: '10%',
        height: '80%',
        width: '2px',
        zIndex: 50,
        background: 'rgba(215,226,234,0.08)',
        borderRadius: '1px',
      }}
    >
      <motion.div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: fillHeight,
          background: 'linear-gradient(180deg, #3b8bd4 0%, #7721b1 100%)',
          borderRadius: '1px',
        }}
      >
        <div
          style={{
            position: 'absolute',
            bottom: '-4px',
            left: '50%',
            transform: 'translateX(-50%)',
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: '#7721b1',
            boxShadow: '0 0 8px rgba(119,33,177,0.9)',
          }}
        />
      </motion.div>
    </div>
  )
}
