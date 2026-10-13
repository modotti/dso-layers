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


def grayscale_png(width: int, height: int, value: int) -> bytes:
    buffer = BytesIO()
    Image.new("L", (width, height), value).save(buffer, "PNG")
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


def test_custom_depth_map_is_preserved_and_used():
    response = client.post(
        "/api/v1/projects",
        files={
            "starless": ("base.png", png(4, 3, (10, 20, 30)), "image/png"),
            "stars": ("stars.png", png(4, 3, (0, 0, 0)), "image/png"),
            "depth_map": ("depth.png", grayscale_png(4, 3, 128), "image/png"),
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["scene"]["processing"]["parameters"]["customDepthMap"] is True
    depth_url = body["scene"]["layers"][0]["depth_texture_url"]
    depth_image = Image.open(BytesIO(client.get(depth_url).content))
    assert depth_image.getpixel((0, 0)) == 128


def test_custom_depth_map_dimension_mismatch_is_actionable():
    response = client.post(
        "/api/v1/projects",
        files={
            "starless": ("base.png", png(4, 3, (0, 0, 0)), "image/png"),
            "stars": ("stars.png", png(4, 3, (0, 0, 0)), "image/png"),
            "depth_map": ("depth.png", grayscale_png(5, 3, 128), "image/png"),
        },
    )
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "depth_dimension_mismatch"


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
        assert command[command.index("-crf") + 1] == "14"
        assert command[command.index("-pix_fmt") + 1] == "yuv420p"
        assert command[command.index("-x264-params") + 1] == "aq-mode=3"
        assert command[command.index("-color_primaries") + 1] == "bt709"
        Path(command[-1]).write_bytes(b"converted-mp4")
        return SimpleNamespace(returncode=0, stderr="")

    monkeypatch.setattr("app.main.subprocess.run", convert)
    response = client.post("/api/v1/videos/convert", files={"video": ("camera.webm", b"recorded-webm", "video/webm")})
    assert response.status_code == 200


def test_mjpeg_frames_are_converted_at_the_requested_frame_rate(monkeypatch):
    monkeypatch.setattr("app.main.shutil.which", lambda _: "/usr/local/bin/ffmpeg")

    def convert(command, **_):
        assert command[command.index("-f") + 1] == "mjpeg"
        assert command[command.index("-framerate") + 1] == "24"
        Path(command[-1]).write_bytes(b"converted-mp4")
        return SimpleNamespace(returncode=0, stderr="")

    monkeypatch.setattr("app.main.subprocess.run", convert)
    response = client.post(
        "/api/v1/videos/convert",
        files={"video": ("camera.mjpeg", b"\xff\xd8\xff\xd9", "application/x-mjpeg")},
        data={"input_fps": "24"},
    )
    assert response.status_code == 200
    assert response.headers["content-type"] == "video/mp4"
    assert response.content == b"converted-mp4"


def test_video_render_session_streams_frames_and_returns_mp4(monkeypatch):
    monkeypatch.setattr("app.main.shutil.which", lambda _: "/usr/local/bin/ffmpeg")

    class Input:
        def __init__(self): self.payload = bytearray()
        def write(self, value): self.payload.extend(value)
        def flush(self): pass
        def close(self): pass

    class Error:
        def read(self): return b""

    class Process:
        def __init__(self, command, **_): self.command = command; self.stdin = Input(); self.stderr = Error(); self.returncode = None
        def poll(self): return self.returncode
        def wait(self, _timeout): Path(self.command[-1]).write_bytes(b"streamed-mp4"); self.returncode = 0; return 0
        def terminate(self): self.returncode = -15
        def kill(self): self.returncode = -9

    monkeypatch.setattr("app.main.subprocess.Popen", Process)
    monkeypatch.setattr("app.main._probe_video_output", lambda _: {"frames": 2, "fps": 24.0, "duration": 2 / 24})
    started = client.post("/api/v1/video-renders", data={"fps": "24", "light_effect": "none"})
    assert started.status_code == 200
    render_id = started.json()["renderId"]
    for payload in (b"\xff\xd8one\xff\xd9", b"\xff\xd8two\xff\xd9"):
        response = client.post(f"/api/v1/video-renders/{render_id}/frames", files={"frame": ("frame.jpg", payload, "image/jpeg")})
        assert response.status_code == 204
    finished = client.post(f"/api/v1/video-renders/{render_id}/finish", data={"expected_frames": "2"})
    assert finished.status_code == 200
    assert finished.content == b"streamed-mp4"


def test_video_light_effect_is_composited_with_ffmpeg(monkeypatch, tmp_path):
    effect_path = tmp_path / "soft-reflections.mp4"
    effect_path.write_bytes(b"effect-video")
    monkeypatch.setattr("app.main.shutil.which", lambda _: "/usr/local/bin/ffmpeg")
    monkeypatch.setattr("app.main.VIDEO_EFFECTS", {"soft-reflections": {"path": effect_path, "blend_mode": "screen", "opacity": 0.07}})

    def convert(command, **_):
        assert "-stream_loop" in command
        assert str(effect_path) in command
        filter_graph = command[command.index("-filter_complex") + 1]
        assert "scale2ref=w=rw:h=rh" in filter_graph
        assert "all_mode=screen" in filter_graph
        assert "all_opacity=0.07" in filter_graph
        Path(command[-1]).write_bytes(b"mp4-with-reflections")
        return SimpleNamespace(returncode=0, stderr="")

    monkeypatch.setattr("app.main.subprocess.run", convert)
    response = client.post("/api/v1/videos/convert", files={"video": ("camera.webm", b"recorded-webm", "video/webm")}, data={"light_effect": "soft-reflections"})
    assert response.status_code == 200
    assert response.content == b"mp4-with-reflections"
