import { describe, expect, it } from 'vitest';
import { analyzeProgram } from '../../src/app/analysis';
import { grblProfile } from '../../src/core/profiles/builtin';

describe('analyzeProgram', () => {
  it('merges modal and policy diagnostics without duplicates', () => {
    const result = analyzeProgram(
      'G21 G90 G81 X0 Y0 Z-5 R2 F100',
      'test.nc',
      grblProfile(),
    );

    const ruleIds = result.diagnostics.map((diagnostic) => diagnostic.ruleId);
    expect(ruleIds).toContain('unsupported-code');
    expect(ruleIds).toContain('missing-program-end');
    expect(new Set(ruleIds).size).toBe(ruleIds.length);
    expect(result.evaluation.blockStates.length).toBeGreaterThan(0);
  });

  it('reports a clean program with no diagnostics', () => {
    const result = analyzeProgram(
      'G21 G17 G90 G94\nG54\nG0 X0 Y0\nM30\n',
      'clean.nc',
      grblProfile(),
    );
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('collects move events in execution order', () => {
    const result = analyzeProgram(
      'G21 G90 G0 X0 Y0\nG1 X10 F100\nG81 X10 Y0 Z-5 R2 F100\nM30',
      'moves.nc',
      grblProfile(),
    );
    const moves = result.toolpath.moves;
    expect(moves.map((move) => move.kind)).toEqual([
      'rapid',
      'linear',
      'canned-cycle',
    ]);
  });
});
