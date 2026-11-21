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

**Milestone 3 (flight model)**
- `src/flight/shipModel.ts` replaces the old scene-unit physics (`useUFOPhysics` is gone). MANUAL: `v_max = clamp(K_ALT·altitude, 5 m/s, 1 c)` with K_ALT = 0.1/s, altitude above the nearest surface (bodies, ISS, JWST, portfolio markers; non-solid things count at least half their centre distance). CRUISE: `min(CRUISE_CAP = 100 c, altitude/TAU)` (TAU = 1 s) plus a hard approach limit per surface, `closing speed ≤ (d − standoff)/TAU`, so gaps only shrink exponentially. The standoff blends with how directly you are heading at a body (impact parameter 0.6–1.15 R): aimed at it → its arrival distance; grazing it → a safety shell (fly past).
- Host switches keep the ship's world velocity; every speed change is an exponential approach (no jumps).
- `src/flight/cameraRig.ts`: CHASE (68 m behind / 17 m above, looking parallel to the heading: the ship is ~10 % of the view height, low centre; eases ~20 % further back at cruise speeds), COCKPIT (ship fades out), ORBIT (drag / right stick, springs back). The offset is a critically damped spring with explicit velocity.
- `src/flight/units.ts`: m / km / AU + light-time; m/s / km/s / c; ETA.
- `src/debug/continuity.ts`: per-frame camera continuity monitor (debug hook).

**Milestone 4 (navigation)**
- `src/flight/navRegistry.ts`: the registry (Sun, planets, Moon, ISS, JWST, portfolio zone + destinations + M87*, belt) with `navPositionAt(id, simMs)` for prediction. ISS / JWST positions are pure functions of sim time (`src/flight/satellites.ts`; the ISS orbit node is now inertial), and both host a 30 km ride-along frame.
- Arrival framing (FlightMode `computeArrival`): sunlit side, Sun ~35° off the line behind the camera, body filling 40 % of the smaller view dimension, view pitched 7° below the target so it sits above the ship; the Sun at 12 R.
- `src/flight/autopilot.ts`: cruise model + detour steering around keep-out spheres + critically damped settle; any flight input cancels.
- `src/flight/fastTravel.ts`: 6 s, target-centred path with two-sided log-distance easing, direction sweep paced by log distance, velocity-matching drift, multi-candidate clearance planning against predicted body positions; cancel → exponential drop-out. Jumps requested mid-frame start at the end of the frame.
- `src/components/SystemMap.tsx`, `TargetMarker.tsx`, info-card actions in `PlanetInfoPanel.tsx`, labels for the Moon / ISS / JWST, `src/flight/warpStreaks.ts`, `src/flight/whoosh.ts`.
- Ephemeris time now uses days since J2000 directly (`daysTT`, `daysSinceJ2000`): the absolute Julian Day quantised time to ~0.04 ms, a metre-sized per-frame jitter at true scale.

## Notes for Milestone 5
- **Mobile:** the joysticks still `preventDefault` inside React's passive touch listeners (console errors in Chrome); `touch-action: none` already covers it. There is no pitch control on mobile (right stick is up/down, or orbit in ORBIT mode). Map chips are 30 px tall (≥ 24 px, below the 44 px guideline). In portrait the chase ship is ~10 % of the height but ~48 % of the width.
- **Mobile portrait:** the spawn view cuts off SKILLS and M87* (narrow horizontal FOV).
- **Milky Way texture:** in galactic coordinates but not oriented to the real galactic plane.
- **NAV radar:** log-scaled, heading-up; it highlights the target. Could become a fuller situational display.
- **Performance:** fast-travel planning samples 12 candidate sweeps × 180 points against 10 bodies once per jump (a few ms).
