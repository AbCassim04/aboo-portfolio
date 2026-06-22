import { useState } from 'react'
import { motion, useTransform, useMotionValueEvent, type MotionValue } from 'framer-motion'

interface SkillsOverlayProps {
  scrollProgress: MotionValue<number>
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

export default function SkillsOverlay({ scrollProgress }: SkillsOverlayProps) {
  const opacity = useTransform(scrollProgress, [0.45, 0.50, 0.57, 0.62], [0, 1, 1, 0])
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
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
      }}
    >
      <div
        style={{
          background: 'rgba(12, 12, 12, 0.80)',
          backdropFilter: 'blur(4px)',
          borderRadius: '24px',
          padding: 'clamp(1.5rem, 4vw, 3rem)',
          maxWidth: '800px',
          width: '100%',
          border: '1px solid rgba(215,226,234,0.08)',
        }}
      >
        <h2
          className="hero-heading font-black uppercase text-center mb-6 sm:mb-8"
          style={{ fontSize: 'clamp(2.5rem, 10vw, 120px)' }}
        >
          Skills
        </h2>

        <div>
          {SKILLS.map((skill) => (
            <div
              key={skill.num}
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
            </div>
          ))}
          <div style={{ borderTop: '1px solid rgba(215,226,234,0.12)' }} />
          <p
            className="text-center text-[#D7E2EA] font-light mt-3"
            style={{ fontSize: 'clamp(0.65rem, 1vw, 0.8rem)', opacity: 0.3 }}
          >
            {SKILLS.length} disciplines · Wits University · 2024–present
          </p>
        </div>
      </div>
    </motion.div>
  )
}
