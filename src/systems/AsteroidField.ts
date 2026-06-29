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

interface AsteroidOrbit {
  semiMajorAxis:   number
  eccentricity:    number
  inclination:     number
  longitudeAN:     number
  argPeriapsis:    number
  meanAnomaly:     number
  speed:           number
}

function seededRandom(seed: number) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff
    return (s >>> 0) / 0xffffffff
  }
}

export class AsteroidField {
  private mesh:    THREE.InstancedMesh
  private config:  AsteroidFieldConfig
  private dummy:   THREE.Object3D
  private orbits:  AsteroidOrbit[]
  private time:    number = 0
  private isMobile: boolean

  constructor(config: AsteroidFieldConfig, isMobile: boolean) {
    this.config   = config
    this.isMobile = isMobile
    this.dummy    = new THREE.Object3D()

    const count = isMobile ? config.countMobile : config.count
    const rand  = seededRandom(config.seed)

    // Procedural rock geometry — icosahedron with vertex displacement
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

    // Generate Keplerian orbital elements per asteroid
    this.orbits = []
    for (let i = 0; i < count; i++) {
      const a = config.innerRadius + rand() * (config.outerRadius - config.innerRadius)

      this.orbits.push({
        semiMajorAxis: a,
        eccentricity:  rand() * 0.15,
        inclination:   (rand() - 0.5) * config.inclination,
        longitudeAN:   rand() * Math.PI * 2,
        argPeriapsis:  rand() * Math.PI * 2,
        meanAnomaly:   rand() * Math.PI * 2,
        speed:         0.00003 + rand() * 0.00005,
      })

      // Initial rotation (static — does not change as asteroid orbits)
      this.dummy.rotation.set(
        rand() * Math.PI * 2,
        rand() * Math.PI * 2,
        rand() * Math.PI * 2,
      )

      // Power distribution — most asteroids are small, few are large
      const t     = rand()
      const scale = config.minScale + Math.pow(t, 3) * (config.maxScale - config.minScale)
      this.dummy.scale.setScalar(scale)

      // Position starts at origin; first update() will place it correctly
      this.dummy.position.set(0, 0, 0)
      this.dummy.updateMatrix()
      this.mesh.setMatrixAt(i, this.dummy.matrix)
    }

    this.mesh.instanceMatrix.needsUpdate = true
  }

  private orbitalToCartesian(orbit: AsteroidOrbit): THREE.Vector3 {
    // Solve Kepler's equation M = E - e*sin(E) iteratively
    let E = orbit.meanAnomaly
    for (let i = 0; i < 5; i++) {
      E = E - (E - orbit.eccentricity * Math.sin(E) - orbit.meanAnomaly) /
              (1 - orbit.eccentricity * Math.cos(E))
    }

    const cosE = Math.cos(E)
    const sinE = Math.sin(E)
    const e    = orbit.eccentricity
    const nu   = Math.atan2(
      Math.sqrt(1 - e * e) * sinE,
      cosE - e,
    )

    const r = orbit.semiMajorAxis * (1 - e * cosE)

    const cosNu = Math.cos(nu + orbit.argPeriapsis)
    const sinNu = Math.sin(nu + orbit.argPeriapsis)
    const cosI  = Math.cos(orbit.inclination)
    const sinI  = Math.sin(orbit.inclination)
    const cosAN = Math.cos(orbit.longitudeAN)
    const sinAN = Math.sin(orbit.longitudeAN)

    return new THREE.Vector3(
      r * (cosAN * cosNu - sinAN * sinNu * cosI),
      r * (sinNu * sinI),
      r * (sinAN * cosNu + cosAN * sinNu * cosI),
    )
  }

  addToScene(scene: THREE.Scene): void {
    scene.add(this.mesh)
  }

  update(): void {
    this.time++
    if (this.isMobile && this.time % 3 !== 0) return

    const mat         = new THREE.Matrix4()
    const scale       = new THREE.Vector3()
    const quat        = new THREE.Quaternion()
    const translation = new THREE.Vector3()

    for (let i = 0; i < this.orbits.length; i++) {
      const orbit = this.orbits[i]

      orbit.meanAnomaly += orbit.speed
      if (orbit.meanAnomaly > Math.PI * 2) orbit.meanAnomaly -= Math.PI * 2

      const worldPos = this.orbitalToCartesian(orbit)

      // Read current matrix to recover rotation and scale set in constructor
      this.mesh.getMatrixAt(i, mat)
      mat.decompose(translation, quat, scale)

      this.dummy.position.set(
        this.config.centerX + worldPos.x,
        this.config.centerY + worldPos.y,
        this.config.centerZ + worldPos.z,
      )
      this.dummy.quaternion.copy(quat)
      this.dummy.scale.copy(scale)
      this.dummy.updateMatrix()
      this.mesh.setMatrixAt(i, this.dummy.matrix)
    }

    this.mesh.instanceMatrix.needsUpdate = true
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
  minScale:      0.5,
  maxScale:      6,
  seed:          42,
  centerX:       0,
  centerY:       0,
  centerZ:       0,
  color:         0x8a7a6a,
  rotationSpeed: 0.00003,
  inclination:   0.035,
}
