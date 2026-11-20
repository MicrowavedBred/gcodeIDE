import {
  evaluateProgram,
  type Move,
  type ProgramEvaluation,
  type SemanticEvent,
} from '../core/gcode/modal';
import { parseProgram, type ParsedProgram } from '../core/gcode/parser';
import type { ResolvedMachineProfile } from '../core/profiles/types';
import { runRules } from '../core/rules/engine';
import type { Diagnostic } from '../core/shared/types';

export interface ProgramAnalysis {
  program: ParsedProgram;
  evaluation: ProgramEvaluation;
  diagnostics: Diagnostic[];
}

export type MoveEvent = Extract<SemanticEvent, { kind: 'move' }>;

/** Flattens evaluated move events for the backplot. */
export function collectMoves(evaluation: ProgramEvaluation): Move[] {
  return evaluation.events
    .filter((event): event is MoveEvent => event.kind === 'move')
    .map((event) => event.move);
}

function diagnosticKey(diagnostic: Diagnostic): string {
  const { file, line, column } = diagnostic.span;
  return `${diagnostic.ruleId}|${file}|${line}|${column}|${diagnostic.message}`;
}

/** Runs the full verification pipeline against an in-memory program. */
export function analyzeProgram(
  text: string,
  file: string,
  profile: ResolvedMachineProfile,
  subprograms: ParsedProgram[] = [],
): ProgramAnalysis {
  const program = parseProgram(text, file);
  const evaluation = evaluateProgram(
    subprograms.length > 0 ? { main: program, subprograms } : program,
    profile,
  );
  const policyDiagnostics = runRules({ profile, program, evaluation });

  const unique = new Map<string, Diagnostic>();
  for (const diagnostic of [...evaluation.diagnostics, ...policyDiagnostics]) {
    unique.set(diagnosticKey(diagnostic), diagnostic);
  }

  const diagnostics = [...unique.values()].sort(
    (a, b) =>
      a.span.line - b.span.line ||
      a.span.column - b.span.column ||
      a.ruleId.localeCompare(b.ruleId),
  );

  return { program, evaluation, diagnostics };
}
