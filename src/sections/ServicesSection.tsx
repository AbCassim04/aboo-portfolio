import FadeIn from '../components/FadeIn'

const SERVICES = [
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

export default function ServicesSection() {
  return (
    <section
      id="skills"
      className="rounded-t-[40px] sm:rounded-t-[50px] md:rounded-t-[60px] px-5 sm:px-8 md:px-10 py-20 sm:py-24 md:py-32"
      style={{ background: '#FFFFFF' }}
    >
      <h2
        className="font-black uppercase text-center text-[#0C0C0C] mb-16 sm:mb-20 md:mb-28"
        style={{ fontSize: 'clamp(3rem, 12vw, 160px)' }}
      >
        Skills
      </h2>

      <div className="max-w-5xl mx-auto">
        {SERVICES.map((svc, i) => (
          <FadeIn key={svc.num} delay={i * 0.1}>
            <div
              className="flex gap-6 md:gap-10 items-start py-8 sm:py-10 md:py-12"
              style={{ borderTop: '1px solid rgba(12,12,12,0.15)' }}
            >
              <span
                className="font-black text-[#0C0C0C] leading-none flex-shrink-0"
                style={{ fontSize: 'clamp(3rem, 10vw, 140px)' }}
              >
                {svc.num}
              </span>
              <div className="flex flex-col gap-2 pt-2">
                <span
                  className="font-medium uppercase text-[#0C0C0C]"
                  style={{ fontSize: 'clamp(1rem, 2.2vw, 2.1rem)' }}
                >
                  {svc.name}
                </span>
                <p
                  className="font-light leading-relaxed max-w-2xl text-[#0C0C0C]"
                  style={{
                    fontSize: 'clamp(0.85rem, 1.6vw, 1.25rem)',
                    opacity: 0.6,
                  }}
                >
                  {svc.desc}
                </p>
              </div>
            </div>
          </FadeIn>
        ))}
        <div style={{ borderTop: '1px solid rgba(12,12,12,0.15)' }} />
      </div>
    </section>
  )
}
