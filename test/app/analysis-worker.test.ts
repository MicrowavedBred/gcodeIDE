import { describe, expect, it } from 'vitest';
import { analyzeProgram } from '../../src/app/analysis';
import { analyzeProgramAsync } from '../../src/app/analysis-worker-client';
import {
  restoreStockSimulation,
  serializeStockSimulation,
  simulateStock,
  type StockConfig,
} from '../../src/core/simulation/stock';
import { grblProfile } from '../../src/core/profiles/builtin';
import type { Move } from '../../src/core/gcode/modal';

const bounds = {
  min: { x: -10, y: -10, z: -5 },
  max: { x: 10, y: 10, z: 0 },
};
const config: StockConfig = { bounds, toolDiameterMm: 4, resolution: 80 };
const profile = grblProfile();

function linear(
  from: { x: number; y: number; z: number },
  to: { x: number; y: number; z: number },
  kind: 'rapid' | 'linear' = 'linear',
): Move {
  return { kind, from, to, feed: 100, line: 1 };
}

const unsafeRapid = linear(
  { x: -15, y: 0, z: -1 },
  { x: 15, y: 0, z: -1 },
  'rapid',
);
const cutting = linear({ x: -15, y: 0, z: -2 }, { x: 15, y: 0, z: -2 });
const moves = [unsafeRapid, cutting];

describe('stock simulation worker payload', () => {
  it('round-trips heights, volumes and move-identity penetration through structured clone', () => {
    const source = simulateStock({ moves }, config);
    const serialized = serializeStockSimulation(source, moves);
    const cloned = structuredClone(serialized);
    const restored = restoreStockSimulation(cloned, moves);

    expect(restored.heights).toEqual(source.heights);
    expect(restored.initialVolumeMm3).toBe(source.initialVolumeMm3);
    expect(restored.remainingVolumeMm3).toBe(source.remainingVolumeMm3);
    expect(restored.heightAt(0, 0)).toBe(source.heightAt(0, 0));
    expect(restored.penetrationByMove.get(unsafeRapid)?.depthMm).toBeCloseTo(
      source.penetrationByMove.get(unsafeRapid)!.depthMm,
      3,
    );
    expect(restored.penetrationByMove.has(cutting)).toBe(false);
  });
});

describe('analyzeProgramAsync', () => {
  const text = 'G21 G90 G0 X0 Y0\nG1 Z-2 F100\nG0 X0 Y0 Z-3\nM30\n';

  it('matches the synchronous analysis when workers are unavailable', async () => {
    const options = { stock: config, safeZ: 5 };
    const sync = analyzeProgram(text, 'async.nc', profile, [], options);
    const asyncResult = await analyzeProgramAsync(text, 'async.nc', profile, [], options);

    expect(asyncResult.diagnostics).toEqual(sync.diagnostics);
    expect(asyncResult.toolpath.moves).toEqual(sync.toolpath.moves);
    expect(asyncResult.simulation).not.toBeNull();
    expect(asyncResult.simulation!.heights).toEqual(sync.simulation!.heights);
    expect(asyncResult.simulation!.remainingVolumeMm3).toBe(
      sync.simulation!.remainingVolumeMm3,
    );
  });

  it('returns no simulation when stock is disabled', async () => {
    const result = await analyzeProgramAsync(text, 'async.nc', profile);
    expect(result.simulation).toBeNull();
    expect(result.toolpath.moves.length).toBeGreaterThan(0);
  });
});
