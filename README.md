# Paralastro 0.5

Experimental web-first MVP for validating 2.5D parallax from aligned astrophotography images. The depth-warp experiment keeps starless content in one texture, deforms it continuously from an artistic depth map, and combines it with the successful multi-plane star decomposition.

## Requirements

- macOS on Apple Silicon (the code is platform-independent)
- Node.js 20 or newer
- Python 3.11 or newer
- FFmpeg with `libx264` support for MP4 video export

## Start locally

In terminal 1:

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -e '.[dev]'
uvicorn app.main:app --reload --port 8000
```

In terminal 2:

```bash
cd frontend
npm install
npm start
```

Open <http://localhost:4200>. The development frontend proxies `/api` and `/media` to FastAPI.

On macOS, FFmpeg can be installed with `brew install ffmpeg`.

Optional export light effects are backend assets. For the **Soft reflections** preset, place the source video at `backend/assets/video-effects/soft-reflections.mp4`. Use a black-background MP4 without audio; the backend loops, scales, and blends it over the complete camera animation.

You can also run both services with `./scripts/dev.sh`; it expects the backend virtual environment at `backend/.venv`.

## Test and build

```bash
cd backend && .venv/bin/pytest
cd frontend && npm test -- --watch=false
cd frontend && npm run build
```

## Phase 1 manual test

1. Import aligned PNG or TIFF starless and stars files and configure the star/depth-warp settings.
2. Confirm a dimension mismatch is rejected with an actionable error.
3. Click **Build scene**, then switch between 3D, original, and difference views.
4. Drag to orbit, right-drag to pan, scroll to zoom, and compare the horizontal, vertical, and orbit preview paths.
5. Change visibility, opacity, depth, position, scale, and global separation; confirm these updates do not reprocess the images.
6. Reset a layer and return the camera to the photographic viewpoint.
7. Solo individual layers, adjust difference gain, and review the motion/GPU diagnostics in the scene panel.

Architecture, contracts, conventions, risks, and the phased plan are in [docs/architecture.md](docs/architecture.md).

## Current limits

- Starless is never split into repeated planes in this experiment; its warp is exactly zero at the canonical camera position.
- The generated depth map is artistic and does not represent physical astronomical distance. A confidence map stabilizes ambiguous/high-frequency regions, while broad nebulosity and fine detail receive different motion strengths.
- PNG color metadata is reported when available. TIFF ICC/profile interpretation is reported as unsupported rather than guessed.
- Display previews are bounded 8-bit sRGB PNGs (2048 px maximum edge). Original uploaded bytes and decoded high-bit-depth arrays remain on the backend for the process lifetime, and full-resolution arrays drive metrics.
- Projects are memory-backed and disappear when FastAPI restarts.
- Reconstruction is evaluated in linear-light float values using the same ordered source-over operation used by the viewer.
- Occlusion revealed by camera motion cannot be filled in Phase 1.
