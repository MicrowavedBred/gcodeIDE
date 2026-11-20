import { useEffect, useMemo, useRef, useState } from 'react';
import { analyzeProgram, collectMoves } from './analysis';
import { createBackplot, type BackplotHandle } from './backplot';
import {
  createGcodeEditor,
  revealDiagnostic,
  setDiagnostics,
  type GcodeEditor,
} from './monaco-gcode';
import { sampleProgram } from './sample-program';
import {
  builtinFlavors,
  builtinFlavorsById,
  builtinProfile,
  builtinUserPreferences,
} from '../core/profiles/builtin';
import type { Severity } from '../core/shared/types';

type SeverityFilter = 'all' | Exclude<Severity, 'off'>;

const severityFilters: Array<{ value: SeverityFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'error', label: 'Errors' },
  { value: 'warning', label: 'Warnings' },
  { value: 'info', label: 'Info' },
];

const severityLabels: Record<Exclude<Severity, 'off'>, string> = {
  error: 'Error',
  warning: 'Warning',
  info: 'Info',
};

export function App() {
  const [flavorId, setFlavorId] = useState(builtinFlavors[0].id);
  const [variantId, setVariantId] = useState(
    builtinUserPreferences.defaultVariantByFlavor[builtinFlavors[0].id],
  );
  const [text, setText] = useState(sampleProgram);
  const [filter, setFilter] = useState<SeverityFilter>('all');
  const [editorReady, setEditorReady] = useState(false);
  const [backplotReady, setBackplotReady] = useState(false);
  const [backplotError, setBackplotError] = useState<string | null>(null);
  const editorHostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<GcodeEditor | null>(null);
  const backplotHostRef = useRef<HTMLDivElement>(null);
  const backplotRef = useRef<BackplotHandle | null>(null);

  const flavor = builtinFlavorsById.get(flavorId) ?? builtinFlavors[0];
  const profile = useMemo(
    () => builtinProfile(flavorId, variantId),
    [flavorId, variantId],
  );
  const analysis = useMemo(
    () => analyzeProgram(text, 'program.nc', profile!),
    [text, profile],
  );
  const moves = useMemo(
    () => collectMoves(analysis.evaluation),
    [analysis],
  );
  const moveCounts = useMemo(
    () => ({
      rapid: moves.filter((move) => move.kind === 'rapid').length,
      linear: moves.filter((move) => move.kind === 'linear').length,
      arc: moves.filter((move) => move.kind === 'arc').length,
      cycle: moves.filter((move) => move.kind === 'canned-cycle').length,
    }),
    [moves],
  );

  useEffect(() => {
    const host = editorHostRef.current;
    if (!host) return;

    const editor = createGcodeEditor(host, sampleProgram, setText);
    editorRef.current = editor;
    setEditorReady(true);
    return () => {
      editor.dispose();
      editorRef.current = null;
      setEditorReady(false);
    };
  }, []);

  useEffect(() => {
    if (editorReady && editorRef.current) {
      setDiagnostics(editorRef.current, analysis.diagnostics);
    }
  }, [analysis, editorReady]);

  useEffect(() => {
    const host = backplotHostRef.current;
    if (!host) return;

    try {
      const backplot = createBackplot(host);
      backplotRef.current = backplot;
      setBackplotReady(true);
      return () => {
        backplot.dispose();
        backplotRef.current = null;
        setBackplotReady(false);
      };
    } catch (error) {
      setBackplotError(
        error instanceof Error ? error.message : 'WebGL is unavailable.',
      );
    }
  }, []);

  useEffect(() => {
    if (backplotReady) backplotRef.current?.setMoves(moves);
  }, [moves, backplotReady]);

  const counts = useMemo(() => {
    const result: Record<SeverityFilter, number> = {
      all: analysis.diagnostics.length,
      error: 0,
      warning: 0,
      info: 0,
    };
    for (const diagnostic of analysis.diagnostics) {
      if (diagnostic.severity !== 'off') result[diagnostic.severity] += 1;
    }
    return result;
  }, [analysis]);

  const visibleDiagnostics = useMemo(
    () =>
      filter === 'all'
        ? analysis.diagnostics
        : analysis.diagnostics.filter((d) => d.severity === filter),
    [analysis, filter],
  );

  function handleFlavorChange(nextFlavorId: string) {
    setFlavorId(nextFlavorId);
    setVariantId(
      builtinUserPreferences.defaultVariantByFlavor[nextFlavorId] ??
        builtinFlavorsById.get(nextFlavorId)?.variants[0]?.id ??
        '',
    );
  }

  return (
    <div className="app-shell">
      <header className="toolbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            G
          </span>
          <div>
            <h1>GCode IDE</h1>
            <p>Verification workbench</p>
          </div>
        </div>

        <div className="controls">
          <label className="control">
            <span>Flavor</span>
            <select
              value={flavorId}
              onChange={(event) => handleFlavorChange(event.target.value)}
            >
              {builtinFlavors.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>

          <label className="control">
            <span>Variant</span>
            <select
              value={variantId}
              onChange={(event) => setVariantId(event.target.value)}
            >
              {flavor.variants.map((variant) => (
                <option key={variant.id} value={variant.id}>
                  {variant.name}
                </option>
              ))}
            </select>
          </label>

          <p className="profile-meta">
            {profile?.units.toUpperCase()} · {profile?.orientation} ·{' '}
            {profile?.travels ? 'bounded travels' : 'unbounded travels'}
          </p>
        </div>
      </header>

      <main className="workbench">
        <section className="pane editor-pane" aria-labelledby="editor-heading">
          <div className="pane-header">
            <h2 id="editor-heading">Program</h2>
            <span className="pane-hint">program.nc · in memory</span>
          </div>
          <div className="editor-host" ref={editorHostRef} />
        </section>

        <section className="pane backplot-pane" aria-labelledby="backplot-heading">
          <div className="pane-header">
            <h2 id="backplot-heading">Backplot</h2>
            <div className="backplot-legend" aria-label="Toolpath legend">
              <span>
                <i className="legend-swatch legend-swatch--rapid" aria-hidden="true" />
                Rapid {moveCounts.rapid}
              </span>
              <span>
                <i className="legend-swatch legend-swatch--linear" aria-hidden="true" />
                Linear {moveCounts.linear}
              </span>
              <span>
                <i className="legend-swatch legend-swatch--arc" aria-hidden="true" />
                Arc {moveCounts.arc}
              </span>
              <span>
                <i className="legend-swatch legend-swatch--cycle" aria-hidden="true" />
                Cycle {moveCounts.cycle}
              </span>
            </div>
          </div>
          <div className="backplot-host" ref={backplotHostRef} />
          {backplotError && (
            <div className="backplot-overlay" role="alert">
              Backplot unavailable: {backplotError}
            </div>
          )}
          {!backplotError && moves.length === 0 && (
            <div className="backplot-overlay" role="status">
              No toolpath moves in this program.
            </div>
          )}
        </section>

        <section
          className="diagnostics-pane"
          aria-labelledby="diagnostics-heading"
        >
          <div className="pane-header diagnostics-header">
            <h2 id="diagnostics-heading">Diagnostics</h2>
            <div
              className="filter-group"
              role="group"
              aria-label="Filter diagnostics by severity"
            >
              {severityFilters.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  aria-pressed={filter === item.value}
                  onClick={() => setFilter(item.value)}
                >
                  {item.label} <span className="filter-count">{counts[item.value]}</span>
                </button>
              ))}
            </div>
          </div>

          <ul className="diagnostic-list">
            {visibleDiagnostics.length === 0 ? (
              <li className="empty-state" role="status">
                No diagnostics in this view.
              </li>
            ) : (
              visibleDiagnostics.map((diagnostic, index) => (
                <li key={`${diagnostic.ruleId}-${index}`}>
                  <button
                    type="button"
                    className="diagnostic-row"
                    disabled={!editorReady}
                    onClick={() =>
                      editorRef.current &&
                      revealDiagnostic(editorRef.current, diagnostic)
                    }
                  >
                    <span
                      className={`severity severity--${diagnostic.severity}`}
                    >
                      {diagnostic.severity === 'off'
                        ? 'Off'
                        : severityLabels[diagnostic.severity]}
                    </span>
                    <span className="diagnostic-rule">{diagnostic.ruleId}</span>
                    <span className="diagnostic-message">
                      {diagnostic.message}
                    </span>
                    <span className="diagnostic-location">
                      L{diagnostic.span.line}:{diagnostic.span.column}
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </section>
      </main>

      <footer className="status-bar">
        <span>{analysis.program.blocks.length} blocks</span>
        <span>
          {counts.all} diagnostics ({counts.error} errors)
        </span>
        {analysis.evaluation.approximate && (
          <span>Approximate macro evaluation</span>
        )}
        <span className="status-spacer" />
        <span>{flavor.name}</span>
      </footer>
    </div>
  );
}
