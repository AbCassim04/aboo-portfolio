import * as THREE from 'three'

// Shared data for the navigation UI components (SystemMap, TargetMarker),
// written by the flight loop every frame. Kept out of the component files so
// fast refresh works.

/** Data the flight loop writes every frame while the map is open (world km). */
export interface MapData {
  simMs:    number
  pos:      Record<string, THREE.Vector3>
  /** Unit direction Earth → portfolio zone (spawn). */
  zoneDir:  THREE.Vector3
  ship:     THREE.Vector3
  /** Ship velocity relative to its host (direction only matters). */
  shipVel:  THREE.Vector3
  targetId: string | null
}

export function createMapData(): MapData {
  const pos: Record<string, THREE.Vector3> = {}
  for (const id of ['sun', 'mercury', 'venus', 'earth', 'moon', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune']) pos[id] = new THREE.Vector3()
  return { simMs: 0, pos, zoneDir: new THREE.Vector3(1, 0, 0), ship: new THREE.Vector3(), shipVel: new THREE.Vector3(), targetId: null }
}

/** Map layout as last drawn (debug hook / tests). */
export interface MapDebug {
  open: boolean; width: number; height: number; zoom: number
  items: { id: string; anchor: number[]; rect: number[]; clear: boolean }[]
}

/** Tappable map items, in layout priority order. */
export const MAP_ITEMS = ['sun', 'mercury', 'venus', 'earth', 'moon', 'zone', 'mars', 'belt', 'jupiter', 'saturn', 'uranus', 'neptune'] as const

export interface TargetMarkerDatum {
  visible:  boolean
  onScreen: boolean
  /** Reticle / arrow position (CSS px). */
  x:        number
  y:        number
  /** Arrow direction on screen (deg, 0 = right, 90 = down). */
  angle:    number
  name:     string
  dist:     string
}

export function createTargetMarkerDatum(): TargetMarkerDatum {
  return { visible: false, onScreen: false, x: 0, y: 0, angle: 0, name: '', dist: '' }
}
