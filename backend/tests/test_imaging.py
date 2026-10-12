from io import BytesIO

import numpy as np
import tifffile
from PIL import Image

from app.imaging import load_image, metrics, png_bytes, resize_preview, source_over, stars_to_straight_rgba


def test_stars_straight_alpha_reconstructs_signal_over_black():
    stars = np.array([[[0.1, 0.25, 0.5], [0.0, 0.0, 0.0]]], dtype=np.float32)
    rgba = stars_to_straight_rgba(stars)
    black = np.zeros_like(rgba)
    reconstructed = source_over(rgba, black)
    np.testing.assert_allclose(reconstructed[..., :3] * reconstructed[..., 3:4], stars, atol=1e-7)


def test_source_over_known_values():
    back = np.array([[[0.2, 0.4, 0.6, 1.0]]], dtype=np.float32)
    front = np.array([[[1.0, 0.0, 0.0, 0.25]]], dtype=np.float32)
    result = source_over(front, back)
    np.testing.assert_allclose(result, [[[(0.25 + 0.15), 0.3, 0.45, 1.0]]], atol=1e-7)


def test_metrics_are_zero_for_identical_images():
    image = np.ones((2, 2, 3), dtype=np.float32) * 0.5
    result = metrics(image, image)
    assert result["mae"] == result["rmse"] == result["maxError"] == 0
    assert result["pixelsOverTolerancePercent"] == 0


def test_unprofiled_tiff_keeps_display_brightness_in_png_preview():
    source = np.array([[[12, 64, 128], [180, 220, 250]]], dtype=np.uint8)
    tiff = BytesIO()
    tifffile.imwrite(tiff, source, photometric="rgb")

    loaded = load_image("source.tiff", tiff.getvalue())
    preview = np.asarray(Image.open(BytesIO(png_bytes(loaded.rgb_linear))))

    np.testing.assert_allclose(preview, source, atol=1)


def test_preview_is_bounded_without_changing_aspect_ratio():
    image = np.zeros((2000, 4000, 3), dtype=np.float32)
    preview = resize_preview(image)
    assert preview.shape == (1024, 2048, 3)


def test_depth_map_preview_supports_two_dimensional_images():
    depth = np.linspace(0, 1, 16, dtype=np.float32).reshape(4, 4)

    preview = resize_preview(depth, max_edge=2)

    assert preview.shape == (2, 2)
    np.testing.assert_allclose(preview, [[1 / 6, 3 / 10], [7 / 10, 5 / 6]], atol=1e-7)


def test_rgba_preview_preserves_subpixel_star_signal():
    rgba = np.zeros((4, 4, 4), dtype=np.float32)
    rgba[0, 0] = (0.5, 0.75, 1.0, 1.0)

    preview = resize_preview(rgba, max_edge=2)

    np.testing.assert_allclose(preview[0, 0, :3], (0.5, 0.75, 1.0), atol=1e-7)
    np.testing.assert_allclose(preview[0, 0, 3], 0.25, atol=1e-7)
    np.testing.assert_allclose(
        preview[..., :3] * preview[..., 3:4],
        np.array(
            [
                [[0.125, 0.1875, 0.25], [0.0, 0.0, 0.0]],
                [[0.0, 0.0, 0.0], [0.0, 0.0, 0.0]],
            ],
            dtype=np.float32,
        ),
        atol=1e-7,
    )
