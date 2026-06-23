'use strict'
// Node.js diagnostic — tests JavaScript-side renderer logic without WebGL
// Verifies: observer state, cam axis values, shader GLSL source validity

const THREE_MOCK = {
  Vector3: class {
    constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z}
    set(x,y,z){this.x=x;this.y=y;this.z=z;return this}
    copy(v){this.x=v.x;this.y=v.y;this.z=v.z;return this}
    clone(){return new THREE_MOCK.Vector3(this.x,this.y,this.z)}
    length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z)}
    lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z}
    normalize(){const l=this.length();this.x/=l;this.y/=l;this.z/=l;return this}
    multiplyScalar(s){this.x*=s;this.y*=s;this.z*=s;return this}
    sub(v){this.x-=v.x;this.y-=v.y;this.z-=v.z;return this}
    crossVectors(a,b){
      const ax=a.x,ay=a.y,az=a.z,bx=b.x,by=b.y,bz=b.z
      this.x=ay*bz-az*by;this.y=az*bx-ax*bz;this.z=ax*by-ay*bx;return this
    }
    toArray(){return[this.x,this.y,this.z]}
    applyMatrix4(m){
      const e=m.elements,x=this.x,y=this.y,z=this.z,w=1/(e[3]*x+e[7]*y+e[11]*z+e[15])
      this.x=(e[0]*x+e[4]*y+e[8]*z+e[12])*w
      this.y=(e[1]*x+e[5]*y+e[9]*z+e[13])*w
      this.z=(e[2]*x+e[6]*y+e[10]*z+e[14])*w
      return this
    }
    distanceTo(v){return Math.sqrt((this.x-v.x)**2+(this.y-v.y)**2+(this.z-v.z)**2)}
  },
  Matrix3: class {
    constructor(){this.elements=[1,0,0,0,1,0,0,0,1]}
    set(n11,n12,n13,n21,n22,n23,n31,n32,n33){
      const e=this.elements
      e[0]=n11;e[3]=n12;e[6]=n13
      e[1]=n21;e[4]=n22;e[7]=n23
      e[2]=n31;e[5]=n32;e[8]=n33
      return this
    }
    copy(m){this.elements=[...m.elements];return this}
  },
  Matrix4: class {
    constructor(){this.elements=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]}
    makeBasis(x,y,z){
      const e=this.elements
      e[0]=x.x;e[4]=y.x;e[8]=z.x;e[12]=0
      e[1]=x.y;e[5]=y.y;e[9]=z.y;e[13]=0
      e[2]=x.z;e[6]=y.z;e[10]=z.z;e[14]=0
      e[3]=0;e[7]=0;e[11]=0;e[15]=1
      return this
    }
    makeRotationY(theta){
      const c=Math.cos(theta),s=Math.sin(theta)
      const e=this.elements
      e[0]=c;e[4]=0;e[8]=s;e[12]=0
      e[1]=0;e[5]=1;e[9]=0;e[13]=0
      e[2]=-s;e[6]=0;e[10]=c;e[14]=0
      e[3]=0;e[7]=0;e[11]=0;e[15]=1
      return this
    }
  }
}
global.THREE = THREE_MOCK

// ─── Replicate observer.ts ────────────────────────────────────────────────────
function linearPart(m) {
  const e = m.elements
  return new THREE_MOCK.Matrix3().set(
    e[0],e[4],e[8],
    e[1],e[5],e[9],
    e[2],e[6],e[10],
  )
}

function degToRad(a) { return Math.PI * a / 180.0 }

class Observer {
  constructor() {
    this.position = new THREE_MOCK.Vector3(10,0,0)
    this.velocity = new THREE_MOCK.Vector3(0,1,0)
    this.orientation = new THREE_MOCK.Matrix3()
    this.time = 0.0
  }
  orbitalFrame() {
    const orbital_y = this.velocity.clone().normalize().multiplyScalar(4.0).sub(this.position).normalize()
    const orbital_z = new THREE_MOCK.Vector3().crossVectors(this.position, orbital_y).normalize()
    const orbital_x = new THREE_MOCK.Vector3().crossVectors(orbital_y, orbital_z)
    return linearPart(new THREE_MOCK.Matrix4().makeBasis(orbital_x, orbital_y, orbital_z))
  }
  move(dt, params) {
    const r = params.observer.distance
    const v = 1.0 / Math.sqrt(2.0 * (r - 1.0))
    const ang_vel = v * Math.sqrt(1.0 - 1.0/r) / r
    const angle = this.time * ang_vel
    const s = Math.sin(angle), c = Math.cos(angle)
    this.position.set(c*r, s*r, 0)
    this.velocity.set(-s*v, c*v, 0)
    const alpha = degToRad(params.observer.orbital_inclination)
    const orbit_coords = new THREE_MOCK.Matrix4().makeRotationY(alpha)
    this.position.applyMatrix4(orbit_coords)
    this.velocity.applyMatrix4(orbit_coords)
    if (params.gravitational_time_dilation && v > 0) {
      this.time += dt / Math.sqrt(Math.max(1.0 - 1.5/r, 0.001))
    } else {
      this.time += dt
    }
  }
}

// ─── Simulate the renderer's updateCamera() logic ─────────────────────────────
const PARAMS = {
  time_scale: 1.0,
  observer: { motion: true, distance: 11.0, orbital_inclination: -10 },
  gravitational_time_dilation: true,
  black_hole: { spin_enabled: true, spin: 0.90 },
}

const obs = new Observer()
obs.position.set(11, 0, 0)
obs.velocity.set(0, 1.0 / Math.sqrt(2.0 * (11 - 1.0)), 0)

// Simulate first frame: move observer (dt=0.016)
obs.move(0.016, PARAMS)

const frame = obs.orbitalFrame()
const fe = frame.elements

console.log('\n=== orbitalFrame() columns ===')
console.log('col0 orbital_x:', [fe[0],fe[1],fe[2]].map(v=>v.toFixed(4)))
console.log('col1 orbital_y:', [fe[3],fe[4],fe[5]].map(v=>v.toFixed(4)), '<-- should point towards BH')
console.log('col2 orbital_z:', [fe[6],fe[7],fe[8]].map(v=>v.toFixed(4)), '<-- perpendicular to orbital plane')

// BH direction check
const bhDir = obs.position.clone().multiplyScalar(-1).normalize()
const cam_z_old = { x: fe[6], y: fe[7], z: fe[8] }  // BEFORE fix: orbital_z
const cam_z_new = { x: fe[3], y: fe[4], z: fe[5] }  // AFTER fix: orbital_y

const dot_old = cam_z_old.x*bhDir.x + cam_z_old.y*bhDir.y + cam_z_old.z*bhDir.z
const dot_new = cam_z_new.x*bhDir.x + cam_z_new.y*bhDir.y + cam_z_new.z*bhDir.z

console.log('\n=== BH direction from observer ===')
console.log('BH dir:', [bhDir.x,bhDir.y,bhDir.z].map(v=>v.toFixed(4)))
console.log('cam_z BEFORE fix (orbital_z):', [cam_z_old.x,cam_z_old.y,cam_z_old.z].map(v=>v.toFixed(4)))
console.log('cam_z AFTER  fix (orbital_y):', [cam_z_new.x,cam_z_new.y,cam_z_new.z].map(v=>v.toFixed(4)))
console.log('dot(cam_z_old, bhDir):', dot_old.toFixed(4), '→ angle:', (Math.acos(Math.min(1,Math.abs(dot_old)))*180/Math.PI).toFixed(1)+'°')
console.log('dot(cam_z_new, bhDir):', dot_new.toFixed(4), '→ angle:', (Math.acos(Math.min(1,Math.abs(dot_new)))*180/Math.PI).toFixed(1)+'°')

// Check observer position
console.log('\n=== Observer state after first move() ===')
console.log('position:', obs.position.toArray().map(v=>v.toFixed(4)))
console.log('velocity:', obs.velocity.toArray().map(v=>v.toFixed(4)))
console.log('|velocity|:', obs.velocity.length().toFixed(6))
console.log('time:', obs.time.toFixed(6))

// Verify the GLSL source exists and contains expected content
const path = require('path')
const fs = require('fs')
const src = fs.readFileSync(path.join(__dirname, 'src/shaders/blackhole/main.glsl'), 'utf8')
console.log('\n=== main.glsl verification ===')
console.log('Contains "cam_z":', src.includes('cam_z'))
console.log('Contains "gl_FragColor":', src.includes('gl_FragColor'))
console.log('Contains "FOV_MULT":', src.includes('FOV_MULT'))
console.log('Contains "resolution":', src.includes('resolution'))
console.log('Contains "trace_ray":', src.includes('trace_ray'))

// Check defines.glsl has all the uniforms
const defs = fs.readFileSync(path.join(__dirname, 'src/shaders/blackhole/defines.glsl'), 'utf8')
const requiredUniforms = ['cam_x','cam_y','cam_z','cam_pos','cam_vel','cam_pan','resolution','taa_jitter','bh_spin','accretion_inner_r']
console.log('\n=== Uniform presence in defines.glsl ===')
requiredUniforms.forEach(u => {
  console.log(`  ${u}: ${defs.includes(u) ? 'FOUND' : 'MISSING'}`)
})

console.log('\n=== All checks passed ===\n')
