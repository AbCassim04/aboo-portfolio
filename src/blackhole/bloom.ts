import * as THREE from 'three'

const PP_VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 1.0);
}`

const THRESHOLD_FS = `
uniform sampler2D tDiffuse;
uniform float threshold;
uniform float softKnee;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(tDiffuse, vUv);
  float br = max(c.r, max(c.g, c.b));
  float knee = threshold * softKnee;
  float soft = br - threshold + knee;
  soft = clamp(soft, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee + 0.00001);
  float contrib = max(soft, br - threshold) / max(br, 0.00001);
  gl_FragColor = vec4(c.rgb * contrib, 1.0);
}`

const BLUR_FS = `
uniform sampler2D tDiffuse;
uniform vec2 direction;
varying vec2 vUv;
void main() {
  vec4 sum = vec4(0.0);
  sum += texture2D(tDiffuse, vUv - 4.0 * direction) * 0.01621622;
  sum += texture2D(tDiffuse, vUv - 3.0 * direction) * 0.05405405;
  sum += texture2D(tDiffuse, vUv - 2.0 * direction) * 0.12162162;
  sum += texture2D(tDiffuse, vUv - 1.0 * direction) * 0.19459459;
  sum += texture2D(tDiffuse, vUv)                   * 0.22702703;
  sum += texture2D(tDiffuse, vUv + 1.0 * direction) * 0.19459459;
  sum += texture2D(tDiffuse, vUv + 2.0 * direction) * 0.12162162;
  sum += texture2D(tDiffuse, vUv + 3.0 * direction) * 0.05405405;
  sum += texture2D(tDiffuse, vUv + 4.0 * direction) * 0.01621622;
  gl_FragColor = sum;
}`

const COPY_FS = `
uniform sampler2D tDiffuse;
varying vec2 vUv;
void main() {
  gl_FragColor = texture2D(tDiffuse, vUv);
}`

const COMPOSITE_FS = `
uniform sampler2D tDiffuse;
uniform sampler2D tBloom0;
uniform sampler2D tBloom1;
uniform sampler2D tBloom2;
uniform sampler2D tBloom3;
uniform sampler2D tBloom4;
uniform float bloomStrength;
uniform float bloomRadius;
varying vec2 vUv;
void main() {
  vec4 orig = texture2D(tDiffuse, vUv);
  float r = bloomRadius;
  float p = 1.2 + 0.8 * r;
  float w0 = 1.0;
  float w1 = 1.0 / pow(2.0, p);
  float w2 = 1.0 / pow(3.0, p);
  float w3 = 1.0 / pow(4.0, p);
  float w4 = 1.0 / pow(5.0, p);
  float wsum = w0 + w1 + w2 + w3 + w4;
  vec4 bloom = (texture2D(tBloom0, vUv) * w0
    + texture2D(tBloom1, vUv) * w1
    + texture2D(tBloom2, vUv) * w2
    + texture2D(tBloom3, vUv) * w3
    + texture2D(tBloom4, vUv) * w4) / wsum;
  gl_FragColor = vec4(orig.rgb + bloom.rgb * bloomStrength, 1.0);
}`

const BLOOM_LEVELS = 5

const RT_PARAMS: THREE.RenderTargetOptions = {
  minFilter: THREE.LinearFilter,
  magFilter: THREE.LinearFilter,
  format: THREE.RGBAFormat,
}

function createTarget(w: number, h: number): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), RT_PARAMS)
}

export interface BloomParams {
  enabled: boolean
  strength: number
  threshold: number
  radius: number
}

export interface BloomPass {
  mainRT: THREE.WebGLRenderTarget
  render(rdr: THREE.WebGLRenderer, mainScene: THREE.Scene, mainCamera: THREE.Camera, params: BloomParams, outputTarget: THREE.WebGLRenderTarget | null): void
  resize(w: number, h: number): void
  dispose(): void
}

export function setupBloom(): BloomPass {
  const ppScene  = new THREE.Scene()
  const ppCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  const ppGeom   = new THREE.PlaneGeometry(2, 2)
  const ppMesh   = new THREE.Mesh(ppGeom)
  ppScene.add(ppMesh)

  const thresholdMat = new THREE.ShaderMaterial({
    uniforms: { tDiffuse: { value: null }, threshold: { value: 0.65 }, softKnee: { value: 0.5 } },
    vertexShader: PP_VERT, fragmentShader: THRESHOLD_FS, depthWrite: false, depthTest: false,
  })
  const blurMat = new THREE.ShaderMaterial({
    uniforms: { tDiffuse: { value: null }, direction: { value: new THREE.Vector2() } },
    vertexShader: PP_VERT, fragmentShader: BLUR_FS, depthWrite: false, depthTest: false,
  })
  const copyMat = new THREE.ShaderMaterial({
    uniforms: { tDiffuse: { value: null } },
    vertexShader: PP_VERT, fragmentShader: COPY_FS, depthWrite: false, depthTest: false,
  })
  const compositeMat = new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: null },
      tBloom0: { value: null }, tBloom1: { value: null }, tBloom2: { value: null },
      tBloom3: { value: null }, tBloom4: { value: null },
      bloomStrength: { value: 0.35 }, bloomRadius: { value: 0.85 },
    },
    vertexShader: PP_VERT, fragmentShader: COMPOSITE_FS, depthWrite: false, depthTest: false,
  })

  function createTargets(w: number, h: number) {
    const mainRT = createTarget(w, h)
    const mips: THREE.WebGLRenderTarget[] = []
    const temps: THREE.WebGLRenderTarget[] = []
    for (let i = 0; i < BLOOM_LEVELS; i++) {
      const mw = Math.max(1, Math.floor(w / Math.pow(2, i + 1)))
      const mh = Math.max(1, Math.floor(h / Math.pow(2, i + 1)))
      mips.push(createTarget(mw, mh))
      temps.push(createTarget(mw, mh))
    }
    return { mainRT, mips, temps }
  }

  let targets = createTargets(1, 1)

  // Helper: render to a WebGLRenderTarget (r184 API)
  function renderTo(rdr: THREE.WebGLRenderer, scene: THREE.Scene, cam: THREE.Camera, target: THREE.WebGLRenderTarget, clear = true): void {
    rdr.setRenderTarget(target)
    if (clear) rdr.clear()
    rdr.render(scene, cam)
    rdr.setRenderTarget(null)
  }

  const pass: BloomPass = {
    get mainRT() { return targets.mainRT },

    render(rdr, mainScene, mainCamera, params, outputTarget) {
      // 1. Render main scene → full-res RT
      renderTo(rdr, mainScene, mainCamera, targets.mainRT, true)

      // 2. Threshold → first mip
      thresholdMat.uniforms['tDiffuse'].value = targets.mainRT.texture
      thresholdMat.uniforms['threshold'].value = params.threshold
      ppMesh.material = thresholdMat
      renderTo(rdr, ppScene, ppCamera, targets.mips[0], true)

      // 3. Progressive downsample + separable blur
      for (let i = 0; i < BLOOM_LEVELS; i++) {
        const mip  = targets.mips[i]
        const tmp  = targets.temps[i]
        const mw   = mip.width
        const mh   = mip.height

        if (i > 0) {
          copyMat.uniforms['tDiffuse'].value = targets.mips[i - 1].texture
          ppMesh.material = copyMat
          renderTo(rdr, ppScene, ppCamera, mip, true)
        }

        blurMat.uniforms['tDiffuse'].value = mip.texture
        blurMat.uniforms['direction'].value.set(1.0 / mw, 0)
        ppMesh.material = blurMat
        renderTo(rdr, ppScene, ppCamera, tmp, true)

        blurMat.uniforms['tDiffuse'].value = tmp.texture
        blurMat.uniforms['direction'].value.set(0, 1.0 / mh)
        renderTo(rdr, ppScene, ppCamera, mip, true)
      }

      // 4. Composite → screen (or outputTarget)
      compositeMat.uniforms['tDiffuse'].value = targets.mainRT.texture
      for (let j = 0; j < BLOOM_LEVELS; j++) {
        compositeMat.uniforms[`tBloom${j}`].value = targets.mips[j].texture
      }
      compositeMat.uniforms['bloomStrength'].value = params.strength
      compositeMat.uniforms['bloomRadius'].value   = params.radius
      ppMesh.material = compositeMat

      if (outputTarget) {
        renderTo(rdr, ppScene, ppCamera, outputTarget, true)
      } else {
        rdr.setRenderTarget(null)
        rdr.render(ppScene, ppCamera)
      }
    },

    resize(w, h) {
      targets.mainRT.dispose()
      for (let i = 0; i < BLOOM_LEVELS; i++) {
        targets.mips[i].dispose()
        targets.temps[i].dispose()
      }
      targets = createTargets(w, h)
    },

    dispose() {
      targets.mainRT.dispose()
      for (let i = 0; i < BLOOM_LEVELS; i++) {
        targets.mips[i].dispose()
        targets.temps[i].dispose()
      }
      ppGeom.dispose()
      thresholdMat.dispose()
      blurMat.dispose()
      copyMat.dispose()
      compositeMat.dispose()
    },
  }

  return pass
}
