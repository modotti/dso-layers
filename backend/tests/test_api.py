from io import BytesIO
from pathlib import Path
from types import SimpleNamespace

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
    assert body["scene"]["processing"]["phase"] == 4
    nebula = next(layer for layer in body["scene"]["layers"] if layer["type"] == "nebula")
    assert nebula["warp_strength"] == 0.02
    assert nebula["depth_texture_url"].endswith("/nebula-depth.png")
    assert client.get(nebula["depth_texture_url"]).status_code == 200
    assert nebula["inverted_depth_texture_url"].endswith("/nebula-depth-inverted.png")
    assert client.get(nebula["inverted_depth_texture_url"]).status_code == 200
    assert nebula["confidence_texture_url"].endswith("/nebula-confidence.png")
    assert client.get(nebula["confidence_texture_url"]).status_code == 200
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
        data={"nebula_warp_strength": "0.08", "nebula_depth_smoothing": "24", "nebula_absorption_strength": "0.8", "nebula_depth_invert": "true", "nebula_fine_warp_ratio": "0.3", "nebula_confidence_amount": "0.9"},
    )
    assert response.status_code == 200
    body = response.json()
    nebula = next(layer for layer in body["scene"]["layers"] if layer["type"] == "nebula")
    assert nebula["warp_strength"] == 0.08
    assert nebula["invert_depth"] is True
    assert nebula["fine_warp_ratio"] == 0.3
    assert nebula["confidence_amount"] == 0.9
    assert body["scene"]["processing"]["parameters"]["invert"] is True


def test_project_assets_can_be_released():
    response = client.post("/api/v1/projects", files={"starless": ("base.png", png(4, 3, (10, 20, 30)), "image/png"), "stars": ("stars.png", png(4, 3, (0, 0, 0)), "image/png")})
    body = response.json()
    media_url = body["scene"]["layers"][0]["texture_url"]
    assert client.get(media_url).status_code == 200
    assert client.delete(f"/api/v1/projects/{body['projectId']}").status_code == 204
    assert client.get(media_url).status_code == 404


def test_webm_video_can_be_converted_to_mp4(monkeypatch):
    monkeypatch.setattr("app.main.shutil.which", lambda _: "/usr/local/bin/ffmpeg")

    def convert(command, **_):
        Path(command[-1]).write_bytes(b"converted-mp4")
        return SimpleNamespace(returncode=0, stderr="")

    monkeypatch.setattr("app.main.subprocess.run", convert)
    response = client.post("/api/v1/videos/convert", files={"video": ("camera.webm", b"recorded-webm", "video/webm")})
    assert response.status_code == 200
    assert response.headers["content-type"] == "video/mp4"
    assert response.content == b"converted-mp4"


def test_video_light_effect_is_composited_with_ffmpeg(monkeypatch, tmp_path):
    effect_path = tmp_path / "soft-reflections.mp4"
    effect_path.write_bytes(b"effect-video")
    monkeypatch.setattr("app.main.shutil.which", lambda _: "/usr/local/bin/ffmpeg")
    monkeypatch.setattr("app.main.VIDEO_EFFECTS", {"soft-reflections": {"path": effect_path, "blend_mode": "addition", "opacity": 0.14}})

    def convert(command, **_):
        assert "-stream_loop" in command
        assert str(effect_path) in command
        filter_graph = command[command.index("-filter_complex") + 1]
        assert "scale2ref=w=rw:h=rh" in filter_graph
        assert "all_mode=addition" in filter_graph
        assert "all_opacity=0.14" in filter_graph
        Path(command[-1]).write_bytes(b"mp4-with-reflections")
        return SimpleNamespace(returncode=0, stderr="")

    monkeypatch.setattr("app.main.subprocess.run", convert)
    response = client.post("/api/v1/videos/convert", files={"video": ("camera.webm", b"recorded-webm", "video/webm")}, data={"light_effect": "soft-reflections"})
    assert response.status_code == 200
    assert response.content == b"mp4-with-reflections"
