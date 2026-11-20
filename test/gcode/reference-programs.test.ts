import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { evaluateProgram, type SemanticEvent } from '../../src/core/gcode/modal';
import { parseProgram } from '../../src/core/gcode/parser';
import { builtinProfile } from '../../src/core/profiles/builtin';
import { runRules } from '../../src/core/rules/engine';

const fixtureDir = fileURLToPath(new URL('../fixtures/programs/', import.meta.url));

interface GoldenCase {
  file: string;
  flavorId: string;
  executed: number;
  moves: number;
  warnings: string[];
}

/** Golden traces move when evaluation semantics change; update deliberately. */
const goldenCases: GoldenCase[] = [
  { file: 'haas_face_drill.nc', flavorId: 'haas-mill', executed: 16, moves: 6, warnings: [] },
  { file: 'haas_pocket_comp.nc', flavorId: 'haas-mill', executed: 17, moves: 10, warnings: [] },
  { file: 'haas_subprogram.nc', flavorId: 'haas-mill', executed: 19, moves: 7, warnings: [] },
  { file: 'haas_macro_branch.nc', flavorId: 'haas-mill', executed: 15, moves: 6, warnings: [] },
  { file: 'fanuc_boltpattern.nc', flavorId: 'fanuc-mill', executed: 16, moves: 7, warnings: [] },
  { file: 'fanuc_arcs_rotation.nc', flavorId: 'fanuc-mill', executed: 20, moves: 11, warnings: [] },
  { file: 'brother_4axis_macro.nc', flavorId: 'brother-speedio', executed: 26, moves: 13, warnings: [] },
  { file: 'grbl_router.nc', flavorId: 'grbl', executed: 13, moves: 8, warnings: [] },
  { file: 'linuxcnc_offset.nc', flavorId: 'linuxcnc-mill', executed: 18, moves: 6, warnings: ['unit-mismatch'] },
];

function analyze(file: string, flavorId: string) {
  const text = readFileSync(join(fixtureDir, file), 'utf8');
  const program = parseProgram(text, file);
  const profile = builtinProfile(flavorId)!;
  const evaluation = evaluateProgram(program, profile);
  const diagnostics = runRules({ profile, program, evaluation });
  return { program, evaluation, diagnostics };
}

function eventCounts(events: SemanticEvent[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const event of events) counts[event.kind] = (counts[event.kind] ?? 0) + 1;
  return counts;
}

describe('reference program golden traces', () => {
  for (const golden of goldenCases) {
    it(`evaluates ${golden.file} with ${golden.flavorId}`, () => {
      const { evaluation, diagnostics } = analyze(golden.file, golden.flavorId);
      const errors = diagnostics.filter((d) => d.severity === 'error');
      expect(errors, JSON.stringify(errors)).toEqual([]);
      expect(diagnostics.map((d) => d.ruleId)).toEqual(golden.warnings);
      expect({
        executed: evaluation.blockStates.length,
        moves: eventCounts(evaluation.events).move ?? 0,
      }).toEqual({ executed: golden.executed, moves: golden.moves });
      expect(evaluation.events.some((event) => event.kind === 'program-end')).toBe(true);
    });
  }
});

describe('new reference behaviors', () => {
  it('skips the Brother macro branch and repeats the index subprogram', () => {
    const { evaluation } = analyze('brother_4axis_macro.nc', 'brother-speedio');
    const lines = evaluation.blockStates.map((state) => state.block.line);
    expect(lines).not.toContain(8);
    expect(lines.filter((line) => line === 24 || line === 25 || line === 26)).toEqual([
      24, 25, 26, 24, 25, 26,
    ]);
    expect(evaluation.blockStates.find((state) => state.block.line === 15)?.after.position.a).toBe(180);
    const counts = eventCounts(evaluation.events);
    expect(counts['subprogram-call']).toBe(1);
    expect(counts['subprogram-return']).toBe(2);
  });

  it('applies and cancels Fanuc rotation around the sampled arc', () => {
    const { evaluation } = analyze('fanuc_arcs_rotation.nc', 'fanuc-mill');
    expect(
      evaluation.blockStates.find((state) => state.block.line === 9)?.after.modal.rotation?.angleDeg,
    ).toBe(90);
    expect(
      evaluation.blockStates.find((state) => state.block.line === 12)?.after.modal.rotation,
    ).toBeNull();
    expect(evaluation.blockStates.at(-1)?.after.position).toEqual({ x: 10, y: -10, z: 0, a: 0 });
  });

  it('skips the Haas macro branch and ends at the second drill position', () => {
    const { evaluation } = analyze('haas_macro_branch.nc', 'haas-mill');
    expect(evaluation.blockStates.map((state) => state.block.line)).not.toContain(8);
    expect(evaluation.blockStates.at(-1)?.after.position).toEqual({ x: 20, y: 0, z: 25, a: 0 });
  });
});

describe('GRBL negative reference', () => {
  it('reports unsupported Fanuc features and macro assignments without errors', () => {
    const { diagnostics } = analyze('grbl_negative.nc', 'grbl');
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(diagnostics.map((d) => d.ruleId)).toEqual([
      'unsupported-code',
      'unsupported-code',
      'unsupported-macro',
    ]);
    expect(diagnostics[0]?.message).toContain('G41');
    expect(diagnostics[1]?.message).toContain('G81');
    expect(diagnostics[2]?.message).toContain('#100');
  });
});
