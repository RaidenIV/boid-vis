/** hud.js — shared technical HUD for preview, PNG and video export. */
import { FREQ_BANDS, viewportPresets } from "./config.js";
import { audio, elements, state } from "./core.js";
import { formatTime } from "./utils.js";

const HUD_FONT = "Rajdhani, sans-serif";
// Sizing reference. At a 1080-pixel short side and hudScale 1, every derived
// value below reproduces the previous absolute-pixel layout exactly.
const HUD_REFERENCE_HEIGHT = 1080;

function titleCase(value) {
  return String(value || "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}


const SIMULATION_LABELS = Object.freeze({
  flow: "Flow",
  flock: "Flock",
  swarm: "Swarm",
  vortex: "Vortex",
  orbit: "Orbit",
  liquid: "Liquid",
  lorenz: "Lorenz",
  rossler: "Rössler",
  halvorsen: "Halvorsen",
  aizawa: "Aizawa",
  thomas: "Thomas",
  dadras: "Dadras",
  morph: "Morph"
});

function simulationLabel(value) {
  return SIMULATION_LABELS[value] || titleCase(value);
}

function getViewportLabel() {
  return viewportPresets[state.viewportPreset]?.label || "Fill Window";
}

function drawCornerTicks(context, width, height, inset, tick) {
  const right = width - inset;
  const bottom = height - inset;
  context.beginPath();
  context.moveTo(inset, inset + tick); context.lineTo(inset, inset); context.lineTo(inset + tick, inset);
  context.moveTo(right - tick, inset); context.lineTo(right, inset); context.lineTo(right, inset + tick);
  context.moveTo(inset, bottom - tick); context.lineTo(inset, bottom); context.lineTo(inset + tick, bottom);
  context.moveTo(right - tick, bottom); context.lineTo(right, bottom); context.lineTo(right, bottom - tick);
  context.stroke();
}

function drawMeters(context, x, y, width, scale) {
  const rowHeight = 11 * scale;
  const labelWidth = 64 * scale;
  const meterWidth = Math.max(48 * scale, width - labelWidth);
  context.font = `${Math.max(8, 8.5 * scale)}px ${HUD_FONT}`;
  context.textBaseline = "middle";

  FREQ_BANDS.forEach((band, index) => {
    const value = Math.max(0, Math.min(1, state.magnitudes[index] || 0));
    const rowY = y + index * rowHeight;
    context.fillStyle = "rgba(255,255,255,0.62)";
    context.fillText(band.name.toUpperCase(), x, rowY + rowHeight * 0.5);
    const barX = x + labelWidth;
    const barY = rowY + 3 * scale;
    const barHeight = Math.max(2, 4 * scale);
    context.fillStyle = "rgba(255,255,255,0.12)";
    context.fillRect(barX, barY, meterWidth, barHeight);
    context.fillStyle = "rgba(255,255,255,0.78)";
    context.fillRect(barX, barY, meterWidth * value, barHeight);
  });
}

export function drawHud(context, width, height) {
  if (!state.hudEnabled || !context || width <= 0 || height <= 0) return;

  const userScale = Math.max(0.5, Math.min(2, Number(state.hudScale) || 1));
  // Everything below is expressed in units of `scale`, which folds in the
  // output resolution. Previously `inset` and `fontSize` scaled with the frame
  // while `tick`, `lineWidth` and every constant in drawMeters() were absolute
  // pixels, so a 4K export drew the same HUD chrome as a 1080p preview at a
  // third the relative size, with hairline strokes. This function is shared by
  // preview, PNG and video precisely so they match.
  const scale = userScale * (Math.min(width, height) / HUD_REFERENCE_HEIGHT);
  const opacity = Math.max(0, Math.min(1, Number(state.hudOpacity) || 0));
  const inset = Math.max(16, 27 * scale);
  const tick = 18 * scale;
  const fontSize = Math.max(9, 12.96 * scale);
  const lineHeight = fontSize * 1.32;

  context.save();
  context.globalAlpha *= opacity;
  context.strokeStyle = "rgba(255,255,255,0.46)";
  context.lineWidth = Math.max(1, scale);

  drawCornerTicks(context, width, height, inset, tick);

  context.font = `600 ${fontSize}px ${HUD_FONT}`;
  context.textBaseline = "top";
  context.fillStyle = "rgba(255,255,255,0.84)";

  const fileName = state.fileName || "NO AUDIO LOADED";
  const current = state.hasAudio
    ? (Number.isFinite(state.renderTimeOverride) ? state.renderTimeOverride : audio.currentTime)
    : 0;
  const duration = state.decodedAudioBuffer?.duration || audio.duration || 0;
  const leftLines = [
    "PARTICLE VISUALIZER / SYSTEM HUD",
    fileName,
    `${state.isExportingVideo ? "EXPORT" : state.isPlaying ? "PLAY" : "PAUSE"}  ${formatTime(current)} / ${formatTime(duration)}`,
    `SIMULATION ${simulationLabel(state.boidType)}  /  CAMERA ${titleCase(state.cameraPreset)}`,
    `AMPLITUDE ${titleCase(state.amplitudeMode)}  /  ${getViewportLabel()}`
  ];

  leftLines.forEach((line, index) => {
    context.globalAlpha = opacity * (index === 0 ? 1 : 0.76);
    context.fillText(line, inset, inset + index * lineHeight);
  });

  context.globalAlpha = opacity;
  context.textAlign = "right";
  const rightLines = [
    `${Math.round(state.previewFps || 0)} FPS`,
    `AZ ${Math.round(state.cameraAzimuth)}° / EL ${Math.round(state.cameraElevation)}°`,
    `CENTROID ${Math.round((state.spectralCentroid || 0.5) * 100)}%`,
    `PARTICLES ${Math.round(state.activeCount || 0).toLocaleString()}`
  ];
  rightLines.forEach((line, index) => {
    context.fillStyle = index === 0 ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.66)";
    context.fillText(line, width - inset, inset + index * lineHeight);
  });
  context.textAlign = "left";

  const meterWidth = Math.min(width * 0.28, 210 * scale);
  const meterHeight = 7 * 11 * scale;
  drawMeters(
    context,
    inset,
    Math.max(inset + leftLines.length * lineHeight + 8 * scale, height - inset - meterHeight),
    meterWidth,
    scale
  );

  context.restore();
}

export function renderHudPreview() {
  const hudCanvas = elements.hudCanvas;
  if (!hudCanvas) return;

  if (!state.hudEnabled) {
    hudCanvas.hidden = true;
    return;
  }
  hudCanvas.hidden = false;

  const rect = elements.canvas.getBoundingClientRect();
  const ratio = Math.max(1, state.pixelRatio || 1);
  const width = Math.max(1, Math.round(rect.width * ratio));
  const height = Math.max(1, Math.round(rect.height * ratio));

  if (hudCanvas.width !== width || hudCanvas.height !== height) {
    hudCanvas.width = width;
    hudCanvas.height = height;
  }
  hudCanvas.style.left = `${rect.left}px`;
  hudCanvas.style.top = `${rect.top}px`;
  hudCanvas.style.width = `${rect.width}px`;
  hudCanvas.style.height = `${rect.height}px`;

  const context = hudCanvas.getContext("2d");
  context.clearRect(0, 0, width, height);
  drawHud(context, width, height);
}
