import { lazy, Suspense } from 'react'
import FadeIn from '../components/FadeIn'
import ContactButton from '../components/ContactButton'
import Magnet from '../components/Magnet'

const HeroScene = lazy(() => import('../components/HeroScene'))

const NAV_LINKS = [
  { label: 'About', href: '#about' },
  { label: 'Projects', href: '#projects' },
  { label: 'Skills', href: '#skills' },
  { label: 'Contact', href: '#contact' },
]

export default function HeroSection() {
  return (
    <section
      className="h-screen flex flex-col relative"
      style={{ overflowX: 'clip', background: '#0C0C0C' }}
    >
      {/* Full-viewport 3D background */}
      <div className="absolute inset-0 w-full h-full" style={{ zIndex: 0 }}>
        <Suspense fallback={null}>
          <HeroScene />
        </Suspense>
      </div>

      {/* All hero content sits above the scene */}
      <div className="relative flex flex-col h-full" style={{ zIndex: 10 }}>
        {/* Navbar */}
        <FadeIn delay={0} y={-20}>
          <nav className="flex justify-between px-6 md:px-10 pt-6 md:pt-8">
            {NAV_LINKS.map(({ label, href }) => (
              <a
                key={label}
                href={href}
                className="text-[#D7E2EA] font-medium uppercase tracking-wider text-sm md:text-lg lg:text-[1.4rem] transition-opacity duration-200 hover:opacity-70"
              >
                {label}
              </a>
            ))}
          </nav>
        </FadeIn>

        {/* Hero Heading */}
        <FadeIn delay={0.15} y={40} className="overflow-hidden pl-2 sm:pl-0">
          <h1
            className="hero-heading font-black uppercase tracking-tight leading-none whitespace-nowrap w-full text-[14vw] sm:text-[15vw] md:text-[16vw] lg:text-[17.5vw] mt-6 sm:mt-4 md:-mt-5"
          >
            Hi, i&apos;m aboo
          </h1>
        </FadeIn>

        {/* Bottom bar */}
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
      </div>
    </section>
  )
}
