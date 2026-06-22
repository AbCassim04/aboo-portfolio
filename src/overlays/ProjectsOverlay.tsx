import { useState } from 'react'
import { motion, useTransform, useMotionValueEvent, type MotionValue } from 'framer-motion'
import LiveProjectButton from '../components/LiveProjectButton'
import { PROJECTS } from '../components/ProjectVisuals'

interface ProjectsOverlayProps {
  scrollProgress: MotionValue<number>
}

const CARD_RANGES = [
  { start: 0.60, fadeIn: 0.64, fadeOut: 0.70, end: 0.74 },
  { start: 0.72, fadeIn: 0.76, fadeOut: 0.82, end: 0.86 },
]

function ProjectCard({
  project,
  opacity,
  interactive,
}: {
  project: (typeof PROJECTS)[0]
  opacity: MotionValue<number>
  interactive: boolean
}) {
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
        paddingTop: 'clamp(1rem, 3vh, 2rem)',
        paddingBottom: 'clamp(1rem, 3vh, 2rem)',
      }}
    >
      <div
        className="h-full rounded-[32px] sm:rounded-[40px] md:rounded-[50px] border-2 border-[#D7E2EA] p-4 sm:p-6 md:p-8 flex flex-col gap-3 sm:gap-5"
        style={{
          background: '#0C0C0C',
          maxWidth: '900px',
          width: '100%',
          maxHeight: '85vh',
          overflow: 'hidden',
        }}
      >
        {/* Top row */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3 sm:gap-5">
            <span
              className="font-black text-[#D7E2EA] leading-none"
              style={{ fontSize: 'clamp(2rem, 5vw, 72px)' }}
            >
              {project.num}
            </span>
            <span className="font-medium uppercase tracking-widest text-[#D7E2EA] text-xs sm:text-sm opacity-60 border border-[#D7E2EA]/30 rounded-full px-3 py-1">
              {project.category}
            </span>
            <span
              className="font-black uppercase text-[#D7E2EA] leading-none"
              style={{ fontSize: 'clamp(1.25rem, 3.5vw, 48px)' }}
            >
              {project.name}
            </span>
          </div>
          <a href={project.href} target="_blank" rel="noopener noreferrer">
            <LiveProjectButton />
          </a>
        </div>

        {/* Description */}
        <p
          className="text-[#D7E2EA] font-light leading-relaxed flex-shrink-0"
          style={{ fontSize: 'clamp(0.8rem, 1.4vw, 1.1rem)', opacity: 0.7 }}
        >
          {project.desc}
        </p>

        {/* Visual grid */}
        <div className="flex gap-3 flex-1 min-h-0">
          <div className="flex flex-col gap-3" style={{ flex: '0 0 40%' }}>
            <div className="rounded-2xl overflow-hidden" style={{ height: 'clamp(90px, 12vw, 180px)' }}>
              {project.visuals.leftTop}
            </div>
            <div className="rounded-2xl flex-1 overflow-hidden" style={{ minHeight: 'clamp(100px, 14vw, 220px)' }}>
              {project.visuals.leftBottom}
            </div>
          </div>
          <div className="flex-1">
            <div className="h-full rounded-2xl overflow-hidden">
              {project.visuals.right}
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  )
}

function SingleCard({
  project,
  scrollProgress,
  range,
}: {
  project: (typeof PROJECTS)[0]
  scrollProgress: MotionValue<number>
  range: (typeof CARD_RANGES)[0]
}) {
  const opacity = useTransform(
    scrollProgress,
    [range.start, range.fadeIn, range.fadeOut, range.end],
    [0, 1, 1, 0],
  )
  const [interactive, setInteractive] = useState(false)
  useMotionValueEvent(opacity, 'change', (v) => setInteractive(v > 0.01))

  return <ProjectCard project={project} opacity={opacity} interactive={interactive} />
}

export default function ProjectsOverlay({ scrollProgress }: ProjectsOverlayProps) {
  return (
    <>
      {PROJECTS.map((project, i) => (
        <SingleCard
          key={project.num}
          project={project}
          scrollProgress={scrollProgress}
          range={CARD_RANGES[i]}
        />
      ))}
    </>
  )
}
