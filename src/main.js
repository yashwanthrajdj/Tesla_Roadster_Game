import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { batchScenery, pixelRatioFor, AdaptiveResolution } from './render-budget.js';
import { createVehicleLights } from './vehicle-lights.js';
import { createStreetLighting } from './street-lights.js';
import { createPressureSmoke } from './pressure-smoke.js';
import './style.css';

const CAR_OPTIONS = {
  '2020': { label: 'ROADSTER 2020', type: 'glb', url: '/models/tesla-roadster-2020-driving.glb' },
  '2026': { label: 'ROADSTER 2026', type: 'glb', url: '/models/tesla-roadster-2026.glb' },
  stl: { label: 'ROADSTER STL', type: 'stl', url: '/models/tesla-roadster.stl' },
};
const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);
const FORWARD = new THREE.Vector3(0, 0, -1);
const RIGHT = new THREE.Vector3(1, 0, 0);
const ZERO = new THREE.Vector3();

// Keep the visible course and its collision profile driven by the same values.
// The highway is intentionally flat; its old ramp-only terrain branch was an
// invisible obstacle because the matching mesh is not part of Road 01.
const HIGHWAY_BOUNDS = Object.freeze({ halfWidth: 11.25, minZ: -4890, maxZ: 104 });
const STUNT_BOUNDS = Object.freeze({ halfWidth: 72, minZ: -170, maxZ: 104 });
const STUNT_RAMP = Object.freeze({
  startZ: -55,
  radius: 18,
  width: 14,
  surfaceY: 0.06,
  deckThickness: 0.2,
  // Keep the compact footprint, but preserve the complete curved C profile
  // from the original stunt ramp instead of stopping at the vertical wall.
  endAngle: Math.PI,
  deckLength: 24,
});
const MAX_SURFACE_PENETRATION = 3.2;
const RAMP_CONTACT_MARGIN = 1.4;
const RAMP_EDGE_MARGIN = 0.65;
const GROUND_LOCK_DISTANCE = 0.8;
const GROUND_LANDING_MARGIN = 0.35;
const SUPPORT_EPSILON = 0.006;
const PHYSICS_STEP = 1 / 120;
const SINGLE_SPIN_DURATION = 0.48;
const SINGLE_SPIN_RATE = TAU / SINGLE_SPIN_DURATION;
const THRUSTER_RECHARGE_GROUND = 8;
const THRUSTER_RECHARGE_AIR = 4;

document.querySelector('#app').innerHTML = `
  <main class="game-shell" id="game-shell">
    <canvas id="game-canvas"></canvas>
    <div class="loading-screen" id="loading-screen">
      <div class="loading-mark"><span></span><span></span><span></span></div>
      <p class="eyebrow">THRUST LAB / FLIGHT DECK 01</p>
      <h1>CALIBRATING<br><em>ROADSTER</em></h1>
      <div class="load-track"><span id="load-bar"></span></div>
      <p class="load-status" id="load-status">Warming the simulation...</p>
    </div>
    <div class="hud" id="hud" aria-live="polite">
      <header class="topbar">
        <div class="brand-lockup">
          <div class="brand-symbol"><i></i><i></i><i></i></div>
          <div><strong>ROADSTER</strong><span>THRUST LAB</span></div>
        </div>
        <div class="topbar-center"><span class="status-dot"></span><span id="flight-status">SYSTEMS NOMINAL</span></div>
        <div class="top-actions">
          <button class="icon-button" id="sound-button" title="Toggle thruster audio" aria-label="Toggle thruster audio"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10v4h4l5 4V6l-5 4H4Z"/><path d="M17 9.5a4 4 0 0 1 0 5M19.5 7a7.5 7.5 0 0 1 0 10"/></svg></button>
          <button class="icon-button active" id="headlights-button" title="Headlights on (L)" aria-label="Toggle headlights" aria-pressed="true"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5c8 0 8 14 0 14V5ZM3 6h6M2 10h7M2 14h7M3 18h6"/></svg></button>
          <button class="icon-button quality-button" id="quality-button" title="Rendering quality: Auto" aria-label="Change rendering quality">AUTO</button>
          <button class="icon-button" id="camera-button" title="Switch camera angle" aria-label="Switch camera angle"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7.5h3l1.4-2h7.2l1.4 2H20v11H4v-11Z"/><circle cx="12" cy="13" r="3.2"/><path d="M12 2v3M12 19v3M2 13h3M19 13h3"/></svg></button>
          <button class="icon-button" id="camera-lock-button" title="Lock camera heading" aria-label="Lock camera heading"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/></svg></button>
          <button class="icon-button" id="spiral-button" title="Toggle automatic spiral" aria-label="Toggle automatic spiral"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 8.5a6.5 6.5 0 1 1 1 8.2"/><path d="m5 5 1 3.5L9.5 7"/><path d="M12 8v4l3 2"/></svg></button>
          <button class="icon-button" id="track-button" title="Switch environment" aria-label="Switch environment"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19 8 5l8 3 4-2v14l-4 2-8-3-4 2Z"/><path d="M8 5v14M16 8v14"/></svg></button>
          <button class="icon-button" id="traffic-button" title="Toggle traffic cars" aria-label="Toggle traffic cars"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 16.5 6.6 10h10.8l1.6 6.5"/><path d="M7 10 8.5 6h7L17 10M4 16.5h16v3H4z"/><circle cx="7.5" cy="19.5" r="1.5"/><circle cx="16.5" cy="19.5" r="1.5"/></svg></button>
          <button class="icon-button" id="vacuum-button" title="Toggle vacuum adhesion" aria-label="Toggle vacuum adhesion"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h12M8 4v5l-2 3v5h12v-5l-2-3V4M9 20h6"/><path d="M10 12h4"/></svg></button>
          <button class="icon-button" id="theme-button" title="Switch day/night theme" aria-label="Switch day/night theme"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.2"/><path d="M12 2v3M12 19v3M4.9 4.9 7 7M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1"/></svg></button>
          <button class="icon-button" id="pause-button" title="Pause simulation" aria-label="Pause simulation"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14"/></svg></button>
        </div>
      </header>

      <label class="car-picker glass-panel" for="car-select">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 16.5 6.6 10h10.8l1.6 6.5"/><path d="M7 10 8.5 6h7L17 10M4 16.5h16v3H4z"/><circle cx="7.5" cy="19.5" r="1.5"/><circle cx="16.5" cy="19.5" r="1.5"/></svg>
        <span>CAR MODEL</span>
        <select id="car-select" aria-label="Select car model">
           <option value="2020">ROADSTER 2020</option>
           <option value="2026">ROADSTER 2026</option>
          <option value="stl">ROADSTER STL</option>
        </select>
      </label>

      <label class="camera-picker glass-panel" for="camera-select">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7.5h3l1.4-2h7.2l1.4 2H20v11H4v-11Z"/><circle cx="12" cy="13" r="3.2"/><path d="M12 2v3M12 19v3M2 13h3M19 13h3"/></svg>
        <span>CAMERA</span>
        <select id="camera-select" aria-label="Select camera angle">
          <option value="rear">REAR CHASE</option>
          <option value="front">FRONT</option>
          <option value="left">LEFT SIDE</option>
           <option value="right">RIGHT SIDE</option>
           <option value="action">ACTION ORBIT</option>
           <option value="ramp">RAMP OVERVIEW</option>
           <option value="stunt-side">STUNT SIDE PROFILE</option>
         </select>
      </label>

      <div class="mission-chip">
        <span id="mission-label">READY TO DRIVE</span>
        <div class="mission-progress"><span id="mission-progress"></span></div>
        <span class="chip-metrics">AIR <b id="air-readout">100</b>% <i>·</i> ALT <b id="altitude-readout">0.0</b>M</span>
      </div>

      <div class="center-mark"><span></span><i></i><b></b></div>

      <section class="bottom-hud">
        <div class="glass-panel speed-card">
          <div class="speed-value"><strong id="speed-readout">000</strong><span>KM/H</span></div>
          <div class="speed-meta"><span class="panel-label">GROUND SPEED</span><strong id="speed-state">IDLE</strong><div class="speed-line"><span id="speed-fill"></span></div></div>
        </div>
        <div class="glass-panel accel-card">
          <div class="panel-label"><span>ACCELEROMETER</span><span>G-FORCE</span></div>
          <div class="g-row"><div class="g-readout"><strong id="g-readout">+0.0</strong><span>G</span></div><div class="g-bar"><i id="g-fill"></i><span></span></div></div>
          <div class="axis-legend"><span>BRAKE</span><span id="vertical-readout">V/S +00.0 M/S</span><span>ACCEL</span></div>
        </div>
      </section>
      <div class="toast" id="toast"></div>
      <div class="touch-controls" aria-label="Touch driving controls">
        <button data-drive-key="KeyA" aria-label="Steer left">◀</button>
        <button data-drive-key="KeyW" aria-label="Drive forward">DRIVE</button>
        <button data-drive-key="KeyD" aria-label="Steer right">▶</button>
        <button data-drive-key="Space" aria-label="Lift thrusters">LIFT</button>
        <button data-drive-key="KeyQ" aria-label="Spin left">Q ↶</button>
        <button data-drive-key="KeyS" aria-label="Brake or reverse">BRAKE</button>
        <button data-drive-key="KeyE" aria-label="Spin right">E ↷</button>
        <button data-drive-key="ArrowUp" aria-label="Rear thrust">THRUST</button>
      </div>
    </div>

    <div class="help-overlay" id="help-overlay" aria-hidden="true">
      <div class="help-panel glass-panel">
        <button class="close-button" id="close-help">×</button>
        <p class="eyebrow">FLIGHT DECK / QUICKSTART</p>
        <h2>COMMAND THE<br><em>VECTOR</em></h2>
        <div class="help-grid">
          <div><span class="keycap large">W</span><span class="keycap large">S</span><p><b>DRIVE / REVERSE</b><small>Ground acceleration, braking, and reverse. Release to coast and settle.</small></p></div>
          <div><span class="keycap large">A</span><span class="keycap large">D</span><p><b>STEERING</b><small>Turn the Roadster on the ground. No thrust is used by these keys.</small></p></div>
          <div><span class="keycap large">↑</span><p><b>REAR THRUST</b><small>Fire the integrated rear exhaust bank. Hold Shift for boost.</small></p></div>
          <div><span class="keycap large">↓</span><p><b>BOTTOM LIFT</b><small>Fire the underbody lift bank to jump. Space is the alternate lift control.</small></p></div>
          <div><span class="keycap large">←</span><span class="keycap large">→</span><p><b>YAW ROTATION</b><small>Rotate the Roadster left/right on the ground or in the air. These keys do not barrel-roll the car.</small></p></div>
          <div><span class="keycap large">SPACE</span><p><b>VERTICAL LIFT</b><small>Bottom cold-gas lift jets push against gravity. Watch your air.</small></p></div>
           <div><span class="keycap large">Q</span><span class="keycap large">E</span><p><b>ONE-SHOT AIR SPIN</b><small>Press Q for one complete left spin or E for one complete right spin while airborne.</small></p></div>
          <div><span class="keycap large">Z</span><span class="keycap large">X</span><p><b>SPIRAL CONTROL</b><small>Manual left/right spiral while airborne. Hold lift to keep the arc alive.</small></p></div>
          <div><span class="keycap large">O</span><p><b>AUTO SPIRAL</b><small>Toggle an assisted roll only after you are airborne.</small></p></div>
          <div><span class="keycap large">C</span><p><b>ACTION CAMERA</b><small>Switch chase, cinematic, ramp, and the Track 02 side-profile view.</small></p></div>
          <div><span class="keycap large">V</span><p><b>VACUUM ADHESION</b><small>Stick the Roadster to a ramp or upside-down surface. Press again to release.</small></p></div>
          <div><span class="keycap large">1</span><span class="keycap large">2</span><p><b>ENVIRONMENT</b><small>Road launch or Stunt Vector track mode.</small></p></div>
          <div><span class="keycap large">B</span><p><b>TRAFFIC CARS</b><small>Toggle the decorative traffic vehicles on or off.</small></p></div>
          <div><span class="keycap large">T</span><p><b>THEME SHIFT</b><small>Switch between daylight test range and night show mode.</small></p></div>
          <div><span class="keycap large">L</span><p><b>HEADLIGHTS</b><small>Toggle the white front beams and red running lights. Brake lights remain active.</small></p></div>
          <div><span class="keycap large">R</span><p><b>RESET RUN</b><small>Return to the launch lane and restore the air reserve.</small></p></div>
        </div>
        <div class="physics-note"><span>PHYSICS NOTE</span><p>This is a cold-gas rigid-body simulation: thrust creates force and torque at nozzle positions. The car has gravity, drag, finite air, and a surface-seeking suction fan — never antigravity.</p></div>
        <button class="launch-button" id="close-help-button">RETURN TO FLIGHT DECK <span>↗</span></button>
      </div>
    </div>
    <div class="pause-overlay" id="pause-overlay"><div class="pause-card glass-panel"><span class="pause-icon">Ⅱ</span><p class="eyebrow">SIMULATION PAUSED</p><h2>HOLD<br><em>POSITION</em></h2><p>Press P or the pause button to resume your run.</p><button class="launch-button" id="resume-button">RESUME SIMULATION <span>↗</span></button></div></div>
  </main>
`;

const shell = document.querySelector('#game-shell');
const canvas = document.querySelector('#game-canvas');
const loadingScreen = document.querySelector('#loading-screen');
const loadBar = document.querySelector('#load-bar');
const loadStatus = document.querySelector('#load-status');
const topActions = document.querySelector('.top-actions');
document.querySelector('#hud').append(topActions);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x010204);
// Keep the test range readable in the side/ramp camera. The dark background
// already supplies the night look; distance fog was hiding the ramp and road.
scene.fog = null;

const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 800);
camera.position.set(0, 6, 62);
const sideCamera = new THREE.OrthographicCamera(-72, 72, 42, -42, 0.1, 500);
sideCamera.position.set(90, 21, -12);

const qualityModes = ['auto', 'low', 'balanced', 'high'];
const requestedQuality = new URLSearchParams(window.location.search).get('quality');
let renderQuality = qualityModes.includes(requestedQuality) ? requestedQuality : 'auto';
const adaptiveResolution = new AdaptiveResolution();
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'default' });
renderer.setPixelRatio(pixelRatioFor(window.innerWidth, window.innerHeight, window.devicePixelRatio, renderQuality));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = false;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.35;

const world = new THREE.Group();
scene.add(world);
const environment = new THREE.Group();
world.add(environment);
const trackOneRoot = new THREE.Group();
const trackTwoRoot = new THREE.Group();
const trafficRoot = new THREE.Group();
environment.add(trackOneRoot, trackTwoRoot, trafficRoot);
trackTwoRoot.visible = false;
const vehicleRoot = new THREE.Group();
world.add(vehicleRoot);
const vehicleLights = createVehicleLights(vehicleRoot);
const streetLighting = createStreetLighting(scene);
const airReleaseRoot = new THREE.Group();
world.add(airReleaseRoot);

const hemiLight = new THREE.HemisphereLight(0x73777d, 0x050608, 1.1);
scene.add(hemiLight);
const sunLight = new THREE.DirectionalLight(0xffe7bd, 3.5);
sunLight.position.set(-40, 80, 30);
sunLight.castShadow = false;
sunLight.shadow.mapSize.set(512, 512);
sunLight.shadow.camera.left = -80;
sunLight.shadow.camera.right = 80;
sunLight.shadow.camera.top = 100;
sunLight.shadow.camera.bottom = -120;
sunLight.shadow.bias = -0.0004;
scene.add(sunLight);
const rimLight = new THREE.DirectionalLight(0x969da8, 1.1);
rimLight.position.set(55, 24, -110);
scene.add(rimLight);

const keys = new Set();
const input = { drive: 0, steer: 0, rear: 0, lift: 0, yaw: 0, roll: 0, pitch: 0, spiral: 0, boost: 0 };
let paused = false;
let theme = 'night';
let audioEnabled = true;
let helpOpen = false;
let autoSpiral = false;
let cameraAngle = 'rear';
let activeTrack = 1;
let trafficVisible = false;
let cameraRoll = 0;
let vacuumEnabled = false;
let cameraSteerLock = false;

const physics = {
  mass: 1980,
  position: new THREE.Vector3(0, 1.25, 46),
  velocity: new THREE.Vector3(),
  quaternion: new THREE.Quaternion(),
  angularVelocity: new THREE.Vector3(),
  air: 100,
  energy: 100,
  temperature: 29,
  launchPeak: 0,
  airborneTime: 0,
  wheelContact: true,
  lastVerticalSpeed: 0,
  landed: false,
  landingAssist: 0,
  rampArc: 'lower',
  rampTheta: 0,
  spinActive: false,
  spinDirection: 0,
  spinAngle: 0,
};

const effects = {
  rear: [],
  lift: [],
  rcs: [],
  air: [],
  dust: [],
  trail: [],
};

const loader = new GLTFLoader();
const stlLoader = new STLLoader();
let activeModel = null;
let carLoadToken = 0;
let activeCar = '2020';
let vehicleSupportOffset = 0.72;
const vehicleSupportCorners = [];
const clock = new THREE.Clock();
const tmp = {
  forward: new THREE.Vector3(),
  flatForward: new THREE.Vector3(),
  flatRight: new THREE.Vector3(),
  lateralVelocity: new THREE.Vector3(),
  up: new THREE.Vector3(),
  right: new THREE.Vector3(),
  force: new THREE.Vector3(),
  torque: new THREE.Vector3(),
  worldPoint: new THREE.Vector3(),
  cameraTarget: new THREE.Vector3(),
  cameraPosition: new THREE.Vector3(),
  desiredQuaternion: new THREE.Quaternion(),
  steerDelta: new THREE.Quaternion(),
  surfaceNormal: new THREE.Vector3(),
  surfaceTangent: new THREE.Vector3(),
  previousPosition: new THREE.Vector3(),
  previousSurfaceDelta: new THREE.Vector3(),
  spinAxis: new THREE.Vector3(),
  spinDelta: new THREE.Quaternion(),
  supportCorner: new THREE.Vector3(),
};

function createMaterial(hex, options = {}) {
  return new THREE.MeshStandardMaterial({ color: hex, roughness: 0.68, metalness: 0.18, ...options });
}

function addBox(parent, size, position, material, options = {}) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.position.set(...position);
  if (options.rotation) mesh.rotation.set(...options.rotation);
  mesh.castShadow = options.castShadow ?? true;
  mesh.receiveShadow = options.receiveShadow ?? true;
  parent.add(mesh);
  return mesh;
}

function addCylinder(parent, radius, height, position, material, options = {}) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, options.segments ?? 12), material);
  mesh.position.set(...position);
  if (options.rotation) mesh.rotation.set(...options.rotation);
  mesh.castShadow = options.castShadow ?? true;
  mesh.receiveShadow = options.receiveShadow ?? true;
  parent.add(mesh);
  return mesh;
}

function createRoad(parent = trackOneRoot) {
  const roadMat = createMaterial(0x17191d, { roughness: 0.94, metalness: 0.03 });
  const shoulderMat = createMaterial(0x292b2c, { roughness: 0.97 });
  const laneMat = createMaterial(0xe7e3d7, { emissive: 0x5e5546, emissiveIntensity: 0.12, roughness: 0.55 });
  const medianMat = createMaterial(0xd6a94f, { emissive: 0x7f4e16, emissiveIntensity: 0.35, roughness: 0.48 });
  const edgeMat = createMaterial(0xf0ead9, { emissive: 0x5d5549, emissiveIntensity: 0.16, roughness: 0.5 });

  // Road 01 is a proper four-lane highway: three dashed separators divide
  // four six-metre lanes, with a warm double centre line and bright edge
  // markings instead of the old neon-red/blue guide strips.
  addBox(parent, [24, 0.16, 5000], [0, -0.12, -2400], roadMat, { receiveShadow: true });
  addBox(parent, [5.5, 0.08, 5000], [-14.75, -0.1, -2400], shoulderMat);
  addBox(parent, [5.5, 0.08, 5000], [14.75, -0.1, -2400], shoulderMat);

  for (let z = 108; z > -4900; z -= 12) {
    for (const x of [-6, 6]) addBox(parent, [0.14, 0.025, 5.2], [x, 0.01, z], laneMat, { castShadow: false, receiveShadow: false });
    addBox(parent, [0.12, 0.025, 5.2], [-0.23, 0.012, z], medianMat, { castShadow: false, receiveShadow: false });
    addBox(parent, [0.12, 0.025, 5.2], [0.23, 0.012, z], medianMat, { castShadow: false, receiveShadow: false });
  }
  for (const x of [-11.7, 11.7]) addBox(parent, [0.18, 0.035, 5000], [x, 0.02, -2400], edgeMat, { castShadow: false, receiveShadow: false });
  addBox(parent, [90, 0.12, 5000], [0, -0.3, -2400], createMaterial(0x0b0c0e, { roughness: 1 }), { receiveShadow: true, castShadow: false });

  const startPadMat = createMaterial(0x292d31, { emissive: 0x090b0d, emissiveIntensity: 0.32, metalness: 0.45 });
  addBox(parent, [24, 0.08, 38], [0, 0.02, 56], startPadMat, { castShadow: false });
  for (let i = 0; i < 8; i += 1) {
    addBox(parent, [0.12, 0.05, 1.8], [-9.1 + i * 2.6, 0.09, 56], i === 4 ? medianMat : edgeMat, { castShadow: false });
  }
}

function createRamp(parent = trackOneRoot) {
  const startZ = -72;
  const radius = 27;
  const width = 15.4;
  const samples = 28;
  const vertices = [];
  const uvs = [];
  const indices = [];
  for (let i = 0; i <= samples; i += 1) {
    const theta = (i / samples) * Math.PI * 0.5;
    const y = radius * (1 - Math.cos(theta));
    const z = startZ - radius * Math.sin(theta);
    for (const x of [-width / 2, width / 2]) {
      vertices.push(x, y + 0.03, z);
      uvs.push(x / width + 0.5, i / samples);
    }
  }
  for (let i = 0; i < samples; i += 1) {
    const a = i * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const rampMat = createMaterial(0x333946, { roughness: 0.72, metalness: 0.28 });
  const ramp = new THREE.Mesh(geometry, rampMat);
  ramp.receiveShadow = true;
  ramp.castShadow = true;
  parent.add(ramp);

  const edgeMat = createMaterial(0xff4258, { emissive: 0xff102f, emissiveIntensity: 5, metalness: 0.2 });
  const edgeMat2 = createMaterial(0x55dcff, { emissive: 0x1591d8, emissiveIntensity: 5, metalness: 0.2 });
  for (const side of [-1, 1]) {
    const points = [];
    for (let i = 0; i <= samples; i += 1) {
      const theta = (i / samples) * Math.PI * 0.5;
      points.push(new THREE.Vector3(side * (width / 2 + 0.22), radius * (1 - Math.cos(theta)) + 0.2, startZ - radius * Math.sin(theta)));
    }
    const curve = new THREE.CatmullRomCurve3(points);
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 56, 0.09, 8, false), side < 0 ? edgeMat : edgeMat2);
    tube.castShadow = false;
    parent.add(tube);
  }
  for (let i = 0; i < 9; i += 1) {
    const theta = (i / 8) * Math.PI * 0.5;
    const y = radius * (1 - Math.cos(theta));
    const z = startZ - radius * Math.sin(theta);
    addBox(parent, [20, 0.24, 0.22], [0, y - 0.14, z], createMaterial(0x18212d, { metalness: 0.5 }), { rotation: [theta, 0, 0] });
  }

  const scaffoldMat = createMaterial(0x202838, { metalness: 0.72, roughness: 0.32 });
  for (const x of [-10.3, 10.3]) {
    addBox(parent, [0.32, 54, 0.32], [x, 13, startZ - 17], scaffoldMat);
    for (let y = 3; y < 54; y += 5) addBox(parent, [21, 0.12, 0.12], [0, y, startZ - 17], scaffoldMat, { castShadow: false });
  }
  addBox(parent, [23, 0.24, 0.24], [0, 54, startZ - 17], edgeMat2, { castShadow: false });
  const rampLabel = createLabel('VERTICAL VECTOR', 0xff6074);
  rampLabel.position.set(-11.1, 29, -99);
  rampLabel.rotation.y = Math.PI / 2;
  parent.add(rampLabel);
}

function createTrackRamp(parent, { startZ, endZ, startHeight = 0, endHeight = 3.8, width = 14, label = 'KICKER' }) {
  const samples = 18;
  const vertices = [];
  const indices = [];
  const length = Math.abs(startZ - endZ);
  for (let i = 0; i <= samples; i += 1) {
    const t = i / samples;
    const eased = t * t * (3 - 2 * t);
    const z = THREE.MathUtils.lerp(startZ, endZ, t);
    const y = THREE.MathUtils.lerp(startHeight, endHeight, eased);
    vertices.push(-width / 2, y, z, width / 2, y, z);
  }
  for (let i = 0; i < samples; i += 1) {
    const a = i * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const rampMat = createMaterial(0x343b4a, { metalness: 0.35, roughness: 0.7 });
  const ramp = new THREE.Mesh(geometry, rampMat);
  ramp.castShadow = true;
  ramp.receiveShadow = true;
  parent.add(ramp);

  const railRed = createMaterial(0xff4665, { emissive: 0xff1537, emissiveIntensity: 4.5 });
  const railCyan = createMaterial(0x5be7ff, { emissive: 0x1599d4, emissiveIntensity: 4.5 });
  for (const side of [-1, 1]) {
    const points = [];
    for (let i = 0; i <= samples; i += 1) {
      const t = i / samples;
      const eased = t * t * (3 - 2 * t);
      points.push(new THREE.Vector3(side * (width / 2 + 0.18), THREE.MathUtils.lerp(startHeight, endHeight, eased) + 0.17, THREE.MathUtils.lerp(startZ, endZ, t)));
    }
    const curve = new THREE.CatmullRomCurve3(points);
    const rail = new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.08, 8, false), side < 0 ? railRed : railCyan);
    parent.add(rail);
  }
  for (let i = 2; i < samples; i += 3) {
    const t = i / samples;
    const eased = t * t * (3 - 2 * t);
    addBox(parent, [width + 0.4, 0.14, 0.16], [0, THREE.MathUtils.lerp(startHeight, endHeight, eased) - 0.1, THREE.MathUtils.lerp(startZ, endZ, t)], createMaterial(0x1b2432, { metalness: 0.5 }), { castShadow: false });
  }
  const marker = createLabel(label, 0xffd16a);
  marker.position.set(-width * 0.58, Math.max(startHeight, endHeight) + 1.5, (startZ + endZ) / 2);
  marker.scale.set(7, 1.75, 1);
  parent.add(marker);
}

function createLandingPad(parent, { z, height, length = 14, width = 12, label }) {
  const deckMat = createMaterial(0x283443, { metalness: 0.48, roughness: 0.55, emissive: 0x061522, emissiveIntensity: 0.4 });
  const edgeRed = createMaterial(0xff4b64, { emissive: 0xff1838, emissiveIntensity: 4 });
  const edgeCyan = createMaterial(0x57e4ff, { emissive: 0x158fca, emissiveIntensity: 4 });
  addBox(parent, [width, 0.3, length], [0, height - 0.15, z], deckMat);
  addBox(parent, [0.14, 0.09, length], [-width / 2 + 0.1, height + 0.03, z], edgeRed, { castShadow: false });
  addBox(parent, [0.14, 0.09, length], [width / 2 - 0.1, height + 0.03, z], edgeCyan, { castShadow: false });
  for (let i = -2; i <= 2; i += 1) addBox(parent, [0.18, 0.05, 2.8], [i * 1.2, height + 0.04, z], i === 0 ? edgeCyan : edgeRed, { castShadow: false });
  const padLabel = createLabel(label, 0x9be9ff);
  padLabel.position.set(width * 0.62, height + 1.5, z);
  padLabel.scale.set(5.5, 1.35, 1);
  padLabel.rotation.y = Math.PI / 2;
  parent.add(padLabel);
}

function createHalfPipe(parent, { xOffset = 0, startZ = -94, endZ = -128, radius = 7.4, labelText = 'HALF-PIPE // BANK CONTROL' } = {}) {
  const xSamples = 18;
  const zSamples = 14;
  const vertices = [];
  const indices = [];
  for (let zIndex = 0; zIndex <= zSamples; zIndex += 1) {
    const z = THREE.MathUtils.lerp(startZ, endZ, zIndex / zSamples);
    for (let xIndex = 0; xIndex <= xSamples; xIndex += 1) {
      const x = xOffset + THREE.MathUtils.lerp(-radius, radius, xIndex / xSamples);
      const y = radius - Math.sqrt(Math.max(0.01, radius * radius - x * x));
      vertices.push(x, y + 0.03, z);
    }
  }
  for (let zIndex = 0; zIndex < zSamples; zIndex += 1) {
    for (let xIndex = 0; xIndex < xSamples; xIndex += 1) {
      const row = xSamples + 1;
      const a = zIndex * row + xIndex;
      indices.push(a, a + 1, a + row, a + 1, a + row + 1, a + row);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, createMaterial(0x303846, { metalness: 0.34, roughness: 0.76 }));
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  parent.add(mesh);
  const red = createMaterial(0xff4b64, { emissive: 0xff143b, emissiveIntensity: 4.5 });
  const cyan = createMaterial(0x57e4ff, { emissive: 0x158fca, emissiveIntensity: 4.5 });
  for (const side of [-1, 1]) {
    const curve = new THREE.LineCurve3(new THREE.Vector3(xOffset + side * radius, radius + 0.2, startZ), new THREE.Vector3(xOffset + side * radius, radius + 0.2, endZ));
    parent.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.1, 8, false), side < 0 ? red : cyan));
  }
  const label = createLabel(labelText, 0xffd16a);
  label.position.set(xOffset - radius - 1.6, radius + 1.8, (startZ + endZ) / 2);
  label.scale.set(7.5, 1.9, 1);
  parent.add(label);
}

function createTrackTwo() {
  const roadMat = createMaterial(0x1a222e, { roughness: 0.88, metalness: 0.05 });
  const stripeMat = createMaterial(0xeff9f5, { emissive: 0x52676b, emissiveIntensity: 0.25 });
  const red = createMaterial(0xff4b64, { emissive: 0xff143b, emissiveIntensity: 4.5 });
  const cyan = createMaterial(0x57e4ff, { emissive: 0x158fca, emissiveIntensity: 4.5 });
  const ground = createMaterial(0x161d25, { roughness: 0.98, metalness: 0.02 });
  const { startZ, radius: rampRadius, width: rampWidth, surfaceY, deckThickness, endAngle, deckLength } = STUNT_RAMP;
  const rampEndZ = startZ - rampRadius * Math.sin(endAngle);
  const rampEndHeight = surfaceY + rampRadius * (1 - Math.cos(endAngle));
  addBox(trackTwoRoot, [1400, 0.16, 1400], [0, -0.12, -180], ground, { castShadow: false, receiveShadow: true });
  addBox(trackTwoRoot, [20, 0.16, 150], [0, -0.02, 20], roadMat, { castShadow: false });
  for (let z = 82; z > -48; z -= 11) addBox(trackTwoRoot, [0.18, 0.03, 4.4], [0, 0.08, z], stripeMat, { castShadow: false });
  addTrackEdgeRails(trackTwoRoot, 95, startZ, 10, red, cyan);
  createCurvedRamp(trackTwoRoot, { startZ, radius: rampRadius, width: rampWidth, red, cyan, endAngle });
  addBox(trackTwoRoot, [rampWidth, deckThickness, deckLength], [0, rampEndHeight - deckThickness / 2, rampEndZ + deckLength / 2], roadMat, { castShadow: false });
  const label = createLabel('VERTICAL VECTOR // VACUUM RAMP', 0xffd16a);
  label.position.set(-10, rampEndHeight + 4, rampEndZ + deckLength / 2);
  label.scale.set(8, 1.9, 1);
  trackTwoRoot.add(label);
  const supportMat = createMaterial(0x26313d, { metalness: 0.78, roughness: 0.3 });
  const supportHeight = rampEndHeight + 5;
  for (const x of [-(rampWidth / 2 + 2.2), rampWidth / 2 + 2.2]) {
    addBox(trackTwoRoot, [0.35, supportHeight, 0.35], [x, supportHeight / 2, startZ - rampRadius * 0.5], supportMat);
    for (let y = 4; y < supportHeight; y += 4.5) addBox(trackTwoRoot, [rampWidth + 5, 0.12, 0.12], [0, y, startZ - rampRadius * 0.5], supportMat, { castShadow: false });
  }
  createSingleRampLights(trackTwoRoot, red, cyan);
}

function createCurvedRamp(parent, { startZ, radius, width, red, cyan, endAngle = Math.PI, surfaceY = STUNT_RAMP.surfaceY }) {
  const samples = 40;
  const vertices = [];
  const indices = [];
  for (let i = 0; i <= samples; i += 1) {
    const theta = (i / samples) * endAngle;
    const y = surfaceY + radius * (1 - Math.cos(theta));
    const z = startZ - radius * Math.sin(theta);
    vertices.push(-width / 2, y, z, width / 2, y, z);
    if (i < samples) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const ramp = new THREE.Mesh(geometry, createMaterial(0x303945, { roughness: 0.66, metalness: 0.3 }));
  ramp.castShadow = true;
  ramp.receiveShadow = true;
  parent.add(ramp);
  for (const side of [-1, 1]) {
    const points = [];
    for (let i = 0; i <= samples; i += 1) {
      const theta = (i / samples) * endAngle;
      points.push(new THREE.Vector3(side * (width / 2 + 0.18), surfaceY + radius * (1 - Math.cos(theta)) + 0.22, startZ - radius * Math.sin(theta)));
    }
    parent.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 80, 0.1, 8, false), side < 0 ? red : cyan));
  }
  for (let i = 3; i < samples; i += 4) {
    const theta = (i / samples) * endAngle;
    addBox(parent, [width + 0.5, 0.13, 0.16], [0, surfaceY + radius * (1 - Math.cos(theta)) - 0.08, startZ - radius * Math.sin(theta)], createMaterial(0x1e2936, { metalness: 0.52 }), { rotation: [theta, 0, 0], castShadow: false });
  }
}

function createSingleRampLights(parent, red, cyan) {
  const pole = createMaterial(0x273442, { metalness: 0.8, roughness: 0.25 });
  for (let z = 85; z > -90; z -= 16) {
    for (const x of [-14, 14]) {
      addCylinder(parent, 0.08, 6, [x, 3, z], pole, { segments: 8, castShadow: false });
      addBox(parent, [1.8, 0.12, 0.12], [x + (x > 0 ? -0.8 : 0.8), 6, z], pole, { castShadow: false });
      addBox(parent, [0.35, 0.13, 0.2], [x + (x > 0 ? -1.65 : 1.65), 5.95, z], x > 0 ? cyan : red, { castShadow: false, receiveShadow: false });
      streetLighting.register(2, x + (x > 0 ? -1.65 : 1.65), 5.85, z);
    }
  }
}

function createOpenStuntArena(parent) {
  const roadMat = createMaterial(0x242d38, { roughness: 0.86, metalness: 0.08 });
  const hubMat = createMaterial(0x303a47, { roughness: 0.74, metalness: 0.18, emissive: 0x081523, emissiveIntensity: 0.45 });
  const red = createMaterial(0xff4c68, { emissive: 0xff1639, emissiveIntensity: 5 });
  const cyan = createMaterial(0x5ae7ff, { emissive: 0x1598d2, emissiveIntensity: 5 });
  const yellow = createMaterial(0xffc84f, { emissive: 0xa25d0c, emissiveIntensity: 3 });
  const white = createMaterial(0xf4f9ff, { emissive: 0x485a65, emissiveIntensity: 0.3 });

  addCylinder(parent, 30, 0.22, [0, -0.02, 20], hubMat, { segments: 64, rotation: [0, 0, 0], castShadow: false });
  addBox(parent, [22, 0.12, 42], [0, 0.06, 41], roadMat, { castShadow: false });
  addArenaRoad(parent, [-70, 48], [70, 48], 9, red, cyan);
  addArenaRoad(parent, [70, 48], [70, -230], 9, cyan, red);
  addArenaRoad(parent, [70, -230], [-70, -230], 9, red, cyan);
  addArenaRoad(parent, [-70, -230], [-70, 48], 9, cyan, red);
  addArenaRoad(parent, [-70, 8], [70, 8], 8, cyan, red);
  addArenaRoad(parent, [-70, -96], [70, -96], 8, red, cyan);
  addArenaRoad(parent, [0, 20], [-40, -24], 8, red, cyan);
  addArenaRoad(parent, [0, 20], [40, -24], 8, cyan, red);
  addArenaRoad(parent, [0, 20], [0, -105], 9, red, cyan);
  addArenaRoad(parent, [0, 20], [-40, -112], 8, cyan, red);
  addArenaRoad(parent, [0, 20], [40, -112], 8, red, cyan);

  createLoop(parent, { x: -40, z: -24, radius: 14, width: 7, red, cyan });
  createLoop(parent, { x: 40, z: -24, radius: 14, width: 7, red: cyan, cyan: red });
  createWallRamp(parent, { x: 0, startZ: -38, radius: 20, width: 12, red, cyan });
  createHalfPipe(parent, { xOffset: 0, startZ: -67, endZ: -108, radius: 9, labelText: 'VERTICAL RAMP // ROUTE B' });
  createWallRamp(parent, { x: 40, startZ: -58, radius: 24, width: 9, red, cyan });
  createHalfPipe(parent, { xOffset: -40, startZ: -93, endZ: -143, radius: 10.5, labelText: 'HALF-PIPE // ROUTE C' });
  createWedgeField(parent, { z: -78, xs: [-27, 0, 27], red, cyan, yellow, white });
  createWedgeField(parent, { z: -164, xs: [-42, -21, 0, 21, 42], red, cyan, yellow, white });
  createLandingPadAt(parent, { x: 0, z: -205, width: 34, length: 22, height: 0.2, label: 'OPEN LANDING // ROUTE D', red, cyan });

  const startLabel = createLabel('STUNT PARK // OPEN GRID', 0x9be9ff);
  startLabel.position.set(0, 2.1, 18);
  startLabel.scale.set(9, 2.2, 1);
  parent.add(startLabel);
  createArenaMarkers(parent, red, cyan, yellow, white);
}

function addArenaRoad(parent, start, end, width, red, cyan) {
  const dx = end[0] - start[0];
  const dz = end[1] - start[1];
  const length = Math.hypot(dx, dz);
  const angle = Math.atan2(dx, dz);
  const roadMat = createMaterial(0x202a36, { roughness: 0.88, metalness: 0.06 });
  const center = [(start[0] + end[0]) / 2, -0.02, (start[1] + end[1]) / 2];
  addBox(parent, [width, 0.14, length], center, roadMat, { rotation: [0, angle, 0], castShadow: false });
  for (const side of [-1, 1]) {
    const edgeOffsetX = Math.cos(angle) * side * (width / 2 + 0.12);
    const edgeOffsetZ = -Math.sin(angle) * side * (width / 2 + 0.12);
    addBox(parent, [0.14, 0.08, length], [center[0] + edgeOffsetX, 0.08, center[2] + edgeOffsetZ], side < 0 ? red : cyan, { rotation: [0, angle, 0], castShadow: false });
  }
  for (let i = 1; i < 7; i += 1) {
    const t = i / 7;
    addBox(parent, [0.18, 0.05, 2.2], [THREE.MathUtils.lerp(start[0], end[0], t), 0.08, THREE.MathUtils.lerp(start[1], end[1], t)], i % 2 ? red : cyan, { rotation: [0, angle, 0], castShadow: false });
  }
}

function createWedgeField(parent, { z, xs, red, cyan, yellow, white }) {
  xs.forEach((x, index) => {
    const height = index === 2 ? 8 : index % 2 ? 4.5 : 3.2;
    const width = index === 2 ? 11 : 8;
    const material = createMaterial(index % 2 ? 0x4b4036 : 0x353d49, { roughness: 0.72, metalness: 0.22 });
    const rampVertices = [];
    const rampIndices = [];
    const rampSamples = 16;
    for (let sample = 0; sample <= rampSamples; sample += 1) {
      const t = sample / rampSamples;
      const eased = t * t * (3 - 2 * t);
      const rampZ = z + 5 - t * 10;
      const rampY = 0.2 + eased * (height - 0.2);
      rampVertices.push(x - width / 2, rampY, rampZ, x + width / 2, rampY, rampZ);
    }
    for (let sample = 0; sample < rampSamples; sample += 1) {
      const a = sample * 2;
      rampIndices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(rampVertices, 3));
    geometry.setIndex(rampIndices);
    geometry.computeVertexNormals();
    const ramp = new THREE.Mesh(geometry, material);
    ramp.castShadow = true;
    ramp.receiveShadow = true;
    parent.add(ramp);
    addBox(parent, [width + 0.35, 0.11, 10.2], [x, 0.05, z], index % 2 ? red : cyan, { castShadow: false });
    for (let stripe = -1; stripe <= 1; stripe += 1) addBox(parent, [0.17, 0.05, 1.6], [x + stripe * Math.min(2.6, width * 0.25), height * 0.35, z - 4.8], stripe === 0 ? yellow : white, { castShadow: false });
    const label = createLabel(index === 2 ? 'VERTICAL KICKER' : `JUMP ${String(index + 1).padStart(2, '0')}`, 0xffd16a);
    label.position.set(x, height + 1.4, z);
    label.scale.set(4.5, 1.1, 1);
    parent.add(label);
  });
}

function createLandingPadAt(parent, { x, z, width, length, height, label, red, cyan }) {
  const pad = createMaterial(0x2d3947, { roughness: 0.65, metalness: 0.25 });
  addBox(parent, [width, 0.3, length], [x, height - 0.15, z], pad);
  addBox(parent, [0.16, 0.08, length], [x - width / 2, height + 0.04, z], red, { castShadow: false });
  addBox(parent, [0.16, 0.08, length], [x + width / 2, height + 0.04, z], cyan, { castShadow: false });
  for (let i = -3; i <= 3; i += 1) addBox(parent, [0.16, 0.05, 2.6], [x + i * 2.1, height + 0.04, z], i % 2 ? red : cyan, { castShadow: false });
  const marker = createLabel(label, 0x9be9ff);
  marker.position.set(x, height + 1.7, z);
  marker.scale.set(7, 1.6, 1);
  parent.add(marker);
}

function createArenaMarkers(parent, red, cyan, yellow, white) {
  const pole = createMaterial(0x25313c, { metalness: 0.82, roughness: 0.24 });
  for (let z = 35; z > -215; z -= 16) {
    for (const x of [-66, 66]) {
      addCylinder(parent, 0.08, 5.5, [x, 2.75, z], pole, { segments: 8, castShadow: false });
      addBox(parent, [1.7, 0.1, 0.18], [x + (x > 0 ? -0.75 : 0.75), 5.45, z], pole, { castShadow: false });
      addBox(parent, [0.34, 0.14, 0.2], [x + (x > 0 ? -1.65 : 1.65), 5.4, z], z % 32 === 0 ? yellow : x > 0 ? cyan : red, { castShadow: false, receiveShadow: false });
    }
  }
  for (let x = -55; x <= 55; x += 11) addBox(parent, [0.16, 0.05, 1.2], [x, 0.09, -6], x % 22 === 0 ? white : yellow, { castShadow: false });
}

function createStuntRoutes(parent) {
  const parkGround = createMaterial(0x111820, { roughness: 0.98, metalness: 0.02 });
  const routeRoad = createMaterial(0x222b37, { roughness: 0.86, metalness: 0.08 });
  const yellow = createMaterial(0xffc84f, { emissive: 0x9d5d0a, emissiveIntensity: 2.8 });
  const white = createMaterial(0xf1f8ff, { emissive: 0x45535b, emissiveIntensity: 0.25 });
  const cyan = createMaterial(0x58e6ff, { emissive: 0x1494cb, emissiveIntensity: 4.8 });
  const red = createMaterial(0xff4a67, { emissive: 0xff1639, emissiveIntensity: 4.8 });
  // Broad arena slab: the playable ground continues well beyond the visible
  // routes so the stunt park reads as an open test facility, not a boxed lane.
  addBox(parent, [1600, 0.16, 1600], [0, -0.12, -120], parkGround, { castShadow: false, receiveShadow: true });
  addBox(parent, [4.4, 0.16, 72], [-6.2, -0.1, -37], routeRoad);
  addBox(parent, [4.4, 0.16, 72], [6.2, -0.1, -37], routeRoad);
  for (const x of [-6.2, 6.2]) {
    addBox(parent, [0.1, 0.07, 72], [x - 2.1, 0.02, -37], x < 0 ? red : cyan, { castShadow: false });
    addBox(parent, [0.1, 0.07, 72], [x + 2.1, 0.02, -37], x < 0 ? cyan : red, { castShadow: false });
  }
  createLoop(parent, { x: -6.2, z: -69, radius: 8.2, width: 4.1, red, cyan });
  createWallRamp(parent, { x: 6.2, startZ: -47, radius: 18, width: 4.5, red, cyan });
  createRouteSign(parent, -6.2, -7, 'LOOP RUN // ROUTE A', red, cyan);
  createRouteSign(parent, 6.2, -7, 'WALL RIDE // ROUTE B', cyan, red);
  for (let z = 54; z > -196; z -= 11) {
    const routeX = z > -7 ? 0 : z > -45 ? (Math.floor(Math.abs(z) / 11) % 2 === 0 ? -6.2 : 6.2) : 0;
    addBox(parent, [0.32, 0.045, 1.45], [routeX, 0.08, z], yellow, { castShadow: false, receiveShadow: false });
    if (z < -7) addBox(parent, [0.1, 0.06, 1.1], [routeX - 1.8, 0.08, z], white, { castShadow: false, receiveShadow: false });
  }
  createTrackLightRig(parent, cyan, red, yellow);
}

function createLoop(parent, { x, z, radius, width, red, cyan }) {
  const points = [];
  for (let i = 0; i <= 96; i += 1) {
    const theta = (i / 96) * Math.PI * 2;
    points.push(new THREE.Vector3(x, radius + 1.1 - radius * Math.cos(theta), z - radius * Math.sin(theta)));
  }
  const curve = new THREE.CatmullRomCurve3(points);
  const surfaceVertices = [];
  const surfaceIndices = [];
  for (let i = 0; i < points.length; i += 1) {
    const point = points[i];
    surfaceVertices.push(point.x - width * 0.5, point.y, point.z, point.x + width * 0.5, point.y, point.z);
    if (i < points.length - 1) {
      const a = i * 2;
      surfaceIndices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const surfaceGeometry = new THREE.BufferGeometry();
  surfaceGeometry.setAttribute('position', new THREE.Float32BufferAttribute(surfaceVertices, 3));
  surfaceGeometry.setIndex(surfaceIndices);
  surfaceGeometry.computeVertexNormals();
  const loopSurface = new THREE.Mesh(surfaceGeometry, createMaterial(0x303946, { roughness: 0.7, metalness: 0.2 }));
  loopSurface.castShadow = true;
  loopSurface.receiveShadow = true;
  parent.add(loopSurface);
  for (const side of [-1, 1]) {
    const sidePoints = points.map((point) => new THREE.Vector3(point.x + side * width * 0.5, point.y, point.z));
    const sideCurve = new THREE.CatmullRomCurve3(sidePoints);
    parent.add(new THREE.Mesh(new THREE.TubeGeometry(sideCurve, 96, 0.12, 8, false), side < 0 ? red : cyan));
  }
  const loopSupport = createMaterial(0x26313d, { metalness: 0.75, roughness: 0.32 });
  for (const theta of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
    const y = radius + 1.1 - radius * Math.cos(theta);
    const zPoint = z - radius * Math.sin(theta);
    addBox(parent, [0.3, 0.3, 0.3], [x, y, zPoint], loopSupport, { castShadow: false });
    addBox(parent, [width + 1, 0.12, 0.12], [x, y, zPoint], loopSupport, { rotation: [0, theta, 0], castShadow: false });
  }
  const label = createLabel('LOOP // 360°', 0xffcf59);
  label.position.set(x - 5, radius * 2 + 3, z);
  label.scale.set(4.5, 1.15, 1);
  parent.add(label);
}

function createWallRamp(parent, { x, startZ, radius, width, red, cyan }) {
  const points = [];
  const samples = 26;
  for (let i = 0; i <= samples; i += 1) {
    const theta = (i / samples) * Math.PI * 0.5;
    points.push(new THREE.Vector3(x, radius * (1 - Math.cos(theta)), startZ - radius * Math.sin(theta)));
  }
  const curve = new THREE.CatmullRomCurve3(points);
  const surfaceVertices = [];
  const surfaceIndices = [];
  for (let i = 0; i < points.length; i += 1) {
    const point = points[i];
    surfaceVertices.push(point.x - width * 0.5, point.y, point.z, point.x + width * 0.5, point.y, point.z);
    if (i < points.length - 1) {
      const a = i * 2;
      surfaceIndices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const surfaceGeometry = new THREE.BufferGeometry();
  surfaceGeometry.setAttribute('position', new THREE.Float32BufferAttribute(surfaceVertices, 3));
  surfaceGeometry.setIndex(surfaceIndices);
  surfaceGeometry.computeVertexNormals();
  const wallSurface = new THREE.Mesh(surfaceGeometry, createMaterial(0x343c48, { roughness: 0.68, metalness: 0.24 }));
  wallSurface.castShadow = true;
  wallSurface.receiveShadow = true;
  parent.add(wallSurface);
  for (const side of [-1, 1]) {
    const railPoints = points.map((point) => new THREE.Vector3(point.x + side * width * 0.5, point.y + 0.15, point.z));
    parent.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(railPoints), 52, 0.11, 8, false), side < 0 ? red : cyan));
  }
  for (let i = 3; i < samples; i += 4) {
    const theta = (i / samples) * Math.PI * 0.5;
    const y = radius * (1 - Math.cos(theta));
    const z = startZ - radius * Math.sin(theta);
    addBox(parent, [width + 0.5, 0.12, 0.16], [x, y - 0.1, z], createMaterial(0x27323f, { metalness: 0.5 }), { castShadow: false });
  }
  const label = createLabel('WALL RIDE', 0xffcf59);
  label.position.set(x + 3, radius + 2.2, startZ - radius * 0.7);
  label.scale.set(4.4, 1.1, 1);
  parent.add(label);
}

function createRouteSign(parent, x, z, text, main, accent) {
  const signPost = createMaterial(0x26313d, { metalness: 0.72, roughness: 0.34 });
  addBox(parent, [0.14, 3.5, 0.14], [x, 1.75, z], signPost, { castShadow: false });
  addBox(parent, [3.8, 0.72, 0.12], [x, 3.5, z], main, { castShadow: false });
  addBox(parent, [0.11, 0.56, 0.14], [x - 1.25, 3.5, z - 0.08], accent, { castShadow: false });
  const label = createLabel(text, 0xf0f8ff);
  label.position.set(x, 4.35, z);
  label.scale.set(4.8, 1.15, 1);
  label.rotation.y = Math.PI;
  parent.add(label);
}

function createTrackLightRig(parent, cyan, red, yellow) {
  const pole = createMaterial(0x273442, { metalness: 0.8, roughness: 0.25 });
  for (let z = 45; z > -205; z -= 18) {
    for (const x of [-15, 15]) {
      addCylinder(parent, 0.08, 6, [x, 3, z], pole, { segments: 8, castShadow: false });
      addBox(parent, [1.8, 0.12, 0.12], [x + (x > 0 ? -0.8 : 0.8), 6, z], pole, { castShadow: false });
      addBox(parent, [0.38, 0.12, 0.2], [x + (x > 0 ? -1.65 : 1.65), 5.95, z], z % 36 === 0 ? yellow : x > 0 ? cyan : red, { castShadow: false, receiveShadow: false });
    }
  }
  for (let z = 35; z > -180; z -= 9) {
    addBox(parent, [0.18, 0.04, 0.55], [-9.7, 0.16, z], red, { castShadow: false, receiveShadow: false });
    addBox(parent, [0.18, 0.04, 0.55], [9.7, 0.16, z], cyan, { castShadow: false, receiveShadow: false });
  }
}

function addTrackEdgeRails(parent, zStart, zEnd, x, red, cyan) {
  addBox(parent, [0.14, 0.18, Math.abs(zStart - zEnd)], [-x, 0.08, (zStart + zEnd) / 2], red, { castShadow: false });
  addBox(parent, [0.14, 0.18, Math.abs(zStart - zEnd)], [x, 0.08, (zStart + zEnd) / 2], cyan, { castShadow: false });
}

function createLabel(text, tint = 0x9be9ff) {
  const canvasLabel = document.createElement('canvas');
  canvasLabel.width = 512;
  canvasLabel.height = 128;
  const ctx = canvasLabel.getContext('2d');
  ctx.clearRect(0, 0, canvasLabel.width, canvasLabel.height);
  ctx.font = '700 38px Arial';
  ctx.letterSpacing = '4px';
  ctx.fillStyle = `#${new THREE.Color(tint).getHexString()}`;
  ctx.fillText(text, 12, 70);
  const texture = new THREE.CanvasTexture(canvasLabel);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  sprite.scale.set(10, 2.5, 1);
  return sprite;
}

function setVehicleSupportCorners(box) {
  vehicleSupportCorners.length = 0;
  const inverseVehicle = new THREE.Matrix4().copy(vehicleRoot.matrixWorld).invert();
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) {
        vehicleSupportCorners.push(new THREE.Vector3(x, y, z).applyMatrix4(inverseVehicle));
      }
    }
  }
}

function getVehicleSupportOffset(surfaceNormal = UP) {
  if (vehicleSupportCorners.length === 0) return vehicleSupportOffset;
  let lowestProjection = Infinity;
  vehicleSupportCorners.forEach((corner) => {
    tmp.supportCorner.copy(corner).applyQuaternion(physics.quaternion);
    lowestProjection = Math.min(lowestProjection, tmp.supportCorner.dot(surfaceNormal));
  });
  return Math.max(SUPPORT_EPSILON, -lowestProjection + SUPPORT_EPSILON);
}

function createLightsAndScenery() {
  const poleMat = createMaterial(0x272727, { metalness: 0.82, roughness: 0.3 });
  const lampMat = createMaterial(0xffd79b, { emissive: 0xff9d45, emissiveIntensity: 8, roughness: 0.32 });
  const lampStartZ = 108;
  const lampEndZ = HIGHWAY_BOUNDS.minZ - 32;
  const lampSpacing = 32;
  // Lamp fixtures cover the full road; only four nearby light sources are
  // evaluated by the GPU, instead of 104 point lights on every fragment.
  for (let z = lampStartZ; z > lampEndZ; z -= lampSpacing) {
    for (const side of [-1, 1]) {
      const poleX = side * 16.6;
      const headX = poleX - side * 3.5;
      addCylinder(trackOneRoot, 0.1, 8.8, [poleX, 4.4, z], poleMat, { segments: 10, castShadow: false });
      addBox(trackOneRoot, [3.8, 0.13, 0.13], [poleX - side * 1.75, 8.7, z], poleMat, { castShadow: false });
      addBox(trackOneRoot, [0.62, 0.15, 0.26], [headX, 8.62, z], lampMat, { castShadow: false, receiveShadow: false });
      streetLighting.register(1, headX, 8.35, z);
    }
  }
  const starPositions = [];
  for (let i = 0; i < 350; i += 1) {
    const theta = Math.random() * TAU;
    const phi = Math.acos(0.18 + Math.random() * 0.78);
    const radius = 240;
    starPositions.push(Math.sin(phi) * Math.cos(theta) * radius, Math.cos(phi) * radius + 70, Math.sin(phi) * Math.sin(theta) * radius);
  }
  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starPositions, 3));
  const stars = new THREE.Points(starGeometry, new THREE.PointsMaterial({ color: 0xd9eaff, size: 0.7, sizeAttenuation: true, transparent: true, opacity: 0.9 }));
  stars.name = 'stars';
  environment.add(stars);
}

function createTrafficCar(hex, position, rotation = 0, scale = 1) {
  const group = new THREE.Group();
  group.position.set(...position);
  group.rotation.y = rotation;
  group.scale.setScalar(scale);
  const body = createMaterial(hex, { metalness: 0.76, roughness: 0.25 });
  const glass = createMaterial(0x0a1420, { metalness: 0.4, roughness: 0.1 });
  const light = createMaterial(0xffe3b0, { emissive: 0xff9b34, emissiveIntensity: 4 });
  addBox(group, [2.2, 0.5, 4.2], [0, 0.55, 0], body, { castShadow: true });
  addBox(group, [1.7, 0.42, 1.8], [0, 0.95, -0.2], glass, { castShadow: true });
  for (const x of [-0.84, 0.84]) {
    addBox(group, [0.15, 0.12, 0.6], [x, 0.57, -2.08], light, { castShadow: false, receiveShadow: false });
    addBox(group, [0.15, 0.12, 0.6], [x, 0.57, 2.08], createMaterial(0xff294b, { emissive: 0xc10b2c, emissiveIntensity: 3 }), { castShadow: false, receiveShadow: false });
  }
  trafficRoot.add(group);
  return group;
}

const traffic = [];
function createTraffic() {
  const colors = [0x89a7b9, 0xff554f, 0xe4b25c, 0x8e9aff, 0xc7d3d8, 0x4e7080];
  const lanes = [-9, -3, 3, 9];
  for (let i = 0; i < 12; i += 1) {
    const laneIndex = i % lanes.length;
    const lane = lanes[laneIndex];
    const car = createTrafficCar(colors[i % colors.length], [lane, 0, 22 - i * 29], i % 3 === 1 ? Math.PI : 0, 0.72 + (i % 2) * 0.12);
    traffic.push({ object: car, speed: (laneIndex >= 2 ? -1 : 1) * (7 + (i % 4) * 2), offset: 22 - i * 29 });
  }
}

createRoad();
createTrackTwo();
createLightsAndScenery();
batchScenery(trackOneRoot);
batchScenery(trackTwoRoot);
streetLighting.buildPools(1, trackOneRoot);
streetLighting.buildPools(2, trackTwoRoot);
createTraffic();
trafficRoot.visible = trafficVisible;

const visualRoot = new THREE.Group();
vehicleRoot.add(visualRoot);
const exhaustRoot = new THREE.Group();
vehicleRoot.add(exhaustRoot);
const placeholder = new THREE.Group();
visualRoot.add(placeholder);

function createPlaceholderCar() {
  const body = createMaterial(0x9aa6b8, { metalness: 0.9, roughness: 0.2 });
  const glass = createMaterial(0x07121d, { metalness: 0.55, roughness: 0.08 });
  const wheel = createMaterial(0x080b10, { roughness: 0.9 });
  addBox(placeholder, [2.2, 0.5, 4.5], [0, 0.42, 0], body);
  addBox(placeholder, [1.7, 0.42, 1.9], [0, 0.82, -0.18], glass);
  for (const x of [-0.96, 0.96]) {
    for (const z of [-1.42, 1.42]) {
      const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.22, 16), wheel);
      tire.rotation.z = Math.PI / 2;
      tire.position.set(x, 0.35, z);
      tire.castShadow = true;
      placeholder.add(tire);
    }
  }
}
createPlaceholderCar();

function createAnchoredCone(radius, length, segments = 14) {
  const geometry = new THREE.CylinderGeometry(radius, radius * 0.14, length, segments, 1, true);
  geometry.translate(0, length * 0.5, 0);
  return geometry;
}

function createJet(position, exhaustDirection, tint = 0xf2f0e8, scale = 1, channel = 'rcs') {
  const group = new THREE.Group();
  group.position.set(...position);
  group.scale.setScalar(scale);
  const aperture = new THREE.Mesh(new THREE.CircleGeometry(0.13, 16), new THREE.MeshBasicMaterial({ color: 0x02060b, transparent: true, opacity: 0.86, depthWrite: false }));
  aperture.position.copy(exhaustDirection).multiplyScalar(0.008);
  aperture.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), exhaustDirection);
  aperture.renderOrder = 2;
  group.add(aperture);
  const plumeMaterial = new THREE.MeshBasicMaterial({ color: 0xe9e9e4, transparent: true, opacity: 0, depthWrite: false, depthTest: true });
  const plume = new THREE.Mesh(createAnchoredCone(0.28, 1.7), plumeMaterial);
  plume.position.copy(exhaustDirection).multiplyScalar(0.02);
  plume.quaternion.setFromUnitVectors(UP, exhaustDirection);
  plume.scale.set(0.04, 0.04, 0.04);
  group.add(plume);
  const coreMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true });
  const core = new THREE.Mesh(createAnchoredCone(0.1, 0.85, 12), coreMaterial);
  core.position.copy(exhaustDirection).multiplyScalar(0.025);
  core.quaternion.setFromUnitVectors(UP, exhaustDirection);
  core.scale.set(0.04, 0.04, 0.04);
  group.add(core);
  exhaustRoot.add(group);
  return { group, aperture, plume, core, direction: exhaustDirection.clone(), power: 0, channel, side: Math.sign(position[0]) || 0 };
}

for (const x of [-0.72, -0.24, 0.24, 0.72]) effects.rear.push(createJet([x, 0.22, 2.14], new THREE.Vector3(0, 0, 1), 0xffc979, 0.9, 'rear'));
for (const x of [-0.68, 0.68]) {
  for (const z of [-1.2, 1.2]) effects.lift.push(createJet([x, -0.58, z], new THREE.Vector3(0, -1, 0), 0xf2f0e8, 0.88, 'lift'));
}
effects.rcs.push(createJet([-0.98, 0.04, 0.7], new THREE.Vector3(-1, 0, 0), 0xffa45d, 0.78, 'yaw'));
effects.rcs.push(createJet([0.98, 0.04, 0.7], new THREE.Vector3(1, 0, 0), 0xffa45d, 0.78, 'yaw'));
effects.rcs.push(createJet([-0.98, 0.04, -0.7], new THREE.Vector3(-1, 0, 0), 0xffd08a, 0.78, 'roll'));
effects.rcs.push(createJet([0.98, 0.04, -0.7], new THREE.Vector3(1, 0, 0), 0xffd08a, 0.78, 'roll'));

const airReleasePools = [];
const visualPressure = { rear: 0, lift: 0, rcs: 0 };

function createAirReleasePool(name, capacity) {
  const pool = createPressureSmoke(airReleaseRoot, name, capacity);
  airReleasePools.push(pool);
  return pool;
}

function clearAirReleaseParticles() {
  visualPressure.rear = 0;
  visualPressure.lift = 0;
  visualPressure.rcs = 0;
  airReleasePools.forEach((pool) => pool.clear());
}

function smokeGroundHeight(x, z) {
  if (activeTrack === 1) return z > 37 && z < 75 ? 0.06 : -0.04;
  return Math.abs(x) < 10 && z > STUNT_RAMP.startZ && z < 95 ? STUNT_RAMP.surfaceY : -0.04;
}

const airRearPool = createAirReleasePool('rear', 180);
const airLiftPool = createAirReleasePool('lift', 360);
const airRcsPool = createAirReleasePool('rcs', 72);

loadStatus.textContent = 'Loading the flight hardware...';
window.setTimeout(() => loadingScreen.classList.add('hidden'), 20000);

function disposeModel(model) {
  if (!model) return;
  model.traverse((node) => {
    if (!node.isMesh) return;
    node.geometry?.dispose();
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    materials.forEach((material) => {
      if (!material) return;
      Object.values(material).forEach((value) => {
        if (value?.isTexture) value.dispose();
      });
      material.dispose?.();
    });
  });
}

function finalizeCarModel(model, carId, token) {
  if (token !== carLoadToken) {
    disposeModel(model);
    return;
  }
  if (activeModel) {
    visualRoot.remove(activeModel);
    disposeModel(activeModel);
  }
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const targetLength = 4.65;
  const scale = targetLength / Math.max(size.x, size.z, 0.01);
  model.scale.setScalar(scale);
  model.rotation.y = Math.PI;
  const scaledBox = new THREE.Box3().setFromObject(model);
  const scaledCenter = scaledBox.getCenter(new THREE.Vector3());
  model.position.y = -scaledCenter.y;
  // Measure the render hull with the vehicle root at the origin. This keeps
  // support height independent of the car's previous world position and
  // removes the old visible 5 cm floating offset.
  const savedVehiclePosition = vehicleRoot.position.clone();
  const savedVehicleQuaternion = vehicleRoot.quaternion.clone();
  vehicleRoot.position.set(0, 0, 0);
  vehicleRoot.quaternion.identity();
  vehicleRoot.updateMatrixWorld(true);
  const supportBox = new THREE.Box3().setFromObject(model);
  vehicleLights.configure(model);
  effects.lift.forEach((jet) => { jet.group.position.y = supportBox.min.y + 0.04; });
  effects.rear.forEach((jet) => {
    jet.group.position.z = supportBox.max.z + 0.035;
    jet.group.position.y = supportBox.min.y + 0.35;
  });
  vehicleSupportOffset = THREE.MathUtils.clamp(-supportBox.min.y + SUPPORT_EPSILON, 0.08, 1.35);
  setVehicleSupportCorners(supportBox);
  vehicleRoot.position.copy(savedVehiclePosition);
  vehicleRoot.quaternion.copy(savedVehicleQuaternion);
  vehicleRoot.updateMatrixWorld(true);
  model.traverse((node) => {
    if (!node.isMesh) return;
    node.castShadow = true;
    node.receiveShadow = true;
    if (node.material) {
      node.material.forceSinglePass = true;
      // The source GLB's glass requests a transmission render of the entire
      // scene. Tinted alpha glass keeps the windows without that extra pass.
      if (node.material.transmission > 0) {
        node.material.transmission = 0;
        node.material.transparent = true;
        node.material.opacity = 0.3;
        node.material.depthWrite = false;
      }
      if ('envMapIntensity' in node.material) node.material.envMapIntensity = 1.4;
      if ('emissiveIntensity' in node.material) node.material.emissiveIntensity = Math.min(node.material.emissiveIntensity ?? 0.2, 0.65);
    }
  });
  visualRoot.add(model);
  activeModel = model;
  activeCar = carId;
  placeholder.visible = false;
  exhaustRoot.rotation.set(0, 0, 0);
  exhaustRoot.position.set(0, 0, 0);
  document.querySelector('#car-select').value = carId;
  loadBar.style.width = '100%';
  loadStatus.textContent = `${CAR_OPTIONS[carId].label} online.`;
  loadingScreen.classList.add('hidden');
  resetRun(false);
  showToastMessage(`${CAR_OPTIONS[carId].label} LOADED / VEHICLE RESET`);
}

function loadCarModel(carId = '2020') {
  const option = CAR_OPTIONS[carId] ?? CAR_OPTIONS['2020'];
  const token = ++carLoadToken;
  placeholder.visible = true;
  loadStatus.textContent = `Loading ${option.label}...`;
  if (activeModel) {
    visualRoot.remove(activeModel);
    disposeModel(activeModel);
    activeModel = null;
  }
  if (option.type === 'stl') {
    stlLoader.load(option.url, (geometry) => {
      geometry.computeVertexNormals();
      const material = new THREE.MeshStandardMaterial({ color: 0xb9c6d3, metalness: 0.86, roughness: 0.24 });
      finalizeCarModel(new THREE.Mesh(geometry, material), carId, token);
    }, undefined, () => {
      if (token !== carLoadToken) return;
      loadStatus.textContent = `${option.label} unavailable — training chassis active.`;
      loadingScreen.classList.add('hidden');
      showToastMessage(`${option.label} FAILED TO LOAD`);
    });
    return;
  }
  loader.load(option.url, (gltf) => finalizeCarModel(gltf.scene, carId, token), (progress) => {
    if (progress.total) {
      const percent = Math.min(96, (progress.loaded / progress.total) * 100);
      loadBar.style.width = `${percent}%`;
      loadStatus.textContent = `Streaming ${option.label} ${Math.round(percent)}%...`;
    }
  }, () => {
    if (token !== carLoadToken) return;
    loadStatus.textContent = `${option.label} unavailable — training chassis active.`;
    loadingScreen.classList.add('hidden');
    showToastMessage(`${option.label} FAILED TO LOAD`);
  });
}

const requestedCar = new URLSearchParams(window.location.search).get('car');
loadCarModel(CAR_OPTIONS[requestedCar] ? requestedCar : '2020');

function flatTerrain(height, name = 'ROAD') {
  return { hasSurface: true, height, normal: tmp.surfaceNormal.set(0, 1, 0), tangent: tmp.surfaceTangent.copy(FORWARD), name, type: 'ground', surfaceZ: null };
}

function noTerrain(name = 'GAP') {
  return { hasSurface: false, height: 0, normal: tmp.surfaceNormal.set(0, 1, 0), tangent: tmp.surfaceTangent.copy(FORWARD), name, type: 'gap' };
}

function getTrackOneTerrain(x, z) {
  if (z > 37) return flatTerrain(0.06, 'START PAD');
  // Road 01 has no ramp collision. The ramp mesh is not part of the highway,
  // so keeping a ramp profile here would create the invisible obstacle users
  // hit while driving down the road.
  return flatTerrain(-0.04, 'ROAD');
}

function getTrackTwoTerrain(x, z) {
  const { startZ, radius, width, surfaceY, endAngle, deckLength } = STUNT_RAMP;
  const rampEndZ = startZ - radius * Math.sin(endAngle);
  const rampEndHeight = surfaceY + radius * (1 - Math.cos(endAngle));
  // Give the car a little center-line tolerance at the ramp lip. The visible
  // ramp is 14 units wide; rejecting a car at 6.25 units made its tires hit
  // the edge while the solver still considered it on flat ground.
  const insideRamp = Math.abs(x) <= width / 2 + RAMP_EDGE_MARGIN;

  // Once attached, keep querying the exact ramp segment from the stored arc
  // coordinate. Do not fall back to flat arena ground just because a fast
  // substep moved the root slightly past the segment's z projection.
  if (insideRamp && physics.wheelContact && physics.rampTheta > 0.02 && physics.rampTheta < endAngle - 0.02) {
    const theta = physics.rampTheta;
    const info = flatTerrain(surfaceY + radius * (1 - Math.cos(theta)), theta >= Math.PI * 0.5 ? 'RAMP / RETURN ARC' : 'RAMP / ASCENT');
    info.type = 'ramp';
    info.arc = theta >= Math.PI * 0.5 ? 'upper' : 'lower';
    info.theta = theta;
    info.surfaceZ = startZ - radius * Math.sin(theta);
    info.normal.set(0, Math.cos(theta), Math.sin(theta)).normalize();
    info.tangent = tmp.surfaceTangent.set(0, Math.sin(theta), -Math.cos(theta)).normalize();
    return info;
  }

  // The curved ramp finishes into a short inverted deck on the return side.
  // Only this bounded deck can be contacted; the old implementation treated
  // the entire approach as a high platform and snapped jumping cars upward.
  const deckHeight = rampEndHeight;
  const isNearDeckHeight = physics.position.y >= deckHeight - 12;
  if (insideRamp && isNearDeckHeight && z > rampEndZ && z <= rampEndZ + deckLength) {
    const info = flatTerrain(deckHeight, 'RAMP TOP DECK');
    info.type = 'deck';
    // At the end of the full curve the car is on the underside of the deck,
    // so the surface normal points down and the body settles upside down.
    info.normal.set(0, -1, 0);
    info.tangent.set(0, 0, 1);
    return info;
  }

  if (insideRamp && z <= startZ && z >= startZ - radius) {
    const ratio = THREE.MathUtils.clamp((startZ - z) / radius, 0, 1);
    const lowerTheta = Math.asin(ratio);
    const upperTheta = endAngle - lowerTheta;
    const apexZ = startZ - radius;
    // The same z coordinate exists on both halves of a full C curve. Select
    // the upper return only after the car has crossed the apex and is moving
    // back toward the deck. Using height alone caused the lower approach to
    // jump to the wrong side of the mesh and get struck at the ramp entrance.
    const useUpperArc = physics.rampArc === 'upper'
      || (z > apexZ + 0.35 && physics.velocity.z > 0.35 && physics.position.y > radius * 0.55);
    const ridingRamp = physics.wheelContact && physics.rampTheta > 0.02 && physics.rampTheta < endAngle - 0.02;
    const theta = ridingRamp ? physics.rampTheta : useUpperArc ? upperTheta : lowerTheta;
    const info = flatTerrain(surfaceY + radius * (1 - Math.cos(theta)), theta >= Math.PI * 0.5 ? 'RAMP / RETURN ARC' : theta > 0.08 ? 'RAMP / ASCENT' : 'RAMP APPROACH');
    info.type = 'ramp';
    info.arc = theta >= Math.PI * 0.5 ? 'upper' : 'lower';
    info.theta = theta;
    info.surfaceZ = startZ - radius * Math.sin(theta);
    info.normal.set(0, Math.cos(theta), Math.sin(theta)).normalize();
    info.tangent = tmp.surfaceTangent.set(0, Math.sin(theta), -Math.cos(theta)).normalize();
    return info;
  }

  if (z > startZ) return flatTerrain(surfaceY, 'RUNWAY');

  if (Math.abs(x) <= STUNT_BOUNDS.halfWidth && z >= STUNT_BOUNDS.minZ && z <= STUNT_BOUNDS.maxZ) {
    return flatTerrain(-0.04, 'OPEN GROUND');
  }
  return noTerrain('OUT OF ARENA');
}

function rampTerrain(x, z, startZ, endZ, startHeight, endHeight, name) {
  const length = Math.abs(startZ - endZ);
  const t = THREE.MathUtils.clamp(Math.abs(startZ - z) / length, 0, 1);
  const eased = t * t * (3 - 2 * t);
  const height = THREE.MathUtils.lerp(startHeight, endHeight, eased);
  const slope = (endHeight - startHeight) * (6 * t * (1 - t)) / length;
  return { hasSurface: true, height, normal: tmp.surfaceNormal.set(0, 1, -slope).normalize(), name };
}

function wallRideTerrain(z) {
  const radius = 18;
  const t = THREE.MathUtils.clamp((-47 - z) / radius, 0, 1);
  const theta = Math.asin(t);
  return { hasSurface: true, height: radius * (1 - Math.cos(theta)) + 0.03, normal: tmp.surfaceNormal.set(0, Math.cos(theta), Math.sin(theta)).normalize(), name: 'WALL RIDE' };
}

function arcRampTerrain(z, startZ, radius, name) {
  const t = THREE.MathUtils.clamp((startZ - z) / radius, 0, 1);
  const theta = Math.asin(t);
  return { hasSurface: true, height: radius * (1 - Math.cos(theta)) + 0.03, normal: tmp.surfaceNormal.set(0, Math.cos(theta), Math.sin(theta)).normalize(), name };
}

function loopTerrain(x, z, centerX, centerZ, radius, name) {
  const width = Math.abs(x - centerX);
  const zDelta = THREE.MathUtils.clamp(z - centerZ, -radius + 0.04, radius - 0.04);
  const dy = Math.sqrt(Math.max(0.01, radius * radius - zDelta * zDelta));
  const candidates = [radius + 1.1 - dy, radius + 1.1 + dy];
  const currentY = physics.position.y;
  const height = candidates.reduce((best, candidate) => Math.abs(candidate - currentY) < Math.abs(best - currentY) ? candidate : best, candidates[0]);
  const radialY = height - (radius + 1.1);
  const normal = tmp.surfaceNormal.set(0, -radialY / radius, -zDelta / radius).normalize();
  return { hasSurface: true, height, normal, name };
}

function openHalfPipeTerrain(x, z, xOffset, radius, name) {
  const safeX = THREE.MathUtils.clamp(x - xOffset, -radius + 0.04, radius - 0.04);
  const height = radius - Math.sqrt(Math.max(0.01, radius * radius - safeX * safeX)) + 0.03;
  const normal = tmp.surfaceNormal.set(-safeX, Math.sqrt(Math.max(0.01, radius * radius - safeX * safeX)), 0).normalize();
  return { hasSurface: true, height, normal, name };
}

function getTerrainInfo(x, z) {
  return activeTrack === 2 ? getTrackTwoTerrain(x, z) : getTrackOneTerrain(x, z);
}

function getRoadHalfWidth(z) {
  return activeTrack === 2 ? STUNT_BOUNDS.halfWidth : HIGHWAY_BOUNDS.halfWidth;
}

function keepVehicleOnRoad() {
  const bound = getRoadHalfWidth(physics.position.z);
  if (physics.position.x > bound) {
    physics.position.x = bound;
    if (physics.velocity.x > 0) physics.velocity.x = 0;
  } else if (physics.position.x < -bound) {
    physics.position.x = -bound;
    if (physics.velocity.x < 0) physics.velocity.x = 0;
  }

  const bounds = activeTrack === 2 ? STUNT_BOUNDS : HIGHWAY_BOUNDS;
  if (physics.position.z < bounds.minZ) {
    physics.position.z = bounds.minZ;
    if (physics.velocity.z < 0) physics.velocity.z = 0;
  } else if (physics.position.z > bounds.maxZ) {
    physics.position.z = bounds.maxZ;
    if (physics.velocity.z > 0) physics.velocity.z = 0;
  }
}

function alignVehicleToSurface(normal, dt, hardLanding = false, tangent = null) {
  const surfaceUp = normal.clone().normalize();
  if (tangent) {
    tmp.flatForward.copy(tangent).projectOnPlane(surfaceUp);
  } else {
    tmp.flatForward.copy(FORWARD).applyQuaternion(physics.quaternion).projectOnPlane(surfaceUp);
  }
  if (tmp.flatForward.lengthSq() < 0.01) {
    tmp.flatForward.copy(UP).applyQuaternion(physics.quaternion).projectOnPlane(surfaceUp);
    if (tmp.flatForward.lengthSq() < 0.01) tmp.flatForward.set(0, 0, -1).projectOnPlane(surfaceUp);
  }
  tmp.flatForward.normalize();
  const zAxis = tmp.flatForward.clone().negate();
  const xAxis = surfaceUp.clone().cross(zAxis).normalize();
  const basis = new THREE.Matrix4().makeBasis(xAxis, surfaceUp, zAxis);
  tmp.desiredQuaternion.setFromRotationMatrix(basis);
  const speed = physics.velocity.length();
  const rate = hardLanding ? 32 : (speed < 3.0 ? 22 : 12);
  physics.quaternion.slerp(tmp.desiredQuaternion, Math.min(1, dt * rate));
}

function applyForce(force, point = ZERO, dt) {
  tmp.force.copy(force).multiplyScalar(dt / physics.mass);
  physics.velocity.add(tmp.force);
  if (point !== ZERO) {
    tmp.worldPoint.copy(point).applyQuaternion(physics.quaternion);
    tmp.torque.crossVectors(tmp.worldPoint, force).multiplyScalar(dt / physics.mass);
    physics.angularVelocity.add(tmp.torque.multiplyScalar(0.015));
  }
}

function rotateByAngularVelocity(dt) {
  const magnitude = physics.angularVelocity.length();
  if (magnitude < 0.00001) return;
  const delta = new THREE.Quaternion().setFromAxisAngle(physics.angularVelocity.clone().normalize(), magnitude * dt);
  physics.quaternion.premultiply(delta).normalize();
}

function resetRun(showToast = true) {
  const startZ = activeTrack === 2 ? 46 : 46;
  physics.quaternion.identity();
  const startTerrain = getTerrainInfo(0, startZ);
  physics.position.set(0, startTerrain.height + getVehicleSupportOffset(startTerrain.normal), startZ);
  physics.velocity.set(0, 0, 0);
  physics.angularVelocity.set(0, 0, 0);
  physics.air = 100;
  physics.energy = 100;
  physics.temperature = 29;
  physics.launchPeak = 0;
  physics.airborneTime = 0;
  physics.wheelContact = true;
  physics.landed = false;
  physics.landingAssist = 0;
  physics.rampArc = 'lower';
  physics.rampTheta = 0;
  physics.spinActive = false;
  physics.spinDirection = 0;
  physics.spinAngle = 0;
  clearAirReleaseParticles();
  if (showToast) showToastMessage('RUN RESET / AIR RESERVE RESTORED');
}

function startSingleSpin(direction) {
  if (paused || helpOpen || physics.wheelContact || physics.air <= 0 || physics.spinActive) return;
  physics.spinActive = true;
  physics.spinDirection = direction < 0 ? -1 : 1;
  physics.spinAngle = 0;
  physics.angularVelocity.set(0, 0, 0);
  showToastMessage(`${physics.spinDirection < 0 ? 'LEFT' : 'RIGHT'} SPIN / 360°`);
}

function stopSingleSpin(completed = false) {
  const direction = physics.spinDirection;
  physics.spinActive = false;
  physics.spinDirection = 0;
  physics.spinAngle = 0;
  physics.angularVelocity.set(0, 0, 0);
  if (completed) showToastMessage(`${direction < 0 ? 'LEFT' : 'RIGHT'} SPIN COMPLETE`);
}

function updateSingleSpin(dt) {
  if (!physics.spinActive) return;
  if (physics.wheelContact) {
    stopSingleSpin();
    return;
  }

  const remaining = TAU - physics.spinAngle;
  const step = Math.min(SINGLE_SPIN_RATE * dt, remaining);
  tmp.spinAxis.copy(FORWARD).applyQuaternion(physics.quaternion).normalize();
  tmp.spinDelta.setFromAxisAngle(tmp.spinAxis, physics.spinDirection * step);
  physics.quaternion.premultiply(tmp.spinDelta).normalize();
  physics.spinAngle += step;

  if (physics.spinAngle >= TAU - 0.000001) stopSingleSpin(true);
}

function updateInput() {
  const driveForward = (keys.has('KeyW') || keys.has('ArrowUp')) ? 1 : 0;
  const driveReverse = (keys.has('KeyS') || (physics.wheelContact && keys.has('ArrowDown'))) ? 1 : 0;
  input.drive = driveForward - driveReverse;
  input.steer = (keys.has('KeyA') ? 1 : 0) - (keys.has('KeyD') ? 1 : 0);
  input.rear = keys.has('ArrowUp') ? 1 : 0;
  input.lift = keys.has('Space') || (!physics.wheelContact && keys.has('ArrowDown')) ? 1 : 0;
  input.yaw = (keys.has('ArrowRight') ? 1 : 0) - (keys.has('ArrowLeft') ? 1 : 0);
  // Q/E are edge-triggered one-shot spins, not continuous roll controls.
  input.roll = 0;
  input.pitch = 0;
  input.spiral = (keys.has('KeyX') ? 1 : 0) - (keys.has('KeyZ') ? 1 : 0);
  input.boost = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 1 : 0;
}

function updatePhysicsStep(dt) {
  updateInput();
  tmp.previousPosition.copy(physics.position);
  tmp.forward.copy(FORWARD).applyQuaternion(physics.quaternion).normalize();
  tmp.up.copy(UP).applyQuaternion(physics.quaternion).normalize();
  tmp.right.copy(RIGHT).applyQuaternion(physics.quaternion).normalize();
  const terrain = getTerrainInfo(physics.position.x, physics.position.z);

  // Apply ground steering directly to both heading and travel velocity. The
  // previous torque-only steering was heavily damped by the contact solver,
  // so A/D could animate the nose without producing a useful road turn.
  if (physics.wheelContact && terrain.hasSurface && input.steer !== 0) {
    const groundSpeed = Math.abs(physics.velocity.dot(tmp.forward));
    const steeringRate = THREE.MathUtils.lerp(1.25, 2.45, THREE.MathUtils.clamp(groundSpeed / 18, 0, 1));
    const steerAngle = input.steer * steeringRate * dt;
    tmp.steerDelta.setFromAxisAngle(terrain.normal, steerAngle);
    physics.quaternion.premultiply(tmp.steerDelta).normalize();
    if (groundSpeed > 0.25) physics.velocity.applyAxisAngle(terrain.normal, steerAngle * 0.92);
    tmp.forward.copy(FORWARD).applyQuaternion(physics.quaternion).normalize();
    tmp.up.copy(UP).applyQuaternion(physics.quaternion).normalize();
    tmp.right.copy(RIGHT).applyQuaternion(physics.quaternion).normalize();
  }

  const rearPower = input.rear * (input.boost ? 102000 : 68000);
  const liftPower = input.lift * 33000;
  const manualSpiral = !physics.wheelContact && input.spiral;
  const assistedSpiral = !physics.wheelContact && autoSpiral ? 1 : 0;
  const airYaw = input.yaw;
  const spinRcs = physics.spinActive ? 0.85 : 0;
  const rcsPower = Math.min(1, Math.abs(airYaw) + Math.abs(input.pitch) + Math.abs(manualSpiral) * 0.8 + assistedSpiral * 0.45 + spinRcs);
  const rearForce = tmp.forward.clone().multiplyScalar(rearPower);
  if (physics.air > 0 && input.rear > 0) applyForce(rearForce, new THREE.Vector3(0, 0, 1.4), dt);

  let driveDirection = terrain.type === 'ramp' || terrain.type === 'deck'
    ? terrain.tangent.clone()
    : tmp.forward.clone().projectOnPlane(terrain.normal);
  if (driveDirection.lengthSq() < 0.001) driveDirection.copy(tmp.forward).setY(0);
  if (driveDirection.lengthSq() < 0.001) driveDirection.set(0, 0, -1);
  driveDirection.normalize();

  if (physics.wheelContact && terrain.hasSurface && input.drive !== 0) {
    const groundVelocity = physics.velocity.dot(driveDirection);
    const targetSpeed = input.drive > 0 ? (input.boost ? 300 : 220) / 3.6 : -65 / 3.6;
    const desiredAcceleration = THREE.MathUtils.clamp((targetSpeed - groundVelocity) * 4.2, -48, 42);
    applyForce(driveDirection.clone().multiplyScalar(physics.mass * desiredAcceleration), ZERO, dt);
  }

  if (liftPower > 0 && physics.air > 0) applyForce(tmp.up.clone().multiplyScalar(liftPower), new THREE.Vector3(0, -0.42, 0), dt);
  if (rcsPower > 0 && physics.air > 0) {
    // Left/right arrows rotate the heading (yaw) in both modes. They no
    // longer use the forward axis, which was a barrel-roll and looked like a
    // loss of control rather than left/right rotation.
    const yawAxis = physics.wheelContact && terrain.hasSurface ? terrain.normal : tmp.up;
    physics.angularVelocity.addScaledVector(yawAxis, airYaw * (physics.wheelContact ? 2.6 : 4.2) * dt);
  }

  if (!physics.wheelContact && rcsPower > 0 && physics.air > 0 && !physics.spinActive) {
    const spiralRoll = input.roll + manualSpiral * 1.65 + assistedSpiral * 0.95;
    physics.angularVelocity.addScaledVector(tmp.forward, spiralRoll * 4.2 * dt);
    physics.angularVelocity.addScaledVector(tmp.right, input.pitch * 1.2 * dt);
  }

  const gravity = new THREE.Vector3(0, -9.81 * physics.mass, 0);
  applyForce(gravity, ZERO, dt);
  // Gravity pulls away from the underside of the return arc. Once the car is
  // actually riding that inverted surface, cancel only that normal component
  // so it follows the curve instead of dropping through the landing section.
  if (physics.wheelContact && terrain.hasSurface && terrain.normal.y < -0.2 && input.lift === 0) {
    applyForce(terrain.normal.clone().multiplyScalar(-physics.mass * 9.81), ZERO, dt);
  }
  const speed = physics.velocity.length();
  const drag = physics.velocity.clone().multiplyScalar(-0.12 * speed);
  applyForce(drag, ZERO, dt);

  if (physics.wheelContact && terrain.hasSurface) {
    if (terrain.type === 'ramp' || terrain.type === 'deck') {
      tmp.flatForward.copy(terrain.tangent).normalize();
    } else {
      tmp.flatForward.copy(tmp.forward).projectOnPlane(terrain.normal).normalize();
    }
    const longitudinal = physics.velocity.dot(tmp.flatForward);
    tmp.lateralVelocity.copy(physics.velocity).addScaledVector(tmp.flatForward, -longitudinal);
    physics.velocity.addScaledVector(tmp.lateralVelocity, -Math.min(1, dt * 8));
    const rollingResistance = Math.abs(input.drive) > 0.01 ? 0.35 : 2.4;
    const groundDamping = Math.exp(-rollingResistance * dt);
    physics.velocity.multiplyScalar(groundDamping);
  }

  const surfacePointNow = tmp.cameraTarget.set(physics.position.x, terrain.height, physics.position.z);
  const vacuumSurfaceDistance = physics.position.clone().sub(surfacePointNow).dot(terrain.normal);
  const nearSurface = terrain.hasSurface && vacuumSurfaceDistance < 7.5;
  if (vacuumEnabled && nearSurface && physics.energy > 0) {
    const adhesion = THREE.MathUtils.clamp(1 - Math.max(0, vacuumSurfaceDistance - vehicleSupportOffset) / 7.5, 0, 1);
    const normalLoad = physics.mass * (9.81 + THREE.MathUtils.clamp((vacuumSurfaceDistance - vehicleSupportOffset) * 16, -5, 38)) * adhesion;
    applyForce(terrain.normal.clone().multiplyScalar(-normalLoad), ZERO, dt);
    physics.energy = Math.max(0, physics.energy - dt * (normalLoad / (physics.mass * 48)));
  } else {
    physics.energy = Math.min(100, physics.energy + dt * 4);
  }

  const activeControl = Math.max(Math.abs(input.drive), Math.abs(input.steer), Math.abs(input.rear), input.lift, Math.abs(input.yaw), Math.abs(input.roll), Math.abs(input.pitch), Math.abs(input.spiral), input.boost);
  const angularDamping = activeControl > 0 || autoSpiral ? (physics.wheelContact ? 3.2 : 0.42) : (physics.wheelContact ? 15 : 3.2);
  physics.angularVelocity.multiplyScalar(Math.exp(-angularDamping * dt));

  const thrustUsage = Math.min(1, input.rear * (input.boost ? 1.8 : 0.85) + input.lift * 0.95 + rcsPower * 0.24);
  const rechargeRate = thrustUsage > 0.01 ? 0 : (physics.wheelContact ? THRUSTER_RECHARGE_GROUND : THRUSTER_RECHARGE_AIR);
  physics.air = THREE.MathUtils.clamp(physics.air - thrustUsage * dt * 4.15 + rechargeRate * dt, 0, 100);
  physics.temperature = THREE.MathUtils.damp(physics.temperature, 29 + thrustUsage * 52 + speed * 0.05, 1.7, dt);
  if (physics.air <= 0) {
    input.rear = 0;
    input.lift = 0;
  }

  physics.velocity.y = THREE.MathUtils.clamp(physics.velocity.y, -54, 66);
  physics.velocity.x = THREE.MathUtils.clamp(physics.velocity.x, -95, 95);
  physics.velocity.z = THREE.MathUtils.clamp(physics.velocity.z, -95, 95);
  const maximumSpeed = physics.wheelContact ? (input.boost ? 84 : 64) : 92;
  if (physics.velocity.length() > maximumSpeed) physics.velocity.setLength(maximumSpeed);
  physics.position.addScaledVector(physics.velocity, dt);
  keepVehicleOnRoad();
  const contactTerrain = getTerrainInfo(physics.position.x, physics.position.z);
  if (contactTerrain.arc) physics.rampArc = contactTerrain.arc;
  else if (activeTrack === 2 && physics.position.z > STUNT_RAMP.startZ + 1) physics.rampArc = 'lower';
  if (physics.spinActive) physics.angularVelocity.set(0, 0, 0);
  rotateByAngularVelocity(dt);
  updateSingleSpin(dt);

  const contactZ = contactTerrain.surfaceZ ?? physics.position.z;
  const surfacePoint = tmp.worldPoint.set(physics.position.x, contactTerrain.height, contactZ);
  let contactSupport = getVehicleSupportOffset(contactTerrain.normal);
  let surfaceDistance = physics.position.clone().sub(surfacePoint).dot(contactTerrain.normal);
  const previousSurfaceDistance = tmp.previousSurfaceDelta.copy(tmp.previousPosition).sub(surfacePoint).dot(contactTerrain.normal);
  const wasWheelContact = physics.wheelContact;
  const surfaceIsReachable = contactTerrain.type === 'ramp'
    ? surfaceDistance >= -RAMP_CONTACT_MARGIN
    : contactTerrain.type === 'ground'
      ? surfaceDistance >= -GROUND_LOCK_DISTANCE
      : surfaceDistance >= -MAX_SURFACE_PENETRATION;
  // The deck query is already height-gated, so an upward-moving car may
  // legitimately contact it at the end of the return arc. Rejecting positive
  // vertical velocity here made the car strike and fall through the landing.
  const rampRecovery = contactTerrain.type === 'ramp' && wasWheelContact;
  // If the car was already driving on a flat road, keep it locked to that
  // road for a few metres of tolerance. This catches a substep that would
  // otherwise leave the chassis inside the road or make it hover after a
  // high-speed ramp transition. A car that was genuinely airborne is still
  // allowed to jump and land normally.
  const groundRecovery = contactTerrain.type === 'ground'
    && wasWheelContact
    && input.lift === 0
    && surfaceDistance <= GROUND_LOCK_DISTANCE;
  // A landing must be allowed even when the player is still holding the
  // bottom-lift key. The lift force should continue after touchdown, but it
  // must not disable the road collision for the exact frame the chassis
  // crosses the runway. The previous-position test also catches a fast
  // downward step that moves from above the support plane to just below it.
  const groundCrossing = contactTerrain.type === 'ground'
    && !wasWheelContact
    && previousSurfaceDistance > contactSupport
    && surfaceDistance <= contactSupport + GROUND_LANDING_MARGIN
    && physics.velocity.dot(contactTerrain.normal) <= 0;
  const groundLanding = contactTerrain.type === 'ground'
    && !wasWheelContact
    && surfaceDistance <= contactSupport + GROUND_LANDING_MARGIN
    && (groundCrossing || physics.velocity.dot(contactTerrain.normal) <= 0);
  const canStickToSurface = contactTerrain.hasSurface && surfaceIsReachable && (
    rampRecovery
    || groundRecovery
    || groundLanding
    || (contactTerrain.type !== 'ground' && surfaceDistance <= contactSupport + GROUND_LANDING_MARGIN)
  );

  if (canStickToSurface) {
    const impactSpeed = Math.max(0, -physics.velocity.dot(contactTerrain.normal));

    if (contactTerrain.type === 'ramp') {
      // Advance along the ramp's arc length rather than deriving both halves
      // from z. At the apex z stops changing for a moment; a stored theta
      // lets the car continue smoothly onto the inverted return side.
      physics.rampTheta = contactTerrain.theta;
      if (input.lift === 0) {
        physics.rampTheta = THREE.MathUtils.clamp(
          physics.rampTheta + physics.velocity.dot(contactTerrain.tangent) * dt / STUNT_RAMP.radius,
          0,
          STUNT_RAMP.endAngle,
        );
      }
      const theta = physics.rampTheta;
      contactTerrain.height = STUNT_RAMP.surfaceY + STUNT_RAMP.radius * (1 - Math.cos(theta));
      contactTerrain.normal.set(0, Math.cos(theta), Math.sin(theta)).normalize();
      contactTerrain.tangent.set(0, Math.sin(theta), -Math.cos(theta)).normalize();
      contactTerrain.surfaceZ = STUNT_RAMP.startZ - STUNT_RAMP.radius * Math.sin(theta);
      contactTerrain.arc = theta >= Math.PI * 0.5 ? 'upper' : 'lower';
      surfacePoint.set(physics.position.x, contactTerrain.height, contactTerrain.surfaceZ);
      contactSupport = getVehicleSupportOffset(contactTerrain.normal);
      surfaceDistance = physics.position.clone().sub(surfacePoint).dot(contactTerrain.normal);
    }

    // Align first, then calculate the support distance again. The old order
    // snapped using the pre-landing orientation and then rotated the chassis,
    // which is why the model could finish inside the road after touchdown.
    const surfaceTangent = contactTerrain.type === 'ground' ? null : contactTerrain.tangent;
    alignVehicleToSurface(contactTerrain.normal, dt, !wasWheelContact && impactSpeed > 5, surfaceTangent);
    contactSupport = getVehicleSupportOffset(contactTerrain.normal);
    // Resolve to the exact support distance every contact step. This prevents
    // a fast landing from leaving the body half inside the road or hovering
    // above the ramp after the orientation correction.
    physics.position.copy(surfacePoint).addScaledVector(contactTerrain.normal, contactSupport + 0.005);

    // Remove only the velocity component directed into the surface. The
    // return deck is inverted, so it also needs a small two-sided contact
    // constraint; otherwise gravity immediately pulls the car away from its
    // underside after it rotates into the inverted pose.
    const normalVel = physics.velocity.dot(contactTerrain.normal);
    if (contactTerrain.type === 'deck' || normalVel < 0 || physics.landingAssist > 0) {
      physics.velocity.addScaledVector(contactTerrain.normal, -normalVel);
    }

    // Apply impact damping ONLY on initial touchdown from air!
    if (!wasWheelContact && impactSpeed > 5.0) {
      const dampFactor = impactSpeed > 20 ? 0.85 : THREE.MathUtils.lerp(0.98, 0.90, (impactSpeed - 5.0) / 15);
      // Dampen the impact without throwing away the forward velocity that
      // carries the car along the landing surface.
      physics.velocity.multiplyScalar(dampFactor);
      cameraShake = Math.min(1.0, impactSpeed / 20);
      showToastMessage(`LANDING LOAD ${impactSpeed.toFixed(1)} M/S`);
      physics.landed = true;
      physics.landingAssist = 0.24;
    }

    physics.wheelContact = true;
    if (physics.spinActive) stopSingleSpin();
    physics.landingAssist = Math.max(0, physics.landingAssist - dt);
    physics.angularVelocity.multiplyScalar(Math.exp(-(physics.landingAssist > 0 ? 28 : 12) * dt));
  } else {
    physics.wheelContact = false;
    physics.landed = false;
    physics.landingAssist = Math.max(0, physics.landingAssist - dt);
    physics.angularVelocity.multiplyScalar(Math.exp(-1.45 * dt));
  }
  if (physics.angularVelocity.lengthSq() > 38) physics.angularVelocity.setLength(6.15);

  if (!physics.wheelContact) {
    physics.airborneTime += dt;
    physics.launchPeak = Math.max(physics.launchPeak, physics.position.y);
  } else {
    physics.airborneTime = Math.max(0, physics.airborneTime - dt * 2);
  }

  if (physics.position.y < -12) resetRun();
  vehicleRoot.position.copy(physics.position);
  vehicleRoot.quaternion.copy(physics.quaternion);
}

function updatePhysics(dt) {
  // A fast car can cross a ramp edge in a single render frame. Fixed-size
  // substeps keep the contact solver from skipping the ramp or road surface.
  const steps = Math.max(1, Math.ceil(dt / PHYSICS_STEP));
  const stepDt = dt / steps;
  for (let step = 0; step < steps; step += 1) updatePhysicsStep(stepDt);
}

let cameraShake = 0;
let previousForwardSpeed = 0;
const audio = {
  context: null,
  master: null,
  rearGain: null,
  liftGain: null,
  rcsGain: null,
  rearOsc: null,
  liftOsc: null,
  noiseGain: null,
};

function initAudio() {
  if (audio.context) {
    if (audio.context.state === 'suspended') audio.context.resume();
    return;
  }
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  const context = new AudioContext();
  const master = context.createGain();
  master.gain.value = 0.14;
  master.connect(context.destination);
  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = -18;
  compressor.knee.value = 14;
  compressor.ratio.value = 7;
  compressor.connect(master);

  const rearOsc = context.createOscillator();
  rearOsc.type = 'sawtooth';
  rearOsc.frequency.value = 48;
  const rearFilter = context.createBiquadFilter();
  rearFilter.type = 'lowpass';
  rearFilter.frequency.value = 850;
  const rearGain = context.createGain();
  rearGain.gain.value = 0;
  rearOsc.connect(rearFilter).connect(rearGain).connect(compressor);
  rearOsc.start();

  const liftOsc = context.createOscillator();
  liftOsc.type = 'triangle';
  liftOsc.frequency.value = 84;
  const liftGain = context.createGain();
  liftGain.gain.value = 0;
  liftOsc.connect(liftGain).connect(compressor);
  liftOsc.start();

  const rcsOsc = context.createOscillator();
  rcsOsc.type = 'square';
  rcsOsc.frequency.value = 135;
  const rcsGain = context.createGain();
  rcsGain.gain.value = 0;
  rcsOsc.connect(rcsGain).connect(compressor);
  rcsOsc.start();

  const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  const noise = context.createBufferSource();
  noise.buffer = buffer;
  noise.loop = true;
  const noiseFilter = context.createBiquadFilter();
  noiseFilter.type = 'bandpass';
  noiseFilter.frequency.value = 740;
  noiseFilter.Q.value = 0.45;
  const noiseGain = context.createGain();
  noiseGain.gain.value = 0;
  noise.connect(noiseFilter).connect(noiseGain).connect(compressor);
  noise.start();

  Object.assign(audio, { context, master, rearGain, liftGain, rcsGain, rearOsc, liftOsc, noiseGain });
}

function updateAudio(rearPower, liftPower, rcsPower) {
  if (!audio.context || !audioEnabled) return;
  const now = audio.context.currentTime;
  const rear = Math.min(1, rearPower / 118000);
  const lift = Math.min(1, liftPower / 33000);
  const rcs = Math.min(1, rcsPower);
  audio.rearGain.gain.setTargetAtTime(rear * 0.17, now, 0.04);
  audio.liftGain.gain.setTargetAtTime(lift * 0.12, now, 0.04);
  audio.rcsGain.gain.setTargetAtTime(rcs * 0.035, now, 0.03);
  audio.noiseGain.gain.setTargetAtTime(Math.max(rear, lift) * 0.1, now, 0.04);
  audio.rearOsc.frequency.setTargetAtTime(42 + rear * 68, now, 0.04);
  audio.liftOsc.frequency.setTargetAtTime(72 + lift * 82, now, 0.04);
  audio.master.gain.setTargetAtTime(0.14, now, 0.05);
}

function silenceAudio() {
  if (!audio.context) return;
  const now = audio.context.currentTime;
  audio.rearGain.gain.setTargetAtTime(0, now, 0.04);
  audio.liftGain.gain.setTargetAtTime(0, now, 0.04);
  audio.rcsGain.gain.setTargetAtTime(0, now, 0.04);
  audio.noiseGain.gain.setTargetAtTime(0, now, 0.04);
}

function updateJet(jet, power) {
  const value = THREE.MathUtils.clamp(power, 0, 1);
  jet.power = value;
  const active = value > 0.02;
  jet.plume.material.opacity = active ? 0.08 + value * 0.2 : 0;
  jet.core.material.opacity = active ? 0.14 + value * 0.25 : 0;
  jet.plume.visible = active;
  jet.core.visible = active;
  const length = value * (jet.channel === 'rear' ? (input.boost ? 1.5 : 1.22) : jet.channel === 'lift' ? 1.35 : 1.08);
  const width = 0.55 + value * 0.8;
  jet.plume.scale.set(width, length, width);
  jet.core.scale.set(0.78, value, 0.78);
}

function emitAirReleaseFromJets(pool, jets, pressure, rate, dt, boost = false) {
  const budget = renderQuality === 'low' ? 0.6 : 1;
  pool.spawnAccumulator += pressure * rate * budget * dt;
  let emitted = 0;
  while (pool.spawnAccumulator >= 1 && emitted < 12) {
    pool.spawnAccumulator -= 1;
    let jet = jets[pool.nextJet++ % jets.length];
    if (jets.length > 1 && jet.power <= 0.02) jet = jets.find((candidate) => candidate.power > 0.02) ?? jet;
    pool.emit(jet, Math.max(pressure, jet.power), physics, boost);
    emitted += 1;
  }
}

function updateEffects(dt) {
  const reservoir = THREE.MathUtils.clamp(physics.air / 18, 0, 1);
  // Keep a visible low-pressure vapor trail while the car is accelerating on
  // the road, even when W is using the ground motor rather than ArrowUp's
  // dedicated rear-thruster force. Full rear/boost thrust still dominates it.
  const driveVapor = physics.wheelContact && input.drive > 0 ? 0.5 : 0;
  const rearDemand = Math.max(driveVapor, input.rear * (input.boost ? 1 : 0.82)) * reservoir;
  const liftDemand = input.lift * reservoir;
  const spiral = !physics.wheelContact ? (Math.abs(input.spiral) + (autoSpiral ? 0.75 : 0)) * reservoir : 0;
  const rcsDemand = Math.min(1, Math.abs(input.yaw) + Math.abs(input.pitch) + spiral * 0.7 + (physics.spinActive ? 0.85 : 0)) * reservoir;
  visualPressure.rear = THREE.MathUtils.damp(visualPressure.rear, rearDemand, rearDemand > visualPressure.rear ? 18 : 8, dt);
  visualPressure.lift = THREE.MathUtils.damp(visualPressure.lift, liftDemand, liftDemand > visualPressure.lift ? 20 : 9, dt);
  visualPressure.rcs = THREE.MathUtils.damp(visualPressure.rcs, rcsDemand, rcsDemand > visualPressure.rcs ? 22 : 10, dt);
  effects.rear.forEach((jet) => updateJet(jet, visualPressure.rear));
  effects.lift.forEach((jet) => updateJet(jet, visualPressure.lift));
  effects.rcs.forEach((jet) => {
    const directionalYaw = jet.channel === 'yaw' ? Math.max(0, input.yaw * jet.side) : 0;
    const rollPower = jet.channel === 'roll' ? Math.abs(input.roll) + Math.abs(input.pitch) + spiral + (physics.spinActive ? 0.9 : 0) : 0;
    updateJet(jet, visualPressure.rcs * (directionalYaw + rollPower));
  });

  if (!paused && !helpOpen) {
    emitAirReleaseFromJets(airRearPool, effects.rear, visualPressure.rear, input.boost ? 130 : 100, dt, input.boost);
    emitAirReleaseFromJets(airLiftPool, effects.lift, visualPressure.lift, 240, dt);
    emitAirReleaseFromJets(airRcsPool, effects.rcs, visualPressure.rcs, 48, dt);
    airReleasePools.forEach((pool) => pool.update(dt, smokeGroundHeight, canvas.height));
  }
  updateAudio(visualPressure.rear * (input.boost ? 118000 : 76000), visualPressure.lift * 33000, visualPressure.rcs);
  cameraShake = Math.max(0, cameraShake - dt * 2.9);
}

function updateCamera(dt) {
  const sideProfile = activeTrack === 2 && cameraAngle === 'stunt-side';
  if (sideProfile) {
    // A dedicated orthographic camera gives a real 2D side/profile view. It
    // frames the complete stunt approach (z≈46), ramp (z≈-55..-73), and
    // return deck without perspective cropping the car off-screen.
    tmp.cameraPosition.set(90, 21, -12);
    tmp.cameraTarget.set(0, 17, -12);
    const cameraEase = 1 - Math.pow(0.0001, dt);
    sideCamera.position.lerp(tmp.cameraPosition, cameraEase);
    cameraRoll = THREE.MathUtils.damp(cameraRoll, 0, 6, dt);
    sideCamera.up.set(0, 1, 0);
    sideCamera.lookAt(tmp.cameraTarget);
    const aspect = window.innerWidth / Math.max(window.innerHeight, 1);
    const halfHeight = Math.max(42, 72 / aspect);
    sideCamera.left = -halfHeight * aspect;
    sideCamera.right = halfHeight * aspect;
    sideCamera.top = halfHeight;
    sideCamera.bottom = -halfHeight;
    sideCamera.updateProjectionMatrix();
    return;
  }

  tmp.forward.copy(FORWARD).applyQuaternion(physics.quaternion).normalize();
  tmp.flatForward.copy(tmp.forward).setY(0);
  if (tmp.flatForward.lengthSq() < 0.001) tmp.flatForward.set(0, 0, -1);
  tmp.flatForward.normalize();
  tmp.flatRight.copy(RIGHT).applyQuaternion(physics.quaternion).setY(0);
  if (tmp.flatRight.lengthSq() < 0.001) tmp.flatRight.set(1, 0, 0);
  tmp.flatRight.normalize();
  const actionFlight = cameraAngle === 'action' && physics.airborneTime > 0.2;
  const rampOverview = cameraAngle === 'ramp';
  const followDistance = rampOverview ? 25 : actionFlight ? 16.4 : physics.airborneTime > 0.2 ? 14.2 : 11.8;
  const cameraHeight = rampOverview ? 12 : actionFlight ? 6.2 : physics.airborneTime > 0.2 ? 4.8 : 3.8;
  tmp.cameraPosition.copy(physics.position);
  if (rampOverview) {
    tmp.cameraPosition.addScaledVector(cameraSteerLock ? new THREE.Vector3(0, 0, -1) : tmp.flatForward, -followDistance);
    tmp.cameraPosition.x += 18;
    tmp.cameraPosition.y += 5;
  } else if (cameraAngle === 'front') tmp.cameraPosition.addScaledVector(tmp.flatForward, followDistance);
  else if (cameraAngle === 'left') tmp.cameraPosition.addScaledVector(tmp.flatRight, -followDistance);
  else if (cameraAngle === 'right') tmp.cameraPosition.addScaledVector(tmp.flatRight, followDistance);
  else tmp.cameraPosition.addScaledVector(tmp.flatForward, -followDistance);
  tmp.cameraPosition.addScaledVector(UP, cameraHeight + Math.min(physics.position.y * 0.12, 4));
  if (actionFlight) {
    const orbit = Math.sin(clock.elapsedTime * 0.85) * 2.8;
    tmp.cameraPosition.x += Math.cos(clock.elapsedTime * 0.85) * orbit;
    tmp.cameraPosition.z += Math.sin(clock.elapsedTime * 0.85) * orbit;
  }
  const cameraTerrain = getTerrainInfo(tmp.cameraPosition.x, tmp.cameraPosition.z);
  tmp.cameraPosition.y = Math.max(tmp.cameraPosition.y, cameraTerrain.height + 3.1);
  if (cameraShake > 0) {
    tmp.cameraPosition.x += (Math.random() - 0.5) * cameraShake * 0.5;
    tmp.cameraPosition.y += (Math.random() - 0.5) * cameraShake * 0.35;
  }
  const cameraEase = 1 - Math.pow(0.0001, dt);
  camera.position.lerp(tmp.cameraPosition, cameraEase);
  cameraRoll = THREE.MathUtils.damp(cameraRoll, actionFlight ? THREE.MathUtils.clamp(input.roll * 0.08 + input.spiral * 0.1, -0.12, 0.12) : 0, 4, dt);
  camera.up.set(Math.sin(cameraRoll), Math.cos(cameraRoll), 0).normalize();
  tmp.cameraTarget.copy(physics.position);
  if (rampOverview) tmp.cameraTarget.addScaledVector(cameraSteerLock ? new THREE.Vector3(0, 0, -1) : tmp.flatForward, 12);
  else if (cameraAngle === 'rear' || actionFlight) tmp.cameraTarget.addScaledVector(tmp.flatForward, 8);
  else if (cameraAngle === 'front') tmp.cameraTarget.addScaledVector(tmp.flatForward, -2);
  else tmp.cameraTarget.addScaledVector(tmp.flatForward, 3);
  tmp.cameraTarget.addScaledVector(UP, 0.82);
  camera.lookAt(tmp.cameraTarget);
  camera.fov = THREE.MathUtils.damp(camera.fov, 62 + Math.min(10, physics.velocity.length() * 0.07), 5, dt);
  camera.updateProjectionMatrix();
}

function updateTraffic(dt) {
  traffic.forEach((vehicle) => {
    vehicle.object.position.z += vehicle.speed * dt;
    if (vehicle.object.position.z > 115) vehicle.object.position.z = -220;
    if (vehicle.object.position.z < -225) vehicle.object.position.z = 112;
  });
}

function updateHUD(dt) {
  const speed = physics.velocity.length() * 3.6;
  const forwardSpeed = physics.velocity.dot(tmp.forward);
  const longitudinalG = THREE.MathUtils.clamp((forwardSpeed - previousForwardSpeed) / Math.max(dt, 0.001) / 9.81, -3, 5);
  previousForwardSpeed = forwardSpeed;
  const hudTerrain = getTerrainInfo(physics.position.x, physics.position.z);
  const altitude = Math.max(0, physics.position.y - (hudTerrain.hasSurface ? hudTerrain.height : 0) - vehicleSupportOffset);
  const status = physics.airborneTime > 0.4 ? 'AIRBORNE / CONTROL ACTIVE' : physics.wheelContact ? 'SYSTEMS NOMINAL' : 'FREE VECTOR';
  const mission = activeTrack === 2 ? (physics.airborneTime > 0.1 ? (autoSpiral ? 'AUTO SPIRAL ACTIVE' : hudTerrain.name) : hudTerrain.name) : (physics.launchPeak > 18 ? 'VECTOR UNLOCKED' : physics.airborneTime > 0.1 ? (autoSpiral ? 'AUTO SPIRAL ACTIVE' : 'AIRBORNE — STABILIZE') : physics.position.z < -50 ? 'APPROACH RAMP' : 'READY TO DRIVE');
  const progress = activeTrack === 2 ? THREE.MathUtils.clamp((46 - physics.position.z) / 246 * 100, 0, 100) : THREE.MathUtils.clamp(Math.max(physics.position.z < -40 ? (40 - physics.position.z) / 72 : 0, physics.launchPeak / 27) * 100, 0, 100);

  document.querySelector('#speed-readout').textContent = String(Math.round(speed)).padStart(3, '0');
  document.querySelector('#speed-state').textContent = speed > 125 ? 'REDLINE' : speed > 60 ? 'VECTORING' : speed > 2 ? 'ROLLING' : 'IDLE';
  document.querySelector('#speed-fill').style.width = `${Math.min(100, speed / 2.3)}%`;
  document.querySelector('#g-readout').textContent = `${longitudinalG >= 0 ? '+' : ''}${longitudinalG.toFixed(1)}`;
  const gMagnitude = Math.min(50, Math.abs(longitudinalG) * 17 + 4);
  const gFill = document.querySelector('#g-fill');
  gFill.style.width = `${gMagnitude}%`;
  gFill.style.marginLeft = longitudinalG < 0 ? `${50 - gMagnitude}%` : '50%';
  gFill.style.background = longitudinalG < 0 ? 'var(--pink)' : '#ffffff';
  document.querySelector('#altitude-readout').textContent = altitude.toFixed(1).padStart(5, '0');
  document.querySelector('#vertical-readout').textContent = `V/S ${physics.velocity.y >= 0 ? '+' : ''}${physics.velocity.y.toFixed(1).padStart(4, '0')} M/S`;
  document.querySelector('#air-readout').textContent = String(Math.round(physics.air)).padStart(3, '0');
  document.querySelector('#mission-label').textContent = mission;
  document.querySelector('#mission-progress').style.width = `${progress}%`;
  document.querySelector('#flight-status').textContent = status;
  document.querySelector('#camera-button').classList.toggle('active', cameraAngle !== 'rear');
  document.querySelector('#camera-button').title = `Camera: ${cameraAngle.toUpperCase()} (press C)`;
  document.querySelector('#camera-lock-button').classList.toggle('active', cameraSteerLock);
  document.querySelector('#camera-lock-button').title = cameraSteerLock ? 'Camera heading locked' : 'Camera follows vehicle heading';
  document.querySelector('#camera-select').value = cameraAngle;
  document.querySelector('#spiral-button').classList.toggle('active', autoSpiral);
  document.querySelector('#track-button').classList.toggle('active', activeTrack === 2);
  document.querySelector('#track-button').title = activeTrack === 1 ? 'Switch to Stunt Vector track' : 'Switch to Road 01';
  document.querySelector('#traffic-button').classList.toggle('active', trafficVisible);
  document.querySelector('#vacuum-button').classList.toggle('active', vacuumEnabled);
  document.querySelector('#vacuum-button').title = vacuumEnabled ? 'Vacuum ON — release with V' : 'Vacuum OFF — press V to stick to surfaces';
}

function applyTheme(nextTheme, announce = true) {
  theme = nextTheme;
  shell.dataset.theme = theme;
  const isDay = theme === 'day';
  scene.background.set(isDay ? 0x9bbdca : 0x010204);
  if (scene.fog) {
    scene.fog.color.set(isDay ? 0x9bbdca : 0x010204);
    scene.fog.near = isDay ? 85 : 45;
    scene.fog.far = isDay ? 280 : 240;
  }
  hemiLight.color.set(isDay ? 0xd6edff : 0x747474);
  hemiLight.groundColor.set(isDay ? 0x71858d : 0x070707);
  hemiLight.intensity = isDay ? 2.2 : 2.0;
  sunLight.intensity = isDay ? 4.4 : 1.45;
  sunLight.color.set(isDay ? 0xfff2d7 : 0xffe7bd);
  rimLight.intensity = isDay ? 1.4 : 1.2;
  const stars = environment.getObjectByName('stars');
  if (stars) stars.visible = !isDay;
  document.querySelector('#theme-button').title = isDay ? 'Switch to night theme' : 'Switch to day theme';
  if (announce) showToastMessage(`${isDay ? 'DAYLIGHT' : 'NIGHT RUN'} THEME ENABLED`);
}

function showToastMessage(message) {
  const toast = document.querySelector('#toast');
  toast.textContent = message;
  toast.classList.remove('show');
  void toast.offsetWidth;
  toast.classList.add('show');
  window.clearTimeout(showToastMessage.timeout);
  showToastMessage.timeout = window.setTimeout(() => toast.classList.remove('show'), 2800);
}

function toggleHelp(force) {
  const overlay = document.querySelector('#help-overlay');
  const visible = typeof force === 'boolean' ? force : !overlay.classList.contains('open');
  helpOpen = visible;
  overlay.classList.toggle('open', visible);
  overlay.setAttribute('aria-hidden', String(!visible));
  if (visible) {
    keys.clear();
    clearInput();
    silenceAudio();
  } else {
    initAudio();
  }
}

function togglePause(force) {
  paused = typeof force === 'boolean' ? force : !paused;
  document.querySelector('#pause-overlay').classList.toggle('open', paused);
  document.querySelector('#pause-button').title = paused ? 'Resume simulation' : 'Pause simulation';
  if (paused) {
    keys.clear();
    clearInput();
    silenceAudio();
  } else initAudio();
}

function clearInput() {
  Object.keys(input).forEach((key) => { input[key] = 0; });
}

function toggleAutoSpiral(force) {
  autoSpiral = typeof force === 'boolean' ? force : !autoSpiral;
  document.querySelector('#spiral-button').classList.toggle('active', autoSpiral);
  showToastMessage(autoSpiral ? 'AUTO SPIRAL ARMED / AIRBORNE ONLY' : 'AUTO SPIRAL OFF');
}

function cycleCamera() {
  const angles = activeTrack === 2 ? ['rear', 'front', 'left', 'right', 'action', 'ramp', 'stunt-side'] : ['rear', 'front', 'left', 'right', 'action', 'ramp'];
  setCameraAngle(angles[(angles.indexOf(cameraAngle) + 1) % angles.length]);
}

function setCameraAngle(angle, announce = true) {
  const angles = ['rear', 'front', 'left', 'right', 'action', 'ramp', 'stunt-side'];
  if (angle === 'stunt-side' && activeTrack !== 2) {
    cameraAngle = 'rear';
    document.querySelector('#camera-select').value = cameraAngle;
    if (announce) showToastMessage('STUNT SIDE PROFILE / SWITCH TO TRACK 02');
    return;
  }
  cameraAngle = angles.includes(angle) ? angle : 'rear';
  document.querySelector('#camera-select').value = cameraAngle;
  if (announce) showToastMessage(`CAMERA / ${cameraAngle.toUpperCase()}`);
}

function setTrackMode(mode) {
  const nextTrack = Number(mode) === 2 ? 2 : 1;
  activeTrack = nextTrack;
  trackOneRoot.visible = activeTrack === 1;
  trackTwoRoot.visible = activeTrack === 2;
  trafficRoot.visible = trafficVisible && activeTrack === 1;
  keys.clear();
  clearInput();
  setCameraAngle('rear', false);
  resetRun(false);
  showToastMessage(activeTrack === 1 ? 'ROAD 01 / VERTICAL VECTOR ONLINE' : 'TRACK 02 / STUNT VECTOR ONLINE');
}

function toggleTrack() {
  setTrackMode(activeTrack === 1 ? 2 : 1);
}

function toggleTraffic(force) {
  trafficVisible = typeof force === 'boolean' ? force : !trafficVisible;
  trafficRoot.visible = trafficVisible && activeTrack === 1;
  document.querySelector('#traffic-button').classList.toggle('active', trafficVisible);
  showToastMessage(trafficVisible ? 'TRAFFIC CARS ON' : 'TRAFFIC CARS OFF');
}

function toggleVacuum(force) {
  vacuumEnabled = typeof force === 'boolean' ? force : !vacuumEnabled;
  document.querySelector('#vacuum-button').classList.toggle('active', vacuumEnabled);
  showToastMessage(vacuumEnabled ? 'VACUUM ADHESION ON / SURFACE LOCK ARMED' : 'VACUUM OFF / GRAVITY ACTIVE');
}

function toggleCameraLock(force) {
  cameraSteerLock = typeof force === 'boolean' ? force : !cameraSteerLock;
  document.querySelector('#camera-lock-button').classList.toggle('active', cameraSteerLock);
  showToastMessage(cameraSteerLock ? 'CAMERA HEADING LOCKED' : 'CAMERA HEADING FOLLOWING');
}

function toggleHeadlights() {
  vehicleLights.setEnabled(!vehicleLights.enabled);
  const button = document.querySelector('#headlights-button');
  button.classList.toggle('active', vehicleLights.enabled);
  button.setAttribute('aria-pressed', String(vehicleLights.enabled));
  button.title = `Headlights ${vehicleLights.enabled ? 'on' : 'off'} (L)`;
  showToastMessage(`HEADLIGHTS ${vehicleLights.enabled ? 'ON' : 'OFF'}`);
}

function applyRenderQuality() {
  renderer.setPixelRatio(pixelRatioFor(window.innerWidth, window.innerHeight, window.devicePixelRatio,
    renderQuality, renderQuality === 'auto' ? adaptiveResolution.scale : 1));
  const button = document.querySelector('#quality-button');
  button.textContent = renderQuality === 'balanced' ? 'BAL' : renderQuality.toUpperCase();
  button.title = `Rendering quality: ${renderQuality}. Click to change.`;
}

window.addEventListener('keydown', (event) => {
  const blocked = ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
  if (blocked.includes(event.code)) event.preventDefault();
  initAudio();
  if (!event.repeat) {
    if (event.code === 'KeyH') toggleHelp();
    if (event.code === 'KeyP' || event.code === 'Escape') togglePause();
    if (event.code === 'KeyT') applyTheme(theme === 'night' ? 'day' : 'night');
    if (event.code === 'KeyR') resetRun();
    if (event.code === 'KeyO') toggleAutoSpiral();
    if (event.code === 'KeyC') cycleCamera();
    if (event.code === 'KeyV') toggleVacuum();
    if (event.code === 'Digit1') setTrackMode(1);
    if (event.code === 'Digit2') setTrackMode(2);
    if (event.code === 'KeyB') toggleTraffic();
    if (event.code === 'KeyL') toggleHeadlights();
  }
  if (helpOpen && event.code !== 'KeyH') return;
  if (!event.repeat && event.code === 'KeyQ') startSingleSpin(-1);
  if (!event.repeat && event.code === 'KeyE') startSingleSpin(1);
  keys.add(event.code);
});

window.addEventListener('keyup', (event) => keys.delete(event.code));
window.addEventListener('blur', () => {
  keys.clear();
  clearInput();
  if (!paused) silenceAudio();
});

document.querySelector('#theme-button').addEventListener('click', () => {
  initAudio();
  applyTheme(theme === 'night' ? 'day' : 'night');
});
document.querySelector('#sound-button').addEventListener('click', () => {
  initAudio();
  audioEnabled = !audioEnabled;
  document.querySelector('#sound-button').classList.toggle('muted', !audioEnabled);
  if (!audioEnabled) silenceAudio();
  showToastMessage(audioEnabled ? 'THRUSTER AUDIO ONLINE' : 'THRUSTER AUDIO MUTED');
});
document.querySelector('#pause-button').addEventListener('click', () => togglePause());
document.querySelector('#headlights-button').addEventListener('click', toggleHeadlights);
document.querySelector('#quality-button').addEventListener('click', () => {
  renderQuality = qualityModes[(qualityModes.indexOf(renderQuality) + 1) % qualityModes.length];
  adaptiveResolution.scale = 1;
  applyRenderQuality();
  showToastMessage(`RENDER QUALITY / ${renderQuality.toUpperCase()}`);
});
document.querySelector('#camera-button').addEventListener('click', () => cycleCamera());
document.querySelector('#camera-lock-button').addEventListener('click', () => toggleCameraLock());
document.querySelector('#camera-select').addEventListener('change', (event) => setCameraAngle(event.target.value));
document.querySelector('#spiral-button').addEventListener('click', () => toggleAutoSpiral());
document.querySelector('#track-button').addEventListener('click', () => toggleTrack());
document.querySelector('#traffic-button').addEventListener('click', () => toggleTraffic());
document.querySelector('#vacuum-button').addEventListener('click', () => toggleVacuum());
document.querySelector('#car-select').addEventListener('change', (event) => loadCarModel(event.target.value));
document.querySelector('#resume-button').addEventListener('click', () => togglePause(false));
document.querySelector('#close-help').addEventListener('click', () => toggleHelp(false));
document.querySelector('#close-help-button').addEventListener('click', () => toggleHelp(false));
canvas.addEventListener('pointerdown', initAudio);
document.querySelectorAll('[data-drive-key]').forEach((button) => {
  const code = button.dataset.driveKey;
  button.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    if (paused || helpOpen) return;
    button.setPointerCapture(event.pointerId);
    initAudio();
    keys.add(code);
    if (code === 'KeyQ') startSingleSpin(-1);
    if (code === 'KeyE') startSingleSpin(1);
  });
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    button.addEventListener(event, () => keys.delete(code));
  }
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  const sideHalfWidth = 42 * (window.innerWidth / Math.max(window.innerHeight, 1));
  sideCamera.left = -sideHalfWidth;
  sideCamera.right = sideHalfWidth;
  sideCamera.top = 42;
  sideCamera.bottom = -42;
  sideCamera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  applyRenderQuality();
});

applyTheme('night', false);
applyRenderQuality();
const requestedTrack = new URLSearchParams(window.location.search).get('track');
if (requestedTrack === '2') setTrackMode(2);
else resetRun(false);
showToastMessage('PRESS H FOR CONTROLS / W TO IGNITE');

let hudElapsed = 0;
let frameElapsed = 0;
function animate() {
  requestAnimationFrame(animate);
  const frameDt = clock.getDelta();
  if (document.hidden) { frameElapsed = 0; return; }
  // Cap high-refresh displays at 60 rendered FPS instead of consuming the
  // entire GPU at 144/240 Hz. Physics retains its 120 Hz substeps.
  frameElapsed += frameDt;
  if (frameElapsed < 1 / 60 - 0.001) return;
  if (renderQuality === 'auto' && adaptiveResolution.sample(frameElapsed)) applyRenderQuality();
  const dt = Math.min(frameElapsed, 0.04);
  frameElapsed = 0;
  if (!paused && !helpOpen) {
    updatePhysics(dt);
    updateTraffic(dt);
  }
  updateEffects(dt);
  updateCamera(dt);
  streetLighting.update(activeTrack, physics.position, theme === 'day');
  vehicleLights.update(input.drive < 0 && physics.velocity.dot(tmp.forward) > 1);
  hudElapsed += dt;
  if (hudElapsed >= 0.1) { updateHUD(hudElapsed); hudElapsed = 0; }
  const renderCamera = activeTrack === 2 && cameraAngle === 'stunt-side' ? sideCamera : camera;
  renderer.render(scene, renderCamera);
}

animate();
