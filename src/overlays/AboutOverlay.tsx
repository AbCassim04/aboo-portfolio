import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft } from 'lucide-react'
import type { Zone } from '../hooks/useCameraNavigation'

interface AboutOverlayProps {
  currentZone: Zone
  isTransitioning: boolean
  navigateTo: (zone: Zone) => void
}

const SENTENCES = [
  'Third-year Computer Science and Mathematics student at Wits University.',
  'I build full-stack products, conduct AI safety research, and apply deep mathematical thinking to real engineering problems.',
  'Currently exploring machine learning and mechanistic interpretability.',
  "Let's build something that matters.",
]

export default function AboutOverlay({ currentZone, isTransitioning, navigateTo }: AboutOverlayProps) {
  const visible = currentZone === 'about' && !isTransitioning

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="about-overlay"
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
              padding: 'clamp(2rem, 5vw, 3.5rem)',
              maxWidth: '560px',
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              gap: '1.5rem',
            }}
          >
            <motion.h2
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.5 }}
              className="hero-heading font-black uppercase text-center"
              style={{ fontSize: 'clamp(2.5rem, 10vw, 100px)' }}
            >
              About me
            </motion.h2>

            <div className="flex flex-col gap-3">
              {SENTENCES.map((sentence, i) => (
                <motion.p
                  key={i}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.35 + i * 0.15, duration: 0.4 }}
                  className="text-[#D7E2EA] font-medium text-center leading-relaxed"
                  style={{ fontSize: 'clamp(0.9rem, 1.8vw, 1.1rem)' }}
                >
                  {sentence}
                </motion.p>
              ))}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
