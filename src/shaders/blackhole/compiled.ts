import definesGlsl    from './defines.glsl?raw'
import mathGlsl       from './math.glsl?raw'
import geodesicsGlsl  from './geodesics.glsl?raw'
import accretionGlsl  from './accretion.glsl?raw'
import backgroundGlsl from './background.glsl?raw'
import planetGlsl     from './planet.glsl?raw'
import jetGlsl        from './jet.glsl?raw'
import traceRayGlsl   from './trace_ray.glsl?raw'
import tonemapGlsl    from './tonemapping.glsl?raw'
import mainGlsl       from './main.glsl?raw'

type MustacheCtx = Record<string, boolean | number | string>

function resolveMustache(template: string, ctx: MustacheCtx): string {
  let result = template
  // Multiple passes to handle nested blocks (cross-flag only, not self-nested)
  for (let pass = 0; pass < 6; pass++) {
    for (const key of Object.keys(ctx)) {
      const isTrue = Boolean(ctx[key])
      const esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      result = result.replace(
        new RegExp(`\\{\\{#${esc}\\}\\}([\\s\\S]*?)\\{\\{\\/${esc}\\}\\}`, 'g'),
        isTrue ? '$1' : '',
      )
      result = result.replace(
        new RegExp(`\\{\\{\\^${esc}\\}\\}([\\s\\S]*?)\\{\\{\\/${esc}\\}\\}`, 'g'),
        isTrue ? '' : '$1',
      )
    }
  }
  // Scalar substitutions: {{n_steps}} → "100", etc.
  for (const key of Object.keys(ctx)) {
    const esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    result = result.replace(new RegExp(`\\{\\{${esc}\\}\\}`, 'g'), String(ctx[key]))
  }
  return result
}

const RAW_GLSL =
  definesGlsl + '\n' +
  mathGlsl + '\n' +
  geodesicsGlsl + '\n' +
  accretionGlsl + '\n' +
  backgroundGlsl + '\n' +
  planetGlsl + '\n' +
  jetGlsl + '\n' +
  traceRayGlsl + '\n' +
  tonemapGlsl + '\n' +
  mainGlsl

// Desktop: optimal quality preset (standard mode, Kerr-inspired velocities)
const DESKTOP_CTX: MustacheCtx = {
  rk4_integration: false,
  cinematic_tonemap: true,
  kerr_full_geodesic: false,
  kerr_fast_mode: false,
  kerr_inspired_mode: true,
  kerr_inspired_velocity: true,
  accretion_thin_disk: true,
  accretion_thick_torus: false,
  accretion_slim_disk: false,
  disk_self_irradiation_enabled: true,
  jet_enabled: true,
  jet_simple: false,
  jet_physical: true,
  grmhd_enabled: true,
  planetEnabled: true,
  lorentz_contraction: true,
  light_travel_time: true,
  gravitational_time_dilation: true,
  aberration: true,
  beaming: true,
  physical_beaming: true,
  doppler_shift: true,
  n_steps: 100,
  sample_count: 1,
  max_revolutions: 2.0,
}

// Mobile: reduced quality (fewer steps, no planet)
const MOBILE_CTX: MustacheCtx = {
  ...DESKTOP_CTX,
  planetEnabled: false,
  n_steps: 64,
  max_revolutions: 1.4,
}

export const FRAGMENT_SHADER_DESKTOP: string = resolveMustache(RAW_GLSL, DESKTOP_CTX)
export const FRAGMENT_SHADER_MOBILE: string  = resolveMustache(RAW_GLSL, MOBILE_CTX)

export const VERTEX_SHADER: string = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 1.0);
}
`
