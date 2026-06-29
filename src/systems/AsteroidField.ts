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
  private meshHigh:  THREE.InstancedMesh
  private meshMed:   THREE.InstancedMesh
  private meshLow:   THREE.InstancedMesh
  private count:     number
  private config:    AsteroidFieldConfig
  private dummy:     THREE.Object3D
  private orbits:    AsteroidOrbit[]
  private scales:    number[]
  private rotations: THREE.Euler[]
  private time:      number = 2
  private isMobile:  boolean
  private scene:     THREE.Scene | null = null

  // Pre-allocated temporaries to avoid per-frame allocation
  private readonly _zero = new THREE.Matrix4().scale(new THREE.Vector3(0, 0, 0))

  constructor(config: AsteroidFieldConfig, isMobile: boolean) {
    this.config   = config
    this.isMobile = isMobile
    this.dummy    = new THREE.Object3D()

    this.count = isMobile ? config.countMobile : config.count
    const rand = seededRandom(config.seed)

    // High detail — vertex-displaced, 80 triangles
    const geoHigh = new THREE.IcosahedronGeometry(1, 2)
    const pos     = geoHigh.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < pos.count; i++) {
      pos.setXYZ(
        i,
        pos.getX(i) * (0.75 + rand() * 0.5),
        pos.getY(i) * (0.75 + rand() * 0.5),
        pos.getZ(i) * (0.75 + rand() * 0.5),
      )
    }
    pos.needsUpdate = true
    geoHigh.computeVertexNormals()

    const geoMed = new THREE.IcosahedronGeometry(1, 1)  // 20 triangles
    const geoLow = new THREE.IcosahedronGeometry(1, 0)  // 8 triangles

    const mat = new THREE.MeshBasicMaterial({ color: config.color })

    this.meshHigh = new THREE.InstancedMesh(geoHigh, mat, this.count)
    this.meshMed  = new THREE.InstancedMesh(geoMed,  mat, this.count)
    this.meshLow  = new THREE.InstancedMesh(geoLow,  mat, this.count)

    this.meshHigh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.meshMed.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.meshLow.instanceMatrix.setUsage(THREE.DynamicDrawUsage)

    // Start all instances hidden; first update() places them
    for (let i = 0; i < this.count; i++) {
      this.meshHigh.setMatrixAt(i, this._zero)
      this.meshMed.setMatrixAt(i, this._zero)
      this.meshLow.setMatrixAt(i, this._zero)
    }

    // Generate Keplerian orbital elements + per-asteroid rotation/scale
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

      this.rotations.push(new THREE.Euler(
        rand() * Math.PI * 2,
        rand() * Math.PI * 2,
        rand() * Math.PI * 2,
      ))

      // Power distribution — most asteroids small, few large
      const t = rand()
      const scale = config.minScale + Math.pow(t, 3) * (config.maxScale - config.minScale)
      this.scales.push(scale)
    }

    this.meshHigh.instanceMatrix.needsUpdate = true
    this.meshMed.instanceMatrix.needsUpdate  = true
    this.meshLow.instanceMatrix.needsUpdate  = true
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
    scene.add(this.meshHigh)
    scene.add(this.meshMed)
    scene.add(this.meshLow)
  }

  update(cameraPosition?: THREE.Vector3): void {
    this.time++
    if (this.isMobile && this.time % 3 !== 0) return

    const camPos = cameraPosition ?? new THREE.Vector3()

    for (let i = 0; i < this.orbits.length; i++) {
      const orbit = this.orbits[i]

      orbit.meanAnomaly += orbit.speed
      if (orbit.meanAnomaly > Math.PI * 2) orbit.meanAnomaly -= Math.PI * 2

      const orbitPos = this.orbitalToCartesian(orbit)

      // Tumble each asteroid independently — stored Euler avoids zero-matrix decompose bug
      this.rotations[i].x += 0.0002
      this.rotations[i].y += 0.0003

      this.dummy.position.set(
        this.config.centerX + orbitPos.x,
        this.config.centerY + orbitPos.y,
        this.config.centerZ + orbitPos.z,
      )
      this.dummy.rotation.copy(this.rotations[i])
      this.dummy.scale.setScalar(this.scales[i])
      this.dummy.updateMatrix()

      const dist = this.dummy.position.distanceTo(camPos)

      if (dist < 400) {
        this.meshHigh.setMatrixAt(i, this.dummy.matrix)
        this.meshMed.setMatrixAt(i, this._zero)
        this.meshLow.setMatrixAt(i, this._zero)
      } else if (dist < 1200) {
        this.meshHigh.setMatrixAt(i, this._zero)
        this.meshMed.setMatrixAt(i, this.dummy.matrix)
        this.meshLow.setMatrixAt(i, this._zero)
      } else {
        this.meshHigh.setMatrixAt(i, this._zero)
        this.meshMed.setMatrixAt(i, this._zero)
        this.meshLow.setMatrixAt(i, this.dummy.matrix)
      }
    }

    this.meshHigh.instanceMatrix.needsUpdate = true
    this.meshMed.instanceMatrix.needsUpdate  = true
    this.meshLow.instanceMatrix.needsUpdate  = true
  }

  dispose(): void {
    if (this.scene) {
      this.scene.remove(this.meshHigh)
      this.scene.remove(this.meshMed)
      this.scene.remove(this.meshLow)
    }
    this.meshHigh.geometry.dispose()
    this.meshMed.geometry.dispose()
    this.meshLow.geometry.dispose()
    ;(this.meshHigh.material as THREE.Material).dispose()
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
