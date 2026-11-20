import { evaluateProgram, type ProgramEvaluation } from '../core/gcode/modal';
import { buildToolpath, type Toolpath } from '../core/interpreter/toolpath';
import {
  simulateStock,
  type StockConfig,
  type StockSimulation,
} from '../core/simulation/stock';
import { parseProgram, type ParsedProgram } from '../core/gcode/parser';
import type { ResolvedMachineProfile } from '../core/profiles/types';
import { runRules } from '../core/rules/engine';
import type { Diagnostic } from '../core/shared/types';

export interface AnalysisOptions {
  stock?: StockConfig;
  safeZ?: number;
}

export interface ProgramAnalysis {
  program: ParsedProgram;
  evaluation: ProgramEvaluation;
  toolpath: Toolpath;
  simulation: StockSimulation | null;
  diagnostics: Diagnostic[];
}

/** Parse/evaluate/toolpath results, independent of stock simulation and rules. */
export interface AnalysisParts {
  program: ParsedProgram;
  evaluation: ProgramEvaluation;
  toolpath: Toolpath;
}

function diagnosticKey(diagnostic: Diagnostic): string {
  const { file, line, column } = diagnostic.span;
  return `${diagnostic.ruleId}|${file}|${line}|${column}|${diagnostic.message}`;
}

/** Runs the source and toolpath stages of the verification pipeline. */
export function buildAnalysisParts(
  text: string,
  file: string,
  profile: ResolvedMachineProfile,
  subprograms: ParsedProgram[] = [],
): AnalysisParts {
  const program = parseProgram(text, file);
  const evaluation = evaluateProgram(
    subprograms.length > 0 ? { main: program, subprograms } : program,
    profile,
  );
  return { program, evaluation, toolpath: buildToolpath(evaluation) };
}

/** Runs stock-aware rules and assembles diagnostics from prepared parts. */
export function finishAnalysis(
  parts: AnalysisParts,
  profile: ResolvedMachineProfile,
  options: AnalysisOptions,
  simulation: StockSimulation | null,
): ProgramAnalysis {
  const { program, evaluation, toolpath } = parts;
  const policyDiagnostics = runRules({
    profile,
    program,
    evaluation,
    stock: options.stock?.bounds,
    stockSimulation: simulation ?? undefined,
    safeZ: options.safeZ,
  });

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

  return { program, evaluation, toolpath, simulation, diagnostics };
}

/** Runs the full verification pipeline synchronously (tests and worker fallback). */
export function analyzeProgram(
  text: string,
  file: string,
  profile: ResolvedMachineProfile,
  subprograms: ParsedProgram[] = [],
  options: AnalysisOptions = {},
): ProgramAnalysis {
  const parts = buildAnalysisParts(text, file, profile, subprograms);
  const simulation = options.stock
    ? simulateStock(parts.toolpath, options.stock)
    : null;
  return finishAnalysis(parts, profile, options, simulation);
}
