import { AnimatePresence, motion } from 'framer-motion'
import FadeIn from '../components/FadeIn'
import ContactButton from '../components/ContactButton'
import Magnet from '../components/Magnet'
import type { Zone } from '../hooks/useCameraNavigation'

interface HeroOverlayProps {
  currentZone: Zone
  isTransitioning: boolean
  navigateTo: (zone: Zone) => void
  onTakeFlight: () => void
}

const NAV_LINKS: { label: string; zone: Zone }[] = [
  { label: 'About',    zone: 'about'    },
  { label: 'Projects', zone: 'projects' },
  { label: 'Skills',   zone: 'skills'   },
  { label: 'Contact',  zone: 'contact'  },
]

export default function HeroOverlay({ currentZone, isTransitioning, navigateTo, onTakeFlight }: HeroOverlayProps) {
  const visible = currentZone === 'hub' && !isTransitioning

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="hero-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
          style={{ position: 'fixed', inset: 0, zIndex: 10, display: 'flex', flexDirection: 'column' }}
        >
          <FadeIn delay={0} y={-20}>
            <nav className="flex justify-between px-6 md:px-10 pt-6 md:pt-8">
              {NAV_LINKS.map(({ label, zone }) => (
                <button
                  key={zone}
                  type="button"
                  onClick={() => navigateTo(zone)}
                  className="text-[#D7E2EA] font-medium uppercase tracking-wider text-sm md:text-lg lg:text-[1.4rem] transition-opacity duration-200 hover:opacity-70 cursor-pointer bg-transparent border-none py-3 px-4"
                >
                  {label}
                </button>
              ))}
            </nav>
          </FadeIn>

          <FadeIn delay={0.15} y={40} className="overflow-hidden pl-2 sm:pl-0">
            <h1 className="hero-heading font-black uppercase tracking-tight leading-none whitespace-nowrap w-full text-[14vw] sm:text-[15vw] md:text-[16vw] lg:text-[17.5vw] mt-6 sm:mt-4 md:-mt-5">
              Hi, i&apos;m aboo
            </h1>
          </FadeIn>

          <div className="mt-auto flex justify-between items-end pb-7 sm:pb-8 md:pb-10 px-6 md:px-10">
            <FadeIn delay={0.35} y={20}>
              <p
                className="text-[#D7E2EA] font-light uppercase tracking-wide leading-snug max-w-[160px] sm:max-w-[220px] md:max-w-[260px]"
                style={{ fontSize: 'clamp(0.75rem, 1.4vw, 1.5rem)' }}
              >
                a cs &amp; maths student building at the intersection of ml, research, and the web
              </p>
            </FadeIn>

            <FadeIn delay={0.7} y={20}>
              <motion.button
                type="button"
                onClick={onTakeFlight}
                style={{
                  border:          '1.5px solid rgba(119,33,177,0.5)',
                  background:      'rgba(119,33,177,0.08)',
                  backdropFilter:  'blur(8px)',
                  color:           '#D7E2EA',
                  borderRadius:    '999px',
                  padding:         '0.75rem 1.5rem',
                  fontSize:        '0.85rem',
                  fontWeight:      500,
                  textTransform:   'uppercase',
                  letterSpacing:   '0.15em',
                  cursor:          'pointer',
                }}
                whileHover={{ scale: 1.05, boxShadow: '0 0 20px rgba(119,33,177,0.5)' }}
                animate={{ boxShadow: ['0 0 0px rgba(119,33,177,0)', '0 0 15px rgba(119,33,177,0.4)', '0 0 0px rgba(119,33,177,0)'] }}
                transition={{ boxShadow: { duration: 2, repeat: Infinity } }}
              >
                🚀 Take Flight — Explore the universe
              </motion.button>
            </FadeIn>

            <FadeIn delay={0.5} y={20}>
              <Magnet padding={80} strength={4}>
                <a href="mailto:aboobakercassim@gmail.com" target="_blank" rel="noopener noreferrer">
                  <ContactButton />
                </a>
              </Magnet>
            </FadeIn>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
