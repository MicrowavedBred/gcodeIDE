import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { evaluateProgram } from '../../src/core/gcode/modal';
import { parseProgram } from '../../src/core/gcode/parser';
import { brotherProfile } from '../../src/core/profiles/builtin/brother';

const profile = brotherProfile();
const corpusDir = fileURLToPath(
  new URL('../../cnc programs/Brother/', import.meta.url),
);

/**
 * Golden execution counts. When the modal engine changes semantics these
 * numbers move, which is the point: update them only after confirming the
 * new trace is correct.
 */
const expected: Record<string, { executed: number; moves: number }> = {
  'O1801.NC': { executed: 250, moves: 134 },
  'O3690.NC': { executed: 205, moves: 108 },
  'O3692.NC': { executed: 246, moves: 130 },
  'O3856.NC': { executed: 154, moves: 53 },
  'O3991.NC': { executed: 904, moves: 670 },
  'O4697.NC': { executed: 747, moves: 392 },
  'O5012.NC': { executed: 534, moves: 357 },
  'O6010.NC': { executed: 93, moves: 40 },
  'O7963.NC': { executed: 294, moves: 165 },
  'OFFSET.OFS': { executed: 266, moves: 0 },
};

describe('Brother corpus evaluation', () => {
  const files = readdirSync(corpusDir)
    .filter((name) => /\.(nc|ofs)$/i.test(name))
    .sort();

  it('covers every corpus program', () => {
    expect(files).toEqual(Object.keys(expected).sort());
  });

  for (const file of files) {
    it(`evaluates ${file} to its golden trace`, () => {
      const text = readFileSync(join(corpusDir, file), 'utf8');
      const program = parseProgram(text, file);
      const result = evaluateProgram(program, profile);

      const errors = result.diagnostics.filter(
        (diagnostic) => diagnostic.severity === 'error',
      );
      expect(errors, JSON.stringify(errors.slice(0, 5))).toEqual([]);

      // Unconfigured tool-length inputs are the only expected warning; they
      // make control flow approximate but not invalid.
      const unexpected = result.diagnostics.filter(
        (diagnostic) =>
          diagnostic.severity === 'warning' &&
          diagnostic.ruleId !== 'unknown-system-variable',
      );
      expect(unexpected, JSON.stringify(unexpected.slice(0, 5))).toEqual([]);

      const hasUnknownVariables = result.diagnostics.some(
        (diagnostic) => diagnostic.ruleId === 'unknown-system-variable',
      );
      expect(result.approximate).toBe(hasUnknownVariables);

      expect({
        file,
        executed: result.blockStates.length,
        moves: result.events.filter((event) => event.kind === 'move').length,
      }).toEqual({ file, ...expected[file] });
    });
  }
});
