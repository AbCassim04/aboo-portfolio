import { useRef } from 'react'
import { useScroll, useTransform, motion } from 'framer-motion'
import LiveProjectButton from '../components/LiveProjectButton'

// ── Swapify mocks ──────────────────────────────────────────────────────────

function SwapifyUIPreview() {
  return (
    <div style={{ width: '100%', height: '100%', background: '#0d0d1a', padding: '8px', boxSizing: 'border-box', fontFamily: 'monospace', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', paddingBottom: '6px', marginBottom: '6px', borderBottom: '1px solid rgba(119,33,177,0.2)', flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: '3px' }}>
          {['#ff5f56', '#ffbd2e', '#27c93f'].map(c => (
            <div key={c} style={{ width: '5px', height: '5px', borderRadius: '50%', background: c }} />
          ))}
        </div>
        <span style={{ color: '#7721B1', fontSize: '9px', fontWeight: 700 }}>Swapify</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flex: 1 }}>
        {[
          { title: 'Campus Hoodie', price: 'R120', color: '#7721B1' },
          { title: 'MacBook Sleeve', price: 'R85', color: '#3B8BD4' },
        ].map((item, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div style={{ width: '22px', height: '22px', borderRadius: '4px', background: item.color, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: '#D7E2EA', fontSize: '8px', marginBottom: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</div>
              <div style={{ color: '#7721B1', fontSize: '8px', fontWeight: 700 }}>{item.price}</div>
            </div>
            <div style={{ background: 'rgba(119,33,177,0.15)', border: '1px solid rgba(119,33,177,0.35)', borderRadius: '3px', padding: '1px 4px', color: '#7721B1', fontSize: '7px', flexShrink: 0 }}>active</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function SwapifyDBSchema() {
  return (
    <div style={{ width: '100%', height: '100%', background: '#0a0a1a', padding: '8px', boxSizing: 'border-box', position: 'relative', fontFamily: 'monospace', display: 'flex', flexDirection: 'column' }}>
      <span style={{ position: 'absolute', top: '8px', right: '8px', color: '#7721B1', fontSize: '7px', opacity: 0.7 }}>PostgreSQL</span>
      <div style={{ border: '1px solid rgba(119,33,177,0.3)', borderRadius: '5px', overflow: 'hidden', marginTop: '6px', boxShadow: '0 0 12px rgba(119,33,177,0.1)', flex: 1 }}>
        <div style={{ display: 'flex', padding: '4px 6px', borderBottom: '1px solid rgba(119,33,177,0.3)', background: 'rgba(119,33,177,0.1)' }}>
          {['id', 'user_id', 'title', 'price', 'status'].map((h, i) => (
            <span key={h} style={{ color: '#7721B1', fontSize: '7px', fontWeight: 700, flex: i === 2 ? 2 : 1 }}>{h}</span>
          ))}
        </div>
        {[
          ['001', 'usr_x2k', 'Campus Hoodie', 'R120', 'active'],
          ['002', 'usr_m9p', 'MacBook Sleeve', 'R85', 'sold'],
          ['003', 'usr_k3z', 'Study Notes', 'R40', 'active'],
        ].map((row, i) => (
          <div key={i} style={{ display: 'flex', padding: '4px 6px', borderBottom: i < 2 ? '1px solid rgba(215,226,234,0.05)' : 'none', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
            {row.map((cell, j) => (
              <span key={j} style={{ color: '#D7E2EA', fontSize: '7px', opacity: 0.7, flex: j === 2 ? 2 : 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cell}</span>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

function SwapifyDashboard() {
  return (
    <div style={{ width: '100%', height: '100%', background: 'linear-gradient(135deg, #1a0a2e 0%, #0a1a3a 100%)', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'monospace' }}>
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundImage: 'linear-gradient(rgba(119,33,177,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(119,33,177,0.05) 1px, transparent 1px)', backgroundSize: '24px 24px' }} />
      <div style={{ position: 'absolute', top: '10%', left: '5%', color: '#7721B1', fontSize: '8px', opacity: 0.4, lineHeight: 1.8 }}>
        const [items, setItems]<br />= useState([])<br />useEffect(() =&gt; {'{'}
      </div>
      <div style={{ position: 'absolute', bottom: '12%', right: '4%', color: '#7721B1', fontSize: '8px', opacity: 0.4, lineHeight: 1.8, textAlign: 'right' }}>
        app.get('/api/listings'<br />await db.query(<br />`SELECT * FROM`
      </div>
      <div style={{ position: 'absolute', top: '55%', left: '8%', color: '#3B8BD4', fontSize: '7px', opacity: 0.3 }}>
        POST /api/checkout
      </div>
      <span style={{ position: 'relative', zIndex: 1, color: '#D7E2EA', fontSize: '24px', fontWeight: 900, letterSpacing: '0.1em', textTransform: 'uppercase', textShadow: '0 0 20px rgba(119,33,177,0.5)' }}>Swapify</span>
    </div>
  )
}

// ── AI Safety mocks ────────────────────────────────────────────────────────

function AIBarChart() {
  const kwHeights = [18, 14, 22, 16, 12]
  const llmHeights = [50, 54, 48, 56, 52]
  return (
    <div style={{ width: '100%', height: '100%', background: '#0a0a1a', padding: '8px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', fontFamily: 'monospace' }}>
      <span style={{ color: '#D7E2EA', fontSize: '8px', opacity: 0.8, flexShrink: 0, marginBottom: '6px' }}>Keyword vs LLM Judge</span>
      <div style={{ flex: 1, display: 'flex', gap: '8px', alignItems: 'stretch', minHeight: 0 }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: 1, display: 'flex', gap: '2px', alignItems: 'flex-end' }}>
            {kwHeights.map((h, i) => (
              <div key={i} style={{ flex: 1, height: `${h}px`, background: 'rgba(239,68,68,0.75)', borderRadius: '2px 2px 0 0' }} />
            ))}
          </div>
          <div style={{ height: '1px', background: 'rgba(215,226,234,0.15)', margin: '2px 0' }} />
          <span style={{ color: '#ef4444', fontSize: '6px', textAlign: 'center', flexShrink: 0 }}>Keyword</span>
        </div>
        <div style={{ width: '1px', background: 'rgba(215,226,234,0.08)', flexShrink: 0 }} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: 1, display: 'flex', gap: '2px', alignItems: 'flex-end' }}>
            {llmHeights.map((h, i) => (
              <div key={i} style={{ flex: 1, height: `${h}px`, background: 'rgba(119,33,177,0.8)', borderRadius: '2px 2px 0 0' }} />
            ))}
          </div>
          <div style={{ height: '1px', background: 'rgba(215,226,234,0.15)', margin: '2px 0' }} />
          <span style={{ color: '#7721B1', fontSize: '6px', textAlign: 'center', flexShrink: 0 }}>LLM Judge</span>
        </div>
      </div>
    </div>
  )
}

function AIAfrikaans() {
  const lines = [
    'Die leerder moet die vraag beantwoord...',
    'Watter metode gebruik die ondersoeker?',
    'Bespreek die impak van tegnologie op...',
  ]
  return (
    <div style={{ width: '100%', height: '100%', background: '#080818', padding: '8px', boxSizing: 'border-box', position: 'relative', fontFamily: 'monospace', display: 'flex', flexDirection: 'column' }}>
      <span style={{ position: 'absolute', top: '8px', right: '8px', color: '#7721B1', fontSize: '7px', opacity: 0.7 }}>Afrikaans DBE Evals</span>
      <div style={{ marginTop: '4px', display: 'flex', flexDirection: 'column', gap: '8px', flex: 1 }}>
        {lines.map((line, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '6px' }}>
            <span style={{ color: '#D7E2EA', fontSize: '7px', opacity: 0.6, flex: 1, lineHeight: 1.4 }}>{line}</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', flexShrink: 0 }}>
              <span style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.35)', color: '#ef4444', fontSize: '6px', padding: '1px 4px', borderRadius: '3px', textAlign: 'center' }}>12%</span>
              <span style={{ background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.35)', color: '#22c55e', fontSize: '6px', padding: '1px 4px', borderRadius: '3px', textAlign: 'center' }}>89%</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function AIPipeline() {
  const steps = [
    { label: 'DBE EXAM PDF', color: '#3B8BD4' },
    { label: 'LLM GENERATE', color: '#7721B1' },
    { label: 'LLM JUDGE', color: '#3B8BD4' },
    { label: 'BENCHMARK SCORE', color: '#7721B1' },
  ]
  return (
    <div style={{ width: '100%', height: '100%', background: 'linear-gradient(135deg, #0a1a2e 0%, #1a0a2e 100%)', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'monospace' }}>
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundImage: 'linear-gradient(rgba(59,139,212,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(59,139,212,0.05) 1px, transparent 1px)', backgroundSize: '24px 24px' }} />
      <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        {steps.map((step, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div style={{ border: `1px solid ${step.color}`, borderRadius: '6px', padding: '5px 14px', color: step.color, fontSize: '8px', letterSpacing: '0.08em', fontWeight: 700, background: `${step.color}18`, boxShadow: `0 0 10px ${step.color}25`, minWidth: '120px', textAlign: 'center' }}>
              {step.label}
            </div>
            {i < steps.length - 1 && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div style={{ width: '1px', height: '8px', background: `${steps[i + 1].color}60` }} />
                <span style={{ color: `${steps[i + 1].color}99`, fontSize: '8px', lineHeight: 1 }}>▼</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Data ───────────────────────────────────────────────────────────────────

const PROJECTS = [
  {
    num: '01',
    name: 'Swapify',
    category: 'Full-Stack · 2025',
    desc: 'Campus marketplace built with React, Node.js, PostgreSQL, Clerk auth, and PayFast payments. Deployed on Railway and Vercel with GitHub Actions CI/CD.',
    href: 'https://github.com/AbCassim04/swapify',
    visuals: {
      leftTop: <SwapifyUIPreview />,
      leftBottom: <SwapifyDBSchema />,
      right: <SwapifyDashboard />,
    },
  },
  {
    num: '02',
    name: 'AI Safety Research',
    category: 'Research · 2026',
    desc: 'Investigated whether multilingual LLM benchmarks manufacture apparent performance inequity through flawed scoring. Submitted to Apart Research Global South AI Safety Hackathon 2026.',
    href: 'https://github.com/AbCassim04',
    visuals: {
      leftTop: <AIBarChart />,
      leftBottom: <AIAfrikaans />,
      right: <AIPipeline />,
    },
  },
]

// ── Card ───────────────────────────────────────────────────────────────────

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
              className="rounded-2xl overflow-hidden"
              style={{ height: 'clamp(110px, 14vw, 210px)' }}
            >
              {project.visuals.leftTop}
            </div>
            <div
              className="rounded-2xl flex-1 overflow-hidden"
              style={{ minHeight: 'clamp(140px, 20vw, 300px)' }}
            >
              {project.visuals.leftBottom}
            </div>
          </div>
          {/* Right col — 60% */}
          <div className="flex-1">
            <div className="h-full rounded-2xl overflow-hidden">
              {project.visuals.right}
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  )
}

// ── Section ────────────────────────────────────────────────────────────────

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
