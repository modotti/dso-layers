import * as THREE from 'three';
import { CameraMovement, CameraPathFlow, CameraPathPose, ImageOverlay, TextOverlay } from './models';
import { cinematicPathPhase } from './camera-path-flow';
import { interpolateFocusDistance } from './focus-distance';
import { textOverlayOpacity } from './text-overlay';

export interface TimelineState extends CameraPathPose {
  timeSeconds: number;
  complete: boolean;
  overlays: ReadonlyArray<{ id: string; opacity: number; motionProgress: number }>;
  crossfade?: { outgoing: CameraPathPose; incoming: CameraPathPose; progress: number };
}

export interface TimelineEvaluatorOptions {
  flow: CameraPathFlow;
  transitionMomentum: number;
  overlays?: readonly (TextOverlay | ImageOverlay)[];
}

const durationOf = (movement: CameraMovement): number => THREE.MathUtils.clamp(movement.duration, 1, 20);

export function movementTransitionDuration(movement: CameraMovement, index: number, previousDuration = Infinity): number {
  if (!index || movement.transition !== 'crossfade') return 0;
  return THREE.MathUtils.clamp(movement.transitionDuration ?? .75, .2, Math.min(4, durationOf(movement), previousDuration));
}

export function timelineDuration(movements: readonly CameraMovement[], flow: CameraPathFlow = 'per-movement'): number {
  return movements.reduce((total, movement, index) => total + durationOf(movement) - (flow === 'per-movement' ? movementTransitionDuration(movement, index, index ? durationOf(movements[index - 1]) : Infinity) : 0), 0);
}

export function timelineMovementIndex(movements: readonly CameraMovement[], timeSeconds: number): number {
  if (!movements.length) return 0;
  let remaining = Math.max(0, timeSeconds);
  for (let index = 0; index < movements.length - 1; index++) {
    const duration = durationOf(movements[index]) - movementTransitionDuration(movements[index + 1], index + 1, durationOf(movements[index]));
    if (remaining < duration) return index;
    remaining -= duration;
  }
  return movements.length - 1;
}

export function easeTimelinePhase(phase: number, easing: CameraMovement['easing']): number {
  const value = THREE.MathUtils.clamp(phase, 0, 1);
  if (easing === 'linear') return value;
  if (easing === 'ease-in') return value ** 3;
  if (easing === 'ease-out') return 1 - (1 - value) ** 3;
  return value ** 3 * (value * (value * 6 - 15) + 10);
}

function overlaysAt(overlays: readonly (TextOverlay | ImageOverlay)[], timeSeconds: number): TimelineState['overlays'] {
  return overlays.map(overlay => ({
    id: overlay.id,
    opacity: textOverlayOpacity(overlay, timeSeconds) * THREE.MathUtils.clamp(overlay.opacity, 0, 1),
    motionProgress: Math.min(1, Math.max(0, timeSeconds - overlay.start) / Math.max(.2, overlay.fadeIn || .8)),
  }));
}

function unwrapRolls(poses: readonly CameraPathPose[]): number[] {
  return poses.map(pose => pose.roll ?? 0).reduce<number[]>((rolls, roll) => {
    const previous = rolls.at(-1);
    rolls.push(previous === undefined ? roll : previous + THREE.MathUtils.euclideanModulo(roll - previous + 180, 360) - 180);
    return rolls;
  }, []);
}

function curve(values: readonly [number, number, number][]): THREE.CatmullRomCurve3 {
  return new THREE.CatmullRomCurve3(values.map(value => new THREE.Vector3().fromArray(value)), false, 'centripetal');
}

/** Builds a stateless evaluator: a result depends only on its requested timestamp. */
export function createTimelineEvaluator(
  movements: readonly CameraMovement[],
  options: TimelineEvaluatorOptions,
): (timeSeconds: number) => TimelineState {
  const valid = movements.filter(movement => movement.path.start && movement.path.end);
  if (!valid.length || valid.length !== movements.length) throw new Error('Every camera movement needs a start and end pose.');
  const totalDuration = timelineDuration(valid, options.flow);
  const overlays = options.overlays ?? [];
  const poses = [valid[0].path.start!, ...valid.map(movement => movement.path.end!)];

  if (options.flow === 'continuous') {
    const positionCurve = curve(poses.map(pose => pose.position));
    const targetCurve = curve(poses.map(pose => pose.target));
    const rollCurve = curve(unwrapRolls(poses).map(roll => [roll, 0, 0]));
    const focusCurve = poses.every(pose => pose.focusDistance !== undefined)
      ? curve(poses.map(pose => [pose.focusDistance!, 0, 0]))
      : undefined;
    return requestedTime => {
      const timeSeconds = THREE.MathUtils.clamp(requestedTime, 0, totalDuration);
      const rawPhase = totalDuration ? timeSeconds / totalDuration : 1;
      const phase = cinematicPathPhase(easeTimelinePhase(rawPhase, 'ease-in-out'), valid.length, options.transitionMomentum);
      return {
        timeSeconds,
        position: positionCurve.getPoint(phase).toArray(),
        target: targetCurve.getPoint(phase).toArray(),
        roll: rollCurve.getPoint(phase).x,
        focusDistance: focusCurve?.getPoint(phase).x,
        complete: timeSeconds >= totalDuration,
        overlays: overlaysAt(overlays, timeSeconds),
      };
    };
  }

  const starts = valid.reduce<number[]>((values, movement, index) => index === 0
    ? [0]
    : [...values, values[index - 1] + durationOf(valid[index - 1]) - movementTransitionDuration(movement, index, durationOf(valid[index - 1]))], []);
  const poseAt = (movement: CameraMovement, localTime: number): CameraPathPose => {
    const start = movement.path.start!; const end = movement.path.end!;
    const phase = easeTimelinePhase(localTime / durationOf(movement), movement.easing);
    const lerpTuple = (from: [number, number, number], to: [number, number, number]): [number, number, number] => [
      THREE.MathUtils.lerp(from[0], to[0], phase), THREE.MathUtils.lerp(from[1], to[1], phase), THREE.MathUtils.lerp(from[2], to[2], phase),
    ];
    return { position: lerpTuple(start.position, end.position), target: lerpTuple(start.target, end.target), roll: THREE.MathUtils.lerp(start.roll ?? 0, end.roll ?? 0, phase), focusDistance: interpolateFocusDistance(start.focusDistance, end.focusDistance, phase) };
  };
  return requestedTime => {
    const timeSeconds = THREE.MathUtils.clamp(requestedTime, 0, totalDuration);
    const incomingIndex = valid.findIndex((movement, index) => index > 0 && timeSeconds >= starts[index] && timeSeconds < starts[index] + movementTransitionDuration(movement, index, durationOf(valid[index - 1])));
    let index = incomingIndex >= 0 ? incomingIndex : 0;
    if (incomingIndex < 0) for (let candidate = 1; candidate < valid.length; candidate++) if (timeSeconds >= starts[candidate]) index = candidate;
    const movement = valid[index];
    const pose = poseAt(movement, timeSeconds - starts[index]);
    const overlap = movementTransitionDuration(movement, index, index ? durationOf(valid[index - 1]) : Infinity);
    const crossfade = incomingIndex >= 0
      ? { outgoing: poseAt(valid[index - 1], timeSeconds - starts[index - 1]), incoming: pose, progress: THREE.MathUtils.clamp((timeSeconds - starts[index]) / overlap, 0, 1) }
      : undefined;
    const displayed = crossfade?.incoming ?? pose;
    return {
      timeSeconds,
      ...displayed,
      complete: timeSeconds >= totalDuration,
      overlays: overlaysAt(overlays, timeSeconds),
      crossfade,
    };
  };
}
