import * as THREE from 'three'

// ── Sky: Milky Way, star field and (desktop) nebula ─────────────────────────
// Rendered in its own pass before the world (see FlightMode): the objects sit
// at the camera (the render origin), so the sky is infinitely far away and is
// always behind everything. Star field and Milky Way are the original flight
// mode ones; with real planet positions the sky no longer drifts.
// Every shader includes the log-depth chunks (see space/depth.ts).

const NEBULA_VERT = `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}`

const NEBULA_FRAG = `
#include <logdepthbuf_pars_fragment>
uniform float uTime;
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform vec3 uColor3;
varying vec2 vUv;
vec3 mod289(vec3 x) { return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v) {
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g  = step(x0.yzx, x0.xyz);
  vec3 l  = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
    i.z + vec4(0.0, i1.z, i2.z, 1.0))
    + i.y + vec4(0.0, i1.y, i2.y, 1.0))
    + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3  ns = n_ * D.wyz - D.xzx;
  vec4  j  = p - 49.0 * floor(p * ns.z * ns.z);
  vec4  x_ = floor(j * ns.z);
  vec4  y_ = floor(j - 7.0 * x_);
  vec4  x  = x_ * ns.x + ns.yyyy;
  vec4  y  = y_ * ns.x + ns.yyyy;
  vec4  h  = 1.0 - abs(x) - abs(y);
  vec4 b0  = vec4(x.xy, y.xy);
  vec4 b1  = vec4(x.zw, y.zw);
  vec4 s0  = floor(b0)*2.0 + 1.0;
  vec4 s1  = floor(b1)*2.0 + 1.0;
  vec4 sh  = -step(h, vec4(0.0));
  vec4 a0  = b0.xzyw + s0.xzyw*sh.xxyy;
  vec4 a1  = b1.xzyw + s1.xzyw*sh.zzww;
  vec3 p0  = vec3(a0.xy, h.x);
  vec3 p1  = vec3(a0.zw, h.y);
  vec3 p2  = vec3(a1.xy, h.z);
  vec3 p3  = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}
float fbm(vec3 p) {
  float val = 0.0; float amp = 0.5; float freq = 1.0;
  for (int i = 0; i < 5; i++) { val += amp * snoise(p * freq); amp *= 0.5; freq *= 2.0; }
  return val;
}
void main() {
  #include <logdepthbuf_fragment>
  vec2 uv = vUv - 0.5;
  vec3 p1 = vec3(uv * 2.0,       uTime * 0.012);
  vec3 p2 = vec3(uv * 4.0 + 0.3, uTime * 0.008);
  vec3 p3 = vec3(uv * 1.0 - 0.5, uTime * 0.005);
  float n1 = fbm(p1) * 0.5 + 0.5;
  float n2 = fbm(p2) * 0.5 + 0.5;
  float n3 = fbm(p3) * 0.5 + 0.5;
  float cloud = n1 * 0.5 + n2 * 0.3 + n3 * 0.2;
  cloud = smoothstep(0.35, 0.75, cloud);
  vec3 color = mix(uColor1, uColor2, n1);
  color = mix(color, uColor3, n2 * 0.5);
  float vignette = clamp(1.0 - length(uv) * 1.2, 0.0, 1.0);
  gl_FragColor = vec4(color, cloud * 0.12 * vignette);
}`

function createNebulaBackground(): THREE.Mesh {
  const geo  = new THREE.PlaneGeometry(2, 2)
  const mat  = new THREE.ShaderMaterial({
    vertexShader:   NEBULA_VERT,
    fragmentShader: NEBULA_FRAG,
    uniforms: {
      uTime:   { value: 0 },
      uColor1: { value: new THREE.Color('#2a0a4a') },
      uColor2: { value: new THREE.Color('#0a1a3a') },
      uColor3: { value: new THREE.Color('#1a0a2e') },
    },
    transparent: true,
    depthWrite:  false,
    depthTest:   false,
    blending:    THREE.AdditiveBlending,
  })
  mat.name = 'nebula'
  const mesh = new THREE.Mesh(geo, mat)
  mesh.frustumCulled = false
  mesh.renderOrder   = -1
  return mesh
}

function createStarField(isMobile: boolean): { points: THREE.Points; mat: THREE.ShaderMaterial; dispose: () => void } {
  const count     = isMobile ? 3000 : 8000
  const positions = new Float32Array(count * 3)
  const colors    = new Float32Array(count * 3)
  const sizes     = new Float32Array(count)
  const phases    = new Float32Array(count)
  const speeds    = new Float32Array(count)

  for (let i = 0; i < count; i++) {
    let x: number, y: number, z: number
    if (Math.random() < 0.6) {
      const theta = Math.random() * Math.PI * 2
      const phi   = (Math.random() - 0.5) * 0.6
      const r     = 9500 + Math.random() * 500
      x = r * Math.cos(phi) * Math.cos(theta)
      y = r * Math.sin(phi)
      z = r * Math.cos(phi) * Math.sin(theta)
    } else {
      const theta = Math.random() * Math.PI * 2
      const phi   = Math.acos(2 * Math.random() - 1)
      const r     = 9500 + Math.random() * 500
      x = r * Math.sin(phi) * Math.cos(theta)
      y = r * Math.cos(phi)
      z = r * Math.sin(phi) * Math.sin(theta)
    }
    positions[i * 3] = x; positions[i * 3 + 1] = y; positions[i * 3 + 2] = z

    const rnd = Math.random()
    if      (rnd < 0.80) { colors[i*3]=1.0; colors[i*3+1]=1.0;  colors[i*3+2]=1.0  }
    else if (rnd < 0.90) { colors[i*3]=0.7; colors[i*3+1]=0.8;  colors[i*3+2]=1.0  }
    else if (rnd < 0.97) { colors[i*3]=1.0; colors[i*3+1]=0.95; colors[i*3+2]=0.7  }
    else                 { colors[i*3]=1.0; colors[i*3+1]=0.7;  colors[i*3+2]=0.4  }

    const sz = Math.random()
    sizes[i] = sz < 0.90 ? 1.0 + Math.random() * 1.5 : sz < 0.99 ? 3.0 + Math.random() * 2.0 : 6.0 + Math.random() * 3.0

    phases[i] = Math.random() * Math.PI * 2
    speeds[i] = 0.5 + Math.random() * 2.5
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('color',    new THREE.BufferAttribute(colors,    3))
  geo.setAttribute('size',     new THREE.BufferAttribute(sizes,     1))
  geo.setAttribute('phase',    new THREE.BufferAttribute(phases,    1))
  geo.setAttribute('speed',    new THREE.BufferAttribute(speeds,    1))

  const mat = new THREE.ShaderMaterial({
    uniforms:     { time: { value: 0 } },
    vertexColors: true,
    transparent:  true,
    depthWrite:   false,
    blending:     THREE.AdditiveBlending,
    vertexShader: `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      attribute float size;
      attribute float phase;
      attribute float speed;
      uniform   float time;
      varying   vec3  vColor;
      varying   float vAlpha;
      void main() {
        vColor = color;
        float twinkle = 0.75 + 0.25 * sin(time * speed + phase);
        vAlpha = twinkle;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * twinkle * (600.0 / -mvPosition.z);
        gl_Position  = projectionMatrix * mvPosition;
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: `
      #include <logdepthbuf_pars_fragment>
      varying vec3  vColor;
      varying float vAlpha;
      void main() {
        #include <logdepthbuf_fragment>
        float dist = length(gl_PointCoord - vec2(0.5));
        if (dist > 0.5) discard;
        float alpha = smoothstep(0.5, 0.1, dist) * vAlpha;
        gl_FragColor = vec4(vColor, alpha);
      }
    `,
  })

  mat.name = 'star-field'
  const points = new THREE.Points(geo, mat)
  points.frustumCulled = false
  return { points, mat, dispose: () => { geo.dispose(); mat.dispose() } }
}


export interface Sky {
  objects: THREE.Object3D[]
  update(t: number): void
  dispose(): void
}

export function createSky(loader: THREE.TextureLoader, isMobile: boolean): Sky {
  const base     = import.meta.env.BASE_URL
  const SKY_SEGS = isMobile ? 16 : 32
  const milkyTex = loader.load(base + 'stars/8k_stars_milky_way.jpg')
  milkyTex.colorSpace = THREE.SRGBColorSpace
  const milkyGeo = new THREE.SphereGeometry(10000, SKY_SEGS, SKY_SEGS)
  // Within the sky pass the Milky Way sphere still writes depth, so (as
  // before) stars just outside its facets stay hidden; the depth buffer is
  // cleared before the world pass, so the sky never occludes the world.
  const milkyMat  = new THREE.MeshBasicMaterial({ map: milkyTex, side: THREE.BackSide, transparent: true, opacity: 0.9 })
  const milkyMesh = new THREE.Mesh(milkyGeo, milkyMat)

  const starField = createStarField(isMobile)
  const clock     = new THREE.Timer()
  const objects: THREE.Object3D[] = [milkyMesh, starField.points]
  let nebula: THREE.Mesh | null = null
  if (!isMobile) { nebula = createNebulaBackground(); objects.unshift(nebula) }

  return {
    objects,
    update(t: number) {
      if (nebula) (nebula.material as THREE.ShaderMaterial).uniforms.uTime.value = t
      clock.update()
      starField.mat.uniforms.time.value = clock.getElapsed()
    },
    dispose() {
      milkyGeo.dispose(); milkyMat.dispose(); milkyTex.dispose()
      starField.dispose()
      if (nebula) { nebula.geometry.dispose(); (nebula.material as THREE.Material).dispose() }
    },
  }
}
