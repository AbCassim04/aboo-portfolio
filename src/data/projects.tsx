import {
  SwapifyUIPreview, SwapifyDBSchema, SwapifyDashboard,
  AIBarChart, AIAfrikaans, AIPipeline,
} from '../components/ProjectVisuals'

// ── Projects data ──────────────────────────────────────────────────────────
// Kept separate from ProjectVisuals.tsx so that file exports only components
// (required for Vite fast refresh).

export const PROJECTS = [
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
