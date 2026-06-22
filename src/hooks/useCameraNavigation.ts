import { useRef, useState, useCallback } from 'react'

export type Zone = 'hub' | 'about' | 'skills' | 'projects' | 'contact'

export interface CameraTransitionState {
  from: { position: number[]; lookAt: number[]; fov: number }
  to:   { position: number[]; lookAt: number[]; fov: number }
  toZone: string
  progress: number
  active: boolean
}

interface CameraConfig {
  position: number[]
  lookAt: number[]
  fov: number
}

const ZONE_CAMERAS: Record<Zone, CameraConfig> = {
  hub:      { position: [0, 0, 18],    lookAt: [0, 0, 0],     fov: 60 },
  about:    { position: [-8, 2, 4],    lookAt: [-12, 2, 0],   fov: 50 },
  skills:   { position: [8, -1, 4],    lookAt: [12, -1, 0],   fov: 50 },
  projects: { position: [0, 6, 4],     lookAt: [0, 10, 0],    fov: 50 },
  contact:  { position: [0, -6, 4],    lookAt: [0, -10, 0],   fov: 50 },
}

export function useCameraNavigation() {
  const [currentZone, setCurrentZone] = useState<Zone>('hub')
  const [isTransitioning, setIsTransitioning] = useState(false)

  const targetZoneRef = useRef<Zone>('hub')
  const currentZoneForFrom = useRef<Zone>('hub')

  const cameraStateRef = useRef<CameraTransitionState>({
    from:    { position: ZONE_CAMERAS.hub.position, lookAt: ZONE_CAMERAS.hub.lookAt, fov: ZONE_CAMERAS.hub.fov },
    to:      { position: ZONE_CAMERAS.hub.position, lookAt: ZONE_CAMERAS.hub.lookAt, fov: ZONE_CAMERAS.hub.fov },
    toZone:  'hub',
    progress: 1,
    active:   false,
  })

  const navigateTo = useCallback((zone: Zone) => {
    const fromCam = ZONE_CAMERAS[currentZoneForFrom.current]
    const toCam   = ZONE_CAMERAS[zone]
    targetZoneRef.current = zone
    setIsTransitioning(true)
    cameraStateRef.current = {
      from:    { position: fromCam.position, lookAt: fromCam.lookAt, fov: fromCam.fov },
      to:      { position: toCam.position,   lookAt: toCam.lookAt,   fov: toCam.fov },
      toZone:  zone,
      progress: 0,
      active:   true,
    }
  }, [])

  const onTransitionComplete = useCallback(() => {
    const target = targetZoneRef.current
    currentZoneForFrom.current = target
    setCurrentZone(target)
    setIsTransitioning(false)
  }, [])

  // Keep currentZoneForFrom in sync so navigateTo always captures correct 'from'
  currentZoneForFrom.current = currentZone

  return { currentZone, isTransitioning, navigateTo, cameraStateRef, onTransitionComplete }
}
