import numpy as np

from app.processing.stars import RankedVisualDepthStrategy, StarLayerGenerator


def synthetic_star_field() -> np.ndarray:
    image = np.zeros((31, 31, 3), dtype=np.float32)
    yy, xx = np.mgrid[:31, :31]
    for x, y, amplitude, sigma, color in (
        (7, 8, 0.25, 1.0, (0.8, 0.9, 1.0)),
        (16, 15, 0.6, 1.5, (1.0, 0.8, 0.7)),
        (25, 23, 0.95, 2.0, (0.7, 0.85, 1.0)),
    ):
        profile = amplitude * np.exp(-((xx - x) ** 2 + (yy - y) ** 2) / (2 * sigma**2))
        image += profile[..., None] * np.asarray(color)
    return np.clip(image, 0, 1).astype(np.float32)


def test_decomposition_is_conservative_and_has_no_duplicate_pixels():
    source = synthetic_star_field()
    result = StarLayerGenerator().process(source, layer_count=3, background_mode="none", sensitivity=2)
    reconstructed = np.sum(result.layers_rgb, axis=0)
    np.testing.assert_allclose(reconstructed, source, atol=1e-7)
    occupied = np.sum([np.max(layer, axis=2) > 0 for layer in result.layers_rgb], axis=0)
    assert occupied.max() == 1
    # The two overlapping synthetic profiles are intentionally allowed to
    # remain one connected stellar region rather than clipping their halos.
    assert len(result.candidates) == 2


def test_assignment_is_deterministic_and_bright_stars_move_nearer():
    generator = StarLayerGenerator()
    first = generator.process(synthetic_star_field(), layer_count=3, background_mode="none", sensitivity=2, strategy=RankedVisualDepthStrategy("brightness"))
    second = generator.process(synthetic_star_field(), layer_count=3, background_mode="none", sensitivity=2, strategy=RankedVisualDepthStrategy("brightness"))
    assert first.assignments == second.assignments
    assert tuple(sorted(first.assignments)) == first.assignments


def test_empty_field_is_preserved_without_candidates():
    source = np.zeros((8, 8, 3), dtype=np.float32)
    result = StarLayerGenerator().process(source, layer_count=3)
    assert result.candidates == ()
    np.testing.assert_array_equal(np.sum(result.layers_rgb, axis=0), source)
