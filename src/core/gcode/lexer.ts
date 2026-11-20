import type { Diagnostic, FileId, SourceSpan } from '../shared/types';

export type TokenType =
  | 'word'
  | 'identifier'
  | 'variable'
  | 'number'
  | 'comment'
  | 'percent'
  | 'bracket-open'
  | 'bracket-close'
  | 'operator';

export interface Token {
  type: TokenType;
  raw: string;
  letter?: string;
  value?: number;
  span: SourceSpan;
}

export interface LexResult {
  tokens: Token[];
  diagnostics: Diagnostic[];
}

const isDigit = (c: string): boolean => c >= '0' && c <= '9';
const isLetter = (c: string): boolean =>
  (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z');

const isSign = (c: string): boolean => c === '+' || c === '-';

/**
 * Split a G-code source into lines while preserving 1-based line numbers.
 */
export function splitLines(text: string): string[] {
  return text.replace(/\r\n?/g, '\n').split('\n');
}

/**
 * Tokenise a single G-code line.
 *
 * Handles compact blocks such as `G0X0Y0`, decimal codes such as `G54.1P4`,
 * parentheses/semicolon comments, macro variables, and the small IF/GOTO
 * vocabulary used by the Brother corpus.
 */
export function lexLine(
  text: string,
  file: FileId,
  line: number,
): LexResult {
  const tokens: Token[] = [];
  const diagnostics: Diagnostic[] = [];
  let i = 0;

  const span = (start: number, length: number): SourceSpan => ({
    file,
    line,
    column: start + 1,
    length,
  });

  while (i < text.length) {
    const c = text[i];

    if (c === ' ' || c === '\t' || c === '\r') {
      i += 1;
      continue;
    }

    if (c === '(') {
      const start = i;
      i += 1;
      let depth = 1;
      while (i < text.length && depth > 0) {
        if (text[i] === '(') depth += 1;
        else if (text[i] === ')') depth -= 1;
        i += 1;
      }
      if (depth > 0) {
        diagnostics.push({
          ruleId: 'unterminated-comment',
          severity: 'warning',
          message: 'Unterminated parenthesis comment.',
          span: span(start, i - start),
        });
      }
      tokens.push({
        type: 'comment',
        raw: text.slice(start, i),
        span: span(start, i - start),
      });
      continue;
    }

    if (c === ';') {
      const start = i;
      i = text.length;
      tokens.push({
        type: 'comment',
        raw: text.slice(start),
        span: span(start, text.length - start),
      });
      continue;
    }

    if (c === '%') {
      tokens.push({ type: 'percent', raw: '%', span: span(i, 1) });
      i += 1;
      continue;
    }

    if (c === '[') {
      tokens.push({ type: 'bracket-open', raw: '[', span: span(i, 1) });
      i += 1;
      continue;
    }

    if (c === ']') {
      tokens.push({ type: 'bracket-close', raw: ']', span: span(i, 1) });
      i += 1;
      continue;
    }

    if (c === '=') {
      tokens.push({ type: 'operator', raw: '=', span: span(i, 1) });
      i += 1;
      continue;
    }

    if (c === '#') {
      const start = i;
      i += 1;
      const digitsStart = i;
      while (i < text.length && isDigit(text[i])) i += 1;
      const raw = text.slice(start, i);
      if (i === digitsStart) {
        diagnostics.push({
          ruleId: 'invalid-variable',
          severity: 'error',
          message: 'Variable number expected after #.',
          span: span(start, i - start),
        });
        tokens.push({ type: 'variable', raw, span: span(start, i - start) });
      } else {
        tokens.push({
          type: 'variable',
          raw,
          value: Number(raw.slice(1)),
          span: span(start, i - start),
        });
      }
      continue;
    }

    if (isLetter(c)) {
      const start = i;
      let letters = '';
      while (i < text.length && isLetter(text[i])) {
        letters += text[i];
        i += 1;
      }

      if (letters.length > 1) {
        tokens.push({
          type: 'identifier',
          raw: letters.toUpperCase(),
          span: span(start, i - start),
        });
        continue;
      }

      const letter = letters.toUpperCase();
      const valueStart = i;
      if (i < text.length && isSign(text[i])) i += 1;

      let digits = 0;
      while (i < text.length && isDigit(text[i])) {
        i += 1;
        digits += 1;
      }
      if (text[i] === '.') {
        i += 1;
        while (i < text.length && isDigit(text[i])) {
          i += 1;
          digits += 1;
        }
      }

      const raw = text.slice(start, i);
      if (digits === 0) {
        diagnostics.push({
          ruleId: 'missing-word-value',
          severity: 'warning',
          message: `Word ${letter} has no numeric value.`,
          span: span(start, i - start),
        });
        tokens.push({
          type: 'word',
          raw,
          letter,
          span: span(start, i - start),
        });
      } else {
        tokens.push({
          type: 'word',
          raw,
          letter,
          value: Number(text.slice(valueStart, i)),
          span: span(start, i - start),
        });
      }
      continue;
    }

    if (
      isDigit(c) ||
      (isSign(c) && i + 1 < text.length && isDigit(text[i + 1]))
    ) {
      const start = i;
      if (isSign(c)) i += 1;
      while (i < text.length && isDigit(text[i])) i += 1;
      if (text[i] === '.') {
        i += 1;
        while (i < text.length && isDigit(text[i])) i += 1;
      }
      const raw = text.slice(start, i);
      tokens.push({
        type: 'number',
        raw,
        value: Number(raw),
        span: span(start, i - start),
      });
      continue;
    }

    diagnostics.push({
      ruleId: 'invalid-character',
      severity: 'error',
      message: `Unexpected character '${c}'.`,
      span: span(i, 1),
    });
    i += 1;
  }

  return { tokens, diagnostics };
}
