import { describe, expect, it } from 'vitest';
import { lexLine } from '../../src/core/gcode/lexer';

const words = (line: string): string[] =>
  lexLine(line, 'test.nc', 1)
    .tokens.filter((token) => token.type === 'word')
    .map((token) => token.raw);

describe('lexLine', () => {
  it('splits compact words', () => {
    expect(words('G0X0Y0')).toEqual(['G0', 'X0', 'Y0']);
    expect(words('T28M6')).toEqual(['T28', 'M6']);
    expect(words('M3S6000')).toEqual(['M3', 'S6000']);
    expect(words('G4X1')).toEqual(['G4', 'X1']);
  });

  it('preserves decimal codes', () => {
    expect(words('G54.1P4')).toEqual(['G54.1', 'P4']);
    expect(words('G10G90L10P1R213.720')).toEqual([
      'G10',
      'G90',
      'L10',
      'P1',
      'R213.720',
    ]);
  });

  it('ignores code-like text inside comments', () => {
    expect(words('(FG5) G81 X-0.05 Y-0.02 Z-37.3 R10 F800')).toEqual([
      'G81',
      'X-0.05',
      'Y-0.02',
      'Z-37.3',
      'R10',
      'F800',
    ]);
  });

  it('handles signed and leading-dot numbers', () => {
    expect(words('G1 Z-.18')).toEqual(['G1', 'Z-.18']);
    expect(words('G01 Z0. F371')).toEqual(['G01', 'Z0.', 'F371']);
    expect(words('A-90')).toEqual(['A-90']);
  });

  it('tokenises macro lines', () => {
    const ifLine = lexLine('IF[#3700 EQ 28] GOTO 10', 'test.nc', 1);
    expect(ifLine.tokens.map((token) => token.type)).toEqual([
      'identifier',
      'bracket-open',
      'variable',
      'identifier',
      'number',
      'bracket-close',
      'identifier',
      'number',
    ]);
    expect(ifLine.tokens[0].raw).toBe('IF');
    expect(ifLine.tokens[2].value).toBe(3700);
    expect(ifLine.tokens[7].value).toBe(10);

    const alarmLine = lexLine('#3000=1(SET TOOL 28)', 'test.nc', 1);
    expect(alarmLine.tokens.map((token) => token.type)).toEqual([
      'variable',
      'operator',
      'number',
      'comment',
    ]);
    expect(alarmLine.tokens[0].value).toBe(3000);
    expect(alarmLine.tokens[3].raw).toBe('(SET TOOL 28)');
  });

  it('tokenises percent markers', () => {
    expect(lexLine('%', 'test.nc', 1).tokens[0].type).toBe('percent');
  });
});
