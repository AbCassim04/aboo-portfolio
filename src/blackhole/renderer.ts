import * as THREE from 'three'
import { Observer, clampObserverDistance, clampPlanetOrbitDistance } from './observer'
import { setupBloom } from './bloom'
import type { BloomPass } from './bloom'
import { FRAGMENT_SHADER_DESKTOP, FRAGMENT_SHADER_MOBILE, VERTEX_SHADER } from '../shaders/blackhole/compiled'

// ─── Mobile detection ─────────────────────────────────────────────────────────
let _isMobile = false

// ─── Module state ─────────────────────────────────────────────────────────────
let _renderer: THREE.WebGLRenderer | null = null
let _scene: THREE.Scene | null = null
let _ppCamera: THREE.OrthographicCamera | null = null
let _material: THREE.ShaderMaterial | null = null
let _uniforms: Record<string, THREE.IUniform<unknown>> | null = null
let _observer: Observer | null = null
let _bloomPass: BloomPass | null = null
let _rafId: number | null = null
let _needsUpdate = true
let _meshGeo: THREE.BufferGeometry | null = null
const _prevObserverPos = new THREE.Vector3()
let _camLogged = false

// ─── Diagnostic stages (set DEBUG_STAGE=0 to disable) ────────────────────────
// 1=solid-red  2=uv-gradient  3=ray-direction
let DEBUG_STAGE = 0
const DEBUG_FRAG: Record<number, string> = {
  1: 'void main(){gl_FragColor=vec4(1.0,0.0,0.0,1.0);}',
  2: 'uniform vec2 resolution;void main(){vec2 uv=gl_FragCoord.xy/resolution.xy;gl_FragColor=vec4(uv,0.0,1.0);}',
  3: [
    'uniform vec2 resolution;',
    'uniform vec3 cam_x,cam_y,cam_z;',
    'void main(){',
    '  vec2 p=-1.0+2.0*gl_FragCoord.xy/resolution.xy;',
    '  p.y*=resolution.y/resolution.x;',
    '  vec3 ray=normalize(p.x*cam_x+p.y*cam_y+1.0*cam_z);',
    '  gl_FragColor=vec4(ray*0.5+0.5,1.0);',
    '}',
  ].join('\n'),
}
let _dbgN = 0

function dbgRT(label: string, rt: THREE.WebGLRenderTarget): void {
  const rdr = _renderer
  if (!rdr) return
  const buf = new Uint8Array(4)
  try {
    rdr.readRenderTargetPixels(rt, rt.width >> 1, rt.height >> 1, 1, 1, buf)
    console.log(`[BH:dbg] ${label}: r=${buf[0]} g=${buf[1]} b=${buf[2]} a=${buf[3]}`)
  } catch (e) { console.warn('[BH:dbg] readRT failed:', label, String(e)) }
}

// ─── TAA state ────────────────────────────────────────────────────────────────
let _taaCurrentRT: THREE.WebGLRenderTarget | null = null
let _taaHistoryRT: THREE.WebGLRenderTarget | null = null
let _taaOutputRT:  THREE.WebGLRenderTarget | null = null
let _taaPPScene:   THREE.Scene | null = null
let _taaMesh:      THREE.Mesh  | null = null
let _taaMeshGeo:   THREE.BufferGeometry | null = null
let _taaBlendMat:  THREE.ShaderMaterial | null = null
let _taaCopyMat:   THREE.ShaderMaterial | null = null
let _taaHistoryValid = false
let _taaFrameIndex   = 0

// ─── Physics state ─────────────────────────────────────────────────────────────
const diveState = {
  active: false, paused: false, speed: 1.0,
  currentR: 11.0, direction: new THREE.Vector3(1, 0, 0),
  reachedSingularity: false,
}
const hoverState = {
  active: false, paused: false, speed: 0.3,
  currentR: 11.0, direction: new THREE.Vector3(1, 0, 0),
  minR: 1.0002,
}

// ─── Shader parameters ────────────────────────────────────────────────────────
const PARAMS = {
  time_scale: 1.0,
  observer: { motion: true, distance: 11.0, orbital_inclination: -10 },
  gravitational_time_dilation: true,
  black_hole: { spin_enabled: true, spin: 0.90, spin_strength: 1.0 },
  bloom: { enabled: true, strength: 0.35, threshold: 0.65, radius: 0.85 },
  taa_enabled: !_isMobile,
  taa: { history_weight: 0.82, clip_box: 0.08, motion_rejection: 10.0, max_camera_delta: 0.07, motion_clip_scale: 0.8 },
  planet: { distance: 14.0, radius: 0.4 },
  disk_temperature: 8000.0,
  look: { exposure: 1.0, disk_gain: 1.0, glow: 0.0, doppler_boost: 1.0, aberration_strength: 1.0, star_gain: 1.0, galaxy_gain: 1.0, tonemap_mode: 1.0 },
  torus: { r0: 4.0, h_ratio: 0.45, radial_falloff: 2.5, opacity: 0.015, outer_radius: 3.5 },
  slim: { h_ratio: 0.15, opacity: 0.6, puff_factor: 2.5 },
  jet: { half_angle: 5.0, lorentz_factor: 3.0, brightness: 1.2, length: 30.0, magnetization: 10.0, knot_spacing: 6.0, corona_brightness: 1.5, base_width: 0.4, corona_extent: 0.5 },
  grmhd: { r_high: 40.0, magnetic_beta: 10.0, mad_flux: 0.0, density_scale: 1.0, turbulence_amp: 1.0, electron_kappa: 5.0, magnetic_field_str: 1.0 },
  turbulence_loop_enabled: false,
  turbulence_loop_seconds: 20.0,
}

// ─── Frame timing ─────────────────────────────────────────────────────────────
const _frameTiming = (() => {
  const MAX_DT = 0.1
  let lastTs = performance.now()
  document.addEventListener('visibilitychange', () => { if (!document.hidden) lastTs = performance.now() })
  return () => {
    const now  = performance.now()
    const diff = Math.min((now - lastTs) / 1000.0, MAX_DT)
    lastTs = now
    return diff
  }
})()

// ─── ISCO calculator ──────────────────────────────────────────────────────────
function calculateISCO(chi: number, prograde: boolean): number {
  const chi2 = chi * chi
  const Z1 = 1 + Math.pow(Math.max(1 - chi2, 0), 1 / 3) *
    (Math.pow(1 + Math.abs(chi), 1 / 3) + Math.pow(Math.max(1 - Math.abs(chi), 0), 1 / 3))
  const Z2 = Math.sqrt(3 * chi2 + Z1 * Z1)
  const sign = prograde ? -1 : 1
  return (3 + Z2 + sign * Math.sqrt((3 - Z1) * (3 + Z1 + 2 * Z2))) * 0.5
}

// ─── Halton sequence for TAA jitter ──────────────────────────────────────────
function halton(index: number, base: number): number {
  let f = 1.0, r = 0.0, i = index
  while (i > 0) { f /= base; r += f * (i % base); i = Math.floor(i / base) }
  return r
}

// ─── TAA pass helpers ─────────────────────────────────────────────────────────
function initTAA(w: number, h: number): void {
  const PP_VERT = `varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position,1.0); }`
  const BLEND_FS = `
    uniform sampler2D tCurrent; uniform sampler2D tHistory;
    uniform float historyWeight; uniform float historyValid; uniform float clipBox;
    varying vec2 vUv;
    void main(){
      vec3 cur=texture2D(tCurrent,vUv).rgb; vec3 his=texture2D(tHistory,vUv).rgb;
      his=clamp(his,cur-vec3(clipBox),cur+vec3(clipBox));
      float lc=dot(cur,vec3(0.299,0.587,0.114)); float lh=dot(his,vec3(0.299,0.587,0.114));
      float re=clamp(1.0-abs(lc-lh)*5.0,0.0,1.0);
      float w=historyWeight*historyValid*re;
      gl_FragColor=vec4(mix(cur,his,w),1.0);
    }`
  const COPY_FS = `uniform sampler2D tDiffuse; varying vec2 vUv; void main(){ gl_FragColor=texture2D(tDiffuse,vUv); }`
  const RT = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat }
  const mk = (ww: number, hh: number) => new THREE.WebGLRenderTarget(Math.max(1, ww), Math.max(1, hh), RT)

  _taaPPScene = new THREE.Scene()
  _taaMeshGeo  = new THREE.PlaneGeometry(2, 2)
  _taaBlendMat = new THREE.ShaderMaterial({
    uniforms: { tCurrent: { value: null }, tHistory: { value: null }, historyWeight: { value: 0 }, historyValid: { value: 0 }, clipBox: { value: 0.08 } },
    vertexShader: PP_VERT, fragmentShader: BLEND_FS, depthWrite: false, depthTest: false,
  })
  _taaCopyMat = new THREE.ShaderMaterial({
    uniforms: { tDiffuse: { value: null } },
    vertexShader: PP_VERT, fragmentShader: COPY_FS, depthWrite: false, depthTest: false,
  })
  _taaMesh = new THREE.Mesh(_taaMeshGeo, _taaBlendMat)
  _taaPPScene.add(_taaMesh)

  _taaCurrentRT = mk(w, h)
  _taaHistoryRT = mk(w, h)
  _taaOutputRT  = mk(w, h)
}

function resizeTAA(w: number, h: number): void {
  if (!_taaCurrentRT || !_taaHistoryRT || !_taaOutputRT) return
  _taaCurrentRT.dispose(); _taaHistoryRT.dispose(); _taaOutputRT.dispose()
  const RT = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat }
  const mk = (ww: number, hh: number) => new THREE.WebGLRenderTarget(Math.max(1, ww), Math.max(1, hh), RT)
  _taaCurrentRT = mk(w, h); _taaHistoryRT = mk(w, h); _taaOutputRT = mk(w, h)
  _taaHistoryValid = false; _taaFrameIndex = 0
}

function taaNextJitter(): THREE.Vector2 {
  const idx = (_taaFrameIndex % 8) + 1
  _taaFrameIndex++
  return new THREE.Vector2(halton(idx, 2) - 0.5, halton(idx, 3) - 0.5)
}

function resetTAA(): void {
  _taaHistoryValid = false; _taaFrameIndex = 0
  if (_uniforms) _uniforms['taa_jitter'].value = new THREE.Vector2(0, 0)
}

function renderTAA(rdr: THREE.WebGLRenderer, currentRT: THREE.WebGLRenderTarget, cameraDelta: number): void {
  if (!_taaMesh || !_taaBlendMat || !_taaCopyMat || !_taaPPScene || !_ppCamera || !_taaHistoryRT || !_taaOutputRT) return
  const s       = PARAMS.taa
  const useHist = _taaHistoryValid && cameraDelta < s.max_camera_delta
  const attn    = Math.max(0, 1 - cameraDelta * s.motion_rejection)
  const hw      = useHist ? s.history_weight * attn : 0.0
  const clip    = s.clip_box + Math.min(cameraDelta * s.motion_clip_scale, 0.5)

  // Capture module-level vars so TypeScript can narrow after the guard above
  const taaMesh   = _taaMesh!
  const blendMat  = _taaBlendMat!
  const copyMat   = _taaCopyMat!
  const ppScene   = _taaPPScene!
  const ppCam     = _ppCamera!
  let   histRT    = _taaHistoryRT!
  let   outRT     = _taaOutputRT!

  blendMat.uniforms['tCurrent'].value     = currentRT.texture
  blendMat.uniforms['tHistory'].value     = histRT.texture
  blendMat.uniforms['historyWeight'].value = hw
  blendMat.uniforms['historyValid'].value  = useHist ? 1.0 : 0.0
  blendMat.uniforms['clipBox'].value       = clip
  taaMesh.material = blendMat
  rdr.setRenderTarget(outRT); rdr.clear(); rdr.render(ppScene, ppCam); rdr.setRenderTarget(null)

  copyMat.uniforms['tDiffuse'].value = outRT.texture
  taaMesh.material = copyMat
  rdr.setRenderTarget(null); rdr.render(ppScene, ppCam)

  // Ping-pong: outRT becomes new history
  const tmp = histRT; histRT = outRT; outRT = tmp
  _taaHistoryRT = histRT; _taaOutputRT = outRT
  _taaHistoryValid = true
}

// ─── Update observer orientation from camera ─────────────────────────────────
function updateCamera(): void {
  if (!_observer || !_uniforms) return
  const frame = _observer.orbitalFrame()
  _observer.orientation.copy(frame)
  const e = frame.elements
  // Three.js Matrix3 is column-major: e[0..2]=col0=orbital_x, e[3..5]=col1=orbital_y(→BH), e[6..8]=col2=orbital_z(⊥plane)
  // cam_z is the shader's look/forward direction; orbital_y points towards the BH, so it must map to cam_z.
  // orbital_z=(0,0,1) is perpendicular to the orbital plane and serves as screen "up" (cam_y).
  ;(_uniforms['cam_x'].value as THREE.Vector3).set(e[0], e[1], e[2])
  ;(_uniforms['cam_y'].value as THREE.Vector3).set(e[6], e[7], e[8])
  ;(_uniforms['cam_z'].value as THREE.Vector3).set(e[3], e[4], e[5])
  if (!_camLogged && _uniforms) {
    _camLogged = true
    console.log('[BH] cam_x:', (_uniforms['cam_x'].value as THREE.Vector3).toArray())
    console.log('[BH] cam_y:', (_uniforms['cam_y'].value as THREE.Vector3).toArray())
    console.log('[BH] cam_z:', (_uniforms['cam_z'].value as THREE.Vector3).toArray())
  }
}

// ─── Update all uniforms ──────────────────────────────────────────────────────
function updateUniforms(): void {
  if (!_uniforms || !_observer || !_renderer) return
  const u = _uniforms
  const obs = _observer

  PARAMS.planet.distance = clampPlanetOrbitDistance(PARAMS.planet.distance)
  PARAMS.observer.distance = clampObserverDistance(PARAMS.observer.distance, PARAMS.observer.motion)

  u['planet_distance'].value = PARAMS.planet.distance
  u['planet_radius'].value   = PARAMS.planet.radius
  u['disk_temperature'].value = PARAMS.disk_temperature

  const spinMag = Math.abs(PARAMS.black_hole.spin)
  u['accretion_inner_r'].value  = PARAMS.black_hole.spin_enabled ? calculateISCO(spinMag, true) : 3.0
  u['bh_spin'].value            = PARAMS.black_hole.spin
  u['bh_spin_strength'].value   = PARAMS.black_hole.spin_strength
  u['bh_rotation_enabled'].value = PARAMS.black_hole.spin_enabled ? 1.0 : 0.0

  u['look_exposure'].value           = PARAMS.look.exposure
  u['look_disk_gain'].value          = PARAMS.look.disk_gain
  u['look_glow'].value               = PARAMS.look.glow
  u['look_doppler_boost'].value      = PARAMS.look.doppler_boost
  u['look_aberration_strength'].value = PARAMS.look.aberration_strength
  u['look_star_gain'].value          = PARAMS.look.star_gain
  u['look_galaxy_gain'].value        = PARAMS.look.galaxy_gain
  u['look_tonemap_mode'].value       = PARAMS.look.tonemap_mode

  u['torus_r0'].value           = PARAMS.torus.r0
  u['torus_h_ratio'].value      = PARAMS.torus.h_ratio
  u['torus_radial_falloff'].value = PARAMS.torus.radial_falloff
  u['torus_opacity'].value      = PARAMS.torus.opacity
  u['torus_outer_radius'].value  = PARAMS.torus.outer_radius

  u['slim_h_ratio'].value    = PARAMS.slim.h_ratio
  u['slim_opacity'].value    = PARAMS.slim.opacity
  u['slim_puff_factor'].value = PARAMS.slim.puff_factor

  u['jet_half_angle'].value       = PARAMS.jet.half_angle
  u['jet_lorentz'].value          = PARAMS.jet.lorentz_factor
  u['jet_brightness'].value       = PARAMS.jet.brightness
  u['jet_length'].value           = PARAMS.jet.length
  u['jet_magnetization'].value    = PARAMS.jet.magnetization
  u['jet_knot_spacing'].value     = PARAMS.jet.knot_spacing
  u['jet_corona_brightness'].value = PARAMS.jet.corona_brightness
  u['jet_base_width'].value       = PARAMS.jet.base_width
  u['jet_corona_extent'].value    = PARAMS.jet.corona_extent

  u['grmhd_r_high'].value          = PARAMS.grmhd.r_high
  u['grmhd_magnetic_beta'].value   = PARAMS.grmhd.magnetic_beta
  u['grmhd_mad_flux'].value        = PARAMS.grmhd.mad_flux
  u['grmhd_density_scale'].value   = PARAMS.grmhd.density_scale
  u['grmhd_turbulence_amp'].value  = PARAMS.grmhd.turbulence_amp
  u['grmhd_electron_kappa'].value  = PARAMS.grmhd.electron_kappa
  u['grmhd_magnetic_field_str'].value = PARAMS.grmhd.magnetic_field_str

  u['turbulence_loop_enabled'].value  = PARAMS.turbulence_loop_enabled ? 1.0 : 0.0
  u['turbulence_loop_seconds'].value  = Math.max(1e-4, PARAMS.turbulence_loop_seconds)

  const canvas = _renderer.domElement
  ;(u['resolution'].value as THREE.Vector2).set(canvas.width, canvas.height)

  u['time'].value               = obs.time
  u['turbulence_time_offset'].value = 0.0

  ;(u['cam_pos'].value as THREE.Vector3).set(obs.position.x, obs.position.y, obs.position.z)
  ;(u['cam_vel'].value as THREE.Vector3).set(obs.velocity.x, obs.velocity.y, obs.velocity.z)

  const e = obs.orientation.elements
  ;(u['cam_x'].value as THREE.Vector3).set(e[0], e[1], e[2])
  ;(u['cam_y'].value as THREE.Vector3).set(e[6], e[7], e[8])
  ;(u['cam_z'].value as THREE.Vector3).set(e[3], e[4], e[5])

  ;(u['cam_pan'].value as THREE.Vector2).set(0, 0)

  const obsR = obs.position.length()
  u['interior_mode'].value = obsR < 1.0 ? 1.0 : 0.0

  // Photon spin lensing fade near photon sphere
  let photonSpinScale = 1.0
  if (obs.velocity.lengthSq() < 1e-8) {
    let fade = (obsR - 1.5) / 0.2
    fade = Math.max(0, Math.min(1, fade))
    photonSpinScale = fade * fade * (3.0 - 2.0 * fade)
  }
  u['photon_spin_lensing_scale'].value = photonSpinScale

  u['grav_blueshift_factor'].value = obsR > 1.0
    ? Math.sqrt(Math.max(1.0 - 1.0 / obsR, 0.001))
    : 1.0
}

// ─── Dive physics (simplified: no UI updates) ─────────────────────────────────
function cinematicFactor(r: number): number {
  if (r > 3.0) return 0.5
  if (r > 1.5) return 1.0 + (3.0 - r) / 1.5
  return 2.5 + (1.5 - r) * 4.0
}

function updateDive(dt: number): void {
  if (!_observer) return
  const r = diveState.currentR
  if (r <= 0.08) { diveState.reachedSingularity = true; return }
  const speed = diveState.speed * cinematicFactor(r)
  // dr/dτ = -sqrt(1/r) for radial freefall; simple RK2
  const k1 = -Math.sqrt(Math.max(1.0 / Math.max(r, 0.08), 0))
  const r2  = Math.max(r + 0.5 * dt * speed * k1, 0.08)
  const k2  = -Math.sqrt(Math.max(1.0 / r2, 0))
  const newR = Math.max(r + dt * speed * k2, 0.08)
  diveState.currentR = newR
  _observer.position.copy(diveState.direction.clone().multiplyScalar(newR))
  _observer.velocity.set(0, 0, k1 * speed * 0.5)
  _observer.time += dt * PARAMS.time_scale
  _needsUpdate = true
}

function updateHover(dt: number): void {
  if (!_observer) return
  const r = hoverState.currentR
  if (r <= hoverState.minR) { hoverState.paused = true; return }
  const approachRate = hoverState.speed * Math.max(r - hoverState.minR, 0.001) * PARAMS.time_scale
  const newR = Math.max(r - approachRate * dt, hoverState.minR)
  hoverState.currentR = newR
  _observer.position.copy(hoverState.direction.clone().multiplyScalar(newR))
  _observer.velocity.set(0, 0, 0)
  const timeDilation = Math.sqrt(Math.max(1.0 - 1.0 / newR, 0.001))
  _observer.time += dt * PARAMS.time_scale / timeDilation
  _needsUpdate = true
}

// ─── Simulation step ─────────────────────────────────────────────────────────
function stepSimulation(dt: number): void {
  if (!_observer) return
  if (diveState.active && !diveState.reachedSingularity && !diveState.paused) {
    updateDive(dt)
    updateCamera()
  } else if (hoverState.active && !hoverState.paused) {
    updateHover(dt)
    updateCamera()
  } else {
    _observer.move(dt, PARAMS)
    if (PARAMS.observer.motion) updateCamera()
    _needsUpdate = true
  }
}

// ─── Render helpers ───────────────────────────────────────────────────────────
function renderSceneToTarget(target: THREE.WebGLRenderTarget | null): void {
  if (!_renderer || !_scene || !_ppCamera) return
  if (PARAMS.bloom.enabled && _bloomPass && target) {
    _bloomPass.render(_renderer, _scene, _ppCamera, PARAMS.bloom, target)
  } else if (PARAMS.bloom.enabled && _bloomPass) {
    _bloomPass.render(_renderer, _scene, _ppCamera, PARAMS.bloom, null)
  } else if (target) {
    _renderer.setRenderTarget(target); _renderer.clear()
    _renderer.render(_scene, _ppCamera); _renderer.setRenderTarget(null)
  } else {
    _renderer.setRenderTarget(null)
    _renderer.render(_scene, _ppCamera)
  }
}

function renderFrame(): void {
  if (!_renderer || !_uniforms) return
  const rdr = _renderer
  const taaEnabled = PARAMS.taa_enabled && !!_taaCurrentRT

  // ── Diagnostic pixel readback (first 3 frames only) ──────────────────────────
  _dbgN++
  if (DEBUG_STAGE > 0) {
    if (_dbgN <= 3) console.log(`[BH:dbg] renderFrame #${_dbgN} taaEnabled=${taaEnabled}`)

    if (_dbgN === 1 && _scene && _ppCamera) {
      // Render scene to 8×8 RT — completely isolated from bloom/TAA/screen
      const tiny = new THREE.WebGLRenderTarget(8, 8, { format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter })
      const scn = _scene; const cam = _ppCamera
      rdr.setRenderTarget(tiny); rdr.clear(); rdr.render(scn, cam); rdr.setRenderTarget(null)
      dbgRT('[A] scene-only (bypasses bloom+TAA)', tiny)
      tiny.dispose()
    }
  }

  if (taaEnabled) {
    const jitter = taaNextJitter()
    ;(_uniforms['taa_jitter'].value as THREE.Vector2).set(jitter.x, jitter.y)
  } else {
    ;(_uniforms['taa_jitter'].value as THREE.Vector2).set(0, 0)
  }

  updateUniforms()

  if (taaEnabled && _taaCurrentRT) {
    // Use observer position change as proxy for view change (for TAA motion rejection)
    const delta = _observer ? Math.min(_prevObserverPos.distanceTo(_observer.position) * 0.1, 1.0) : 0.0
    if (_observer) _prevObserverPos.copy(_observer.position)
    renderSceneToTarget(_taaCurrentRT)

    // ── Diagnostic: read pipeline stages after bloom ───────────────────────────
    if (DEBUG_STAGE > 0 && _dbgN <= 3) {
      if (_bloomPass) dbgRT('[B] pre-bloom mainRT', _bloomPass.mainRT)
      dbgRT('[C] post-bloom taaCurrentRT', _taaCurrentRT)
    }

    renderTAA(rdr, _taaCurrentRT, delta)

    // ── Diagnostic: read post-TAA output (ping-pong: history = last frame on screen)
    if (DEBUG_STAGE > 0 && _dbgN <= 3 && _taaHistoryRT) {
      dbgRT('[D] post-TAA taaHistoryRT (= screen output)', _taaHistoryRT)
    }
    // ── Always: one-shot readback on frame 1 for the full shader path ────────────
    if (_dbgN === 1 && _bloomPass && _taaHistoryRT) {
      dbgRT('[full] pre-bloom mainRT center', _bloomPass.mainRT)
      dbgRT('[full] post-TAA screen center', _taaHistoryRT)
    }
  } else {
    renderSceneToTarget(null)
    if (_taaHistoryValid) resetTAA()

    // ── Diagnostic: non-TAA path — read bloom mainRT only ─────────────────────
    if (DEBUG_STAGE > 0 && _dbgN <= 3 && _bloomPass) {
      dbgRT('[B-nontaa] pre-bloom mainRT', _bloomPass.mainRT)
    }
    if (_dbgN === 1 && _bloomPass) {
      const rt = _bloomPass.mainRT
      const rdr2 = _renderer!
      const positions = [
        ['center',    rt.width >> 1,          rt.height >> 1],
        ['top-mid',   rt.width >> 1,          rt.height - 4],
        ['right-mid', rt.width - 4,           rt.height >> 1],
        ['bottom-mid',rt.width >> 1,          4],
        ['left-mid',  4,                       rt.height >> 1],
        ['top-right', rt.width - 4,           rt.height - 4],
      ] as const
      for (const [label, x, y] of positions) {
        const b = new Uint8Array(4)
        try { rdr2.readRenderTargetPixels(rt, x, y, 1, 1, b) } catch(_) {}
        console.log(`[full-nontaa] mainRT ${label} (${x},${y}): r=${b[0]} g=${b[1]} b=${b[2]} a=${b[3]}`)
      }
    }
  }
}

function drawFrame(forceRender: boolean): void {
  if (forceRender || _needsUpdate) {
    _needsUpdate = false
    renderFrame()
  }
}

// ─── Animation loop ──────────────────────────────────────────────────────────
function animate(): void {
  _rafId = requestAnimationFrame(animate)
  const dt = _frameTiming()
  stepSimulation(dt)
  drawFrame(false)
}

// ─── Resize ──────────────────────────────────────────────────────────────────
export function resize(width: number, height: number): void {
  if (!_renderer) return
  _renderer.setPixelRatio(Math.max(window.devicePixelRatio || 1, 1))
  _renderer.setSize(width, height)
  const w = _renderer.domElement.width
  const h = _renderer.domElement.height
  if (_bloomPass) _bloomPass.resize(w, h)
  resizeTAA(w, h)
  _needsUpdate = true
}

// ─── Init ─────────────────────────────────────────────────────────────────────
export function init(canvas: HTMLCanvasElement, onReady: () => void): void {
  _isMobile = window.innerWidth < 768
  const fragShader = _isMobile ? FRAGMENT_SHADER_MOBILE : FRAGMENT_SHADER_DESKTOP

  _renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' })
  _renderer.setPixelRatio(Math.max(window.devicePixelRatio || 1, 1))
  _renderer.setSize(canvas.clientWidth, canvas.clientHeight)
  _renderer.autoClear = false

  // Orthographic camera for fullscreen quad
  _ppCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  _scene = new THREE.Scene()

  // Initialize observer on circular orbit
  _observer = new Observer()
  _observer.position.set(11, 0, 0)
  _observer.velocity.set(0, 1.0 / Math.sqrt(2.0 * (11 - 1.0)), 0)

  // Load textures
  const loader = new THREE.TextureLoader()
  const base = import.meta.env.BASE_URL || '/'
  const bh   = base.endsWith('/') ? `${base}blackhole/` : `${base}/blackhole/`

  Promise.all([
    loader.loadAsync(`${bh}stars.png`),
    loader.loadAsync(`${bh}milkyway.jpg`),
    loader.loadAsync(`${bh}beach-ball.png`),
    loader.loadAsync(`${bh}spectra.png`),
  ]).then(([stars, galaxy, planet, spectra]) => {
    if (!_renderer || !_scene || !_ppCamera || !_observer) return

    // Uniforms
    _uniforms = {
      time: { value: 0 },
      turbulence_time_offset: { value: 0.0 },
      turbulence_loop_enabled: { value: 0.0 },
      turbulence_loop_seconds: { value: 20.0 },
      resolution: { value: new THREE.Vector2() },
      cam_pos: { value: new THREE.Vector3() },
      cam_x: { value: new THREE.Vector3() },
      cam_y: { value: new THREE.Vector3() },
      cam_z: { value: new THREE.Vector3() },
      cam_vel: { value: new THREE.Vector3() },
      cam_pan: { value: new THREE.Vector2() },
      taa_jitter: { value: new THREE.Vector2() },
      interior_mode: { value: 0.0 },
      planet_distance: { value: 14.0 },
      planet_radius: { value: 0.4 },
      disk_temperature: { value: 8000.0 },
      accretion_inner_r: { value: 3.0 },
      bh_spin: { value: 0.90 },
      bh_spin_strength: { value: 1.0 },
      bh_rotation_enabled: { value: 1.0 },
      photon_spin_lensing_scale: { value: 1.0 },
      grav_blueshift_factor: { value: 1.0 },
      look_exposure: { value: 1.0 },
      look_disk_gain: { value: 1.0 },
      look_glow: { value: 0.0 },
      look_doppler_boost: { value: 1.0 },
      look_aberration_strength: { value: 1.0 },
      look_star_gain: { value: 1.0 },
      look_galaxy_gain: { value: 1.0 },
      look_tonemap_mode: { value: 1.0 },
      torus_r0: { value: 4.0 },
      torus_h_ratio: { value: 0.45 },
      torus_radial_falloff: { value: 2.5 },
      torus_opacity: { value: 0.015 },
      torus_outer_radius: { value: 3.5 },
      slim_h_ratio: { value: 0.15 },
      slim_opacity: { value: 0.6 },
      slim_puff_factor: { value: 2.5 },
      jet_half_angle: { value: 5.0 },
      jet_lorentz: { value: 3.0 },
      jet_brightness: { value: 1.2 },
      jet_length: { value: 30.0 },
      jet_magnetization: { value: 10.0 },
      jet_knot_spacing: { value: 6.0 },
      jet_corona_brightness: { value: 1.5 },
      jet_base_width: { value: 0.4 },
      jet_corona_extent: { value: 0.5 },
      grmhd_r_high: { value: 40.0 },
      grmhd_magnetic_beta: { value: 10.0 },
      grmhd_mad_flux: { value: 0.0 },
      grmhd_density_scale: { value: 1.0 },
      grmhd_turbulence_amp: { value: 1.0 },
      grmhd_electron_kappa: { value: 5.0 },
      grmhd_magnetic_field_str: { value: 1.0 },
      star_texture: { value: stars },
      galaxy_texture: { value: galaxy },
      planet_texture: { value: planet },
      spectrum_texture: { value: spectra },
    }

    // Fullscreen quad
    _meshGeo  = new THREE.PlaneGeometry(2, 2)
    _material = new THREE.ShaderMaterial({
      uniforms:       _uniforms,
      vertexShader:   VERTEX_SHADER,
      fragmentShader: fragShader,
      depthWrite: false,
      depthTest:  false,
    })
    const mesh = new THREE.Mesh(_meshGeo, _material)
    _scene.add(mesh)

    // Stage diagnostic: log GLSL source, optionally override fragment shader
    if (DEBUG_STAGE > 0) {
      console.log('[BH:dbg] GLSL source head (300 chars):\n', fragShader.slice(0, 300))
      const ovrd = DEBUG_FRAG[DEBUG_STAGE]
      if (ovrd) {
        _material.fragmentShader = ovrd
        _material.needsUpdate = true
        console.log('[BH:dbg] Stage', DEBUG_STAGE, 'fragment shader override applied')
      }
    }

    // Initial camera orientation
    updateCamera()

    // Post-processing
    _bloomPass = setupBloom()
    const w = _renderer.domElement.width
    const h = _renderer.domElement.height
    _bloomPass.resize(w, h)

    if (!_isMobile) {
      initTAA(w, h)
    }

    // Force first render
    _needsUpdate = true
    updateUniforms()
    renderFrame()

    onReady()
    animate()
  }).catch((err: unknown) => {
    console.error('[BlackHole] Texture load failed:', err)
    onReady() // show canvas anyway, will be black
    animate()
  })
}

// ─── Dispose ──────────────────────────────────────────────────────────────────
export function dispose(): void {
  if (_rafId !== null) { cancelAnimationFrame(_rafId); _rafId = null }

  _bloomPass?.dispose(); _bloomPass = null

  _taaCurrentRT?.dispose(); _taaHistoryRT?.dispose(); _taaOutputRT?.dispose()
  _taaCurrentRT = null; _taaHistoryRT = null; _taaOutputRT = null
  _taaBlendMat?.dispose(); _taaCopyMat?.dispose()
  _taaBlendMat = null; _taaCopyMat = null
  _taaMeshGeo?.dispose(); _taaMeshGeo = null
  _taaMesh = null; _taaPPScene = null

  _meshGeo?.dispose(); _meshGeo = null
  _material?.dispose(); _material = null
  _uniforms = null
  _scene    = null
  _observer = null
  _renderer?.dispose(); _renderer = null
  _ppCamera = null
  _needsUpdate = true
  _taaHistoryValid = false; _taaFrameIndex = 0
  diveState.active = false; hoverState.active = false
}
