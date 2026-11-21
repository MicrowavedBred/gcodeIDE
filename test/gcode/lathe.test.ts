import { describe, expect, it } from 'vitest';
import {
  applyBlock,
  evaluateProgram,
  initialMachineState,
  type MachineState,
} from '../../src/core/gcode/modal';
import { parseLine, parseProgram } from '../../src/core/gcode/parser';
import {
  fanucLatheFlavor,
  fanucLatheProfile,
  fanucLatheUnspecifiedVariant,
  fanucProfile,
} from '../../src/core/profiles/builtin';
import { resolveProfile } from '../../src/core/profiles/types';
import { runRules } from '../../src/core/rules/engine';

const latheProfile = fanucLatheProfile();
const millProfile = fanucProfile();

function apply(
  line: string,
  profile = latheProfile,
  state: MachineState = initialMachineState(profile),
): ReturnType<typeof applyBlock> {
  const { block } = parseLine(line, 'lathe.nc', 1, 0);
  return applyBlock(state, block, profile);
}

describe('lathe axis semantics', () => {
  it('stores diameter-programmed X as an internal radius in millimetres', () => {
    const result = apply('G21 G90 G0 X50');
    expect(result.state.position.x).toBe(25);
    expect(result.state.position.y).toBe(0);
  });

  it('converts inch diameter X through millimetres before halving', () => {
    const result = apply('G20 G90 G0 X2');
    expect(result.state.position.x).toBeCloseTo(25.4);
  });

  it('treats U as incremental diameter and W as incremental Z regardless of G90/G91', () => {
    const first = apply('G21 G90 G0 X50 Z-10');
    expect(first.state.position.x).toBe(25);
    expect(first.state.position.z).toBe(-10);

    const second = apply('G90 G1 U10 W-5 F100', latheProfile, first.state);
    expect(second.state.position.x).toBe(30);
    expect(second.state.position.z).toBe(-15);
    expect(second.events.some((event) => event.kind === 'move')).toBe(true);
  });

  it('halves incremental X words in G91 mode', () => {
    const first = apply('G21 G90 G0 X50');
    const second = apply('G91 G0 X10', latheProfile, first.state);
    expect(second.state.position.x).toBe(30);
  });

  it('emits a move for a U/W-only block', () => {
    const result = apply('G21 G90 G1 U20 W-2 F0.2');
    const moves = result.events.filter((event) => event.kind === 'move');
    expect(moves).toHaveLength(1);
    expect(result.state.position.x).toBe(10);
    expect(result.state.position.z).toBe(-2);
  });
});

describe('lathe axes on mill flavors', () => {
  it('warns and ignores U/W', () => {
    const result = apply('G21 G90 G0 U10 W-5', millProfile);
    expect(result.diagnostics.map((entry) => entry.ruleId)).toEqual([
      'unsupported-lathe-axis',
      'unsupported-lathe-axis',
    ]);
    expect(result.state.position.x).toBe(0);
    expect(result.state.position.z).toBe(0);
  });

  it('does not change existing mill axis handling', () => {
    const result = apply('G21 G90 G0 X10 Y20 Z5', millProfile);
    expect(result.state.position.x).toBe(10);
    expect(result.state.position.y).toBe(20);
    expect(result.state.position.z).toBe(5);
  });
});

describe('constant surface speed', () => {
  it('populates the RPM ceiling from the flavor spindle range', () => {
    expect(initialMachineState(latheProfile).spindle.maxRpm).toBe(4000);
  });

  it('computes clamped RPM from surface speed and current diameter', () => {
    const positioned = apply('G21 G90 G0 X50');
    const css = apply('G96 S100', latheProfile, positioned.state);
    expect(css.state.spindle.css).toBe(100);
    expect(css.state.spindle.rpm).toBeCloseTo(100000 / (Math.PI * 50));
    expect(css.state.modal.spindleMode).toBe('css');
  });

  it('clamps CSS RPM to maxRpm', () => {
    const positioned = apply('G21 G90 G0 X50');
    const css = apply('G96 S1000', latheProfile, positioned.state);
    expect(css.state.spindle.rpm).toBe(4000);
  });

  it('clamps to maxRpm at zero diameter instead of dividing by zero', () => {
    const css = apply('G21 G90 G96 S100');
    expect(css.state.spindle.rpm).toBe(4000);
  });

  it('restores direct RPM on G97', () => {
    const css = apply('G21 G90 G96 S100');
    const rpm = apply('G97 S500', latheProfile, css.state);
    expect(rpm.state.modal.spindleMode).toBe('rpm');
    expect(rpm.state.spindle.css).toBeNull();
    expect(rpm.state.spindle.rpm).toBe(500);
  });

  it('reports CSS without a finite RPM limit as a rules diagnostic', () => {
    const unlimitedProfile = resolveProfile(
      {
        ...fanucLatheFlavor,
        dialect: {
          ...fanucLatheFlavor.dialect,
          spindle: { rpmRange: [0, Infinity], cssSupported: true },
        },
      },
      fanucLatheUnspecifiedVariant,
      { defaultUnits: 'mm', defaultVariantByFlavor: {} },
    );
    const program = parseProgram('G21 G90 G96 S100 M3\nM30', 'lathe.nc');
    const evaluation = evaluateProgram(program, unlimitedProfile);
    const diagnostics = runRules({ profile: unlimitedProfile, program, evaluation });
    expect(diagnostics.map((entry) => entry.ruleId)).toEqual([
      'lathe-css-without-rpm-limit',
    ]);
  });
});

describe('lathe evaluation pipeline', () => {
  it('evaluates a synthetic lathe program without diagnostics', () => {
    const program = parseProgram(
      ['G21 G90 G18', 'T0101', 'G96 S100 M3', 'G0 X50 Z2', 'G1 Z-20 F0.2', 'G0 X60', 'G97 S500', 'M30'].join('\n'),
      'lathe.nc',
    );
    const evaluation = evaluateProgram(program, latheProfile);
    expect(program.diagnostics).toEqual([]);
    expect(evaluation.diagnostics).toEqual([]);
    const last = evaluation.blockStates[evaluation.blockStates.length - 1];
    expect(last?.after.position.x).toBe(30);
    expect(last?.after.position.z).toBe(-20);
  });
});
