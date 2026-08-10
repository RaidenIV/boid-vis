/**
 * loop.js — the loop-selection editor: waveform, draggable region, beat
 * snapping and tempo detection.
 */
import { detectTempo } from "./analysis.js";
import { audio, elements, state } from "./core.js";
import { clamp, formatPreciseTime } from "./utils.js";

function getDuration() {
  return state.decodedAudioBuffer?.duration || 0;
}

export function setLoopStatus(message, status = "idle") {
  elements.loopStatus.textContent = message;
  elements.loopStatus.dataset.state = status;
}

/* ---------------------------------------------------------------------------
   Waveform drawing
--------------------------------------------------------------------------- */
export function drawLoopWaveform() {
  const canvas = elements.loopWaveCanvas;
  const wrap = elements.loopWaveWrap;
  const width = wrap.clientWidth;
  const height = wrap.clientHeight;
  if (!width || !height) return;

  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(width * ratio);
  canvas.height = Math.floor(height * ratio);

  const context = canvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);

  const peaks = state.loopWaveformPeaks;
  if (!peaks) {
    context.fillStyle = "rgba(255,255,255,0.20)";
    context.fillRect(0, height / 2 - 0.5, width, 1);
    return;
  }

  const bucketCount = peaks.length / 2;
  const middle = height / 2;

  context.fillStyle = "rgba(255,255,255,0.42)";
  for (let x = 0; x < width; x += 1) {
    const bucket = Math.min(
      bucketCount - 1,
      Math.floor((x / width) * bucketCount)
    );
    const minimum = peaks[bucket * 2];
    const maximum = peaks[bucket * 2 + 1];
    const top = middle - maximum * middle * 0.92;
    const bottom = middle - minimum * middle * 0.92;
    context.fillRect(x, top, 1, Math.max(1, bottom - top));
  }

  context.fillStyle = "rgba(255,255,255,0.14)";
  context.fillRect(0, middle - 0.5, width, 1);
}

/* ---------------------------------------------------------------------------
   Selection UI
--------------------------------------------------------------------------- */
export function updateLoopSelectionUi() {
  const duration = getDuration();
  const width = elements.loopWaveWrap.clientWidth || 1;

  if (!duration) {
    elements.loopRegion.style.left = "0px";
    elements.loopRegion.style.width = "0px";
    return;
  }

  const startX = (state.loopStart / duration) * width;
  const endX = (state.loopEnd / duration) * width;

  elements.loopRegion.style.left = `${startX}px`;
  elements.loopRegion.style.width = `${Math.max(1, endX - startX)}px`;
  elements.loopStartHandle.style.left = `${startX}px`;
  elements.loopEndHandle.style.left = `${endX}px`;

  elements.loopStartReadout.textContent = `Start ${formatPreciseTime(state.loopStart)}`;
  elements.loopEndReadout.textContent = `End ${formatPreciseTime(state.loopEnd)}`;
  elements.loopDurationReadout.textContent = `Duration ${formatPreciseTime(
    Math.max(0, state.loopEnd - state.loopStart)
  )}`;

  const beatLength = 60 / Math.max(1, state.loopBpm);
  const beats = (state.loopEnd - state.loopStart) / beatLength;
  elements.loopBeatReadout.textContent = Number.isFinite(beats)
    ? `Beat ${beats.toFixed(2)}`
    : "Beat —";
}

export function updateLoopPlayhead() {
  const duration = getDuration();
  if (!duration || !state.hasAudio) {
    elements.loopPlayhead.classList.remove("is-visible");
    return;
  }
  const width = elements.loopWaveWrap.clientWidth || 1;
  const x = (audio.currentTime / duration) * width;
  elements.loopPlayhead.style.left = `${x}px`;
  elements.loopPlayhead.classList.add("is-visible");
}

/* ---------------------------------------------------------------------------
   Snapping
--------------------------------------------------------------------------- */
export function snapToBeat(seconds) {
  if (!state.loopSnap) return seconds;
  const beatLength = 60 / Math.max(1, state.loopBpm);
  return Math.round(seconds / beatLength) * beatLength;
}

/** Set the loop end from the bars control, anchored at the current start. */
export function applyLoopBars() {
  const duration = getDuration();
  if (!duration) return;
  const beatLength = 60 / Math.max(1, state.loopBpm);
  const barLength = beatLength * 4;
  const end = clamp(
    state.loopStart + barLength * state.loopBars,
    state.loopStart + 0.05,
    duration
  );
  state.loopEnd = end;
  updateLoopSelectionUi();
}

export function setFullTrackLoop() {
  const duration = getDuration();
  if (!duration) return;
  state.loopStart = 0;
  state.loopEnd = duration;
  updateLoopSelectionUi();
  setLoopStatus("Loop covers the complete track.", "idle");
}

export function runBpmDetection() {
  if (!state.analysis) {
    setLoopStatus("Analyze audio before detecting tempo.", "error");
    return;
  }

  setLoopStatus("Detecting tempo…", "active");
  const bpm = detectTempo(state.analysis);

  if (!bpm) {
    setLoopStatus("Tempo could not be detected. Enter a BPM manually.", "error");
    return;
  }

  state.loopBpm = bpm;
  elements.loopBpmValue.value = String(bpm);
  setLoopStatus(`Detected ${bpm} BPM.`, "done");
  updateLoopSelectionUi();
}

/* ---------------------------------------------------------------------------
   Pointer interaction
--------------------------------------------------------------------------- */
function timeFromPointer(clientX) {
  const duration = getDuration();
  const rect = elements.loopWaveWrap.getBoundingClientRect();
  const fraction = clamp((clientX - rect.left) / rect.width, 0, 1);
  return snapToBeat(fraction * duration);
}

function beginDrag(target) {
  state.loopDragTarget = target;
}

export function initializeLoopEditor() {
  const handlePointerMove = (event) => {
    if (!state.loopDragTarget || !state.loopReady) return;
    const duration = getDuration();
    const time = clamp(timeFromPointer(event.clientX), 0, duration);

    if (state.loopDragTarget === "start") {
      state.loopStart = Math.min(time, state.loopEnd - 0.05);
    } else if (state.loopDragTarget === "end") {
      state.loopEnd = Math.max(time, state.loopStart + 0.05);
    } else {
      // Dragging a fresh region from the press point.
      if (time < state.loopDragAnchor) {
        state.loopStart = time;
        state.loopEnd = state.loopDragAnchor;
      } else {
        state.loopStart = state.loopDragAnchor;
        state.loopEnd = Math.max(time, state.loopDragAnchor + 0.05);
      }
    }

    updateLoopSelectionUi();
  };

  const endDrag = () => {
    if (!state.loopDragTarget) return;
    state.loopDragTarget = null;
    setLoopStatus(
      `Loop set from ${formatPreciseTime(state.loopStart)} to ${formatPreciseTime(state.loopEnd)}.`,
      "done"
    );
  };

  elements.loopStartHandle.addEventListener("pointerdown", (event) => {
    if (elements.loopStartHandle.disabled) return;
    event.preventDefault();
    beginDrag("start");
  });

  elements.loopEndHandle.addEventListener("pointerdown", (event) => {
    if (elements.loopEndHandle.disabled) return;
    event.preventDefault();
    beginDrag("end");
  });

  elements.loopWaveWrap.addEventListener("pointerdown", (event) => {
    if (!state.loopReady) return;
    if (event.target.classList.contains("loop-handle")) return;
    event.preventDefault();
    state.loopDragAnchor = timeFromPointer(event.clientX);
    state.loopStart = state.loopDragAnchor;
    state.loopEnd = Math.min(getDuration(), state.loopDragAnchor + 0.05);
    beginDrag("region");
    updateLoopSelectionUi();
  });

  document.addEventListener("pointermove", handlePointerMove);
  document.addEventListener("pointerup", endDrag);
  document.addEventListener("pointercancel", endDrag);

  window.addEventListener("resize", () => {
    drawLoopWaveform();
    updateLoopSelectionUi();
  });
}

/** Whether the current selection is narrower than the full track. */
export function hasPartialLoopSelection() {
  const duration = getDuration();
  if (!duration || !state.loopReady) return false;
  return state.loopStart > 0.001 || state.loopEnd < duration - 0.001;
}

export function getSelectedLoopRange() {
  const duration = getDuration();
  const start = clamp(state.loopStart, 0, duration);
  const end = clamp(state.loopEnd, start, duration);
  return { start, end, duration: Math.max(0.001, end - start) };
}
