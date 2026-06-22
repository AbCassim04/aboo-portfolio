import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft } from 'lucide-react'
import type { Zone } from '../hooks/useCameraNavigation'

interface SkillsOverlayProps {
  currentZone: Zone
  isTransitioning: boolean
  navigateTo: (zone: Zone) => void
}

const SKILLS = [
  {
    num: '01',
    name: 'Full-Stack Engineering',
    desc: 'React, Node.js, PostgreSQL, REST APIs, Clerk auth, PayFast integration, Railway and Vercel deployment, GitHub Actions CI/CD.',
  },
  {
    num: '02',
    name: 'Machine Learning',
    desc: 'Structured ML pipelines, model evaluation, benchmark design, and applying mathematical rigour to data problems.',
  },
  {
    num: '03',
    name: 'AI Safety Research',
    desc: 'Multilingual LLM evaluation, benchmark fairness for African languages, LLM-as-judge pipelines, measurement artefact analysis.',
  },
  {
    num: '04',
    name: 'Mathematics',
    desc: 'Real Analysis, Group Theory, Number Theory — deep mathematical foundation applied to engineering and research.',
  },
  {
    num: '05',
    name: 'Problem Solving',
    desc: 'Building things that actually work. From schema design to deployment, I own the full stack and ship.',
  },
]

export default function SkillsOverlay({ currentZone, isTransitioning, navigateTo }: SkillsOverlayProps) {
  const visible = currentZone === 'skills' && !isTransitioning

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="skills-overlay"
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          style={{ position: 'fixed', inset: 0, zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '1.5rem' }}
        >
          {/* Back button */}
          <div className="absolute top-6 left-6 md:top-8 md:left-8">
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

          {/* Content card */}
          <div
            style={{
              background: 'rgba(12, 12, 12, 0.5)',
              backdropFilter: 'blur(12px)',
              border: '1px solid rgba(215,226,234,0.08)',
              borderRadius: '30px',
              padding: 'clamp(2rem, 5vw, 3rem)',
              maxWidth: '800px',
              width: '100%',
            }}
          >
            <motion.h2
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15, duration: 0.5 }}
              className="hero-heading font-black uppercase text-center mb-6"
              style={{ fontSize: 'clamp(2.5rem, 10vw, 100px)' }}
            >
              Skills
            </motion.h2>

            <div className="max-h-[60vh] overflow-y-auto">
              {SKILLS.map((skill, i) => (
                <motion.div
                  key={skill.num}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.25 + i * 0.1, duration: 0.35 }}
                  className="flex gap-4 md:gap-6 items-start py-4 sm:py-5"
                  style={{ borderTop: '1px solid rgba(215,226,234,0.12)' }}
                >
                  <span
                    className="font-black text-[#D7E2EA] leading-none flex-shrink-0"
                    style={{ fontSize: 'clamp(1.5rem, 4vw, 3.5rem)', opacity: 0.25 }}
                  >
                    {skill.num}
                  </span>
                  <div className="flex flex-col gap-1 pt-1">
                    <span
                      className="font-medium uppercase text-[#D7E2EA]"
                      style={{ fontSize: 'clamp(0.85rem, 1.8vw, 1.4rem)' }}
                    >
                      {skill.name}
                    </span>
                    <p
                      className="font-light leading-relaxed text-[#D7E2EA]"
                      style={{ fontSize: 'clamp(0.75rem, 1.2vw, 0.95rem)', opacity: 0.55 }}
                    >
                      {skill.desc}
                    </p>
                  </div>
                </motion.div>
              ))}
              <div style={{ borderTop: '1px solid rgba(215,226,234,0.12)' }} />
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
