import { Code2, ExternalLink, Mail } from 'lucide-react'

const LINKS = [
  {
    label: 'GitHub',
    href: 'https://github.com/AbCassim04',
    Icon: Code2,
  },
  {
    label: 'LinkedIn',
    href: 'https://linkedin.com/in/aboobaker-cassim',
    Icon: ExternalLink,
  },
  {
    label: 'Email',
    href: 'mailto:cassimaboo3@gmail.com',
    Icon: Mail,
  },
]

export default function FooterSection() {
  return (
    <footer
      id="contact"
      className="py-16 flex flex-col items-center gap-8"
      style={{ background: '#0C0C0C' }}
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
    </footer>
  )
}
