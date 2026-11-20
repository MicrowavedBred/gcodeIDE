import { describe, expect, it } from 'vitest';
import { analyzeProgram } from '../../src/app/analysis';
import {
  pointsForMove,
  polylineLength,
  toolpathBounds,
} from '../../src/core/interpreter/geometry';
import type { Move } from '../../src/core/gcode/modal';
import { brotherProfile } from '../../src/core/profiles/builtin/brother';

const arc: Move = {
  kind: 'arc',
  from: { x: 10, y: 0, z: 0 },
  to: { x: 0, y: 10, z: 0 },
  plane: 'XY',
  clockwise: false,
  center: [0, 0],
  feed: 100,
  line: 1,
};

describe('toolpath geometry', () => {
  it('samples an arc into a polyline on the commanded radius', () => {
    const points = pointsForMove(arc);
    expect(points.length).toBeGreaterThan(8);
    expect(points[0]).toEqual({ x: 10, y: 0, z: 0 });
    expect(points[points.length - 1]?.x).toBeCloseTo(0, 6);
    expect(points[points.length - 1]?.y).toBeCloseTo(10, 6);
    for (const point of points) {
      expect(Math.hypot(point.x, point.y)).toBeCloseTo(10, 6);
    }
    expect(polylineLength(points)).toBeGreaterThan(15.5);
    expect(polylineLength(points)).toBeLessThan(15.8);
  });

  it('falls back to a straight line when an arc has no center', () => {
    const points = pointsForMove({ ...arc, center: undefined, radius: 10 });
    expect(points).toEqual([
      { x: 10, y: 0, z: 0 },
      { x: 0, y: 10, z: 0 },
    ]);
  });

  it('computes bounds across sampled moves', () => {
    const quick: Move = {
      kind: 'linear',
      from: { x: 0, y: 0, z: 5 },
      to: { x: -5, y: -5, z: 0 },
      feed: 100,
      line: 2,
    };
    expect(toolpathBounds([arc, quick])).toEqual({
      min: { x: -5, y: -5, z: 0 },
      max: { x: 10, y: 10, z: 5 },
    });
    expect(toolpathBounds([])).toBeNull();
  });
});

describe('canonical toolpath', () => {
  it('exposes ordered moves, counts, bounds and travel by kind', () => {
    const result = analyzeProgram(
      [
        'G21 G90 G0 X0 Y0',
        'G1 X10 F100',
        'G3 X0 Y10 I-10 J0 F100',
        'G81 X0 Y0 Z-5 R2 F100',
        'M30',
      ].join('\n'),
      'toolpath.nc',
      brotherProfile(),
    );

    expect(result.toolpath.counts).toEqual({
      rapid: 1,
      linear: 1,
      arc: 1,
      cycle: 1,
    });
    expect(result.toolpath.moves.map((move) => move.kind)).toEqual([
      'rapid',
      'linear',
      'arc',
      'canned-cycle',
    ]);
    expect(result.toolpath.bounds).not.toBeNull();
    expect(result.toolpath.lengthsMm.total).toBeGreaterThan(
      result.toolpath.lengthsMm.arc,
    );
  });
});
