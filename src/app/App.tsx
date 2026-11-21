import { useEffect, useMemo, useRef, useState } from 'react';
import {
  analyzeProgram,
  type ProgramAnalysis,
} from './analysis';
import {
  analyzeProgramAsync,
  disposeAnalysisWorker,
} from './analysis-worker-client';
import { createBackplot, type BackplotHandle } from './backplot';
import {
  createGcodeEditor,
  revealDiagnostic,
  setDiagnostics,
  setEditorText,
  type GcodeEditor,
} from './monaco-gcode';
import {
  platformFileIO,
  type LoadedFile,
  type LoadedFolder,
} from './platform';
import {
  createProjectFile,
  parseProjectFile,
  resolveMainFile,
  serializeProjectFile,
} from './project-file';
import { buildSubprograms, mainFileFromFolder } from './program-set';
import { loadPreferences, savePreferences, variantForFlavor } from './preferences';
import {
  buildVerificationReport,
  formatDuration,
} from './verification-report';
import type { ToolTipShape } from '../core/simulation/stock';
import { estimateCycleTime } from '../core/simulation/cycle-time';
import { sampleProgram } from './sample-program';
import {
  builtinFlavors,
  builtinFlavorsById,
  builtinPreferencesCatalog,
  builtinProfile,
} from '../core/profiles/builtin';
import { normalizeUserPreferences } from '../core/profiles/preferences';
import type { Units, UserPreferences } from '../core/profiles/types';
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

function readNumber(value: string, fallback: number): number {
  const parsed = Number(value);
  return value.trim() === '' || !Number.isFinite(parsed) ? fallback : parsed;
}

const initialFlavor = builtinFlavors[0];
const initialPreferences = normalizeUserPreferences(
  null,
  builtinPreferencesCatalog,
);

export function App() {
  const [preferences, setPreferences] =
    useState<UserPreferences>(initialPreferences);
  const [flavorId, setFlavorId] = useState(initialFlavor.id);
  const [variantId, setVariantId] = useState(
    variantForFlavor(initialFlavor.id, initialFlavor, initialPreferences),
  );
  const [text, setText] = useState(sampleProgram);
  const [savedText, setSavedText] = useState(sampleProgram);
  const [currentFile, setCurrentFile] = useState<LoadedFile | null>(null);
  const [project, setProject] = useState<LoadedFolder | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [filter, setFilter] = useState<SeverityFilter>('all');
  const [reportNotice, setReportNotice] = useState<string | null>(null);
  const [stockEnabled, setStockEnabled] = useState(false);
  const [stockX, setStockX] = useState(100);
  const [stockY, setStockY] = useState(100);
  const [stockThickness, setStockThickness] = useState(20);
  const [stockTopZ, setStockTopZ] = useState(0);
  const [toolDiameter, setToolDiameter] = useState(6);
  const [toolTip, setToolTip] = useState<ToolTipShape>('flat');
  const [cornerRadius, setCornerRadius] = useState(0.5);
  const [safeZ, setSafeZ] = useState<number | null>(5);
  const [editorReady, setEditorReady] = useState(false);
  const [backplotReady, setBackplotReady] = useState(false);
  const [backplotError, setBackplotError] = useState<string | null>(null);
  const editorHostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<GcodeEditor | null>(null);
  const backplotHostRef = useRef<HTMLDivElement>(null);
  const backplotRef = useRef<BackplotHandle | null>(null);
  const pendingOpenRef = useRef<(() => void) | null>(null);
  const flavorIdRef = useRef(flavorId);

  const flavor = builtinFlavorsById.get(flavorId) ?? builtinFlavors[0];
  const profile = useMemo(
    () => builtinProfile(flavorId, variantId, preferences),
    [flavorId, variantId, preferences],
  );
  const fileName = currentFile?.name ?? 'program.nc';
  const subprograms = useMemo(
    () => (project ? buildSubprograms(project, currentFile?.path) : []),
    [project, currentFile],
  );
  const stockConfig = useMemo(
    () =>
      stockEnabled
        ? {
            bounds: {
              min: {
                x: -Math.max(stockX, 1) / 2,
                y: -Math.max(stockY, 1) / 2,
                z: stockTopZ - Math.max(stockThickness, 1),
              },
              max: {
                x: Math.max(stockX, 1) / 2,
                y: Math.max(stockY, 1) / 2,
                z: stockTopZ,
              },
            },
            toolDiameterMm: Math.max(toolDiameter, 0.1),
            toolTip,
            cornerRadiusMm: cornerRadius,
          }
        : undefined,
    [stockEnabled, stockX, stockY, stockThickness, stockTopZ, toolDiameter, toolTip, cornerRadius],
  );
  const [analysis, setAnalysis] = useState<ProgramAnalysis>(() =>
    analyzeProgram(text, fileName, profile!, subprograms, {
      stock: stockConfig,
      safeZ: safeZ ?? undefined,
    }),
  );

  useEffect(() => {
    let cancelled = false;
    void analyzeProgramAsync(text, fileName, profile!, subprograms, {
      stock: stockConfig,
      safeZ: safeZ ?? undefined,
    }).then((next) => {
      if (!cancelled) setAnalysis(next);
    });
    return () => {
      cancelled = true;
    };
  }, [text, fileName, profile, subprograms, stockConfig, safeZ]);

  useEffect(() => () => disposeAnalysisWorker(), []);

  useEffect(() => {
    flavorIdRef.current = flavorId;
  }, [flavorId]);

  useEffect(() => {
    let cancelled = false;
    void loadPreferences()
      .then((loaded) => {
        if (cancelled) return;
        setPreferences(loaded);
        setVariantId(
          (current) =>
            loaded.defaultVariantByFlavor[flavorIdRef.current] ?? current,
        );
      })
      .catch(() => {
        if (!cancelled) setNotice('Could not load saved preferences; using defaults.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const toolpath = analysis.toolpath;
  const simulation = analysis.simulation;
  const dirty = text !== savedText;

  const dwellSeconds = useMemo(
    () =>
      analysis.evaluation.events.reduce(
        (sum, event) => sum + (event.kind === 'dwell' ? event.seconds : 0),
        0,
      ),
    [analysis],
  );
  const cycleTime = useMemo(
    () =>
      estimateCycleTime(toolpath.moves, dwellSeconds, {
        rapidRateMmPerMin: profile?.variant.geometry.rapidRate ?? null,
      }),
    [toolpath, dwellSeconds, profile],
  );
  const reportText = useMemo(
    () =>
      buildVerificationReport({
        fileName,
        flavorName: flavor.name,
        variantName: profile?.variant.name ?? '',
        analysis,
        cycleTime,
      }),
    [fileName, flavor.name, profile, analysis, cycleTime],
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
    if (backplotReady) backplotRef.current?.setToolpath(toolpath);
  }, [toolpath, backplotReady]);

  useEffect(() => {
    if (backplotReady) backplotRef.current?.setStock(simulation);
  }, [simulation, backplotReady]);

  useEffect(() => {
    function warnOnUnload(event: BeforeUnloadEvent) {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = '';
    }
    window.addEventListener('beforeunload', warnOnUnload);
    return () => window.removeEventListener('beforeunload', warnOnUnload);
  }, [dirty]);

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void saveCurrent();
      }
    }
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [text, currentFile, busy]);

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
      variantForFlavor(
        nextFlavorId,
        builtinFlavorsById.get(nextFlavorId),
        preferences,
      ),
    );
  }

  function handleDefaultUnitsChange(nextUnits: Units) {
    const next = { ...preferences, defaultUnits: nextUnits };
    setPreferences(next);
    void savePreferences(next).catch(() => setNotice('Could not save preferences.'));
  }

  function handleUseVariantAsDefault() {
    const next: UserPreferences = {
      ...preferences,
      defaultVariantByFlavor: {
        ...preferences.defaultVariantByFlavor,
        [flavorId]: variantId,
      },
    };
    setPreferences(next);
    void savePreferences(next).catch(() => setNotice('Could not save preferences.'));
  }

  async function copyReport() {
    try {
      await navigator.clipboard.writeText(reportText);
      setReportNotice('Report copied.');
    } catch {
      setReportNotice('Clipboard unavailable.');
    }
  }

  async function downloadReport() {
    const saved = await platformFileIO.saveReportFile(fileName, reportText);
    if (saved) setReportNotice(`Saved ${saved.name}.`);
  }

  function loadFile(file: LoadedFile) {
    setCurrentFile(file);
    setText(file.text);
    setSavedText(file.text);
    if (editorRef.current) setEditorText(editorRef.current, file.text);
    setNotice(null);
  }

  async function saveCurrent(saveAs = false): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    try {
      const file: LoadedFile = currentFile ?? {
        path: 'program.nc',
        name: 'program.nc',
        text,
      };
      const target =
        !currentFile || saveAs
          ? await platformFileIO.saveProgramAs({ ...file, text })
          : await platformFileIO.saveProgram({ ...file, text });
      if (!target) return false;
      setCurrentFile(target);
      setSavedText(text);
      setNotice(null);
      return true;
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : 'Could not save the program.',
      );
      return false;
    } finally {
      setBusy(false);
    }
  }

  function requestOpen(action: () => void) {
    if (dirty) {
      pendingOpenRef.current = action;
      setConfirmOpen(true);
      return;
    }
    action();
  }

  function cancelOpen() {
    pendingOpenRef.current = null;
    setConfirmOpen(false);
  }

  function discardOpen() {
    const action = pendingOpenRef.current;
    pendingOpenRef.current = null;
    setConfirmOpen(false);
    action?.();
  }

  async function saveAndOpen() {
    if (!(await saveCurrent())) return;
    discardOpen();
  }

  async function doOpenProgram() {
    if (busy) return;
    setBusy(true);
    try {
      const file = await platformFileIO.openProgram();
      if (file) loadFile(file);
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : 'Could not open the program.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function doOpenProject() {
    if (busy) return;
    setBusy(true);
    try {
      const folder = await platformFileIO.openProject();
      if (!folder) return;
      setProject(folder);
      const main = mainFileFromFolder(folder);
      if (main) {
        loadFile(main);
      } else {
        setNotice(`No G-code files found in ${folder.name}.`);
      }
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : 'Could not open the folder.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function doOpenProjectFile() {
    if (busy) return;
    setBusy(true);
    try {
      const file = await platformFileIO.openProjectFile();
      if (!file) return;
      const state = parseProjectFile(file.text);
      const targetFlavor = builtinFlavorsById.get(state.flavorId);
      if (!targetFlavor) throw new Error(`Unknown flavor: ${state.flavorId}.`);
      if (!targetFlavor.variants.some((variant) => variant.id === state.variantId)) {
        throw new Error(`Unknown machine variant: ${state.variantId}.`);
      }

      let folder: LoadedFolder | null = null;
      if (state.folderPath && platformFileIO.native) {
        try {
          folder = await platformFileIO.openProjectFolderAt(state.folderPath);
        } catch {
          folder = null;
        }
      }
      if (!folder) {
        folder = await platformFileIO.openProject();
        if (!folder) return;
        if (state.folderName && folder.name !== state.folderName) {
          setNotice(
            `Project folder ${state.folderName} was not found; using ${folder.name}.`,
          );
        }
      }
      const main = resolveMainFile(folder, state.mainProgram);
      if (!main) {
        setNotice(`Could not find ${state.mainProgram} in ${folder.name}.`);
        return;
      }
      setFlavorId(state.flavorId);
      setVariantId(state.variantId);
      setProject(folder);
      loadFile(main);
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : 'Could not open the project file.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function saveProject() {
    if (busy) return;
    setBusy(true);
    try {
      const main: LoadedFile = currentFile ?? {
        path: 'program.nc',
        name: 'program.nc',
        text,
      };
      const document = createProjectFile({
        flavorId,
        variantId,
        folder: project,
        main,
      });
      const baseName = main.name.replace(/\.[^.]+$/, '');
      const name = project?.name ?? (baseName || 'project');
      await platformFileIO.saveProjectFile(name, serializeProjectFile(document));
      setNotice(null);
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : 'Could not save the project file.',
      );
    } finally {
      setBusy(false);
    }
  }

  const handleOpenProgram = () => requestOpen(() => void doOpenProgram());
  const handleOpenProject = () => requestOpen(() => void doOpenProject());
  const handleOpenProjectFile = () => requestOpen(() => void doOpenProjectFile());

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

        <div className="file-actions">
          <button type="button" onClick={handleOpenProgram} disabled={busy}>
            Open program…
          </button>
          <button type="button" onClick={handleOpenProject} disabled={busy}>
            Open project folder…
          </button>
          <button type="button" onClick={handleOpenProjectFile} disabled={busy}>
            Open project file…
          </button>
          <button
            type="button"
            onClick={() => void saveCurrent()}
            disabled={busy}
            title="Save (Ctrl/Cmd+S)"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => void saveCurrent(true)}
            disabled={busy}
          >
            Save as…
          </button>
          <button type="button" onClick={() => void saveProject()} disabled={busy}>
            Save project…
          </button>
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

          <label className="control">
            <span>Default units</span>
            <select
              value={preferences.defaultUnits}
              onChange={(event) =>
                handleDefaultUnitsChange(event.target.value as Units)
              }
            >
              <option value="mm">mm</option>
              <option value="inch">inch</option>
            </select>
          </label>

          <button
            type="button"
            className="default-variant-button"
            onClick={handleUseVariantAsDefault}
            disabled={preferences.defaultVariantByFlavor[flavorId] === variantId}
            title="Remember this variant for the current flavor"
          >
            {preferences.defaultVariantByFlavor[flavorId] === variantId
              ? 'Default variant'
              : 'Use as default'}
          </button>

          <p className="profile-meta">
            {profile?.units.toUpperCase()} · {profile?.orientation} ·{' '}
            {profile?.travels ? 'bounded travels' : 'unbounded travels'}
          </p>
        </div>

        <div className="stock-controls">
          <label className="toggle-control">
            <input
              type="checkbox"
              checked={stockEnabled}
              onChange={(event) => setStockEnabled(event.target.checked)}
            />
            Simulate stock
          </label>

          <label className="control">
            <span>Stock X (mm)</span>
            <input
              type="number"
              min="1"
              step="1"
              disabled={!stockEnabled}
              value={stockX}
              onChange={(event) => setStockX(readNumber(event.target.value, 100))}
            />
          </label>
          <label className="control">
            <span>Stock Y (mm)</span>
            <input
              type="number"
              min="1"
              step="1"
              disabled={!stockEnabled}
              value={stockY}
              onChange={(event) => setStockY(readNumber(event.target.value, 100))}
            />
          </label>
          <label className="control">
            <span>Thickness (mm)</span>
            <input
              type="number"
              min="1"
              step="1"
              disabled={!stockEnabled}
              value={stockThickness}
              onChange={(event) =>
                setStockThickness(readNumber(event.target.value, 20))
              }
            />
          </label>
          <label className="control">
            <span>Top Z (mm)</span>
            <input
              type="number"
              step="1"
              disabled={!stockEnabled}
              value={stockTopZ}
              onChange={(event) => setStockTopZ(readNumber(event.target.value, 0))}
            />
          </label>
          <label className="control">
            <span>Tool Ø (mm)</span>
            <input
              type="number"
              min="0.1"
              step="0.5"
              disabled={!stockEnabled}
              value={toolDiameter}
              onChange={(event) =>
                setToolDiameter(readNumber(event.target.value, 6))
              }
            />
          </label>
          <label className="control">
            <span>Tool tip</span>
            <select
              disabled={!stockEnabled}
              value={toolTip}
              onChange={(event) => setToolTip(event.target.value as ToolTipShape)}
            >
              <option value="flat">Flat</option>
              <option value="ball">Ball nose</option>
              <option value="bull">Bull nose</option>
            </select>
          </label>
          {toolTip === 'bull' && (
            <label className="control">
              <span>Corner R (mm)</span>
              <input
                type="number"
                min="0"
                max={Math.max(toolDiameter, 0.1) / 2}
                step="0.1"
                disabled={!stockEnabled}
                value={cornerRadius}
                onChange={(event) =>
                  setCornerRadius(readNumber(event.target.value, 0.5))
                }
              />
            </label>
          )}
          <label className="control">
            <span>Safe Z (mm)</span>
            <input
              type="number"
              step="1"
              value={safeZ ?? ''}
              onChange={(event) =>
                setSafeZ(
                  event.target.value.trim() === ''
                    ? null
                    : readNumber(event.target.value, 5),
                )
              }
            />
          </label>
        </div>
      </header>

      <main className="workbench">
        {notice && (
          <div className="notice" role="alert">
            <span>{notice}</span>
            <button
              type="button"
              aria-label="Dismiss message"
              onClick={() => setNotice(null)}
            >
              ×
            </button>
          </div>
        )}

        {confirmOpen && (
          <div className="confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
            <div className="confirm-card">
              <h2 id="confirm-title">Unsaved changes</h2>
              <p>{fileName} has edits that have not been saved.</p>
              <div className="confirm-actions">
                <button type="button" onClick={cancelOpen} autoFocus>
                  Cancel
                </button>
                <button type="button" onClick={discardOpen}>
                  Discard and open
                </button>
                <button type="button" onClick={() => void saveAndOpen()} disabled={busy}>
                  Save and open
                </button>
              </div>
            </div>
          </div>
        )}

        <section className="pane editor-pane" aria-labelledby="editor-heading">
          <div className="pane-header">
            <h2 id="editor-heading">Program</h2>
            <span className="pane-hint">
              {fileName}
              {dirty && (
                <span className="dirty-marker" title="Unsaved changes">
                  {' • unsaved'}
                </span>
              )}{' '}
              · {currentFile ? 'opened' : 'in memory'}
            </span>
          </div>
          <div className="editor-host" ref={editorHostRef} />
        </section>

        <section className="pane backplot-pane" aria-labelledby="backplot-heading">
          <div className="pane-header">
            <h2 id="backplot-heading">Backplot</h2>
            <div className="backplot-legend" aria-label="Toolpath legend">
              <span>
                <i className="legend-swatch legend-swatch--rapid" aria-hidden="true" />
                Rapid {toolpath.counts.rapid}
              </span>
              <span>
                <i className="legend-swatch legend-swatch--linear" aria-hidden="true" />
                Linear {toolpath.counts.linear}
              </span>
              <span>
                <i className="legend-swatch legend-swatch--arc" aria-hidden="true" />
                Arc {toolpath.counts.arc}
              </span>
              <span>
                <i className="legend-swatch legend-swatch--cycle" aria-hidden="true" />
                Cycle {toolpath.counts.cycle}
              </span>
              {simulation && (
                <span>
                  <i className="legend-swatch legend-swatch--stock" aria-hidden="true" />
                  Stock
                </span>
              )}
            </div>
          </div>
          <div className="backplot-host" ref={backplotHostRef} />
          {backplotError && (
            <div className="backplot-overlay" role="alert">
              Backplot unavailable: {backplotError}
            </div>
          )}
          {!backplotError && toolpath.moves.length === 0 && (
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

          <div className="verification-summary" aria-label="Verification summary">
            <span>
              <b>{analysis.program.blocks.length}</b> blocks
            </span>
            <span>
              <b>{toolpath.moves.length}</b> moves
            </span>
            <span>
              <b>{toolpath.lengthsMm.total.toFixed(1)}</b> mm travel
            </span>
            <span
              title={cycleTime.reasons.join(' ')}
              className={cycleTime.seconds === null ? 'summary-unavailable' : undefined}
            >
              <b>
                {cycleTime.seconds === null
                  ? 'Unavailable'
                  : formatDuration(cycleTime.seconds)}
              </b>{' '}
              cycle time
            </span>
            {cycleTime.approximateCycles && (
              <span className="summary-note">cycles approximated</span>
            )}
            <span className="summary-spacer" />
            <button type="button" onClick={() => void copyReport()}>
              Copy report
            </button>
            <button type="button" onClick={() => void downloadReport()}>
              Save report…
            </button>
            {reportNotice && (
              <span className="summary-note" role="status">
                {reportNotice}
              </span>
            )}
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
        {dirty && <span>Unsaved changes</span>}
        <span>Travel {toolpath.lengthsMm.total.toFixed(1)} mm</span>
        {simulation && (
          <span>
            Stock{' '}
            {simulation.initialVolumeMm3 > 0
              ? Math.round(
                  (100 * simulation.remainingVolumeMm3) /
                    simulation.initialVolumeMm3,
                )
              : 0}
            % remaining
          </span>
        )}
        <span>
          {counts.all} diagnostics ({counts.error} errors)
        </span>
        {subprograms.length > 0 && (
          <span>
            {project?.name}: {subprograms.length} subprograms
          </span>
        )}
        {analysis.evaluation.approximate && (
          <span>Approximate macro evaluation</span>
        )}
        <span className="status-spacer" />
        <span>{platformFileIO.native ? 'Desktop' : 'Browser'}</span>
        <span>{flavor.name}</span>
      </footer>
    </div>
  );
}
