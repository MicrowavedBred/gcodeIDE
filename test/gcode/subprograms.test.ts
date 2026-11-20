import { describe, expect, it } from 'vitest';
import { evaluateProgram } from '../../src/core/gcode/modal';
import { parseProgram } from '../../src/core/gcode/parser';
import {
  brotherProfile,
  brotherSpeedioFlavor,
  brotherUnspecifiedVariant,
} from '../../src/core/profiles/builtin/brother';
import { defaultUserPreferences } from '../../src/core/profiles/builtin/brother';
import { resolveProfile } from '../../src/core/profiles/types';

const profile = brotherProfile();

describe('subprogram execution', () => {
  it('calls, executes and returns from a local O-number', () => {
    const program = parseProgram(
      [
        'G21 G90 G0 X0',
        'M98 P1000',
        'G0 X30',
        'M30',
        '',
        'O1000',
        'G0 X10',
        'M99',
      ].join('\n'),
      'call.nc',
    );
    const result = evaluateProgram(program, profile);
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(result.blockStates.map((state) => state.block.line)).toEqual([
      1, 2, 7, 8, 3, 4,
    ]);
    expect(result.events.some((event) => event.kind === 'subprogram-call')).toBe(
      true,
    );
    expect(result.events.some((event) => event.kind === 'subprogram-return')).toBe(
      true,
    );
    expect(result.blockStates[5]?.after.position.x).toBe(30);
  });

  it('repeats a subprogram L times', () => {
    const program = parseProgram(
      [
        'G21 G90 G0 X0',
        'M98 P1000 L2',
        'G91 G0 X5',
        'M30',
        'O1000',
        'G91 G0 X5',
        'G90',
        'M99',
      ].join('\n'),
      'repeat.nc',
    );
    const result = evaluateProgram(program, profile);
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(
      result.blockStates.filter((state) => state.block.line === 6),
    ).toHaveLength(2);
    expect(result.blockStates[result.blockStates.length - 1]?.after.position.x).toBe(
      15,
    );
  });

  it('resolves subprograms in a program set', () => {
    const main = parseProgram('G21 G90 G0 X0\nM98 P2000\nM30', 'main.nc');
    const sub = parseProgram('O2000\nG0 X10\nM99', 'sub.nc');
    const result = evaluateProgram({ main, subprograms: [sub] }, profile);
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(
      result.events.find((event) => event.kind === 'subprogram-call'),
    ).toMatchObject({ number: 2000, file: 'sub.nc' });
    expect(result.blockStates.find((s) => s.block.file === 'sub.nc')).toBeDefined();
  });

  it('supports nested calls', () => {
    const program = parseProgram(
      [
        'G21 G90 G0 X0',
        'M98 P1000',
        'M30',
        'O1000',
        'G0 X10',
        'M98 P2000',
        'M99',
        'O2000',
        'G0 X20',
        'M99',
      ].join('\n'),
      'nested.nc',
    );
    const result = evaluateProgram(program, profile);
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(
      result.events.filter((event) => event.kind === 'subprogram-call'),
    ).toHaveLength(2);
  });

  it('reports a missing subprogram', () => {
    const program = parseProgram('M98 P9999\nM30', 'missing.nc');
    const result = evaluateProgram(program, profile);
    expect(
      result.diagnostics.some((d) => d.ruleId === 'missing-subprogram'),
    ).toBe(true);
  });

  it('enforces the flavor depth limit', () => {
    const shallowProfile = resolveProfile(
      {
        ...brotherSpeedioFlavor,
        dialect: {
          ...brotherSpeedioFlavor.dialect,
          subprograms: {
            ...brotherSpeedioFlavor.dialect.subprograms,
            maxDepth: 2,
          },
        },
      },
      brotherUnspecifiedVariant,
      defaultUserPreferences,
    );
    const program = parseProgram(
      [
        'M98 P1000',
        'M30',
        'O1000',
        'M98 P2000',
        'M99',
        'O2000',
        'M99',
      ].join('\n'),
      'deep.nc',
    );
    const result = evaluateProgram(program, shallowProfile);
    expect(
      result.diagnostics.some(
        (d) => d.ruleId === 'subprogram-depth-exceeded',
      ),
    ).toBe(true);
  });

  it('treats top-level M99 as program end', () => {
    const program = parseProgram(
      'G21 G90 G0 X0\nM99\nG0 X10\nM30',
      'top-m99.nc',
    );
    const result = evaluateProgram(program, profile);
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(result.blockStates.map((state) => state.block.line)).toEqual([1, 2]);
    expect(result.blockStates[1]?.after.position.x).toBe(0);
  });
});
