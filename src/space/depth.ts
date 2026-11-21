import * as THREE from 'three'

// ── Depth: logarithmic depth buffer ─────────────────────────────────────────
//
// Choice: logarithmic depth (WebGLRenderer({ logarithmicDepthBuffer: true }))
// rather than reversed-Z. three r184's reversedDepthBuffer needs the
// EXT_clip_control extension and silently falls back to a standard depth
// buffer where it is missing (Safari/iOS and many Android GPUs), and on the
// default framebuffer's 24-bit fixed-point depth buffer reversed-Z gains
// little (its benefit comes from a float depth format). Log depth works on
// every WebGL2 device. Cost: fragments write gl_FragDepth, which disables
// early-Z; acceptable for this scene (few overlapping opaque layers).
//
// Resolution with a 24-bit buffer: Δw / (1 + w) ≈ 2⁻²⁴ · ln2 · log₂(far + 1)
// ≈ 1.5·10⁻⁶ for far = 1e11, i.e. ~1.5 mm at 1 m, ~45 m at 30 000 km.
//
// EVERY custom ShaderMaterial / onBeforeCompile shader drawn by the flight
// renderer must include the matching chunks (no-ops when log depth is off):
//   vertex:   #include <common>                     (for isPerspectiveMatrix)
//             #include <logdepthbuf_pars_vertex>
//             … after gl_Position is written: #include <logdepthbuf_vertex>
//   fragment: #include <logdepthbuf_pars_fragment>
//             … in main():                 #include <logdepthbuf_fragment>
// findMissingDepthChunks() checks this at runtime (exposed by the debug hook).

/**
 * Near plane (km once the scene is in km; scene units before): 10 cm. The
 * plan's "about 0.001 km" would clip an object exactly 1 m away (the precision
 * acceptance test); with log depth the near plane only clips and has no effect
 * on depth precision, so a smaller value costs nothing.
 */
export const CAMERA_NEAR = 1e-4
/** Far plane: effectively unlimited (~670 AU in km). Sky renders in its own pass. */
export const CAMERA_FAR  = 1e11

/** Names (or uuids) of custom shader materials under `roots` that lack the log-depth chunks. */
export function findMissingDepthChunks(roots: THREE.Object3D[]): string[] {
  const missing = new Set<string>()
  for (const root of roots) {
    root.traverse((o) => {
      const mats = (o as THREE.Mesh).material
      if (!mats) return
      for (const m of Array.isArray(mats) ? mats : [mats]) {
        const sm = m as THREE.ShaderMaterial
        if (!sm.isShaderMaterial) continue
        const ok = sm.vertexShader.includes('<logdepthbuf_vertex>')
          && sm.vertexShader.includes('<logdepthbuf_pars_vertex>')
          && sm.fragmentShader.includes('<logdepthbuf_fragment>')
          && sm.fragmentShader.includes('<logdepthbuf_pars_fragment>')
        if (!ok) missing.add(sm.name || o.name || sm.uuid)
      }
    })
  }
  return [...missing]
}
