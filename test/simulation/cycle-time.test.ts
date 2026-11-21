import { describe, expect, it } from 'vitest';
import { estimateCycleTime } from '../../src/core/simulation/cycle-time';
import type { Move } from '../../src/core/gcode/modal';

const pose = (x: number, y: number, z: number) => ({ x, y, z });

function rapid(x: number, line: number): Move {
  return {
    kind: 'rapid',
    from: pose(0, 0, 0),
    to: pose(x, 0, 0),
    feed: null,
    feedMode: 'G94',
    line,
  };
}

function linear(x: number, feed: number | null, line: number): Move {
  return {
    kind: 'linear',
    from: pose(0, 0, 0),
    to: pose(x, 0, 0),
    feed,
    feedMode: 'G94',
    line,
  };
}

describe('estimateCycleTime', () => {
  it('adds rapid, feed and dwell time in minutes', () => {
    const result = estimateCycleTime(
      [rapid(100, 2), linear(100, 1200, 3)],
      2,
      { rapidRateMmPerMin: 6000 },
    );

    expect(result.seconds).toBeCloseTo(8, 6);
    expect(result.breakdown).toEqual({
      rapid: 1,
      feed: 5,
      cycle: 0,
      dwell: 2,
    });
    expect(result.reasons).toEqual([]);
  });

  it('returns unavailable when the rapid rate is missing', () => {
    const result = estimateCycleTime([rapid(100, 2)], 0, {
      rapidRateMmPerMin: null,
    });

    expect(result.seconds).toBeNull();
    expect(result.reasons).toContain(
      'Rapid rate is not configured for this variant.',
    );
  });

  it('returns unavailable when a feed move has no feed rate', () => {
    const result = estimateCycleTime([linear(100, null, 7)], 0, {
      rapidRateMmPerMin: 6000,
    });

    expect(result.seconds).toBeNull();
    expect(result.reasons).toContain('Feed rate missing on line 7.');
  });

  it('does not treat G95 feed-per-revolution as mm/min', () => {
    const move = { ...linear(100, 0.2, 12), feedMode: 'G95' as const };
    const result = estimateCycleTime([move], 0, {
      rapidRateMmPerMin: 6000,
    });

    expect(result.seconds).toBeNull();
    expect(result.reasons).toContain(
      'Cycle time is unavailable for G95 feed on line 12.',
    );
  });

  it('uses sampled arc length for feed time', () => {
    const move: Move = {
      kind: 'arc',
      from: pose(0, 0, 0),
      to: pose(10, 10, 0),
      plane: 'XY',
      clockwise: false,
      center: [0, 10],
      feed: 100,
      feedMode: 'G94',
      line: 4,
    };

    const result = estimateCycleTime([move], 0, {
      rapidRateMmPerMin: 6000,
    });

    expect(result.seconds).toBeGreaterThan(9);
    expect(result.seconds).toBeLessThan(10);
  });

  it('approximates a canned cycle from its R plane, depth and feed', () => {
    const move: Move = {
      kind: 'canned-cycle',
      code: 'G81',
      from: pose(0, 0, 25),
      at: pose(10, 20, -5),
      z: -5,
      r: 2,
      feed: 1000,
      feedMode: 'G94',
      line: 9,
    };

    const result = estimateCycleTime([move], 0, {
      rapidRateMmPerMin: 6000,
    });

    expect(result.approximateCycles).toBe(true);
    expect(result.breakdown.cycle).toBeGreaterThan(0.87);
    expect(result.breakdown.cycle).toBeLessThan(0.88);
    expect(result.reasons).toEqual([]);
  });

  it('adds peck retractions for peck cycles', () => {
    const move: Move = {
      kind: 'canned-cycle',
      code: 'G83',
      from: pose(0, 0, 25),
      at: pose(0, 0, -5),
      z: -5,
      r: 2,
      q: 3,
      feed: 1000,
      feedMode: 'G94',
      line: 11,
    };

    const withPeck = estimateCycleTime([move], 0, {
      rapidRateMmPerMin: 6000,
    });
    const withoutPeck = estimateCycleTime(
      [{ ...move, q: undefined }],
      0,
      { rapidRateMmPerMin: 6000 },
    );

    expect(withPeck.breakdown.cycle).toBeGreaterThan(
      withoutPeck.breakdown.cycle,
    );
  });
});
