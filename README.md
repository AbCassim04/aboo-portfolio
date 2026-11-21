# aboo-portfolio

A fully 3D interactive portfolio where visitors pilot a UFO through a photorealistic solar system. Built with React, Three.js, TypeScript, and GLSL shaders.

🚀 **[Live Site](https://abcassim04.github.io/aboo-portfolio/)**

## Features

- **True-scale solar system** — real sizes, distances and today's planet positions (JPL elements on a shared sim clock), real axial tilts, 8K NASA textures
- **Asteroid belt** — 3,000 procedurally generated asteroids with Keplerian orbits, Kirkwood gaps, triplanar rock textures, and a 3-tier LOD system
- **General-relativistic black hole** — GLSL raytracer implementing Schwarzschild geodesics with accretion disk, Doppler shift, gravitational lensing, bloom, and TAA
- **GLB models** — ISS, JWST, and a floating astronaut orbiting Earth
- **Procedural star field** — 8,000 independently twinkling stars with color variation and Milky Way density band
- **Mobile support** — dual virtual joystick controls, adaptive LOD, touch-optimised HUD
- **Real flight model** — MANUAL (speed scales with altitude: metres per second beside the ISS, much faster high above) and CRUISE (up to 100 c, slows automatically near anything, impossible to crash)
- **Navigation** — target lock with off-screen arrows, AUTOPILOT, 6-second FAST TRAVEL to anything, and a log-scaled SYSTEM MAP with time controls
- **Camera modes** — chase, cockpit and orbit (drag / right stick)

## Flight controls

| Desktop | Mobile | Action |
|---|---|---|
| W / S | left stick up / down | thrust / brake |
| A / D | left stick left / right | turn |
| Q / E · Z / X | — | pitch · roll |
| Shift / Ctrl | right stick | up / down |
| Space | CRUISE | cruise ↔ manual |
| M | MAP | system map (tap a body: Fast travel / Autopilot / Set target) |
| T or ] / [ | map or labels | next / previous target |
| P | AUTO | autopilot to the target (any flight input cancels) |
| J | map card | fast travel to the target |
| Esc | STOP | cancel autopilot / fast travel, close the map |
| C | CAM | camera: chase → cockpit → orbit |
| drag | right stick (orbit mode) | orbit the camera around the ship |
| F | LAND | land on a portfolio marker |
| L | LIGHT | headlight |

## Stack

| Layer | Technology |
|-------|-----------|
| 3D Engine | Three.js r184 |
| Framework | React 19 + TypeScript |
| Build | Vite 8 |
| Shaders | GLSL (custom raytracer + triplanar mapping) |
| Deployment | GitHub Pages |

## Running locally

```bash
git clone https://github.com/AbCassim04/aboo-portfolio.git
cd aboo-portfolio
npm install
npm run dev
```

## Debug hook (`window.__spaceon`)

A read-only hook for checking the app with numbers instead of screenshots.
It is always installed in development (`npm run dev`) and in production only
with `?debug=1` in the URL; otherwise nothing is installed and it costs nothing.

```js
await window.__spaceon.waitForReady()   // resolves when the current mode is ready (flight: loading screen gone)
window.__spaceon.getState()             // JSON-serialisable snapshot
```

`getState()` returns `mode`, `ready`, the shared `simClock` state and the last
20 console errors/warnings, plus — in flight mode — `flight` with: units (km),
ship heliocentric position / velocity (km, km/s, fraction of c) and host body,
camera, nearest body and altitude, target (from Milestone 4), travel mode,
open overlay, FPS, eye adaptation, cloud status, loaded/failed assets,
renderer info (draw calls, triangles, textures, geometries, programs),
floating-origin and depth-buffer state (including any custom shader missing
the log-depth chunks), and every body's position, on-screen disc size,
apparent magnitude and impostor state, the portfolio destinations, the
decorative ISS/JWST/astronaut and the asteroid-belt field.

In flight mode `getState().flight` also reports the travel mode
(`manual` / `cruise` / `autopilot` / `fasttravel`), the cruise limiter
(what holds cruise back), the camera mode and rig, the ship's on-screen size
(`shipScreen`), the HUD readout strings (`hud`), the target (distance, arrival
point, framing: disc size, phase angle, Sun direction), autopilot and fast
travel state (planned path clearance), the system-map layout and the target
marker, and `continuity`: a per-frame camera-continuity monitor (movement vs
velocity × dt relative to the body the frame rides with; flagged frames and
the worst ratio around every mode / camera / host / fast-travel event).

Development builds only (stripped from production): `window.__spaceonDev` with
`teleport(id)` (`spawn`, `overview`, `belt`, `sun`, `mercury` … `neptune`,
`moon`, `iss`, `jwst` or a portfolio destination; `teleport('jupiter', 0.002)`
places Jupiter at 0.2 % of the view), `aim(id)`, `setTarget(id)`,
`autopilot(id)`, `fastTravel(id)`, `cancel()`, `orient(yawDeg, pitchDeg)`
(relative to the target), `simSpeed(x)`, `peek()` and `resetContinuity()`.

## Architecture

See [`docs/TECHNICAL_REPORT.md`](docs/TECHNICAL_REPORT.md) for a full deep-dive into the rendering systems, physics simulations, and engineering decisions.

## License

© 2026 Aboobaker Cassim. See [LICENSE](LICENSE) for details.
