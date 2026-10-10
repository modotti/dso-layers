from __future__ import annotations

from uuid import uuid4

import numpy as np
from fastapi import FastAPI, File, Form, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

from .imaging import ImageValidationError, depth_png_bytes, load_image, metrics, png_bytes, source_over, stars_to_straight_rgba, validate_pair
from .models import ComparisonUrls, ImageMetadata, MetricGroups, ProcessingMetadata, ProjectResponse, ReconstructionMetrics, SceneDocument, SceneLayer
from .processing.stars import RankedVisualDepthStrategy, StarLayerGenerator
from .processing.depth import create_artistic_depth_map
from .store import MediaAsset, MemoryProjectStore

MAX_UPLOAD_BYTES = 256 * 1024 * 1024
store = MemoryProjectStore()
app = FastAPI(title="Astro Parallax Studio API", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:4200"], allow_methods=["*"], allow_headers=["*"])


@app.exception_handler(ImageValidationError)
async def image_error(_: Request, exc: ImageValidationError) -> JSONResponse:
    return JSONResponse(status_code=422, content={"detail": {"code": exc.code, "message": str(exc), "context": exc.context}})


@app.exception_handler(RequestValidationError)
async def request_error(_: Request, exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(status_code=422, content={"detail": {"code": "invalid_request", "message": "Both image files are required.", "context": {}}})


@app.get("/api/v1/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


async def _read_upload(upload: UploadFile) -> bytes:
    payload = await upload.read(MAX_UPLOAD_BYTES + 1)
    if len(payload) > MAX_UPLOAD_BYTES:
        raise ImageValidationError("upload_too_large", "Each upload must be 256 MB or smaller.")
    if not payload:
        raise ImageValidationError("empty_file", "Uploaded images cannot be empty.")
    return payload


@app.post("/api/v1/projects", response_model=ProjectResponse, response_model_by_alias=True)
async def create_project(
    starless: UploadFile = File(...),
    stars: UploadFile = File(...),
    star_layer_count: int = Form(3, ge=2, le=8),
    star_distribution: str = Form("balanced", pattern="^(balanced|brightness|size)$"),
    star_sensitivity: float = Form(3.0, ge=1.0, le=8.0),
    star_background_mode: str = Form("auto", pattern="^(auto|none)$"),
    nebula_warp_strength: float = Form(0.12, ge=0.0, le=0.5),
    nebula_depth_smoothing: float = Form(18.0, ge=2.0, le=80.0),
    nebula_absorption_strength: float = Form(0.65, ge=0.0, le=1.0),
    nebula_depth_invert: bool = Form(False),
) -> ProjectResponse:
    starless_payload, stars_payload = await _read_upload(starless), await _read_upload(stars)
    base, stellar = load_image(starless.filename or "starless", starless_payload), load_image(stars.filename or "stars", stars_payload)
    validate_pair(base, stellar)
    project_id = str(uuid4())
    depth_result = create_artistic_depth_map(base.rgb_linear, smoothing=nebula_depth_smoothing, absorption_strength=nebula_absorption_strength, invert=nebula_depth_invert)
    star_result = StarLayerGenerator().process(
        stellar.rgb_linear,
        layer_count=star_layer_count,
        sensitivity=star_sensitivity,
        background_mode=star_background_mode,  # type: ignore[arg-type]
        strategy=RankedVisualDepthStrategy(star_distribution),  # type: ignore[arg-type]
    )
    star_rgba_layers = [stars_to_straight_rgba(layer) for layer in star_result.layers_rgb]
    base_rgba = np.concatenate([base.rgb_linear, np.ones((*base.rgb_linear.shape[:2], 1), dtype=np.float32)], axis=2)
    star_canvas = np.zeros_like(base_rgba)
    for star_rgba in star_rgba_layers:
        star_canvas = source_over(star_rgba, star_canvas)
    reconstructed_stars = star_canvas[..., :3] * star_canvas[..., 3:4]
    reconstructed = base_rgba
    for star_rgba in star_rgba_layers:
        reconstructed = source_over(star_rgba, reconstructed)
    reconstructed = reconstructed[..., :3]
    reference_stars = np.sum(star_result.layers_rgb, axis=0)
    reference = base.rgb_linear.copy()
    for star_rgba in star_rgba_layers:
        reference = source_over(star_rgba, np.concatenate([reference, np.ones((*reference.shape[:2], 1), dtype=np.float32)], axis=2))[..., :3]
    difference = np.clip(np.abs(reference - reconstructed) * 8, 0, 1)

    assets = {
        "starless.png": png_bytes(base_rgba), "nebula-depth.png": depth_png_bytes(depth_result.depth_map),
        "original.png": png_bytes(reference), "reconstructed.png": png_bytes(reconstructed), "difference.png": png_bytes(difference),
    }
    for index, star_rgba in enumerate(star_rgba_layers, start=1):
        assets[f"stars-{index}.png"] = png_bytes(star_rgba)
    for name, payload in assets.items():
        store.put_media(project_id, name, MediaAsset(payload))
    store.put_source(project_id, "starless", base.source_bytes)
    store.put_source(project_id, "stars", stellar.source_bytes)
    prefix = f"/media/{project_id}"
    source = ImageMetadata(width=base.width, height=base.height, channels=3, bit_depth=max(base.bit_depth, stellar.bit_depth), format=f"{base.format}+{stellar.format}", transfer=base.transfer, embedded_profile=base.embedded_profile or stellar.embedded_profile)
    depth_step = 0.6 / max(1, star_layer_count - 1)
    layers = [SceneLayer(id="nebula-input", name="Warped starless", type="nebula", texture_url=f"{prefix}/starless.png", depth_texture_url=f"{prefix}/nebula-depth.png", warp_strength=nebula_warp_strength, depth=-0.35, order=0)]
    layers.extend(SceneLayer(id=f"stars-{index + 1}", name=("Distant stars", "Mid-field stars", "Near stars")[index] if star_layer_count == 3 else f"Star depth {index + 1}", type="stars", texture_url=f"{prefix}/stars-{index + 1}.png", depth=-0.15 + index * depth_step, order=index + 1) for index in range(star_layer_count))
    scene = SceneDocument(
        name=(starless.filename or "Untitled scene").rsplit(".", 1)[0], source=source, layers=layers,
        processing=ProcessingMetadata(parameters={"starLayerCount": star_layer_count, "starDistribution": star_distribution, "starSensitivity": star_sensitivity, "starBackgroundMode": star_background_mode, "backgroundLevel": star_result.background_level, "detectionThreshold": star_result.threshold, "nebulaWarpStrength": nebula_warp_strength, **depth_result.parameters}, detectedStars=len(star_result.candidates)),
    )
    star_metrics = ReconstructionMetrics.model_validate(metrics(reference_stars, reconstructed_stars))
    combined = ReconstructionMetrics.model_validate(metrics(reference, reconstructed))
    warnings = list(dict.fromkeys((*base.warnings, *stellar.warnings)))
    if not star_result.candidates:
        warnings.append("No star candidates crossed the detection threshold; the full signal was preserved in the far layer.")
    return ProjectResponse(projectId=project_id, scene=scene, metrics=MetricGroups(stars=star_metrics, combined=combined), comparison=ComparisonUrls(originalUrl=f"{prefix}/original.png", reconstructedUrl=f"{prefix}/reconstructed.png", differenceUrl=f"{prefix}/difference.png"), warnings=warnings)


@app.get("/media/{project_id}/{name}")
def media(project_id: str, name: str) -> Response:
    asset = store.get_media(project_id, name)
    if asset is None:
        return Response(status_code=404)
    return Response(asset.content, media_type=asset.media_type, headers={"Cache-Control": "no-store"})
