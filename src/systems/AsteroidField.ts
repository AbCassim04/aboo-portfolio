import * as THREE from 'three'

export interface AsteroidFieldConfig {
  innerRadius:      number
  outerRadius:      number
  count:            number
  countMobile:      number
  height:           number
  minScale:         number
  maxScale:         number
  seed:             number
  centerX:          number
  centerY:          number
  centerZ:          number
  color:            number
  rotationSpeed:    number
  inclination:      number
}

function seededRandom(seed: number) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff
    return (s >>> 0) / 0xffffffff
  }
}

export class AsteroidField {
  private mesh:   THREE.InstancedMesh
  private config: AsteroidFieldConfig
  private dummy:  THREE.Object3D

  constructor(config: AsteroidFieldConfig, isMobile: boolean) {
    this.config = config
    this.dummy  = new THREE.Object3D()

    const count = isMobile ? config.countMobile : config.count
    const rand  = seededRandom(config.seed)

    const baseGeo = new THREE.IcosahedronGeometry(1, 1)
    const pos     = baseGeo.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < pos.count; i++) {
      pos.setXYZ(
        i,
        pos.getX(i) * (0.75 + rand() * 0.5),
        pos.getY(i) * (0.75 + rand() * 0.5),
        pos.getZ(i) * (0.75 + rand() * 0.5),
      )
    }
    pos.needsUpdate = true
    baseGeo.computeVertexNormals()

    const mat = new THREE.MeshStandardMaterial({
      color:       config.color,
      roughness:   0.95,
      metalness:   0.05,
      flatShading: true,
    })

    this.mesh = new THREE.InstancedMesh(baseGeo, mat, count)
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)

    const incl = config.inclination
    for (let i = 0; i < count; i++) {
      const angle  = rand() * Math.PI * 2
      const radius = config.innerRadius + rand() * (config.outerRadius - config.innerRadius)

      const xFlat = Math.cos(angle) * radius
      const zFlat = Math.sin(angle) * radius
      const y     = (rand() - 0.5) * config.height + Math.sin(incl) * xFlat * 0.1

      this.dummy.position.set(
        config.centerX + xFlat,
        config.centerY + y,
        config.centerZ + zFlat,
      )

      this.dummy.rotation.set(
        rand() * Math.PI * 2,
        rand() * Math.PI * 2,
        rand() * Math.PI * 2,
      )

      const t     = rand()
      const scale = config.minScale + Math.pow(t, 3) * (config.maxScale - config.minScale)
      this.dummy.scale.setScalar(scale)
      this.dummy.updateMatrix()
      this.mesh.setMatrixAt(i, this.dummy.matrix)
    }

    this.mesh.instanceMatrix.needsUpdate = true
  }

  addToScene(scene: THREE.Scene): void {
    scene.add(this.mesh)
  }

  update(): void {
    this.mesh.rotation.y += this.config.rotationSpeed
  }

  dispose(): void {
    this.mesh.geometry.dispose()
    ;(this.mesh.material as THREE.Material).dispose()
  }

  getMesh(): THREE.InstancedMesh {
    return this.mesh
  }
}

// ── Pre-defined field configurations ──────────────────────────────────────────

export const MAIN_BELT_CONFIG: AsteroidFieldConfig = {
  innerRadius:   470,
  outerRadius:   650,
  count:         3000,
  countMobile:   500,
  height:        40,
  minScale:      1,
  maxScale:      12,
  seed:          42,
  centerX:       0,
  centerY:       0,
  centerZ:       0,
  color:         0x8a7a6a,
  rotationSpeed: 0.00003,
  inclination:   0.035,
}
