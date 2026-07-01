# aboo-portfolio

A fully 3D interactive portfolio where visitors pilot a UFO through a photorealistic solar system. Built with React, Three.js, TypeScript, and GLSL shaders.

🚀 **[Live Site](https://abcassim04.github.io/aboo-portfolio/)**

## Features

- **Full solar system** — 8 planets with 8K NASA textures, real axial tilts, and orbital mechanics
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

## Architecture

See [`docs/TECHNICAL_REPORT.md`](docs/TECHNICAL_REPORT.md) for a full deep-dive into the rendering systems, physics simulations, and engineering decisions.

## License

© 2025 Aboobaker Cassim. See [LICENSE](LICENSE) for details.
