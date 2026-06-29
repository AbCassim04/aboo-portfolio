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
  private meshMid:   THREE.InstancedMesh
  private meshLow:   THREE.InstancedMesh
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

    const count = isMobile ? config.countMobile : config.count
    const rand  = seededRandom(config.seed)

    const geoHigh = new THREE.IcosahedronGeometry(1, 2)
    const posAttr  = geoHigh.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < posAttr.count; i++) {
      posAttr.setXYZ(i,
        posAttr.getX(i) * (0.75 + rand() * 0.5),
        posAttr.getY(i) * (0.75 + rand() * 0.5),
        posAttr.getZ(i) * (0.75 + rand() * 0.5),
      )
    }
    posAttr.needsUpdate = true
    geoHigh.computeVertexNormals()

    const geoMid = new THREE.IcosahedronGeometry(1, 1)
    const geoLow = new THREE.IcosahedronGeometry(1, 0)

    const mat = new THREE.MeshBasicMaterial({ color: config.color })

    this.meshHigh = new THREE.InstancedMesh(geoHigh, mat, count)
    this.meshMid  = new THREE.InstancedMesh(geoMid,  mat, count)
    this.meshLow  = new THREE.InstancedMesh(geoLow,  mat, count)

    this.meshHigh.count = 0
    this.meshMid.count  = 0
    this.meshLow.count  = 0

    this.meshHigh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.meshMid.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.meshLow.instanceMatrix.setUsage(THREE.DynamicDrawUsage)

    // Pre-set a permanent bounding sphere covering every possible asteroid
    // position across all three meshes.
    //
    // Three.js (r184) Frustum.intersectsObject() calls computeBoundingSphere()
    // only when boundingSphere === null, then caches the result forever.
    // The default lazy path is broken for this LOD pattern: when nearCount=0
    // on the first render (camera at origin, belt at r=1200-1800), the cached
    // sphere for meshHigh gets radius=-1 (makeEmpty()), permanently culling it.
    //
    // By pre-setting a non-null sphere here, Three.js never calls
    // computeBoundingSphere() at all. The sphere must encompass all instances
    // regardless of which LOD bucket they land in:
    //   outerRadius + maxScale × 1.5  (1.5 > max displaced vertex radius 1.25)
    //   = 1800 + 6×1.5 = 1809 → rounded to 1810 for margin
    const beltCenter = new THREE.Vector3(config.centerX, config.centerY, config.centerZ)
    const beltRadius = config.outerRadius + config.maxScale * 1.5
    const beltSphere = new THREE.Sphere(beltCenter, beltRadius)

    this.meshHigh.boundingSphere = beltSphere.clone()
    this.meshMid.boundingSphere  = beltSphere.clone()
    this.meshLow.boundingSphere  = beltSphere.clone()

    this.orbits    = []
    this.scales    = []
    this.rotations = []

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

      const t = rand()
      this.scales.push(config.minScale + Math.pow(t, 3) * (config.maxScale - config.minScale))
      this.rotations.push(new THREE.Euler(
        rand() * Math.PI * 2,
        rand() * Math.PI * 2,
        rand() * Math.PI * 2,
      ))
    }
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
    scene.add(this.meshMid)
    scene.add(this.meshLow)
  }

  update(cameraPosition?: THREE.Vector3): void {
    this.time++
    if (this.isMobile && this.time % 3 !== 0) return

    const camPos = cameraPosition ?? new THREE.Vector3()

    const NEAR_SQ = 400  * 400
    const MID_SQ  = 1500 * 1500

    let nearCount = 0
    let midCount  = 0
    let farCount  = 0

    for (let i = 0; i < this.orbits.length; i++) {
      const orbit = this.orbits[i]

      orbit.meanAnomaly += orbit.speed
      if (orbit.meanAnomaly > Math.PI * 2) orbit.meanAnomaly -= Math.PI * 2

      const pos = this.orbitalToCartesian(orbit)

      this.rotations[i].x += 0.0001
      this.rotations[i].y += 0.00015

      this.dummy.position.set(
        this.config.centerX + pos.x,
        this.config.centerY + pos.y,
        this.config.centerZ + pos.z,
      )
      this.dummy.rotation.copy(this.rotations[i])
      this.dummy.scale.setScalar(this.scales[i])
      this.dummy.updateMatrix()

      const dSq = this.dummy.position.distanceToSquared(camPos)

      if (dSq < NEAR_SQ) {
        this.meshHigh.setMatrixAt(nearCount++, this.dummy.matrix)
      } else if (dSq < MID_SQ) {
        this.meshMid.setMatrixAt(midCount++, this.dummy.matrix)
      } else {
        this.meshLow.setMatrixAt(farCount++, this.dummy.matrix)
      }
    }

    this.meshHigh.count = nearCount
    this.meshMid.count  = midCount
    this.meshLow.count  = farCount

    this.meshHigh.instanceMatrix.needsUpdate = true
    this.meshMid.instanceMatrix.needsUpdate  = true
    this.meshLow.instanceMatrix.needsUpdate  = true
  }

  dispose(): void {
    if (this.scene) {
      this.scene.remove(this.meshHigh)
      this.scene.remove(this.meshMid)
      this.scene.remove(this.meshLow)
    }
    this.meshHigh.geometry.dispose()
    this.meshMid.geometry.dispose()
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
