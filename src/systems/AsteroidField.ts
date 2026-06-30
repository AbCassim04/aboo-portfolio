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
    float spec    = pow(max(dot(perturbedN, halfDir), 0.0), 32.0) * specStr * 3.0;
    float glint   = pow(max(dot(perturbedN, halfDir), 0.0), 128.0) * 2.0;

    // Per-instance colour tint (* 2.0 to restore perceived brightness for the
    // HSL range 0.3-0.6 used when generating tints)
    vec3 tintedCol = col.rgb * vInstanceColor * 2.0;

    vec3 litCol = tintedCol * (ambientCol + vec3(diff * 0.8)) + vec3(spec * 0.5) + vec3(glint);
    litCol = max(litCol, tintedCol * 0.4);
    gl_FragColor = vec4(litCol, 1.0);
  }
`

// ── Far-distance point sprite shaders ────────────────────────────────────────
const FAR_VERT = /* glsl */`
  attribute vec3  color;
  attribute float size;
  varying   vec3  vColor;
  void main() {
    vColor = color;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * (400.0 / -mvPosition.z);
    gl_Position  = projectionMatrix * mvPosition;
  }
`

const FAR_FRAG = /* glsl */`
  varying vec3 vColor;
  void main() {
    float dist = length(gl_PointCoord - vec2(0.5));
    if (dist > 0.5) discard;
    float alpha = smoothstep(0.5, 0.1, dist);
    gl_FragColor = vec4(vColor, alpha);
  }
`

export class AsteroidField {
  private meshHigh:   THREE.InstancedMesh
  private meshMid:    THREE.InstancedMesh
  private pointsLow:  THREE.Points
  private dustPoints: THREE.Points
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
  private _tempPos:  THREE.Vector3
  private _zeroCam:  THREE.Vector3

  constructor(config: AsteroidFieldConfig, isMobile: boolean) {
    this.config   = config
    this.isMobile = isMobile
    this.dummy    = new THREE.Object3D()
    this._tempPos  = new THREE.Vector3()
    this._zeroCam  = new THREE.Vector3()

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

    // ── Instanced material (triplanar) ────────────────────────────────────
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        diffuseMap:  { value: this.diffTex },
        normalMap:   { value: this.normalTex },
        roughMap:    { value: this.roughTex },
        sharpness:   { value: 4.0 },
        scale:       { value: 0.4 },
        sunDir:      { value: new THREE.Vector3(1, 0.3, 0.1).normalize() },
        ambientCol:  { value: new THREE.Color(0x888899) },
      },
      vertexShader:   VERT,
      fragmentShader: FRAG,
      side: THREE.FrontSide,
    })

    // ── InstancedMeshes (high + mid detail) ───────────────────────────────
    this.meshHigh = new THREE.InstancedMesh(geoHigh, mat, count)
    this.meshMid  = new THREE.InstancedMesh(geoMid,  mat, count)

    this.meshHigh.count = 0
    this.meshMid.count  = 0

    this.meshHigh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.meshMid.instanceMatrix.setUsage(THREE.DynamicDrawUsage)

    // Pre-set bounding spheres so frustum culling never permanently rejects
    // them when nearCount / midCount is 0 on the first render.
    const beltCenter = new THREE.Vector3(config.centerX, config.centerY, config.centerZ)
    const beltRadius = config.outerRadius + config.maxScale * 1.5
    const beltSphere = new THREE.Sphere(beltCenter, beltRadius)

    this.meshHigh.boundingSphere = beltSphere.clone()
    this.meshMid.boundingSphere  = beltSphere.clone()

    // Per-instance colour buffers for the triplanar shader.
    const colorBuf = new Float32Array(count * 3).fill(1)
    geoHigh.setAttribute('instanceColor', new THREE.InstancedBufferAttribute(colorBuf.slice(), 3))
    geoMid.setAttribute('instanceColor',  new THREE.InstancedBufferAttribute(colorBuf.slice(), 3))

    // ── Far-distance point sprites ────────────────────────────────────────
    const farGeo       = new THREE.BufferGeometry()
    const farPositions = new Float32Array(count * 3)
    const farColors    = new Float32Array(count * 3)
    const farSizes     = new Float32Array(count)

    farGeo.setAttribute('position', new THREE.BufferAttribute(farPositions, 3))
    farGeo.setAttribute('color',    new THREE.BufferAttribute(farColors,    3))
    farGeo.setAttribute('size',     new THREE.BufferAttribute(farSizes,     1))

    const farMat = new THREE.ShaderMaterial({
      uniforms: {
        sunDir: { value: new THREE.Vector3(1, 0.3, 0.1).normalize() },
      },
      vertexShader:   FAR_VERT,
      fragmentShader: FAR_FRAG,
      transparent:    true,
      depthWrite:     false,
    })

    this.pointsLow = new THREE.Points(farGeo, farMat)
    this.pointsLow.frustumCulled = false
    // Explicit bounding sphere avoids the radius=-1 culling bug on first frame.
    farGeo.boundingSphere = beltSphere.clone()

    // ── Dust haze cloud filling the belt volume ────────────────────────────
    const dustCount     = isMobile ? 400 : 1500
    const dustGeo       = new THREE.BufferGeometry()
    const dustPositions = new Float32Array(dustCount * 3)

    for (let i = 0; i < dustCount; i++) {
      const angle  = rand() * Math.PI * 2
      const radius = config.innerRadius + rand() * (config.outerRadius - config.innerRadius)
      const y      = (rand() - 0.5) * config.height * 1.5
      dustPositions[i * 3]     = config.centerX + Math.cos(angle) * radius
      dustPositions[i * 3 + 1] = config.centerY + y
      dustPositions[i * 3 + 2] = config.centerZ + Math.sin(angle) * radius
    }

    dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3))

    const dustMat = new THREE.ShaderMaterial({
      uniforms: {
        color: { value: new THREE.Color(0xaaaa99) },
      },
      vertexShader: `
        void main() {
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = 8.0 * (300.0 / -mvPosition.z);
          gl_Position  = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        uniform vec3 color;
        void main() {
          float dist = length(gl_PointCoord - vec2(0.5));
          if (dist > 0.5) discard;
          float alpha = smoothstep(0.5, 0.0, dist) * 0.1;
          gl_FragColor = vec4(color, alpha);
        }
      `,
      transparent: true,
      depthWrite:  false,
      depthTest:   true,
      blending:    THREE.AdditiveBlending,
    })

    this.dustPoints = new THREE.Points(dustGeo, dustMat)
    this.dustPoints.frustumCulled = false
    dustGeo.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(config.centerX, config.centerY, config.centerZ),
      config.outerRadius + 50,
    )

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

  private orbitalToCartesian(orbit: AsteroidOrbit, target: THREE.Vector3): void {
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

    target.set(
      r * (cosAN * cosNu - sinAN * sinNu * cosI),
      r * (sinNu * sinI),
      r * (sinAN * cosNu + cosAN * sinNu * cosI),
    )
  }

  addToScene(scene: THREE.Scene): void {
    this.scene = scene
    scene.add(this.dustPoints)   // behind asteroids
    scene.add(this.meshHigh)
    scene.add(this.meshMid)
    scene.add(this.pointsLow)
  }

  update(cameraPosition?: THREE.Vector3): void {
    this.time++
    if (this.isMobile && this.time % 3 !== 0) return

    this.dustPoints.rotation.y += 0.00001

    const camPos = cameraPosition ?? this._zeroCam

    const NEAR_SQ = 600  * 600
    const MID_SQ  = 2000 * 2000

    let nearCount = 0
    let midCount  = 0
    let farCount  = 0

    const highColors = this.meshHigh.geometry.getAttribute('instanceColor') as THREE.InstancedBufferAttribute
    const midColors  = this.meshMid.geometry.getAttribute('instanceColor')  as THREE.InstancedBufferAttribute
    const farPosAttr  = this.pointsLow.geometry.attributes.position as THREE.BufferAttribute
    const farColAttr  = this.pointsLow.geometry.attributes.color    as THREE.BufferAttribute
    const farSizeAttr = this.pointsLow.geometry.attributes.size     as THREE.BufferAttribute

    for (let i = 0; i < this.orbits.length; i++) {
      const orbit = this.orbits[i]

      orbit.meanAnomaly += orbit.speed
      if (orbit.meanAnomaly > Math.PI * 2) orbit.meanAnomaly -= Math.PI * 2

      this.orbitalToCartesian(orbit, this._tempPos)

      this.rotations[i].x += 0.0001
      this.rotations[i].y += 0.00015

      this.dummy.position.set(
        this.config.centerX + this._tempPos.x,
        this.config.centerY + this._tempPos.y,
        this.config.centerZ + this._tempPos.z,
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
        farPosAttr.setXYZ(farCount, this.dummy.position.x, this.dummy.position.y, this.dummy.position.z)
        farColAttr.setXYZ(farCount, c.r * 1.3, c.g * 1.3, c.b * 1.3)
        farSizeAttr.setX(farCount, this.scales[i] * 3)
        farCount++
      }
    }

    this.meshHigh.count = nearCount
    this.meshMid.count  = midCount

    this.meshHigh.instanceMatrix.needsUpdate = true
    this.meshMid.instanceMatrix.needsUpdate  = true

    highColors.needsUpdate = true
    midColors.needsUpdate  = true

    farPosAttr.needsUpdate  = true
    farColAttr.needsUpdate  = true
    farSizeAttr.needsUpdate = true
    this.pointsLow.geometry.setDrawRange(0, farCount)
  }

  dispose(): void {
    if (this.scene) {
      this.scene.remove(this.dustPoints)
      this.scene.remove(this.meshHigh)
      this.scene.remove(this.meshMid)
      this.scene.remove(this.pointsLow)
    }
    this.dustPoints.geometry.dispose()
    ;(this.dustPoints.material as THREE.Material).dispose()
    this.meshHigh.geometry.dispose()
    this.meshMid.geometry.dispose()
    this.pointsLow.geometry.dispose()
    ;(this.meshHigh.material as THREE.Material).dispose()
    ;(this.pointsLow.material as THREE.Material).dispose()
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
