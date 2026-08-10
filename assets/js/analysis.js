/**
 * analysis.js — offline FFT analysis of the decoded AudioBuffer.
 *
 * The original build read a realtime AnalyserNode, which can only be sampled
 * at wall-clock speed. Video export has to evaluate the visualizer at
 * arbitrary timestamps, so the whole track is analyzed up front into a
 * per-frame magnitude timeline that both the preview loop and the export loop
 * sample by playhead time. The band split, the dB mapping and the 0.8
 * smoothing constant reproduce AnalyserNode.getByteFrequencyData().
 */
import { FREQ_BANDS, LOW_FREQ_BAND, engine } from "./config.js";
import { state } from "./core.js";
import { clamp, nextEventLoopTurn } from "./utils.js";

const MIN_DECIBELS = -100;
const MAX_DECIBELS = -30;
const MAX_ANALYSIS_FRAMES = 24000;

function createFftWorkspace(size) {
  const levels = Math.log2(size);
  if (!Number.isInteger(levels)) {
    throw new Error("FFT size must be a power of two.");
  }

  const real = new Float32Array(size);
  const imaginary = new Float32Array(size);
  const bitReversedIndices = new Uint32Array(size);
  const windowValues = new Float32Array(size);

  for (let index = 0; index < size; index += 1) {
    let value = index;
    let reversed = 0;
    for (let bit = 0; bit < levels; bit += 1) {
      reversed = (reversed << 1) | (value & 1);
      value >>= 1;
    }
    bitReversedIndices[index] = reversed;
    // Blackman window, matching the Web Audio AnalyserNode.
    windowValues[index] =
      0.42 -
      0.5 * Math.cos((2 * Math.PI * index) / (size - 1)) +
      0.08 * Math.cos((4 * Math.PI * index) / (size - 1));
  }

  const stages = [];
  for (let blockSize = 2; blockSize <= size; blockSize *= 2) {
    const halfBlock = blockSize / 2;
    const phaseStep = (-2 * Math.PI) / blockSize;
    const cosine = new Float32Array(halfBlock);
    const sine = new Float32Array(halfBlock);
    for (let offset = 0; offset < halfBlock; offset += 1) {
      const angle = phaseStep * offset;
      cosine[offset] = Math.cos(angle);
      sine[offset] = Math.sin(angle);
    }
    stages.push({ blockSize, halfBlock, cosine, sine });
  }

  return { size, real, imaginary, bitReversedIndices, windowValues, stages };
}

function fillFftInput(workspace, channels, channelScale, frameStart) {
  const { size, real, imaginary, bitReversedIndices, windowValues } = workspace;
  const sampleCount = channels[0].length;

  for (let offset = 0; offset < size; offset += 1) {
    const sourceIndex = frameStart + offset;
    let sample = 0;
    if (sourceIndex >= 0 && sourceIndex < sampleCount) {
      for (let channel = 0; channel < channels.length; channel += 1) {
        sample += channels[channel][sourceIndex] * channelScale;
      }
    }
    const destination = bitReversedIndices[offset];
    real[destination] = sample * windowValues[offset];
    imaginary[destination] = 0;
  }
}

function runFft(workspace) {
  const { size, real, imaginary, stages } = workspace;

  for (let stageIndex = 0; stageIndex < stages.length; stageIndex += 1) {
    const { blockSize, halfBlock, cosine, sine } = stages[stageIndex];
    for (let blockStart = 0; blockStart < size; blockStart += blockSize) {
      for (let offset = 0; offset < halfBlock; offset += 1) {
        const evenIndex = blockStart + offset;
        const oddIndex = evenIndex + halfBlock;
        const oddReal =
          real[oddIndex] * cosine[offset] - imaginary[oddIndex] * sine[offset];
        const oddImaginary =
          real[oddIndex] * sine[offset] + imaginary[oddIndex] * cosine[offset];
        const evenReal = real[evenIndex];
        const evenImaginary = imaginary[evenIndex];

        real[oddIndex] = evenReal - oddReal;
        imaginary[oddIndex] = evenImaginary - oddImaginary;
        real[evenIndex] = evenReal + oddReal;
        imaginary[evenIndex] = evenImaginary + oddImaginary;
      }
    }
  }
}

function bandBinRange(minimumHz, maximumHz, sampleRate, binCount) {
  const nyquist = sampleRate / 2;
  const minimumBin = Math.floor((minimumHz / nyquist) * binCount);
  const maximumBin = Math.floor((maximumHz / nyquist) * binCount);
  return {
    minimumBin: clamp(minimumBin, 0, binCount - 1),
    maximumBin: clamp(Math.max(maximumBin, minimumBin + 1), 1, binCount)
  };
}

/**
 * Analyze the decoded buffer into a per-frame magnitude timeline.
 * Returns { fps, frameCount, bands, low, flux }.
 */
export async function analyzeAudioBuffer(
  audioBuffer,
  fftSize,
  smoothing,
  onProgress = () => {}
) {
  const sampleRate = audioBuffer.sampleRate;
  const duration = audioBuffer.duration;

  let fps = engine.ANALYSIS_FPS;
  let frameCount = Math.max(1, Math.ceil(duration * fps));
  if (frameCount > MAX_ANALYSIS_FRAMES) {
    fps = MAX_ANALYSIS_FRAMES / duration;
    frameCount = MAX_ANALYSIS_FRAMES;
  }

  const workspace = createFftWorkspace(fftSize);
  const binCount = fftSize / 2;
  const channels = [];
  for (let index = 0; index < audioBuffer.numberOfChannels; index += 1) {
    channels.push(audioBuffer.getChannelData(index));
  }
  const channelScale = 1 / Math.max(1, channels.length);

  const bands = FREQ_BANDS.map(() => new Float32Array(frameCount));
  const low = new Float32Array(frameCount);
  const flux = new Float32Array(frameCount);

  const bandRanges = FREQ_BANDS.map((band) =>
    bandBinRange(band.min, band.max, sampleRate, binCount)
  );
  const lowRange = bandBinRange(
    LOW_FREQ_BAND.min,
    LOW_FREQ_BAND.max,
    sampleRate,
    binCount
  );

  const smoothed = new Float32Array(binCount);
  const normalized = new Float32Array(binCount);
  const previousNormalized = new Float32Array(binCount);
  const decibelRange = MAX_DECIBELS - MIN_DECIBELS;
  const smoothingFactor = clamp(smoothing, 0, 0.95);
  const hop = sampleRate / fps;

  let lastYield = performance.now();

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const frameStart = Math.round(frameIndex * hop) - Math.floor(fftSize / 2);
    fillFftInput(workspace, channels, channelScale, frameStart);
    runFft(workspace);

    const { real, imaginary } = workspace;
    let fluxSum = 0;

    for (let bin = 0; bin < binCount; bin += 1) {
      const magnitude =
        Math.sqrt(real[bin] * real[bin] + imaginary[bin] * imaginary[bin]) /
        fftSize;
      smoothed[bin] =
        smoothingFactor * smoothed[bin] + (1 - smoothingFactor) * magnitude;

      const decibels = 20 * Math.log10(Math.max(smoothed[bin], 1e-12));
      const byteValue = clamp(
        ((decibels - MIN_DECIBELS) / decibelRange) * 255,
        0,
        255
      );
      normalized[bin] = byteValue / 255;

      const difference = normalized[bin] - previousNormalized[bin];
      if (difference > 0) fluxSum += difference;
      previousNormalized[bin] = normalized[bin];
    }

    flux[frameIndex] = fluxSum / binCount;

    for (let bandIndex = 0; bandIndex < bandRanges.length; bandIndex += 1) {
      const { minimumBin, maximumBin } = bandRanges[bandIndex];
      let sum = 0;
      for (let bin = minimumBin; bin < maximumBin; bin += 1) {
        sum += normalized[bin];
      }
      bands[bandIndex][frameIndex] = sum / (maximumBin - minimumBin);
    }

    let lowSum = 0;
    for (let bin = lowRange.minimumBin; bin < lowRange.maximumBin; bin += 1) {
      lowSum += normalized[bin];
    }
    low[frameIndex] = lowSum / (lowRange.maximumBin - lowRange.minimumBin);

    const now = performance.now();
    if (now - lastYield > 60) {
      lastYield = now;
      onProgress((frameIndex + 1) / frameCount);
      await nextEventLoopTurn();
    }
  }

  onProgress(1);
  return { fps, frameCount, bands, low, flux, duration };
}

/** Write the magnitudes for a given playhead time into shared state. */
export function sampleAnalysisAtTime(seconds) {
  const analysis = state.analysis;
  if (!analysis) {
    state.magnitudes.fill(0);
    state.lowFreqMagnitude = 0;
    return;
  }

  const frameIndex = clamp(
    Math.round(seconds * analysis.fps),
    0,
    analysis.frameCount - 1
  );

  for (let bandIndex = 0; bandIndex < analysis.bands.length; bandIndex += 1) {
    state.magnitudes[bandIndex] = analysis.bands[bandIndex][frameIndex];
  }
  state.lowFreqMagnitude = analysis.low[frameIndex];
}

/** Reduce the decoded buffer to min/max peak pairs for the loop waveform. */
export function computeWaveformPeaks(audioBuffer, bucketCount = 900) {
  const channel = audioBuffer.getChannelData(0);
  const samplesPerBucket = Math.max(1, Math.floor(channel.length / bucketCount));
  const peaks = new Float32Array(bucketCount * 2);

  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const start = bucket * samplesPerBucket;
    const end = Math.min(channel.length, start + samplesPerBucket);
    let minimum = 0;
    let maximum = 0;
    for (let index = start; index < end; index += 1) {
      const sample = channel[index];
      if (sample < minimum) minimum = sample;
      if (sample > maximum) maximum = sample;
    }
    peaks[bucket * 2] = minimum;
    peaks[bucket * 2 + 1] = maximum;
  }

  return peaks;
}

/**
 * Estimate tempo by autocorrelating the spectral-flux onset envelope produced
 * during analysis. Returns a BPM in the 70–180 range.
 */
export function detectTempo(analysis) {
  if (!analysis || !analysis.flux) return null;

  const { flux, fps } = analysis;
  const frameCount = flux.length;
  if (frameCount < fps * 4) return null;

  // Remove the slow-moving mean so sustained loudness does not dominate.
  const windowSize = Math.round(fps * 0.5);
  const envelope = new Float32Array(frameCount);
  let runningSum = 0;
  for (let index = 0; index < frameCount; index += 1) {
    runningSum += flux[index];
    if (index >= windowSize) runningSum -= flux[index - windowSize];
    const mean = runningSum / Math.min(index + 1, windowSize);
    envelope[index] = Math.max(0, flux[index] - mean);
  }

  const minimumBpm = 70;
  const maximumBpm = 180;
  const minimumLag = Math.floor((60 / maximumBpm) * fps);
  const maximumLag = Math.ceil((60 / minimumBpm) * fps);

  let bestLag = 0;
  let bestScore = -Infinity;

  for (let lag = minimumLag; lag <= maximumLag; lag += 1) {
    let score = 0;
    for (let index = 0; index + lag < frameCount; index += 1) {
      score += envelope[index] * envelope[index + lag];
    }
    score /= frameCount - lag;
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }

  if (!bestLag) return null;
  const bpm = (60 * fps) / bestLag;
  return clamp(Math.round(bpm), 40, 300);
}
