import type { Move, Plane } from '../gcode/modal';
import type { Vec3 } from '../shared/types';

type Axis = 'x' | 'y' | 'z';

export interface Bounds {
  min: Vec3;
  max: Vec3;
}

const planeAxes: Record<Plane, { u: Axis; v: Axis; fixed: Axis }> = {
  XY: { u: 'x', v: 'y', fixed: 'z' },
  ZX: { u: 'z', v: 'x', fixed: 'y' },
  YZ: { u: 'y', v: 'z', fixed: 'x' },
};

function point(pose: Vec3): Vec3 {
  return { x: pose.x, y: pose.y, z: pose.z };
}

function arcPoints(move: Extract<Move, { kind: 'arc' }>): Vec3[] {
  const points = [point(move.from)];
  if (!move.center) {
    points.push(point(move.to));
    return points;
  }

  const axes = planeAxes[move.plane];
  const [cu, cv] = move.center;
  const startU = move.from[axes.u] - cu;
  const startV = move.from[axes.v] - cv;
  const radius = Math.hypot(startU, startV);
  if (radius < 1e-6) {
    points.push(point(move.to));
    return points;
  }

  const startAngle = Math.atan2(startV, startU);
  const endAngle = Math.atan2(move.to[axes.v] - cv, move.to[axes.u] - cu);
  let sweep = endAngle - startAngle;
  if (move.clockwise) {
    while (sweep >= 0) sweep -= Math.PI * 2;
  } else {
    while (sweep <= 0) sweep += Math.PI * 2;
  }

  const steps = Math.max(8, Math.ceil(Math.abs(sweep) / (Math.PI / 24)));
  for (let step = 1; step <= steps; step += 1) {
    const fraction = step / steps;
    const angle = startAngle + sweep * fraction;
    const next = point(move.from);
    next[axes.u] = cu + radius * Math.cos(angle);
    next[axes.v] = cv + radius * Math.sin(angle);
    next[axes.fixed] =
      move.from[axes.fixed] +
      (move.to[axes.fixed] - move.from[axes.fixed]) * fraction;
    points.push(next);
  }
  return points;
}

function cyclePoints(move: Extract<Move, { kind: 'canned-cycle' }>): Vec3[] {
  const top = move.from.z;
  const bottom = move.z ?? move.at.z;
  const retract = move.r ?? top;
  return [
    { x: move.at.x, y: move.at.y, z: retract },
    { x: move.at.x, y: move.at.y, z: bottom },
    { x: move.at.x, y: move.at.y, z: retract },
    { x: move.at.x, y: move.at.y, z: top },
  ];
}

/** Samples a move into the points used for drawing and measurement. */
export function pointsForMove(move: Move): Vec3[] {
  switch (move.kind) {
    case 'rapid':
    case 'linear':
      return [point(move.from), point(move.to)];
    case 'arc':
      return arcPoints(move);
    case 'canned-cycle':
      return cyclePoints(move);
  }
}

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}

export function polylineLength(points: Vec3[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += distance(points[index - 1], points[index]);
  }
  return length;
}

export function toolpathBounds(moves: Move[]): Bounds | null {
  const min: Vec3 = { x: Infinity, y: Infinity, z: Infinity };
  const max: Vec3 = { x: -Infinity, y: -Infinity, z: -Infinity };
  let found = false;

  for (const move of moves) {
    for (const current of pointsForMove(move)) {
      found = true;
      min.x = Math.min(min.x, current.x);
      min.y = Math.min(min.y, current.y);
      min.z = Math.min(min.z, current.z);
      max.x = Math.max(max.x, current.x);
      max.y = Math.max(max.y, current.y);
      max.z = Math.max(max.z, current.z);
    }
  }
  return found ? { min, max } : null;
}
