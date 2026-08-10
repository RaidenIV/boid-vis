/** core.js — shared mutable state and DOM element handles. */
import { defaults, loopDefaults, videoExportDefaults } from "./config.js";

export const state = {
  ...defaults,

  // Audio
  fileName: "",
  objectUrl: "",
  hasAudio: false,
  isPlaying: false,
  analysisReady: false,
  isAnalyzing: false,
  decodedAudioBuffer: null,

  // Precomputed analysis timeline
  analysis: null,          // { fps, frameCount, bands: Float32Array[7], low: Float32Array }
  analysisVersion: 0,

  // Live magnitudes handed to the render step
  magnitudes: new Float32Array(7),
  lowFreqMagnitude: 0,

  // Simulation clock
  time: 0,
  activeCount: defaults.minParticles,
  smoothedBloom: 0.55,
  cmapA: 0,
  cmapB: 1,
  cmapMix: 0,

  // Beat detection
  beatHistory: null,
  beatHistoryIndex: 0,
  beatCooldown: 0,
  flashAlpha: 0,

  // Loop
  loopBpm: loopDefaults.bpm,
  loopBars: loopDefaults.bars,
  loopSnap: loopDefaults.snap,
  loopStart: loopDefaults.start,
  loopEnd: loopDefaults.end,
  loopReady: false,
  loopWaveformPeaks: null,
  loopDragTarget: null,
  loopDragAnchor: 0,

  // Viewport
  cssWidth: 0,
  cssHeight: 0,
  pixelRatio: 1,

  // Export
  videoFileType: videoExportDefaults.fileType,
  videoResolution: videoExportDefaults.resolution,
  videoFrameRate: videoExportDefaults.frameRate,
  videoBitrateMbps: videoExportDefaults.bitrateMbps,
  isExportingPng: false,
  isExportingVideo: false,
  videoExportCancelled: false,
  videoExportCancelHandlers: new Set(),

  // UI
  panelCollapsed: false,
  uiHidden: false
};

const byId = (id) => document.getElementById(id);

export const elements = {
  container: byId("visualizer-container"),
  canvas: byId("canvas"),
  panel: byId("controls"),
  minimize: byId("minimize-btn"),
  beatFlash: byId("beat-flash"),
  dragOverlay: byId("drag-overlay"),

  // File and playback
  loadButton: byId("load-btn"),
  loadButtonText: byId("load-btn-text"),
  audioFile: byId("audio-file"),
  audioLoadWrap: byId("audio-load-wrap"),
  audioLoadProgress: byId("audio-load-progress"),
  audioLoadPercent: byId("audio-load-percent"),
  audioLoadStage: byId("audio-load-stage"),
  audioName: byId("audio-name"),
  playButton: byId("play-btn"),
  loopButton: byId("loop-btn"),
  progressContainer: byId("progress-container"),
  progressBar: byId("progress-bar"),
  progressFill: byId("progress-fill"),
  currentTime: byId("current-time"),
  durationTime: byId("duration-time"),
  volume: byId("volume-slider"),
  volumeValue: byId("volume-value"),
  muteToggle: byId("mute-toggle"),

  // Loop editor
  loopWaveWrap: byId("loop-wave-wrap"),
  loopWaveCanvas: byId("loop-wave-canvas"),
  loopRegion: byId("loop-region"),
  loopStartHandle: byId("loop-start-handle"),
  loopEndHandle: byId("loop-end-handle"),
  loopPlayhead: byId("loop-playhead"),
  loopStartReadout: byId("loop-start-readout"),
  loopEndReadout: byId("loop-end-readout"),
  loopDurationReadout: byId("loop-duration-readout"),
  loopBeatReadout: byId("loop-beat-readout"),
  loopStatus: byId("loop-status"),
  loopBpmValue: byId("loop-bpm-value"),
  loopBarsValue: byId("loop-bars-value"),
  loopSnap: byId("loop-snap"),
  detectBpm: byId("detect-bpm"),
  fullTrackLoop: byId("full-track-loop"),

  // Viewport
  viewportPreset: byId("viewport-preset"),

  // Camera
  cameraPreset: byId("camera-preset"),
  cameraSpeed: byId("camera-speed"),
  cameraSpeedValue: byId("camera-speed-value"),
  cameraAmount: byId("camera-amount"),
  cameraAmountValue: byId("camera-amount-value"),
  cameraDistance: byId("camera-distance"),
  cameraDistanceValue: byId("camera-distance-value"),
  cameraElevation: byId("camera-elevation"),
  cameraElevationValue: byId("camera-elevation-value"),
  cameraAzimuth: byId("camera-azimuth"),
  cameraAzimuthValue: byId("camera-azimuth-value"),

  // Audio resolution
  fftSize: byId("fft-size"),
  fftLoadWrap: byId("fft-load-wrap"),
  fftLoadProgress: byId("fft-load-progress"),
  fftLoadPercent: byId("fft-load-percent"),
  smoothing: byId("smoothing"),
  smoothingValue: byId("smoothing-value"),

  // Particles
  reactivity: byId("reactivity-slider"),
  reactivityValue: byId("reactivity-value"),
  boidType: byId("boid-type"),
  morphSpeedControl: byId("morph-speed-control"),
  morphSpeed: byId("morph-speed"),
  morphSpeedValue: byId("morph-speed-value"),
  movementSpeed: byId("movement-speed"),
  movementSpeedValue: byId("movement-speed-value"),
  movementAmount: byId("movement-amount"),
  movementAmountValue: byId("movement-amount-value"),
  boidAlignment: byId("boid-alignment"),
  boidAlignmentValue: byId("boid-alignment-value"),
  boidCohesion: byId("boid-cohesion"),
  boidCohesionValue: byId("boid-cohesion-value"),
  boidSeparation: byId("boid-separation"),
  boidSeparationValue: byId("boid-separation-value"),
  visualizationSize: byId("visualization-size"),
  visualizationSizeValue: byId("visualization-size-value"),
  minParticles: byId("min-particles"),
  minParticlesValue: byId("min-particles-value"),
  maxParticles: byId("max-particles"),
  maxParticlesValue: byId("max-particles-value"),
  particleSize: byId("particle-size"),
  particleSizeValue: byId("particle-size-value"),
  particleOpacity: byId("particle-opacity"),
  particleOpacityValue: byId("particle-opacity-value"),
  noiseScale: byId("noise-scale"),
  noiseScaleValue: byId("noise-scale-value"),
  damping: byId("damping"),
  dampingValue: byId("damping-value"),
  sphereBoundary: byId("sphere-boundary"),
  sphereBoundaryValue: byId("sphere-boundary-value"),

  // Bloom
  bloomBase: byId("bloom-base"),
  bloomBaseValue: byId("bloom-base-value"),
  bloomGain: byId("bloom-gain"),
  bloomGainValue: byId("bloom-gain-value"),
  bloomRadius: byId("bloom-radius"),
  bloomRadiusValue: byId("bloom-radius-value"),
  bloomThreshold: byId("bloom-threshold"),
  bloomThresholdValue: byId("bloom-threshold-value"),

  // Color
  cmapToggleRow: byId("cmap-toggle-row"),
  cmapBody: byId("cmap-body"),
  cmapArrow: byId("cmap-arrow"),
  cmapGrid: byId("cmap-grid"),
  cycleSpeed: byId("cycle-speed"),
  cycleSpeedValue: byId("cycle-speed-value"),
  brightness: byId("brightness"),
  brightnessValue: byId("brightness-value"),

  // Effects
  beatFlashEnabled: byId("beat-flash-enabled"),
  beatFlashIntensity: byId("beat-flash-intensity"),
  beatFlashIntensityValue: byId("beat-flash-intensity-value"),
  beatSensitivity: byId("beat-sensitivity"),
  beatSensitivityValue: byId("beat-sensitivity-value"),

  // Export
  exportFileName: byId("export-file-name"),
  exportResolution: byId("export-resolution"),
  videoFileType: byId("video-file-type"),
  videoFrameRate: byId("video-frame-rate"),
  videoBitrate: byId("video-bitrate"),
  exportVideo: byId("export-video"),
  exportPng: byId("export-png"),
  exportJson: byId("export-json"),
  exportStatus: byId("export-status"),
  exportProgressWrap: byId("export-progress-wrap"),
  exportProgress: byId("export-progress"),
  exportProgressText: byId("export-progress-text"),
  exportOverlay: byId("export-overlay"),
  exportOverlayProgress: byId("export-overlay-progress"),
  exportOverlayProgressText: byId("export-overlay-progress-text"),
  exportOverlayDetail: byId("export-overlay-detail"),
  exportCancel: byId("export-cancel"),

  resetButton: byId("reset-btn")
};

/** The single <audio> element driving preview playback. */
export const audio = new Audio();
audio.preload = "metadata";
audio.crossOrigin = "anonymous";

export const audioGraph = {
  context: null,
  sourceNode: null,
  gainNode: null
};
