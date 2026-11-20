import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { evaluateProgram } from '../../src/core/gcode/modal';
import { parseProgram } from '../../src/core/gcode/parser';
import { builtinProfile } from '../../src/core/profiles/builtin';
import { ruleCatalog } from '../../src/core/rules/catalog';
import { runRules } from '../../src/core/rules/engine';

const fixtureDir = fileURLToPath(new URL('../fixtures/programs/', import.meta.url));
const testDir = fileURLToPath(new URL('../', import.meta.url));

interface NegativeCase {
  file: string;
  flavorId: string;
  ruleIds: string[];
}

/** Exact diagnostic lists move only when the diagnostic contract changes. */
const negativeCases: NegativeCase[] = [
  {
    file: 'negative_conflicting_modal.nc',
    flavorId: 'haas-mill',
    ruleIds: ['conflicting-modal-group'],
  },
  {
    file: 'negative_unsupported_g10.nc',
    flavorId: 'brother-speedio',
    ruleIds: ['unsupported-g10'],
  },
  {
    file: 'negative_invalid_rotation.nc',
    flavorId: 'fanuc-mill',
    ruleIds: ['invalid-rotation-parameters'],
  },
  {
    file: 'negative_missing_motion_mode.nc',
    flavorId: 'haas-mill',
    ruleIds: ['missing-motion-mode'],
  },
  {
    file: 'negative_motion_cancelled.nc',
    flavorId: 'haas-mill',
    ruleIds: ['motion-cancelled'],
  },
  {
    file: 'negative_invalid_macro_target.nc',
    flavorId: 'haas-mill',
    ruleIds: ['invalid-macro-target'],
  },
  {
    file: 'negative_missing_label.nc',
    flavorId: 'haas-mill',
    ruleIds: ['missing-label'],
  },
  {
    file: 'negative_invalid_macro_condition.nc',
    flavorId: 'haas-mill',
    ruleIds: ['invalid-macro-condition'],
  },
  {
    file: 'negative_macro_iteration_limit.nc',
    flavorId: 'haas-mill',
    ruleIds: ['macro-iteration-limit', 'missing-program-end'],
  },
  {
    file: 'negative_missing_tool.nc',
    flavorId: 'haas-mill',
    ruleIds: ['missing-tool'],
  },
];

function analyze(file: string, flavorId: string) {
  const profile = builtinProfile(flavorId);
  if (!profile) throw new Error(`Unknown built-in flavor: ${flavorId}`);
  const program = parseProgram(readFileSync(join(fixtureDir, file), 'utf8'), file);
  const evaluation = evaluateProgram(program, profile);
  return { program, evaluation, diagnostics: runRules({ profile, program, evaluation }) };
}

function testSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return testSources(path);
    return entry.name.endsWith('.test.ts') ? [readFileSync(path, 'utf8')] : [];
  });
}

describe('synthetic negative corpus', () => {
  for (const negative of negativeCases) {
    it(`${negative.file} reports ${negative.ruleIds.join(', ')}`, () => {
      const { program, diagnostics } = analyze(negative.file, negative.flavorId);
      expect(program.diagnostics).toEqual([]);
      expect(diagnostics.map((diagnostic) => diagnostic.ruleId)).toEqual(negative.ruleIds);
    });
  }

  it('asserts every catalog rule id in at least one test', () => {
    const sources = testSources(testDir).join('\n');
    const missing = ruleCatalog
      .filter((rule) => !sources.includes(`'${rule.id}'`))
      .map((rule) => rule.id);
    expect(missing).toEqual([]);
  });
});
