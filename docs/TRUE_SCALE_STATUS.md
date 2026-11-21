# True Scale: implementation status

Companion to `TRUE_SCALE_PLAN.md` (the design contract). Notes for whoever implements the next milestone.

## Done

**Milestone 1 (foundation)**
- `src/space/floatingOrigin.ts`: camera at the render origin; render = (world − frame) − cameraLocal. The frame rides with a host body (`carry`), switches host exactly (`switchHost`), and recentres in whole-km steps. Shift listeners re-express frame-relative state (ship position, trails).
- `src/space/depth.ts`: logarithmic depth buffer (reasons in the file); near 1e-4 km, far 1e11 km. `findMissingDepthChunks()` is reported by the debug hook.
- Sky (`src/flight/sky.ts`) renders in its own pass first, centred on the camera; the depth buffer is cleared before the world pass.
- `src/debug/spaceon.ts`: `window.__spaceon` (see README).

**Milestone 2 (true scale)**
- `src/space/ephemeris.ts`: Standish Table 1 planets; Earth = EMB − μ·Moon; Moon from `earth/astro.ts` (now with distance) precessed to J2000; IAU poles and rotation; apparent magnitudes (Mallama & Hilton 2018); physical data, SOI and Hill radii.
- `src/space/solarSystem.ts`: all bodies at true radii, placed and oriented every frame. Live Earth is oriented to the real Sun direction with the IAU pole as hint. The Sun is a physical point light, with eye adaptation A = (d/AU)^1.6 applied to the sunlight rather than to exposure. Impostors (`impostors.ts`) and orbit lines (`orbits.ts`) live here too.
- `src/space/belt.ts`: Keplerian far band + haze, plus a chunk-seeded local field (4 octaves) using AsteroidField's triplanar shader.
- `src/space/portfolioZone.ts`: spawn and destinations in a Sun–Earth frame.
- `scripts/verify-earth.ts` sections 6–8: Horizons checks.

## Interim behaviour to replace later
- **Flight model (M3):** the old physics runs with its rates × 400 (`SPEED_KM_PER_UNIT` in FlightMode). There is no altitude scaling. The boost toggle is still the old one.
- **Camera follow:** the camera follows rigidly in position, with orientation smoothing only, because the old positional lag was ~9 × speed.
- **Dev teleport:** `window.__spaceonDev.teleport` (DEV only) stands in for fast travel / autopilot (M4); remove it then.
- **NAV radar:** log-scaled and heading-up with bearings in the ecliptic plane. M4 is expected to refine it into the full situational display.
- **Planet labels:** shown within `detectionRadius` (km, `planetData.ts`). The Moon, ISS and JWST have no label or registry entry yet (M4 registry).
- **ISS and JWST:** decorative. The ship rides with Earth, so the ISS passes at 7.7 km/s; inspecting it properly needs target-relative frames (M3/M4).
- **Mobile portrait:** the spawn view cuts off SKILLS and M87* (narrow horizontal FOV). Fix in M5.
- **Milky Way texture:** in galactic coordinates but not oriented to the real galactic plane. Its handedness and latitude sign could not be confirmed.
