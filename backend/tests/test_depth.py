import numpy as np

from app.processing.depth import create_artistic_depth_map


def synthetic_nebula() -> np.ndarray:
    yy, xx = np.mgrid[:80, :100]
    background = 0.25 + 0.35 * xx / 100
    absorption = 0.4 * np.exp(-((xx - 60) ** 2 / 180 + (yy - 42) ** 2 / 100))
    light = np.clip(background - absorption, 0, 1)
    return np.stack([light, light * 0.65, light * 0.8], axis=2).astype(np.float32)


def test_depth_map_is_normalized_smooth_and_deterministic():
    image = synthetic_nebula()
    first = create_artistic_depth_map(image)
    second = create_artistic_depth_map(image)
    assert first.depth_map.shape == image.shape[:2]
    assert 0 <= first.depth_map.min() <= first.depth_map.max() <= 1
    np.testing.assert_array_equal(first.depth_map, second.depth_map)
    gradient = np.mean(np.abs(np.diff(first.depth_map, axis=1)))
    assert gradient < 0.08


def test_absorption_region_is_brought_forward_and_can_be_inverted():
    image = synthetic_nebula()
    normal = create_artistic_depth_map(image).depth_map
    inverted = create_artistic_depth_map(image, invert=True).depth_map
    assert normal[42, 60] > normal[10, 10]
    np.testing.assert_allclose(normal + inverted, 1, atol=1e-6)
