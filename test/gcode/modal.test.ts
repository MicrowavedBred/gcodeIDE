import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  applyBlock,
  evaluateProgram,
  initialMachineState,
  type MachineState,
} from '../../src/core/gcode/modal';
import { parseLine, parseProgram } from '../../src/core/gcode/parser';
import { builtinUserPreferences } from '../../src/core/profiles/builtin';
import {
  brotherProfile,
  brotherSpeedioFlavor,
} from '../../src/core/profiles/builtin/brother';
import { cloneFlavor } from '../../src/core/profiles/custom-flavors';
import { resolveProfile } from '../../src/core/profiles/types';

const profile = brotherProfile();
const corpusDir = fileURLToPath(
  new URL('../../cnc programs/Brother/', import.meta.url),
);

function apply(
  line: string,
  state: MachineState = initialMachineState(profile),
): ReturnType<typeof applyBlock> {
  const { block } = parseLine(line, 'test.nc', 1, 0);
  return applyBlock(state, block, profile);
}

describe('modal state transitions', () => {
  it('tracks motion, units, and absolute positions', () => {
    const result = apply('G21 G90 G0 X10 Y20 Z5');
    expect(result.state.modal.motion).toBe('G0');
    expect(result.state.modal.units).toBe('mm');
    expect(result.state.position.x).toBe(10);
    expect(result.state.position.y).toBe(20);
    expect(result.state.position.z).toBe(5);
    expect(result.events[0]?.kind).toBe('move');
  });

  it('converts inch programs to millimetres', () => {
    const result = apply('G20 G0 X1');
    expect(result.state.position.x).toBeCloseTo(25.4);
    expect(result.state.modal.units).toBe('inch');
  });

  it('applies incremental distance', () => {
    const first = apply('G90 G0 X5');
    const second = apply('G91 G1 X10 F100', first.state);
    expect(second.state.position.x).toBe(15);
    expect(second.state.feed).toBe(100);
  });

  it('commits tool changes', () => {
    const result = apply('T01 M6');
    expect(result.state.tool.active).toBe(1);
    expect(result.events.some((event) => event.kind === 'tool-change')).toBe(true);
  });

  it('sets extended work offsets with G10 L20', () => {
    const result = apply('G10 L20 P4 X-56.47 Y-259.453 Z300.2 A0');
    const offset = result.state.offsets['G54.1 P4'];
    expect(offset?.translation.x).toBeCloseTo(-56.47);
    expect(offset?.translation.y).toBeCloseTo(-259.453);
    expect(offset?.translation.z).toBeCloseTo(300.2);
  });

  it('selects extended offsets', () => {
    const result = apply('G54.1 P4');
    expect(result.state.modal.workOffsetCode).toBe('G54.1 P4');
  });

  it('applies G52 translation to machine coordinates', () => {
    const first = apply('G52 X10 Y5');
    const second = apply('G0 X0 Y0', first.state);
    expect(second.state.machinePosition.x).toBe(10);
    expect(second.state.machinePosition.y).toBe(5);
  });

  it('applies G68 rotation to machine coordinates', () => {
    const first = apply('G68 X0 Y0 R90');
    const second = apply('G0 X10 Y0', first.state);
    expect(second.state.machinePosition.x).toBeCloseTo(0);
    expect(second.state.machinePosition.y).toBeCloseTo(10);
  });

  it('emits canned-cycle moves', () => {
    const result = apply('G98 G81 X10 Y20 Z-5 R2 F100');
    const move = result.events.find(
      (event) => event.kind === 'move' && event.move.kind === 'canned-cycle',
    );
    expect(move).toBeDefined();
    if (move?.kind === 'move' && move.move.kind === 'canned-cycle') {
      expect(move.move.code).toBe('G81');
      expect(move.move.z).toBe(-5);
      expect(move.move.r).toBe(2);
      expect(move.move.feed).toBe(100);
    }
  });

  it('recognises custom M-codes', () => {
    const result = apply('M400');
    expect(result.events.some((event) => event.kind === 'custom-mcode')).toBe(true);
  });

  it('warns on unknown M-codes', () => {
    const result = apply('M499');
    expect(result.diagnostics[0]?.ruleId).toBe('unknown-custom-mcode');
  });

  it('uses a user-defined M-code description from a custom profile', () => {
    const clone = cloneFlavor(
      brotherSpeedioFlavor,
      'brother-unspecified',
      'user-brother-mcode',
      'Shop Brother',
    );
    if (!clone) throw new Error('expected a clone');
    clone.customMCodes = {
      M777: {
        code: 'M777',
        description: 'Fixture clamp release',
        category: 'clamp',
        affectsSimulation: false,
      },
    };
    const customProfile = resolveProfile(
      clone,
      clone.variants[0],
      builtinUserPreferences,
    );
    const { block } = parseLine('M777', 'test.nc', 1, 0);
    const result = applyBlock(
      initialMachineState(customProfile),
      block,
      customProfile,
    );

    expect(result.events.find((event) => event.kind === 'custom-mcode')).toMatchObject({
      code: 'M777',
      description: 'Fixture clamp release',
    });
    expect(
      result.diagnostics.some(
        (diagnostic) => diagnostic.ruleId === 'unknown-custom-mcode',
      ),
    ).toBe(false);
  });
});

describe('macro control flow', () => {
  it('jumps on a true IF condition', () => {
    const program = parseProgram(
      [
        'N10 G0 X1',
        'IF[#3700 EQ 28] GOTO 20',
        'G0 X999',
        'N20 G0 X2',
        'M30',
      ].join('\n'),
      'macro.nc',
    );
    const result = evaluateProgram(program, profile);
    expect(result.blockStates.map((state) => state.block.line)).toEqual([1, 2, 4, 5]);
    expect(result.blockStates[2]?.after.position.x).toBe(2);
  });

  it('raises #3000 alarms', () => {
    const program = parseProgram('#3000=1(SET TOOL 28)\nM30', 'alarm.nc');
    const result = evaluateProgram(program, profile);
    expect(
      result.diagnostics.some(
        (diagnostic) =>
          diagnostic.ruleId === 'macro-alarm' &&
          diagnostic.message === 'SET TOOL 28',
      ),
    ).toBe(true);
  });
});

describe('Brother corpus evaluation', () => {
  it('evaluates O1801.NC without errors', () => {
    const text = readFileSync(join(corpusDir, 'O1801.NC'), 'utf8');
    const program = parseProgram(text, 'O1801.NC');
    const result = evaluateProgram(program, profile);
    const errors = result.diagnostics.filter(
      (diagnostic) => diagnostic.severity === 'error',
    );
    expect(errors, JSON.stringify(errors.slice(0, 5))).toEqual([]);
    expect(result.blockStates.length).toBeGreaterThan(100);
    expect(result.events.some((event) => event.kind === 'tool-change')).toBe(true);
    expect(
      result.events.some(
        (event) => event.kind === 'move' && event.move.kind === 'canned-cycle',
      ),
    ).toBe(true);
  });
});
