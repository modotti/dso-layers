# Deterministic offline video rendering plan

## Objective

Replace real-time canvas recording with deterministic frame rendering. Every output frame must represent an exact timeline timestamp, regardless of how long the GPU takes to render it. A slow machine may take longer to export, but the resulting video must preserve the requested frame rate without dropped or duplicated animation frames.

This initiative should be implemented separately from the cinematic DOF branch. The existing interactive viewer remains the authoring and preview surface.

## Why the current exporter can stutter

The current pipeline couples animation, WebGL rendering, browser scheduling, canvas capture, and video encoding to wall-clock time:

```text
requestAnimationFrame → WebGL canvas → captureStream → MediaRecorder → WebM → FFmpeg → MP4
```

When a frame takes longer than the available 16.7 ms at 60 fps or 33.3 ms at 30 fps, capture can miss its intended cadence. Increasing GPU power helps but does not make the export deterministic.

## Target architecture

Separate scene evaluation from interactive time:

```text
Scene + timeline + export settings
                │
                ▼
       renderFrameAt(time)
                │
                ▼
       ordered RGBA frame stream
                │
                ▼
         encoder / FFmpeg
                │
                ▼
          final MP4 file
```

The core contract is:

```ts
interface FrameRenderRequest {
  timeSeconds: number;
  width: number;
  height: number;
  quality: 'draft' | 'final';
}

interface DeterministicRenderer {
  prepare(scene: SceneDocument, timeline: CameraMovement[]): Promise<void>;
  renderFrameAt(request: FrameRenderRequest): Promise<RenderedFrame>;
  dispose(): Promise<void>;
}
```

`renderFrameAt()` must derive camera position, target, roll, focus, overlays, fades, and effects exclusively from `timeSeconds`. It must not read `performance.now()` or depend on a previous animation frame.

## Recommended deployment model

### Near term: browser proof of concept

- Refactor timeline evaluation into pure functions.
- Render one requested timestamp at a time.
- Read frames from a dedicated render target.
- Encode with WebCodecs where supported, with a PNG-frame fallback for development.
- Keep the current MediaRecorder exporter available until the deterministic path is proven.

### Desktop product

Use Electron or Tauri for the application shell. Keep the GPU preview in the web frontend and run exports in a local background worker.

- The UI submits an immutable render job.
- The worker owns an offscreen WebGL/WebGPU context or a native renderer.
- Frames are streamed directly to a bundled FFmpeg process.
- Progress, cancellation, logs, and output paths are reported over a narrow IPC contract.
- Source images stay local; no cloud upload is required.

### Optional remote backend

A GPU-backed render service can implement the same job contract for queued cloud exports. It should be optional because large astrophotography sources make upload, storage, privacy, and infrastructure costs significant.

## Phase 1 — deterministic timeline

- Extract camera-path phase calculation from the animation loop.
- Add pure evaluation for position, target, roll, and focus at any timestamp.
- Extract text visibility, opacity, and motion evaluation.
- Define exact handling at movement boundaries and at the final frame.
- Add golden tests at start, midpoint, transitions, and end.

Acceptance criteria:

- Evaluating the same timestamp always returns identical state.
- Sequential and random-order frame evaluation produce identical results.
- Existing interactive playback uses the same evaluator.

## Phase 2 — frame renderer

- Create a renderer that accepts explicit width, height, time, and quality.
- Remove export-time dependence on `requestAnimationFrame`.
- Render color, authored DOF depth, bokeh, output conversion, and overlays in a fixed order.
- Reuse textures across frames and release all render targets after a job.
- Support cancellation between frames.

Frame scheduling for duration `D` and frame rate `F`:

```text
frameCount = round(D × F)
frameIndex = 0 .. frameCount - 1
timeSeconds = frameIndex / F
```

The final timeline state may be rendered as an additional still preview but should not silently change the video duration.

## Phase 3 — encoding proof of concept

- Prefer WebCodecs for direct encoded-frame submission when available.
- Preserve exact timestamps and frame durations.
- Mux to a browser-supported container or send the encoded intermediate to FFmpeg.
- Compare the deterministic output with the current WebM-to-MP4 conversion.
- Record render time separately from encoding time.

Acceptance criteria:

- No dropped or duplicated frames under an intentionally slow render workload.
- Output duration differs from the requested duration by less than one frame.
- Focus pulls and camera movement match timestamp-based reference fixtures.

## Phase 4 — desktop worker

- Define a versioned render-job manifest containing scene data, resolved asset paths, timeline, output settings, and quality.
- Bundle or validate a compatible FFmpeg binary.
- Stream raw frames to FFmpeg without writing thousands of temporary images.
- Implement progress as `renderedFrames / totalFrames`.
- Implement cooperative cancellation and deletion of incomplete output.
- Isolate worker crashes from the authoring UI.
- Add resumability only if real workloads justify its complexity.

## Quality modes

Quality controls render time, not video smoothness:

- `draft`: bounded resolution, lightweight bokeh, fast review encode.
- `final`: requested resolution, full bokeh kernel, high-quality encode.

Both modes use the same timestamps and therefore produce identical motion timing.

## Performance and memory policy

- Decode each source asset once per job.
- Downsample textures only when the output cannot benefit from their native resolution.
- Cap concurrent GPU readbacks and encoder queue depth.
- Avoid retaining all frames in memory.
- Expose render FPS, encode FPS, GPU identity, peak queue depth, and estimated completion time.
- Treat 4K, portrait, high-frame-rate, and long-duration exports as separate benchmark classes.

## Migration and compatibility

- Keep scene schema and saved camera movements backward compatible.
- Add an exporter capability flag instead of changing existing project documents.
- Preserve the current real-time exporter as a fallback during rollout.
- Compare representative outputs frame-by-frame before switching the default.
- Do not couple the deterministic renderer directly to Electron/Tauri APIs; the desktop worker should be one adapter around the renderer contract.

## Validation matrix

- 1080p at 24, 30, and 60 fps.
- 1440p and 4K at 30 fps.
- Landscape, square, portrait, and cinema aspect ratios.
- DOF disabled, starless focus, selected-layer focus, and focus pull.
- Single and multi-movement timelines.
- Text fades and motion across movement boundaries.
- Cancellation during preparation, rendering, encoding, and finalization.
- Source images above 4K with preview and full-resolution texture policies.

## Definition of done

- Final video cadence is independent of render speed.
- Preview and offline render share the same timeline evaluator.
- Export can run slower than real time without changing motion.
- Progress and cancellation are reliable.
- Draft and final modes are documented and benchmarked.
- Desktop and optional remote workers can consume the same versioned render job.
