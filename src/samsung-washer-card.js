// Samsung Washer Card for Home Assistant — https://github.com/cryptooth/ha-samsung-washing-card
// An animated three.js washer / washer-dryer: dark stage, a mood tint from the current phase, glass panels.
// Works with the core SmartThings integration's entities (switch.<x>, sensor.<x>_job_state,
// sensor.<x>_machine_state, sensor.<x>_completion_time, ...); every id can be overridden.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

const VERSION = '1.0.0';
const STAGE_BG = '#0a0e1a';

/* ---------- phases ---------- */

// What each phase looks like: label, mood colour, and how the drum behaves.
//   water: fill level (0..1 of the drum's height)   omega: drum speed in rad/s
//   swap:  reverse direction every N seconds (0 = never)   heat/steam/bubbles: 0..1
const PHASES = {
  off:     { color: '#46506a', water: 0,    omega: 0,   swap: 0,  heat: 0,   bubbles: 0 },
  idle:    { color: '#3d8bff', water: 0,    omega: 0,   swap: 0,  heat: 0,   bubbles: 0 },
  delay:   { color: '#8f9bb8', water: 0, omega: 0,   swap: 0,  heat: 0,   bubbles: 0 },
  sensing: { color: '#7aa7ff', water: 0,    omega: 1.4, swap: 1.6, heat: 0,  bubbles: 0 },
  prewash: { color: '#3d8bff', water: 0.36, omega: 2.0, swap: 7,  heat: 0,   bubbles: 0.6 },
  wash:    { color: '#3d8bff', water: 0.42, omega: 2.3, swap: 8,  heat: 0,   bubbles: 1 },
  rinse:   { color: '#36c8ec', water: 0.5,  omega: 2.1, swap: 6,  heat: 0,   bubbles: 0.25 },
  spin:    { color: '#8b6cff', water: 0,    omega: 15,  swap: 0,  heat: 0,   bubbles: 0 },
  dry:     { color: '#ff8c3a', water: 0,    omega: 2.6, swap: 10, heat: 1,   bubbles: 0 },
  cool:    { color: '#62e0cf', water: 0,    omega: 2.2, swap: 10, heat: 0.15, bubbles: 0 },
  wrinkle: { color: '#c9a7ff', water: 0,    omega: 1.8, swap: 4,  heat: 0,   bubbles: 0 },
  finish:  { color: '#4ade80', water: 0,    omega: 0,   swap: 0,  heat: 0,   bubbles: 0 },
  pause:   { color: '#ffb46b', water: -1,   omega: 0,   swap: 0,  heat: 0,   bubbles: 0 },
  unavailable: { color: '#46506a', water: 0, omega: 0,   swap: 0,  heat: 0,   bubbles: 0 },
};

// SmartThings washerJobState / dryerJobState values → our phases.
const JOB_MAP = {
  none: null,
  weight_sensing: 'sensing', weightsensing: 'sensing',
  pre_wash: 'prewash', prewash: 'prewash',
  wash: 'wash', ai_wash: 'wash', aiwash: 'wash', air_wash: 'wash', airwash: 'wash', soaking: 'wash',
  rinse: 'rinse', ai_rinse: 'rinse', airinse: 'rinse',
  spin: 'spin', ai_spin: 'spin', aispin: 'spin',
  drying: 'dry', ai_drying: 'dry', refreshing: 'dry', sanitizing: 'dry', dehumidifying: 'dry',
  continuous_dehumidifying: 'dry', internal_care: 'dry', thawing_frozen_inside: 'dry',
  cooling: 'cool',
  wrinkle_prevent: 'wrinkle', wrinkleprevent: 'wrinkle',
  finish: 'finish', finished: 'finish',
  delay_wash: 'delay', delaywash: 'delay',
  freeze_protection: 'idle',
};

const STEP_ORDER = ['wash', 'rinse', 'spin', 'dry'];
const DRYER_STEPS = ['sensing', 'dry', 'cool'];
const DRYER_STEP_OF = { sensing: 'sensing', dry: 'dry', cool: 'cool', wrinkle: 'cool', finish: 'done' };
const STEP_OF = { sensing: 'wash', prewash: 'wash', wash: 'wash', rinse: 'rinse', spin: 'spin', dry: 'dry', cool: 'dry', wrinkle: 'dry', finish: 'done' };

/* ---------- text ---------- */

// English by default; other languages follow Home Assistant's UI language (or `language:` in the config).
// Missing keys fall back to English, so a partial translation is fine.
const STRINGS = {
  en: {
    phase: {
      off: 'Off', idle: 'Ready', delay: 'Delayed start', sensing: 'Weighing load', prewash: 'Pre-wash', wash: 'Washing',
      rinse: 'Rinsing', spin: 'Spinning', dry: 'Drying', cool: 'Cooling down', wrinkle: 'Wrinkle prevent', finish: 'Done',
      pause: 'Paused', unavailable: 'Unavailable',
    },
    step: { wash: 'Wash', rinse: 'Rinse', spin: 'Spin', dry: 'Dry', sensing: 'Sensing', cool: 'Cool down' },
    word: { finish: 'Laundry is ready', off: 'Off', idle: 'Ready', pause: 'Paused', delay: 'Starting later', unavailable: 'Unavailable' },
    hours: 'h', minutes: 'min', ends: 'Ends', unload: 'Open the door<b>and unload</b>', dryerName: 'Dryer',
    doorOpen: 'Door open', door: 'Door', open: 'Open', closed: 'Closed',
    power: 'Power', energy: 'Energy', program: 'Program',
    turnOn: 'Turn on', turnOff: 'Turn off', locked: "Can't power off while a cycle is running",
    name: 'Washer', glFail: 'Could not start the 3D view', invalid: 'Invalid configuration',
    mode: {
      cotton: 'Cotton', synthetics: 'Synthetics', eco_40_60: 'Eco 40-60', quick_wash: 'Quick wash', quick_15: "Quick 15'",
      delicates: 'Delicates', wool: 'Wool', bedding: 'Bedding', mixed_load: 'Mixed load', super_speed: 'Super speed',
      ai_wash: 'AI Wash', rinse_spin: 'Rinse + Spin', drum_clean: 'Drum clean', denim: 'Denim', towels: 'Towels',
      shirts: 'Shirts', wash_dry: 'Wash + Dry',
      normal: 'Normal', heavy_duty: 'Heavy duty', air_dry: 'Air dry', air_refresh: 'Air refresh', sanitize: 'Sanitize', time_dry: 'Time dry',
      speed_dry: 'Speed dry', low_heat: 'Low heat', auto_dry: 'Auto dry', sportswear: 'Sportswear', steam_refresh: 'Steam refresh',
    },
  },
  tr: {
    phase: {
      off: 'Kapalı', idle: 'Hazır', delay: 'Başlamayı bekliyor', sensing: 'Tartılıyor', prewash: 'Ön yıkama', wash: 'Yıkama',
      rinse: 'Durulama', spin: 'Sıkma', dry: 'Kurutma', cool: 'Soğutma', wrinkle: 'Kırışık önleme', finish: 'Bitti',
      pause: 'Duraklatıldı', unavailable: 'Bağlantı yok',
    },
    step: { wash: 'Yıkama', rinse: 'Durulama', spin: 'Sıkma', dry: 'Kurutma', sensing: 'Algılama', cool: 'Soğutma' },
    word: { finish: 'Çamaşırlar hazır', off: 'Kapalı', idle: 'Hazır', pause: 'Duraklatıldı', delay: 'Başlayacak', unavailable: 'Bağlantı yok' },
    hours: 'sa', minutes: 'dk', ends: 'Bitiş', unload: 'Kapağı açıp<b>boşaltın</b>', dryerName: 'Kurutma Makinesi',
    doorOpen: 'Kapak açık', door: 'Kapak', open: 'Açık', closed: 'Kapalı',
    power: 'Güç', energy: 'Enerji', program: 'Program',
    turnOn: 'Aç', turnOff: 'Kapat', locked: 'Program çalışırken kapatılamaz',
    name: 'Çamaşır Makinesi', glFail: '3D görünüm açılamadı', invalid: 'Geçersiz yapılandırma',
    mode: {
      cotton: 'Pamuklu', synthetics: 'Sentetik', quick_wash: 'Hızlı', quick_15: 'Hızlı 15', delicates: 'Hassas', wool: 'Yünlü',
      bedding: 'Nevresim', mixed_load: 'Karışık', super_speed: 'Süper hız', ai_wash: 'AI Yıkama', rinse_spin: 'Durulama + Sıkma',
      drum_clean: 'Tambur temizleme', denim: 'Kot', towels: 'Havlu', shirts: 'Gömlek', wash_dry: 'Yıka + Kurut',
    },
  },
};

function strings(lang) {
  const en = STRINGS.en;
  const loc = STRINGS[lang] || {};
  const out = { ...en, ...loc };
  for (const k of ['phase', 'step', 'word', 'mode']) out[k] = { ...en[k], ...(loc[k] || {}) };
  return out;
}

const BODY_COLORS = {
  white: { body: '#eceef2', rough: 0.32 },
  silver: { body: '#b9bec7', rough: 0.28, metal: 0.55 },
  black: { body: '#2a2e36', rough: 0.3, metal: 0.25 },
  beige: { body: '#e7ddcf', rough: 0.4 },
};

/* ---------- small helpers ---------- */

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const ease = (k, dt) => 1 - Math.exp(-dt * k);

function canvasTexture(w, h, draw, { repeat = false } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function roundedRectShape(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

function dotSprite(inner, outer) {
  return canvasTexture(64, 64, (g, s) => {
    const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    r.addColorStop(0, inner); r.addColorStop(0.45, outer); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, s, s);
  });
}

/* ---------- the 3D machine ---------- */

// Dimensions in metres, origin on the floor under the machine's centre, front facing +z.
const W = 0.6, H = 0.85, D = 0.6;
const DOOR_Y = 0.43;       // door / drum centre height
const HOLE_R = 0.205;      // opening through the cabinet
const R = 0.196;           // drum radius
const DRUM_D = 0.4;        // drum depth
const DRUM_Z = D / 2 - 0.07 - DRUM_D / 2; // drum centre z
const G = 4.2;             // visual gravity: real g reads too fast at this scale

class WasherScene {
  constructor(canvas, { color = 'white', bloom = true, device = 'washer' } = {}) {
    this.canvas = canvas;
    this.device = device;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.localClippingEnabled = true;
    this.renderer = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(STAGE_BG);
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = this.envTex;
    scene.environmentIntensity = 0.4;
    pmrem.dispose();
    this.scene = scene;

    this.camera = new THREE.PerspectiveCamera(28, 1, 0.05, 20);
    this.target = new THREE.Vector3(0, 0.6, 0);
    this.azimuth = 0.38; this.azimuthGoal = 0.38; this.userAz = 0;
    this.elev = 0.09; this.dist = 2.75;

    scene.add(new THREE.HemisphereLight(0x9fb4ff, 0x0b0e17, 0.55));
    const key = new THREE.DirectionalLight(0xdfe6ff, 1.1);
    key.position.set(1.6, 2.4, 2.2);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x7d93ff, 0.6);
    rim.position.set(-2, 1.2, -1.5);
    scene.add(rim);

    this.buildFloor();
    this.machine = new THREE.Group();
    scene.add(this.machine);
    this.buildCabinet(BODY_COLORS[color] || BODY_COLORS.white);
    this.buildPanel();
    this.buildDrum();
    this.buildLaundry();
    this.buildWater();
    this.buildParticles();
    this.buildDoor();

    // Post: a light bloom so the display, LEDs and the lit drum glow like the house lamps.
    if (bloom) {
      this.composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 }));
      this.composer.addPass(new RenderPass(scene, this.camera));
      this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.22, 0.4, 0.96));
      this.composer.addPass(new OutputPass());
    }

    // Live state the animation eases towards.
    this.phase = 'off';
    this.p = { ...PHASES.off };
    this.mood = new THREE.Color(PHASES.off.color);
    this.moodGoal = this.mood.clone();
    this.omega = 0; this.omegaDir = 1; this.swapClock = 0;
    this.water = 0; this.waterGoal = 0;
    this.heat = 0; this.bubbles = 0; this.spinAmt = 0;
    this.door = 0; this.doorGoal = 0;
    this.power = 0; this.powerGoal = 0;
    this.progress = 0;
    this.clock = 0;
    this.display = { a: '', b: '' };
  }

  /* --- build --- */

  buildFloor() {
    const shadow = canvasTexture(256, 256, (g, s) => {
      const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      r.addColorStop(0, 'rgba(0,0,0,0.75)'); r.addColorStop(0.55, 'rgba(0,0,0,0.35)'); r.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = r; g.fillRect(0, 0, s, s);
    });
    const contact = new THREE.Mesh(new THREE.PlaneGeometry(1.05, 1.05),
      new THREE.MeshBasicMaterial({ map: shadow, transparent: true, depthWrite: false }));
    contact.rotation.x = -Math.PI / 2; contact.position.y = 0.001;
    this.scene.add(contact);

    // Phase-coloured halo on the floor and behind the machine.
    const haloTex = dotSprite('rgba(255,255,255,0.9)', 'rgba(255,255,255,0.22)');
    this.haloMat = new THREE.MeshBasicMaterial({ map: haloTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.0, toneMapped: false });
    const floorHalo = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), this.haloMat);
    floorHalo.rotation.x = -Math.PI / 2; floorHalo.position.set(0, 0.0005, 0.25);
    this.scene.add(floorHalo);
    const backHalo = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4), this.haloMat);
    backHalo.position.set(0, 0.55, -0.6);
    this.scene.add(backHalo);
  }

  buildCabinet(c) {
    const bodyMat = new THREE.MeshStandardMaterial({ color: c.body, roughness: c.rough, metalness: c.metal || 0 });
    this.bodyMat = bodyMat;

    // Cabinet: the front silhouette with the porthole cut out, extruded back to the full depth,
    // so the drum sits inside a real tunnel instead of behind a solid box.
    const shape = roundedRectShape(W - 0.04, H - 0.04, 0.035);
    const hole = new THREE.Path();
    hole.absarc(0, DOOR_Y - H / 2, HOLE_R, 0, Math.PI * 2, true);
    shape.holes.push(hole);
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: D - 0.04, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 4, curveSegments: 48,
    });
    geo.translate(0, H / 2, -(D - 0.04) / 2);
    const cabinet = new THREE.Mesh(geo, bodyMat);
    this.machine.add(cabinet);

    const back = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.02, H - 0.02), new THREE.MeshStandardMaterial({ color: '#1a1d24', roughness: 0.8 }));
    back.position.set(0, H / 2, -D / 2 + 0.03);
    this.machine.add(back);

    // Rubber gasket bridging the cabinet opening and the drum.
    const gasketMat = new THREE.MeshStandardMaterial({ color: '#2b2f37', roughness: 0.7 });
    const gasket = new THREE.Mesh(new THREE.TorusGeometry(HOLE_R - 0.004, 0.016, 16, 64), gasketMat);
    gasket.position.set(0, DOOR_Y, D / 2 - 0.012);
    this.machine.add(gasket);
    const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(HOLE_R - 0.004, R + 0.004, 0.07, 64, 1, true), new THREE.MeshStandardMaterial({ color: '#30353e', roughness: 0.75, side: THREE.BackSide }));
    sleeve.rotation.x = Math.PI / 2; sleeve.position.set(0, DOOR_Y, D / 2 - 0.045);
    this.machine.add(sleeve);

    // Kick plate and feet.
    const kick = new THREE.Mesh(new RoundedBoxGeometry(W - 0.08, 0.05, 0.01, 2, 0.004), new THREE.MeshStandardMaterial({ color: '#c9ccd3', roughness: 0.4 }));
    kick.position.set(0, 0.055, D / 2 + 0.002);
    kick.material.color.set(c.body).multiplyScalar(0.86);
    this.machine.add(kick);
    const footMat = new THREE.MeshStandardMaterial({ color: '#15171c', roughness: 0.6 });
    for (const [x, z] of [[-0.24, 0.24], [0.24, 0.24], [-0.24, -0.24], [0.24, -0.24]]) {
      const f = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, 0.02, 16), footMat);
      f.position.set(x, 0.01, z);
      this.machine.add(f);
    }
    this.machine.position.y = 0.012;
  }

  buildPanel() {
    // Dark glass control strip across the top front, like the Bespoke AI models.
    const strip = new THREE.Mesh(new RoundedBoxGeometry(W - 0.03, 0.11, 0.012, 3, 0.005),
      new THREE.MeshStandardMaterial({ color: '#0f1218', roughness: 0.12, metalness: 0.4 }));
    strip.position.set(0, H - 0.085, D / 2 + 0.004);
    this.machine.add(strip);
    const front = D / 2 + 0.0105;

    // Detergent drawer outline + handle.
    if (this.device === 'dryer') {
      // Dryers have no detergent drawer: a heat-vent grille takes its place.
      const slotMat = new THREE.MeshStandardMaterial({ color: '#1a1e26', roughness: 0.3, metalness: 0.4 });
      for (let i = 0; i < 5; i++) {
        const slot = new THREE.Mesh(new RoundedBoxGeometry(0.11, 0.006, 0.004, 2, 0.002), slotMat);
        slot.position.set(-0.19, H - 0.06 - i * 0.0135, front);
        this.machine.add(slot);
      }
    }
    const drawer = this.device === 'dryer' ? null : new THREE.Mesh(new RoundedBoxGeometry(0.15, 0.072, 0.004, 2, 0.003), new THREE.MeshStandardMaterial({ color: '#1a1e26', roughness: 0.3, metalness: 0.4 }));
    if (drawer) {
      drawer.position.set(-0.19, H - 0.085, front);
      this.machine.add(drawer);
    }
    const handle = this.device === 'dryer' ? null : new THREE.Mesh(new RoundedBoxGeometry(0.07, 0.008, 0.006, 2, 0.003), new THREE.MeshStandardMaterial({ color: '#8d939e', roughness: 0.25, metalness: 0.9 }));
    if (handle) {
      handle.position.set(-0.19, H - 0.112, front + 0.003);
      this.machine.add(handle);
    }

    // Display (canvas texture; redrawn only when its text changes).
    this.displayCanvas = document.createElement('canvas');
    this.displayCanvas.width = 384; this.displayCanvas.height = 128;
    this.displayTex = new THREE.CanvasTexture(this.displayCanvas);
    this.displayTex.colorSpace = THREE.SRGBColorSpace;
    const disp = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.05), new THREE.MeshBasicMaterial({ map: this.displayTex, toneMapped: false, transparent: true }));
    disp.position.set(0.0, H - 0.085, front + 0.0006);
    this.machine.add(disp);

    // Program knob with a ring of LEDs that fills with progress.
    const kx = 0.19, ky = H - 0.085;
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.032, 0.022, 48), new THREE.MeshStandardMaterial({ color: '#9aa1ad', roughness: 0.22, metalness: 0.95 }));
    knob.rotation.x = Math.PI / 2; knob.position.set(kx, ky, front + 0.011);
    this.knob = knob;
    this.machine.add(knob);
    const cap = new THREE.Mesh(new THREE.CircleGeometry(0.026, 48), new THREE.MeshStandardMaterial({ color: '#1b1f27', roughness: 0.2, metalness: 0.6 }));
    cap.position.set(kx, ky, front + 0.0225);
    this.machine.add(cap);
    this.ledOff = new THREE.MeshBasicMaterial({ color: '#2a3140', toneMapped: false });
    this.leds = [];
    const ledGeo = new THREE.CircleGeometry(0.0032, 12);
    for (let i = 0; i < 24; i++) {
      const a = Math.PI / 2 - (i / 24) * Math.PI * 2;
      const m = new THREE.MeshBasicMaterial({ color: '#2a3140', toneMapped: false });
      const led = new THREE.Mesh(ledGeo, m);
      led.position.set(kx + Math.cos(a) * 0.043, ky + Math.sin(a) * 0.043, front + 0.0006);
      this.machine.add(led);
      this.leds.push(m);
    }
    this.statusLed = new THREE.MeshBasicMaterial({ color: '#2a3140', toneMapped: false });
    const sl = new THREE.Mesh(new THREE.CircleGeometry(0.0045, 16), this.statusLed);
    sl.position.set(0.255, H - 0.06, front + 0.0006);
    this.machine.add(sl);
  }

  buildDrum() {
    const drum = new THREE.Group();
    drum.position.set(0, DOOR_Y, DRUM_Z);
    this.machine.add(drum);
    this.drum = drum;

    // Perforated stainless steel, with the classic embossed pattern.
    const perf = canvasTexture(512, 256, (g, w, h) => {
      g.fillStyle = '#c8ced8'; g.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 16) {
        for (let x = (y / 16) % 2 ? 8 : 0; x < w; x += 16) {
          const r = g.createRadialGradient(x, y, 0, x, y, 7);
          r.addColorStop(0, '#d9dee6'); r.addColorStop(1, 'rgba(160,168,180,0.0)');
          g.fillStyle = r; g.beginPath(); g.arc(x, y, 7, 0, Math.PI * 2); g.fill();
          g.fillStyle = '#313742'; g.beginPath(); g.arc(x, y, 1.8, 0, Math.PI * 2); g.fill();
        }
      }
    }, { repeat: true });
    perf.repeat.set(3, 1);
    const steel = new THREE.MeshStandardMaterial({ map: perf, color: '#7d8694', metalness: 0.7, roughness: 0.4, side: THREE.BackSide });
    this.drumMat = steel;
    const shell = new THREE.Mesh(new THREE.CylinderGeometry(R, R, DRUM_D, 64, 1, true), steel);
    shell.rotation.x = Math.PI / 2;
    drum.add(shell);

    const backTex = canvasTexture(512, 512, (g, s) => {
      g.fillStyle = '#b9c0cb'; g.fillRect(0, 0, s, s);
      const c = s / 2;
      for (let ring = 40; ring < c; ring += 22) {
        const n = Math.floor((ring * Math.PI * 2) / 22);
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          g.fillStyle = '#3a404b'; g.beginPath(); g.arc(c + Math.cos(a) * ring, c + Math.sin(a) * ring, 2.2, 0, Math.PI * 2); g.fill();
        }
      }
      // Three spokes so the rotation reads even with the drum empty.
      g.strokeStyle = 'rgba(70,78,92,0.75)'; g.lineWidth = 16; g.lineCap = 'round';
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        g.beginPath(); g.moveTo(c, c); g.lineTo(c + Math.cos(a) * c * 0.92, c + Math.sin(a) * c * 0.92); g.stroke();
      }
      g.fillStyle = '#7d8592'; g.beginPath(); g.arc(c, c, 30, 0, Math.PI * 2); g.fill();
    });
    const backPlate = new THREE.Mesh(new THREE.CircleGeometry(R, 64), new THREE.MeshStandardMaterial({ map: backTex, color: '#8f97a3', metalness: 0.7, roughness: 0.4 }));
    backPlate.position.z = -DRUM_D / 2;
    drum.add(backPlate);

    // Lifters (paddles) that carry the laundry up before it tumbles.
    const lifterMat = new THREE.MeshStandardMaterial({ color: '#d6dbe3', metalness: 0.6, roughness: 0.3 });
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const l = new THREE.Mesh(new RoundedBoxGeometry(0.04, 0.03, DRUM_D * 0.92, 2, 0.012), lifterMat);
      l.position.set(Math.cos(a) * (R - 0.012), Math.sin(a) * (R - 0.012), 0);
      l.rotation.z = a + Math.PI / 2;
      drum.add(l);
    }

    // Drum light: cool white while running, warm in the dryer.
    this.drumLight = new THREE.PointLight(0xffffff, 0, 0.9, 1.6);
    this.drumLight.position.set(0, DOOR_Y + 0.12, DRUM_Z + DRUM_D / 2 - 0.02);
    this.machine.add(this.drumLight);

    // Spin blur: a streaky ring that fades in at high speed so 1400 rpm doesn't strobe.
    const blur = canvasTexture(512, 512, (g, s) => {
      const c = s / 2;
      g.translate(c, c);
      for (let i = 0; i < 70; i++) {
        const a = Math.random() * Math.PI * 2;
        const len = 0.4 + Math.random() * 1.2;
        const rr = c * (0.56 + Math.random() * 0.4);
        g.strokeStyle = `hsla(${200 + Math.random() * 120}, 60%, ${55 + Math.random() * 25}%, ${0.15 + Math.random() * 0.35})`;
        g.lineWidth = 4 + Math.random() * 14;
        g.beginPath(); g.arc(0, 0, rr, a, a + len); g.stroke();
      }
    });
    this.blurMat = new THREE.MeshBasicMaterial({ map: blur, transparent: true, opacity: 0, depthWrite: false });
    this.blur = new THREE.Mesh(new THREE.RingGeometry(R * 0.35, R * 0.99, 64), this.blurMat);
    this.blur.position.set(0, DOOR_Y, DRUM_Z + 0.02);
    this.machine.add(this.blur);
  }

  buildLaundry() {
    const palette = ['#f4f1ea', '#2d4a7a', '#ff7a6b', '#f2c14e', '#86b39a', '#b9a3e3', '#5b84c4', '#e9e4dc', '#d5604f', '#3f6f63'];
    this.clothes = [];
    const group = new THREE.Group();
    group.position.set(0, DOOR_Y, DRUM_Z);
    this.machine.add(group);
    this.laundry = group;
    let seed = 7;
    const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    for (let i = 0; i < 15; i++) {
      const size = 0.05 + rand() * 0.032;
      // Merge the icosahedron's split vertices so the lumpy cloth shades smoothly.
      const geo = mergeVertices(new THREE.IcosahedronGeometry(size, 4));
      const p = geo.attributes.position;
      const v = new THREE.Vector3();
      const s1 = rand() * 10, s2 = rand() * 10;
      for (let k = 0; k < p.count; k++) {
        v.fromBufferAttribute(p, k);
        const n = 1 + 0.22 * Math.sin(v.x * 60 + s1) * Math.sin(v.y * 50 + s2) + 0.12 * Math.sin(v.z * 80 + s1 * 2);
        v.multiplyScalar(n);
        p.setXYZ(k, v.x * 1.25, v.y * 0.62, v.z * 1.1);
      }
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: palette[i % palette.length], roughness: 0.95, metalness: 0 }));
      group.add(m);
      const rest = (rand() - 0.5) * 1.1;
      this.clothes.push({
        mesh: m, size,
        r: R - size * 0.62 - rand() * 0.035,
        z: (rand() - 0.5) * (DRUM_D - 0.12),
        phi: rest, rest,
        release: 1.3 + rand() * 0.9,
        mode: 'ride', x: 0, y: 0, vx: 0, vy: 0,
        roll: rand() * 6, rollV: 0,
      });
    }
  }

  buildWater() {
    // Water is a cylinder clipped by a (sloshing) plane; the surface is a sheet sized to the chord.
    this.waterPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
    this.waterMat = new THREE.MeshStandardMaterial({
      color: '#4fb0ff', emissive: '#1f78e0', emissiveIntensity: 0.9, roughness: 0.1, metalness: 0.1,
      transparent: true, opacity: 0.42, depthWrite: false, side: THREE.DoubleSide, clippingPlanes: [this.waterPlane],
    });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(R - 0.003, R - 0.003, DRUM_D - 0.01, 64, 1, false), this.waterMat);
    body.rotation.x = Math.PI / 2;
    body.position.set(0, DOOR_Y, DRUM_Z);
    body.renderOrder = 2;
    this.machine.add(body);
    this.waterBody = body;

    this.surfMat = new THREE.MeshStandardMaterial({ color: '#bfe6ff', emissive: '#4aa3e8', emissiveIntensity: 0.25, roughness: 0.05, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide });
    this.surface = new THREE.Mesh(new THREE.PlaneGeometry(1, DRUM_D - 0.01), this.surfMat);
    this.surface.rotation.x = -Math.PI / 2;
    this.surface.position.set(0, DOOR_Y, DRUM_Z);
    this.surface.renderOrder = 3;
    this.machine.add(this.surface);
  }

  buildParticles() {
    const mk = (n, tex, size, blending) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      const mat = new THREE.PointsMaterial({ map: tex, size, transparent: true, depthWrite: false, opacity: 0, blending, sizeAttenuation: true });
      const pts = new THREE.Points(geo, mat);
      pts.position.set(0, DOOR_Y, DRUM_Z);
      pts.frustumCulled = false;
      pts.renderOrder = 4;
      this.machine.add(pts);
      return pts;
    };
    const ring = canvasTexture(64, 64, (g, s) => {
      g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineWidth = 5;
      g.beginPath(); g.arc(s / 2, s / 2, s / 2 - 6, 0, Math.PI * 2); g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.25)'; g.beginPath(); g.arc(s / 2, s / 2, s / 2 - 8, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.95)'; g.beginPath(); g.arc(s * 0.38, s * 0.36, 5, 0, Math.PI * 2); g.fill();
    });
    this.bubblePts = mk(140, ring, 0.018, THREE.NormalBlending);
    this.bubbleSeeds = Array.from({ length: 140 }, () => ({ x: 0, y: -R, z: 0, v: 0, life: Math.random() }));
    this.steamPts = mk(90, dotSprite('rgba(255,236,214,0.9)', 'rgba(255,190,140,0.25)'), 0.09, THREE.AdditiveBlending);
    this.steamSeeds = Array.from({ length: 90 }, () => ({ a: Math.random() * 6.28, r: Math.random() * R, z: (Math.random() - 0.5) * DRUM_D, life: Math.random() }));
    this.sparkPts = mk(40, dotSprite('rgba(255,255,255,1)', 'rgba(140,255,190,0.4)'), 0.03, THREE.AdditiveBlending);
    this.sparkSeeds = Array.from({ length: 40 }, () => ({ a: Math.random() * 6.28, r: Math.random() * R * 0.9, z: Math.random() * 0.1, life: Math.random() }));
  }

  buildDoor() {
    // Hinged on the left: the pivot sits at the door's left edge.
    const pivot = new THREE.Group();
    const hingeX = -HOLE_R - 0.03;
    pivot.position.set(hingeX, DOOR_Y, D / 2 + 0.02);
    this.machine.add(pivot);
    this.doorPivot = pivot;
    const door = new THREE.Group();
    door.position.x = -hingeX;
    pivot.add(door);

    const chrome = new THREE.MeshStandardMaterial({ color: '#8b929d', metalness: 1, roughness: 0.18 });
    const frameMat = new THREE.MeshStandardMaterial({ color: '#1a1d24', metalness: 0.5, roughness: 0.25 });
    const outer = new THREE.Mesh(new THREE.TorusGeometry(0.205, 0.024, 24, 96), frameMat);
    door.add(outer);
    const trim = new THREE.Mesh(new THREE.TorusGeometry(0.205, 0.006, 12, 96), chrome);
    trim.position.z = 0.02;
    door.add(trim);
    const innerRing = new THREE.Mesh(new THREE.TorusGeometry(0.168, 0.012, 16, 96), chrome);
    innerRing.position.z = 0.008;
    door.add(innerRing);

    // Tinted glass with a bowl that reaches into the drum.
    this.glassMat = new THREE.MeshPhysicalMaterial({
      color: '#22324a', metalness: 0, roughness: 0.04, transparent: true, opacity: 0.2,
      clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.4, depthWrite: false, side: THREE.DoubleSide,
    });
    const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.24, 48, 16, 0, Math.PI * 2, 0, 0.78), this.glassMat);
    bowl.rotation.x = -Math.PI / 2;
    bowl.scale.set(1, 0.32, 1);
    bowl.position.z = 0.03;
    bowl.renderOrder = 6;
    door.add(bowl);
    const flat = new THREE.Mesh(new THREE.CircleGeometry(0.19, 64), this.glassMat);
    flat.position.z = 0.012;
    flat.renderOrder = 6;
    door.add(flat);

    // A soft diagonal highlight sells the glass.
    const glint = canvasTexture(256, 256, (g, s) => {
      g.translate(s / 2, s / 2); g.rotate(-0.7);
      const lg = g.createLinearGradient(-s / 2, 0, s / 2, 0);
      lg.addColorStop(0, 'rgba(255,255,255,0)'); lg.addColorStop(0.42, 'rgba(255,255,255,0)');
      lg.addColorStop(0.5, 'rgba(255,255,255,0.35)'); lg.addColorStop(0.56, 'rgba(255,255,255,0)'); lg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = lg; g.beginPath(); g.arc(0, 0, s / 2, 0, Math.PI * 2); g.fill();
    });
    const g2 = new THREE.Mesh(new THREE.CircleGeometry(0.19, 64), new THREE.MeshBasicMaterial({ map: glint, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.55 }));
    g2.position.z = 0.016; g2.renderOrder = 7;
    door.add(g2);

    const handle = new THREE.Mesh(new RoundedBoxGeometry(0.024, 0.09, 0.018, 2, 0.008), chrome);
    handle.position.set(0.2, 0, 0.018);
    door.add(handle);
  }

  /* --- state --- */

  setState({ phase, progress = 0, door = false, display = { a: '', b: '' }, power = true, locale = 'en' }) {
    this.locale = locale;
    if (phase !== this.phase) {
      const prev = this.phase;
      this.phase = phase;
      const p = PHASES[phase] || PHASES.idle;
      // Paused keeps whatever water was in the drum.
      this.p = { ...p, water: p.water < 0 ? this.waterGoal : p.water };
      if (p.omega && prev !== phase) this.swapClock = 0;
    }
    this.moodGoal.set(PHASES[phase]?.color || PHASES.idle.color);
    this.waterGoal = this.p.water;
    this.progress = clamp(progress, 0, 1);
    this.doorGoal = door ? 1 : 0;
    this.powerGoal = power ? 1 : 0;
    if (display.a !== this.display.a || display.b !== this.display.b) {
      this.display = display;
      this.drawDisplay();
    }
  }

  drawDisplay() {
    const g = this.displayCanvas.getContext('2d');
    const w = this.displayCanvas.width, h = this.displayCanvas.height;
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#05070b'; g.fillRect(0, 0, w, h);
    if (!this.display.a && !this.display.b) { this.displayTex.needsUpdate = true; return; }
    const col = '#' + new THREE.Color(PHASES[this.phase]?.color || '#8fc7ff').lerp(new THREE.Color('#ffffff'), 0.35).getHexString();
    g.fillStyle = col;
    g.shadowColor = col; g.shadowBlur = 14;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '600 64px "SF Mono", ui-monospace, Menlo, Consolas, monospace';
    g.fillText(this.display.a, w / 2, h * 0.42);
    g.shadowBlur = 0;
    g.globalAlpha = 0.7;
    g.font = '600 24px -apple-system, "SF Pro Text", Inter, system-ui, sans-serif';
    g.fillText(this.display.b.toLocaleUpperCase(this.locale), w / 2, h * 0.84);
    g.globalAlpha = 1;
    this.displayTex.needsUpdate = true;
  }

  /* --- frame --- */

  // Returns true while anything is still moving (the card throttles when it's all still).
  update(dt) {
    this.clock += dt;
    const p = this.p;
    this.power += (this.powerGoal - this.power) * ease(4, dt);
    this.mood.lerp(this.moodGoal, ease(3, dt));
    this.water += (this.waterGoal - this.water) * ease(0.6, dt);
    this.heat += (p.heat - this.heat) * ease(0.8, dt);
    this.bubbles += (p.bubbles - this.bubbles) * ease(1.2, dt);
    this.door += (this.doorGoal - this.door) * ease(2.6, dt);

    // Drum: alternating tumble, a ramp up to spin, or easing to rest.
    let goal = p.omega;
    if (p.swap) {
      this.swapClock += dt;
      const cycle = p.swap * 2 + 2.4; // run, pause, run the other way, pause
      const t = this.swapClock % cycle;
      if (t < p.swap) goal = p.omega;
      else if (t < p.swap + 1.2) goal = 0;
      else if (t < p.swap * 2 + 1.2) goal = -p.omega;
      else goal = 0;
    }
    if (this.doorGoal) goal = 0;
    const accel = Math.abs(goal) > 6 ? 0.45 : 1.8;
    this.omega += (goal - this.omega) * ease(accel, dt);
    this.drum.rotation.z += this.omega * dt;
    this.spinAmt = clamp((Math.abs(this.omega) - 5) / 8, 0, 1);

    this.updateLaundry(dt);
    this.updateWater();
    this.updateParticles(dt);

    // Body shake while spinning, a little wobble while tumbling.
    const shake = this.spinAmt * 0.0025 + Math.min(Math.abs(this.omega), 3) * 0.00025;
    this.machine.position.x = Math.sin(this.clock * 47) * shake;
    this.machine.position.z = Math.cos(this.clock * 39) * shake * 0.6;
    this.machine.rotation.z = Math.sin(this.clock * 31) * shake * 0.6;

    this.blurMat.opacity = this.spinAmt * 0.55;
    this.blur.rotation.z -= this.omega * dt * 0.6;

    this.doorPivot.rotation.y = -this.door * 1.75;

    // Lights and glow follow the mood colour.
    const running = Math.abs(this.omega) > 0.05 || this.heat > 0.05;
    const lit = this.power * (this.phase === 'off' ? 0 : 1);
    const warm = new THREE.Color('#ffd7b0').lerp(new THREE.Color('#ff7a2a'), this.heat);
    this.drumLight.color.copy(this.heat > 0.05 ? warm : new THREE.Color('#dfeaff').lerp(this.mood, 0.35));
    this.drumLight.intensity = lit * (0.12 + (running ? 0.18 : 0.06) + this.heat * 0.45 + (this.phase === 'finish' ? 0.25 : 0) + this.door * 0.2);
    this.drumMat.emissive = this.drumMat.emissive || new THREE.Color();
    this.drumMat.emissive.copy(warm).multiplyScalar(this.heat * 0.08 * lit);
    this.haloMat.color.copy(this.mood);
    this.haloMat.opacity = lit * (0.05 + (running ? 0.03 : 0) + (this.phase === 'finish' ? 0.03 : 0));
    this.statusLed.color.copy(lit > 0.5 ? this.mood : new THREE.Color('#2a3140'));
    this.updateLeds(lit);

    this.updateCamera(dt);
    return true;
  }

  updateLeds(lit) {
    const n = this.leds.length;
    const filled = this.progress * n;
    const on = new THREE.Color(this.mood).lerp(new THREE.Color('#ffffff'), 0.25);
    const busy = ['sensing', 'prewash', 'wash', 'rinse', 'spin', 'dry', 'cool', 'wrinkle'].includes(this.phase);
    for (let i = 0; i < n; i++) {
      const m = this.leds[i];
      if (lit < 0.5) { m.color.set('#2a3140'); continue; }
      if (this.phase === 'finish') { m.color.copy(on); continue; }
      if (i < Math.floor(filled)) m.color.copy(on);
      else if (busy && i === Math.floor(filled)) m.color.copy(on).multiplyScalar(0.35 + 0.65 * (0.5 + 0.5 * Math.sin(this.clock * 5)));
      else m.color.set('#2a3140');
    }
  }

  updateLaundry(dt) {
    const w = this.omega;
    const spin = this.spinAmt;
    const level = -R + this.water * 2 * R;
    for (const c of this.clothes) {
      const r = c.r + (R - c.size * 0.45 - c.r) * spin;
      if (c.mode === 'ride') {
        // Carried by the drum; slides back to rest when the drum is slow.
        const slow = clamp(1 - Math.abs(w) / 0.8, 0, 1);
        c.phi += w * dt;
        c.phi += (c.rest - Math.sin(c.phi) * 0.4 - c.phi) * slow * ease(2.2, dt);
        c.phi = Math.atan2(Math.sin(c.phi), Math.cos(c.phi));
        c.x = r * Math.sin(c.phi); c.y = -r * Math.cos(c.phi);
        c.rollV *= 0.9;
        // Past the release angle and not fast enough to stick to the wall → it falls.
        if (w * w * r < G * 0.9 && Math.sign(w) * c.phi > c.release && Math.abs(w) > 0.3) {
          c.mode = 'fall';
          c.vx = w * r * Math.cos(c.phi); c.vy = w * r * Math.sin(c.phi);
          c.rollV = (Math.random() - 0.5) * 12;
        }
      } else {
        c.vy -= G * dt;
        if (c.y < level) { const drag = Math.exp(-dt * 4); c.vx *= drag; c.vy *= drag; c.vy += G * 0.55 * dt; }
        c.x += c.vx * dt; c.y += c.vy * dt;
        const d = Math.hypot(c.x, c.y);
        if (d >= r && c.x * c.vx + c.y * c.vy > 0) {
          c.phi = Math.atan2(c.x, -c.y);
          c.x = r * Math.sin(c.phi); c.y = -r * Math.cos(c.phi);
          c.mode = 'ride';
        }
      }
      c.roll += c.rollV * dt;
      // A little bob when floating in water.
      const bob = c.y < level ? Math.sin(this.clock * 2 + c.z * 30) * 0.004 : 0;
      c.mesh.position.set(c.x, c.y + bob, c.z);
      c.mesh.rotation.set(c.roll * 0.4, c.roll * 0.2, c.phi + c.roll);
      const flat = 1 - spin * 0.3;
      c.mesh.scale.set(1, flat, 1);
    }
  }

  updateWater() {
    const visible = this.water > 0.005;
    this.waterBody.visible = this.surface.visible = visible;
    if (!visible) return;
    const level = -R + this.water * 2 * R;
    const slosh = clamp(this.omega * 0.04, -0.12, 0.12) + Math.sin(this.clock * 1.7) * 0.02;
    const worldY = this.machine.position.y + DOOR_Y + level;
    this.waterPlane.normal.set(Math.sin(slosh), -Math.cos(slosh), 0);
    this.waterPlane.constant = worldY * Math.cos(slosh);
    const half = Math.sqrt(Math.max(0, R * R - level * level));
    this.surface.position.y = DOOR_Y + level;
    this.surface.scale.x = Math.max(0.001, half * 2 - 0.01);
    this.surface.rotation.y = slosh;
    this.waterMat.opacity = 0.42 + 0.14 * Math.min(1, this.water * 3);
  }

  updateParticles(dt) {
    const level = -R + this.water * 2 * R;
    // Bubbles rise through the water and pop at the surface.
    const bp = this.bubblePts.geometry.attributes.position;
    const bOn = this.bubbles * Math.min(1, this.water * 4);
    this.bubblePts.material.opacity = bOn * 0.85;
    if (bOn > 0.01) {
      for (let i = 0; i < this.bubbleSeeds.length; i++) {
        const b = this.bubbleSeeds[i];
        b.life += dt * (0.4 + (i % 7) * 0.07);
        if (b.life > 1 || b.y > level) {
          b.life = 0;
          const half = Math.sqrt(Math.max(0, R * R - (level - 0.02) ** 2));
          b.x = (Math.random() * 2 - 1) * Math.min(half, R * 0.85);
          b.y = -R * 0.9 + Math.random() * Math.max(0.01, (level + R * 0.9) * 0.6);
          b.z = (Math.random() - 0.5) * (DRUM_D - 0.06);
          b.v = 0.05 + Math.random() * 0.08;
        }
        b.y = Math.min(level - 0.004, b.y + b.v * dt);
        b.x += Math.sin(this.clock * 3 + i) * 0.01 * dt + this.omega * 0.01 * dt;
        bp.setXYZ(i, b.x, b.y, b.z);
      }
      bp.needsUpdate = true;
    }

    // Steam swirls with the drum while drying.
    const sp = this.steamPts.geometry.attributes.position;
    this.steamPts.material.opacity = this.heat * 0.09;
    if (this.heat > 0.01) {
      for (let i = 0; i < this.steamSeeds.length; i++) {
        const s = this.steamSeeds[i];
        s.life += dt * 0.25;
        s.a += this.omega * dt * 0.35;
        if (s.life > 1) { s.life = 0; s.r = Math.random() * R * 0.85; s.a = Math.random() * 6.28; }
        const rise = s.life * 0.08;
        sp.setXYZ(i, Math.cos(s.a) * s.r, Math.sin(s.a) * s.r * 0.8 + rise, s.z);
      }
      sp.needsUpdate = true;
    }

    // Sparkles drift out of the drum when the cycle is done.
    const kp = this.sparkPts.geometry.attributes.position;
    const done = this.phase === 'finish' ? 1 : 0;
    this.sparkPts.material.opacity += (done * 0.9 - this.sparkPts.material.opacity) * ease(2, dt);
    if (this.sparkPts.material.opacity > 0.01) {
      for (let i = 0; i < this.sparkSeeds.length; i++) {
        const s = this.sparkSeeds[i];
        s.life += dt * 0.3;
        if (s.life > 1) { s.life = 0; s.a = Math.random() * 6.28; s.r = Math.random() * R * 0.8; }
        const out = s.life * 0.32;
        kp.setXYZ(i, Math.cos(s.a) * s.r, Math.sin(s.a) * s.r + s.life * 0.12, DRUM_D / 2 - 0.02 + out);
      }
      kp.needsUpdate = true;
    }
  }

  updateCamera(dt) {
    const sway = Math.sin(this.clock * 0.22) * 0.07;
    this.azimuth += (this.azimuthGoal + this.userAz + sway - this.azimuth) * ease(3, dt);
    const r = this.dist;
    this.camera.position.set(
      this.target.x + Math.sin(this.azimuth) * Math.cos(this.elev) * r,
      this.target.y + Math.sin(this.elev) * r,
      this.target.z + Math.cos(this.azimuth) * Math.cos(this.elev) * r,
    );
    this.camera.lookAt(this.target);
  }

  resize(w, h) {
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.composer?.setPixelRatio(this.renderer.getPixelRatio());
    this.composer?.setSize(w, h);
    this.camera.aspect = w / h;
    // Keep the whole machine in frame on narrow cards.
    this.dist = 2.75 * Math.max(1, 0.95 / this.camera.aspect);
    this.camera.updateProjectionMatrix();
  }

  render() { if (this.composer) this.composer.render(); else this.renderer.render(this.scene, this.camera); }

  dispose() {
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      const m = o.material;
      if (m) (Array.isArray(m) ? m : [m]).forEach((mm) => { mm.map?.dispose(); mm.dispose(); });
    });
    this.envTex.dispose();
    this.composer.dispose?.();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}

/* ---------- Lovelace card ---------- */

const ICON_DRYER = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2.5" width="16" height="19" rx="3"/><path d="M4 7h16"/><circle cx="12" cy="14" r="4.5"/><path d="M10 12.5c.8.8-.8 1.7 0 2.5M13 12.5c.8.8-.8 1.7 0 2.5"/><circle cx="7.5" cy="4.8" r=".6" fill="currentColor"/></svg>';
const ICON_WASHER = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2.5" width="16" height="19" rx="3"/><path d="M4 7h16"/><circle cx="12" cy="14" r="4.5"/><path d="M9.5 14.5c1 .8 2 .8 3 0s2-.8 3 0"/><circle cx="7.5" cy="4.8" r=".6" fill="currentColor"/><circle cx="10" cy="4.8" r=".6" fill="currentColor"/></svg>';
const ICON_POWER = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 3v8"/><path d="M6.4 6.6a8 8 0 1 0 11.2 0"/></svg>';
const ICON_CHECK = '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.2 4.2L19 7"/></svg>';

const CSS = `
:host { display: block; }
ha-card { display: block; background: none; border: 0; box-shadow: none; overflow: visible; }
.card {
  --mood: #3d8bff;
  --bg: ${STAGE_BG};
  --text: #f3f5fa; --muted: rgba(222,230,247,.58); --faint: rgba(222,230,247,.34);
  --glass: rgba(255,255,255,.055); --glass-hi: rgba(255,255,255,.1); --line: rgba(255,255,255,.085);
  --ease: cubic-bezier(.22,1,.36,1); --spring: cubic-bezier(.34,1.56,.64,1);
  position: relative; border-radius: 28px; overflow: hidden; isolation: isolate;
  background: var(--bg); color: var(--text);
  font-family: -apple-system, 'SF Pro Text', Inter, system-ui, sans-serif; -webkit-font-smoothing: antialiased;
  box-shadow: 0 0 0 1px rgba(255,255,255,.07) inset, 0 24px 60px -20px rgba(0,0,0,.65);
  display: flex; flex-direction: column;
}
.stage { position: relative; height: var(--stage-h, 300px); cursor: grab; }
.stage:active { cursor: grabbing; }
.stage canvas { width: 100%; height: 100%; display: block; touch-action: pan-y;
  -webkit-mask-image: linear-gradient(180deg,#000 0%,#000 78%,transparent 100%); mask-image: linear-gradient(180deg,#000 0%,#000 78%,transparent 100%); }
.stage::after { content: ''; position: absolute; inset: 0 0 auto 0; height: 92px; pointer-events: none;
  background: linear-gradient(180deg, rgba(10,14,26,.85) 0%, rgba(10,14,26,.4) 60%, transparent 100%); }
.tint { position: absolute; inset: 0; pointer-events: none; z-index: 2; mix-blend-mode: screen; opacity: .75;
  background: radial-gradient(120% 34% at 50% 0%, var(--mood) 0%, transparent 100%),
              linear-gradient(180deg, color-mix(in srgb, var(--mood) 34%, transparent) 0%, transparent 46%);
  transition: background 900ms ease; }
.top { position: absolute; inset: 0 0 auto 0; z-index: 5; display: flex; align-items: center; gap: 10px; padding: 18px 18px 0 20px; }
.badge { width: 34px; height: 34px; border-radius: 11px; display: grid; place-items: center; background: var(--glass-hi); border: 1px solid var(--line); color: #cfe0ff; flex: none; }
.who { flex: 1; min-width: 0; }
.name { font-size: 16px; font-weight: 650; letter-spacing: -.01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sub { margin-top: 1px; font-size: 12px; color: var(--muted); display: flex; align-items: center; gap: 6px; }
.sub b { color: var(--text); font-weight: 600; }
.live { width: 6px; height: 6px; border-radius: 50%; background: var(--mood); box-shadow: 0 0 8px var(--mood); flex: none; }
.live.still { background: var(--faint); box-shadow: none; }
.live.pulse { animation: pulse 1.6s ease-in-out infinite; }
@keyframes pulse { 50% { opacity: .35; } }
.round { width: 42px; height: 42px; border-radius: 50%; display: grid; place-items: center; flex: none;
  background: var(--glass-hi); border: 1px solid var(--line); color: var(--muted); cursor: pointer;
  transition: transform 260ms var(--spring), background 200ms, color 200ms, box-shadow 300ms; font: inherit; padding: 0; }
.round:active { transform: scale(.9); }
.round.on { background: linear-gradient(180deg, color-mix(in srgb, var(--mood) 80%, #fff), var(--mood)); color: #fff;
  border-color: rgba(255,255,255,.28); box-shadow: 0 8px 22px -4px color-mix(in srgb, var(--mood) 75%, transparent), 0 0 0 1px rgba(255,255,255,.12) inset; }
.round[disabled] { cursor: default; opacity: .9; }
.panel { position: relative; z-index: 4; margin-top: -40px; padding: 0 14px 14px; display: flex; flex-direction: column; gap: 10px; }
.glass { background: rgba(255,255,255,.055); border: 1px solid var(--line); border-radius: 22px;
  backdrop-filter: blur(18px) saturate(1.4); -webkit-backdrop-filter: blur(18px) saturate(1.4); }
.hero { padding: 14px 16px 14px; display: flex; flex-direction: column; gap: 12px; }
.row { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; }
.time { font-size: 34px; font-weight: 700; letter-spacing: -.03em; line-height: 1; font-variant-numeric: tabular-nums; }
.time small { font-size: 15px; font-weight: 600; color: var(--muted); margin: 0 6px 0 2px; letter-spacing: 0; }
.time.word { font-size: 26px; }
.ends { text-align: right; font-size: 12px; color: var(--muted); line-height: 1.35; }
.ends b { display: block; color: var(--text); font-size: 15px; font-weight: 650; font-variant-numeric: tabular-nums; }
.bar { height: 6px; border-radius: 99px; background: rgba(255,255,255,.08); overflow: hidden; }
.bar i { display: block; height: 100%; width: 0; border-radius: inherit;
  background: linear-gradient(90deg, color-mix(in srgb, var(--mood) 55%, #fff), var(--mood));
  box-shadow: 0 0 12px var(--mood); transition: width 800ms var(--ease), background 900ms; }
.steps { display: grid; grid-template-columns: repeat(var(--n, 4), 1fr); gap: 6px; }
.step { display: flex; align-items: center; justify-content: center; gap: 5px; height: 30px; border-radius: 11px;
  font-size: 12px; font-weight: 600; color: var(--faint); background: rgba(255,255,255,.035); border: 1px solid transparent;
  transition: color 300ms, background 300ms, border-color 300ms; white-space: nowrap; }
.step.done { color: var(--muted); }
.step.done .ck { display: inline-grid; }
.step .ck { display: none; place-items: center; width: 15px; height: 15px; border-radius: 50%; background: rgba(255,255,255,.12); color: var(--text); }
.step.now { color: #fff; background: color-mix(in srgb, var(--mood) 26%, transparent); border-color: color-mix(in srgb, var(--mood) 55%, transparent); }
.chips { display: flex; gap: 6px; flex-wrap: wrap; }
.chip { display: flex; align-items: center; gap: 6px; padding: 7px 11px; border-radius: 99px; font-size: 12px; color: var(--muted);
  background: rgba(255,255,255,.05); border: 1px solid var(--line); }
.chip b { color: var(--text); font-weight: 600; font-variant-numeric: tabular-nums; }
.chip.warn { color: #ffd9a8; border-color: rgba(255,180,107,.35); }
.err { padding: 12px 16px; font-size: 12px; color: #ffd9a8; }
`;

class SamsungWasherCard extends HTMLElement {
  static getConfigElement() { return document.createElement('samsung-washer-card-editor'); }

  static getStubConfig(hass) {
    const sw = Object.keys(hass?.states || {}).find((id) => id.startsWith('switch.') && /wash|laundry|çamaş|camas/i.test(id + (hass.states[id].attributes.friendly_name || '')));
    return { entity: sw || 'switch.washer' };
  }

  static _dryerStub(hass) {
    const sw = Object.keys(hass?.states || {}).find((id) => id.startsWith('switch.') && /dry|tumble|kurut/i.test(id + (hass.states[id].attributes.friendly_name || '')));
    return { entity: sw || 'switch.dryer' };
  }

  setConfig(config) {
    if (!config) throw new Error(STRINGS.en.invalid);
    this._config = { dryer: true, color: 'white', height: 320, ...config };
    this._ids = null;
    if (this._root) this._applyLayout();
  }

  set hass(hass) {
    this._hass = hass;
    this._locale = this._config?.language || hass.locale?.language || hass.language || navigator.language || 'en';
    this._t = strings(this._locale.split('-')[0].toLowerCase());
    if (!this._root) this._build();
    this._update();
  }

  getCardSize() { return 7; }
  getGridOptions() { return { columns: 12, rows: 8, min_columns: 6, min_rows: 6 }; }

  connectedCallback() {
    if (this._root && !this._raf) this._start();
  }

  disconnectedCallback() {
    this._stop();
    // Free the GL context when the card leaves the dashboard for good.
    clearTimeout(this._disposeTimer);
    this._disposeTimer = setTimeout(() => {
      if (!this.isConnected && this._scene) { this._scene.dispose(); this._scene = null; this._root = null; this.shadowRoot.innerHTML = ''; }
    }, 3000);
  }

  /* --- entities --- */

  _resolve() {
    if (this._ids) return this._ids;
    const c = this._config;
    const states = this._hass.states;
    const dry = c.device === 'dryer';
    const base = c.entity_prefix || (c.entity ? c.entity.split('.')[1] : (dry ? 'dryer' : 'washer'));
    const pick = (...ids) => ids.find((id) => id && states[id]);
    const e = c.entities || {};
    const ids = {
      power: e.power || pick(c.entity, `switch.${base}`),
      machine: e.machine_state || pick(`sensor.${base}_machine_state`, `sensor.${base}_${dry ? 'dryer' : 'washer'}_machine_state`),
      job: e.job_state || (dry
        ? pick(`sensor.${base}_dryer_job_state`, `sensor.${base}_job_state`)
        : pick(`sensor.${base}_job_state`, `sensor.${base}_washer_job_state`)),
      dryerJob: dry ? undefined : (e.dryer_job_state || pick(`sensor.${base}_dryer_job_state`)),
      completion: e.completion_time || pick(`sensor.${base}_completion_time`, `sensor.${base}_washer_completion_time`, `sensor.${base}_dryer_completion_time`),
      progress: e.progress || pick(`sensor.${base}_progress`, `sensor.${base}_cycle_progress`),
      door: e.door || pick(`binary_sensor.${base}_door`, `binary_sensor.${base}_door_state`),
      energy: e.energy || pick(`sensor.${base}_energy`),
      watts: e.power_usage || pick(`sensor.${base}_power`),
      mode: e.program || (dry
        ? pick(`select.${base}_dryer_mode`, `sensor.${base}_dryer_mode`, `select.${base}_course`, `sensor.${base}_course`)
        : pick(`select.${base}_washer_mode`, `sensor.${base}_washer_mode`, `select.${base}_course`, `sensor.${base}_course`)),
    };
    // Only cache once the main ids resolved (entities can load after the first render).
    if (ids.job || ids.machine) this._ids = ids;
    return ids;
  }

  _state(id) { return id ? this._hass.states[id] : undefined; }

  _read() {
    const ids = this._resolve();
    const s = (id) => this._state(id)?.state;
    const power = s(ids.power);
    const machine = (s(ids.machine) || '').toLowerCase();
    const job = (s(ids.job) || '').toLowerCase();
    const djob = (s(ids.dryerJob) || '').toLowerCase();

    let phase;
    if ([power, s(ids.job)].every((v) => v === undefined)) phase = 'unavailable';
    else if (power === 'unavailable' || s(ids.job) === 'unavailable') phase = 'unavailable';
    else if (power === 'off') phase = 'off';
    else if (machine === 'pause' || machine === 'paused') phase = 'pause';
    else phase = JOB_MAP[djob] || JOB_MAP[job] || (machine === 'run' ? (this._config.device === 'dryer' ? 'dry' : 'wash') : (job === 'finish' ? 'finish' : 'idle'));
    if (phase === 'idle' && this._lastActive && Date.now() - this._lastActive < 20 * 60 * 1000 && machine === 'stop') phase = 'finish';
    const active = ['sensing', 'prewash', 'wash', 'rinse', 'spin', 'dry', 'cool', 'wrinkle', 'pause'].includes(phase);
    if (active) this._lastActive = Date.now();

    // Remaining time from the completion timestamp.
    let remaining = null;
    const comp = s(ids.completion);
    if (comp && !['unknown', 'unavailable'].includes(comp)) {
      const t = Date.parse(comp);
      if (!Number.isNaN(t)) remaining = Math.max(0, (t - Date.now()) / 1000);
    }

    // Progress: a real sensor when there is one, else 1 - remaining / longest remaining seen this cycle.
    let progress = null;
    const pv = parseFloat(s(ids.progress));
    if (!Number.isNaN(pv)) progress = pv > 1 ? pv / 100 : pv;
    else if (remaining !== null && active) {
      const key = `swc-total:${ids.job || ids.power}`;
      let total = this._total ?? (() => { try { return +localStorage.getItem(key) || 0; } catch { return 0; } })();
      if (remaining > total) total = remaining;
      if (total !== this._total) { this._total = total; try { localStorage.setItem(key, String(total)); } catch { /* private mode */ } }
      progress = total ? 1 - remaining / total : 0;
    }
    if (!active && phase !== 'pause') {
      if (this._total) { this._total = 0; try { localStorage.removeItem(`swc-total:${ids.job || ids.power}`); } catch { /* ignore */ } }
    }
    if (phase === 'finish') progress = 1;

    const door = s(ids.door) === 'on';
    const energy = this._state(ids.energy);
    const watts = this._state(ids.watts);
    const mode = this._state(ids.mode);
    return { ids, phase, active, remaining, completion: comp, progress: progress ?? 0, door, power, energy, watts, mode };
  }

  /* --- DOM --- */

  _build() {
    const root = this.shadowRoot || this.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>${CSS}</style>
      <ha-card>
        <div class="card">
          <div class="stage"><canvas></canvas></div>
          <div class="tint"></div>
          <div class="top">
            <div class="badge">${this._config.device === 'dryer' ? ICON_DRYER : ICON_WASHER}</div>
            <div class="who"><div class="name"></div><div class="sub"><i class="live"></i><span class="status"></span></div></div>
            <button class="round power">${ICON_POWER}</button>
          </div>
          <div class="panel">
            <div class="glass hero">
              <div class="row"><div class="time"></div><div class="ends"></div></div>
              <div class="bar"><i></i></div>
              <div class="steps"></div>
            </div>
            <div class="chips"></div>
          </div>
        </div>
      </ha-card>`;
    this._root = root;
    const $ = (s) => root.querySelector(s);
    this._el = {
      card: $('.card'), stage: $('.stage'), canvas: $('canvas'), name: $('.name'), status: $('.status'), live: $('.live'),
      power: $('.power'), time: $('.time'), ends: $('.ends'), bar: $('.bar i'), steps: $('.steps'), chips: $('.chips'),
    };
    this._applyLayout();

    try {
      this._scene = new WasherScene(this._el.canvas, { color: this._config.color, bloom: this._config.bloom !== false, device: this._config.device });
    } catch (err) {
      this._el.stage.innerHTML = `<div class="err">${this._t.glFail}: ${err.message}</div>`;
    }

    this._el.power.addEventListener('click', (ev) => { ev.stopPropagation(); this._togglePower(); });
    this._el.card.addEventListener('click', (ev) => {
      if (this._dragged) return;
      const id = this._resolve().job || this._resolve().power;
      if (id) this.dispatchEvent(new CustomEvent('hass-more-info', { detail: { entityId: id }, bubbles: true, composed: true }));
    });
    this._bindDrag();

    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(this._el.stage);
    this._io = new IntersectionObserver((e) => { this._visible = e[0]?.isIntersecting; });
    this._io.observe(this);
    this._visible = true;
    this._start();
  }

  _applyLayout() {
    if (!this._el) return;
    const h = this._config.height;
    this._el.card.style.setProperty('--stage-h', typeof h === 'number' ? `${h}px` : h);
  }

  _bindDrag() {
    const st = this._el.stage;
    let x0 = null, az0 = 0;
    st.addEventListener('pointerdown', (e) => { x0 = e.clientX; az0 = this._scene?.userAz || 0; this._dragged = false; });
    window.addEventListener('pointermove', (e) => {
      if (x0 === null || !this._scene) return;
      const dx = e.clientX - x0;
      if (Math.abs(dx) > 4) this._dragged = true;
      this._scene.userAz = clamp(az0 + dx * 0.006, -1.2, 0.9);
    });
    window.addEventListener('pointerup', () => {
      x0 = null;
      setTimeout(() => { this._dragged = false; }, 0);
    });
  }

  _resize() {
    if (!this._scene) return;
    const r = this._el.stage.getBoundingClientRect();
    this._scene.resize(Math.round(r.width), Math.round(r.height));
  }

  _start() {
    if (!this._scene || this._raf) return;
    let last = performance.now();
    const loop = (now) => {
      this._raf = requestAnimationFrame(loop);
      if (!this._visible || document.hidden) { last = now; return; }
      const dt = clamp((now - last) / 1000, 0, 0.05);
      last = now;
      // Refresh the countdown about once a second without waiting for a state change.
      this._tick = (this._tick || 0) + dt;
      if (this._tick > 1) { this._tick = 0; this._update(); }
      this._scene.update(dt);
      this._scene.render();
    };
    this._raf = requestAnimationFrame(loop);
  }

  _stop() { cancelAnimationFrame(this._raf); this._raf = null; }

  _togglePower() {
    const d = this._read();
    if (!d.ids.power) return;
    if (d.active) return; // never cut power mid-cycle from a dashboard tap
    this._hass.callService('switch', d.power === 'on' ? 'turn_off' : 'turn_on', { entity_id: d.ids.power });
  }

  _update() {
    if (!this._el || !this._hass) return;
    const d = this._read();
    const ph = PHASES[d.phase] || PHASES.idle;
    const el = this._el;
    const cfg = this._config;
    const T = this._t;
    const loc = this._locale;
    const label = T.phase[d.phase] || T.phase.idle;

    el.card.style.setProperty('--mood', ph.color);
    const fname = this._state(d.ids.power)?.attributes.friendly_name;
    el.name.textContent = cfg.name || fname || (cfg.device === 'dryer' ? T.dryerName : T.name);
    el.status.innerHTML = `<b>${label}</b>${d.mode?.state && d.active ? ` · ${this._modeLabel(d.mode.state)}` : ''}${d.door ? ` · ${T.doorOpen}` : ''}`;
    el.live.className = `live${d.active && d.phase !== 'pause' ? ' pulse' : ''}${['off', 'unavailable'].includes(d.phase) ? ' still' : ''}`;
    el.power.classList.toggle('on', d.power === 'on');
    el.power.disabled = d.active;
    el.power.title = d.active ? T.locked : (d.power === 'on' ? T.turnOff : T.turnOn);

    // Big number: remaining time, or a word when there is nothing to count.
    const rem = d.remaining;
    let timeHtml, timeWord = false;
    if (d.active && rem !== null) {
      const m = Math.ceil(rem / 60);
      const hh = Math.floor(m / 60), mm = m % 60;
      timeHtml = hh ? `${hh}<small>${T.hours}</small>${String(mm).padStart(2, '0')}<small>${T.minutes}</small>` : `${mm}<small>${T.minutes}</small>`;
    } else {
      timeWord = true;
      timeHtml = T.word[d.phase] || label;
    }
    el.time.innerHTML = timeHtml;
    el.time.classList.toggle('word', timeWord);
    if (d.active && rem !== null) {
      const end = new Date(Date.now() + rem * 1000);
      el.ends.innerHTML = `${T.ends}<b>${end.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' })}</b>`;
    } else if (d.phase === 'finish') {
      el.ends.innerHTML = d.door ? '' : T.unload;
    } else el.ends.innerHTML = '';
    el.bar.style.width = `${Math.round(d.progress * 100)}%`;

    // Step chips.
    const isDryer = cfg.device === 'dryer';
    const steps = isDryer ? DRYER_STEPS : STEP_ORDER.filter((k) => k !== 'dry' || cfg.dryer);
    const cur = (isDryer ? DRYER_STEP_OF : STEP_OF)[d.phase];
    const curIdx = cur === 'done' ? steps.length : steps.indexOf(cur);
    el.steps.style.setProperty('--n', steps.length);
    const stepsHtml = steps.map((k, i) => {
      const cls = curIdx < 0 ? '' : i < curIdx ? 'done' : i === curIdx ? 'now' : '';
      return `<div class="step ${cls}"><span class="ck">${ICON_CHECK}</span>${T.step[k]}</div>`;
    }).join('');
    if (stepsHtml !== this._stepsHtml) { el.steps.innerHTML = stepsHtml; this._stepsHtml = stepsHtml; }

    // Chips: energy, live power, door.
    const chips = [];
    const num = (st) => st && !Number.isNaN(parseFloat(st.state)) ? `${(+st.state).toLocaleString(loc, { maximumFractionDigits: 2 })} ${st.attributes.unit_of_measurement || ''}`.trim() : null;
    const w = num(d.watts); if (w && d.active) chips.push(`<div class="chip">${T.power} <b>${w}</b></div>`);
    const e = num(d.energy); if (e) chips.push(`<div class="chip">${T.energy} <b>${e}</b></div>`);
    if (d.ids.door) chips.push(`<div class="chip${d.door && d.active ? ' warn' : ''}">${T.door} <b>${d.door ? T.open : T.closed}</b></div>`);
    if (d.mode?.state && !['unknown', 'unavailable'].includes(d.mode.state)) chips.push(`<div class="chip">${T.program} <b>${this._modeLabel(d.mode.state)}</b></div>`);
    const chipsHtml = chips.join('');
    if (chipsHtml !== this._chipsHtml) { el.chips.innerHTML = chipsHtml; el.chips.style.display = chips.length ? '' : 'none'; this._chipsHtml = chipsHtml; }

    // Machine display text.
    let a = '', b = '';
    if (d.power === 'on' || d.phase !== 'off') {
      if (d.active && rem !== null) { const m = Math.ceil(rem / 60); a = `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; b = label; }
      else if (d.phase === 'finish') { a = 'End'; b = label; }
      else if (d.phase === 'idle') { a = '--:--'; b = label; }
      else if (d.phase === 'pause') { a = rem !== null ? `${Math.floor(Math.ceil(rem / 60) / 60)}:${String(Math.ceil(rem / 60) % 60).padStart(2, '0')}` : '||'; b = label; }
      else if (d.phase === 'delay') { a = 'Delay'; b = label; }
    }
    if (d.phase === 'off' || d.phase === 'unavailable') { a = ''; b = ''; }
    this._scene?.setState({ phase: d.phase, progress: d.progress, door: d.door, power: d.power !== 'off', display: { a, b }, locale: loc });
  }

  _modeLabel(v) {
    const k = String(v).toLowerCase().replace(/^table_\d+_/, '');
    return this._t.mode[k] || String(v).replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
  }
}

/* ---------- visual editor ---------- */

const EDITOR_SCHEMA = [
  { name: 'entity', required: true, selector: { entity: { domain: 'switch' } } },
  { name: 'name', selector: { text: {} } },
  { name: 'device', selector: { select: { mode: 'dropdown', options: [{ value: 'washer', label: 'Washer / washer-dryer' }, { value: 'dryer', label: 'Dryer' }] } } },
  {
    type: 'grid', name: '', schema: [
      { name: 'color', selector: { select: { mode: 'dropdown', options: [
        { value: 'white', label: 'White' }, { value: 'black', label: 'Black' },
        { value: 'silver', label: 'Silver' }, { value: 'beige', label: 'Beige' },
      ] } } },
      { name: 'height', selector: { number: { min: 200, max: 700, step: 10, mode: 'box', unit_of_measurement: 'px' } } },
      { name: 'dryer', selector: { boolean: {} } },
      { name: 'bloom', selector: { boolean: {} } },
    ],
  },
  { name: 'entity_prefix', selector: { text: {} } },
];

const EDITOR_LABELS = {
  entity: 'Power switch (SmartThings)',
  name: 'Name',
  device: 'Appliance type',
  color: 'Body colour',
  height: '3D view height',
  dryer: 'Washer-dryer (show the Dry step)',
  bloom: 'Glow effect',
  entity_prefix: 'Entity prefix (only if your sensors are named differently)',
};

class SamsungWasherCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = { dryer: true, bloom: true, color: 'white', height: 320, ...config };
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (this._form) this._form.hass = hass;
  }

  _render() {
    if (!this._form) {
      this._form = document.createElement('ha-form');
      this._form.schema = EDITOR_SCHEMA;
      this._form.computeLabel = (s) => EDITOR_LABELS[s.name] || s.name;
      this._form.addEventListener('value-changed', (ev) => {
        const config = { ...ev.detail.value };
        for (const k of Object.keys(config)) if (config[k] === '' || config[k] === undefined) delete config[k];
        this._config = config;
        this.dispatchEvent(new CustomEvent('config-changed', { detail: { config }, bubbles: true, composed: true }));
      });
      this.appendChild(this._form);
    }
    this._form.hass = this._hass;
    this._form.data = this._config;
  }
}

// Dryer variant: same card, `device: dryer` preset.
class SamsungDryerCard extends SamsungWasherCard {
  static getConfigElement() { return document.createElement('samsung-washer-card-editor'); }
  static getStubConfig(hass) { return { ...SamsungWasherCard._dryerStub(hass), device: 'dryer' }; }
  setConfig(config) { super.setConfig({ ...config, device: 'dryer' }); }
}

if (!customElements.get('samsung-washer-card-editor')) customElements.define('samsung-washer-card-editor', SamsungWasherCardEditor);

if (!customElements.get('samsung-washer-card')) {
  customElements.define('samsung-washer-card', SamsungWasherCard);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: 'samsung-washer-card',
    name: 'Samsung Washer Card',
    description: 'Animated 3D Samsung washer / washer-dryer for the SmartThings integration.',
    documentationURL: 'https://github.com/cryptooth/ha-samsung-washing-card',
    preview: true,
  });
  customElements.define('samsung-dryer-card', SamsungDryerCard);
  window.customCards.push({
    type: 'samsung-dryer-card',
    name: 'Samsung Dryer Card',
    description: 'Animated 3D Samsung dryer (Bespoke AI) for the SmartThings integration.',
    documentationURL: 'https://github.com/cryptooth/ha-samsung-washing-card',
    preview: true,
  });
  console.info(`%c SAMSUNG-WASHER-CARD %c ${VERSION} `, 'background:#3d8bff;color:#fff;border-radius:3px 0 0 3px', 'background:#1a1d24;color:#fff;border-radius:0 3px 3px 0');
}
