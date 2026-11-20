import * as monaco from 'monaco-editor/editor/editor.api';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import type { Diagnostic } from '../core/shared/types';

export type GcodeEditor = monaco.editor.IStandaloneCodeEditor;

let configured = false;

function configure(): void {
  if (configured) return;
  configured = true;

  self.MonacoEnvironment = { getWorker: () => new EditorWorker() };

  monaco.languages.register({ id: 'gcode', extensions: ['.nc', '.gcode', '.tap'] });
  monaco.languages.setLanguageConfiguration('gcode', {
    comments: { blockComment: ['(', ')'] },
    brackets: [
      ['[', ']'],
      ['(', ')'],
    ],
    autoClosingPairs: [
      { open: '[', close: ']' },
      { open: '(', close: ')' },
    ],
  });
  monaco.languages.setMonarchTokensProvider('gcode', {
    ignoreCase: true,
    tokenizer: {
      root: [
        [/\([^)]*\)/, 'comment'],
        [/%/, 'keyword'],
        [/\b(?:IF|GOTO|THEN|EQ|NE|GT|LT|GE|LE|AND|OR)\b/, 'keyword'],
        [/\b[GMN]\d+(?:\.\d+)?\b/, 'keyword'],
        [/#\d+/, 'variable'],
        [/\b[A-Z]\s*[-+]?(?:\d+(?:\.\d*)?|\.\d+)\b/, 'number'],
        [/\b[A-Z]\b/, 'identifier'],
        [/[ \t]+/, 'white'],
      ],
    },
  });
  monaco.editor.defineTheme('gcode-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '8292a5', fontStyle: 'italic' },
      { token: 'keyword', foreground: '8ab4f8' },
      { token: 'number', foreground: 'e3b341' },
      { token: 'variable', foreground: 'f0a870' },
      { token: 'identifier', foreground: 'b8c6d4' },
    ],
    colors: {
      'editor.background': '#111820',
      'editor.foreground': '#dce5ee',
      'editorLineNumber.foreground': '#5b6a7c',
      'editor.lineHighlightBackground': '#19232e',
      'editor.selectionBackground': '#2b4560',
    },
  });
}

export function createGcodeEditor(
  container: HTMLElement,
  initialValue: string,
  onChange: (value: string) => void,
): GcodeEditor {
  configure();
  const editor = monaco.editor.create(container, {
    value: initialValue,
    language: 'gcode',
    theme: 'gcode-dark',
    automaticLayout: true,
    minimap: { enabled: false },
    fontSize: 13,
    lineHeight: 20,
    lineNumbersMinChars: 4,
    renderLineHighlight: 'all',
    scrollBeyondLastLine: false,
    tabSize: 2,
  });
  editor.onDidChangeModelContent(() => onChange(editor.getValue()));
  return editor;
}

/** Replaces the editor contents when a different file is opened. */
export function setEditorText(editor: GcodeEditor, text: string): void {
  editor.setValue(text);
  editor.setPosition({ lineNumber: 1, column: 1 });
}

export function setDiagnostics(
  editor: GcodeEditor,
  diagnostics: Diagnostic[],
): void {
  const model = editor.getModel();
  if (!model) return;

  monaco.editor.setModelMarkers(
    model,
    'gcode-verification',
    diagnostics
      .filter((diagnostic) => diagnostic.severity !== 'off')
      .map((diagnostic) => {
        const severity =
          diagnostic.severity === 'error'
            ? monaco.MarkerSeverity.Error
            : diagnostic.severity === 'warning'
              ? monaco.MarkerSeverity.Warning
              : monaco.MarkerSeverity.Info;
        const line = Math.max(1, diagnostic.span.line);
        const column = Math.max(1, diagnostic.span.column);
        return {
          severity,
          message: `${diagnostic.ruleId}: ${diagnostic.message}`,
          source: 'Verification',
          startLineNumber: line,
          startColumn: column,
          endLineNumber: line,
          endColumn: column + Math.max(1, diagnostic.span.length ?? 1),
        };
      }),
  );
}

export function revealDiagnostic(
  editor: GcodeEditor,
  diagnostic: Diagnostic,
): void {
  editor.revealLineInCenter(diagnostic.span.line);
  editor.setPosition({
    lineNumber: Math.max(1, diagnostic.span.line),
    column: Math.max(1, diagnostic.span.column),
  });
  editor.focus();
}
