import { useRef } from 'react'
import { useScroll, useTransform, motion } from 'framer-motion'
import LiveProjectButton from '../components/LiveProjectButton'

const PROJECTS = [
  {
    num: '01',
    name: 'Swapify',
    category: 'Full-Stack · 2025',
    desc: 'Campus marketplace built with React, Node.js, PostgreSQL, Clerk auth, and PayFast payments. Deployed on Railway and Vercel with GitHub Actions CI/CD.',
    href: 'https://github.com/AbCassim04/swapify',
    placeholders: {
      leftTop: { bg: '#1a1a1a', label: 'React + Vite' },
      leftBottom: { bg: '#1a1a1a', label: 'PostgreSQL Schema' },
      right: { bg: '#1a0a2e', label: 'Live Dashboard' },
    },
  },
  {
    num: '02',
    name: 'AI Safety Research',
    category: 'Research · 2026',
    desc: 'Investigated whether multilingual LLM benchmarks manufacture apparent performance inequity through flawed scoring. Submitted to Apart Research Global South AI Safety Hackathon 2026.',
    href: 'https://github.com/AbCassim04',
    placeholders: {
      leftTop: { bg: '#0a1a2e', label: 'Benchmark Analysis' },
      leftBottom: { bg: '#0a1a2e', label: 'Afrikaans DBE Evals' },
      right: { bg: '#1a0a2e', label: 'LLM Judge Pipeline' },
    },
  },
]

interface ProjectCardProps {
  project: (typeof PROJECTS)[0]
  index: number
  progress: ReturnType<typeof useScroll>['scrollYProgress']
}

function ProjectCard({ project, index, progress }: ProjectCardProps) {
  const targetScale = 1 - (PROJECTS.length - 1 - index) * 0.03
  const scale = useTransform(progress, [0, 1], [1, targetScale])

  return (
    <div
      className="sticky"
      style={{ top: `calc(6rem + ${index * 28}px)`, height: '85vh' }}
    >
      <motion.div
        style={{ scale, background: '#0C0C0C' }}
        className="h-full rounded-[40px] sm:rounded-[50px] md:rounded-[60px] border-2 border-[#D7E2EA] p-4 sm:p-6 md:p-8 flex flex-col gap-4 sm:gap-6"
      >
        {/* Top row */}
        <div className="flex flex-wrap items-start justify-between gap-4">
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
          className="text-[#D7E2EA] font-light leading-relaxed"
          style={{ fontSize: 'clamp(0.8rem, 1.4vw, 1.1rem)', opacity: 0.7 }}
        >
          {project.desc}
        </p>

        {/* Image grid */}
        <div className="flex gap-3 flex-1 min-h-0">
          {/* Left col — 40% */}
          <div className="flex flex-col gap-3" style={{ flex: '0 0 40%' }}>
            <div
              className="rounded-2xl flex items-center justify-center text-[#D7E2EA]/40 text-xs font-medium uppercase tracking-widest"
              style={{
                background: project.placeholders.leftTop.bg,
                height: 'clamp(110px, 14vw, 210px)',
              }}
            >
              {project.placeholders.leftTop.label}
            </div>
            <div
              className="rounded-2xl flex-1 flex items-center justify-center text-[#D7E2EA]/40 text-xs font-medium uppercase tracking-widest"
              style={{
                background: project.placeholders.leftBottom.bg,
                minHeight: 'clamp(140px, 20vw, 300px)',
              }}
            >
              {project.placeholders.leftBottom.label}
            </div>
          </div>
          {/* Right col — 60% */}
          <div className="flex-1">
            <div
              className="h-full rounded-2xl flex items-center justify-center text-[#D7E2EA]/40 text-xs font-medium uppercase tracking-widest"
              style={{ background: project.placeholders.right.bg }}
            >
              {project.placeholders.right.label}
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  )
}

export default function ProjectsSection() {
  const containerRef = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ['start start', 'end end'],
  })

  return (
    <section
      id="projects"
      className="rounded-t-[40px] sm:rounded-t-[50px] md:rounded-t-[60px] -mt-10 sm:-mt-12 md:-mt-14 relative z-10 px-5 sm:px-8 md:px-10 pt-20 pb-10"
      style={{ background: '#0C0C0C' }}
    >
      <h2
        className="hero-heading font-black uppercase text-center mb-16 sm:mb-20 md:mb-28"
        style={{ fontSize: 'clamp(3rem, 12vw, 160px)' }}
      >
        Projects
      </h2>

      <div ref={containerRef}>
        {PROJECTS.map((project, i) => (
          <div key={project.num} style={{ height: '85vh' }}>
            <ProjectCard project={project} index={i} progress={scrollYProgress} />
          </div>
        ))}
      </div>
    </section>
  )
}
