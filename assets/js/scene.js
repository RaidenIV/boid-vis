/**
 * scene.js — Three.js scene construction.
 * Geometry, materials, the camera-locked tunnel and the selective-bloom
 * composer chain are built exactly as in the original single-file build.
 */
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";

import { defaults, engine } from "./config.js";
import { elements } from "./core.js";

const {
  BLOOM_LAYER,
  TUNNEL_RADIUS,
  TUNNEL_LENGTH,
  TUNNEL_START,
  TUNNEL_POOL,
  CAP_COUNT,
  PARTICLE_POOL
} = engine;

export const canvas = elements.canvas;

export const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);

export const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  15000
);
camera.position.set(0, 0, 50);

export const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: true,
  // Required so PNG export can read the framebuffer after a render.
  preserveDrawingBuffer: true
});
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

/* ---------------------------------------------------------------------------
   Selective bloom (tunnel + swarm layer)
--------------------------------------------------------------------------- */
export const bloomComposer = new EffectComposer(renderer);
bloomComposer.renderToScreen = false;
bloomComposer.addPass(new RenderPass(scene, camera));

export const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.9,
  defaults.bloomRadius,
  defaults.bloomThreshold
);
bloomComposer.addPass(bloomPass);

export const finalComposer = new EffectComposer(renderer);
finalComposer.addPass(new RenderPass(scene, camera));

const finalPass = new ShaderPass(
  new THREE.ShaderMaterial({
    uniforms: {
      baseTexture: { value: null },
      bloomTexture: { value: bloomComposer.renderTarget2.texture }
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D baseTexture;
      uniform sampler2D bloomTexture;
      varying vec2 vUv;
      void main() {
        vec4 base  = texture2D(baseTexture, vUv);
        vec4 bloom = texture2D(bloomTexture, vUv);
        gl_FragColor = base + bloom;
      }
    `,
    transparent: true
  }),
  "baseTexture"
);
finalComposer.addPass(finalPass);

/* ---------------------------------------------------------------------------
   Lighting
--------------------------------------------------------------------------- */
scene.add(new THREE.AmbientLight(0xffffff, 0.2));
const pointLight = new THREE.PointLight(0xffffff, 1.0, 100);
pointLight.position.set(0, 0, 20);
scene.add(pointLight);

/* ---------------------------------------------------------------------------
   Circular particle sprite
--------------------------------------------------------------------------- */
function createCircleTexture() {
  const circleCanvas = document.createElement("canvas");
  circleCanvas.width = 64;
  circleCanvas.height = 64;
  const context = circleCanvas.getContext("2d");
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0.0, "rgba(255,255,255,1.0)");
  gradient.addColorStop(0.5, "rgba(255,255,255,0.8)");
  gradient.addColorStop(1.0, "rgba(255,255,255,0.0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(circleCanvas);
}

export const circleTexture = createCircleTexture();

/* ---------------------------------------------------------------------------
   Endless tunnel background
--------------------------------------------------------------------------- */
export const tunnelGroup = new THREE.Group();
scene.add(tunnelGroup);

export const tunnel = {
  count: defaults.tunnelCount,
  positions: new Float32Array(TUNNEL_POOL * 3),
  colors: new Float32Array(TUNNEL_POOL * 3),
  weights: new Float32Array(TUNNEL_POOL)
};

const tunnelGeometry = new THREE.BufferGeometry();
tunnelGeometry.setAttribute("position", new THREE.BufferAttribute(tunnel.positions, 3));
tunnelGeometry.setAttribute("color", new THREE.BufferAttribute(tunnel.colors, 3));

export const tunnelMaterial = new THREE.PointsMaterial({
  size: defaults.tunnelSize,
  map: circleTexture,
  vertexColors: true,
  transparent: true,
  opacity: defaults.tunnelOpacity / 100,
  depthWrite: false,
  blending: THREE.AdditiveBlending
});

export const tunnelParticles = new THREE.Points(tunnelGeometry, tunnelMaterial);
tunnelGroup.add(tunnelParticles);

/** Seed one tunnel point at a random depth. */
function seedTunnelPoint(index, randomizeDepth = true) {
  const angle = Math.random() * Math.PI * 2.0;
  const radius = TUNNEL_RADIUS - Math.random() * 26.0;
  const offset = index * 3;

  tunnel.positions[offset + 0] = Math.cos(angle) * radius;
  tunnel.positions[offset + 1] = Math.sin(angle) * radius;
  tunnel.positions[offset + 2] = randomizeDepth
    ? -(TUNNEL_START + Math.random() * TUNNEL_LENGTH)
    : tunnel.positions[offset + 2];

  tunnel.weights[index] = 0.55 + Math.random() * 0.85;
  tunnel.colors[offset + 0] = 1.0;
  tunnel.colors[offset + 1] = 1.0;
  tunnel.colors[offset + 2] = 1.0;
}

for (let index = 0; index < TUNNEL_POOL; index += 1) {
  seedTunnelPoint(index, true);
}
tunnelGeometry.setDrawRange(0, tunnel.count);

/** Change how many tunnel points are drawn without rebuilding the buffers. */
export function setTunnelCount(count) {
  tunnel.count = Math.max(1, Math.min(TUNNEL_POOL, Math.round(count)));
  tunnelGeometry.setDrawRange(0, tunnel.count);
}

export { tunnelGeometry };

/* ---------------------------------------------------------------------------
   Vanishing point spark
--------------------------------------------------------------------------- */
const vanishingGeometry = new THREE.BufferGeometry();
vanishingGeometry.setAttribute(
  "position",
  new THREE.BufferAttribute(new Float32Array([0, 0, -(TUNNEL_START + TUNNEL_LENGTH)]), 3)
);
vanishingGeometry.setAttribute(
  "color",
  new THREE.BufferAttribute(new Float32Array([1, 1, 1]), 3)
);

export const vanishingMaterial = new THREE.PointsMaterial({
  size: 2.0,
  map: circleTexture,
  vertexColors: true,
  transparent: true,
  opacity: 0.25,
  depthWrite: false,
  blending: THREE.AdditiveBlending
});

export const vanishingPoint = new THREE.Points(vanishingGeometry, vanishingMaterial);
tunnelGroup.add(vanishingPoint);

/* ---------------------------------------------------------------------------
   Far cap disk
--------------------------------------------------------------------------- */
const CAP_Z = -(TUNNEL_START + TUNNEL_LENGTH);

export const cap = {
  positions: new Float32Array(CAP_COUNT * 3),
  colors: new Float32Array(CAP_COUNT * 3),
  weights: new Float32Array(CAP_COUNT)
};

for (let index = 0; index < CAP_COUNT; index += 1) {
  const angle = Math.random() * Math.PI * 2.0;
  const radius = TUNNEL_RADIUS * Math.sqrt(Math.random());
  const offset = index * 3;

  cap.positions[offset + 0] = Math.cos(angle) * radius;
  cap.positions[offset + 1] = Math.sin(angle) * radius;
  cap.positions[offset + 2] = CAP_Z;

  cap.weights[index] = 0.55 + Math.random() * 0.95;
  cap.colors[offset + 0] = 1.0;
  cap.colors[offset + 1] = 1.0;
  cap.colors[offset + 2] = 1.0;
}

export const capGeometry = new THREE.BufferGeometry();
capGeometry.setAttribute("position", new THREE.BufferAttribute(cap.positions, 3));
capGeometry.setAttribute("color", new THREE.BufferAttribute(cap.colors, 3));

export const capMaterial = new THREE.PointsMaterial({
  size: 1.05,
  map: circleTexture,
  vertexColors: true,
  transparent: true,
  opacity: defaults.capOpacity / 100,
  depthWrite: false,
  blending: THREE.AdditiveBlending
});

export const capParticles = new THREE.Points(capGeometry, capMaterial);
tunnelGroup.add(capParticles);

/* ---------------------------------------------------------------------------
   Far-end glow billboard
--------------------------------------------------------------------------- */
function createGlowTexture() {
  const glowCanvas = document.createElement("canvas");
  glowCanvas.width = 128;
  glowCanvas.height = 128;
  const context = glowCanvas.getContext("2d");
  const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0.0, "rgba(255,255,255,0.85)");
  gradient.addColorStop(0.25, "rgba(255,255,255,0.40)");
  gradient.addColorStop(0.55, "rgba(255,255,255,0.14)");
  gradient.addColorStop(1.0, "rgba(255,255,255,0.00)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);

  const texture = new THREE.CanvasTexture(glowCanvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

export const glowMaterial = new THREE.SpriteMaterial({
  map: createGlowTexture(),
  color: 0xffffff,
  transparent: true,
  opacity: defaults.glowOpacity / 100,
  depthWrite: false,
  depthTest: false,
  blending: THREE.AdditiveBlending
});

export const glowSprite = new THREE.Sprite(glowMaterial);
glowSprite.position.set(0, 0, CAP_Z - 6.0);
glowSprite.scale.set(TUNNEL_RADIUS * 2.5, TUNNEL_RADIUS * 2.5, 1);
tunnelGroup.add(glowSprite);

tunnelParticles.layers.enable(BLOOM_LAYER);
capParticles.layers.enable(BLOOM_LAYER);
vanishingPoint.layers.enable(BLOOM_LAYER);
glowSprite.layers.enable(BLOOM_LAYER);

/* ---------------------------------------------------------------------------
   Particle swarm buffers
--------------------------------------------------------------------------- */
export const swarm = {
  positions: new Float32Array(PARTICLE_POOL * 3),
  colors: new Float32Array(PARTICLE_POOL * 3)
};

export const particleGeometry = new THREE.BufferGeometry();
particleGeometry.setAttribute("position", new THREE.BufferAttribute(swarm.positions, 3));
particleGeometry.setAttribute("color", new THREE.BufferAttribute(swarm.colors, 3));
particleGeometry.setDrawRange(0, defaults.minParticles);

export const particleMaterial = new THREE.PointsMaterial({
  size: defaults.particleSize,
  map: circleTexture,
  vertexColors: true,
  transparent: true,
  opacity: defaults.particleOpacity / 100,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  sizeAttenuation: true
});

export const particleSystem = new THREE.Points(particleGeometry, particleMaterial);
particleSystem.layers.enable(BLOOM_LAYER);
scene.add(particleSystem);

/* ---------------------------------------------------------------------------
   Sizing
--------------------------------------------------------------------------- */
export function resizeRenderer(width, height, pixelRatio) {
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(width, height, false);
  bloomComposer.setSize(width, height);
  finalComposer.setSize(width, height);
  bloomPass.resolution.set(width, height);
}

/** Render the selective-bloom pass, then composite over the full scene. */
export function renderScene() {
  camera.layers.set(BLOOM_LAYER);
  bloomComposer.render();
  camera.layers.set(0);
  finalComposer.render();
}

export { CAP_Z };
