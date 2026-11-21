# True Scale: design contract

## Goal
Flight mode becomes the real solar system at true scale: real sizes, real distances, real planet positions from the date on the shared simClock, real orbits. It must feel real, not like a game level. Because real space is vast and empty, navigation and travel must be flawless: you can always find anything, get anywhere, and arrive somewhere beautiful.

Out of scope: the hub (SpaceCanvas) is untouched. The portfolio sections and the M87* portal remain, as a deliberately non-realistic "portfolio zone" near Earth.

## Units and frames
- 1 world unit = 1 km.
- Master frame: heliocentric ecliptic J2000, Sun at the origin, ecliptic plane = scene XZ, ecliptic north = +Y. All authoritative positions are 64-bit JS numbers (never stored only in Float32 GPU buffers).
- Light speed c = 299,792.458 km/s. 1 AU = 149,597,870.7 km.

## Rendering architecture
- Floating origin / camera-relative rendering: the camera sits at the render origin; every frame, object render positions = (world position 64-bit) - (camera world position 64-bit). Any shader that uses world-space positions (triplanar asteroids, Live Earth, clouds, atmosphere, star field) must receive camera-relative positions so float32 precision is spent near the viewer. Acceptance: no visible jitter with the camera 1 m from an object at 30 AU.
- Depth: logarithmic depth buffer (or reversed-Z if r184 supports it reliably in WebGL; choose and justify). EVERY custom ShaderMaterial and onBeforeCompile shader must include the matching depth chunks. Acceptance: no z-fighting between the UFO (metres) and a planet surface, between Earth's surface and its cloud shell, or anywhere from 1 m to 30 AU.
- Near plane about 0.001 km; far effectively unlimited.
- Stars and Milky Way render at infinity: they follow the camera and always draw behind everything.
- Bodies smaller than about 2 px on screen render as point-of-light impostors whose brightness follows apparent magnitude (radius, albedo, phase angle, distance to Sun and viewer), crossfading smoothly into the mesh as they grow. A distant planet must look like a star of the right brightness, never vanish, never pop.
- Sun: true radius 696,000 km; the light comes from the Sun's real position, so each body is lit from its true direction. Brightness falls with distance from the Sun; use gentle auto-exposure (eye adaptation) so the outer planets are dimmer but still beautiful and readable.

## Ephemeris (driven by simClock)
- Planets: NASA JPL "Approximate Positions of the Planets" (Standish) Keplerian elements and rates, valid 1800-2050. Earth uses the Earth-Moon barycentre; offset Earth from it using the Moon if cheap. Moon: the existing geocentric astro.ts series at its real distance (~384,400 km).
- Orientation: Earth's spin axis points at its true direction (north celestial pole at ecliptic longitude 90 deg, latitude 66.56 deg) with rotation from sidereal time; this must stay consistent with Live Earth's verified subsolar point and terminator. Other planets: IAU (WGCCRE) pole directions so axial tilts (and Saturn's real ring opening angle as seen now) are true; rotation phase may be approximate.
- Sizes: true radii; Saturn's rings at true inner/outer radii; Live Earth at 6,371 km with cloud and atmosphere shells at sensible altitudes.
- Verification: compare planet positions for at least two dates against reference values (for example JPL Horizons); add these checks to the verify script.

## Asteroid belt
Real location: 2.2-3.3 AU around the Sun, orbital speeds from Kepler's third law. At a distance it reads as a faint, real-scale band. When the ship is inside the belt zone, a deterministic, chunk-seeded local field of asteroids streams in around it at exaggerated density (reuse AsteroidField: LOD, triplanar, glints, Kirkwood gaps), so flying through the belt is a real experience. The HUD states that local density is exaggerated.

## Portfolio zone
About/Skills/Projects/Contact markers and the M87* portal live in a compact zone near Earth, visible from spawn, at a scale that reads well there. They are navigation targets, and landing on them still opens their overlays. Spawn: a few tens of thousands of km from Earth, Earth large and beautiful in view, portfolio zone visible, never inside anything.

## Decorative objects
ISS at a real ~420 km altitude (decorative orbit until the planned Live Sky work makes it real). JWST at Sun-Earth L2, ~1.5 million km anti-sunward of Earth (direction now real). Astronaut stays decorative near spawn.

## Flight model (replaces boost/super speed)
- MANUAL: real speeds; max speed scales with altitude above the nearest surface (metres per second near the ISS, much faster high above), smooth and responsive.
- CRUISE (Space toggles; replaces boost): target speed = min(CRUISE_CAP, distanceToNearestSurface / TAU), so you accelerate in open space and automatically slow near anything massive; impossible to overshoot or crash. CRUISE_CAP default 100c, TAU tunable; both constants documented.
- FAST TRAVEL: chosen from the system map or target panel; same fixed duration for any distance (FAST_TRAVEL_SECONDS default 6).
  - Motion eased in log-distance space: you leave quickly and decelerate as you arrive, so the target grows from a dot to a disc.
  - Aim at where the target will be at arrival in sim time (moving targets, fast-forwarded time).
  - Path never passes through the Sun or any body; curve around if needed.
  - Arrival framing: drop out on the sunlit side with the Sun behind the camera, at a distance where the body fills about 40% of the view (for the Sun, a safe glare-limited distance). Every arrival looks like a postcard.
  - Visuals: stars streak during the jump and snap back to points on drop-out; subtle Web Audio whoosh.
  - Cancellable: cancel drops you out safely where you are.
- Transitions between modes are smooth; no frame where speed or position jumps.

## Navigation (must be pristine)
- Single registry of navigable things: id, name, type, radius, world position at a given sim time, arrival distance, info. Contains Sun, 8 planets, Moon, ISS, JWST, the belt zone, the portfolio destinations, M87*.
- Target lock: reticle on the target; an arrow at the screen edge when it is off-screen; next/previous target keys.
- HUD readouts with automatic units: distance (m, km, AU, plus light-time), relative speed (m/s, km/s, multiples of c), ETA, mode (manual/cruise/autopilot/fast travel), slowdown indicator when cruise is held back near a body.
- AUTOPILOT: flies to the target using cruise, turns smoothly, drops out at the arrival framing; any manual input cancels it.
- SYSTEM MAP (M key; a button on mobile): overlay with the Sun, planets at current sim-time positions, real orbital ellipses (with inclination), Moon orbit near Earth, belt zone, portfolio zone, ship marker and velocity direction. Radial distances log-scaled (angles preserved) so inner and outer planets are both tappable. Pan/zoom on desktop and touch. Tap or click a body for an info card (reuse PlanetInfoPanel content) with three actions: Fast travel, Autopilot, Set target. Time controls reachable from the map.
- Orbit lines in flight: thin, faint real orbits, fading with distance and when not needed.
- Existing systems adapt: planet labels (detection by real distance), info panels, NAV radar (becomes a log-scaled local situational display), landing on portfolio markers.
- Controls: keyboard legend updated (Space cruise, M map, target keys, autopilot key). Mobile: CRUISE replaces BOOST; MAP and AUTOPILOT buttons; the joysticks keep working; nothing overlaps.
- Acceptance: from spawn, a first-time visitor can reach Neptune and back via the map without instructions; nothing is ever lost (every body findable via target list, map or markers); no jitter, popping, or z-fighting anywhere along the way.

## Debug hook
window.__spaceon (dev always; production only with ?debug=1), read-only, zero cost when disabled: getState() returning JSON-serialisable state: mode, simClock state, ship heliocentric position (km) and velocity, nearest body and altitude, target and distance/ETA, travel mode, FPS, cloud status, loaded/failed assets, last 20 console errors/warnings, renderer info (draw calls, triangles, textures, geometries). Plus waitForReady(). Documented in README. Use it (with any available browser tool) to verify milestones with numbers instead of screenshots.

## Milestones (test and approve each before the next)
1. FOUNDATION (nothing should visibly change): floating origin / camera-relative rendering with 64-bit world positions; depth solution in every shader; stars at infinity; the debug hook. The current layout and look must be identical; then demonstrate precision with a temporary dev-only test (object at 30 AU, camera at 1 m: no jitter) and remove it.
2. TRUE SCALE + REAL POSITIONS: ephemeris, true sizes and orientations, Sun as real light with auto-exposure, point-of-light impostors, orbit lines in flight, belt relocated with local streaming field, portfolio zone, spawn, decorative objects, Live Earth at true radius, verification against references.
3. FLIGHT MODEL: manual, cruise, smooth transitions, readouts.
4. NAVIGATION: registry, targeting, off-screen markers, autopilot, system map, fast travel with arrival framing.
5. POLISH: mobile layout and controls, performance on a mid-range phone, loading behaviour, final QA against every acceptance line above.

## Constraints (all milestones)
No per-frame allocations in hot paths. Mobile must work. Everything fails soft. npm run lint, npm run build and npm run verify:earth pass at the end of every milestone. Hub untouched.
