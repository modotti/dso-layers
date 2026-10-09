from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class Vector3(BaseModel):
    x: float
    y: float
    z: float


class ImageMetadata(BaseModel):
    width: int
    height: int
    channels: int
    bit_depth: int
    format: str
    transfer: Literal["srgb", "linear", "unknown"]
    embedded_profile: bool = False


class SceneConventions(BaseModel):
    coordinates: str = "right-handed,+x-right,+y-up,camera-looks-negative-z"
    image_origin: Literal["top-left"] = "top-left"
    alpha: Literal["straight"] = "straight"
    compositing: Literal["source-over-back-to-front"] = "source-over-back-to-front"
    texture_color_space: Literal["srgb"] = "srgb"
    processing_color_space: Literal["linear-srgb"] = "linear-srgb"


class CameraConfig(BaseModel):
    position: tuple[float, float, float] = (0.0, 0.0, 5.0)
    target: tuple[float, float, float] = (0.0, 0.0, 0.0)
    fov: float = 45.0
    near: float = 0.1
    far: float = 100.0
    max_orbit_degrees: float = 18.0
    min_distance: float = 3.5
    max_distance: float = 7.0


class LayerTransform(BaseModel):
    position: Vector3 = Field(default_factory=lambda: Vector3(x=0, y=0, z=0))
    scale: Vector3 = Field(default_factory=lambda: Vector3(x=1, y=1, z=1))


class SceneLayer(BaseModel):
    id: str
    name: str
    type: Literal["nebula", "stars"]
    texture_url: str
    depth: float
    order: int
    visible: bool = True
    opacity: float = 1.0
    transform: LayerTransform = Field(default_factory=LayerTransform)


class ProcessingMetadata(BaseModel):
    phase: Literal[2] = 2
    algorithm: Literal["star-visual-heuristics-v1"] = "star-visual-heuristics-v1"
    deterministic: bool = True
    parameters: dict[str, str | int | float | bool] = Field(default_factory=dict)
    detected_stars: int = Field(0, alias="detectedStars")

    model_config = {"populate_by_name": True}


class SceneDocument(BaseModel):
    schema_version: Literal[1] = Field(1, alias="schemaVersion")
    name: str
    source: ImageMetadata
    conventions: SceneConventions = Field(default_factory=SceneConventions)
    camera: CameraConfig = Field(default_factory=CameraConfig)
    layers: list[SceneLayer]
    processing: ProcessingMetadata = Field(default_factory=ProcessingMetadata)

    model_config = {"populate_by_name": True}


class ReconstructionMetrics(BaseModel):
    mae: float
    rmse: float
    max_error: float = Field(alias="maxError")
    pixels_over_tolerance_percent: float = Field(alias="pixelsOverTolerancePercent")
    tolerance: float

    model_config = {"populate_by_name": True}


class MetricGroups(BaseModel):
    nebula: ReconstructionMetrics | None = None
    stars: ReconstructionMetrics | None = None
    combined: ReconstructionMetrics


class ComparisonUrls(BaseModel):
    original_url: str = Field(alias="originalUrl")
    reconstructed_url: str = Field(alias="reconstructedUrl")
    difference_url: str = Field(alias="differenceUrl")

    model_config = {"populate_by_name": True}


class ProjectResponse(BaseModel):
    project_id: str = Field(alias="projectId")
    scene: SceneDocument
    metrics: MetricGroups
    comparison: ComparisonUrls
    warnings: list[str]

    model_config = {"populate_by_name": True}
