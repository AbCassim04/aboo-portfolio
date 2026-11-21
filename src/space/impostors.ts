import * as THREE from 'three'

// ── Point-of-light impostors ────────────────────────────────────────────────
// One screen-space point per body. While a body's disc is smaller than a few
// pixels it shows as a star whose brightness follows its apparent magnitude;
// as the disc grows past ~2 px the point fades out and the mesh takes over
// (crossfade over 2 → 8 px), so a distant planet never vanishes or pops.
//
// Brightness: magnitudes map logarithmically (like the eye) onto point size
// and intensity between M_SAT (full) and M_LIMIT (faintest shown), with a
// floor so even Neptune from the inner system stays a visible faint star.
// The caller applies eye adaptation by passing an adapted magnitude.
//
// The point sits on the body's near surface (centre − 1.001 R toward the
// camera) so it passes the depth test against its own disc but is still
// hidden by anything genuinely in front of the body. Render-space positions
// are written by the caller every frame (camera-relative, so float32 is fine).

const M_SAT   = -3.0
const M_LIMIT = 9.5
const B_MIN   = 0.16

/** Disc diameter (px) where the impostor starts / finishes fading out. */
export const IMPOSTOR_FADE_START_PX = 2
export const IMPOSTOR_FADE_END_PX   = 8

const VERT = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec3  aColor;
attribute float aSize;
attribute float aAlpha;
varying   vec3  vColor;
varying   float vAlpha;
void main() {
  vColor = aColor;
  vAlpha = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position  = projectionMatrix * mv;
  gl_PointSize = aSize;
  #include <logdepthbuf_vertex>
}`

const FRAG = /* glsl */`
#include <logdepthbuf_pars_fragment>
varying vec3  vColor;
varying float vAlpha;
void main() {
  #include <logdepthbuf_fragment>
  if (vAlpha <= 0.001) discard;
  vec2  c    = gl_PointCoord * 2.0 - 1.0;
  float r2   = dot(c, c);
  if (r2 > 1.0) discard;
  float core = exp(-r2 * 9.0);
  float halo = exp(-r2 * 3.0) * 0.35;
  vec3  col  = mix(vColor, vec3(1.0), core * 0.6);
  gl_FragColor = vec4(col * (core + halo) * vAlpha, 1.0);
}`

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

/** Perceptual brightness 0..1 for an (adapted) apparent magnitude. */
export function magnitudeToBrightness(m: number): number {
  return Math.min(1, Math.max(B_MIN, (M_LIMIT - m) / (M_LIMIT - M_SAT)))
}

export class Impostors {
  readonly points: THREE.Points
  private readonly pos:   Float32Array
  private readonly col:   Float32Array
  private readonly size:  Float32Array
  private readonly alpha: Float32Array
  private readonly geo:   THREE.BufferGeometry
  private readonly mat:   THREE.ShaderMaterial

  constructor(count: number) {
    this.pos   = new Float32Array(count * 3)
    this.col   = new Float32Array(count * 3)
    this.size  = new Float32Array(count)
    this.alpha = new Float32Array(count)
    this.geo = new THREE.BufferGeometry()
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage))
    this.geo.setAttribute('aColor',   new THREE.BufferAttribute(this.col, 3))
    this.geo.setAttribute('aSize',    new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage))
    this.geo.setAttribute('aAlpha',   new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage))
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, depthTest: true,
      blending: THREE.AdditiveBlending,
    })
    this.mat.name = 'body-impostors'
    this.points = new THREE.Points(this.geo, this.mat)
    this.points.frustumCulled = false
    this.points.renderOrder   = 10
  }

  setColor(i: number, c: THREE.Color): void {
    this.col[i * 3] = c.r; this.col[i * 3 + 1] = c.g; this.col[i * 3 + 2] = c.b
    ;(this.geo.getAttribute('aColor') as THREE.BufferAttribute).needsUpdate = true
  }

  /**
   * @param renderPos body centre, camera-relative (km)
   * @param radius    body radius (km)
   * @param magnitude adapted apparent magnitude
   * @param discPx    disc diameter on screen (device px)
   * @param dpr       device pixel ratio (point sizes are in device px)
   * @param boost     extra size factor (e.g. the Sun)
   */
  set(i: number, renderPos: THREE.Vector3, radius: number, magnitude: number, discPx: number, dpr: number, boost = 1): void {
    const d = renderPos.length()
    const k = d > radius * 1.001 ? 1 - (radius * 1.001) / d : 0
    this.pos[i * 3] = renderPos.x * k; this.pos[i * 3 + 1] = renderPos.y * k; this.pos[i * 3 + 2] = renderPos.z * k
    const b = magnitudeToBrightness(magnitude)
    this.size[i]  = (2.2 + 4.5 * b) * dpr * boost
    this.alpha[i] = (0.35 + 0.65 * b) * (1 - smoothstep(IMPOSTOR_FADE_START_PX * dpr, IMPOSTOR_FADE_END_PX * dpr, discPx))
  }

  hide(i: number): void { this.alpha[i] = 0 }

  /** Flag the per-frame attributes for upload. */
  commit(): void {
    ;(this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true
    ;(this.geo.getAttribute('aSize') as THREE.BufferAttribute).needsUpdate = true
    ;(this.geo.getAttribute('aAlpha') as THREE.BufferAttribute).needsUpdate = true
  }

  /** Current alpha of impostor i (debug). */
  alphaOf(i: number): number { return this.alpha[i] }

  dispose(): void { this.geo.dispose(); this.mat.dispose() }
}
