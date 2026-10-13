# Offline rendering benchmark protocol

Automated contract coverage lives in `offline-renderer.matrix.spec.ts`. It verifies frame schedules, output dimensions, aspect ratios, focus pulls, overlays, multi-movement boundaries, and cancellation without depending on machine speed.

Real performance runs must use the production build, the same source project, and an idle machine. Record the GPU string shown after export together with render FPS and finalization time.

## Required runs

| Class | Resolution | FPS | Aspect | Quality |
| --- | ---: | ---: | --- | --- |
| Review | 1920×1080 | 24, 30, 60 | landscape | draft, final |
| QHD | 2560×1440 | 30 | landscape | final |
| UHD | 3840×2160 | 30 | landscape | final |
| Square | 1080×1080 | 30 | square | final |
| Portrait | 1080×1920 | 30 | portrait | final |
| Cinema | 2560×1080 | 30 | wide | final |

Repeat representative runs with DOF disabled, starless focus, selected-layer focus, manual focus, and a captured focus pull. Include a multi-movement timeline with a caption crossing a movement boundary and at least one source image above 4K.

## Pass criteria

- MP4 frame count equals `round(duration × fps)`.
- Reported FPS equals the requested FPS.
- Duration error is less than one frame.
- Draft and Final have identical timeline samples.
- Cancellation removes the incomplete output during preparation, rendering, or finalization.
- Camera, focus, Nebula Warp, fades, and text motion match the interactive reference at sampled timestamps.

Resumability remains intentionally out of scope until these runs show that real job duration justifies it.
