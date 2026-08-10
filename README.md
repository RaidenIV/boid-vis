# Particle Visualizer

A static, GitHub Pages–ready build of the Particle Visualizer: a Three.js
particle swarm driven by a 4D noise field, inside a camera-locked particle
tunnel, with selective bloom. No build step is required.

## Project structure

```text
index.html
.nojekyll
package.json
assets/
  css/
    main.css       Original panel styling plus the Binary Tower control primitives
  js/
    config.js      Immutable defaults, colormaps, frequency bands, export presets
    core.js        Shared state, DOM element handles, the <audio> element
    utils.js       Pure helpers (clamp, time formatting, colormap sampling, downloads)
    noise.js       4D simplex noise used for particle motion
    scene.js       Three.js scene, tunnel, swarm buffers, bloom composer chain
    particles.js   Particle integration and the particle pool
    analysis.js    Offline FFT analysis, waveform peaks, tempo detection
    viewport.js    Viewport format, canvas sizing, export dimensions
    playback.js    Transport, volume, mute, loop enforcement
    loader.js      File loading, decoding and analysis progress
    loop.js        Loop selection editor: waveform, handles, beat snapping
    controls.js    Collapsible sections, value editors, control binding
    render.js      One deterministic frame — shared by preview and export
    export.js      PNG / MP4 / MKV / JSON export
    reset.js       Reset-to-defaults for each section
    app.js         Entry point: wires events and runs the preview loop
```

The JavaScript is split into focused ES modules that share a single `core.js`
(state and DOM handles), so each concern can be edited in isolation. `app.js`
imports the modules, binds all event listeners and starts the render loop.

## Why analysis is precomputed

The original single-file build read a realtime `AnalyserNode`, which can only
be sampled at wall-clock speed. Video export has to evaluate the visualizer at
arbitrary timestamps, so `analysis.js` analyzes the whole decoded buffer up
front into a per-frame magnitude timeline. The preview loop and the export loop
both sample that timeline by playhead time, which is what makes the exported
file match what is on screen.

## Publish with GitHub Pages

1. Create a new GitHub repository.
2. Upload the contents of this folder to the repository root.
3. Open **Settings → Pages**.
4. Under **Build and deployment**, select **Deploy from a branch**.
5. Select the `main` branch and `/ (root)`, then save.

The site will load from the GitHub Pages URL shown in the Pages settings.

## Local testing

The JavaScript uses ES modules, so serve the folder over HTTP rather than
opening `index.html` from the filesystem.

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Export notes

- **PNG** renders a single frame at the selected export resolution.
- **Video** renders frame by frame off a fixed frame-rate clock, so no frames
  are dropped. MP4 uses `mp4-muxer` with an H.264 (AVC) video track and AAC
  audio. MKV uses `mediabunny` and picks the first encodable codec, which is
  the reliable path in Firefox.
- **JSON** writes out every control value.
- Exporting requires a browser with WebCodecs. Chrome and Edge support both
  formats; Firefox should use MKV.
- When **Loop** is enabled and the loop region is narrower than the track, only
  that region is exported.

## External browser resources

Three.js loads from unpkg, and the video muxers load from jsDelivr, so the page
needs an internet connection on first load and when exporting video.
