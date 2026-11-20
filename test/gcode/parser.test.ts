import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseLine, parseProgram } from '../../src/core/gcode/parser';

const corpusDir = fileURLToPath(
  new URL('../../cnc programs/Brother/', import.meta.url),
);

describe('parseLine', () => {
  it('captures sequence numbers, words, and comments', () => {
    const { block } = parseLine('N10 G0 X0 Y0 (start)', 'test.nc', 7, 0);
    expect(block.sequenceNumber).toBe(10);
    expect(block.words.map((word) => word.raw)).toEqual(['N10', 'G0', 'X0', 'Y0']);
    expect(block.comments).toEqual(['(start)']);
    expect(block.line).toBe(7);
  });

  it('classifies IF/GOTO lines', () => {
    const { block } = parseLine(
      'IF[#3700 EQ 28] GOTO 10 (IT TOOL 28, WORK)',
      'test.nc',
      11,
      0,
    );
    expect(block.macro?.kind).toBe('if-goto');
    if (block.macro?.kind === 'if-goto') {
      expect(block.macro.target).toBe(10);
    }
  });

  it('classifies #3000 alarms', () => {
    const { block } = parseLine('#3000=1(SET TOOL 28)', 'test.nc', 12, 0);
    expect(block.macro?.kind).toBe('alarm');
    if (block.macro?.kind === 'alarm') {
      expect(block.macro.variable).toBe(3000);
      expect(block.macro.value).toBe(1);
      expect(block.macro.message).toBe('SET TOOL 28');
    }
  });
});

describe('parseProgram', () => {
  it('keeps stable line and block indexes', () => {
    const program = parseProgram('G90\n\nG0 X0 Y0\nM30\n', 'test.nc');
    expect(program.blocks).toHaveLength(5);
    expect(program.blocks[2].line).toBe(3);
    expect(program.blocks[2].index).toBe(2);
  });

  it('parses every file in the Brother corpus without lexical errors', () => {
    const files = readdirSync(corpusDir).filter((name) =>
      /\.(nc|ofs)$/i.test(name),
    );
    expect(files.length).toBeGreaterThan(0);

    for (const name of files) {
      const text = readFileSync(join(corpusDir, name), 'utf8');
      const program = parseProgram(text, name);
      const errors = program.diagnostics.filter(
        (diagnostic) => diagnostic.severity === 'error',
      );
      expect(errors, `${name}: ${JSON.stringify(errors.slice(0, 3))}`).toEqual([]);
      expect(program.blocks.length).toBeGreaterThan(0);
    }
  });
});
