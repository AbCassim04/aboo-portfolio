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
  kirkwoodGaps?:    number[]
  clusterCount?:    number
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

// Simple value noise — good enough for density distribution
function noise2D(x: number, y: number): number {
  const X = Math.floor(x) & 255
  const Y = Math.floor(y) & 255
  const xf = x - Math.floor(x)
  const yf = y - Math.floor(y)
  const u = xf * xf * (3 - 2 * xf)
  const v = yf * yf * (3 - 2 * yf)
  const a  = (X * 1619 + Y * 31337 + 1013) & 0xffff
  const b  = ((X+1) * 1619 + Y * 31337 + 1013) & 0xffff
  const c  = (X * 1619 + (Y+1) * 31337 + 1013) & 0xffff
  const d  = ((X+1) * 1619 + (Y+1) * 31337 + 1013) & 0xffff
  const na = (a / 0xffff) * 2 - 1
  const nb = (b / 0xffff) * 2 - 1
  const nc = (c / 0xffff) * 2 - 1
  const nd = (d / 0xffff) * 2 - 1
  return na + u * (nb - na) + v * (nc - na) + u * v * (na - nb - nc + nd)
}

// ── Triplanar ShaderMaterial source ───────────────────────────────────────────
//
// Three.js r184 WebGLProgram.js injects this prefix for instanced ShaderMaterial:
//   uniform mat4 modelMatrix, modelViewMatrix, projectionMatrix, viewMatrix;
//   attribute mat4 instanceMatrix;   ← per-instance local transform, NOT composed
//                                       into modelMatrix/modelViewMatrix automatically
//   attribute vec3 position, normal, uv;
//
// We must compose (modelMatrix * instanceMatrix) ourselves to get the correct
// per-instance world transform. instanceColor is NOT injected by Three.js here
// because we manage it as a geometry attribute rather than via setColorAt().

const VERT = /* glsl */`
  attribute vec3 instanceColor;
  varying   vec3 vInstanceColor;
  varying   vec3 vWorldPos;
  varying   vec3 vWorldNormal;

  void main() {
    // instanceMatrix: per-instance local transform (injected in prefix by Three.js)
    // modelMatrix: InstancedMesh world matrix (same for all instances)
    mat4 instancedModelMatrix = modelMatrix * instanceMatrix;

    vec4 worldPos  = instancedModelMatrix * vec4(position, 1.0);
    vWorldPos      = worldPos.xyz;
    // mat3(instancedModelMatrix) is correct for uniform scaling (setScalar)
    vWorldNormal   = normalize(mat3(instancedModelMatrix) * normal);
    vInstanceColor = instanceColor;

    // viewMatrix is provided in prefix; use it directly with the world position
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`

const FRAG = /* glsl */`
  uniform sampler2D diffuseMap;
  uniform sampler2D normalMap;
  uniform sampler2D roughMap;
  uniform float     sharpness;
  uniform float     scale;
  uniform vec3      sunDir;
  uniform vec3      ambientCol;

  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  varying vec3 vInstanceColor;

  void main() {
    vec3 n = normalize(vWorldNormal);

    // Triplanar blend weights — sharper = less blending at seams
    vec3 blend = pow(abs(n), vec3(sharpness));
    blend /= (blend.x + blend.y + blend.z + 0.001);

    // Sample diffuse from 3 axes
    vec3 p = vWorldPos * scale;
    vec4 xCol = texture2D(diffuseMap, p.yz);
    vec4 yCol = texture2D(diffuseMap, p.xz);
    vec4 zCol = texture2D(diffuseMap, p.xy);
    vec4 col  = xCol * blend.x + yCol * blend.y + zCol * blend.z;

    // Triplanar normal map
    vec3 xNrm = texture2D(normalMap, p.yz).rgb * 2.0 - 1.0;
    vec3 yNrm = texture2D(normalMap, p.xz).rgb * 2.0 - 1.0;
    vec3 zNrm = texture2D(normalMap, p.xy).rgb * 2.0 - 1.0;
    vec3 nrm  = normalize(
      xNrm * blend.x +
      yNrm * blend.y +
      zNrm * blend.z
    );

    vec3 perturbedN = normalize(n + nrm * 0.6);

    // Triplanar roughness
    float xRgh = texture2D(roughMap, p.yz).r;
    float yRgh = texture2D(roughMap, p.xz).r;
    float zRgh = texture2D(roughMap, p.xy).r;
    float rough = xRgh * blend.x + yRgh * blend.y + zRgh * blend.z;

    // Diffuse + specular lighting
    float diff    = max(dot(perturbedN, sunDir), 0.0) * 1.5;
    float specStr = (1.0 - rough) * 0.3;
    vec3  viewDir = normalize(-vWorldPos);
    vec3  halfDir = normalize(sunDir + viewDir);
    float spec    = pow(max(dot(perturbedN, halfDir), 0.0), 16.0) * specStr;

    // Per-instance colour tint (* 2.0 to restore perceived brightness for the
    // HSL range 0.3-0.6 used when generating tints)
    vec3 tintedCol = col.rgb * vInstanceColor * 2.0;

    vec3 litCol = tintedCol * (ambientCol * 2.0 + vec3(diff)) + vec3(spec);
    gl_FragColor = vec4(litCol, 1.0);
  }
`

export class AsteroidField {
  private meshHigh:  THREE.InstancedMesh
  private meshMid:   THREE.InstancedMesh
  private meshLow:   THREE.InstancedMesh
  private diffTex:   THREE.Texture
  private normalTex: THREE.Texture
  private roughTex:  THREE.Texture
  private config:    AsteroidFieldConfig
  private dummy:     THREE.Object3D
  private orbits:    AsteroidOrbit[]
  private scales:    number[]
  private rotations: THREE.Euler[]
  private colors:    THREE.Color[]
  private time:      number = 2
  private isMobile:  boolean
  private scene:     THREE.Scene | null = null

  constructor(config: AsteroidFieldConfig, isMobile: boolean) {
    this.config   = config
    this.isMobile = isMobile
    this.dummy    = new THREE.Object3D()

    // ── Textures ──────────────────────────────────────────────────────────
    const base   = typeof import.meta !== 'undefined' ? (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/' : '/'
    const loader = new THREE.TextureLoader()

    this.diffTex   = loader.load(base + 'textures/asteroid-diff.jpg')
    this.normalTex = loader.load(base + 'textures/asteroid-normal.jpg')
    this.roughTex  = loader.load(base + 'textures/asteroid-rough.jpg')

    this.diffTex.colorSpace   = THREE.SRGBColorSpace
    this.diffTex.wrapS        = this.diffTex.wrapT   = THREE.RepeatWrapping
    this.normalTex.wrapS      = this.normalTex.wrapT = THREE.RepeatWrapping
    this.roughTex.wrapS       = this.roughTex.wrapT  = THREE.RepeatWrapping

    // ── Geometry ──────────────────────────────────────────────────────────
    const count = isMobile ? config.countMobile : config.count
    const rand  = seededRandom(config.seed)

    const geoHigh = new THREE.IcosahedronGeometry(1, 3)
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

    const geoMid = new THREE.IcosahedronGeometry(1, 2)
    const geoLow = new THREE.IcosahedronGeometry(1, 1)

    // ── Material ──────────────────────────────────────────────────────────
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        diffuseMap:  { value: this.diffTex },
        normalMap:   { value: this.normalTex },
        roughMap:    { value: this.roughTex },
        sharpness:   { value: 4.0 },
        scale:       { value: 0.4 },
        sunDir:      { value: new THREE.Vector3(-1, 0.2, 0.1).normalize() },
        ambientCol:  { value: new THREE.Color(0x444455) },
      },
      vertexShader:   VERT,
      fragmentShader: FRAG,
      side: THREE.FrontSide,
    })

    // ── Meshes ────────────────────────────────────────────────────────────
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
    // position. Three.js (r184) Frustum.intersectsObject() calls
    // computeBoundingSphere() only when boundingSphere === null, then caches
    // forever. When nearCount=0 on the first render the lazy path produces
    // radius=-1, permanently culling meshHigh. Pre-setting avoids that.
    const beltCenter = new THREE.Vector3(config.centerX, config.centerY, config.centerZ)
    const beltRadius = config.outerRadius + config.maxScale * 1.5
    const beltSphere = new THREE.Sphere(beltCenter, beltRadius)

    this.meshHigh.boundingSphere = beltSphere.clone()
    this.meshMid.boundingSphere  = beltSphere.clone()
    this.meshLow.boundingSphere  = beltSphere.clone()

    // Pre-allocate per-instance colour buffers (white = [1,1,1] default).
    // ShaderMaterial does not support setColorAt(); we bind instanceColor
    // directly as an InstancedBufferAttribute on each geometry instead.
    const colorBuf = new Float32Array(count * 3).fill(1)
    geoHigh.setAttribute('instanceColor', new THREE.InstancedBufferAttribute(colorBuf.slice(), 3))
    geoMid.setAttribute('instanceColor',  new THREE.InstancedBufferAttribute(colorBuf.slice(), 3))
    geoLow.setAttribute('instanceColor',  new THREE.InstancedBufferAttribute(colorBuf.slice(), 3))

    // ── Placement ─────────────────────────────────────────────────────────
    this.orbits    = []
    this.scales    = []
    this.rotations = []
    this.colors    = []

    const clusterCount  = config.clusterCount ?? 0
    const clusterAngles: number[] = []
    const clusterRadii:  number[] = []
    for (let c = 0; c < clusterCount; c++) {
      clusterAngles.push(rand() * Math.PI * 2)
      clusterRadii.push(config.innerRadius + rand() * (config.outerRadius - config.innerRadius))
    }

    let placed      = 0
    let attempts    = 0
    const maxAttempts = count * 20

    while (placed < count && attempts < maxAttempts) {
      attempts++

      const angle  = rand() * Math.PI * 2
      const radius = config.innerRadius + rand() * (config.outerRadius - config.innerRadius)

      // ── Kirkwood gap rejection ───────────────────────────────────────
      const gaps = config.kirkwoodGaps ?? []
      let inGap = false
      for (const gapRadius of gaps) {
        if (Math.abs(radius - gapRadius) < 30) { inGap = true; break }
      }
      if (inGap && rand() > 0.05) continue

      // ── Cluster density boost ────────────────────────────────────────
      let densityBoost = 1.0
      for (let c = 0; c < clusterAngles.length; c++) {
        const dAngle  = Math.abs(angle - clusterAngles[c])
        const dRadius = Math.abs(radius - clusterRadii[c])
        const dist    = Math.sqrt(dAngle * dAngle * 10000 + dRadius * dRadius)
        if (dist < 150) { densityBoost = 3.0; break }
      }

      // ── Noise-based density variation ────────────────────────────────
      const noiseVal          = noise2D(Math.cos(angle) * 3, Math.sin(angle) * 3)
      const density           = 0.5 + 0.5 * noiseVal
      const acceptProbability = Math.min(1.0, density * densityBoost)
      if (rand() > acceptProbability) continue

      // ── Place ────────────────────────────────────────────────────────
      this.orbits.push({
        semiMajorAxis: radius,
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

      const tint = new THREE.Color()
      tint.setHSL(
        0.06 + rand() * 0.04,   // hue: very subtle warm grey
        0.05 + rand() * 0.1,    // saturation: very low — almost greyscale
        0.4  + rand() * 0.3,    // lightness: mid range
      )
      this.colors.push(tint)

      placed++
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

    const highColors = this.meshHigh.geometry.getAttribute('instanceColor') as THREE.InstancedBufferAttribute
    const midColors  = this.meshMid.geometry.getAttribute('instanceColor')  as THREE.InstancedBufferAttribute
    const lowColors  = this.meshLow.geometry.getAttribute('instanceColor')  as THREE.InstancedBufferAttribute

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
      const c   = this.colors[i]

      if (dSq < NEAR_SQ) {
        highColors.setXYZ(nearCount, c.r, c.g, c.b)
        this.meshHigh.setMatrixAt(nearCount++, this.dummy.matrix)
      } else if (dSq < MID_SQ) {
        midColors.setXYZ(midCount, c.r, c.g, c.b)
        this.meshMid.setMatrixAt(midCount++, this.dummy.matrix)
      } else {
        lowColors.setXYZ(farCount, c.r, c.g, c.b)
        this.meshLow.setMatrixAt(farCount++, this.dummy.matrix)
      }
    }

    this.meshHigh.count = nearCount
    this.meshMid.count  = midCount
    this.meshLow.count  = farCount

    this.meshHigh.instanceMatrix.needsUpdate = true
    this.meshMid.instanceMatrix.needsUpdate  = true
    this.meshLow.instanceMatrix.needsUpdate  = true

    highColors.needsUpdate = true
    midColors.needsUpdate  = true
    lowColors.needsUpdate  = true
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
    this.diffTex.dispose()
    this.normalTex.dispose()
    this.roughTex.dispose()
  }
}

// ── Pre-defined field configurations ──────────────────────────────────────────

export const MAIN_BELT_CONFIG: AsteroidFieldConfig = {
  innerRadius:   1200,
  outerRadius:   1800,
  count:         3000,
  countMobile:   500,
  height:        60,
  minScale:      0.5,
  maxScale:      6,
  seed:          42,
  centerX:       0,
  centerY:       0,
  centerZ:       0,
  color:         0x8a7a6a,
  rotationSpeed: 0.00003,
  inclination:   0.15,
  kirkwoodGaps:  [1350, 1480, 1620],
  clusterCount:  8,
}
