import { useCameraNavigation } from '../hooks/useCameraNavigation'
import SpaceCanvas   from '../components/SpaceCanvas'
import HeroOverlay   from '../overlays/HeroOverlay'
import AboutOverlay  from '../overlays/AboutOverlay'
import SkillsOverlay from '../overlays/SkillsOverlay'
import ProjectsOverlay from '../overlays/ProjectsOverlay'
import ContactOverlay  from '../overlays/ContactOverlay'

interface HubModeProps {
  onTakeFlight: () => void
}

export default function HubMode({ onTakeFlight }: HubModeProps) {
  const {
    currentZone,
    isTransitioning,
    navigateTo,
    cameraStateRef,
    onTransitionComplete,
  } = useCameraNavigation()

  return (
    <>
      <SpaceCanvas
        cameraStateRef={cameraStateRef}
        currentZone={currentZone}
        onTransitionComplete={onTransitionComplete}
        navigateTo={navigateTo}
      />
      <HeroOverlay
        currentZone={currentZone}
        isTransitioning={isTransitioning}
        navigateTo={navigateTo}
        onTakeFlight={onTakeFlight}
      />
      <AboutOverlay    currentZone={currentZone} isTransitioning={isTransitioning} navigateTo={navigateTo} />
      <SkillsOverlay   currentZone={currentZone} isTransitioning={isTransitioning} navigateTo={navigateTo} />
      <ProjectsOverlay currentZone={currentZone} isTransitioning={isTransitioning} navigateTo={navigateTo} />
      <ContactOverlay  currentZone={currentZone} isTransitioning={isTransitioning} navigateTo={navigateTo} />
    </>
  )
}
