# Astro Parallax Studio

Experimental web-first MVP for validating 2.5D parallax from aligned astrophotography images. Phase 2 imports one starless and one stars image, detects stellar regions, distributes complete profiles across configurable artistic depth planes, and presents them in a Three.js viewer.

## Requirements

- macOS on Apple Silicon (the code is platform-independent)
- Node.js 20 or newer
- Python 3.11 or newer

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

You can also run both services with `./scripts/dev.sh`; it expects the backend virtual environment at `backend/.venv`.

## Test and build

```bash
cd backend && .venv/bin/pytest
cd frontend && npm test -- --watch=false
cd frontend && npm run build
```

## Phase 1 manual test

1. Import aligned PNG or TIFF starless and stars files and select star decomposition settings.
2. Confirm a dimension mismatch is rejected with an actionable error.
3. Click **Build scene**, then switch between 3D, original, and difference views.
4. Drag to orbit, right-drag to pan, scroll to zoom, and use the automated parallax preview.
5. Change visibility, opacity, depth, position, scale, and global separation; confirm these updates do not reprocess the images.
6. Reset a layer and return the camera to the photographic viewpoint.

Architecture, contracts, conventions, risks, and the phased plan are in [docs/architecture.md](docs/architecture.md).

## Current limits

- Phase 2 decomposes only the stars image. Nebula decomposition begins in Phase 3.
- PNG color metadata is reported when available. TIFF ICC/profile interpretation is reported as unsupported rather than guessed.
- Display previews are 8-bit sRGB PNGs. Original uploaded bytes and decoded high-bit-depth arrays remain on the backend for the process lifetime.
- Projects are memory-backed and disappear when FastAPI restarts.
- Reconstruction is evaluated in linear-light float values using the same ordered source-over operation used by the viewer.
- Occlusion revealed by camera motion cannot be filled in Phase 1.
