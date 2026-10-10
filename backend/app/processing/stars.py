from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Protocol

import cv2
import numpy as np

DistributionMode = Literal["balanced", "brightness", "size"]
BackgroundMode = Literal["none", "auto"]


@dataclass(frozen=True)
class StarCandidate:
    label: int
    area: int
    peak: float
    flux: float
    centroid_x: float
    centroid_y: float
    approximate_fwhm: float


@dataclass(frozen=True)
class StarDetectionResult:
    labels: np.ndarray
    candidates: tuple[StarCandidate, ...]
    threshold: float
    background_level: float
    signal_rgb: np.ndarray


@dataclass(frozen=True)
class StarDecompositionResult:
    layers_rgb: tuple[np.ndarray, ...]
    candidates: tuple[StarCandidate, ...]
    assignments: tuple[int, ...]
    threshold: float
    background_level: float


class StarDepthAssignmentStrategy(Protocol):
    name: str

    def assign(self, candidates: tuple[StarCandidate, ...], layer_count: int) -> tuple[int, ...]: ...


class RankedVisualDepthStrategy:
    """Artistic depth assignment based on observable image properties only."""

    def __init__(self, mode: DistributionMode = "balanced") -> None:
        self.mode = mode
        self.name = f"ranked-{mode}"

    def assign(self, candidates: tuple[StarCandidate, ...], layer_count: int) -> tuple[int, ...]:
        if not candidates:
            return ()
        brightness = np.log1p([candidate.flux for candidate in candidates])
        sizes = np.log1p([candidate.approximate_fwhm for candidate in candidates])
        brightness = _rank_percentiles(brightness)
        sizes = _rank_percentiles(sizes)
        if self.mode == "brightness":
            scores = brightness
        elif self.mode == "size":
            scores = sizes
        else:
            scores = 0.7 * brightness + 0.3 * sizes
        # Brighter/larger stars are placed closer (higher layer index). Stable
        # ranking and deterministic tie-breaking keep identical inputs identical.
        return tuple(min(layer_count - 1, int(score * layer_count)) for score in scores)


def _rank_percentiles(values: np.ndarray) -> np.ndarray:
    if len(values) <= 1:
        return np.full(len(values), 0.5, dtype=np.float64)
    order = np.argsort(values, kind="stable")
    ranks = np.empty(len(values), dtype=np.float64)
    ranks[order] = np.arange(len(values), dtype=np.float64)
    return ranks / len(values)


class StarDetectionService:
    def detect(
        self,
        rgb_linear: np.ndarray,
        *,
        sensitivity: float = 3.0,
        min_area: int = 1,
        background_mode: BackgroundMode = "auto",
    ) -> StarDetectionResult:
        luminance = np.dot(rgb_linear[..., :3], np.array([0.2126, 0.7152, 0.0722], dtype=np.float32))
        background = float(np.percentile(luminance, 0.5)) if background_mode == "auto" else 0.0
        signal_rgb = np.clip(rgb_linear - background, 0.0, 1.0).astype(np.float32)
        signal_luminance = np.dot(signal_rgb, np.array([0.2126, 0.7152, 0.0722], dtype=np.float32))
        blurred = cv2.GaussianBlur(signal_luminance, (0, 0), sigmaX=1.0)
        median = float(np.median(blurred))
        mad = float(np.median(np.abs(blurred - median)))
        robust_sigma = max(1.4826 * mad, 1 / 65535)
        # Sparse synthetic/black-background fields can have zero MAD. A small
        # relative floor prevents infinitesimal PSF tails from joining otherwise
        # distinct stars into one component without excluding faint peaks.
        threshold = max(median + sensitivity * robust_sigma, float(blurred.max(initial=0)) * 0.005)
        detection_mask = (blurred > threshold).astype(np.uint8)
        count, component_labels, stats, centroids = cv2.connectedComponentsWithStats(detection_mask, connectivity=8)

        candidates: list[StarCandidate] = []
        kept = np.zeros_like(component_labels, dtype=np.int32)
        next_label = 1
        for label in range(1, count):
            area = int(stats[label, cv2.CC_STAT_AREA])
            if area < min_area:
                continue
            component = component_labels == label
            values = signal_luminance[component]
            flux = float(values.sum())
            peak = float(values.max(initial=0))
            approximate_fwhm = 2 * np.sqrt(area / np.pi)
            candidates.append(StarCandidate(next_label, area, peak, flux, float(centroids[label, 0]), float(centroids[label, 1]), float(approximate_fwhm)))
            kept[component] = next_label
            next_label += 1
        return StarDetectionResult(kept, tuple(candidates), threshold, background, signal_rgb)


class StarLayerGenerator:
    def __init__(self, detector: StarDetectionService | None = None) -> None:
        self.detector = detector or StarDetectionService()

    def process(
        self,
        rgb_linear: np.ndarray,
        *,
        layer_count: int = 3,
        sensitivity: float = 3.0,
        min_area: int = 1,
        background_mode: BackgroundMode = "auto",
        strategy: StarDepthAssignmentStrategy | None = None,
    ) -> StarDecompositionResult:
        if not 2 <= layer_count <= 8:
            raise ValueError("Star layer count must be between 2 and 8.")
        detection = self.detector.detect(rgb_linear, sensitivity=sensitivity, min_area=min_area, background_mode=background_mode)
        assignment_strategy = strategy or RankedVisualDepthStrategy()
        assignments = assignment_strategy.assign(detection.candidates, layer_count)
        layers = [np.zeros_like(detection.signal_rgb) for _ in range(layer_count)]
        if detection.candidates:
            # The nearest detected component owns every residual pixel. This
            # keeps faint halos whole and guarantees that no pixel is duplicated.
            seed_background = np.where(detection.labels > 0, 0, 255).astype(np.uint8)
            _, nearest = cv2.distanceTransformWithLabels(seed_background, cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_CCOMP)
            component_layers = np.zeros(len(detection.candidates) + 1, dtype=np.uint8)
            for candidate, layer_index in zip(detection.candidates, assignments, strict=True):
                component_layers[candidate.label] = layer_index
            pixel_layers = component_layers[nearest]
            for layer_index, layer in enumerate(layers):
                layer_mask = pixel_layers == layer_index
                layer[layer_mask] = detection.signal_rgb[layer_mask]
        else:
            layers[0][...] = detection.signal_rgb
        return StarDecompositionResult(tuple(layers), detection.candidates, assignments, detection.threshold, detection.background_level)
