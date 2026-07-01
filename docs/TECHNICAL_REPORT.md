# aboo-portfolio — Comprehensive Technical Report

> A deep technical reference for the author's own understanding of the project.
> Every concept below is paired with the actual source it describes. Line
> references are accurate as of the commit this document was generated against.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Architecture](#2-architecture)
3. [The Solar System](#3-the-solar-system)
4. [The Black Hole Raytracer](#4-the-black-hole-raytracer)
5. [The Asteroid Field System](#5-the-asteroid-field-system)
6. [GLB Models](#6-glb-models)
7. [Mobile Optimization](#7-mobile-optimization)
8. [Performance Engineering](#8-performance-engineering)
9. [Known Issues and Future Work](#9-known-issues-and-future-work)
10. [Key Lessons Learned](#10-key-lessons-learned)

---

## 1. Project Overview

### What it is

`aboo-portfolio` is a single-page, fully-3D personal portfolio built as an
interactive space journey. Instead of scrolling a document, the visitor
**flies a UFO through a miniature solar system**. Portfolio content (About,
Skills, Projects, Contact) is attached to floating wireframe "destination"
objects in space; flying close to one and pressing **F** (or tapping **LAND**
on mobile) opens that section as an overlay. One special destination —
labelled **M87\*** — is the supermassive black hole, and approaching it
transitions into a full general-relativistic ray-traced black hole renderer.

### The three experiences

The whole app is a state machine over three top-level "modes" (`src/App.tsx`):

```tsx
type AppMode = 'hub' | 'flight' | 'blackhole'

export default function App() {
  const _qs = new URLSearchParams(window.location.search).get('mode') as AppMode | null
  const [mode, setMode] = useState<AppMode>(_qs ?? 'hub')

  return (
    <div style={{ position: 'fixed', inset: 0, width: '100vw', height: '100vh', overflow: 'hidden', background: '#0C0C0C' }}>
      {mode === 'hub' && (
        <HubMode onTakeFlight={() => setMode('flight')} />
      )}
      {mode === 'flight' && (
        <FlightMode
          onExit={() => setMode('hub')}
          onEnterBlackHole={() => setMode('blackhole')}
        />
      )}
      {mode === 'blackhole' && (
        <BlackHoleMode onExit={() => setMode('flight')} />
      )}
    </div>
  )
}
```

- **Hub** — a cinematic, top-down-ish view of the solar system with the
  portfolio navigation. Mostly a "menu" rendered in 3D.
- **Flight** — the playable mode. Full 6-DOF UFO flight with physics, a HUD,
  radar, boost, and a landing system.
- **Black Hole** — a self-contained GLSL ray-marcher implementing photon
  geodesics around a Kerr/Schwarzschild black hole, with an accretion disk,
  relativistic jet, Doppler/beaming, bloom, and temporal anti-aliasing.

Note the `?mode=` query-string override — you can deep-link straight into
`flight` or `blackhole` for development, bypassing the hub.

### Technology stack and why

| Layer | Choice | Why |
|-------|--------|-----|
| 3D engine | **Three.js r184** (`three@^0.184.0`) | Mature WebGL abstraction; gives `Scene`/`Camera`/`WebGLRenderer`, `InstancedMesh`, `ShaderMaterial`, GLTF/Draco loaders, and render-target plumbing for the bloom/TAA passes without hand-writing WebGL. |
| UI framework | **React 19** (`react@^19.2.6`) | The whole app is "imperative Three.js scene wrapped in a declarative React shell." React owns mode switching, overlays, HUD state, and lifecycle; Three.js owns the canvas. |
| Language | **TypeScript ~6.0** | Strong typing across the physics math (`THREE.Vector3`, `THREE.Euler`), shader uniform records, and config objects (`AsteroidFieldConfig`). Catches the easy mistakes in a math-heavy codebase. |
| Build tool | **Vite 8** | Fast HMR during dev; importantly, its `?raw` import suffix is used to load `.glsl` files as strings (see the black-hole shader assembler). `base: '/aboo-portfolio/'` configures the GitHub-Pages subpath. |
| Animation | **framer-motion** | Declarative enter/exit transitions for overlays and HUD chrome (`AnimatePresence`, `motion.div`). |
| Icons | **lucide-react** | Lightweight SVG icon set (e.g. `ArrowLeft` for back buttons). |
| Touch | **custom `Joystick.tsx`** (nipplejs is a dependency but the project moved to a custom system) | See [Mobile Optimization](#7-mobile-optimization) for the touch-control evolution. |
| Styling | **Tailwind 3 + inline styles** | Tailwind utility classes in the overlays; inline `style={{}}` for the 3D-chrome HUD where dynamic values dominate. |

The build is a standard `tsc -b && vite build` (`package.json` → `scripts.build`).

---

## 2. Architecture

### Component hierarchy

```
main.tsx  (React root, StrictMode)
└── App.tsx                         ← AppMode state machine
    ├── HubMode.tsx
    │   ├── SpaceCanvas.tsx         ← Three.js hub scene (imperative)
    │   ├── HeroOverlay.tsx
    │   ├── AboutOverlay.tsx
    │   ├── SkillsOverlay.tsx
    │   ├── ProjectsOverlay.tsx
    │   └── ContactOverlay.tsx
    ├── FlightMode.tsx              ← Three.js flight scene + game loop
    │   ├── FlightHUD.tsx           ← radar, speed, boost, light, mobile controls
    │   │   └── Joystick.tsx
    │   ├── LoadingScreen.tsx
    │   └── {About,Skills,Projects,Contact}Overlay.tsx
    └── BlackHoleMode.tsx           ← <canvas> driven by blackhole/renderer.ts
        └── LoadingScreen.tsx
```

### How React state flows into the imperative Three.js scene

The central architectural pattern is: **React renders a container `<div>` (or
`<canvas>`), and a `useEffect` with an empty dependency array builds the entire
Three.js world once, returning a cleanup function that tears it all down.**

In `FlightMode.tsx` the effect spans roughly lines 768–1625. The crucial
detail is how live data crosses the React ↔ Three.js boundary **without
re-running the effect**:

- **Refs, not state, for per-frame data.** Controls and physics live in refs so
  the animation loop reads current values without React re-renders:

  ```tsx
  const inputRef               = useFlightControls()
  const { ufoStateRef, update } = useUFOPhysics(inputRef)
  ```

- **`onExit` / `onEnterBlackHole` are mirrored into refs** so the long-lived
  closure always calls the latest callback even though the effect never re-runs:

  ```tsx
  const onExitRef           = useRef(onExit)
  const onEnterBlackHoleRef = useRef(onEnterBlackHole)
  useEffect(() => { onExitRef.current = onExit }, [onExit])
  useEffect(() => { onEnterBlackHoleRef.current = onEnterBlackHole }, [onEnterBlackHole])
  ```

- **State is only set at ~10 Hz, not per frame**, to avoid flooding React. The
  loop uses a frame counter and updates HUD state every 6th frame:

  ```tsx
  hudFrame++
  if (hudFrame % 6 === 0) {
    const vel      = state.velocity.length()
    const topSpeed = inputRef.current.boost ? 3.2 : 0.4
    setSpeed(Math.min(vel / topSpeed, 1))
    setIsBoosting(inputRef.current.boost)
    setUfoXY({ x: ufoPos.x, y: ufoPos.y })
    ...
  }
  ```

### The hub's camera-navigation hook

The hub uses a dedicated state hook, `useCameraNavigation.ts`, which holds a
`cameraStateRef` describing a tween between named "zones." Each zone is a camera
configuration (position, lookAt, fov):

```ts
const ZONE_CAMERAS: Record<Zone, CameraConfig> = {
  hub:      { position: [0, 500, 80],    lookAt: [0, 0, 0],      fov: 75 },
  about:    { position: [72, 42, -12],   lookAt: [84, 14, -4],   fov: 50 },
  skills:   { position: [108, 42, -12],  lookAt: [96, 14, -4],   fov: 50 },
  projects: { position: [90, 45, 12],    lookAt: [90, 16, 4],    fov: 50 },
  contact:  { position: [90, 39, 8],     lookAt: [90, 12, 0],    fov: 50 },
}
```

`navigateTo(zone)` populates `cameraStateRef.current` with `from`/`to`
endpoints and flips `active = true`; the `SpaceCanvas` animation loop reads that
ref each frame and interpolates the camera with a quadratic Bézier arc (so the
camera lifts up and over rather than clipping through planets), easing with the
smoothstep `ease = p*p*(3 - 2*p)`. On arrival it fires `onTransitionComplete()`,
which is the React callback that commits `currentZone` and clears the
transitioning flag.

The flight mode has its **own** lighter navigation: `navigateTo` there is just a
300 ms `setTimeout` that swaps a local `currentZone` ref and React state — the
flight overlays don't move the flight camera, they just appear on top of it.

### The render loop shape (shared idiom)

Every mode's loop computes a clamped delta-time, advances simulation, then
renders:

```tsx
const animate = () => {
  rafId = requestAnimationFrame(animate)
  const now = performance.now()
  const dt  = Math.min((now - prevTime) / 1000, 0.05)   // clamp: avoid huge jumps after tab-switch
  prevTime  = now
  t        += dt
  update()                 // physics
  // ... animate scene objects ...
  renderer.render(scene, camera)
}
```

The `Math.min(dt, 0.05)` clamp is important: when the tab is backgrounded,
`requestAnimationFrame` pauses; on return, a naive `dt` would be several
seconds and the UFO would teleport. The black-hole renderer has the same guard
in `_frameTiming()` (`renderer.ts`), plus a `visibilitychange` listener to reset
the timestamp.

---

## 3. The Solar System

The solar system exists in **two** independent implementations:
`FlightMode.tsx` (the explorable, real-scale version) and `SpaceCanvas.tsx`
(the compact hub diagram). Both share the same per-planet `create*` factory
pattern. This section documents the `FlightMode.tsx` versions, which are the
canonical ones; the hub versions are copies scaled and repositioned for a
top-down diagram view.

### The factory pattern

Each planet is a function returning a `{ group, mesh, dispose }` triple. The
`group` is what gets positioned in the scene; the `mesh` is the rotating body;
`dispose` frees every GPU resource the factory allocated. Example — Mars:

```tsx
function createMars(loader: THREE.TextureLoader, isMobile: boolean): { group: THREE.Group; mesh: THREE.Mesh; dispose: () => void } {
  const base    = import.meta.env.BASE_URL
  const marsTex = loader.load(base + 'earth/8k_mars.jpg')
  marsTex.colorSpace = THREE.SRGBColorSpace
  const group   = new THREE.Group()
  const INNER_SEGS = isMobile ? 32 : 64
  const marsGeo = new THREE.SphereGeometry(7, INNER_SEGS, INNER_SEGS)
  const marsMat = new THREE.MeshPhongMaterial({ map: marsTex, shininess: 5, side: THREE.FrontSide })
  const mesh    = new THREE.Mesh(marsGeo, marsMat)
  group.add(mesh)
  group.rotation.z = 0.4396
  return { group, mesh, dispose: () => { marsGeo.dispose(); marsMat.dispose(); marsTex.dispose() } }
}
```

### Texture sources

- **Earth** day/night/cloud maps are from `bobbyroe/threejs-earth` (MIT),
  loaded from `public/earth/earth-day.jpg`, `earth-night.jpg`, `earth-clouds.jpg`.
- The other planets use NASA/Solar-System-Scope-style equirectangular maps
  (`8k_mars.jpg`, `8k_jupiter.jpg`, `8k_saturn.jpg`, `2k_uranus.jpg`,
  `2k_neptune.jpg`, `8k_venus_surface.jpg`, `4k_venus_atmosphere.jpg`,
  `8k_mercury.jpg`, `8k_moon.jpg`) under `public/earth/`.
- All diffuse textures get `colorSpace = THREE.SRGBColorSpace` so the
  `ACESFilmicToneMapping` + sRGB output pipeline reproduces them correctly.

### Material choices: MeshPhongMaterial vs MeshBasicMaterial vs MeshStandardMaterial

- **Planets use `MeshPhongMaterial`.** Phong is a lit material (it responds to
  the scene's `DirectionalLight` "sun"), but it is **much cheaper than
  `MeshStandardMaterial`** (no PBR BRDF, no metalness/roughness sampling). For
  textured spheres lit by a single directional light, Phong's specular
  highlight (`shininess`) is more than enough and saves shader cost across 8
  bodies. The `shininess` values are deliberately low (5–10) because rocky and
  gaseous bodies are not glossy.
- **The Sun uses `MeshBasicMaterial`** — it is an *emitter*, not a lit surface,
  so it must ignore lighting entirely and just show its texture at full
  brightness:

  ```tsx
  const sunGeo     = new THREE.SphereGeometry(140, 64, 64)
  const sunMat     = new THREE.MeshBasicMaterial({ map: sunTexture })
  const sunMesh    = new THREE.Mesh(sunGeo, sunMat)
  sunMesh.position.set(-4000, 0, 0)
  ```

- **The astronaut GLB is forced to `MeshStandardMaterial`** — see
  [GLB Models](#6-glb-models) for why its original material had to be replaced.

### Why `FrontSide` vs `DoubleSide` matters

This distinction is deliberate and per-layer:

- **Solid bodies render `FrontSide`** (the default-ish choice here). The camera
  is always outside the sphere, so back faces are never visible; culling them
  halves the fragment work. Earth, Moon, all planets, and Venus's *surface* are
  `FrontSide`.
- **Translucent shells render `DoubleSide`.** Earth's clouds and Venus's
  atmosphere are semi-transparent spheres slightly larger than the body. With
  `FrontSide` you'd only see the near hemisphere's cloud layer; with
  `DoubleSide` light passing through shows the far side's clouds too, giving a
  believable wrap:

  ```tsx
  const cloudMat = new THREE.MeshPhongMaterial({
    map:         cloudTex,
    transparent: true,
    opacity:     0.35,
    depthWrite:  false,
    side:        THREE.DoubleSide,
  })
  ```

- **The atmosphere rim glow renders `BackSide`** — see the Earth shader below.
  Rendering only the *inside* of a slightly larger sphere produces a limb glow
  that brightens toward the silhouette edge and vanishes in the centre.

### Earth: the day/night terminator with emissive city lights

Earth is the most elaborate body. It is a `MeshPhongMaterial` whose **emissive
map is the night-lights texture**. Phong adds `emissiveMap * emissive *
emissiveIntensity` on top of the diffuse term — and because the diffuse term is
near-zero on the unlit (night) hemisphere, the city lights only show where the
surface is in shadow. This is a clean way to get a day/night terminator with
glowing cities for free, without a custom shader:

```tsx
const earthMat = new THREE.MeshPhongMaterial({
  map:               dayTex,
  emissiveMap:       nightTex,
  emissive:          new THREE.Color(0xffffff),
  emissiveIntensity: 0.6,
  shininess:         10,
  side:              THREE.FrontSide,
  depthWrite:        true,
})
```

Earth also has three concentric layers in a group:

1. **Surface** (`EARTH_RADIUS = 10`) — the Phong day/night material above.
2. **Clouds** (`EARTH_RADIUS + 0.5`) — translucent `DoubleSide`, rotates
   slightly faster than the surface.
3. **Atmosphere** (`EARTH_RADIUS + 1`) — a custom **Fresnel rim shader** on a
   `BackSide`, additively blended sphere:

   ```glsl
   // vertex
   varying vec3 vNormal;
   void main() {
     vNormal = normalize(normalMatrix * normal);
     gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
   }
   // fragment
   varying vec3 vNormal;
   void main() {
     float intensity = pow(0.65 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 3.0);
     gl_FragColor = vec4(0.3, 0.6, 1.0, 1.0) * intensity;
   }
   ```

   The `pow(... , 3.0)` concentrates the blue glow into a thin band at the limb.

The Earth group is given a fixed axial tilt of `group.rotation.z = 0.4101`
radians (≈ 23.5°, Earth's real obliquity). The surface and clouds spin every
frame:

```tsx
earthObj.earthMesh.rotation.y += 0.0003
earthObj.cloudMesh.rotation.y += 0.0005
```

### Axial tilts and rotation — the real astronomical values

Each planet's group is rotated about Z by its **real axial obliquity in
radians**, and each body's mesh spins about Y every frame at a hand-tuned rate
that roughly preserves the *relative* spin ordering of the real planets
(Jupiter fastest, Venus slowest/retrograde):

| Body | `group.rotation.z` (rad) | ≈ degrees | Real obliquity | Per-frame Y spin |
|------|--------------------------|-----------|----------------|------------------|
| Mercury | `0.034` | 2.0° | 0.03° | `+0.0008` |
| Venus | `3.096` | 177.4° | 177.4° (retrograde) | `-0.0001` (atmo `-0.00015`) |
| Earth | `0.4101` | 23.5° | 23.4° | `+0.0003` |
| Mars | `0.4396` | 25.2° | 25.2° | `+0.0004` |
| Jupiter | `0.0546` | 3.1° | 3.1° | `+0.001` |
| Saturn | `0.4665` | 26.7° | 26.7° | `+0.0009` |
| Uranus | `1.706` | 97.8° | 97.8° (rolls on its side) | `+0.0003` |
| Neptune | `0.4942` | 28.3° | 28.3° | `+0.00035` |

The Venus values are the clearest tell that real data was used: a tilt of
~177° encodes Venus's famous retrograde, near-upside-down rotation, and the
**negative** spin rate makes it visibly turn backwards.

```tsx
mercuryObj.mesh.rotation.y += 0.0008
venusObj.mesh.rotation.y   -= 0.0001
venusObj.atmoMesh.rotation.y -= 0.00015
marsObj.mesh.rotation.y    += 0.0004
jupiterObj.mesh.rotation.y += 0.001
saturnObj.mesh.rotation.y  += 0.0009
uranusObj.mesh.rotation.y  += 0.0003
neptuneObj.mesh.rotation.y += 0.00035
```

### Venus's two-layer atmosphere

Venus is the only terrestrial planet with a separate, independently-rotating
atmosphere mesh — modelling the real-world fact that Venus's thick cloud deck
super-rotates relative to the surface:

```tsx
const venusGeo = new THREE.SphereGeometry(9, INNER_SEGS, INNER_SEGS)
const venusMat = new THREE.MeshPhongMaterial({ map: venusTex, shininess: 8, side: THREE.FrontSide })
const mesh     = new THREE.Mesh(venusGeo, venusMat)
group.add(mesh)
const atmoGeo  = new THREE.SphereGeometry(9.8, INNER_SEGS, INNER_SEGS)
const atmoMat  = new THREE.MeshPhongMaterial({ map: atmoTex, shininess: 3, side: THREE.DoubleSide, transparent: true, opacity: 0.7, depthWrite: false })
const atmoMesh = new THREE.Mesh(atmoGeo, atmoMat)
group.add(atmoMesh)
```

### Saturn's rings: custom radial UV remap

Saturn's rings are the most interesting geometry trick. A `THREE.RingGeometry`
by default lays out UVs in a way that does **not** map a linear ring-texture
(which is a 1-D strip from inner edge to outer edge) correctly — the texture
ends up smeared angularly instead of radially. The fix is to **rewrite every
vertex's UV so that `u` encodes the normalized radius** and `v` is constant:

```tsx
const ringInner = 117, ringOuter = 216
const ringGeo   = new THREE.RingGeometry(ringInner, ringOuter, RING_SEGS)
const pos = ringGeo.attributes.position as THREE.BufferAttribute
const uv  = ringGeo.attributes.uv as THREE.BufferAttribute
for (let i = 0; i < pos.count; i++) {
  const r = Math.sqrt(pos.getX(i) ** 2 + pos.getY(i) ** 2)
  uv.setXY(i, (r - ringInner) / (ringOuter - ringInner), 0.5)
}
const ringMat  = new THREE.MeshBasicMaterial({ map: ringTex, side: THREE.DoubleSide, transparent: true, depthWrite: false, opacity: 1.0 })
const ringMesh = new THREE.Mesh(ringGeo, ringMat)
ringMesh.rotation.x = Math.PI / 2.5
```

Each vertex's planar distance from centre `r` is normalized into `[0,1]` and
written to `u`; `v` is pinned to `0.5`. Now the ring-alpha PNG
(`8k_saturn_ring_alpha.png`) is sampled radially: the Cassini division, ring
gradients, and the transparent gaps all line up with their true radii. The
ring material is `MeshBasicMaterial` (rings are translucent and largely
self-illuminated by scattering — lighting them with Phong looked wrong),
`DoubleSide` (visible from above and below), with `depthWrite: false` so the
planet body behind shows through the transparent gaps. The ring plane is tilted
`Math.PI / 2.5` so it isn't perfectly edge-on to the ecliptic.

### Scene layout & the "sun at −4000" lighting trick

In flight mode the planets are strung along the X axis like a real orbital
diagram, with the Sun far to the left at `x = -4000`:

```tsx
mercuryObj.group.position.set(-2800, 0, 20)
venusObj.group.position.set(-2000, 0, -30)
marsObj.group.position.set(800, 0, 20)
jupiterObj.group.position.set(2500, 0, -40)
saturnObj.group.position.set(4000, 0, 30)
uranusObj.group.position.set(6000, 0, -20)
neptuneObj.group.position.set(8000, 0, 10)
```

The Sun is both a textured `MeshBasicMaterial` sphere **and** the scene's key
light. Lighting comes from a single `DirectionalLight` placed at the Sun's
position pointing at the origin, plus a very dim ambient and a coloured point
"rim" light for the UFO:

```tsx
const ambientLight = new THREE.AmbientLight(0x111122, 0.08)
scene.add(ambientLight)
const sunLight = new THREE.DirectionalLight(0xfff5e0, 3.5)
sunLight.position.set(-4000, 0, 0)
sunLight.target.position.set(0, 0, 0)
scene.add(sunLight)
scene.add(sunLight.target)
const rimLight = new THREE.PointLight(0x7721b1, 0.3, 50)
rimLight.position.set(-15, -5, -10)
```

The Sun's *visible* glow is built from **four nested additively-blended
`BackSide` spheres** of increasing radius and decreasing opacity (corona →
glow → bloom1 → bloom2), a cheap fake-bloom that needs no post-processing:

```tsx
const coronaGeo = new THREE.SphereGeometry(161, SUN_SEGS, SUN_SEGS)
const coronaMat = new THREE.MeshBasicMaterial({
  color: 0xff9900, transparent: true, opacity: 0.55,
  blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide,
})
coronaGeo.translate(-4000, 0, 0)
// ... sunGlowGeo r=175 @0.7, sunBloom1Geo r=240 @0.35, sunBloom2Geo r=350 @0.12
```

### Collision: planet "repulsion" instead of true collision

Rather than implement rigid-body collision, the flight loop applies a **soft
surface-repulsion** to the UFO for the large bodies. If the UFO penetrates a
body's radius, it is snapped back to the surface and any inward velocity
component is removed:

```tsx
const toUFOJupiter = ufoStateRef.current.position.clone().sub(jupiterObj.group.position)
if (toUFOJupiter.length() < 125) {
  ufoStateRef.current.position.copy(jupiterObj.group.position).addScaledVector(toUFOJupiter.normalize(), 125)
  const dot = ufoStateRef.current.velocity.dot(toUFOJupiter.normalize())
  if (dot < 0) ufoStateRef.current.velocity.addScaledVector(toUFOJupiter.normalize(), -dot)
}
```

Earth (`EARTH_RADIUS + EARTH_BUFFER`), Jupiter (radius 125), and Saturn (radius
230, sized to include its rings) all get this treatment.

---

## 4. The Black Hole Raytracer

The black hole is the technical centrepiece: a fragment-shader ray-marcher that
integrates photon geodesics through curved spacetime and composites an
accretion disk, relativistic jet, an orbiting reference planet, and a lensed
background sky, then post-processes with multi-mip bloom and (on desktop)
temporal anti-aliasing.

### Shader assembly pipeline

The GLSL is **not** one file. It is ten `.glsl` files imported as raw strings by
Vite's `?raw` loader and concatenated in a fixed order, then run through a tiny
Mustache-style template resolver that strips feature blocks based on a config
context. This is `src/shaders/blackhole/compiled.ts`:

```ts
import definesGlsl    from './defines.glsl?raw'
import mathGlsl       from './math.glsl?raw'
import geodesicsGlsl  from './geodesics.glsl?raw'
// ... accretion, background, planet, jet, trace_ray, tonemapping, main

const RAW_GLSL =
  definesGlsl + '\n' + mathGlsl + '\n' + geodesicsGlsl + '\n' +
  accretionGlsl + '\n' + backgroundGlsl + '\n' + planetGlsl + '\n' +
  jetGlsl + '\n' + traceRayGlsl + '\n' + tonemapGlsl + '\n' + mainGlsl
```

The resolver handles three Mustache constructs: `{{#flag}}...{{/flag}}`
(include if truthy), `{{^flag}}...{{/flag}}` (include if falsy), and
`{{scalar}}` (text substitution). It runs **six passes** to resolve
cross-referencing (non-self-nested) blocks:

```ts
function resolveMustache(template: string, ctx: MustacheCtx): string {
  let result = template
  for (let pass = 0; pass < 6; pass++) {
    for (const key of Object.keys(ctx)) {
      const isTrue = Boolean(ctx[key])
      const esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      result = result.replace(new RegExp(`\\{\\{#${esc}\\}\\}([\\s\\S]*?)\\{\\{\\/${esc}\\}\\}`, 'g'), isTrue ? '$1' : '')
      result = result.replace(new RegExp(`\\{\\{\\^${esc}\\}\\}([\\s\\S]*?)\\{\\{\\/${esc}\\}\\}`, 'g'), isTrue ? '' : '$1')
    }
  }
  for (const key of Object.keys(ctx)) {
    const esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    result = result.replace(new RegExp(`\\{\\{${esc}\\}\\}`, 'g'), String(ctx[key]))
  }
  return result
}
```

Two contexts are compiled at module load. The key differences between desktop
and mobile are the integration-step count and whether the orbiting planet is
drawn:

```ts
const DESKTOP_CTX: MustacheCtx = {
  rk4_integration: false,            // uses Leapfrog/Störmer-Verlet
  kerr_inspired_mode: true,
  kerr_inspired_velocity: true,
  accretion_thin_disk: true,
  jet_enabled: true, jet_physical: true,
  grmhd_enabled: true,
  planetEnabled: true,
  light_travel_time: true,
  gravitational_time_dilation: true,
  aberration: true, beaming: true, physical_beaming: true, doppler_shift: true,
  n_steps: 100,
  sample_count: 1,
  max_revolutions: 2.0,
}
const MOBILE_CTX: MustacheCtx = {
  ...DESKTOP_CTX,
  planetEnabled: false,
  n_steps: 64,
  max_revolutions: 1.4,
}
```

The vertex shader is trivial — it's a fullscreen quad; all the work is in the
fragment shader run once per pixel:

```ts
export const VERTEX_SHADER: string = `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`
```

### The geodesic ray-bending math

A photon's path around a non-spinning (Schwarzschild) black hole is solved with
the **Binet equation** in the inverse-radius variable `u = 1/r`. In this form
the orbit equation for light is:

> d²u/dφ² = −u + (3/2) u²    (in units where the Schwarzschild radius r_s = 1)

The `−u` is the Newtonian term; the `+1.5 u²` is the general-relativistic
correction that bends light and creates the photon sphere. This is exactly
`geodesic_accel` in `geodesics.glsl`:

```glsl
float geodesic_accel(float u, float spin_alignment) {
    float schwarzschild_accel = -u + 1.5*u*u;
    float u_drag = min(u, 1.2);
    float frame_drag_term = photon_spin_lensing_scale *
        bh_rotation_enabled * bh_spin * bh_spin_strength *
        spin_alignment * 0.8 * u_drag*u_drag*u_drag;
    return schwarzschild_accel + frame_drag_term;
}
```

The `frame_drag_term` is a **perturbative heuristic** for black-hole spin
(Kerr frame-dragging): it adds a cubic-in-`u` twist proportional to spin and to
how aligned the photon's angular momentum is with the spin axis
(`spin_alignment`). This is the publicly-exposed spin model — cheap and stable.

Each step integrates `u` and `du = du/dφ`. The default desktop mode uses a
symplectic **Leapfrog / Störmer-Verlet** integrator (energy-stable, second
order); an RK4 path also exists behind the `{{#rk4_integration}}` flag:

```glsl
// Leapfrog (default): kick-drift-kick
du += 0.5 * geodesic_accel(u, spin_alignment) * step;
u  += du * step;
du += 0.5 * geodesic_accel(u, spin_alignment) * step;
```

`trace_ray()` sets up the initial conditions by decomposing the ray into a
radial and tangential component relative to the camera, converting that into the
Binet initial `du`:

```glsl
float u = 1.0 / length(pos), old_u;
vec3 normal_vec = normalize(pos);
vec3 ray_perp = cross(cross(normal_vec, ray), normal_vec);
// ... tangent_vec from ray_perp ...
float radial_component = dot(ray, normal_vec) * observer_static_lapse;
float dot_tang = dot(ray, tangent_vec);
float du = (abs(dot_tang) > 1e-6) ? -radial_component / dot_tang * u
                                  : -sign(dot(ray, normal_vec)) * u * 200.0;
du = clamp(du, -200.0, 200.0);
```

The position is reconstructed each step from the planar Binet solution and then
twisted by the accumulated frame-drag phase:

```glsl
vec3 planar_pos = (cos(phi)*normal_vec + sin(phi)*tangent_vec)/u;
// ... frame_drag_phase accumulates per step ...
pos = rotate_about_z(planar_pos, frame_drag_phase);
```

**Capture vs escape.** Exterior rays that reach `u >= 1.0` (i.e. `r <= r_s`)
are flagged `shadow_capture` — they fell through the horizon and contribute
black. Rays whose `u` goes below 0 escaped to infinity and sample the
background. A clever analytical optimisation pre-classifies interior rays using
the **Binet conserved energy** `E = (du/dφ)² + u² − u³`, whose potential
barrier peaks at the photon sphere `u = 2/3` with `E_crit = 4/27`:

```glsl
if (interior_mode > 0.5) {
    if (du >= 0.0) {
        shadow_capture = true;  // inward → singularity
    } else {
        float E_binet = du*du + u*u*(1.0 - u);
        if (E_binet <= 4.0/27.0) {
            shadow_capture = true;  // not enough energy to escape the barrier
        }
    }
}
```

Pre-classifying these rays avoids wasting integration steps on photons that can
never escape — the comment notes this "completely eliminat[ed] the numerical
artefacts that produced the blue-blob rendering."

There is also a complete, separately-derived **true Kerr geodesic integrator**
in `geodesics.glsl` (the Carter-separated Mino-time equations
`d²r/dσ²`, `d²(cosθ)/dσ²`, `dφ/dσ` with conserved `ξ = L_z/E` and `η = Q/E²`).
It is fully implemented (`kerr_r_accel`, `kerr_cth_accel`, `kerr_phi_dot`,
`kerr_init`, `integrate_kerr_step`) but **gated off in the public contexts**
(`kerr_full_geodesic: false`); the shipped build always uses the Schwarzschild
Binet solver plus the perturbative frame-drag term.

### Compositing along the ray

Within the integration loop, each segment tests for and accumulates emission
from the scene elements using **front-to-back compositing with Beer-Lambert
transmittance** (`vol_transmittance` decays multiplicatively through optically
thick media):

- **Thin accretion disk** (`{{#accretion_thin_disk}}`): detect the z=0 plane
  crossing, with **4× sub-stepping near the photon sphere** so tightly-wound
  rays don't skip the disk and miss the secondary/tertiary Einstein rings:

  ```glsl
  int disk_sub_steps = 1;
  if (abs(u - 0.667) < 0.15 && step > 0.12) {
      disk_sub_steps = 4;  // 4 sub-checks near photon sphere
  }
  ```

  At the crossing it computes a Shakura-Sunyaev temperature, applies Eddington
  limb darkening `I(μ) = I(1)·(0.4 + 0.6·μ)`, relativistic Doppler beaming from
  the disk's orbital velocity, then looks up the blackbody colour from a
  spectrum texture.

- **Relativistic jet** (`{{#jet_enabled}}`): two-sided synchrotron emission
  with magnetization, spine/sheath structure, Doppler beaming
  `δ^(2+α)` with α≈0.7, and counter-jet occultation by the disk.

- **Reference planet** (`{{#planetEnabled}}`): a textured beach-ball sphere on
  a relativistic orbit, with Lorentz contraction and light-travel-time
  retardation (`planet.glsl`).

- **Background sky**: escaped rays sample a star texture and Milky Way galaxy
  texture through `sphere_map`, with gravitational blueshift and the Liouville
  intensity boost `D³` (`background.glsl`, `trace_ray.glsl`).

### Doppler, beaming, and the Liouville invariant

The renderer takes relativistic radiative transfer seriously. The
**Liouville invariant** `I_ν/ν³ = const` along a ray means the observed
intensity scales as the cube of the frequency ratio `D`. Because the spectrum
texture only stores *chromaticity* (normalized colour), the `D³` brightness
boost must be applied explicitly:

```glsl
float safe_bg_doppler = max(abs(bg_doppler), 0.01);
float bg_D = 1.0 / safe_bg_doppler;
float bg_boost = min(bg_D * bg_D * bg_D, 10000.0);
```

For the disk, the physical-beaming branch likewise divides intensity by
`transfer_factor³`. There is also a softer "cinematic" beaming branch for an
artistically tuned look.

### Tone mapping

`tonemapping.glsl` offers three operators selectable by a uniform:
**ACES Filmic** (mode 0), **AGX** with a punchy contrast/saturation look
(mode 1, the Troy Sobotka transform), and a **logarithmic scientific**
false-colour mode using an Inferno colormap polynomial (mode 2) that mimics how
EHT/GRMHD papers display disk data. All paths add screen-space dithering to kill
banding:

```glsl
float screen_dither() {
    return (hash12(gl_FragCoord.xy) - 0.5) / 255.0;
}
```

### The bloom pipeline

Bloom (`bloom.ts`) is a classic threshold → progressive-downsample → separable
Gaussian blur → weighted composite chain across **5 mip levels**:

1. Render the main scene to a full-res render target.
2. **Threshold** with a soft knee to extract bright pixels into mip 0.
3. For each of 5 mips, downsample and apply a 9-tap separable Gaussian (one
   horizontal pass into a temp target, one vertical pass back):

   ```glsl
   sum += texture2D(tDiffuse, vUv - 4.0 * direction) * 0.01621622;
   // ... symmetric weights ...
   sum += texture2D(tDiffuse, vUv)                   * 0.22702703;
   ```

4. **Composite**: add the 5 blurred mips back to the original with
   radius-dependent falloff weights `1/n^p` and a global `bloomStrength`:

   ```glsl
   float p = 1.2 + 0.8 * r;
   float w1 = 1.0 / pow(2.0, p);  // ... w2..w4
   vec4 bloom = (b0*w0 + b1*w1 + b2*w2 + b3*w3 + b4*w4) / wsum;
   gl_FragColor = vec4(orig.rgb + bloom.rgb * bloomStrength, 1.0);
   ```

The bloom pass can render into a target (for the TAA stage to consume) or
straight to screen.

### TAA: temporal anti-aliasing with Halton jitter

Because `sample_count: 1` (one ray per pixel per frame), spatial aliasing is
killed temporally instead. Each frame the camera ray origin is **jittered by a
sub-pixel offset from a Halton (2,3) low-discrepancy sequence**, and frames are
blended over time. The jitter generator:

```ts
function halton(index: number, base: number): number {
  let f = 1.0, r = 0.0, i = index
  while (i > 0) { f /= base; r += f * (i % base); i = Math.floor(i / base) }
  return r
}
function taaNextJitter(): THREE.Vector2 {
  const idx = (_taaFrameIndex % 8) + 1
  _taaFrameIndex++
  return new THREE.Vector2(halton(idx, 2) - 0.5, halton(idx, 3) - 0.5)
}
```

The jitter is injected into the ray in `main.glsl`:

```glsl
vec2 p = -1.0 + 2.0 * (gl_FragCoord.xy + jitter + taa_jitter) / resolution.xy;
```

The blend (`renderTAA` + `BLEND_FS`) mixes the current frame with the
history buffer, **neighborhood-clamping** the history to the current colour
(±`clipBox`) to suppress ghosting, plus a luminance-difference rejection and a
camera-motion rejection. When the camera moves fast, history weight drops to
zero so moving content stays sharp:

```glsl
his = clamp(his, cur - vec3(clipBox), cur + vec3(clipBox));
float lc = dot(cur, vec3(0.299,0.587,0.114));
float lh = dot(his, vec3(0.299,0.587,0.114));
float re = clamp(1.0 - abs(lc - lh) * 5.0, 0.0, 1.0);
float w  = historyWeight * historyValid * re;
gl_FragColor = vec4(mix(cur, his, w), 1.0);
```

```ts
const useHist = _taaHistoryValid && cameraDelta < s.max_camera_delta
const attn    = Math.max(0, 1 - cameraDelta * s.motion_rejection)
const hw      = useHist ? s.history_weight * attn : 0.0
```

The history/output targets ping-pong each frame. **TAA is desktop-only** — note
`taa_enabled: !_isMobile` and that `initTAA()` is only called `if (!_isMobile)`
in `init()`.

### Mobile vs desktop shader variants — why mobile integrates less

Mobile detection in the black-hole renderer is by viewport width:

```ts
_isMobile = window.innerWidth < 768
const fragShader = _isMobile ? FRAGMENT_SHADER_MOBILE : FRAGMENT_SHADER_DESKTOP
```

The mobile shader makes three concessions, all about fragment-shader cost
(a fullscreen ray-marcher is fragment-bound — every pixel runs the entire
integration loop):

1. **Fewer integration steps** — `n_steps: 64` vs `100`. Each step is a
   geodesic integration + scene compositing test, so this is the single
   biggest cost lever.
2. **Fewer revolutions** — `max_revolutions: 1.4` vs `2.0`. The total angular
   budget `MAX_REVOLUTIONS * 2π` is smaller, so the loop terminates sooner for
   rays that wind around the hole. Higher-order Einstein rings (which require
   tracing >1 full revolution) are sacrificed.
3. **No orbiting planet** — `planetEnabled: false` removes the ray-sphere
   intersection and its relativistic shading from every pixel.
4. **No TAA** — the temporal pipeline (extra render targets, blend/copy passes)
   is skipped entirely.

The observer/physics layer (`observer.ts`) is shared. The `Observer` keeps the
camera on a circular geodesic orbit and builds an orthonormal "orbital frame"
each step; `renderer.ts` maps that frame's basis vectors into the shader's
`cam_x/cam_y/cam_z` uniforms (with a deliberate column remap because the
shader's forward axis is the orbital "towards-BH" direction).

---

## 5. The Asteroid Field System

`src/systems/AsteroidField.ts` is a self-contained, reusable class that
generates and renders a Keplerian asteroid belt with three levels of detail. It
is used twice: the giant main belt in flight mode (`MAIN_BELT_CONFIG`) and the
compact hub belt.

### Seeded RNG for deterministic generation

The belt must look identical every reload (so the layout the author tuned is
stable) and must not depend on `Math.random()`. It uses a **Linear Congruential
Generator** with the classic Numerical-Recipes constants:

```ts
function seededRandom(seed: number) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff
    return (s >>> 0) / 0xffffffff
  }
}
```

Same `config.seed` → identical belt. `MAIN_BELT_CONFIG` uses `seed: 42`.

### Keplerian orbital mechanics

Each asteroid is stored not as a position but as a full set of **orbital
elements**, and its 3D position is computed each frame from them. The element
set:

```ts
interface AsteroidOrbit {
  semiMajorAxis:   number   // a — orbit size
  eccentricity:    number   // e — how elliptical (0 = circle)
  inclination:     number   // i — tilt out of the belt plane
  longitudeAN:     number   // Ω — where the orbit crosses the reference plane
  argPeriapsis:    number   // ω — orientation of the ellipse within its plane
  meanAnomaly:     number   // M — the body's phase along the orbit (advances with time)
  speed:           number   // dM/frame
}
```

**The terminology, concretely:**

- **Semi-major axis (a)** is half the long diameter of the elliptical orbit —
  effectively the orbit's radius. Drawn uniformly between the belt's inner and
  outer radius.
- **Eccentricity (e)** measures how stretched the ellipse is: `e = 0` is a
  perfect circle, approaching 1 is a thin cigar. Here it's kept small
  (`rand() * 0.15`) so orbits are nearly circular.
- **Inclination (i)** tilts the orbital plane relative to the belt's mean
  plane, giving the belt vertical thickness.
- **Longitude of ascending node (Ω)** and **argument of periapsis (ω)** orient
  the ellipse in 3D — which way it's rotated in the plane and which way the
  plane itself is swung.
- **Mean anomaly (M)** is the time-like parameter: it grows linearly and tells
  you where along the orbit the body currently is.

### The Kepler equation solver

The catch is that mean anomaly `M` is *not* the actual geometric angle. To get
the true position you must solve **Kepler's equation** `M = E − e·sin(E)` for
the eccentric anomaly `E`. This is transcendental — no closed form — so it's
solved with **Newton-Raphson iteration** (5 iterations, plenty for `e < 0.15`):

```ts
private orbitalToCartesian(orbit: AsteroidOrbit, target: THREE.Vector3): void {
  let E = orbit.meanAnomaly
  for (let i = 0; i < 5; i++) {
    E = E - (E - orbit.eccentricity * Math.sin(E) - orbit.meanAnomaly) /
            (1 - orbit.eccentricity * Math.cos(E))
  }

  const cosE = Math.cos(E)
  const sinE = Math.sin(E)
  const e    = orbit.eccentricity
  const nu   = Math.atan2(Math.sqrt(1 - e * e) * sinE, cosE - e)   // true anomaly
  const r    = orbit.semiMajorAxis * (1 - e * cosE)                // orbital radius

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
```

After solving for `E`: the **true anomaly** `ν` (the real angle from focus) is
derived, the **radius** `r` from the focus is `a(1 − e·cosE)`, and finally the
standard 3-rotation transform (by ω, i, Ω) maps the in-plane position into 3D
belt coordinates. Note the method writes into a passed-in `target` vector — see
[Performance Engineering](#8-performance-engineering) for why.

Each frame, `meanAnomaly` advances and wraps:

```ts
orbit.meanAnomaly += orbit.speed
if (orbit.meanAnomaly > Math.PI * 2) orbit.meanAnomaly -= Math.PI * 2
```

### Kirkwood gaps and density clustering

Real asteroid belts have **Kirkwood gaps** — radii swept clean by orbital
resonances with Jupiter — and dense **asteroid families**. Both are reproduced
in the placement loop via rejection sampling.

A candidate at a given radius near a configured gap is almost always rejected
(95% of the time):

```ts
const gaps = config.kirkwoodGaps ?? []
let inGap = false
for (const gapRadius of gaps) {
  if (Math.abs(radius - gapRadius) < 30) { inGap = true; break }
}
if (inGap && rand() > 0.05) continue
```

`MAIN_BELT_CONFIG` sets `kirkwoodGaps: [1350, 1480, 1620]`. Conversely, a few
randomly chosen **cluster** centres get a 3× density boost so asteroids bunch
into families:

```ts
let densityBoost = 1.0
for (let c = 0; c < clusterAngles.length; c++) {
  const dAngle  = Math.abs(angle - clusterAngles[c])
  const dRadius = Math.abs(radius - clusterRadii[c])
  const dist    = Math.sqrt(dAngle * dAngle * 10000 + dRadius * dRadius)
  if (dist < 150) { densityBoost = 3.0; break }
}
```

On top of that a **value-noise field** modulates overall density so the belt
isn't uniform:

```ts
const noiseVal          = noise2D(Math.cos(angle) * 3, Math.sin(angle) * 3)
const density           = 0.5 + 0.5 * noiseVal
const acceptProbability = Math.min(1.0, density * densityBoost)
if (rand() > acceptProbability) continue
```

Scales are cubically biased toward small (`Math.pow(t, 3)`) so most asteroids
are tiny and only a few are large, and tints are near-greyscale warm rock
(`setHSL(0.06..0.10, 0.05..0.15, 0.4..0.7)`).

### The three-tier LOD system

Rendering 3000 detailed asteroids every frame is impossible, so the field has
three representations chosen per-asteroid per-frame by squared distance to the
camera:

```ts
const NEAR_SQ = 600  * 600
const MID_SQ  = 2000 * 2000
// ...
const dSq = this.dummy.position.distanceToSquared(camPos)
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
```

- **Near** (`< 600` units): `meshHigh`, an `InstancedMesh` of a subdivision-3
  icosahedron whose vertices were randomly perturbed at construction for an
  irregular rocky silhouette, with the full triplanar shader.
- **Mid** (`< 2000`): `meshMid`, an `InstancedMesh` of a subdivision-2
  icosahedron (fewer triangles), same shader.
- **Far** (`>= 2000`): `pointsLow`, a single `THREE.Points` cloud of soft
  glowing sprites — far asteroids are sub-pixel, so a circular point sprite is
  both cheaper and looks better than tiny geometry. (Colours are boosted ×1.3
  so distant asteroids read as faint glints.)

Both instanced meshes have `instanceMatrix.setUsage(THREE.DynamicDrawUsage)`
because the matrices change every frame, and the visible `count` is reset each
frame (`this.meshHigh.count = nearCount`). The far points use
`geometry.setDrawRange(0, farCount)`.

### The bounding-sphere frustum-culling bug

This is the project's most subtle Three.js gotcha. **Three.js lazily computes a
mesh's bounding sphere the first time it needs it for frustum culling.** For an
`InstancedMesh` or `Points` whose visible count starts at 0 (as here — counts
are filled in only on the first `update()`), the lazily-computed bounding sphere
gets a **radius of −1**. A negative-radius sphere is *never* inside the frustum,
so Three.js permanently culls the mesh — the asteroids silently never render,
even after counts become non-zero, because the bad sphere is cached.

The fix is to **pre-set an explicit, correct bounding sphere** that encloses the
whole belt, on every instanced/point object, before the first render:

```ts
const beltCenter = new THREE.Vector3(config.centerX, config.centerY, config.centerZ)
const beltRadius = config.outerRadius + config.maxScale * 1.5
const beltSphere = new THREE.Sphere(beltCenter, beltRadius)

this.meshHigh.boundingSphere = beltSphere.clone()
this.meshMid.boundingSphere  = beltSphere.clone()
// ...
this.pointsLow.frustumCulled = false
farGeo.boundingSphere = beltSphere.clone()   // also guard the geometry-level sphere
// ...
this.dustPoints.frustumCulled = false
dustGeo.boundingSphere = new THREE.Sphere(beltCenter, config.outerRadius + 50)
```

The far points and dust additionally set `frustumCulled = false` as a
belt-and-braces measure. The class comment spells it out:

> *"Pre-set bounding spheres so frustum culling never permanently rejects them
> when nearCount / midCount is 0 on the first render."*
> *"Explicit bounding sphere avoids the radius=-1 culling bug on first frame."*

### Triplanar texture mapping — and why standard UVs failed

The near/mid asteroids are randomly-deformed icosahedra. They have **no sensible
UV unwrap** — there's no natural way to flatten a lumpy, procedurally-perturbed
rock onto a 2D texture without visible seams and stretching, especially since
the geometry is generated at runtime. The solution is **triplanar mapping**:
sample the texture three times (projected down the X, Y, and Z world axes) and
blend the three samples by the surface normal, so each part of the surface uses
whichever projection faces most directly outward. No UVs needed at all.

The custom `ShaderMaterial` is also forced to handle instancing manually,
because Three.js r184's instanced `ShaderMaterial` prefix injects
`instanceMatrix` but does **not** fold it into `modelMatrix` — you must compose
it yourself:

```glsl
// VERT
attribute vec3 instanceColor;
varying   vec3 vInstanceColor;
varying   vec3 vWorldPos;
varying   vec3 vWorldNormal;
void main() {
  mat4 instancedModelMatrix = modelMatrix * instanceMatrix;   // compose manually
  vec4 worldPos  = instancedModelMatrix * vec4(position, 1.0);
  vWorldPos      = worldPos.xyz;
  vWorldNormal   = normalize(mat3(instancedModelMatrix) * normal);
  vInstanceColor = instanceColor;
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
```

The fragment shader does the triplanar blend on diffuse, normal, and roughness
maps:

```glsl
// FRAG (excerpt)
vec3 blend = pow(abs(n), vec3(sharpness));        // sharpness=4 → tight seams
blend /= (blend.x + blend.y + blend.z + 0.001);

vec3 p = vWorldPos * scale;
vec4 xCol = texture2D(diffuseMap, p.yz);
vec4 yCol = texture2D(diffuseMap, p.xz);
vec4 zCol = texture2D(diffuseMap, p.xy);
vec4 col  = xCol * blend.x + yCol * blend.y + zCol * blend.z;
// ... same 3-axis blend for normalMap and roughMap ...
float diff  = max(dot(perturbedN, sunDir), 0.0) * 1.5;
float spec  = pow(max(dot(perturbedN, halfDir), 0.0), 32.0)  * specStr * 3.0;
float glint = pow(max(dot(perturbedN, halfDir), 0.0), 128.0) * 2.0;
vec3 litCol = tintedCol * (ambientCol + vec3(diff * 0.8)) + vec3(spec * 0.5) + vec3(glint);
litCol = max(litCol, tintedCol * 0.4);   // minimum-brightness floor so belt is never pitch black
```

The `instanceColor` per-instance attribute is managed as a geometry attribute
(not via Three's `setColorAt`, which the custom shader prefix doesn't wire up):

```ts
const colorBuf = new Float32Array(count * 3).fill(1)
geoHigh.setAttribute('instanceColor', new THREE.InstancedBufferAttribute(colorBuf.slice(), 3))
geoMid.setAttribute('instanceColor',  new THREE.InstancedBufferAttribute(colorBuf.slice(), 3))
```

### Dust haze

A separate `THREE.Points` cloud of large, soft, additively-blended sprites
fills the belt volume for atmospheric depth. It uses a custom point shader that
discards fragments outside a disc (so points are round, not square) — see
[Key Lessons](#10-key-lessons-learned) on the square-artifact bug:

```glsl
// fragment
uniform vec3 color;
void main() {
  float dist = length(gl_PointCoord - vec2(0.5));
  if (dist > 0.5) discard;
  float alpha = smoothstep(0.5, 0.0, dist) * 0.1;
  gl_FragColor = vec4(color, alpha);
}
```

---

## 6. GLB Models

Four glTF-binary models orbit Earth in flight mode: the **ISS**, the **JWST**
(James Webb Space Telescope), and an **astronaut** (a "sci-fi station" style
asset family). They're loaded with `GLTFLoader` + `DRACOLoader`.

### The Draco compression pipeline

All GLBs are Draco-compressed (geometry quantization + entropy coding) to shrink
download size. Decoding needs the Draco decoder WASM, which is pulled from
Google's CDN rather than bundled:

```tsx
const dracoLoader = new DRACOLoader()
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/')
const loader = new GLTFLoader()
loader.setDRACOLoader(dracoLoader)
loader.load(base + 'models/iss.glb', (gltf) => { ... })
```

Each loader returns a promise of `{ group, dispose }`; the `dispose` walks the
scene graph and frees every mesh's geometry and material(s). The `DRACOLoader`
itself is disposed right after load (`dracoLoader.dispose()`).

### The KHR_materials_pbrSpecularGlossiness compatibility issue

The astronaut GLB ships with materials using the **`KHR_materials_pbrSpecular-
Glossiness`** extension — a legacy glTF PBR workflow that **Three.js r184 no
longer supports** (it was dropped in favour of metallic-roughness). Loaded
as-is, the astronaut renders untextured/black or throws. The fix is to **replace
every mesh material on load** with a fresh `MeshStandardMaterial`:

```tsx
group.traverse((child) => {
  if ((child as THREE.Mesh).isMesh) {
    const mesh = child as THREE.Mesh
    mesh.castShadow    = false
    mesh.receiveShadow = false
    mesh.frustumCulled = false
    // KHR_materials_pbrSpecularGlossiness is unsupported in Three.js r184;
    // replace every mesh's material with a standard material
    mesh.material = new THREE.MeshStandardMaterial({
      color:     new THREE.Color(0xddddcc),
      roughness: 0.7,
      metalness: 0.1,
      side:      THREE.DoubleSide,
    })
  }
})
```

### The astronaut's baked-transform normalization

The astronaut is a Sketchfab export, and its root node (`Sketchfab_model`) has a
**baked-in transform** that translates the mesh ~(177, 283, −438) at a tiny
scale (~0.00143). Dropped into the scene naively, the astronaut would appear
thousands of units away from its intended orbit. The loader fixes this by
computing the world bounding box, recentering the first child, and rescaling so
the model's largest axis equals a target size:

```tsx
group.updateMatrixWorld(true)
const rawBox    = new THREE.Box3().setFromObject(group)
const rawCenter = rawBox.getCenter(new THREE.Vector3())
const rawSize   = rawBox.getSize(new THREE.Vector3())
const maxDim    = Math.max(rawSize.x, rawSize.y, rawSize.z)

if (group.children[0]) {
  group.children[0].position.sub(rawCenter)   // recenter at origin
  group.children[0].updateMatrix()
}
group.scale.setScalar(maxDim > 0 ? ASTRONAUT_SCALE / maxDim : ASTRONAUT_SCALE)
```

### Orbital animation

Each model orbits Earth on its own radius/speed, computed every frame in the
animation loop. The ISS and JWST also yaw to face their direction of travel:

```tsx
if (issGroup) {
  issAngle += ISS_ORBIT_SPEED
  issGroup.position.set(
    earthObj.group.position.x + Math.cos(issAngle) * ISS_ORBIT_RADIUS,
    earthObj.group.position.y + Math.sin(issAngle * 0.3) * 3,
    earthObj.group.position.z + Math.sin(issAngle) * ISS_ORBIT_RADIUS,
  )
  issGroup.rotation.y = -issAngle + Math.PI / 2
}
```

The astronaut tumbles on all three axes and carries its own `PointLight` so it's
visibly lit against the dark:

```tsx
astronautGroup.rotation.x += 0.001
astronautGroup.rotation.y += 0.0008
astronautGroup.rotation.z += 0.0005
if (astronautGroup.userData.light) {
  (astronautGroup.userData.light as THREE.PointLight).position.copy(astronautGroup.position)
}
```

---

## 7. Mobile Optimization

### Detection strategy

Flight mode and the components detect touch capability with feature detection
(not user-agent sniffing):

```tsx
const isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0
```

The black-hole renderer instead uses viewport width (`window.innerWidth < 768`),
since its concern is fragment cost / screen size rather than input method.

### Geometry segment reduction

Every sphere drops its tessellation on mobile. Inner (terrestrial) bodies go
`64 → 32` segments; outer (gas giants) and skybox go `32 → 16`; Saturn's ring
goes `128 → 64`:

```tsx
const INNER_SEGS = isMobile ? 32 : 64    // Earth, Moon, Mercury, Venus, Mars
const OUTER_SEGS = isMobile ? 16 : 32    // Jupiter, Saturn, Uranus, Neptune
const RING_SEGS  = isMobile ? 64 : 128   // Saturn rings
const SKY_SEGS   = isMobile ? 16 : 32    // skybox spheres
```

The asteroid field halves/quarters counts too (`MAIN_BELT_CONFIG`:
`count: 3000` desktop vs `countMobile: 500`), and the per-frame update **skips
2 of every 3 frames on mobile**:

```ts
update(cameraPosition?: THREE.Vector3): void {
  this.time++
  if (this.isMobile && this.time % 3 !== 0) return
  ...
}
```

Other mobile reductions: the procedural nebula becomes a few flat planes instead
of a fullscreen FBM shader; star count drops (`8000 → 3000` in `createStarField`);
JWST isn't loaded at all on mobile; dust/trail particle counts shrink; and the
renderer caps pixel ratio lower (`Math.min(window.devicePixelRatio, isMobile ? 1.5 : 2)`)
with antialiasing off (`antialias: !isMobile`).

### The touch-control evolution

`nipplejs` remains in `package.json` (`"nipplejs": "^1.0.4"`) as an artifact of
the journey, but the shipped controls are a **custom SVG joystick**
(`Joystick.tsx`). The progression was:

1. **Raw touch handlers** — direct `touchstart`/`move`/`end` on the canvas.
   Hard to make precise and to show feedback.
2. **NippleJS** — a drop-in virtual joystick library. Worked but was hard to
   style to match the HUD and tangled with React's lifecycle.
3. **Custom independent system** — the current `Joystick.tsx`: a self-contained
   SVG component that tracks a single touch by identifier, converts screen
   pixels to its own SVG units, clamps to a max travel radius, and reports a
   normalized `(-1..1, -1..1)` vector. It draws its own HUD-styled rings, tick
   marks, crosshair, and a glowing knob, dimming when idle and brightening when
   active.

The joystick's core mapping:

```tsx
const getVec = useCallback((clientX: number, clientY: number) => {
  const rect = svgRef.current!.getBoundingClientRect()
  const dx = (clientX - rect.left  - rect.width  / 2) * (140 / size)
  const dy = (clientY - rect.top   - rect.height / 2) * (140 / size)
  const len = Math.sqrt(dx * dx + dy * dy)
  if (len > maxTravel) {
    const s = maxTravel / len
    return { x: dx * s, y: dy * s }   // clamp to the rim
  }
  return { x: dx, y: dy }
}, [size, maxTravel])
```

Flight mode uses **two** joysticks (left = thrust+yaw, right = vertical) plus
BOOST/LAND buttons, wired in `FlightHUD.tsx`. The left stick maps its Y to
thrust/brake and X to yaw; importantly its handlers write **directly into
`inputRef`**.

### The critical bug: the keyboard RAF loop overwrote touch inputs every frame

`useFlightControls` runs a `requestAnimationFrame` loop that polls the keyboard
`Set` and writes the result into `inputRef.current` every frame. On a touch
device there are no key presses, so that loop would write **zeros** into
`inputRef` every single frame — stomping the values the touch buttons and
joysticks had just set, so touch controls did nothing.

The fix is decisive: **on touch devices the keyboard loop is never installed at
all.** Touch handlers become the sole writers of `inputRef`:

```ts
useEffect(() => {
  // On touch devices the keyboard loop would overwrite button-set values every frame.
  // Touch buttons write directly to inputRef, so skip the loop entirely on mobile.
  const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0
  if (isTouch) return
  // ... keyboard listeners + RAF poll loop only on desktop ...
}, [])
```

---

## 8. Performance Engineering

### Texture loading via `BASE_URL`

Every asset path is prefixed with `import.meta.env.BASE_URL` so the same code
works at the dev root (`/`) and under the GitHub-Pages subpath
(`/aboo-portfolio/`, set in `vite.config.ts`):

```tsx
const base   = import.meta.env.BASE_URL
const dayTex = loader.load(base + 'earth/earth-day.jpg')
```

Getting this wrong is one of the documented lessons — see below.

### Staggered GLB loading to avoid bandwidth contention

The GLBs are large (JWST alone is ~7 MB). Kicking off all three loads plus all
the planet textures at once would saturate the connection and stall the initial
render. So the heavy GLBs are deliberately **staggered with `setTimeout`** so
the scene paints first and models stream in afterward:

```tsx
createISS().then(({ group, dispose }) => { issGroup = group; scene.add(group) })

let jwstGroup: THREE.Group | null = null
if (!isMobile) {
  setTimeout(() => {
    createJWST().then(({ group, dispose }) => { jwstGroup = group; scene.add(group) })
  }, 3000)              // JWST waits 3s
}

setTimeout(() => {
  createAstronaut().then(({ group, dispose }) => { astronautGroup = group; scene.add(group) /* + light */ })
}, 2000)               // astronaut waits 2s
```

All three are also `null`-guarded everywhere they're used in the loop, because
they may not exist yet (or ever, on mobile for JWST).

### `distanceToSquared` over `distanceTo`

The LOD selection runs for every asteroid every frame. Computing true distance
needs a `sqrt`; comparing **squared** distances against squared thresholds gives
the identical ordering without the square root:

```ts
const NEAR_SQ = 600  * 600
const MID_SQ  = 2000 * 2000
const dSq = this.dummy.position.distanceToSquared(camPos)
if (dSq < NEAR_SQ) { /* near */ } else if (dSq < MID_SQ) { /* mid */ } else { /* far */ }
```

### Per-frame allocation avoidance (no GC churn)

A 3000-asteroid loop that allocated a `Vector3` per asteroid per frame would
generate ~180k short-lived objects per second and trigger GC stutter. The class
keeps **reusable scratch vectors** as fields and writes into them:

```ts
private _tempPos:  THREE.Vector3
private _zeroCam:  THREE.Vector3
// ...
this.orbitalToCartesian(orbit, this._tempPos)   // writes into _tempPos, allocates nothing
```

This is exactly why `orbitalToCartesian` takes a `target` out-parameter instead
of returning a new vector. The flight loop similarly pre-allocates its camera
follow vectors (`camFollowPos`, `camLookAt`, `camOffset`) once, outside the loop.

### Frustum culling considerations

Frustum culling is mostly a win (off-screen objects are skipped), but for the
procedurally-filled instanced/points objects it caused the radius=−1 bug
(Section 5). The resolution was explicit bounding spheres where culling is
wanted, and `frustumCulled = false` for always-present full-scene objects (the
star field, nebula background, far asteroid points, dust). The skybox and nebula
are also given `renderOrder = -1` / huge radii so they always draw behind
everything.

### React-boundary throttling

As covered in Architecture: per-frame data lives in refs; React state is set at
~10 Hz (`hudFrame % 6`), so the heavy React/framer-motion reconciliation never
runs at frame rate. The black-hole renderer goes further with a `_needsUpdate`
dirty flag and a `drawFrame(forceRender)` gate so it can skip redundant renders
when nothing changed.

---

## 9. Known Issues and Future Work

### Deliberately deferred: a real space engine

The asteroid field, while sophisticated, is a **single belt of pre-generated
orbits held entirely in memory**. The architecture that was consciously *not*
built here — to keep the portfolio shippable — is a streaming space engine:

- **Chunk streaming.** Instead of one belt with all orbits resident, divide
  space into spatial chunks and stream asteroid data in/out around the camera,
  so the world can be effectively unbounded without unbounded memory.
- **Multiple asteroid meshes.** The current field uses two shared base
  geometries (high/mid icosahedra) for *all* near/mid asteroids, so every rock
  is a scaled/rotated clone of two shapes. A real engine would maintain a
  library of distinct meshes for visual variety.
- These were explicitly earmarked for a **separate future repository**, not this
  portfolio.

### Incomplete / dormant code paths

- **The full Kerr geodesic integrator** in `geodesics.glsl` (Mino-time Carter
  equations) is complete but disabled in both shipped contexts
  (`kerr_full_geodesic: false`). Public spin is the perturbative frame-drag
  heuristic only. Enabling true Kerr is future work (and a perf question).
- **GRMHD thick-torus and slim-disk** accretion models exist in `trace_ray.glsl`
  behind `{{#accretion_thick_torus}}` / `{{#accretion_slim_disk}}` but the
  shipped contexts use only the **thin disk**. The torus/slim/jet machinery is
  wired and parameterized but unused in the default look.
- **Diagnostic scaffolding** remains in `renderer.ts`: `DEBUG_STAGE`,
  `DEBUG_FRAG`, and `dbgRT()` pixel-readback logging. Harmless (guarded by
  `DEBUG_STAGE > 0`, default 0) but is dead weight in production.
- **Console logging** on GLB load (`✅ ISS loaded successfully`, etc.) and the
  one-shot `[BH] cam_x:` logs are still present.

### Asset cleanup opportunities

`public/earth/` and `public/stars/` carry duplicate/unused textures (e.g.
`earth-daymap-4k.jpg` alongside `earth-day.jpg`, `8k_stars.jpg`,
`hipp8.jpg`/`tycho8.jpg`/`yale8.jpg` from the pre-procedural-starfield era,
`earth-normal.jpg`, `earth-specular.jpg`). Several 8k textures (Mercury 15 MB,
Mars 8 MB, Venus 12 MB) are heavy for the web and could be downsized.

### Two parallel solar-system implementations

`FlightMode.tsx` and `SpaceCanvas.tsx` each contain their own copies of the
`create<Planet>` factories and animation code. They've already drifted (scales,
positions, camera). Consolidating the planet factories into a shared module
would remove a large class of "fixed it in one file but not the other" bugs.

### README is the Vite template default

`README.md` is still the unmodified Vite + React + TS starter readme — it
doesn't describe this project at all.

---

## 10. Key Lessons Learned

The most valuable, reusable debugging insights surfaced by this project:

### 1. Three.js lazily caches bounding spheres — and caches −1 when empty

The headline bug. An `InstancedMesh`/`Points` whose visible count is 0 on first
render gets a **bounding sphere with radius −1**, which is cached and causes
permanent frustum culling even after the count grows. **Always pre-set explicit
bounding spheres** (or `frustumCulled = false`) on procedurally-populated
instanced or point objects:

```ts
this.meshHigh.boundingSphere = beltSphere.clone()
this.pointsLow.frustumCulled = false
farGeo.boundingSphere = beltSphere.clone()
```

### 2. A keyboard RAF loop will silently stomp touch input

If a per-frame loop unconditionally writes input state, it will overwrite
whatever another input source set. The fix was to **not install the keyboard
loop at all on touch devices** (`if (isTouch) return`), making touch handlers
the sole writers of `inputRef`. The general lesson: a single source of truth per
input channel, and don't run pollers for hardware that isn't present.

### 3. `import.meta.env.BASE_URL` must prefix every asset path

Under GitHub Pages the app is served from `/aboo-portfolio/`, not `/`. Any
hard-coded `/earth/earth-day.jpg` 404s in production while working in dev.
Prefixing with `BASE_URL` (which Vite sets from the `base` config) fixes it
everywhere — and the same care is needed for the Draco decoder and the
black-hole texture base:

```ts
const bh = base.endsWith('/') ? `${base}blackhole/` : `${base}/blackhole/`
```

### 4. GL points render as squares unless you discard outside the disc

A `THREE.Points` material draws each point as a square quad. Soft round
particles require a fragment shader that discards fragments beyond radius 0.5 in
`gl_PointCoord` space — used by both the dust haze and the far-LOD asteroid
sprites and the procedural starfield:

```glsl
float dist = length(gl_PointCoord - vec2(0.5));
if (dist > 0.5) discard;
```

### 5. Instanced ShaderMaterial in r184 doesn't fold in `instanceMatrix`

For a **custom** instanced `ShaderMaterial`, Three.js injects the
`instanceMatrix` attribute but does **not** compose it into `modelMatrix`. You
must build `modelMatrix * instanceMatrix` yourself in the vertex shader, and
manage per-instance colour as your own geometry attribute rather than via
`setColorAt`.

### 6. Sketchfab/glTF exports carry baked root transforms

Models can have large baked translations/scales on their root node that throw
them far off-origin. Normalize on load: measure the world bounding box,
recenter the child, and rescale to a known size. And watch for dropped glTF
extensions — `KHR_materials_pbrSpecularGlossiness` is unsupported in r184 and
must be swapped for `MeshStandardMaterial`.

### 7. Clamp delta-time and reset timers on visibility change

`requestAnimationFrame` pauses on backgrounded tabs. Without a `dt` clamp
(`Math.min(dt, 0.05)`) and a `visibilitychange` reset, the first frame back
applies seconds of accumulated time in one step and teleports everything. Every
loop in this codebase guards against it.

### 8. Throttle the React ↔ imperative boundary

Driving React state at 60 fps from a Three.js loop drowns the reconciler. Keep
hot data in refs, set React state at ~10 Hz, and mirror changing callbacks into
refs so a one-time `useEffect` closure always calls the latest version without
re-running and rebuilding the whole scene.

### 9. Squared distances and out-parameters beat clean-looking code in hot loops

In a 3000-iteration-per-frame loop, `distanceToSquared` avoids a `sqrt`, and
writing into reused scratch vectors avoids GC churn. The slightly less elegant
out-parameter signature (`orbitalToCartesian(orbit, target)`) is the right call
when it runs 180,000 times a second.

---

*End of report.*
