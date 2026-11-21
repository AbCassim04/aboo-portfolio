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
- **Super speed boost** — toggle with Space / BOOST button for fast solar system traversal

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

Development only, temporary until fast travel exists (Milestone 4):
`window.__spaceonDev.teleport(id)` with `id` one of `spawn`, `overview`,
`belt`, `sun`, `mercury` … `neptune`, `moon`, `iss`, `jwst`, or a portfolio
destination (`ABOUT`, `SKILLS`, `PROJECTS`, `CONTACT`, `M87*`);
`teleport('jupiter', 0.002)` places Jupiter at 0.2 % of the view height to
watch it grow from a point of light into a disc.

## Architecture

See [`docs/TECHNICAL_REPORT.md`](docs/TECHNICAL_REPORT.md) for a full deep-dive into the rendering systems, physics simulations, and engineering decisions.

## License

© 2026 Aboobaker Cassim. See [LICENSE](LICENSE) for details.
