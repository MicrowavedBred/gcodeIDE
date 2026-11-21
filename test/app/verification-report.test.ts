import { describe, expect, it } from 'vitest';
import { analyzeProgram } from '../../src/app/analysis';
import {
  buildVerificationReport,
  formatDuration,
} from '../../src/app/verification-report';
import { estimateCycleTime } from '../../src/core/simulation/cycle-time';
import { builtinProfile } from '../../src/core/profiles/builtin';

const profile = builtinProfile('haas-mill', 'haas-vf2')!;

const program = `G21 G90
G0 X0 Y0 Z25
G81 X10 Y0 Z-5 R2 F1000
M30
`;

function reportFor(source: string, rate: number | null) {
  const analysis = analyzeProgram(source, 'test.nc', profile);
  const dwellSeconds = analysis.evaluation.events.reduce(
    (sum, event) => sum + (event.kind === 'dwell' ? event.seconds : 0),
    0,
  );
  const cycleTime = estimateCycleTime(analysis.toolpath.moves, dwellSeconds, {
    rapidRateMmPerMin: rate,
  });
  return buildVerificationReport({
    fileName: 'test.nc',
    flavorName: profile.flavor.name,
    variantName: profile.variant.name,
    analysis,
    cycleTime,
  });
}

describe('buildVerificationReport', () => {
  it('summarises the program, cycle time and diagnostics', () => {
    const report = reportFor(program, profile.variant.geometry.rapidRate ?? null);

    expect(report).toContain('# Verification report');
    expect(report).toContain('- Program: test.nc');
    expect(report).toContain('- Machine: Haas Mill / VF-2');
    expect(report).toContain('- Blocks:');
    expect(report).toContain('- Cycle time:');
    expect(report).toContain('Canned-cycle time is approximated');
  });

  it('explains an unavailable estimate', () => {
    const report = reportFor(program, null);

    expect(report).toContain(
      'Rapid rate is not configured for this variant.',
    );
  });

  it('formats seconds as minutes and seconds', () => {
    expect(formatDuration(65)).toBe('1m 5s');
    expect(formatDuration(8)).toBe('8s');
  });
});
