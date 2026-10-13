import * as THREE from 'three';
import { focusDistanceAlongView, interpolateFocusDistance, perspectiveDepthForDistance } from './focus-distance';

describe('focusDistanceAlongView', () => {
  it('projects the focus point onto the camera view axis', () => {
    const distance = focusDistanceAlongView(new THREE.Vector3(0, 0, 5), new THREE.Vector3(0, 0, -1), new THREE.Vector3(2, 1, -.35), .1);
    expect(distance).toBeCloseTo(5.35, 6);
  });

  it('supports an orbiting camera direction', () => {
    const distance = focusDistanceAlongView(new THREE.Vector3(5, 0, 0), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(-.35, 2, 1), .1);
    expect(distance).toBeCloseTo(5.35, 6);
  });

  it('clamps points behind the camera to its near plane', () => {
    const distance = focusDistanceAlongView(new THREE.Vector3(0, 0, 5), new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 0, 8), .2);
    expect(distance).toBe(.2);
  });
});

describe('perspectiveDepthForDistance', () => {
  it('maps the camera clipping distances to the depth buffer range', () => {
    expect(perspectiveDepthForDistance(.1, .1, 100)).toBeCloseTo(0, 6);
    expect(perspectiveDepthForDistance(100, .1, 100)).toBeCloseTo(1, 6);
  });
});

describe('interpolateFocusDistance', () => {
  it('interpolates captured focus distances', () => expect(interpolateFocusDistance(4, 8, .25)).toBe(5));
  it('keeps legacy paths on dynamic focus', () => expect(interpolateFocusDistance(undefined, 8, .5)).toBeUndefined());
});
