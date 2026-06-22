import { useState } from 'react'
import { motion, useTransform, useMotionValueEvent, type MotionValue } from 'framer-motion'
import { Code2, ExternalLink, Mail } from 'lucide-react'

interface FooterOverlayProps {
  scrollProgress: MotionValue<number>
}

const LINKS = [
  { label: 'GitHub',   href: 'https://github.com/AbCassim04',              Icon: Code2 },
  { label: 'LinkedIn', href: 'https://linkedin.com/in/aboobaker-cassim',   Icon: ExternalLink },
  { label: 'Email',    href: 'mailto:cassimaboo3@gmail.com',               Icon: Mail },
]

export default function FooterOverlay({ scrollProgress }: FooterOverlayProps) {
  const opacity = useTransform(scrollProgress, [0.90, 0.94], [0, 1])
  const [interactive, setInteractive] = useState(false)
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
        alignItems: 'center',
        justifyContent: 'center',
        gap: '2rem',
        background: 'rgba(12, 12, 12, 0.80)',
        backdropFilter: 'blur(6px)',
      }}
    >
      <span
        className="hero-heading font-black uppercase"
        style={{ fontSize: 'clamp(2rem, 5vw, 4rem)' }}
      >
        Aboo
      </span>

      <div className="flex items-center gap-8">
        {LINKS.map(({ label, href, Icon }) => (
          <a
            key={label}
            href={href}
            target={href.startsWith('mailto') ? undefined : '_blank'}
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-[#D7E2EA] text-sm uppercase tracking-widest transition-opacity duration-200 hover:opacity-70"
          >
            <Icon size={16} />
            {label}
          </a>
        ))}
      </div>

      <p className="text-[#D7E2EA] text-xs" style={{ opacity: 0.4 }}>
        © 2026 Aboobaker Cassim · Built with React &amp; Vite
      </p>
    </motion.div>
  )
}
