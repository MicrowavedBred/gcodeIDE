import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { evaluateProgram } from '../../src/core/gcode/modal';
import { parseProgram } from '../../src/core/gcode/parser';
import {
  builtinFlavors,
  builtinProfile,
  builtinUserPreferences,
  grblProfile,
} from '../../src/core/profiles/builtin';
import { runRules } from '../../src/core/rules/engine';
import type { ResolvedMachineProfile } from '../../src/core/profiles/types';

const fixtureDir = fileURLToPath(new URL('../fixtures/programs/', import.meta.url));

interface Case {
  file: string;
  flavorId: string;
}

const cases: Case[] = [
  { file: 'haas_face_drill.nc', flavorId: 'haas-mill' },
  { file: 'haas_pocket_comp.nc', flavorId: 'haas-mill' },
  { file: 'haas_subprogram.nc', flavorId: 'haas-mill' },
  { file: 'fanuc_boltpattern.nc', flavorId: 'fanuc-mill' },
  { file: 'grbl_router.nc', flavorId: 'grbl' },
  { file: 'linuxcnc_offset.nc', flavorId: 'linuxcnc-mill' },
];

function analyze(file: string, profile: ResolvedMachineProfile) {
  const text = readFileSync(join(fixtureDir, file), 'utf8');
  const program = parseProgram(text, file);
  const evaluation = evaluateProgram(program, profile);
  return {
    program,
    evaluation,
    diagnostics: runRules({ profile, program, evaluation }),
  };
}

describe('built-in flavor registry', () => {
  it('includes all built-in flavors with a default variant each', () => {
    expect(builtinFlavors.map((flavor) => flavor.id)).toEqual([
      'brother-speedio',
      'haas-mill',
      'fanuc-mill',
      'grbl',
      'linuxcnc-mill',
      'fanuc-lathe',
    ]);
    for (const flavor of builtinFlavors) {
      const defaultId = builtinUserPreferences.defaultVariantByFlavor[flavor.id];
      expect(defaultId).toBeDefined();
      expect(
        flavor.variants.some((variant) => variant.id === defaultId),
      ).toBe(true);
      expect(builtinProfile(flavor.id)).toBeDefined();
    }
  });
});

describe('flavor reference programs', () => {
  for (const { file, flavorId } of cases) {
    it(`evaluates ${file} with ${flavorId} without errors`, () => {
      const profile = builtinProfile(flavorId)!;
      const { program, evaluation, diagnostics } = analyze(file, profile);
      const errors = diagnostics.filter((d) => d.severity === 'error');
      expect(errors, JSON.stringify(errors.slice(0, 5))).toEqual([]);
      expect(program.blocks.length).toBeGreaterThan(0);
      expect(evaluation.blockStates.length).toBeGreaterThan(0);
      expect(
        evaluation.events.some((event) => event.kind === 'program-end'),
      ).toBe(true);
    });
  }

  it('reports the expected unit-mismatch note on the LinuxCNC inch switch', () => {
    const { diagnostics } = analyze(
      'linuxcnc_offset.nc',
      builtinProfile('linuxcnc-mill')!,
    );
    expect(
      diagnostics.some((d) => d.ruleId === 'unit-mismatch'),
    ).toBe(true);
  });

  it('rejects Fanuc-only cycles on GRBL', () => {
    const text = 'G21 G90 G81 X0 Y0 Z-5 R2 F100\nM30\n';
    const program = parseProgram(text, 'grbl-test.nc');
    const profile = grblProfile();
    const evaluation = evaluateProgram(program, profile);
    expect(
      evaluation.diagnostics.some(
        (d) => d.ruleId === 'unsupported-code' && d.message.includes('G81'),
      ),
    ).toBe(true);
  });

  it('rejects cutter compensation on GRBL', () => {
    const text = 'G21 G90 G0 X0 Y0\nG1 G41 X10 F100\nM30\n';
    const program = parseProgram(text, 'grbl-test.nc');
    const evaluation = evaluateProgram(program, grblProfile());
    expect(
      evaluation.diagnostics.some(
        (d) => d.ruleId === 'unsupported-code' && d.message.includes('G41'),
      ),
    ).toBe(true);
  });

  it('supports LinuxCNC extended G59.1 work offsets', () => {
    const profile = builtinProfile('linuxcnc-mill')!;
    const program = parseProgram('G59.1\nG0 X0 Y0\nM30', 'linuxcnc-test.nc');
    const evaluation = evaluateProgram(program, profile);
    expect(evaluation.blockStates[0]?.after.modal.workOffsetCode).toBe('G59.1');
  });
});
