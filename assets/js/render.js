/**
 * render.js — one deterministic frame of the visualizer.
 *
 * Both the preview loop and the video export loop call renderFrame() with an
 * explicit delta time, so the exported file matches what is on screen. The
 * simulation itself advances in fixed 0.016 s sub-steps, which is what the
 * original build did implicitly at 60 fps; the accumulator keeps that cadence
 * identical at 24, 30 or 60 fps export.
 */
import { COLORMAPS, engine } from "./config.js";
import { state } from "./core.js";
import { particles } from "./particles.js";
import {
  camera,
  particleGeometry,
  particleMaterial,
  renderScene,
  swarm,
  bloomPass
} from "./scene.js";
import { clamp, sampleColormap } from "./utils.js";

const {
  BASE_FRAME_TIME,
  BEAT_HISTORY,
  BEAT_COOLDOWN_FRAMES,
  FLASH_DURATION,
  RENDER_SCALE
} = engine;

let simulationAccumulator = 0;
let flashPhase = 1;

state.beatHistory = new Float32Array(BEAT_HISTORY);

/** Clear all time-varying simulation state. */
export function resetSimulation() {
  simulationAccumulator = 0;
  flashPhase = 1;
  state.time = 0;
  state.cmapA = 0;
  state.cmapB = 1;
  state.cmapMix = 0;
  state.smoothedBloom = 0.55;
  state.activeCount = state.minParticles;
  state.beatHistory.fill(0);
  state.beatHistoryIndex = 0;
  state.beatCooldown = 0;
  state.flashAlpha = 0;
  state.cameraFollowAzimuth = 0;
}

function triggerBeatFlash() {
  if (!state.beatFlashEnabled) return;
  flashPhase = 0;
}

function advanceFlash(deltaTime) {
  if (flashPhase >= 1) {
    state.flashAlpha = 0;
    return;
  }
  flashPhase = Math.min(1, flashPhase + deltaTime / FLASH_DURATION);
  // Matches the original CSS keyframes: rise to full at 8%, then fall to 0.
  const curve =
    flashPhase < 0.08 ? flashPhase / 0.08 : 1 - (flashPhase - 0.08) / 0.92;
  state.flashAlpha =
    clamp(curve, 0, 1) * (state.beatFlashIntensity / 100);
}

function detectBeat(magnitudes, reactivity) {
  const bassEnergy = magnitudes[0] * 0.5 + magnitudes[1] * 0.5;
  state.beatHistory[state.beatHistoryIndex] = bassEnergy;
  state.beatHistoryIndex = (state.beatHistoryIndex + 1) % BEAT_HISTORY;

  let sum = 0;
  for (let index = 0; index < BEAT_HISTORY; index += 1) {
    sum += state.beatHistory[index];
  }
  const average = sum / BEAT_HISTORY;
  const threshold = average * (state.beatSensitivity - reactivity * 0.1);

  state.beatCooldown = Math.max(0, state.beatCooldown - 1);
  if (bassEnergy > threshold && bassEnergy > 0.25 && state.beatCooldown === 0) {
    triggerBeatFlash();
    state.beatCooldown = BEAT_COOLDOWN_FRAMES;
  }
}

function updateParticleGeometry() {
  const activeCount = state.activeCount;
  const visualizationScale = RENDER_SCALE * (state.visualizationSize / 100);
  for (let index = 0; index < activeCount; index += 1) {
    const particle = particles[index];
    const offset = index * 3;
    swarm.positions[offset] = particle.positionX * visualizationScale;
    swarm.positions[offset + 1] = particle.positionY * visualizationScale;
    swarm.positions[offset + 2] = particle.positionZ * visualizationScale;
    swarm.colors[offset] = particle.colorR;
    swarm.colors[offset + 1] = particle.colorG;
    swarm.colors[offset + 2] = particle.colorB;
  }

  particleGeometry.attributes.position.needsUpdate = true;
  particleGeometry.attributes.color.needsUpdate = true;
  particleGeometry.setDrawRange(0, activeCount);
}

/**
 * Advance the swarm, the colormap cycle and beat detection by one fixed
 * sub-step. Everything here ran once per animation frame in the original.
 */
function stepSimulation(stepTime, context) {
  const {
    isActive,
    avgMagnitude,
    sphereMagnitude,
    reactivity,
    brightness
  } = context;

  state.time += stepTime;

  // Colormap cycling.
  const cycleRate = isActive ? 0.08 + sphereMagnitude * 0.42 : 0.06;
  if (isActive && state.lockedCmapIndex < 0) {
    state.cmapMix += stepTime * cycleRate * state.cycleSpeed;
    while (state.cmapMix >= 1) {
      state.cmapMix -= 1;
      state.cmapA = state.cmapB;
      state.cmapB = (state.cmapB + 1) % COLORMAPS.length;
    }
  } else if (state.lockedCmapIndex >= 0) {
    state.cmapA = state.lockedCmapIndex;
    state.cmapB = state.lockedCmapIndex;
    state.cmapMix = 0;
  }

  // Particle count follows the average magnitude.
  const targetCount = isActive
    ? Math.floor(
        state.minParticles +
          avgMagnitude * reactivity * (state.maxParticles - state.minParticles)
      )
    : state.minParticles;
  state.activeCount = Math.floor(
    state.activeCount + (targetCount - state.activeCount) * 0.05
  );
  state.activeCount = clamp(
    state.activeCount,
    state.minParticles,
    state.maxParticles
  );

  if (!isActive) return;

  const amplitude = clamp(sphereMagnitude, 0, 1);
  const dynamicNoiseScale = state.noiseScale * (0.125 + sphereMagnitude * 1.125);
  const dynamicSphereBoundary =
    state.sphereBoundary * (1.0 + sphereMagnitude * 0.7);

  const stopsA = COLORMAPS[state.cmapA].stops;
  const stopsB = COLORMAPS[state.cmapB].stops;
  const mix = state.cmapMix;

  const movement = {
    type: state.boidType,
    morphSpeed: state.morphSpeed,
    speed: state.movementSpeed,
    amount: state.movementAmount / 100,
    alignment: state.boidAlignment / 100,
    cohesion: state.boidCohesion / 100,
    separation: state.boidSeparation / 100
  };

  for (let index = 0; index < state.activeCount; index += 1) {
    const particle = particles[index];
    particle.update(
      index,
      particles,
      state.activeCount,
      state.time,
      amplitude,
      dynamicNoiseScale,
      dynamicSphereBoundary,
      state.damping,
      movement
    );

    const distance = Math.sqrt(
      particle.positionX * particle.positionX +
        particle.positionY * particle.positionY +
        particle.positionZ * particle.positionZ
    );
    const normalizedDistance = Math.min(distance / dynamicSphereBoundary, 1.0);

    const colorA = sampleColormap(stopsA, normalizedDistance);
    const colorB = sampleColormap(stopsB, normalizedDistance);

    particle.colorR = (colorA[0] + (colorB[0] - colorA[0]) * mix) * brightness;
    particle.colorG = (colorA[1] + (colorB[1] - colorA[1]) * mix) * brightness;
    particle.colorB = (colorA[2] + (colorB[2] - colorA[2]) * mix) * brightness;
  }

  detectBeat(state.magnitudes, reactivity);
}

/**
 * Update the camera from the selected movement preset. Static reproduces the
 * previous fixed camera exactly; movement presets are deterministic so preview
 * and export use the same camera path.
 */
function updateCamera(deltaTime, playing) {
  const distance = state.cameraDistance;
  const amount = state.cameraAmount / 100;
  const speed = state.cameraSpeed;
  const time = state.time * speed;
  const radius = distance * 0.42 * amount;

  let x = 0;
  let y = 0;
  let z = distance;

  switch (state.cameraPreset) {
    case "orbit": {
      const angle = time * 0.55;
      x = Math.cos(angle) * radius;
      y = Math.sin(angle) * radius;
      break;
    }
    case "figure8": {
      const angle = time * 0.5;
      x = Math.sin(angle) * radius;
      y = Math.sin(angle * 2) * radius * 0.5;
      break;
    }
    case "pushPull": {
      const depthRange = distance * 0.35 * amount;
      z = Math.max(5, distance + Math.sin(time * 0.7) * depthRange);
      break;
    }
    case "drift": {
      x = Math.sin(time * 0.42) * radius;
      y = Math.sin(time * 0.31 + 1.35) * radius * 0.6;
      z = Math.max(5, distance + Math.sin(time * 0.23 + 2.1) * radius * 0.45);
      break;
    }
    case "spectralCentroid": {
      const energy = clamp(state.spectralEnergy || 0, 0, 1);
      const centroidOffset = energy > 0.02
        ? (clamp(state.spectralCentroid || 0.5, 0, 1) - 0.5) * 100 * amount
        : 0;
      const response = playing
        ? 1 - Math.exp(-Math.max(0.001, deltaTime) * (1.5 + speed * 2.5))
        : 0;
      state.cameraFollowAzimuth += (centroidOffset - state.cameraFollowAzimuth) * response;
      const angle = state.cameraFollowAzimuth * Math.PI / 180;
      x = Math.sin(angle) * distance;
      z = Math.cos(angle) * distance;
      y = (energy - 0.5) * distance * 0.08 * amount;
      break;
    }
    case "static":
    default:
      break;
  }

  // Apply user camera orientation as spherical angular offsets around the
  // visualization. Zero elevation/azimuth preserves every preset exactly.
  const sphericalRadius = Math.hypot(x, y, z);
  if (sphericalRadius > 0) {
    const baseAzimuth = Math.atan2(x, z);
    const normalizedY = clamp(y / sphericalRadius, -1, 1);
    const baseElevation = Math.asin(normalizedY);
    const azimuth = baseAzimuth + state.cameraAzimuth * Math.PI / 180;
    const elevation = clamp(
      baseElevation + state.cameraElevation * Math.PI / 180,
      -89 * Math.PI / 180,
      89 * Math.PI / 180
    );
    const horizontalRadius = sphericalRadius * Math.cos(elevation);

    x = Math.sin(azimuth) * horizontalRadius;
    y = Math.sin(elevation) * sphericalRadius;
    z = Math.cos(azimuth) * horizontalRadius;
  }

  camera.position.set(x, y, z);
  camera.lookAt(0, 0, 0);
}

/**
 * Render one frame.
 * @param {number} deltaTime seconds since the previous frame
 * @param {boolean} playing whether the transport is running
 */
export function renderFrame(deltaTime, playing) {
  const isActive = playing && (state.hasAudio ? state.analysisReady : true);
  const reactivity = state.reactivity / 100;

  let rawAverage = 0;
  for (let index = 0; index < state.magnitudes.length; index += 1) {
    rawAverage += state.magnitudes[index];
  }
  rawAverage /= state.magnitudes.length;

  const avgMagnitude = Math.min(1, rawAverage * reactivity);
  const sphereMagnitude = Math.min(1, state.lowFreqMagnitude * reactivity);
  const brightness =
    (isActive ? 0.25 + sphereMagnitude * 0.95 : 0.25) *
    (state.brightness / 100);

  if (playing) {
    simulationAccumulator += deltaTime;
    let guard = 0;
    while (simulationAccumulator >= BASE_FRAME_TIME && guard < 8) {
      stepSimulation(BASE_FRAME_TIME, {
        isActive,
        avgMagnitude,
        sphereMagnitude,
        reactivity,
        brightness
      });
      simulationAccumulator -= BASE_FRAME_TIME;
      guard += 1;
    }
    if (guard >= 8) simulationAccumulator = 0;
  }

  advanceFlash(playing ? deltaTime : 0);

  particleMaterial.size =
    state.particleSize * (1.0 + sphereMagnitude * reactivity * 2.2);
  particleMaterial.opacity = state.particleOpacity / 100;

  const bloomTarget = state.hasAudio
    ? state.bloomBase + avgMagnitude * reactivity * state.bloomGain
    : 0.55;
  state.smoothedBloom += (bloomTarget - state.smoothedBloom) * 0.08;
  bloomPass.strength = state.smoothedBloom;
  bloomPass.radius = state.bloomRadius;
  bloomPass.threshold = state.bloomThreshold;

  updateParticleGeometry();
  updateCamera(deltaTime, playing);
  renderScene();
}
