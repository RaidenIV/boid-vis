/**
 * app.js — entry point. Binds every control, wires the transport and runs the
 * preview render loop.
 */
import { sampleAnalysisAtTime } from "./analysis.js";
import { defaults } from "./config.js";
import { audio, elements, state } from "./core.js";
import {
  bindRange,
  bindSelect,
  bindToggle,
  buildColormapGrid,
  enhanceValueEditors,
  initializeCollapsibleSections,
  initializeColormapDisclosure,
  initializePanelToggle,
  setControlValue
} from "./controls.js";
import {
  exportJson,
  exportPng,
  exportVideo,
  requestVideoExportCancel,
  updateVideoExportFormatUi
} from "./export.js";
import { loadAudioFile, reanalyzeCurrentBuffer } from "./loader.js";
import {
  applyLoopBars,
  drawLoopWaveform,
  initializeLoopEditor,
  runBpmDetection,
  setFullTrackLoop,
  updateLoopPlayhead,
  updateLoopSelectionUi
} from "./loop.js";
import { reseedParticles } from "./particles.js";
import {
  applyVolume,
  currentPlayheadTime,
  enforceLoopRange,
  seekTo,
  setPlayButtonState,
  togglePlayback,
  updateLoopButtonState,
  updateTransportUi
} from "./playback.js";
import { renderFrame, resetSimulation } from "./render.js";
import { initializeSectionResets, resetAll } from "./reset.js";
import { setTunnelCount } from "./scene.js";
import { clamp } from "./utils.js";
import { fitViewport } from "./viewport.js";

/* ---------------------------------------------------------------------------
   Control wiring
--------------------------------------------------------------------------- */
let reanalysisTimer = null;

function scheduleReanalysis() {
  window.clearTimeout(reanalysisTimer);
  reanalysisTimer = window.setTimeout(() => {
    reanalyzeCurrentBuffer();
  }, 250);
}

function bindControls() {
  // Playback
  bindRange(elements.volume, elements.volumeValue, "volume", applyVolume);
  bindToggle(elements.muteToggle, "muted", applyVolume);

  // Audio resolution
  bindSelect(elements.fftSize, "fftSize", scheduleReanalysis, Number);
  bindRange(elements.smoothing, elements.smoothingValue, "smoothing", scheduleReanalysis);

  // Viewport
  bindSelect(elements.viewportPreset, "viewportPreset", () => fitViewport());

  // Particles
  bindRange(elements.reactivity, elements.reactivityValue, "reactivity");
  bindRange(elements.minParticles, elements.minParticlesValue, "minParticles", (value) => {
    if (value > state.maxParticles) setControlValue("maxParticles", value);
  });
  bindRange(elements.maxParticles, elements.maxParticlesValue, "maxParticles", (value) => {
    if (value < state.minParticles) setControlValue("minParticles", value);
  });
  bindRange(elements.particleSize, elements.particleSizeValue, "particleSize");
  bindRange(elements.particleOpacity, elements.particleOpacityValue, "particleOpacity");
  bindRange(elements.noiseScale, elements.noiseScaleValue, "noiseScale");
  bindRange(elements.damping, elements.dampingValue, "damping");
  bindRange(elements.sphereBoundary, elements.sphereBoundaryValue, "sphereBoundary", (value) => {
    reseedParticles(value);
  });

  // Bloom
  bindRange(elements.bloomBase, elements.bloomBaseValue, "bloomBase");
  bindRange(elements.bloomGain, elements.bloomGainValue, "bloomGain");
  bindRange(elements.bloomRadius, elements.bloomRadiusValue, "bloomRadius");
  bindRange(elements.bloomThreshold, elements.bloomThresholdValue, "bloomThreshold");

  // Tunnel
  bindRange(elements.tunnelSpeed, elements.tunnelSpeedValue, "tunnelSpeed");
  bindRange(elements.tunnelCount, elements.tunnelCountValue, "tunnelCount", setTunnelCount);
  bindRange(elements.tunnelSize, elements.tunnelSizeValue, "tunnelSize");
  bindRange(elements.tunnelOpacity, elements.tunnelOpacityValue, "tunnelOpacity");
  bindRange(elements.capOpacity, elements.capOpacityValue, "capOpacity");
  bindRange(elements.glowOpacity, elements.glowOpacityValue, "glowOpacity");

  // Color
  bindRange(elements.cycleSpeed, elements.cycleSpeedValue, "cycleSpeed");
  bindRange(elements.brightness, elements.brightnessValue, "brightness");

  // Effects
  bindToggle(elements.beatFlashEnabled, "beatFlashEnabled");
  bindRange(
    elements.beatFlashIntensity,
    elements.beatFlashIntensityValue,
    "beatFlashIntensity"
  );
  bindRange(elements.beatSensitivity, elements.beatSensitivityValue, "beatSensitivity");

  // Export format
  bindSelect(elements.exportResolution, "videoResolution");
  bindSelect(elements.videoFileType, "videoFileType", () =>
    updateVideoExportFormatUi(true)
  );
  bindSelect(elements.videoFrameRate, "videoFrameRate", () => {}, Number);
  bindSelect(elements.videoBitrate, "videoBitrateMbps", () => {}, Number);

  setTunnelCount(state.tunnelCount);
}

/* ---------------------------------------------------------------------------
   Transport wiring
--------------------------------------------------------------------------- */
function bindTransport() {
  elements.audioFile.addEventListener("change", async (event) => {
    const file = event.target.files[0];
    event.target.value = "";
    if (file) await handleFile(file);
  });

  elements.playButton.addEventListener("click", togglePlayback);

  elements.loopButton.addEventListener("click", () => {
    state.audioLoop = !state.audioLoop;
    updateLoopButtonState();
  });

  audio.addEventListener("ended", () => {
    if (state.audioLoop && state.loopReady) {
      audio.currentTime = state.loopStart;
      audio.play().catch(() => {});
      return;
    }
    state.isPlaying = false;
    setPlayButtonState();
  });

  // Progress bar scrubbing — click and drag.
  let isScrubbing = false;
  const scrubTo = (clientX) => {
    if (!state.hasAudio || !Number.isFinite(audio.duration)) return;
    const rect = elements.progressBar.getBoundingClientRect();
    const fraction = clamp((clientX - rect.left) / rect.width, 0, 1);
    seekTo(fraction * audio.duration);
  };

  elements.progressBar.addEventListener("mousedown", (event) => {
    isScrubbing = true;
    scrubTo(event.clientX);
    event.preventDefault();
  });
  elements.progressBar.addEventListener(
    "touchstart",
    (event) => {
      isScrubbing = true;
      scrubTo(event.touches[0].clientX);
    },
    { passive: true }
  );
  document.addEventListener("mousemove", (event) => {
    if (isScrubbing) scrubTo(event.clientX);
  });
  document.addEventListener(
    "touchmove",
    (event) => {
      if (isScrubbing) scrubTo(event.touches[0].clientX);
    },
    { passive: true }
  );
  document.addEventListener("mouseup", () => {
    isScrubbing = false;
  });
  document.addEventListener("touchend", () => {
    isScrubbing = false;
  });
}

/* ---------------------------------------------------------------------------
   Loop wiring
--------------------------------------------------------------------------- */
function bindLoopControls() {
  initializeLoopEditor();

  elements.loopBpmValue.addEventListener("change", (event) => {
    state.loopBpm = clamp(Number(event.target.value) || 120, 40, 300);
    event.target.value = String(state.loopBpm);
    updateLoopSelectionUi();
  });

  elements.loopBarsValue.addEventListener("change", (event) => {
    state.loopBars = clamp(Number(event.target.value) || 4, 1, 999);
    event.target.value = String(state.loopBars);
    applyLoopBars();
  });

  elements.loopSnap.addEventListener("change", (event) => {
    state.loopSnap = event.target.checked;
  });

  elements.detectBpm.addEventListener("click", runBpmDetection);
  elements.fullTrackLoop.addEventListener("click", setFullTrackLoop);
}

/* ---------------------------------------------------------------------------
   Export wiring
--------------------------------------------------------------------------- */
function bindExportControls() {
  elements.exportVideo.addEventListener("click", exportVideo);
  elements.exportPng.addEventListener("click", exportPng);
  elements.exportJson.addEventListener("click", exportJson);
  elements.exportCancel.addEventListener("click", requestVideoExportCancel);
  updateVideoExportFormatUi(true);
}

/* ---------------------------------------------------------------------------
   File handling (picker and drag-and-drop)
--------------------------------------------------------------------------- */
async function handleFile(file) {
  await loadAudioFile(file, () => {
    drawLoopWaveform();
    updateLoopSelectionUi();
  });
}

function bindDragAndDrop() {
  let dragCounter = 0;

  document.addEventListener("dragenter", (event) => {
    event.preventDefault();
    dragCounter += 1;
    if (event.dataTransfer.types.includes("Files")) {
      elements.dragOverlay.classList.add("active");
    }
  });
  document.addEventListener("dragleave", () => {
    dragCounter -= 1;
    if (dragCounter <= 0) {
      dragCounter = 0;
      elements.dragOverlay.classList.remove("active");
    }
  });
  document.addEventListener("dragover", (event) => event.preventDefault());
  document.addEventListener("drop", async (event) => {
    event.preventDefault();
    dragCounter = 0;
    elements.dragOverlay.classList.remove("active");
    const file = event.dataTransfer.files[0];
    if (!file || !file.type.startsWith("audio/")) return;
    await handleFile(file);
  });
}

/* ---------------------------------------------------------------------------
   Keyboard shortcuts
--------------------------------------------------------------------------- */
function bindKeyboardShortcuts() {
  document.addEventListener("keydown", (event) => {
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      target.matches("input, select, textarea")
    ) {
      return;
    }

    if (event.key === "f" || event.key === "F") {
      event.preventDefault();
      if (!document.fullscreenElement) {
        elements.container.requestFullscreen().catch((error) => {
          console.error("Could not enter fullscreen:", error);
        });
      } else {
        document.exitFullscreen();
      }
    }

    if (event.key === " " || event.code === "Space") {
      event.preventDefault();
      if (state.hasAudio) togglePlayback();
    }

    if (event.key === "h" || event.key === "H") {
      event.preventDefault();
      state.uiHidden = elements.panel.classList.toggle("hidden");
    }

    if (event.key === "l" || event.key === "L") {
      event.preventDefault();
      if (!elements.loopButton.disabled) {
        state.audioLoop = !state.audioLoop;
        updateLoopButtonState();
      }
    }
  });
}

/* ---------------------------------------------------------------------------
   Preview loop
--------------------------------------------------------------------------- */
let lastTimestamp = 0;

function tick(timestamp) {
  requestAnimationFrame(tick);

  if (state.isExportingVideo) {
    lastTimestamp = timestamp;
    return;
  }

  const deltaTime =
    lastTimestamp === 0
      ? 1 / 60
      : clamp((timestamp - lastTimestamp) / 1000, 0.001, 0.05);
  lastTimestamp = timestamp;

  if (state.hasAudio) {
    enforceLoopRange();
    if (state.analysisReady) sampleAnalysisAtTime(currentPlayheadTime());
    updateTransportUi();
    updateLoopPlayhead();
  }

  renderFrame(deltaTime, state.isPlaying);

  elements.beatFlash.style.opacity = state.beatFlashEnabled
    ? String(state.flashAlpha)
    : "0";
}

/* ---------------------------------------------------------------------------
   Boot
--------------------------------------------------------------------------- */
function boot() {
  initializeCollapsibleSections();
  enhanceValueEditors();
  bindControls();
  buildColormapGrid();
  initializeColormapDisclosure();
  initializePanelToggle();
  initializeSectionResets();
  bindTransport();
  bindLoopControls();
  bindExportControls();
  bindDragAndDrop();
  bindKeyboardShortcuts();

  elements.resetButton.addEventListener("click", resetAll);

  applyVolume();
  updateLoopButtonState();
  setPlayButtonState();
  fitViewport();
  drawLoopWaveform();
  updateLoopSelectionUi();
  resetSimulation();

  window.addEventListener("resize", () => {
    fitViewport();
    drawLoopWaveform();
    updateLoopSelectionUi();
  });

  requestAnimationFrame(tick);
}

boot();

// Keep the defaults reachable for debugging without exposing internals.
window.__particleVisualizerDefaults = defaults;
