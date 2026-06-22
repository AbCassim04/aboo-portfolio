import { useRef } from 'react'
import { useScroll, useMotionValueEvent } from 'framer-motion'
import SpaceCanvas from './components/SpaceCanvas'
import ScrollSpacer from './components/ScrollSpacer'
import HeroOverlay from './overlays/HeroOverlay'
import AboutOverlay from './overlays/AboutOverlay'
import SkillsOverlay from './overlays/SkillsOverlay'
import ProjectsOverlay from './overlays/ProjectsOverlay'
import FooterOverlay from './overlays/FooterOverlay'
import ScrollProgress from './overlays/ScrollProgress'

export default function App() {
  const scrollProgressRef = useRef(0)
  const { scrollYProgress } = useScroll()
  useMotionValueEvent(scrollYProgress, 'change', (v) => { scrollProgressRef.current = v })

  return (
    <div style={{ background: '#0C0C0C' }}>
      <SpaceCanvas scrollProgressRef={scrollProgressRef} />
      <ScrollSpacer />
      <HeroOverlay scrollProgress={scrollYProgress} />
      <AboutOverlay scrollProgress={scrollYProgress} />
      <SkillsOverlay scrollProgress={scrollYProgress} />
      <ProjectsOverlay scrollProgress={scrollYProgress} />
      <FooterOverlay scrollProgress={scrollYProgress} />
      <ScrollProgress scrollProgress={scrollYProgress} />
    </div>
  )
}
