// Dev-only harness for the shared live Earth (see index.html for URL params).
import * as THREE from 'three'
import { createLiveEarth } from '../../src/earth/LiveEarth'
import { createMoonPlacer } from '../../src/earth/moon'
import { latLonToLocal } from '../../src/earth/geo'
import { getSimTimeMs, pause, setSimTime } from '../../src/sim/simClock'

const q      = new URLSearchParams(location.search)
const tParam = q.get('t')
if (tParam) { setSimTime(Date.parse(tParam)); pause() }
const isMobile = q.get('mobile') === '1'

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
renderer.setSize(innerWidth, innerHeight)
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.outputColorSpace    = THREE.SRGBColorSpace
renderer.toneMapping         = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.0
document.body.appendChild(renderer.domElement)

const scene  = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.1, 13000)
scene.add(new THREE.AmbientLight(0x111122, 0.08))
const sun = new THREE.DirectionalLight(0xfff5e0, 3.5)       // same as flight mode
sun.position.set(-4000, 0, 0)
scene.add(sun, sun.target)

const manager = new THREE.LoadingManager()
const loader  = new THREE.TextureLoader(manager)
const info    = document.getElementById('info')!
let status    = 'loading'
const t0      = performance.now()
const timings = { loadingDone: -1, cloudStatus: -1, kind: '' }
;(window as unknown as { __earthTimings: typeof timings }).__earthTimings = timings
const earth   = createLiveEarth(loader, isMobile, {
  sunLight: sun, renderer,
  onCloudStatus: (s) => { status = JSON.stringify(s); timings.cloudStatus = performance.now() - t0; timings.kind = s.kind },
})
scene.add(earth.group)

const moonTex = loader.load(import.meta.env.BASE_URL + 'earth/8k_moon.jpg')
moonTex.colorSpace = THREE.SRGBColorSpace
const moon = new THREE.Mesh(new THREE.SphereGeometry(3, 48, 24), new THREE.MeshPhongMaterial({ map: moonTex, shininess: 5 }))
scene.add(moon)
const moonPlacer = createMoonPlacer(moon, earth.group, 30)

const camDir = new THREE.Vector3()
const north  = new THREE.Vector3()
function placeCamera() {
  const lat  = Number(q.get('lat') ?? 0)
  const lon  = Number(q.get('lon') ?? 0)
  const dist = Number(q.get('dist') ?? 42)
  latLonToLocal(lat, lon, 1, camDir).applyQuaternion(earth.group.quaternion)
  north.set(0, 1, 0).applyQuaternion(earth.group.quaternion)
  camera.position.copy(camDir).multiplyScalar(dist)
  camera.up.copy(north)
  camera.lookAt(0, 0, 0)
}

let ready = false
manager.onLoad = () => { ready = true; if (timings.loadingDone < 0) timings.loadingDone = performance.now() - t0 }
;(window as unknown as { __earthReady: () => boolean }).__earthReady = () => ready && status !== 'loading'

function frame() {
  requestAnimationFrame(frame)
  const ms = getSimTimeMs()
  earth.update(ms)
  moonPlacer.update(ms)
  placeCamera()
  renderer.render(scene, camera)
  info.textContent = `${new Date(ms).toISOString()}  ${status}`
}
frame()

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
})
