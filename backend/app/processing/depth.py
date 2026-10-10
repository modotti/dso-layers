from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np


@dataclass(frozen=True)
class DepthWarpResult:
    depth_map: np.ndarray
    parameters: dict[str, float | bool]


def _normalize(values: np.ndarray, low_percentile: float = 2, high_percentile: float = 98) -> np.ndarray:
    low, high = np.percentile(values, (low_percentile, high_percentile))
    return np.clip((values - low) / max(float(high - low), 1e-8), 0, 1).astype(np.float32)


def create_artistic_depth_map(image: np.ndarray, *, smoothing: float = 18.0, absorption_strength: float = 0.65, invert: bool = False) -> DepthWarpResult:
    """Create a smooth artistic warp field, not astronomical distance."""
    luminance = np.dot(image[..., :3], np.array([0.2126, 0.7152, 0.0722], dtype=np.float32))
    height, width = luminance.shape
    working_scale = min(1.0, 1024 / max(height, width))
    working = cv2.resize(luminance, (max(8, round(width * working_scale)), max(8, round(height * working_scale))), interpolation=cv2.INTER_AREA)
    sigma = max(2.0, smoothing * working_scale)
    broad = cv2.GaussianBlur(working, (0, 0), sigmaX=sigma)
    local = cv2.GaussianBlur(working, (0, 0), sigmaX=max(1.0, sigma / 3))
    absorption = _normalize(np.maximum(broad - working, 0), 5, 99)
    emission = _normalize(broad)
    structure = _normalize(np.abs(local - broad), 5, 99)
    absorption_weight = float(np.clip(absorption_strength, 0, 1))
    depth = absorption_weight * absorption + (1 - absorption_weight) * (0.65 * emission + 0.35 * structure)
    depth = cv2.bilateralFilter(depth.astype(np.float32), 9, 0.08, max(3, sigma / 2))
    depth = cv2.GaussianBlur(depth, (0, 0), sigmaX=max(1.0, sigma / 5))
    depth = _normalize(depth)
    if invert:
        depth = 1 - depth
    full_size = cv2.resize(depth, (width, height), interpolation=cv2.INTER_CUBIC)
    return DepthWarpResult(np.clip(full_size, 0, 1).astype(np.float32), {"smoothing": smoothing, "absorptionStrength": absorption_strength, "invert": invert})
