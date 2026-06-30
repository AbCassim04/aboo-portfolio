import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft } from 'lucide-react'
import LiveProjectButton from '../components/LiveProjectButton'
import { PROJECTS } from '../components/ProjectVisuals'
import type { Zone } from '../hooks/useCameraNavigation'

interface ProjectsOverlayProps {
  currentZone: Zone
  isTransitioning: boolean
  navigateTo: (zone: Zone) => void
}

export default function ProjectsOverlay({ currentZone, isTransitioning, navigateTo }: ProjectsOverlayProps) {
  const visible = currentZone === 'projects' && !isTransitioning

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="projects-overlay"
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          style={{ position: 'fixed', inset: 0, zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '1.5rem' }}
        >
          {/* Back button */}
          <div className="absolute top-6 left-6 md:top-8 md:left-8" style={{ zIndex: 20, pointerEvents: 'auto' }}>
            <motion.button
              type="button"
              onClick={() => navigateTo('hub')}
              className="flex items-center gap-2 text-[#D7E2EA] rounded-full px-5 py-3 cursor-pointer text-sm uppercase tracking-widest"
              style={{ border: '1px solid rgba(215,226,234,0.2)', backdropFilter: 'blur(8px)', background: 'rgba(12,12,12,0.3)' }}
              whileHover={{ background: 'rgba(215,226,234,0.1)' }}
              transition={{ duration: 0.2 }}
            >
              <ArrowLeft size={16} />
              Back
            </motion.button>
          </div>

          {/* Outer card */}
          <div
            style={{
              background: 'rgba(12, 12, 12, 0.5)',
              backdropFilter: 'blur(12px)',
              border: '1px solid rgba(215,226,234,0.08)',
              borderRadius: '30px',
              padding: 'clamp(1.5rem, 4vw, 2.5rem)',
              maxWidth: '900px',
              width: '100%',
            }}
          >
            <motion.h2
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15, duration: 0.5 }}
              className="hero-heading font-black uppercase text-center mb-5"
              style={{ fontSize: 'clamp(2.5rem, 10vw, 100px)' }}
            >
              Projects
            </motion.h2>

            <div className="flex flex-col gap-4 max-h-[72vh] overflow-y-auto">
              {PROJECTS.map((project, i) => (
                <motion.div
                  key={project.num}
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.25 + i * 0.12, duration: 0.4 }}
                  style={{
                    background: 'rgba(215,226,234,0.03)',
                    border: '1px solid rgba(215,226,234,0.06)',
                    borderRadius: '20px',
                    padding: 'clamp(1rem, 3vw, 1.5rem)',
                  }}
                >
                  {/* Top row */}
                  <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <span
                        className="font-black text-[#D7E2EA] leading-none"
                        style={{ fontSize: 'clamp(1.5rem, 4vw, 56px)' }}
                      >
                        {project.num}
                      </span>
                      <span className="font-medium uppercase tracking-widest text-[#D7E2EA] text-xs opacity-60 border border-[#D7E2EA]/30 rounded-full px-3 py-1">
                        {project.category}
                      </span>
                      <span
                        className="font-black uppercase text-[#D7E2EA] leading-none"
                        style={{ fontSize: 'clamp(1rem, 3vw, 36px)' }}
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
                    className="text-[#D7E2EA] font-light leading-relaxed mb-4"
                    style={{ fontSize: 'clamp(0.78rem, 1.3vw, 1rem)', opacity: 0.7 }}
                  >
                    {project.desc}
                  </p>

                  {/* Visual grid */}
                  <div className="flex gap-3" style={{ height: 'clamp(140px, 18vw, 260px)' }}>
                    <div className="flex flex-col gap-3" style={{ flex: '0 0 40%' }}>
                      <div className="rounded-xl overflow-hidden flex-1">{project.visuals.leftTop}</div>
                      <div className="rounded-xl overflow-hidden flex-1">{project.visuals.leftBottom}</div>
                    </div>
                    <div className="flex-1 rounded-xl overflow-hidden">{project.visuals.right}</div>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
