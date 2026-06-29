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
  private mesh:      THREE.InstancedMesh
  private count:     number
  private config:    AsteroidFieldConfig
  private dummy:     THREE.Object3D
  private orbits:    AsteroidOrbit[]
  private scales:    number[]
  private rotations: THREE.Euler[]
  private time:      number = 2
  private isMobile:  boolean
  private scene:     THREE.Scene | null = null

  constructor(config: AsteroidFieldConfig, isMobile: boolean) {
    this.config   = config
    this.isMobile = isMobile
    this.dummy    = new THREE.Object3D()

    this.count = isMobile ? config.countMobile : config.count
    const rand = seededRandom(config.seed)

    // Single geometry — medium detail works for all distances
    const geo = new THREE.IcosahedronGeometry(1, 1)
    const pos = geo.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < pos.count; i++) {
      pos.setXYZ(
        i,
        pos.getX(i) * (0.75 + rand() * 0.5),
        pos.getY(i) * (0.75 + rand() * 0.5),
        pos.getZ(i) * (0.75 + rand() * 0.5),
      )
    }
    pos.needsUpdate = true
    geo.computeVertexNormals()

    const mat = new THREE.MeshBasicMaterial({ color: config.color })
    this.mesh = new THREE.InstancedMesh(geo, mat, this.count)
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)

    this.orbits    = []
    this.scales    = []
    this.rotations = []

    for (let i = 0; i < this.count; i++) {
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

      const t = rand()
      this.scales.push(config.minScale + Math.pow(t, 3) * (config.maxScale - config.minScale))
      this.rotations.push(new THREE.Euler(
        rand() * Math.PI * 2,
        rand() * Math.PI * 2,
        rand() * Math.PI * 2,
      ))

      // Set initial matrix so asteroids appear before first update()
      const orbit = this.orbits[i]
      const p = this.orbitalToCartesian(orbit)
      this.dummy.position.set(config.centerX + p.x, config.centerY + p.y, config.centerZ + p.z)
      this.dummy.rotation.copy(this.rotations[i])
      this.dummy.scale.setScalar(this.scales[i])
      this.dummy.updateMatrix()
      this.mesh.setMatrixAt(i, this.dummy.matrix)
    }

    this.mesh.instanceMatrix.needsUpdate = true
  }

  private orbitalToCartesian(orbit: AsteroidOrbit): THREE.Vector3 {
    let E = orbit.meanAnomaly
    for (let i = 0; i < 5; i++) {
      E = E - (E - orbit.eccentricity * Math.sin(E) - orbit.meanAnomaly) /
              (1 - orbit.eccentricity * Math.cos(E))
    }

    const cosE = Math.cos(E)
    const sinE = Math.sin(E)
    const e    = orbit.eccentricity
    const nu   = Math.atan2(Math.sqrt(1 - e * e) * sinE, cosE - e)
    const r    = orbit.semiMajorAxis * (1 - e * cosE)

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
    this.scene = scene
    scene.add(this.mesh)
  }

  update(cameraPosition?: THREE.Vector3): void {
    void cameraPosition
    this.time++
    if (this.isMobile && this.time % 3 !== 0) return

    for (let i = 0; i < this.orbits.length; i++) {
      const orbit = this.orbits[i]

      orbit.meanAnomaly += orbit.speed
      if (orbit.meanAnomaly > Math.PI * 2) orbit.meanAnomaly -= Math.PI * 2

      const pos = this.orbitalToCartesian(orbit)

      this.dummy.position.set(
        this.config.centerX + pos.x,
        this.config.centerY + pos.y,
        this.config.centerZ + pos.z,
      )

      this.rotations[i].x += 0.0001
      this.rotations[i].y += 0.00015
      this.dummy.rotation.copy(this.rotations[i])
      this.dummy.scale.setScalar(this.scales[i])
      this.dummy.updateMatrix()
      this.mesh.setMatrixAt(i, this.dummy.matrix)
    }

    this.mesh.instanceMatrix.needsUpdate = true
  }

  dispose(): void {
    if (this.scene) this.scene.remove(this.mesh)
    this.mesh.geometry.dispose()
    ;(this.mesh.material as THREE.Material).dispose()
  }
}

// ── Pre-defined field configurations ──────────────────────────────────────────

export const MAIN_BELT_CONFIG: AsteroidFieldConfig = {
  innerRadius:   1200,
  outerRadius:   1800,
  count:         3000,
  countMobile:   1000,
  height:        60,
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
