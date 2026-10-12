from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO
from pathlib import Path

import numpy as np
import tifffile
from PIL import Image, UnidentifiedImageError

SUPPORTED_SUFFIXES = {".png", ".tif", ".tiff"}
MAX_PIXELS = 80_000_000
MAX_PREVIEW_EDGE = 2048


class ImageValidationError(ValueError):
    def __init__(self, code: str, message: str, context: dict | None = None):
        super().__init__(message)
        self.code = code
        self.context = context or {}


@dataclass(frozen=True)
class LoadedImage:
    source_bytes: bytes
    rgb_linear: np.ndarray
    width: int
    height: int
    channels: int
    bit_depth: int
    format: str
    transfer: str
    embedded_profile: bool
    warnings: tuple[str, ...]


def srgb_to_linear(values: np.ndarray) -> np.ndarray:
    values = np.clip(values, 0.0, 1.0)
    return np.where(values <= 0.04045, values / 12.92, ((values + 0.055) / 1.055) ** 2.4).astype(np.float32)


def linear_to_srgb(values: np.ndarray) -> np.ndarray:
    values = np.clip(values, 0.0, 1.0)
    return np.where(values <= 0.0031308, values * 12.92, 1.055 * values ** (1 / 2.4) - 0.055)


def _normalize(array: np.ndarray) -> tuple[np.ndarray, int]:
    if np.issubdtype(array.dtype, np.integer):
        bits = array.dtype.itemsize * 8
        return array.astype(np.float32) / np.iinfo(array.dtype).max, bits
    if np.issubdtype(array.dtype, np.floating):
        return np.clip(array.astype(np.float32), 0, 1), array.dtype.itemsize * 8
    raise ImageValidationError("unsupported_sample_type", f"Unsupported sample type: {array.dtype}")


def load_image(filename: str, payload: bytes) -> LoadedImage:
    suffix = Path(filename).suffix.lower()
    if suffix not in SUPPORTED_SUFFIXES:
        raise ImageValidationError("unsupported_format", "Use a PNG or TIFF image.", {"filename": filename})
    try:
        if suffix in {".tif", ".tiff"}:
            raw = tifffile.imread(BytesIO(payload))
            fmt, transfer, profile = "TIFF", "unknown", False
            warnings = ("TIFF transfer function/profile is not interpreted in Phase 1; values are preserved and treated as display-referred for previews.",)
        else:
            with Image.open(BytesIO(payload)) as image:
                profile = bool(image.info.get("icc_profile"))
                raw = np.asarray(image)
            fmt, transfer, warnings = "PNG", "srgb", ()
    except (UnidentifiedImageError, OSError, ValueError, tifffile.TiffFileError) as exc:
        raise ImageValidationError("invalid_image", "The file could not be decoded as a valid image.", {"filename": filename}) from exc

    if raw.ndim == 2:
        raw = np.repeat(raw[..., None], 3, axis=2)
        channels = 1
    elif raw.ndim == 3 and raw.shape[2] in (3, 4):
        channels = raw.shape[2]
        raw = raw[..., :3]
    else:
        raise ImageValidationError("unsupported_channels", "Images must be grayscale, RGB, or RGBA.", {"shape": list(raw.shape)})
    height, width = raw.shape[:2]
    if width * height > MAX_PIXELS:
        raise ImageValidationError("image_too_large", f"Image exceeds the {MAX_PIXELS:,}-pixel safety limit.")
    normalized, bit_depth = _normalize(raw)
    # Browser previews always interpret the generated PNG textures as sRGB.
    # Unprofiled TIFFs are therefore decoded as display-referred sRGB too; if
    # their samples were passed through unchanged, png_bytes() would encode a
    # second transfer curve and visibly lift shadows and midtones.
    linear = srgb_to_linear(normalized) if transfer in {"srgb", "unknown"} else normalized
    return LoadedImage(payload, linear, width, height, channels, bit_depth, fmt, transfer, profile, warnings)


def validate_pair(starless: LoadedImage, stars: LoadedImage) -> None:
    if (starless.width, starless.height) != (stars.width, stars.height):
        raise ImageValidationError(
            "dimension_mismatch",
            "Starless and stars images must have identical dimensions; sources were not resized.",
            {"starless": [starless.width, starless.height], "stars": [stars.width, stars.height]},
        )


def stars_to_straight_rgba(rgb: np.ndarray, epsilon: float = 1e-6) -> np.ndarray:
    alpha = np.max(rgb, axis=2, keepdims=True)
    straight_rgb = np.divide(rgb, alpha, out=np.zeros_like(rgb), where=alpha > epsilon)
    return np.concatenate([straight_rgb, alpha], axis=2)


def source_over(foreground: np.ndarray, background: np.ndarray) -> np.ndarray:
    source_a = foreground[..., 3:4]
    dest_a = background[..., 3:4]
    out_a = source_a + dest_a * (1 - source_a)
    premultiplied = foreground[..., :3] * source_a + background[..., :3] * dest_a * (1 - source_a)
    out_rgb = np.divide(premultiplied, out_a, out=np.zeros_like(premultiplied), where=out_a > 1e-8)
    return np.concatenate([out_rgb, out_a], axis=2)


def metrics(reference: np.ndarray, actual: np.ndarray, tolerance: float = 1 / 255) -> dict[str, float]:
    error = np.abs(reference.astype(np.float64) - actual.astype(np.float64))
    return {
        "mae": float(error.mean()),
        "rmse": float(np.sqrt(np.square(error).mean())),
        "maxError": float(error.max(initial=0)),
        "pixelsOverTolerancePercent": float(100 * np.mean(np.max(error, axis=2) > tolerance)),
        "tolerance": tolerance,
    }


def png_bytes(rgb_or_rgba_linear: np.ndarray) -> bytes:
    encoded = np.round(linear_to_srgb(rgb_or_rgba_linear[..., :3]) * 255).astype(np.uint8)
    if rgb_or_rgba_linear.shape[2] == 4:
        alpha = np.round(np.clip(rgb_or_rgba_linear[..., 3:4], 0, 1) * 255).astype(np.uint8)
        encoded = np.concatenate([encoded, alpha], axis=2)
        mode = "RGBA"
    else:
        mode = "RGB"
    output = BytesIO()
    Image.fromarray(encoded, mode=mode).save(output, format="PNG", optimize=True)
    return output.getvalue()


def depth_png_bytes(depth: np.ndarray) -> bytes:
    output = BytesIO()
    Image.fromarray(np.round(np.clip(depth, 0, 1) * 255).astype(np.uint8), mode="L").save(output, format="PNG", optimize=True)
    return output.getvalue()


def preview_size(width: int, height: int, max_edge: int = MAX_PREVIEW_EDGE) -> tuple[int, int]:
    scale = min(1.0, max_edge / max(width, height))
    return max(1, round(width * scale)), max(1, round(height * scale))


def resize_preview(image: np.ndarray, max_edge: int = MAX_PREVIEW_EDGE) -> np.ndarray:
    width, height = preview_size(image.shape[1], image.shape[0], max_edge)
    if (width, height) == (image.shape[1], image.shape[0]):
        return image
    import cv2

    if image.ndim != 3 or image.shape[2] != 4:
        return cv2.resize(image, (width, height), interpolation=cv2.INTER_AREA)

    # RGBA assets use straight alpha. Resizing their color and alpha channels
    # independently darkens sub-pixel stars because the renderer multiplies
    # the already-averaged color by the averaged alpha once more. Filter in
    # premultiplied-alpha space, then return straight RGBA for browser blending.
    alpha = image[..., 3:4]
    premultiplied = image[..., :3] * alpha
    resized_premultiplied = cv2.resize(premultiplied, (width, height), interpolation=cv2.INTER_AREA)
    resized_alpha = cv2.resize(alpha, (width, height), interpolation=cv2.INTER_AREA)
    if resized_alpha.ndim == 2:
        resized_alpha = resized_alpha[..., None]
    straight_rgb = np.divide(
        resized_premultiplied,
        resized_alpha,
        out=np.zeros_like(resized_premultiplied),
        where=resized_alpha > 1e-8,
    )
    return np.concatenate([straight_rgb, resized_alpha], axis=2)
