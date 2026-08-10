/**
 * loader.js — audio file loading, decoding and offline analysis.
 */
import { analyzeAudioBuffer, computeWaveformPeaks } from "./analysis.js";
import { audio, elements, state } from "./core.js";
import { applyVolume, pausePlayback, setPlayButtonState } from "./playback.js";
import { resetSimulation } from "./render.js";
import { clamp } from "./utils.js";

let decodeContext = null;

function getDecodeContext() {
  if (!decodeContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    decodeContext = new AudioContextClass();
  }
  return decodeContext;
}

function setLoadProgress(fraction, stage) {
  const percent = clamp(Math.round(fraction * 100), 0, 100);
  elements.audioLoadWrap.hidden = false;
  elements.audioLoadProgress.value = percent;
  elements.audioLoadPercent.textContent = `${percent}%`;
  if (stage) elements.audioLoadStage.textContent = stage;
}

function hideLoadProgress() {
  elements.audioLoadWrap.hidden = true;
  elements.audioLoadProgress.value = 0;
  elements.audioLoadPercent.textContent = "0%";
}

export function setAnalysisProgress(fraction) {
  const percent = clamp(Math.round(fraction * 100), 0, 100);
  elements.fftLoadWrap.hidden = false;
  elements.fftLoadProgress.value = percent;
  elements.fftLoadPercent.textContent = `${percent}%`;
}

export function hideAnalysisProgress() {
  elements.fftLoadWrap.hidden = true;
  elements.fftLoadProgress.value = 0;
  elements.fftLoadPercent.textContent = "0%";
}

function readFileWithProgress(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onprogress = (event) => {
      if (event.lengthComputable) {
        setLoadProgress((event.loaded / event.total) * 0.5, "Reading file…");
      }
    };
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read the audio file."));
    reader.readAsArrayBuffer(file);
  });
}

function setLoopControlsEnabled(enabled) {
  elements.loopButton.disabled = !enabled;
  elements.loopStartHandle.disabled = !enabled;
  elements.loopEndHandle.disabled = !enabled;
  elements.loopBpmValue.disabled = !enabled;
  elements.loopBarsValue.disabled = !enabled;
  elements.loopSnap.disabled = !enabled;
  elements.detectBpm.disabled = !enabled;
  elements.fullTrackLoop.disabled = !enabled;
  elements.loopRegion.classList.toggle("is-disabled", !enabled);
}

/** Re-run analysis against the already-decoded buffer (FFT size / smoothing). */
export async function reanalyzeCurrentBuffer() {
  if (!state.decodedAudioBuffer || state.isAnalyzing) return;

  state.isAnalyzing = true;
  state.analysisReady = false;
  const version = ++state.analysisVersion;

  try {
    const analysis = await analyzeAudioBuffer(
      state.decodedAudioBuffer,
      state.fftSize,
      state.smoothing,
      setAnalysisProgress
    );
    if (version !== state.analysisVersion) return;
    state.analysis = analysis;
    state.analysisReady = true;
  } catch (error) {
    console.error("Analysis failed", error);
  } finally {
    if (version === state.analysisVersion) {
      state.isAnalyzing = false;
      hideAnalysisProgress();
    }
  }
}

export async function loadAudioFile(file, onReady = () => {}) {
  if (!file) return;

  pausePlayback();
  elements.loadButton.classList.add("is-busy");
  elements.loadButtonText.textContent = "Loading…";
  state.analysisReady = false;
  state.hasAudio = false;
  setLoopControlsEnabled(false);
  elements.playButton.disabled = true;

  try {
    setLoadProgress(0.02, "Reading file…");
    const arrayBuffer = await readFileWithProgress(file);

    setLoadProgress(0.6, "Decoding audio…");
    const decoded = await getDecodeContext().decodeAudioData(
      arrayBuffer.slice(0)
    );

    if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
    state.objectUrl = URL.createObjectURL(file);
    audio.src = state.objectUrl;
    audio.load();

    await new Promise((resolve, reject) => {
      const timeout = window.setTimeout(
        () => reject(new Error("Audio load timeout")),
        15000
      );
      audio.addEventListener(
        "loadedmetadata",
        () => {
          window.clearTimeout(timeout);
          resolve();
        },
        { once: true }
      );
      audio.addEventListener(
        "error",
        () => {
          window.clearTimeout(timeout);
          reject(new Error("Failed to load audio"));
        },
        { once: true }
      );
    });

    setLoadProgress(1, "Analyzing…");
    hideLoadProgress();

    state.decodedAudioBuffer = decoded;
    state.fileName = file.name;
    state.hasAudio = true;
    state.loopWaveformPeaks = computeWaveformPeaks(decoded);
    state.loopStart = 0;
    state.loopEnd = decoded.duration;
    state.loopReady = true;

    elements.audioName.textContent = file.name;
    elements.progressContainer.style.display = "block";
    elements.playButton.disabled = false;
    setLoopControlsEnabled(true);
    setPlayButtonState();
    applyVolume();
    resetSimulation();

    await reanalyzeCurrentBuffer();
    onReady();
  } catch (error) {
    console.error("Failed to load audio:", error);
    elements.audioName.textContent = "Load failed – try again";
    hideLoadProgress();
    hideAnalysisProgress();
  } finally {
    elements.loadButton.classList.remove("is-busy");
    elements.loadButtonText.textContent = "Load Audio File";
  }
}
