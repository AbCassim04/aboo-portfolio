# aboo-portfolio — Technical Report

> Author's personal engineering reference for the codebase.
> This document is regenerated from source and supersedes all previous versions.

- **Live site:** https://abcassim04.github.io/aboo-portfolio/
- **Repository:** https://github.com/AbCassim04/aboo-portfolio
- **Deployment:** GitHub Pages (static build from `dist/`, served under the `/aboo-portfolio/` base path)

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Architecture](#2-architecture)
3. [The Hub Scene (SpaceCanvas)](#3-the-hub-scene-spacecanvas)
4. [The Solar System](#4-the-solar-system)
5. [The Black Hole Raytracer](#5-the-black-hole-raytracer)
6. [The Asteroid Field System](#6-the-asteroid-field-system)
7. [Planet Labels and Info Panels](#7-planet-labels-and-info-panels)
8. [GLB Models](#8-glb-models)
9. [The Star Field](#9-the-star-field)
10. [Mobile Optimization](#10-mobile-optimization)
11. [The Loading Screen](#11-the-loading-screen)
12. [Performance Engineering](#12-performance-engineering)
13. [Known Issues and Future Work](#13-known-issues-and-future-work)
14. [Key Lessons Learned](#14-key-lessons-learned)

---

## 1. Project Overview

`aboo-portfolio` is a fully interactive 3D personal portfolio built as a real-time
WebGL experience. Instead of a conventional scrolling page, the visitor is dropped
into a **top-down overview of the solar system** (the *Hub*), can **pilot a UFO**
through a photorealistic, correctly-ordered planetary system (*Flight mode*), and
can dive into a **physically-based Kerr/Schwarzschild black-hole raytracer**
(*Black Hole mode*) rendered entirely in a fragment shader.

The portfolio content (About / Projects / Skills / Contact) lives as React overlays
that the camera flies to when you select a destination node in the Hub.

### Technology stack and rationale

| Layer | Choice | Why |
|------|--------|-----|
| UI framework | **React 19** | Component model for the overlay/HUD layer, `useState`/`useRef` for the imperative↔declarative boundary. |
| 3D engine | **Three.js r184** | Mature WebGL abstraction (geometry, `InstancedMesh`, `ShaderMaterial`, loaders). r184 specifics matter — see the custom instanced `ShaderMaterial` note in §14. |
| Language | **TypeScript** | Strict typing across the React/Three boundary; `tsc -b` gates every build. |
| Bundler | **Vite 8** | Fast HMR, `?raw` GLSL imports, `import.meta.env.BASE_URL` for GitHub Pages base-path handling. |
| Shaders | **GLSL** | The black hole is a single full-screen fragment shader; the star field, asteroids, planet atmospheres and nebula are all custom `ShaderMaterial`s. |
| Animation | **framer-motion** | Declarative enter/exit transitions for overlays, the planet info panel, and the HUD toasts. |
| Icons | **lucide-react** | `ArrowLeft`, `X`, `Mail`, etc. |
| Styling | **Tailwind** (+ inline styles) | Utility classes in overlays; `src/index.css` declares `@tailwind base/components/utilities` and the custom keyframes. |
| Model loading | **GLTFLoader + DRACOLoader** | Draco-compressed `.glb` models (ISS, JWST, astronaut), decoder pulled from the gstatic CDN. |

The app entry is `src/main.tsx`, which mounts `<App />` inside React `StrictMode`:

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

> **Note:** `StrictMode` double-invokes effects in development. Effects that own a
> `requestAnimationFrame` loop or an `AudioContext` (FlightMode, SpaceCanvas,
> LoadingScreen) rely on their cleanup functions being correct so the double-mount
> in dev does not leak. Production builds mount once.

---

## 2. Architecture

### Mode switching in `App.tsx`

`App.tsx` is a thin state machine. A single `useState` holds the active mode, and
each mode is a self-contained component that fully owns its Three.js scene. A
`?mode=` query parameter allows deep-linking directly into a mode (useful for
debugging the black hole without flying to it):

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

Because each mode is unmounted when it is not active, its `useEffect` cleanup tears
down the renderer, disposes geometries/materials/textures, and cancels the RAF
loop. Switching modes is a full scene teardown + rebuild, which keeps GPU memory
bounded.

### Component hierarchy

```
App
├── HubMode                         (owns useCameraNavigation)
│   ├── SpaceCanvas                 (imperative Three.js hub scene)
│   ├── HeroOverlay                 (nav, bio, Take Flight, Get In Touch)
│   ├── AboutOverlay
│   ├── SkillsOverlay
│   ├── ProjectsOverlay
│   └── ContactOverlay
├── FlightMode                      (imperative Three.js flight scene)
│   ├── FlightHUD                   (speed, radar, controls, joysticks)
│   ├── PlanetLabels                (DOM-projected 3D labels)
│   ├── PlanetInfoPanel             (framer-motion modal)
│   ├── LoadingScreen               (mission briefing)
│   └── About/Skills/Projects/Contact overlays (rendered in-place)
└── BlackHoleMode                   (imperative canvas → blackhole/renderer.ts)
```

`HubMode` wires the camera-navigation hook to the canvas and all overlays:

```tsx
export default function HubMode({ onTakeFlight }: HubModeProps) {
  const { currentZone, isTransitioning, navigateTo, cameraStateRef, onTransitionComplete } = useCameraNavigation()
  return (
    <>
      <SpaceCanvas cameraStateRef={cameraStateRef} currentZone={currentZone}
                   onTransitionComplete={onTransitionComplete} navigateTo={navigateTo} />
      <HeroOverlay currentZone={currentZone} isTransitioning={isTransitioning}
                   navigateTo={navigateTo} onTakeFlight={onTakeFlight} />
      {/* About / Skills / Projects / Contact overlays … */}
    </>
  )
}
```

### The ref-based boundary between React and Three.js

The core architectural pattern is that **React state never drives the per-frame
render loop directly**. The imperative Three.js loop lives inside a `useEffect`
with an empty dependency array, and communicates with React through two channels:

1. **Outbound (loop → React):** throttled `setState` calls (~10 Hz) for HUD values.
2. **Inbound (React → loop):** `useRef` objects that the loop reads every frame.

`useFlightControls` returns a *mutable ref* of the input state, and `useUFOPhysics`
returns a state ref plus an `update()` function. The flight loop reads
`inputRef.current` and mutates `ufoStateRef.current` in place — no re-render:

```ts
const inputRef               = useFlightControls()
const { ufoStateRef, update } = useUFOPhysics(inputRef)
```

The hub uses the same idea for the camera: `useCameraNavigation` exposes a
`cameraStateRef` that the render loop reads, plus `currentZoneRef` / `onCompleteRef`
/ `navigateToRef` kept in sync via small effects so the long-lived loop always sees
the latest closures:

```ts
const currentZoneRef = useRef(currentZone)
const onCompleteRef  = useRef(onTransitionComplete)
const navigateToRef  = useRef(navigateTo)
useEffect(() => { currentZoneRef.current = currentZone }, [currentZone])
useEffect(() => { onCompleteRef.current  = onTransitionComplete }, [onTransitionComplete])
useEffect(() => { navigateToRef.current  = navigateTo }, [navigateTo])
```

This is the crux of keeping a 60 fps WebGL loop from being throttled by React's
reconciler: the loop is imperative and ref-driven; React only paints the 2D UI.

### Shared planet factories — `src/utils/planetFactories.ts`

Both the Hub (`SpaceCanvas`) and Flight (`FlightMode`) scenes need Mercury through
Neptune with identical geometry/material/tilt setup. These were duplicated in both
files and are now consolidated into seven exported factory functions:

```ts
export function createMercury(loader: THREE.TextureLoader, isMobile: boolean): { group: THREE.Group; mesh: THREE.Mesh; dispose: () => void } {
  const base       = import.meta.env.BASE_URL
  const mercuryTex = loader.load(base + 'earth/8k_mercury.jpg')
  mercuryTex.colorSpace = THREE.SRGBColorSpace
  const group      = new THREE.Group()
  const INNER_SEGS = isMobile ? 32 : 64
  const mercuryGeo = new THREE.SphereGeometry(4, INNER_SEGS, INNER_SEGS)
  const mercuryMat = new THREE.MeshPhongMaterial({ map: mercuryTex, shininess: 5, side: THREE.FrontSide })
  const mesh       = new THREE.Mesh(mercuryGeo, mercuryMat)
  group.add(mesh)
  group.rotation.z = 0.034
  return { group, mesh, dispose: () => { mercuryGeo.dispose(); mercuryMat.dispose(); mercuryTex.dispose() } }
}
```

Each factory returns `{ group, mesh, dispose }` (Venus additionally returns
`atmoMesh`). Call sites position and scale the returned `group`; the geometry,
material, axial tilt (`group.rotation.z`), and disposal are owned by the factory.

### `src/data/planetData.ts` — single source of truth

Planet positions, sizes, colors, detection radii, and info-panel content are
centralized in one config array. It is consumed by the 3D→screen labels, the info
panels, and the NAV radar. Positions **must** match where `FlightMode` places the
planets (they are static — they only spin in place — so a fixed position is valid):

```ts
export interface PlanetDatum {
  key:             string
  name:            string
  abbr:            string   // short tag shown on the radar
  subtitle:        string   // the "Type" line, shown under the name
  colorHex:        number
  colorCss:        string
  position:        [number, number, number]
  detectionRadius: number   // label / info appear within this world-space range
  isSun?:          boolean
  stats:           PlanetStat[]
  funFact:         string
}
```

A representative entry:

```ts
{
  key: 'jupiter', name: 'Jupiter', abbr: 'J', subtitle: 'Gas giant',
  colorHex: 0xd8a06a, colorCss: '#d8a06a',
  position: [2500, 0, -40], detectionRadius: 500,
  stats: [
    { label: 'Type',              value: 'Gas giant' },
    { label: 'Diameter',          value: '139,820 km (11× Earth)' },
    { label: 'Distance from Sun', value: '5.2 AU' },
    { label: 'Day length',        value: '9 hours 56 minutes (fastest rotation)' },
    { label: 'Year length',       value: '11.86 Earth years' },
    { label: 'Moons',             value: '95 known moons' },
  ],
  funFact: 'The Great Red Spot is a storm that has been raging for over 350 years.',
},
```

---

## 3. The Hub Scene (SpaceCanvas)

`SpaceCanvas.tsx` is the landing experience: a **static, top-down/angled overview**
of the entire solar system, laid out at the same scale as flight mode so the two
read consistently.

### Fixed camera

The Hub camera is completely static (no animation). It sits high above and angled
back so the orbital plane is visible, centred on the system's midpoint (x ≈ 2000,
between the Sun at −4000 and Neptune at +8000). Because the scene now spans ~12 000
world units, the perspective far plane is extended from the old `1000` to `30000`:

```ts
// Far plane extended to cover the full solar-system span (Sun at -4000 to
// Neptune at +8000) plus the 10 000-radius skybox.
const camera = new THREE.PerspectiveCamera(75, w / h, 1, 30000)
camera.position.set(2000, 6000, 4000)
camera.lookAt(2000, 0, 0)
```

The same pose is defined in `useCameraNavigation`'s `ZONE_CAMERAS.hub` (so
transitions to/from the section zones start and end at the right place) and is
re-asserted every frame while in the hub zone:

```ts
} else if (currentZoneRef.current === 'hub') {
  // Static solar-system overview — no animation.
  camera.position.set(2000, 6000, 4000)
  camera.lookAt(2000, 0, 0)
}
```

### Planet layout

The Hub uses the **true flight-mode positions and sizes** — the factories already
produce flight-mode radii, so the old per-planet `.scale.setScalar(...)`
down-scaling was removed. Earth sits at the origin (`HUB_EARTH_POS = (0,0,0)`), and
the Moon, UFOs, and constellation node group are all positioned relative to it:

```ts
const mercuryObj = createMercury(sharedLoader, isMobile)
mercuryObj.group.position.set(-2800, 0, 20)
scene.add(mercuryObj.group)
// … venus -2000, mars 800, jupiter 2500, saturn 4000, uranus 6000, neptune 8000
```

### Orbital path rings

Each planet gets a thin elliptical orbit line, built from `THREE.EllipseCurve`,
centred on the Sun (`-4000,0,0`) with a radius equal to that planet's distance from
the Sun, rendered flat in the XZ orbital plane as a `LineLoop`:

```ts
const SUN_HUB_POS = new THREE.Vector3(-4000, 0, 0)
const orbitRadii  = [1200, 2000, 4000, 4800, 6500, 8000, 10000, 12000] // Mercury→Neptune
const orbitRingGeos: THREE.BufferGeometry[]   = []
const orbitRingMats: THREE.LineBasicMaterial[] = []
for (const r of orbitRadii) {
  const curve = new THREE.EllipseCurve(0, 0, r, r, 0, Math.PI * 2, false, 0)
  const geo   = new THREE.BufferGeometry().setFromPoints(curve.getPoints(180))
  geo.rotateX(Math.PI / 2) // XY curve → XZ orbital plane
  const mat  = new THREE.LineBasicMaterial({ color: 0xbbccd7, transparent: true, opacity: 0.18 })
  const line = new THREE.LineLoop(geo, mat)
  line.position.copy(SUN_HUB_POS)
  scene.add(line)
  orbitRingGeos.push(geo)
  orbitRingMats.push(mat)
}
```

### Hub asteroid belt configuration

The Hub reuses `MAIN_BELT_CONFIG` (same dimensions and centre as flight mode) but
overrides the instance counts — the hub only needs a visual representation, not the
full 3000 asteroids:

```ts
// Same dimensions as flight mode (centred on the origin, between Mars and
// Jupiter along +X) but far fewer asteroids …
const hubBelt = new AsteroidField({
  ...MAIN_BELT_CONFIG,
  count:       500,
  countMobile: 100,
}, isMobile)
hubBelt.addToScene(scene)
```

Because `hubBelt.update()` is called with **no camera argument**, the LOD distance
is measured from the origin, which places the belt's 1200–1800 radius asteroids in
the mid-detail band — they render as instanced meshes plus the far point sprites and
haze ring (see §6).

### Sun

The Hub Sun matches flight mode: a 140-radius sphere at `-4000,0,0` with layered
additive corona/glow/bloom shells and a `DirectionalLight` streaming across the
planets from the left:

```ts
const SUN_POS = new THREE.Vector3(-4000, 0, 0)
const sunGeo  = new THREE.SphereGeometry(140, 64, 64)
// corona 161, glow 175, bloom1 240, bloom2 350 (all BackSide, AdditiveBlending)
const sunLight = new THREE.DirectionalLight(0xfff5e0, 3.5)
sunLight.position.set(-4000, 800, 0)
sunLight.target.position.set(2000, 0, 0)
```

### Hero overlay and bio

`HeroOverlay.tsx` renders the top nav (About/Projects/Skills/Contact), and a bottom
row with the bio (left), the **Take Flight** button (centre), and the **Get In
Touch** magnet button (right). The headline was removed so the solar system fills
the space. The bio text:

```tsx
<p className="text-[#D7E2EA] font-light uppercase tracking-wide leading-snug …">
  a cs &amp; maths student building at the intersection of ml, research, and the web
</p>
```

Destination markers (ABOUT/SKILLS/PROJECTS/CONTACT) are wireframe polyhedra with a
Fresnel glow aura, floating near the origin; clicking a nav item (or, on mobile,
raycasting a hidden hit-sphere) fires `navigateTo`, which drives a quadratic-bezier
camera flight defined in `useCameraNavigation`.

---

## 4. The Solar System

The flight-mode solar system is a linear "planet parade" along +X, matching the
real ordering. All bodies are static (they spin in place); they do not orbit.

### Rescaled layout

| Body | Position (x,y,z) | Sphere radius |
|------|------------------|---------------|
| Sun | `(-4000, 0, 0)` | 140 |
| Mercury | `(-2800, 0, 20)` | 4 |
| Venus | `(-2000, 0, -30)` | 9 (+ 9.8 atmosphere) |
| Earth | `(0, 0, 0)` | 10 |
| Mars | `(800, 0, 20)` | 7 |
| (Asteroid belt) | centre `(0,0,0)`, r 1200–1800 | — |
| Jupiter | `(2500, 0, -40)` | 110 |
| Saturn | `(4000, 0, 30)` | 90 (rings 117–216) |
| Uranus | `(6000, 0, -20)` | 40 |
| Neptune | `(8000, 0, 10)` | 38 |

### Axial tilts and rotation speeds

Axial tilt is baked into each factory as `group.rotation.z` (radians); rotation
speed is applied per frame in the flight loop. Values approximate real astronomy
(e.g. Venus is retrograde → negative rotation and a ~177° tilt of `3.096` rad;
Uranus is tipped on its side at `1.706` rad ≈ 97.8°):

```ts
mercuryObj.mesh.rotation.y += 0.0008     // tilt 0.034
venusObj.mesh.rotation.y   -= 0.0001     // tilt 3.096 (retrograde)
venusObj.atmoMesh.rotation.y -= 0.00015  // super-rotating atmosphere
marsObj.mesh.rotation.y    += 0.0004     // tilt 0.4396
jupiterObj.mesh.rotation.y += 0.001      // tilt 0.0546 (fastest)
saturnObj.mesh.rotation.y  += 0.0009     // tilt 0.4665
uranusObj.mesh.rotation.y  += 0.0003     // tilt 1.706 (on its side)
neptuneObj.mesh.rotation.y += 0.00035    // tilt 0.4942
```

Earth's tilt is `group.rotation.z = 0.4101` (≈ 23.5°); its surface rotates at
`+0.0003` and its cloud layer slightly faster at `+0.0005` so the clouds drift over
the surface.

### Earth's day/night terminator with emissive city lights

Earth uses a single `MeshPhongMaterial` with the daymap as `map` and the nightmap
as `emissiveMap`. Where the day texture is lit by the `DirectionalLight` the day
side shows; where it is in shadow the emissive night-lights texture glows through —
producing a moving terminator with city lights on the dark side:

```ts
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

A separate additive **atmosphere shell** (`BackSide`) adds the blue rim glow via a
Fresnel term:

```glsl
varying vec3 vNormal;
void main() {
  float intensity = pow(0.65 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 3.0);
  gl_FragColor = vec4(0.3, 0.6, 1.0, 1.0) * intensity;
}
```

### Saturn's custom radial UV ring mapping

`RingGeometry`'s default UVs are unusable for a ring texture (they wrap around the
annulus rather than running radially). The factory rewrites every vertex UV so that
`u` is the **normalized radial distance** from inner to outer edge and `v` is pinned
to `0.5`, so the 1-D ring-alpha texture maps correctly from the inner gap outward:

```ts
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

### Venus's two-layer atmosphere

Venus is a solid surface sphere (radius 9) wrapped in a slightly larger (9.8),
semi-transparent, double-sided cloud sphere that counter-rotates faster than the
surface — modelling Venus's famous super-rotating atmosphere:

```ts
const venusGeo = new THREE.SphereGeometry(9, INNER_SEGS, INNER_SEGS)
const venusMat = new THREE.MeshPhongMaterial({ map: venusTex, shininess: 8, side: THREE.FrontSide })
const mesh     = new THREE.Mesh(venusGeo, venusMat); group.add(mesh)
const atmoGeo  = new THREE.SphereGeometry(9.8, INNER_SEGS, INNER_SEGS)
const atmoMat  = new THREE.MeshPhongMaterial({ map: atmoTex, shininess: 3, side: THREE.DoubleSide, transparent: true, opacity: 0.7, depthWrite: false })
const atmoMesh = new THREE.Mesh(atmoGeo, atmoMat); group.add(atmoMesh)
group.rotation.z = 3.096
```

### The Sun, DirectionalLight, and ACES tone mapping

In flight mode the renderer uses sRGB output and ACES Filmic tone mapping so the
bright Sun/HDR emissives roll off cinematically instead of clipping:

```ts
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.0
```

The Sun sphere is unlit (`MeshBasicMaterial` with the sun texture) at `-4000,0,0`,
surrounded by concentric additive corona/glow/bloom shells. The scene's single
`DirectionalLight` originates from the Sun's side so all planets are lit from the
left:

```ts
const sunLight = new THREE.DirectionalLight(0xfff5e0, 3.5)
sunLight.position.set(-4000, 0, 0)
sunLight.target.position.set(0, 0, 0)
```

A faint `AmbientLight(0x111122, 0.08)` keeps shadowed sides from being pure black,
and a purple `PointLight` provides UFO rim lighting.

### Surface repulsion (Earth, Jupiter, Saturn)

To stop the UFO from flying *through* the large bodies, the flight loop applies a
simple collision response each frame: if the UFO is inside a body's guard radius it
is pushed back to the surface, and any inward velocity component is cancelled
(velocity is projected out along the surface normal):

```ts
// Earth surface repulsion
const toUFO = ufoStateRef.current.position.clone().sub(EARTH_POS)
const distToEarth = toUFO.length()
if (distToEarth < EARTH_RADIUS + EARTH_BUFFER) {
  const pushDir = toUFO.normalize()
  ufoStateRef.current.position.copy(EARTH_POS).addScaledVector(pushDir, EARTH_RADIUS + EARTH_BUFFER)
  const dot = ufoStateRef.current.velocity.dot(pushDir)
  if (dot < 0) ufoStateRef.current.velocity.addScaledVector(pushDir, -dot)
}

// Jupiter surface repulsion — guard radius 125
const toUFOJupiter = ufoStateRef.current.position.clone().sub(jupiterObj.group.position)
if (toUFOJupiter.length() < 125) {
  ufoStateRef.current.position.copy(jupiterObj.group.position).addScaledVector(toUFOJupiter.normalize(), 125)
  const dot = ufoStateRef.current.velocity.dot(toUFOJupiter.normalize())
  if (dot < 0) ufoStateRef.current.velocity.addScaledVector(toUFOJupiter.normalize(), -dot)
}

// Saturn repulsion (including rings) — guard radius 230
```

Saturn's guard radius (230) is larger than its sphere (90) so the collision hull
also protects the ring plane out to ~216.

---

## 5. The Black Hole Raytracer

Black Hole mode (`src/blackhole/`) renders a relativistic accretion-disk black hole
entirely in a **single full-screen fragment shader**. The vertex shader just emits a
clip-space quad; every pixel casts a photon backwards through curved spacetime.

### The GLSL pipeline and shader assembly (`src/shaders/blackhole/`)

The shader is split into stages, each a `.glsl` file imported `?raw` and concatenated
by `compiled.ts`. Feature flags are resolved by a small mustache-style templater at
build time, producing two variants:

```ts
const RAW_GLSL =
  definesGlsl + '\n' + mathGlsl + '\n' + geodesicsGlsl + '\n' +
  accretionGlsl + '\n' + backgroundGlsl + '\n' + planetGlsl + '\n' +
  jetGlsl + '\n' + traceRayGlsl + '\n' + tonemapGlsl + '\n' + mainGlsl

export const FRAGMENT_SHADER_DESKTOP: string = resolveMustache(RAW_GLSL, DESKTOP_CTX)
export const FRAGMENT_SHADER_MOBILE: string  = resolveMustache(RAW_GLSL, MOBILE_CTX)
```

The templater supports `{{#flag}}…{{/flag}}` (include-if-true), `{{^flag}}…{{/flag}}`
(include-if-false), and `{{scalar}}` substitution, run over six passes to handle
cross-flag nesting.

Stage roles:

- **`defines.glsl`** — macros, all uniforms, constants (`NSTEPS`, ISCO, star/galaxy brightness), FOV.
- **`math.glsl`** — `lorentz_velocity_transformation`, value noise / fbm, coordinate helpers.
- **`geodesics.glsl`** — Schwarzschild Binet solver + experimental Kerr Mino-time integrator.
- **`accretion.glsl`** — Shakura-Sunyaev thin disk, ADAF/RIAF thick torus, slim disk; gravitational redshift.
- **`background.glsl`** — Milky Way galaxy texture with relativistic Doppler/blueshift remap and H-alpha handling.
- **`planet.glsl`** — ray-sphere intersection for the orbiting reference planet with Lorentz contraction, light-travel-time, Doppler.
- **`jet.glsl`** — relativistic jet (simple parabolic or physical GRMHD-inspired with knots/corona).
- **`trace_ray.glsl`** — the marcher that composites all sources with Beer-Lambert transmittance.
- **`tonemapping.glsl`** — ACES / AGX / Log-Scientific operators and `finalize_color()`.
- **`main.glsl`** — MSAA sampling loop and entry point.

### The Schwarzschild Binet geodesic integrator

Photon paths for all user-facing modes are integrated with the **Binet equation**
in the inverse radius `u = 1/r`. The null-geodesic acceleration is
`d²u/dφ² = -u + (3/2)u²` (the `1.5·u²` term is the GR light-bending correction over
Newtonian), plus a perturbative spin term:

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

The default (non-RK4) integrator is a symplectic **leapfrog / velocity-Verlet**
half-kick–drift–half-kick step (an RK4 branch exists behind the `rk4_integration`
flag but is off in both presets):

```glsl
du += 0.5 * geodesic_accel(u, spin_alignment) * step;
u  += du * step;
du += 0.5 * geodesic_accel(u, spin_alignment) * step;
```

Inside `trace_ray`, each step advances the orbital angle `phi`, reconstructs the
Cartesian position on the orbital plane, and the horizon is detected when `u >= 1.0`
(exterior mode; `r_s = 1`):

```glsl
integrate_geodesic_step(u, du, step, spin_alignment);
if (interior_mode < 0.5) {
    if (u >= 1.0) { shadow_capture = true; break; }
}
phi += step;
vec3 planar_pos = (cos(phi)*normal_vec + sin(phi)*tangent_vec)/u;
```

Step size is adaptive: it shrinks near the photon sphere (`u ≈ 0.667`) so tight
windings that produce secondary/tertiary Einstein rings are not skipped
(`step *= 1.0 - 0.7 * photon_sphere_proximity`).

### The perturbative Kerr frame-drag heuristic

User-facing spin modes do **not** integrate the full Kerr metric. Instead the
photon's azimuthal position is rotated about the spin axis by an accumulated
"frame-drag phase" that scales with spin, spin strength, alignment, and `u³`
(concentrating the effect near the hole):

```glsl
float drag_u = clamp(u, 0.0, 1.15);
float frame_drag_step = photon_spin_lensing_scale *
    bh_rotation_enabled * bh_spin * bh_spin_strength *
    spin_alignment * step * 0.85 * drag_u*drag_u*drag_u;
frame_drag_phase += frame_drag_step;
pos = rotate_about_z(planar_pos, frame_drag_phase);
```

A **true Kerr** integrator (Carter 1968 separated equations in Mino time —
`kerr_r_accel`, `kerr_cth_accel`, `kerr_phi_dot`, `kerr_init`, `integrate_kerr_step`)
exists in `geodesics.glsl` and is wired into `trace_ray` behind the
`kerr_full_geodesic` flag, but that flag is `false` in both the desktop and mobile
presets — it is experimental and not exposed in the public UI. The separated Kerr
equations it implements are, per the file's own derivation comment:

```glsl
//   d²r/dσ²      = R'(r)/2
//   d²(cosθ)/dσ² = Θ̃'(cosθ)/2
//   dφ/dσ        = Φ_r(r) + Φ_θ(θ)
// R(r) = P² − Δ K,   P = r²+a²−aξ,  K = (ξ−a)²+η
```

### Mobile vs desktop shader variants

The two presets differ only in cost/features. Desktop enables the reference planet
and uses 100 integration steps; mobile drops the planet and reduces steps and max
revolutions:

```ts
const DESKTOP_CTX: MustacheCtx = {
  /* … */ planetEnabled: true, n_steps: 100, sample_count: 1, max_revolutions: 2.0,
}
const MOBILE_CTX: MustacheCtx = {
  ...DESKTOP_CTX,
  planetEnabled: false,
  n_steps: 64,
  max_revolutions: 1.4,
}
```

### TAA with Halton jitter

On desktop the renderer applies **temporal anti-aliasing**. Each frame the camera is
sub-pixel jittered with a Halton(2,3) sequence, the new frame is blended against
history with luminance-based clipping, and history is rejected on large camera
motion:

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

The blend shader clamps history to a box around the current color and attenuates the
history weight by camera delta:

```glsl
his = clamp(his, cur-vec3(clipBox), cur+vec3(clipBox));
float lc = dot(cur, vec3(0.299,0.587,0.114)); float lh = dot(his, vec3(0.299,0.587,0.114));
float re = clamp(1.0-abs(lc-lh)*5.0, 0.0, 1.0);
float w = historyWeight*historyValid*re;
gl_FragColor = vec4(mix(cur,his,w), 1.0);
```

The two history/output render targets ping-pong each frame (`_taaHistoryRT` becomes
the last screen output).

### The 5-level mip Gaussian bloom pipeline (`bloom.ts`)

Bloom is a bright-pass threshold followed by a 5-level progressive downsample with a
9-tap separable Gaussian per level, composited back with per-mip weights:

```ts
const BLOOM_LEVELS = 5
// threshold → mips[0]; then for each level: copy down, blur X (tmp), blur Y (mip)
blurMat.uniforms['direction'].value.set(1.0 / mw, 0)   // horizontal
// …
blurMat.uniforms['direction'].value.set(0, 1.0 / mh)   // vertical
```

The threshold pass uses a soft knee so the bloom onset is gradual, and composite
weights fall off with a radius-dependent power:

```glsl
float p = 1.2 + 0.8 * r;
float w0 = 1.0, w1 = 1.0/pow(2.0,p), w2 = 1.0/pow(3.0,p), w3 = 1.0/pow(4.0,p), w4 = 1.0/pow(5.0,p);
vec4 bloom = (tBloom0*w0 + tBloom1*w1 + tBloom2*w2 + tBloom3*w3 + tBloom4*w4) / (w0+w1+w2+w3+w4);
gl_FragColor = vec4(orig.rgb + bloom.rgb * bloomStrength, 1.0);
```

### Tone mapping and `finalize_color`

`finalize_color()` exposes three operators selected by the `look_tonemap_mode`
uniform: ACES Filmic (mode 0), AGX with a punchy look (mode 1), and a Logarithmic
Scientific false-color mapping through the Inferno palette (mode 2) that mimics how
EHT / GRMHD papers display disk data. The ACES branch:

```glsl
mapped = aces_filmic(exposed);
float lum = dot(mapped, vec3(0.2126, 0.7152, 0.0722));
mapped += mapped * smoothstep(0.82, 1.0, lum) * 0.06;
mapped = pow(mapped, vec3(1.0/2.2));
```

### The critical `_isMobile` bug (module-level freeze)

`renderer.ts` declares `_isMobile` as a module-level `let` initialized to `false`,
but `init()` only sets its real value later:

```ts
let _isMobile = false
// …
export function init(canvas: HTMLCanvasElement, onReady: () => void): void {
  _isMobile = window.innerWidth < 768
  const fragShader = _isMobile ? FRAGMENT_SHADER_MOBILE : FRAGMENT_SHADER_DESKTOP
  // …
}
```

The trap: `PARAMS` is a module-level constant, and `taa_enabled: !_isMobile` is
evaluated **at import time** — when `_isMobile` is still `false`. So
`PARAMS.taa_enabled` is frozen to `true` regardless of device. The correct value is
never re-derived. The code is made safe by never trusting that flag alone: the TAA
render targets are only allocated inside `init()` when `!_isMobile`, and the frame
path gates on the target actually existing:

```ts
if (!_isMobile) { initTAA(w, h) }
// …
const taaEnabled = PARAMS.taa_enabled && !!_taaCurrentRT
```

On mobile `_taaCurrentRT` is `null`, so `taaEnabled` collapses to `false` even
though `PARAMS.taa_enabled` is stuck at `true`. The lesson (see §14) is that any
`const` derived from a mutable module-level flag captures the flag's *initial*
value.

### The debug apparatus that was removed

`renderer.ts` previously carried a large diagnostic system: a `DEBUG_STAGE` /
`DEBUG_FRAG` fragment-shader override table (solid-red / UV-gradient / ray-direction
stages), a `dbgRT()` render-target pixel-readback helper, a `_camLogged` one-shot
camera-vector logger, and per-frame `console.log` readbacks of the pre-bloom,
post-bloom, and post-TAA targets. All of it — plus the associated `console.log` /
`console.warn` calls — was stripped in cleanup. The only console call kept is the
genuine error handler:

```ts
}).catch((err: unknown) => {
  console.error('[BlackHole] Texture load failed:', err)
  onReady() // show canvas anyway, will be black
  animate()
})
```

The `Observer` class (`observer.ts`) drives the camera along a circular orbit,
building an orthonormal `orbitalFrame()` and applying gravitational time dilation to
its proper-time accumulation (`scaledDt / sqrt(1 - 1.5/r)` for a moving observer).

---

## 6. The Asteroid Field System

`src/systems/AsteroidField.ts` is a self-contained, reusable belt engine driven by a
config object. It is used by both the flight belt (`MAIN_BELT_CONFIG`, 3000/500) and
the hub belt (500/100). Development happened in phases.

### Phase 1 — InstancedMesh engine + seeded RNG

The belt is deterministic: a 32-bit **linear congruential generator** seeds all
placement, so the same belt is reproduced every load:

```ts
function seededRandom(seed: number) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff
    return (s >>> 0) / 0xffffffff
  }
}
```

Geometry is a subdivided icosahedron whose vertices are randomly displaced to give
each asteroid a lumpy silhouette, then normals are recomputed. Two detail levels
(`IcosahedronGeometry(1,3)` high, `(1,2)` mid) feed two `InstancedMesh`es sharing one
triplanar `ShaderMaterial`.

### Phase 2 — Keplerian orbital mechanics

Each asteroid carries a full set of orbital elements:

```ts
interface AsteroidOrbit {
  semiMajorAxis:   number
  eccentricity:    number
  inclination:     number
  longitudeAN:     number   // longitude of ascending node
  argPeriapsis:    number   // argument of periapsis
  meanAnomaly:     number
  speed:           number
}
```

Per frame the mean anomaly advances, and `orbitalToCartesian` converts the elements
to a world position. The eccentric anomaly `E` is solved from the mean anomaly `M`
by **Newton's method on Kepler's equation** `M = E − e·sinE` (5 iterations), then the
true anomaly `ν` and radius `r` follow, and the position is rotated by
argument-of-periapsis, inclination, and longitude-of-ascending-node:

```ts
private orbitalToCartesian(orbit: AsteroidOrbit, target: THREE.Vector3): void {
  let E = orbit.meanAnomaly
  for (let i = 0; i < 5; i++) {
    E = E - (E - orbit.eccentricity * Math.sin(E) - orbit.meanAnomaly) /
            (1 - orbit.eccentricity * Math.cos(E))
  }
  const cosE = Math.cos(E), sinE = Math.sin(E), e = orbit.eccentricity
  const nu   = Math.atan2(Math.sqrt(1 - e * e) * sinE, cosE - e)
  const r    = orbit.semiMajorAxis * (1 - e * cosE)
  const cosNu = Math.cos(nu + orbit.argPeriapsis), sinNu = Math.sin(nu + orbit.argPeriapsis)
  const cosI  = Math.cos(orbit.inclination), sinI = Math.sin(orbit.inclination)
  const cosAN = Math.cos(orbit.longitudeAN), sinAN = Math.sin(orbit.longitudeAN)
  target.set(
    r * (cosAN * cosNu - sinAN * sinNu * cosI),
    r * (sinNu * sinI),
    r * (sinAN * cosNu + cosAN * sinNu * cosI),
  )
}
```

`target` is an **out-parameter** (a reused scratch vector), avoiding an allocation
per asteroid per frame. `E = E − (E − e·sinE − M) / (1 − e·cosE)` is exactly the
Newton–Raphson update for `f(E) = E − e·sinE − M`, whose derivative is
`f'(E) = 1 − e·cosE`.

### Phase 3 — Three-tier LOD + the bounding-sphere culling bug

Each frame every asteroid is classified by squared distance to the camera into
**near** (high-detail mesh), **mid** (mid-detail mesh), or **far** (point sprite):

```ts
const NEAR_SQ = 600  * 600
const MID_SQ  = 2000 * 2000
// …
if (dSq < NEAR_SQ) {
  highColors.setXYZ(nearCount, c.r, c.g, c.b)
  this.meshHigh.setMatrixAt(nearCount++, this.dummy.matrix)
} else if (dSq < MID_SQ) {
  midColors.setXYZ(midCount, c.r, c.g, c.b)
  this.meshMid.setMatrixAt(midCount++, this.dummy.matrix)
} else {
  farPosAttr.setXYZ(farCount, this.dummy.position.x, this.dummy.position.y, this.dummy.position.z)
  // warm/bright far color …
  farCount++
}
```

**The bug:** Three.js computes an `InstancedMesh` bounding sphere lazily on first
render. On the very first frame `count` can be `0` (nothing in that LOD band yet),
and Three.js then caches a bounding sphere with `radius = -1`, which makes the mesh
**permanently frustum-culled** — it never reappears even once instances are added.
The fix is to pre-set an explicit bounding sphere that covers the whole belt so the
lazy computation never runs with `count = 0`:

```ts
// Pre-set bounding spheres so frustum culling never permanently rejects
// them when nearCount / midCount is 0 on the first render.
const beltCenter = new THREE.Vector3(config.centerX, config.centerY, config.centerZ)
const beltRadius = config.outerRadius + config.maxScale * 1.5
const beltSphere = new THREE.Sphere(beltCenter, beltRadius)
this.meshHigh.boundingSphere = beltSphere.clone()
this.meshMid.boundingSphere  = beltSphere.clone()
```

The far point cloud gets the same treatment (`farGeo.boundingSphere = beltSphere.clone()`)
to dodge the analogous `radius = -1` bug on `BufferGeometry`, and each frame ends by
setting `this.pointsLow.geometry.setDrawRange(0, farCount)` so only the populated far
instances draw.

### Phase 5 — Kirkwood gaps + density clustering (rejection sampling)

Placement is **rejection sampling**. A candidate `(angle, radius)` is drawn, then
accepted or rejected against three effects.

**Kirkwood gaps** — candidates within 20 units of a resonance radius are almost
always rejected (only a 5% leak keeps the gaps from looking too clean):

```ts
const gaps = config.kirkwoodGaps ?? []   // e.g. [1350, 1480, 1620]
let inGap = false
for (const gapRadius of gaps) {
  if (Math.abs(radius - gapRadius) < 20) { inGap = true; break }
}
if (inGap && rand() > 0.05) continue
```

**Cluster families** — a set of `(angle, radius)` cluster centres is generated up
front; candidates near a centre get a 3× density boost:

```ts
const clusterCount  = config.clusterCount ?? 0
for (let c = 0; c < clusterCount; c++) {
  clusterAngles.push(rand() * Math.PI * 2)
  clusterRadii.push(config.innerRadius + rand() * (config.outerRadius - config.innerRadius))
}
// … per candidate:
let densityBoost = 1.0
for (let c = 0; c < clusterAngles.length; c++) {
  const dAngle = Math.abs(angle - clusterAngles[c])
  const dRadius = Math.abs(radius - clusterRadii[c])
  const dist   = Math.sqrt(dAngle * dAngle * 10000 + dRadius * dRadius)
  if (dist < 150) { densityBoost = 3.0; break }
}
```

**Value-noise density** — a smooth 2-D value-noise field over the belt angle
modulates acceptance probability, giving natural clumps and voids:

```ts
const noiseVal          = noise2D(Math.cos(angle) * 3, Math.sin(angle) * 3)
const density           = 0.5 + 0.5 * noiseVal
const acceptProbability = Math.min(1.0, density * densityBoost)
if (rand() > acceptProbability) continue
```

The `noise2D` function is a hand-rolled bilinear-interpolated integer-hash value
noise with a smoothstep fade (`u = xf*xf*(3-2*xf)`).

### Phase 6 — Triplanar texture mapping

**Why standard UVs fail:** `IcosahedronGeometry` has no sensible UV unwrap — a
single 2-D texture projected onto it stretches and seams badly, and each instance is
randomly rotated so a shared UV set would look repetitive. **Triplanar mapping**
solves this by sampling the texture three times — once per world axis — and blending
by the surface normal, so there is no UV dependence at all.

The vertex shader must compose the world transform manually. On r184 the injected
prefix for an instanced `ShaderMaterial` provides `modelMatrix`, `viewMatrix`,
`instanceMatrix`, etc., but does **not** pre-multiply `instanceMatrix` into
`modelViewMatrix`, so we build `modelMatrix * instanceMatrix` ourselves:

```glsl
attribute vec3 instanceColor;
varying   vec3 vInstanceColor;
varying   vec3 vWorldPos;
varying   vec3 vWorldNormal;
void main() {
  mat4 instancedModelMatrix = modelMatrix * instanceMatrix;
  vec4 worldPos  = instancedModelMatrix * vec4(position, 1.0);
  vWorldPos      = worldPos.xyz;
  vWorldNormal   = normalize(mat3(instancedModelMatrix) * normal);
  vInstanceColor = instanceColor;
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
```

The fragment shader computes blend weights from the normal (`pow(abs(n), sharpness)`
normalized), samples diffuse/normal/roughness from the three planar projections,
perturbs the normal, and lights with diffuse + specular + a sharp sun **glint**,
plus a normal-Y-based ambient-occlusion approximation and the per-instance tint:

```glsl
vec3 blend = pow(abs(n), vec3(sharpness));
blend /= (blend.x + blend.y + blend.z + 0.001);
vec3 p = vWorldPos * scale;
vec4 xCol = texture2D(diffuseMap, p.yz);
vec4 yCol = texture2D(diffuseMap, p.xz);
vec4 zCol = texture2D(diffuseMap, p.xy);
vec4 col  = xCol * blend.x + yCol * blend.y + zCol * blend.z;
// … triplanar normal + roughness …
vec3 perturbedN = normalize(n + nrm * 1.15);
float spec  = pow(max(dot(perturbedN, halfDir), 0.0), 24.0) * specStr * 4.0;
float glint = pow(max(dot(perturbedN, halfDir), 0.0), 64.0) * 3.0;
float ao = 0.45 + 0.55 * (perturbedN.y * 0.5 + 0.5);
vec3 tintedCol = col.rgb * vInstanceColor * 2.0 * ao;
vec3 litCol = tintedCol * (ambientCol + vec3(diff * 1.2)) + vec3(spec) + vec3(glint);
```

**Per-instance color variation** is delivered through a custom
`InstancedBufferAttribute` named `instanceColor` (not Three's `setColorAt`, which we
bypass). Each asteroid's tint is drawn from a wide HSL range so the belt reads as a
mix of charcoal and sandy compositions:

```ts
const colorBuf = new Float32Array(count * 3).fill(1)
geoHigh.setAttribute('instanceColor', new THREE.InstancedBufferAttribute(colorBuf.slice(), 3))
geoMid.setAttribute('instanceColor',  new THREE.InstancedBufferAttribute(colorBuf.slice(), 3))
// … per asteroid:
const tint = new THREE.Color()
tint.setHSL(
  0.05 + rand() * 0.06,   // hue: warm grey → sandy
  0.03 + rand() * 0.20,   // saturation: wider — some near-grey, some tinted
  0.18 + rand() * 0.55,   // lightness: charcoal (dark) → sandy grey (light)
)
```

The color buffers are filled per LOD each frame alongside the instance matrices
(`highColors.setXYZ(...)`, `.needsUpdate = true`).

### Phase 7 — Dust haze, sunlight glint, volumetric haze ring

**Dust haze cloud** — 1500 (400 mobile) additive points fill the belt volume, drawn
as soft circular sprites (discard outside the unit disc, smoothstep alpha):

```glsl
uniform vec3 color;
void main() {
  float dist = length(gl_PointCoord - vec2(0.5));
  if (dist > 0.5) discard;
  float alpha = smoothstep(0.5, 0.0, dist) * 0.08;
  gl_FragColor = vec4(color, alpha);
}
```

**Far point sprites** are made larger, warmer, and given a bright core + soft glow
so the belt reads as a distinct golden/amber ring from a distance:

```glsl
float core = smoothstep(0.5, 0.18, dist);
float glow = smoothstep(0.5, 0.0,  dist) * 0.55;
gl_FragColor = vec4(vColor, core + glow);
```

The warmer/brighter far color is applied when populating the far buffer:

```ts
farColAttr.setXYZ(farCount, c.r * 1.7 + 0.25, c.g * 1.35 + 0.14, c.b * 0.95 + 0.03)
farSizeAttr.setX(farCount, this.scales[i] * 4.5)
```

**Volumetric haze ring** — a flat additive annulus (`RingGeometry`) sits in the belt
plane, its orientation applied via `mesh.rotation` (not baked) so the shader's
`length(position.xy)` stays radial. It gives the belt a faint presence from far away
before individual asteroids resolve. It is extremely subtle (desaturated warm
grey-gold, opacity 0.018, with an extra 0.5 in the shader):

```glsl
// HAZE_FRAG
float edge = smoothstep(0.0, 0.3, vR) * smoothstep(1.0, 0.7, vR);
gl_FragColor = vec4(uColor, edge * uOpacity * 0.5);
```

```ts
uColor:   { value: new THREE.Color(0xd4b896) }, // desaturated warm grey-gold
uOpacity: { value: 0.018 },
```

`MAIN_BELT_CONFIG` ties the phases together:

```ts
export const MAIN_BELT_CONFIG: AsteroidFieldConfig = {
  innerRadius: 1200, outerRadius: 1800,
  count: 3000, countMobile: 500,
  height: 60, minScale: 0.5, maxScale: 6, seed: 42,
  centerX: 0, centerY: 0, centerZ: 0, color: 0x8a7a6a,
  rotationSpeed: 0.00003, inclination: 0.15,
  kirkwoodGaps: [1350, 1480, 1620], clusterCount: 8,
}
```

---

## 7. Planet Labels and Info Panels

### `PlanetLabels.tsx` — DOM projection without React state

Labels are HTML overlays, not 3D sprites, so they always face the camera and get
crisp text. The key performance decision: **the per-frame position update does not go
through React state**. The flight loop writes screen-pixel coordinates + visibility
into a ref, and `PlanetLabels` runs its *own* `requestAnimationFrame` loop that moves
the DOM nodes directly:

```tsx
useEffect(() => {
  let rafId: number
  const loop = () => {
    const data = dataRef.current
    for (let i = 0; i < nodeRefs.current.length; i++) {
      const node = nodeRefs.current[i]
      const box  = boxRefs.current[i]
      const d    = data[i]
      if (!node || !d) continue
      node.style.transform = `translate(${d.x}px, ${d.y}px)`
      node.style.opacity   = d.visible ? '1' : '0'
      if (box) box.style.pointerEvents = d.visible ? 'auto' : 'none'
    }
    rafId = requestAnimationFrame(loop)
  }
  rafId = requestAnimationFrame(loop)
  return () => cancelAnimationFrame(rafId)
}, [dataRef])
```

The projection itself happens in the flight loop, once per body per frame. The
planet's live world position is projected to NDC via `.project(camera)` and mapped
to pixels; visibility is gated on being **in range** and **in front of the camera**
(`_projV.z < 1`):

```ts
for (let i = 0; i < PLANET_DATA.length; i++) {
  const pd  = PLANET_DATA[i]
  const obj = planetObjects[pd.key]
  const ld  = planetLabelDataRef.current[i]
  if (!obj) { ld.visible = false; continue }
  const dist = obj.position.distanceTo(ufoPos)
  // … track nearest …
  if (dist >= pd.detectionRadius) { ld.visible = false; continue }
  _projV.copy(obj.position).project(camera)
  ld.x       = (_projV.x * 0.5 + 0.5) * cw
  ld.y       = (-_projV.y * 0.5 + 0.5) * ch
  ld.visible = _projV.z < 1
}
```

Each label is a violet HUD chip (colored dot + uppercase Kanit name) with a
connecting reticle line and anchor dot; a CSS keyframe (`planetLabelPulse`, in
`index.css`) gives the border a subtle interactive pulse. Clicking a chip calls
`onSelect(key)`.

### The detection-radius system

Each body appears only within a per-planet range proportional to its size, defined in
`planetData.ts`: Sun 800, Mercury 200, Venus 250, Earth 300, Mars 250, Jupiter 500,
Saturn 500, Uranus 400, Neptune 400. The nearest in-range body drives the radar
highlight (`activeBodyKey`, pushed to React at the ~10 Hz HUD cadence).

### `PlanetInfoPanel.tsx` — the framer-motion modal

Tapping a label opens a modal driven by `selectedPlanet` state. It uses
`AnimatePresence` for enter/exit, is a centred `max-width: 480px` card on desktop and
near-full-screen on mobile, has a 44×44 always-accessible close button, and renders
the stat rows + fun fact from the config:

```tsx
<AnimatePresence>
  {planet && (
    <motion.div /* backdrop */ onClick={onClose} …>
      <motion.div /* panel */ onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, y: isMobile ? 40 : 24, scale: isMobile ? 1 : 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: isMobile ? 40 : 24, scale: isMobile ? 1 : 0.96 }}
        …>
```

### Radar integration (`FlightHUD.tsx`)

The NAV radar draws two layers: the local destination dots, and a compressed
**solar-body layer**. Because planets span −4000…8000, a separate compressed scale
maps them, clamped to the rim so off-range bodies act as directional indicators. The
Sun is a larger warm-yellow dot; the nearest body is highlighted with its full name,
others show their abbreviation:

```ts
const PS = 50 / 1600   // ≈ rim at 1600 world units
for (const b of solarBodies) {
  let sx = (b.x - ufoX) * PS
  let sy = -(b.y - ufoY) * PS
  const m = Math.hypot(sx, sy)
  if (m > 50) { sx = (sx / m) * 50; sy = (sy / m) * 50 }
  const isActive = b.key === activeBodyKey
  const r = b.isSun ? 5 : isActive ? 4 : 3
  // draw dot (warm yellow for the Sun) + abbr / full name
}
```

---

## 8. GLB Models

Three Draco-compressed models decorate the flight scene: the **ISS** and **JWST**
orbit Earth, and an **astronaut** tumbles nearby.

### Draco compression pipeline

Each loader sets up a `DRACOLoader` with the decoder pulled from the gstatic CDN and
attaches it to a `GLTFLoader`. The loader manager is passed in so loads are tracked
(see §11), and DRACO is disposed after the parse:

```ts
const dracoLoader = new DRACOLoader()
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/')
const loader = new GLTFLoader(manager)
loader.setDRACOLoader(dracoLoader)
loader.load(base + 'models/iss.glb', (gltf) => { /* … */ dracoLoader.dispose() /* … */ })
```

### `KHR_materials_pbrSpecularGlossiness` compatibility fix

The astronaut's exported materials use the `KHR_materials_pbrSpecularGlossiness`
extension, which Three.js r184 no longer supports (it would render untextured/black).
The fix replaces every mesh material with a plain `MeshStandardMaterial`:

```ts
mesh.material = new THREE.MeshStandardMaterial({
  color:     new THREE.Color(0xddddcc),
  roughness: 0.7,
  metalness: 0.1,
  side:      THREE.DoubleSide,
})
```

### The astronaut baked root-transform centering fix

The Sketchfab-exported astronaut has a baked matrix on its root node that translates
the model ~(177, 283, −438) in local space at scale ~0.00143 — so naively adding it
puts the model thousands of units off its orbit. The fix computes the world bounding
box, shifts the root child so the model is centred at the group origin, then scales
the group so the tallest axis equals `ASTRONAUT_SCALE`:

```ts
group.updateMatrixWorld(true)
const rawBox    = new THREE.Box3().setFromObject(group)
const rawCenter = rawBox.getCenter(new THREE.Vector3())
const rawSize   = rawBox.getSize(new THREE.Vector3())
const maxDim    = Math.max(rawSize.x, rawSize.y, rawSize.z)
if (group.children[0]) {
  group.children[0].position.sub(rawCenter)
  group.children[0].updateMatrix()
}
group.scale.setScalar(maxDim > 0 ? ASTRONAUT_SCALE / maxDim : ASTRONAUT_SCALE)
```

### Staggered loading times

GLB parsing is deferred well past the initial scene so it never competes with the
first-frame render / GPU pre-warm. ISS loads at **8 s**, astronaut at **10 s**, JWST
at **12 s** (desktop only). Each timer is cleared on unmount:

```ts
const issTimer = setTimeout(() => {
  createISS(loadingManager).then(({ group, dispose }) => { /* add to scene */ })
}, 8000)
// astronaut 10000, jwst 12000 (if !isMobile)
```

Cleanup: `clearTimeout(issTimer); if (jwstTimer) clearTimeout(jwstTimer); clearTimeout(astronautTimer)`.

---

## 9. The Star Field

The background star field is **procedural**, replacing the earlier
Hipparcos/Tycho/Yale texture-sphere layers (those large JPEGs were removed). Only the
**Milky Way** texture layer is kept, for the galactic band:

```ts
const milkyTex  = skyLoader.load(base + 'stars/8k_stars_milky_way.jpg')
milkyMat  = new THREE.MeshBasicMaterial({ map: milkyTex, side: THREE.BackSide, transparent: true, opacity: 0.9 })
```

`createStarField()` builds 8000 (3000 mobile) points on a large sphere, ~60% biased
toward a galactic-band distribution and ~40% uniform. Each star carries per-vertex
attributes: `position`, `color`, `size`, `phase`, and `speed`.

**Color distribution** (spectral-class-ish): 80% white, 10% blue-white, 7%
yellow-white, 3% orange:

```ts
const rnd = Math.random()
if      (rnd < 0.80) { colors[i*3]=1.0; colors[i*3+1]=1.0;  colors[i*3+2]=1.0  }
else if (rnd < 0.90) { colors[i*3]=0.7; colors[i*3+1]=0.8;  colors[i*3+2]=1.0  }
else if (rnd < 0.97) { colors[i*3]=1.0; colors[i*3+1]=0.95; colors[i*3+2]=0.7  }
else                 { colors[i*3]=1.0; colors[i*3+1]=0.7;  colors[i*3+2]=0.4  }
```

**Size distribution:** 90% tiny, 9% medium, 1% bright:

```ts
const sz = Math.random()
sizes[i] = sz < 0.90 ? 1.0 + Math.random() * 1.5
         : sz < 0.99 ? 3.0 + Math.random() * 2.0
         : 6.0 + Math.random() * 3.0
```

**Independent twinkle:** each star has its own `phase` and `speed`, so the shader
twinkles every star at a different rate/offset. The point size scales with distance
and twinkle; the fragment discards outside the unit disc for round points:

```glsl
// vertex
float twinkle = 0.75 + 0.25 * sin(time * speed + phase);
vAlpha = twinkle;
gl_PointSize = size * twinkle * (600.0 / -mvPosition.z);
// fragment
float dist = length(gl_PointCoord - vec2(0.5));
if (dist > 0.5) discard;
float alpha = smoothstep(0.5, 0.1, dist) * vAlpha;
```

Additive blending, `depthWrite: false`, `frustumCulled: false`. The whole point
cloud also rotates imperceptibly (`starField.points.rotation.y += 0.000002`) for
parallax, and the twinkle uniform is driven by a `THREE.Clock`.

---

## 10. Mobile Optimization

### `isMobile` detection

Touch capability is detected with `ontouchstart` / `maxTouchPoints` (used by
FlightMode, FlightHUD, LoadingScreen, PlanetInfoPanel):

```ts
const isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0
```

`SpaceCanvas` uses a width check (`window.innerWidth < 768`) since the hub is
non-interactive per-frame.

### The custom joystick system (`Joystick.tsx`)

Mobile flight is driven by two custom SVG virtual joysticks. Each tracks a single
`touchId`, converts screen pixels to the `-70..70` SVG viewBox space, clamps travel
to `maxTravel`, and emits normalized `-1..1` on move (note the inverted Y):

```ts
const onTouchMove = useCallback((e: React.TouchEvent) => {
  e.preventDefault()
  for (let i = 0; i < e.changedTouches.length; i++) {
    const t = e.changedTouches[i]
    if (t.identifier === touchId.current) {
      const v = getVec(t.clientX, t.clientY)
      setKnob(v)
      onMove(v.x / maxTravel, -(v.y / maxTravel))
      break
    }
  }
}, [getVec, maxTravel, onMove])
```

The HUD wires the left stick to thrust/yaw and the right stick to vertical, writing
directly into `inputRef.current`. The joystick renders a full HUD reticle (24 tick
marks, crosshair, corner brackets, glowing knob) as inline SVG.

### The critical keyboard RAF loop bug

`useFlightControls` originally ran a `requestAnimationFrame` loop that reads the
keyboard `Set` and writes `inputRef` **every frame** (~every 16 ms). On touch
devices the joystick buttons also write `inputRef` — but the keyboard loop would
overwrite those values back to zero on the very next frame, making touch controls do
nothing. The fix: **skip the entire keyboard loop on touch devices** so the buttons
own `inputRef` exclusively:

```ts
useEffect(() => {
  // On touch devices the keyboard loop would overwrite button-set values every frame.
  // Touch buttons write directly to inputRef, so skip the loop entirely on mobile.
  const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0
  if (isTouch) return
  // … keydown/keyup + rAF loop that sets inp.thrust/yaw/pitch/roll/vertical/land …
}, [])
```

### The NippleJS experiment

An earlier iteration used the `nipplejs` library for the virtual joysticks. It was
replaced by the bespoke `Joystick.tsx` component — the custom SVG gives full control
over the sci-fi HUD aesthetic (tick marks, brackets, glow), avoids a runtime
dependency, and integrates cleanly with the single-`touchId` tracking. No `nipplejs`
import remains in the codebase.

### Geometry & count reductions

Segment counts and instance counts are halved-or-more on mobile throughout:

- Planet spheres: `INNER_SEGS = isMobile ? 32 : 64`, outer planets `OUTER_SEGS = isMobile ? 16 : 32`, Saturn ring `RING_SEGS = isMobile ? 64 : 128`.
- Star field: 3000 vs 8000 points.
- Belt: `count 3000 / countMobile 500` (flight), `500 / 100` (hub); dust `400` vs `1500`.
- Skybox sphere segments `SKY_SEGS = isMobile ? 16 : 32`; sun `SUN_SEGS` likewise.
- Renderer pixel ratio capped lower on mobile; antialias disabled on mobile in flight (`antialias: !isMobile`).

### The 3-frame skip in `AsteroidField.update`

On mobile the belt only recomputes its instance matrices every third frame, cutting
the per-frame CPU cost of the LOD/Kepler pass by ~⅔:

```ts
update(cameraPosition?: THREE.Vector3): void {
  this.time++
  if (this.isMobile && this.time % 3 !== 0) return
  // …
}
```

---

## 11. The Loading Screen

`LoadingScreen.tsx` is a "spacecraft computer boot" mission-briefing screen, used by
flight mode. (The hub and black-hole modes use small inline loaders instead, so the
cinematic briefing is exclusive to flight mode.)

### Progress tracking with `THREE.LoadingManager`

Flight mode routes all texture loaders **and** the GLB `GLTFLoader`s through one
manager. Progress is reported as 0–1 but **capped at 0.95** — the final 5% is
reserved for the GPU pre-warm, so "100%" only ever means "shaders compiled, textures
uploaded". Late GLB loads can't drag the bar back down because the handler bails once
warmed:

```ts
let gpuWarmed = false
const loadingManager = new THREE.LoadingManager()
loadingManager.onProgress = (_url, loaded, total) => {
  if (gpuWarmed) return
  setLoadProgress(total > 0 ? Math.min(loaded / total, 0.95) : 0)
}
```

### GPU pre-warm via `renderer.compile()` (fixing the entry lag spike)

The lag spike on entering flight was the GPU being hit with every shader compile +
texture upload on the first visible frame. Now, once all tracked textures are loaded,
`renderer.compile(scene, camera)` forces all of that **while the loading screen still
covers the canvas**, and progress only reaches 1.0 after two real frames have
rendered post-compile:

```ts
loadingManager.onLoad = () => {
  if (gpuWarmed) return
  gpuWarmed = true
  renderer.compile(scene, camera)
  requestAnimationFrame(() => {
    requestAnimationFrame(() => setLoadProgress(1))
  })
}
```

Combined with the staggered GLB loads (§8), no heavy work lands on the reveal frame.

### The typewriter effect

Seven briefing lines type out char-by-char (40 ms/char) with a 400 ms gap between
lines. Each line is gated on a loading-progress threshold (lines 1-2 during 0-30%,
3-4 during 30-60%, 5-6 during 60-90%, line 7 at 100%). The sequence is an async loop
inside a single effect, reading progress from a ref:

```ts
const run = async () => {
  for (let i = 0; i < LINES.length; i++) {
    await waitForProgress(THRESHOLDS[i])   // gate on real loading progress
    if (cancelled) return
    setActiveLine(i)
    setLineDone(false)
    playBeep(FREQS[i], 0.15)
    await typeLine(i)
    if (cancelled) return
    setLineDone(true)
    await sleep(GAP_MS)
    if (cancelled) return
  }
  // outro: wait 1200ms → flash white → fade to black 600ms → onComplete()
}
```

`typeLine` advances a per-line character count on a `setTimeout` chain; each line
except the final is terminal-green (`#22c55e`), the last is white; previous lines dim
to 40% so the newest is brightest; the active line shows a CSS-blinking cursor.

### Web Audio API beep generation

Sound is generated programmatically — no audio files. A single shared `AudioContext`
plays a per-line beep and a continuous 40 Hz hum, all wrapped in try/catch so a
blocked context never breaks the screen (autoplay is permitted because entering
flight is a user gesture). Each beep is a sine with an exponential gain decay:

```ts
const playBeep = (frequency: number, duration: number) => {
  if (!audioCtx) return
  try {
    const osc  = audioCtx.createOscillator()
    const gain = audioCtx.createGain()
    osc.connect(gain); gain.connect(audioCtx.destination)
    osc.frequency.value = frequency
    osc.type = 'sine'
    gain.gain.setValueAtTime(0.04, audioCtx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration)
    osc.start(audioCtx.currentTime)
    osc.stop(audioCtx.currentTime + duration)
  } catch { /* ignore */ }
}
```

Line frequencies climb 440→523→587→659→698→784→880 Hz; the hum ramps out on the
outro and the context is closed on unmount. The screen also draws a CSS-twinkling
star field (50 desktop / 20 mobile) and a bottom progress bar that flashes white
before the fade-to-black.

---

## 12. Performance Engineering

### `distanceToSquared` vs `distanceTo` in hot loops

The asteroid LOD test runs per asteroid per frame (up to 3000×). Comparing **squared**
distances avoids a `sqrt` per asteroid — the thresholds are pre-squared constants:

```ts
const NEAR_SQ = 600  * 600
const MID_SQ  = 2000 * 2000
// …
const dSq = this.dummy.position.distanceToSquared(camPos)
```

### The scratch-vector pattern

Hot loops must not allocate. Reusable vectors are hoisted to module or class scope
and mutated in place. In `useUFOPhysics` two module-level scratch vectors serve the
whole physics step:

```ts
const _forward = new THREE.Vector3()
const _pull    = new THREE.Vector3()
```

`AsteroidField` keeps class-level scratch (`_tempPos`, `_zeroCam`) and a single reused
`THREE.Object3D` (`this.dummy`) to build each instance matrix without allocation.

### The out-parameter pattern

`orbitalToCartesian(orbit, target)` writes into a caller-provided vector rather than
returning a new one, so the per-asteroid Kepler conversion allocates nothing:

```ts
this.orbitalToCartesian(orbit, this._tempPos)
```

### React state throttled to ~10 Hz

The flight loop only pushes HUD state every 6th frame, keeping React reconciliation
off the 60 fps hot path:

```ts
hudFrame++
if (hudFrame % 6 === 0) {
  setSpeed(Math.min(vel / topSpeed, 1))
  setIsBoosting(inputRef.current.boost)
  setUfoXY({ x: ufoPos.x, y: ufoPos.y })
  setActiveBodyKey(nearestBodyInRange ? nearestBodyKey : null)
  // … nearest-destination detection, landing …
}
```

Label positions, which need to be smooth, are the exception — they are written to a
ref every frame and applied by `PlanetLabels`'s own rAF loop (no React involved).

### `BASE_URL` prefix on all asset paths

The site is served from `/aboo-portfolio/` on GitHub Pages, so every asset path is
prefixed with Vite's `import.meta.env.BASE_URL`. Missing this is the classic "works
locally, 404s in production" bug:

```ts
const base = import.meta.env.BASE_URL
const dayTex = loader.load(base + 'earth/earth-day.jpg')
```

`AsteroidField` guards against a non-Vite context too:

```ts
const base = typeof import.meta !== 'undefined'
  ? (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/'
  : '/'
```

### Frustum culling with pre-set bounding spheres

As covered in §6, all belt meshes and the far point geometry get explicit bounding
spheres so Three's lazy `radius = -1` never permanently culls them. `frustumCulled`
is set to `false` on the star field, dust, haze ring, and nebula so they are never
dropped.

### Planet-factory consolidation

Consolidating the seven planet builders into `src/utils/planetFactories.ts` removed
~250 lines of duplicated geometry/material/dispose code across `SpaceCanvas` and
`FlightMode`, giving a single place to tune sizes and a single correct disposal path.

---

## 13. Known Issues and Future Work

**Deferred / incidental**

- **Asteroid-belt textures are untracked.** `AsteroidField` creates its own internal
  `THREE.TextureLoader()` (not routed through the flight `LoadingManager`), so its
  three rock textures aren't counted in loading progress. `renderer.compile` still
  compiles the belt's shader program; only the small rock textures upload lazily.
- **Inner planets are sub-pixel in the hub overview.** At true flight-scale size
  ratios, Mercury–Mars are only a few pixels from the overview camera. They are all
  in-frame and marked by their orbit rings, but do not read as discs. A future option
  is a modest non-linear size boost for the inner four.
- **Section markers detached from Earth.** Earth moved to the origin but the
  About/Skills/Projects/Contact wireframe markers stayed at their original
  coordinates so navigation is unchanged; they now float near the inner system rather
  than hugging Earth.
- **True Kerr geodesics are dormant.** The full Carter/Mino-time Kerr integrator is
  implemented in `geodesics.glsl` but gated off (`kerr_full_geodesic: false`) in both
  presets. Enabling it publicly needs UI, more steps, and validation.
- **Bundle size.** The production JS chunk is ~1.19 MB (~330 KB gzip); Vite warns it
  exceeds 500 KB. Code-splitting the black-hole shader/mode behind a dynamic import
  is the obvious win.

**Planned space engine — "Space On"**

The longer-term direction is a genuine space engine layered on top of this
foundation:

- **Chunk streaming** — spatial partitioning so the world can extend far beyond the
  current 9000-unit boundary without loading everything up front.
- **Full Keplerian orbital system for the planets** — the asteroid belt already runs
  real orbital mechanics; extend the same `orbitalToCartesian` machinery to the
  planets so they actually orbit the Sun instead of being static.
- **Time control** — a time-scale slider / scrubbing so orbits can be sped up,
  paused, or reversed (the black-hole renderer already has a `time_scale`).
- **Gameplay loop** — objectives, discovery, and progression beyond free-flight.

---

## 14. Key Lessons Learned

The ten most valuable debugging insights from this project.

### 1. `InstancedMesh` bounding-sphere caching (`radius = -1`)

**Bug:** belt meshes vanished permanently after the first frame.
**Why:** Three.js computes an `InstancedMesh` bounding sphere lazily on first render.
If `count` is `0` at that moment, it caches `radius = -1`, and the mesh is
frustum-culled forever after.
**Fix:** pre-set an explicit bounding sphere covering the whole belt so the lazy
computation never runs with `count = 0` (`this.meshHigh.boundingSphere = beltSphere.clone()`).

### 2. Keyboard/touch RAF conflict

**Bug:** touch joysticks did nothing on mobile.
**Why:** the keyboard `requestAnimationFrame` loop overwrote `inputRef` every ~16 ms,
zeroing the values the touch buttons had just written.
**Fix:** detect touch and `return` before installing the keyboard loop, so touch owns
`inputRef` exclusively:

```ts
const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0
if (isTouch) return
```

### 3. `_isMobile` module-level freeze

**Bug:** a device flag derived at import time never reflected the real device.
**Why:** `PARAMS.taa_enabled: !_isMobile` is a module-level `const` evaluated when
`_isMobile` is still its initial `false`; `init()` sets the real value too late.
**Fix:** don't trust a `const` derived from a mutable module flag — gate behavior on
state that is actually created at runtime (`!!_taaCurrentRT`, only allocated when
`!_isMobile`).

### 4. `BASE_URL` path issue

**Bug:** assets 404'd on GitHub Pages while working locally.
**Why:** the site is served under `/aboo-portfolio/`, but paths were root-relative.
**Fix:** prefix every asset URL with `import.meta.env.BASE_URL`.

### 5. `KHR_materials_pbrSpecularGlossiness` compatibility

**Bug:** the astronaut rendered black/untextured.
**Why:** its glTF materials use `KHR_materials_pbrSpecularGlossiness`, dropped in
Three.js r184.
**Fix:** traverse the model and swap each material for a `MeshStandardMaterial`.

### 6. Astronaut baked root transform

**Bug:** the astronaut appeared thousands of units from its orbit.
**Why:** the Sketchfab export baked a large translation + tiny scale into the root
node.
**Fix:** compute the world bounding box, subtract its centre from the root child, then
rescale the group by `ASTRONAUT_SCALE / maxDim`.

### 7. Three.js lazy bounding sphere with `InstancedMesh count = 0`

The generalization of lesson 1: **any** geometry/instanced mesh whose bounds are
computed while empty can be poisoned with `radius = -1`. The far point `BufferGeometry`
hit the same trap and got the same explicit-sphere fix
(`farGeo.boundingSphere = beltSphere.clone()`).

### 8. GL Points rendering as squares

**Bug:** point sprites (stars, dust, far asteroids) rendered as hard squares.
**Why:** a `gl_Points` primitive is a square quad by default; without masking,
`gl_PointCoord` fills the whole square.
**Fix:** discard fragments outside the unit disc and feather the alpha:

```glsl
float dist = length(gl_PointCoord - vec2(0.5));
if (dist > 0.5) discard;
float alpha = smoothstep(0.5, 0.1, dist) * vAlpha;
```

### 9. Custom instanced `ShaderMaterial` on r184 (`modelMatrix`)

**Bug:** instanced asteroids rendered at the wrong world positions.
**Why:** for a custom instanced `ShaderMaterial`, r184's injected prefix supplies
`modelMatrix`, `viewMatrix`, and `instanceMatrix` separately — it does **not**
compose `instanceMatrix` into `modelViewMatrix` for you.
**Fix:** build the per-instance world matrix explicitly and use `viewMatrix` directly:

```glsl
mat4 instancedModelMatrix = modelMatrix * instanceMatrix;
vec4 worldPos = instancedModelMatrix * vec4(position, 1.0);
gl_Position = projectionMatrix * viewMatrix * worldPos;
```

### 10. `dt` clamping

**Bug:** returning to a backgrounded tab caused a violent physics/animation jump.
**Why:** `requestAnimationFrame` pauses in background tabs; the first frame back sees
a huge `now - prevTime`, so a single integration step advances everything by seconds.
**Fix:** clamp the per-frame delta so one frame can never advance more than ~50 ms:

```ts
const dt = Math.min((now - prevTime) / 1000, 0.05)
```

The black-hole renderer applies the same guard in its frame timer
(`Math.min((now - lastTs) / 1000.0, MAX_DT)`), and both scenes additionally pause the
RAF loop on `visibilitychange`.

---

*End of report.*
