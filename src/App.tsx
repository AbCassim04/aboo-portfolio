import { useCameraNavigation } from './hooks/useCameraNavigation'
import SpaceCanvas from './components/SpaceCanvas'
import HeroOverlay from './overlays/HeroOverlay'
import AboutOverlay from './overlays/AboutOverlay'
import SkillsOverlay from './overlays/SkillsOverlay'
import ProjectsOverlay from './overlays/ProjectsOverlay'
import ContactOverlay from './overlays/ContactOverlay'

export default function App() {
  const { currentZone, isTransitioning, navigateTo, cameraStateRef, onTransitionComplete } = useCameraNavigation()

  return (
    <div style={{ position: 'fixed', inset: 0, width: '100vw', height: '100vh', overflow: 'hidden', background: '#0C0C0C' }}>
      <SpaceCanvas
        cameraStateRef={cameraStateRef}
        currentZone={currentZone}
        onTransitionComplete={onTransitionComplete}
      />
      <HeroOverlay     currentZone={currentZone} isTransitioning={isTransitioning} navigateTo={navigateTo} />
      <AboutOverlay    currentZone={currentZone} isTransitioning={isTransitioning} navigateTo={navigateTo} />
      <SkillsOverlay   currentZone={currentZone} isTransitioning={isTransitioning} navigateTo={navigateTo} />
      <ProjectsOverlay currentZone={currentZone} isTransitioning={isTransitioning} navigateTo={navigateTo} />
      <ContactOverlay  currentZone={currentZone} isTransitioning={isTransitioning} navigateTo={navigateTo} />
    </div>
  )
}
