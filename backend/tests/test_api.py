from io import BytesIO

from fastapi.testclient import TestClient
from PIL import Image

from app.main import app

client = TestClient(app)


def png(width: int, height: int, color: tuple[int, int, int]) -> bytes:
    buffer = BytesIO()
    Image.new("RGB", (width, height), color).save(buffer, "PNG")
    return buffer.getvalue()


def test_project_returns_versioned_scene_and_media():
    response = client.post("/api/v1/projects", files={"starless": ("base.png", png(4, 3, (10, 20, 30)), "image/png"), "stars": ("stars.png", png(4, 3, (2, 3, 4)), "image/png")})
    assert response.status_code == 200
    body = response.json()
    assert body["scene"]["schemaVersion"] == 1
    assert len(body["scene"]["layers"]) == 4
    assert body["scene"]["processing"]["phase"] == 3
    nebula = next(layer for layer in body["scene"]["layers"] if layer["type"] == "nebula")
    assert nebula["depth_texture_url"].endswith("/nebula-depth.png")
    assert client.get(nebula["depth_texture_url"]).status_code == 200
    assert body["metrics"]["stars"]["mae"] == 0
    assert client.get(body["comparison"]["differenceUrl"]).status_code == 200


def test_dimension_mismatch_is_actionable():
    response = client.post("/api/v1/projects", files={"starless": ("base.png", png(4, 3, (0, 0, 0)), "image/png"), "stars": ("stars.png", png(5, 3, (0, 0, 0)), "image/png")})
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "dimension_mismatch"


def test_star_layer_count_and_strategy_are_configurable():
    response = client.post(
        "/api/v1/projects",
        files={"starless": ("base.png", png(8, 8, (0, 0, 0)), "image/png"), "stars": ("stars.png", png(8, 8, (2, 3, 4)), "image/png")},
        data={"star_layer_count": "5", "star_distribution": "size", "star_background_mode": "none"},
    )
    assert response.status_code == 200
    body = response.json()
    assert len([layer for layer in body["scene"]["layers"] if layer["type"] == "stars"]) == 5
    assert body["scene"]["processing"]["parameters"]["starDistribution"] == "size"


def test_depth_warp_parameters_are_exposed_in_scene():
    response = client.post(
        "/api/v1/projects",
        files={"starless": ("base.png", png(16, 12, (30, 12, 20)), "image/png"), "stars": ("stars.png", png(16, 12, (0, 0, 0)), "image/png")},
        data={"nebula_warp_strength": "0.08", "nebula_depth_smoothing": "24", "nebula_absorption_strength": "0.8", "nebula_depth_invert": "true"},
    )
    assert response.status_code == 200
    body = response.json()
    nebula = next(layer for layer in body["scene"]["layers"] if layer["type"] == "nebula")
    assert nebula["warp_strength"] == 0.08
    assert nebula["invert_depth"] is True
    assert body["scene"]["processing"]["parameters"]["invert"] is True
