# Cinematic depth of field plan

## Objective

Add an optional cinematic depth-of-field effect to the 2.5D viewer without weakening the current image alignment, depth editing, comparison modes, text overlays, or video export. The work starts with a deliberately small `BokehPass` experiment and only moves to authored depth when the visual result and performance justify it.

## Product principles

- Depth of field complements parallax; it must not hide motion artifacts or replace geometric separation.
- The default remains disabled so existing scenes render unchanged.
- Text overlays and editing aids stay sharp.
- Comparison, depth, confidence, and difference views remain unprocessed.
- Focus changes must be deterministic during playback and export.
- Controls use cinematic language while retaining bounded, safe values.

## Known technical constraint

The stock Three.js `BokehPass` renders a separate depth texture with a global `MeshDepthMaterial`. The viewer's transparent, full-frame planes therefore become opaque rectangles in that depth pass. The nearest plane can dominate the entire depth buffer, so the stock pass is useful for validating the aesthetic and integration but is not expected to represent the scene's authored per-pixel depth correctly.

## Phase 1 — post-processing foundation

Implementation status: code-complete on `feature/cinematic-dof`; automated build and test validation passed. Visual validation with representative project images remains pending.

Introduce `EffectComposer`, `RenderPass`, `BokehPass`, and `OutputPass` around the 3D world only.

Tasks:

- Add a typed `DepthOfFieldSettings` model with `enabled`, `focusDistance`, `aperture`, and `maxBlur`.
- Keep the feature disabled by default and persist its settings with the existing preferences.
- Create and dispose the composer and passes with the viewer lifecycle.
- Keep composer size and pixel ratio synchronized during normal resize and export resolution changes.
- Render comparison modes through the existing direct path.
- Render `overlayWorld` after post-processing so captions and selection affordances stay sharp.
- Ensure canvas capture still records the final composed frame.

Validation gate:

- With DOF disabled, screenshots and existing behavior are visually unchanged.
- Enabling DOF produces a subtle, controllable effect with no color-space regression.
- Resize, reset, playback, cancellation, and export complete without WebGL errors or leaked render targets.
- Existing frontend tests, lint, and production build pass.

## Phase 2 — focus controls and animation

Implementation status: in progress. Manual distance, camera-target focus, and automatic starless-layer focus are implemented; arbitrary layer selection and animated focus pulls remain.

Make focus useful for interactive exploration and cinematic paths.

Tasks:

- Add focus modes: manual distance, camera target, and selected scene layer.
- Convert a target or layer position to distance along the camera view direction rather than using raw world Z.
- Add bounded UI controls for focus distance, aperture, and maximum blur.
- Add an optional focus start/end to each camera movement, preserving backward compatibility with saved state.
- Interpolate focus with the same movement timeline and make continuous-path transitions free of jumps.
- Restore the interactive focus state after export or cancellation.

Validation gate:

- Target focus remains stable while orbiting.
- Layer focus selects the intended plane throughout a camera move.
- A focus pull is reproducible in preview and exported video.
- Missing or removed layer references fall back safely to target focus.

## Phase 3 — authored DOF depth

Implementation status: in progress. The stock opaque-plane capture has been replaced by a local alpha-aware depth pass with constant per-layer focal distances. Stellar layers now contribute depth only where their texture alpha is visible. Per-pixel nebula depth and confidence attenuation remain.

Replace the stock depth capture with a depth composition that represents the project data.

Tasks:

- Render a dedicated DOF depth target using the nebula depth map, its inversion setting, and effective layer depth.
- Composite constant depth for each stellar layer only where its alpha contributes.
- Define deterministic overlap precedence consistent with visible back-to-front compositing.
- Use the confidence map to attenuate blur around protected or ambiguous detail.
- Preserve mirrored/clamped edge behavior so blur does not pull dark borders into the image.
- Keep depth texture resolution configurable independently from color resolution if profiling shows a useful tradeoff.
- Encapsulate the adaptation in a local pass rather than modifying files under `node_modules`.

Validation gate:

- Nebula subregions at different authored depths produce visibly different blur radii.
- Transparent areas of a near stellar plane no longer overwrite depth behind them.
- Inverting the nebula depth produces the expected focus relationship.
- Solo-layer and full-composite views behave predictably.

## Phase 4 — quality and performance

Harden the feature for editing and high-resolution export.

Tasks:

- Profile GPU frame time at representative preview sizes and at 1080p, 1440p, and 4K export sizes.
- Add low/medium/high sampling presets only if a single quality level cannot meet the target.
- Evaluate highlight preservation for small stars and add a conservative selective bloom only as a separate experiment.
- Add diagnostic reporting for active DOF resolution and quality.
- Document recommended presets for subtle, shallow, and focus-pull looks.

Performance targets:

- No measurable overhead while DOF is disabled.
- Interactive preview remains responsive on the project's baseline GPU at 2048-pixel bounded previews.
- 1080p/30 export remains reliable; higher resolutions may render slower than real time but must not fail or exhaust GPU memory.

## Test strategy

### Unit tests

- Focus-distance projection from world point to camera view axis.
- Settings clamping and defaults.
- Focus interpolation for per-movement and continuous flows.
- Safe fallback when a target layer is unavailable.

### Component tests

- Composer is used only for 3D mode when enabled.
- Resize and export update renderer and composer consistently.
- Settings changes update pass uniforms without rebuilding the scene.
- Disposal releases the composer and DOF pass.

### Visual validation matrix

Use at least one dense nebula, one dark nebula, and one star-dominant image. For each, inspect reset view, horizontal motion, orbit, zoom, focus pull, text overlays, depth inversion, solo layers, and 1080p export. Compare disabled, stock-depth prototype, and authored-depth output at identical camera poses.

## Delivery checkpoints

1. **Foundation PR:** disabled-by-default composer integration and stock `BokehPass` controls.
2. **Cinematic focus PR:** focus modes and deterministic focus pulls.
3. **Authored depth PR:** custom depth composition for nebula and transparent star layers.
4. **Hardening PR:** performance presets, diagnostics, documentation, and final visual baselines.

Each checkpoint is independently reversible. Phase 3 should not begin until the Phase 1 experiment demonstrates that depth of field improves the intended images without unacceptable loss of stellar detail.
