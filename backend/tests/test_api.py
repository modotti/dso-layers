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
    assert body["scene"]["processing"]["phase"] == 2
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
