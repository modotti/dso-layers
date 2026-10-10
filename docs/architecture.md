# Architecture and implementation plan

## Scope and repository

The depth-warp experiment validates deterministic star decomposition together with continuous shader deformation of a single starless texture. The repository is split by responsibility:

```text
backend/app/           FastAPI transport, image I/O, validation, reconstruction
backend/tests/         mathematical and API tests
frontend/src/app/      Angular workflow, typed API client, reusable Three.js viewer
docs/                  stable architecture decisions and contracts
scripts/               local developer entry points
```

The processing package has no Three.js knowledge. The viewer consumes only the scene document. Processing strategies added later will implement common backend protocols and emit the same scene schema.

## HTTP contract (version 1)

`POST /api/v1/projects` accepts multipart fields `starless` and `stars`. It validates and retains the unmodified source bytes, decodes the images, creates display previews, evaluates the additive Phase 1 reconstruction, and returns `ProjectResponse`:

```json
{
  "projectId": "uuid",
  "scene": { "schemaVersion": 1, "layers": [] },
  "metrics": {
    "nebula": null,
    "stars": null,
    "combined": { "mae": 0, "rmse": 0, "maxError": 0, "pixelsOverTolerancePercent": 0, "tolerance": 0.0039215686 }
  },
  "comparison": {
    "originalUrl": "/media/{id}/original.png",
    "reconstructedUrl": "/media/{id}/reconstructed.png",
    "differenceUrl": "/media/{id}/difference.png"
  },
  "warnings": []
}
```

Errors use `{ "detail": { "code": "dimension_mismatch", "message": "...", "context": {} } }`. Upload size and decoded-pixel limits are enforced before scene creation. `GET /api/v1/health` supports development diagnostics. Media URLs are opaque viewer inputs; future job storage can replace the in-memory store without changing the scene document.

## Scene schema

The versioned `SceneDocument` contains source dimensions and color metadata; coordinate, alpha, and texture conventions; camera setup and navigation limits; ordered layers; and processing provenance. Layer IDs and counts are unconstrained.

- World coordinates: right-handed; +X right, +Y up, camera looks down -Z.
- Image origin: top-left; UVs are corrected once by the texture loader.
- `order`: ascending back-to-front compositing order and deterministic render order.
- `depth`: signed offset from the focal plane. The viewer derives Z and plane size from camera geometry so the photographic viewpoint stays pixel-aligned at every depth.
- Transforms are scene values, not processing parameters, and update locally.
- `type` is currently `nebula` or `stars` and remains independent of algorithm names.

## Alpha and color conventions

Processing uses normalized float32 linear-light RGB. Integer samples are normalized by their actual dtype range. PNG transfer characteristics are treated as sRGB unless explicitly marked; TIFF samples without supported profile metadata are conservatively reported as `unknown`. No source bytes are rewritten.

Exported and preview RGBA textures use **straight alpha** in sRGB-encoded 8-bit PNG. Three.js textures are tagged `SRGBColorSpace`, materials use `transparent: true`, `premultipliedAlpha: false`, normal source-over blending, disabled depth writes, and explicit render order. Layer reconstruction is defined back-to-front by:

```text
C_out = C_src * A_src + C_dst * (1 - A_src)
A_out = A_src + A_dst * (1 - A_src)
```

Metrics compare unpremultiplied, linear-light RGB. Difference previews amplify absolute error only for visibility; metric values use the unamplified error. Phase 1 input planes are opaque/additive by role: the nebula plane is the starless RGB base and the stars plane derives alpha from per-pixel luminance while storing `stars / alpha` as straight RGB, making source-over over black reconstruct the star signal. The combined reference is clipped linear addition. Alpha is kept float until PNG preview export.

## Perspective alignment

For camera distance `d`, vertical field of view `f`, and image aspect `a`, a plane at distance `d'` is sized as `height = 2 d' tan(f/2)` and `width = height * a`. This gives identical projected bounds at the canonical camera. User scale is applied after this compensation. Orbit movement reveals parallax; reset restores exact alignment.

## Technical risks

1. Decomposition can reconstruct accurately yet look artificial in motion. Phase 3 must score motion artifacts qualitatively, not only numerical error.
2. Straight-alpha division can amplify noise at tiny alpha. Export needs an epsilon and validation around faint halos.
3. Browsers and scientific formats have different color behavior. Profiles and transfer functions need explicit future policy and reference-image tests.
4. 16-bit sources can exhaust CPU/RAM/GPU limits. Full-resolution processing stays server-side; previews are bounded by pixel and texture limits.
5. Transparent-plane ordering and depth intersections can produce artifacts. Deterministic render ordering and constrained navigation reduce, but do not remove, the problem.
6. TIFF orientation/profile/tag diversity is broad. Unsupported metadata is surfaced rather than silently transformed.
7. In-memory storage is appropriate only for local validation and must become a storage interface before asynchronous/cloud work.

## Phased plan

### Phase 1 — foundation and viewer (implemented)

Angular standalone UI, FastAPI boundary, aligned-image validation, immutable source retention, scene schema, two compensated Three.js planes, constrained navigation, transforms, camera reset, additive reconstruction metrics, and original/reconstruction/difference comparison.

### Phase 2 — stars (implemented)

`StarDetectionService` uses robust background/noise estimation, Gaussian-supported thresholding, and connected components. A replaceable `StarDepthAssignmentStrategy` ranks flux and apparent size. Nearest-component ownership keeps faint residual profiles in exactly one of three default layers, including connected overlaps, and numerical fixtures enforce conservation and determinism. Apparent distance remains explicitly artistic.

### Phase 3 — nebula laboratory

The current experiment replaces plane decomposition with a smooth artistic depth map derived from broad emission, absorption, and structural cues. A confidence map reduces motion around high-frequency and ambiguous features. In the viewer, a two-band shader moves a softly sampled broad component at full warp and a high-frequency residual at a configurable fraction. At the original camera position both bands recompose the source. Motion is intentionally constrained because the warp cannot synthesize genuinely hidden content.

### Phase 4 — visual refinement

Improve layer inspection, transparency/edge handling, camera constraints, difference visualization, automated parallax paths, preview downsampling, GPU limit reporting, and motion-oriented evaluation.

## Future seams (not implementations)

Project storage, processing execution, and scene serialization are boundaries rather than account/cloud abstractions. A future worker may create the same response asynchronously; a public viewer may consume the same scene JSON; catalog-driven stars may implement the existing strategy interface.
