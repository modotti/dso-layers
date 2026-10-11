from __future__ import annotations

import asyncio
import logging
import shutil
import subprocess
import tempfile
from pathlib import Path
from time import perf_counter
from uuid import uuid4

import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

from .imaging import ImageValidationError, depth_png_bytes, load_image, metrics, png_bytes, preview_size, resize_preview, source_over, stars_to_straight_rgba, validate_pair
from .models import ComparisonUrls, ImageMetadata, MetricGroups, ProcessingMetadata, ProjectResponse, ReconstructionMetrics, SceneDocument, SceneLayer
from .processing.stars import RankedVisualDepthStrategy, StarLayerGenerator
from .processing.depth import create_artistic_depth_map
from .store import MediaAsset, MemoryProjectStore

MAX_UPLOAD_BYTES = 256 * 1024 * 1024
MAX_VIDEO_UPLOAD_BYTES = 512 * 1024 * 1024
VIDEO_EFFECTS = {
    "soft-reflections": {
        "path": Path(__file__).resolve().parents[1] / "assets" / "video-effects" / "soft-reflections.mp4",
        "blend_mode": "screen",
        "opacity": 0.10,
    },
}
logger = logging.getLogger("uvicorn.error").getChild("processing")
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


@app.post("/api/v1/videos/convert")
async def convert_video(
    video: UploadFile = File(...),
    light_effect: str = Form("none", pattern="^(none|soft-reflections)$"),
) -> Response:
    if shutil.which("ffmpeg") is None:
        raise HTTPException(status_code=503, detail="FFmpeg is not installed on the backend.")
    payload = await video.read(MAX_VIDEO_UPLOAD_BYTES + 1)
    if not payload:
        raise HTTPException(status_code=422, detail="The recorded video is empty.")
    if len(payload) > MAX_VIDEO_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="The recorded video exceeds the 512 MB conversion limit.")
    effect = VIDEO_EFFECTS.get(light_effect)
    if effect is not None and not effect["path"].is_file():
        raise HTTPException(status_code=503, detail=f'The video asset for effect "{light_effect}" is not installed on the backend.')
    conversion_id = str(uuid4())
    started_at = perf_counter()
    logger.info("[%s] MP4 conversion started input_bytes=%d light_effect=%s", conversion_id, len(payload), light_effect)
    with tempfile.TemporaryDirectory(prefix="astro-parallax-video-") as directory:
        input_path = Path(directory) / "input.webm"
        output_path = Path(directory) / "output.mp4"
        input_path.write_bytes(payload)
        if effect is None:
            command = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(input_path), "-an", "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(output_path)]
        else:
            filter_graph = f"[1:v][0:v]scale2ref=w=rw:h=rh[effect][base];[base][effect]blend=all_mode={effect['blend_mode']}:all_opacity={effect['opacity']}:shortest=1[mixed];[mixed]scale=trunc(iw/2)*2:trunc(ih/2)*2[v]"
            command = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(input_path), "-stream_loop", "-1", "-i", str(effect["path"]), "-filter_complex", filter_graph, "-map", "[v]", "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(output_path)]
        result = await asyncio.to_thread(subprocess.run, command, capture_output=True, text=True, timeout=300, check=False)
        if result.returncode != 0 or not output_path.exists():
            logger.error("[%s] MP4 conversion failed code=%d error=%s", conversion_id, result.returncode, result.stderr[-1000:])
            raise HTTPException(status_code=422, detail="FFmpeg could not convert the recorded video.")
        converted = output_path.read_bytes()
    logger.info("[%s] MP4 conversion complete output_bytes=%d total=%.2fs", conversion_id, len(converted), perf_counter() - started_at)
    return Response(converted, media_type="video/mp4", headers={"Content-Disposition": 'attachment; filename="camera-path.mp4"'})


@app.post("/api/v1/projects", response_model=ProjectResponse, response_model_by_alias=True)
async def create_project(
    starless: UploadFile = File(...),
    stars: UploadFile = File(...),
    star_layer_count: int = Form(3, ge=2, le=8),
    star_distribution: str = Form("balanced", pattern="^(balanced|brightness|size)$"),
    star_sensitivity: float = Form(3.0, ge=1.0, le=8.0),
    star_background_mode: str = Form("auto", pattern="^(auto|none)$"),
    nebula_warp_strength: float = Form(0.02, ge=0.0, le=0.10),
    nebula_depth_smoothing: float = Form(18.0, ge=2.0, le=80.0),
    nebula_absorption_strength: float = Form(0.65, ge=0.0, le=1.0),
    nebula_depth_invert: bool = Form(False),
    nebula_fine_warp_ratio: float = Form(0.25, ge=0.0, le=1.0),
    nebula_confidence_amount: float = Form(0.7, ge=0.0, le=1.0),
) -> ProjectResponse:
    project_id = str(uuid4())
    started_at = perf_counter()
    previous_checkpoint = started_at

    def checkpoint(message: str, **details: object) -> None:
        nonlocal previous_checkpoint
        now = perf_counter()
        suffix = " ".join(f"{key}={value}" for key, value in details.items())
        logger.info("[%s] %s step=%.2fs total=%.2fs%s", project_id, message, now - previous_checkpoint, now - started_at, f" {suffix}" if suffix else "")
        previous_checkpoint = now

    checkpoint("request received", starless=starless.filename or "starless", stars=stars.filename or "stars")
    starless_payload, stars_payload = await _read_upload(starless), await _read_upload(stars)
    checkpoint("uploads read", starless_bytes=len(starless_payload), stars_bytes=len(stars_payload))
    base, stellar = load_image(starless.filename or "starless", starless_payload), load_image(stars.filename or "stars", stars_payload)
    validate_pair(base, stellar)
    checkpoint("images decoded and validated", width=base.width, height=base.height)
    checkpoint("generating nebula depth map")
    depth_result = create_artistic_depth_map(base.rgb_linear, smoothing=nebula_depth_smoothing, absorption_strength=nebula_absorption_strength, invert=False)
    checkpoint("nebula depth map generated")
    checkpoint("detecting and separating stars", layers=star_layer_count)
    star_result = StarLayerGenerator().process(
        stellar.rgb_linear,
        layer_count=star_layer_count,
        sensitivity=star_sensitivity,
        background_mode=star_background_mode,  # type: ignore[arg-type]
        strategy=RankedVisualDepthStrategy(star_distribution),  # type: ignore[arg-type]
    )
    checkpoint("stars separated", detected=len(star_result.candidates))
    checkpoint("composing reconstruction")
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
    difference = np.clip(np.abs(reference - reconstructed), 0, 1)
    checkpoint("reconstruction composed")

    checkpoint("analyzing motion risk")
    preview_width, preview_height = preview_size(base.width, base.height)
    depth_gradient_y, depth_gradient_x = np.gradient(depth_result.depth_map)
    motion_gradient = np.hypot(depth_gradient_x, depth_gradient_y)
    motion_edge_risk = float(np.percentile(motion_gradient, 95))
    protected_area = float(100 * np.mean(depth_result.confidence_map < 0.5))
    checkpoint("motion risk analyzed")

    checkpoint("encoding preview assets", preview=f"{preview_width}x{preview_height}")
    assets = {
        "starless.png": png_bytes(resize_preview(base_rgba)), "nebula-depth.png": depth_png_bytes(resize_preview(depth_result.depth_map)), "nebula-depth-inverted.png": depth_png_bytes(resize_preview(1 - depth_result.depth_map)), "nebula-confidence.png": depth_png_bytes(resize_preview(depth_result.confidence_map)),
        "original.png": png_bytes(resize_preview(reference)), "reconstructed.png": png_bytes(resize_preview(reconstructed)), "difference.png": png_bytes(resize_preview(difference)),
    }
    for index, star_rgba in enumerate(star_rgba_layers, start=1):
        assets[f"stars-{index}.png"] = png_bytes(resize_preview(star_rgba))
    checkpoint("preview assets encoded", assets=len(assets))
    checkpoint("storing project assets")
    for name, payload in assets.items():
        store.put_media(project_id, name, MediaAsset(payload))
    store.put_source(project_id, "starless", base.source_bytes)
    store.put_source(project_id, "stars", stellar.source_bytes)
    checkpoint("project assets stored")
    prefix = f"/media/{project_id}"
    source = ImageMetadata(width=base.width, height=base.height, channels=3, bit_depth=max(base.bit_depth, stellar.bit_depth), format=f"{base.format}+{stellar.format}", transfer=base.transfer, embedded_profile=base.embedded_profile or stellar.embedded_profile)
    depth_step = 0.6 / max(1, star_layer_count - 1)
    layers = [SceneLayer(id="nebula-input", name="Warped starless", type="nebula", texture_url=f"{prefix}/starless.png", depth_texture_url=f"{prefix}/nebula-depth.png", inverted_depth_texture_url=f"{prefix}/nebula-depth-inverted.png", confidence_texture_url=f"{prefix}/nebula-confidence.png", warp_strength=nebula_warp_strength, fine_warp_ratio=nebula_fine_warp_ratio, confidence_amount=nebula_confidence_amount, invert_depth=nebula_depth_invert, depth=-0.35, order=0)]
    layers.extend(SceneLayer(id=f"stars-{index + 1}", name=("Distant stars", "Mid-field stars", "Near stars")[index] if star_layer_count == 3 else f"Star depth {index + 1}", type="stars", texture_url=f"{prefix}/stars-{index + 1}.png", depth=-0.15 + index * depth_step, order=index + 1) for index in range(star_layer_count))
    scene = SceneDocument(
        name=(starless.filename or "Untitled scene").rsplit(".", 1)[0], source=source, layers=layers,
        processing=ProcessingMetadata(parameters={"starLayerCount": star_layer_count, "starDistribution": star_distribution, "starSensitivity": star_sensitivity, "starBackgroundMode": star_background_mode, "backgroundLevel": star_result.background_level, "detectionThreshold": star_result.threshold, "nebulaWarpStrength": nebula_warp_strength, "nebulaFineWarpRatio": nebula_fine_warp_ratio, "nebulaConfidenceAmount": nebula_confidence_amount, "previewWidth": preview_width, "previewHeight": preview_height, "previewDownsampled": preview_width != base.width or preview_height != base.height, "motionEdgeRiskP95": motion_edge_risk, "protectedAreaPercent": protected_area, **depth_result.parameters, "invert": nebula_depth_invert}, detectedStars=len(star_result.candidates)),
    )
    star_metrics = ReconstructionMetrics.model_validate(metrics(reference_stars, reconstructed_stars))
    combined = ReconstructionMetrics.model_validate(metrics(reference, reconstructed))
    checkpoint("reconstruction metrics calculated")
    warnings = list(dict.fromkeys((*base.warnings, *stellar.warnings)))
    if not star_result.candidates:
        warnings.append("No star candidates crossed the detection threshold; the full signal was preserved in the far layer.")
    checkpoint("request complete", warnings=len(warnings))
    return ProjectResponse(projectId=project_id, scene=scene, metrics=MetricGroups(stars=star_metrics, combined=combined), comparison=ComparisonUrls(originalUrl=f"{prefix}/original.png", reconstructedUrl=f"{prefix}/reconstructed.png", differenceUrl=f"{prefix}/difference.png"), warnings=warnings)


@app.get("/media/{project_id}/{name}")
def media(project_id: str, name: str) -> Response:
    asset = store.get_media(project_id, name)
    if asset is None:
        return Response(status_code=404)
    return Response(asset.content, media_type=asset.media_type, headers={"Cache-Control": "no-store"})


@app.delete("/api/v1/projects/{project_id}", status_code=204)
def delete_project(project_id: str) -> Response:
    store.delete_project(project_id)
    return Response(status_code=204)
