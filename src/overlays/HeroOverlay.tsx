import { useState } from 'react'
import { motion, useTransform, useMotionValueEvent, type MotionValue } from 'framer-motion'
import FadeIn from '../components/FadeIn'
import ContactButton from '../components/ContactButton'
import Magnet from '../components/Magnet'

interface HeroOverlayProps {
  scrollProgress: MotionValue<number>
}

const NAV_LINKS = [
  { label: 'About', pct: 0.25 },
  { label: 'Projects', pct: 0.62 },
  { label: 'Skills', pct: 0.48 },
  { label: 'Contact', pct: 0.92 },
]

function scrollTo(pct: number) {
  const maxScroll = document.documentElement.scrollHeight - window.innerHeight
  window.scrollTo({ top: pct * maxScroll, behavior: 'smooth' })
}

export default function HeroOverlay({ scrollProgress }: HeroOverlayProps) {
  const opacity = useTransform(scrollProgress, [0, 0.09, 0.12], [1, 1, 0])
  const [interactive, setInteractive] = useState(true)
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
        flexDirection: 'column',
      }}
    >
      <FadeIn delay={0} y={-20}>
        <nav className="flex justify-between px-6 md:px-10 pt-6 md:pt-8">
          {NAV_LINKS.map(({ label, pct }) => (
            <button
              key={label}
              type="button"
              onClick={() => scrollTo(pct)}
              className="text-[#D7E2EA] font-medium uppercase tracking-wider text-sm md:text-lg lg:text-[1.4rem] transition-opacity duration-200 hover:opacity-70 cursor-pointer bg-transparent border-none"
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
        <FadeIn delay={0.5} y={20}>
          <Magnet padding={80} strength={4}>
            <a href="mailto:aboobakercassim@gmail.com" target="_blank" rel="noopener noreferrer">
              <ContactButton />
            </a>
          </Magnet>
        </FadeIn>
      </div>
    </motion.div>
  )
}
