import type { ParsedBlock, ParsedProgram } from '../gcode/parser';
import type { ProgramEvaluation, SemanticEvent } from '../gcode/modal';
import type { ResolvedMachineProfile } from '../profiles/types';
import type { Diagnostic, Severity, SourceSpan, Vec3 } from '../shared/types';

/** Conservative axis-aligned stock envelope for rule checks. */
export interface StockBounds {
  min: Vec3;
  max: Vec3;
}

export interface RuleContext {
  profile: ResolvedMachineProfile;
  program: ParsedProgram;
  evaluation: ProgramEvaluation;
  /** Optional stock envelope; rapid-through-stock only runs when present. */
  stock?: StockBounds;
  /** Optional safe Z height in work coordinates. */
  safeZ?: number;
}

export interface RuleDefinition {
  id: string;
  description: string;
  defaultSeverity: Severity;
  check(context: RuleContext): Diagnostic[];
}

export interface RuleDiagnostic extends Diagnostic {}

export function blockSpan(block: ParsedBlock): SourceSpan {
  return {
    file: block.file,
    line: block.line,
    column: 1,
    length: block.raw.length || undefined,
  };
}

export function wordSpan(
  block: ParsedBlock,
  letter: string,
): SourceSpan | undefined {
  return block.words.find((word) => word.letter === letter)?.span;
}

export function blockCodes(block: ParsedBlock): string[] {
  return block.words
    .filter((word) => word.letter === 'G' || word.letter === 'M')
    .map((word) =>
      word.value === undefined
        ? word.raw.toUpperCase()
        : `${word.letter}${word.value}`,
    );
}

export function moveEvents(blockState: {
  events: SemanticEvent[];
}): Extract<SemanticEvent, { kind: 'move' }>[] {
  return blockState.events.filter(
    (event): event is Extract<SemanticEvent, { kind: 'move' }> =>
      event.kind === 'move',
  );
}

export function isInsideStock(point: Vec3, stock: StockBounds): boolean {
  return (
    point.x >= stock.min.x &&
    point.x <= stock.max.x &&
    point.y >= stock.min.y &&
    point.y <= stock.max.y &&
    point.z >= stock.min.z &&
    point.z <= stock.max.z
  );
}
