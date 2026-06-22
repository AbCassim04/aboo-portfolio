import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, Code2, ExternalLink, Mail } from 'lucide-react'
import type { Zone } from '../hooks/useCameraNavigation'

interface ContactOverlayProps {
  currentZone: Zone
  isTransitioning: boolean
  navigateTo: (zone: Zone) => void
}

const LINKS = [
  { label: 'GitHub',   href: 'https://github.com/AbCassim04',            Icon: Code2        },
  { label: 'LinkedIn', href: 'https://linkedin.com/in/aboobaker-cassim', Icon: ExternalLink },
  { label: 'Email',    href: 'mailto:aboobakercassim@gmail.com',         Icon: Mail         },
]

export default function ContactOverlay({ currentZone, isTransitioning, navigateTo }: ContactOverlayProps) {
  const visible = currentZone === 'contact' && !isTransitioning

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="contact-overlay"
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
              padding: 'clamp(2.5rem, 6vw, 4rem)',
              maxWidth: '480px',
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '1.75rem',
              textAlign: 'center',
            }}
          >
            <motion.p
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.4 }}
              className="text-[#D7E2EA] font-light text-lg"
              style={{ opacity: 0.7 }}
            >
              Want to work together?
            </motion.p>

            <motion.span
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3, duration: 0.45 }}
              className="hero-heading font-black uppercase"
              style={{ fontSize: 'clamp(2.5rem, 8vw, 5rem)' }}
            >
              Aboo
            </motion.span>

            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.45, duration: 0.4 }}
              className="flex items-center gap-8"
            >
              {LINKS.map(({ label, href, Icon }) => (
                <a
                  key={label}
                  href={href}
                  target={href.startsWith('mailto') ? undefined : '_blank'}
                  rel="noopener noreferrer"
                  className="flex flex-col items-center gap-2 text-[#D7E2EA] text-xs uppercase tracking-widest transition-opacity duration-200 hover:opacity-70 cursor-pointer"
                >
                  <Icon size={20} />
                  {label}
                </a>
              ))}
            </motion.div>

            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.6, duration: 0.4 }}
              className="text-[#D7E2EA] text-xs"
              style={{ opacity: 0.3 }}
            >
              © 2026 Aboobaker Cassim
            </motion.p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
