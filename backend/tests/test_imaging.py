import numpy as np

from app.imaging import metrics, source_over, stars_to_straight_rgba


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
