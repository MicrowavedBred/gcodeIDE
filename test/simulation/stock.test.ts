import { describe, expect, it } from 'vitest';
import { analyzeProgram } from '../../src/app/analysis';
import { evaluateProgram } from '../../src/core/gcode/modal';
import { parseProgram } from '../../src/core/gcode/parser';
import { buildToolpath } from '../../src/core/interpreter/toolpath';
import {
  simulateStock,
  type StockConfig,
  type StockSimulation,
} from '../../src/core/simulation/stock';
import { brotherProfile } from '../../src/core/profiles/builtin/brother';
import type { Move } from '../../src/core/gcode/modal';

const bounds = {
  min: { x: -10, y: -10, z: -5 },
  max: { x: 10, y: 10, z: 0 },
};
const config: StockConfig = { bounds, toolDiameterMm: 4, resolution: 80 };

function linear(
  from: { x: number; y: number; z: number },
  to: { x: number; y: number; z: number },
  kind: 'rapid' | 'linear' = 'linear',
): Move {
  return { kind, from, to, feed: 100, line: 1 };
}

function simulate(moves: Move[]): StockSimulation {
  return simulateStock(
    { moves, bounds: null, counts: { rapid: 0, linear: 0, arc: 0, cycle: 0 }, lengthsMm: { rapid: 0, linear: 0, arc: 0, cycle: 0, total: 0 } },
    config,
  );
}

describe('stock height map', () => {
  it('initialises the full stock volume and reports void outside it', () => {
    const simulation = simulate([]);
    expect(simulation.columns).toBe(simulation.rows);
    expect(simulation.initialVolumeMm3).toBeCloseTo(20 * 20 * 5, 3);
    expect(simulation.remainingVolumeMm3).toBeCloseTo(2000, 3);
    expect(simulation.heightAt(0, 0)).toBe(0);
    expect(simulation.heightAt(11, 0)).toBeNull();
  });

  it('removes material only along cutting moves', () => {
    const rapid = linear({ x: -5, y: 0, z: -2 }, { x: 5, y: 0, z: -2 }, 'rapid');
    const rapidOnly = simulate([rapid]);
    expect(rapidOnly.remainingVolumeMm3).toBeCloseTo(2000, 3);
    expect(rapidOnly.penetrationByMove.get(rapid)?.depthMm).toBeCloseTo(2, 3);

    const cutting = linear({ x: -5, y: 0, z: -2 }, { x: 5, y: 0, z: -2 });
    const cut = simulate([rapid, cutting]);
    expect(cut.remainingVolumeMm3).toBeLessThan(rapidOnly.remainingVolumeMm3);
    expect(cut.heightAt(0, 0)).toBeCloseTo(-2, 3);
    expect(cut.heightAt(0, 8)).toBe(0);
  });

  it('captures penetration at the time of the rapid, not from the final height map', () => {
    const cutting = linear({ x: -15, y: 0, z: -2 }, { x: 15, y: 0, z: -2 });
    const unsafeRapid = linear(
      { x: -15, y: 0, z: -1 },
      { x: 15, y: 0, z: -1 },
      'rapid',
    );
    const safeRapid = linear(
      { x: -15, y: 5, z: -1 },
      { x: 15, y: 5, z: -1 },
      'rapid',
    );

    const beforeCut = simulate([unsafeRapid, cutting]);
    expect(beforeCut.penetrationByMove.get(unsafeRapid)?.depthMm).toBeCloseTo(1, 3);

    const afterCut = simulate([cutting, unsafeRapid]);
    expect(afterCut.penetrationByMove.has(unsafeRapid)).toBe(false);
    expect(afterCut.penetrationByMove.has(safeRapid)).toBe(false);
  });

  it('removes material for canned cycles', () => {
    const toolpath = buildToolpath(
      evaluateProgram(
        parseProgram('G21 G90 G0 X0 Y0\nG81 X0 Y0 Z-3 R2 F100\nM30', 'cycle.nc'),
        brotherProfile(),
      ),
    );
    const simulation = simulateStock(toolpath, config);
    expect(simulation.remainingVolumeMm3).toBeLessThan(2000);
    expect(simulation.heightAt(0, 0)).toBeCloseTo(-3, 3);
  });
});

describe('stock-aware diagnostics', () => {
  it('flags a low rapid crossing stock even when both endpoints are outside', () => {
    const result = analyzeProgram(
      'G21 G90 G0 X-15 Y0 Z-1\nG0 X15 Y0\nM30',
      'rapid.nc',
      brotherProfile(),
      [],
      { stock: config },
    );
    expect(result.simulation).not.toBeNull();
    const diagnostics = result.diagnostics.filter(
      (diagnostic) => diagnostic.ruleId === 'rapid-through-stock',
    );
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics.every((item) => item.message.includes('below remaining stock'))).toBe(true);
    expect(diagnostics.map((item) => item.span.line)).toEqual([1, 2]);
  });

  it('does not flag a rapid through a pocket already cut to a lower depth', () => {
    const result = analyzeProgram(
      [
        'G21 G90 G0 X-15 Y0 Z5',
        'G0 Z-2',
        'G1 X15 Y0 F100',
        'G0 Z-1',
        'G0 X-15 Y0',
        'M30',
      ].join('\n'),
      'pocket.nc',
      brotherProfile(),
      [],
      { stock: config },
    );
    expect(
      result.diagnostics.some(
        (diagnostic) => diagnostic.ruleId === 'rapid-through-stock',
      ),
    ).toBe(false);
  });

  it('activates the safe-Z rule only when configured', () => {
    const source = 'G21 G90 G0 X0 Y0 Z50\nG0 Z1\nM30';
    expect(
      analyzeProgram(source, 'safe.nc', brotherProfile()).diagnostics.some(
        (diagnostic) => diagnostic.ruleId === 'unsafe-z-clearance',
      ),
    ).toBe(false);
    expect(
      analyzeProgram(source, 'safe.nc', brotherProfile(), [], { safeZ: 5 })
        .diagnostics.some(
          (diagnostic) => diagnostic.ruleId === 'unsafe-z-clearance',
        ),
    ).toBe(true);
  });
});
