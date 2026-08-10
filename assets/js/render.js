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
  capGeometry,
  capMaterial,
  cap,
  glowMaterial,
  glowSprite,
  particleGeometry,
  particleMaterial,
  renderScene,
  swarm,
  tunnel,
  tunnelGeometry,
  tunnelMaterial,
  vanishingMaterial,
  tunnelGroup,
  bloomPass
} from "./scene.js";
import { clamp, sampleColormap } from "./utils.js";

const {
  BASE_FRAME_TIME,
  BEAT_HISTORY,
  BEAT_COOLDOWN_FRAMES,
  CAP_COUNT,
  FLASH_DURATION,
  RENDER_SCALE,
  TUNNEL_LENGTH,
  TUNNEL_RADIUS,
  TUNNEL_START
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
  for (let index = 0; index < activeCount; index += 1) {
    const particle = particles[index];
    const offset = index * 3;
    swarm.positions[offset] = particle.positionX * RENDER_SCALE;
    swarm.positions[offset + 1] = particle.positionY * RENDER_SCALE;
    swarm.positions[offset + 2] = particle.positionZ * RENDER_SCALE;
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

  for (let index = 0; index < state.activeCount; index += 1) {
    const particle = particles[index];
    particle.update(
      state.time,
      amplitude,
      dynamicNoiseScale,
      dynamicSphereBoundary,
      state.damping
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

function updateTunnel(deltaTime, isActive, magnitude) {
  const speed = isActive
    ? (260.0 + magnitude * 3600.0) * state.tunnelSpeed
    : 0;
  const intensity = isActive ? 0.22 + magnitude * 0.85 : 0.18;
  const scrollTime = state.time;

  if (isActive || !state.hasAudio) {
    const positions = tunnel.positions;
    const colors = tunnel.colors;

    for (let index = 0; index < tunnel.count; index += 1) {
      const offset = index * 3;
      let z = positions[offset + 2];
      z += speed * deltaTime;
      if (z > -TUNNEL_START) {
        z = -(TUNNEL_START + Math.random() * TUNNEL_LENGTH);
      }
      positions[offset + 2] = z;

      const along = clamp((-z - TUNNEL_START) / TUNNEL_LENGTH, 0, 1);
      const startFade = 0.01 + 1.0 * Math.pow(1.0 - along, 9.2);
      const near = clamp(1.0 - along, 0, 1);
      const far = 1.0 - near;
      const fade = 0.2 + 0.8 * near + 0.25 * far;
      const twinkle = 0.78 + 0.22 * Math.sin(scrollTime * 2.0 + index * 0.013);
      const brightness = clamp(
        intensity * fade * twinkle * tunnel.weights[index] * startFade,
        0,
        1
      );

      colors[offset] = brightness;
      colors[offset + 1] = brightness;
      colors[offset + 2] = brightness;
    }

    tunnelGeometry.attributes.position.needsUpdate = true;
    tunnelGeometry.attributes.color.needsUpdate = true;

    const capColors = cap.colors;
    for (let index = 0; index < CAP_COUNT; index += 1) {
      const offset = index * 3;
      const twinkle = 0.84 + 0.16 * Math.sin(scrollTime * 1.1 + index * 0.019);
      const brightness = clamp(
        (0.16 + intensity * 0.62) * twinkle * cap.weights[index],
        0,
        1
      );
      capColors[offset] = brightness;
      capColors[offset + 1] = brightness;
      capColors[offset + 2] = brightness;
    }
    capGeometry.attributes.color.needsUpdate = true;
  }

  // Material response to magnitude. The literal expressions are the original
  // values; the control multipliers are 1.0 at their defaults.
  const sizeScale = state.tunnelSize / 0.85;
  const tunnelOpacityScale = state.tunnelOpacity / 50;
  const capOpacityScale = state.capOpacity / 22;
  const glowOpacityScale = state.glowOpacity / 22;

  tunnelMaterial.size = (isActive ? 0.7 + magnitude * 1.1 : 0.75) * sizeScale;
  tunnelMaterial.opacity =
    (isActive ? 0.3 + magnitude * 0.4 : 0.28) * tunnelOpacityScale;

  vanishingMaterial.size = isActive ? 1.1 + magnitude * 1.4 : 1.25;
  vanishingMaterial.opacity = isActive ? 0.1 + magnitude * 0.22 : 0.12;

  capMaterial.size = isActive ? 0.01 + magnitude * 0.01 : 0.92;
  capMaterial.opacity =
    (isActive ? 0.14 + magnitude * 0.22 : 0.14) * capOpacityScale;

  glowMaterial.opacity =
    (isActive ? 0.1 + magnitude * 0.35 : 0.12) * glowOpacityScale;
  const glowScale = isActive
    ? TUNNEL_RADIUS * (2.6 + magnitude * 1.0)
    : TUNNEL_RADIUS * 2.75;
  glowSprite.scale.set(glowScale, glowScale, 1);

  // Keep the tunnel locked to the camera pose so perspective never drifts.
  tunnelGroup.position.copy(camera.position);
  tunnelGroup.quaternion.copy(camera.quaternion);
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

  updateTunnel(playing ? deltaTime : 0, isActive, avgMagnitude);
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
  camera.lookAt(0, 0, 0);
  renderScene();
}
