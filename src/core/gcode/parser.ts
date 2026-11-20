import { lexLine, splitLines, type Token } from './lexer';
import type { Diagnostic, FileId, SourceSpan } from '../shared/types';

export interface Word {
  letter: string;
  value: number | undefined;
  raw: string;
  span: SourceSpan;
}

export type MacroStatement =
  | {
      kind: 'if-goto';
      target: number | null;
      tokens: Token[];
      span: SourceSpan;
    }
  | {
      kind: 'goto';
      target: number | null;
      tokens: Token[];
      span: SourceSpan;
    }
  | {
      kind: 'alarm';
      variable: number;
      value: number | null;
      message: string;
      tokens: Token[];
      span: SourceSpan;
    }
  | {
      kind: 'assignment';
      variable: number;
      tokens: Token[];
      span: SourceSpan;
    }
  | {
      kind: 'unknown';
      tokens: Token[];
      span: SourceSpan;
    };

export interface ParsedBlock {
  index: number;
  file: FileId;
  line: number;
  raw: string;
  words: Word[];
  comments: string[];
  sequenceNumber: number | null;
  macro?: MacroStatement;
}

export interface ParsedProgram {
  file: FileId;
  blocks: ParsedBlock[];
  diagnostics: Diagnostic[];
}

function commentText(comments: string[]): string {
  return comments
    .map((comment) =>
      comment
        .trim()
        .replace(/^\(/, '')
        .replace(/\)$/, '')
        .replace(/^;/, '')
        .trim(),
    )
    .filter(Boolean)
    .join(' ');
}

function numberAfter(tokens: Token[], from: number): number | null {
  for (let i = from; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.type === 'number') return token.value ?? null;
    if (token.type === 'word' && token.letter === 'N') return token.value ?? null;
  }
  return null;
}

function classifyMacro(
  tokens: Token[],
  comments: string[],
  span: SourceSpan,
): MacroStatement | undefined {
  if (tokens.length === 0) return undefined;

  const first = tokens[0];
  const second = tokens[1];

  if (first.type === 'identifier' && first.raw === 'IF') {
    const gotoIndex = tokens.findIndex(
      (token) => token.type === 'identifier' && token.raw === 'GOTO',
    );
    return {
      kind: 'if-goto',
      target: gotoIndex >= 0 ? numberAfter(tokens, gotoIndex + 1) : null,
      tokens,
      span,
    };
  }

  if (first.type === 'identifier' && first.raw === 'GOTO') {
    return {
      kind: 'goto',
      target: numberAfter(tokens, 1),
      tokens,
      span,
    };
  }

  if (
    first.type === 'variable' &&
    second?.type === 'operator' &&
    second.raw === '='
  ) {
    const variable = first.value ?? -1;
    const valueToken = tokens[2];
    const value =
      valueToken?.type === 'number' ? (valueToken.value ?? null) : null;
    if (variable === 3000) {
      return {
        kind: 'alarm',
        variable,
        value,
        message: commentText(comments),
        tokens,
        span,
      };
    }
    return { kind: 'assignment', variable, tokens, span };
  }

  if (tokens.some((token) => token.type === 'identifier')) {
    return { kind: 'unknown', tokens, span };
  }

  return undefined;
}

/**
 * Parse a single G-code line into a block. Comments are preserved because
 * macro alarm messages live in parentheses.
 */
export function parseLine(
  text: string,
  file: FileId,
  line: number,
  index: number,
): { block: ParsedBlock; diagnostics: Diagnostic[] } {
  const { tokens, diagnostics } = lexLine(text, file, line);
  const comments = tokens
    .filter((token) => token.type === 'comment')
    .map((token) => token.raw);
  const content = tokens.filter(
    (token) => token.type !== 'comment' && token.type !== 'percent',
  );

  const macro = classifyMacro(
    content,
    comments,
    content[0]?.span ?? { file, line, column: 1 },
  );

  const words: Word[] = content
    .filter((token) => token.type === 'word')
    .map((token) => ({
      letter: token.letter ?? '',
      value: token.value,
      raw: token.raw,
      span: token.span,
    }));

  const sequenceWord = words.find((word) => word.letter === 'N');

  return {
    block: {
      index,
      file,
      line,
      raw: text,
      words,
      comments,
      sequenceNumber: sequenceWord?.value ?? null,
      macro,
    },
    diagnostics,
  };
}

/**
 * Parse a complete program. Blocks with no words are retained so source-line
 * references stay stable for diagnostics and backplot.
 */
export function parseProgram(text: string, file: FileId = '<memory>'): ParsedProgram {
  const blocks: ParsedBlock[] = [];
  const diagnostics: Diagnostic[] = [];
  const lines = splitLines(text);

  lines.forEach((lineText, i) => {
    const parsed = parseLine(lineText, file, i + 1, i);
    blocks.push(parsed.block);
    diagnostics.push(...parsed.diagnostics);
  });

  return { file, blocks, diagnostics };
}
