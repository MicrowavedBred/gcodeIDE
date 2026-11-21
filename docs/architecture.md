# Architecture (proposal)

> Companion to `gcodeIDE-roadmap.md`. This describes module boundaries, not final code.
> Target platforms: **Linux (primary dev) and Windows**. macOS out of scope.

## Stack

- **Tauri 2** desktop shell (Rust only for OS integration).
- **React + TypeScript + Vite** UI.
- **Monaco** editor.
- **three.js** backplot.
- **Vitest** for core tests.
- **pnpm** for package management.

## Locked decisions

- **Brother, Haas, and Fanuc** are equal-priority built-in flavors; GRBL and LinuxCNC are built-in but secondary.
- **4-axis**: parse A-axis moves and show positional backplot in v1. No rotary material removal.
- **Macros**: constrained evaluator — `IF/GOTO`, `#3000` alarms, configurable system variables. Unknown variables warn; no loops or I/O.

## Repository shape: single app, strict core boundary

A monorepo is premature. One app with a pure TypeScript `core` directory gives the same testability with fewer moving parts. If the core later needs a CLI or a second frontend, extract it into a workspace package — the dependency rules below make that mechanical.

```
gcodeIDE/
├── src/
│   ├── core/
│   │   ├── shared/        # units, spans, diagnostics, geometry types
│   │   ├── gcode/         # lexer, parser, AST, modal-state engine
│   │   ├── macros/        # restricted macro evaluator
│   │   ├── interpreter/   # control flow -> canonical moves, offsets, tools
│   │   ├── rules/         # rule engine + baseline catalog
│   │   ├── profiles/      # Flavor, MachineVariant, UserPreferences, built-ins
│   │   └── simulation/    # stock, heightmap, cycle time, geometric checks
│   ├── app/               # React UI, panes, state, commands
│   ├── platform/          # Tauri fs/dialog/preferences adapters
│   ├── workers/           # simulation worker + message protocol
│   └── main.tsx
├── src-tauri/             # Rust shell, capabilities, packaging
├── test/
│   ├── corpus/            # real + seeded .NC files
│   └── fixtures/          # expected diagnostics and move snapshots
├── docs/
└── cnc programs/          # real-world source corpus (read-only reference)
```

## Dependency rules

1. `core/*` must not import React, Tauri, DOM APIs, or Node built-ins.
2. `core/*` accepts plain data in and returns plain data out — no singletons, no hidden IO.
3. `app/*` may import `core/*`, `platform/*`, `workers/*`.
4. `platform/*` may import Tauri APIs only; no G-code logic.
5. `workers/*` may import `core/*`; no React.
6. Use `import type` across boundaries to keep runtime coupling low.
7. No circular dependencies between `core` modules.

These rules let the entire verification pipeline run in Vitest (Node) against the corpus without booting a desktop shell.

## Pipeline

```
files
  → loader (main + subprograms)
  → lexer / parser        (AST + source spans)
  → macro evaluator       (execution order, IF/GOTO, alarms, variables)
  → modal engine          (per-block modal state)
  → interpreter           (canonical moves, work offsets, tool state)
  → simulation            (stock removal, penetration evidence)
  → rules engine          (diagnostics, stock-aware checks)
  → UI                    (diagnostics, backplot, report)
```

Key point: the **interpreter output is the shared contract**. Diagnostics, backplot, cycle time, and later streaming safety all consume the same `Move[]` + `BlockState[]`. Do not let the editor or renderer re-parse G-code.

**Implementation note (v1):** numeric stock simulation runs in a Web Worker; cycle-time estimation is a cheap pure calculation on the UI thread. Both consume the canonical toolpath produced before them.

### Cycle-time contract

- `core/simulation/cycle-time.ts` consumes canonical moves, dwell seconds and a rapid rate in mm/min. Feed time uses each move's modal feed; the modal engine now records that feed on canned-cycle moves too.
- Canned cycles are approximated from XY travel, R plane, Z depth, feed and peck Q. The report marks this as approximate.
- A missing rapid rate, a missing move feed, or a G93/G95 feed mode makes the estimate unavailable with explicit reasons. No default rate is inferred from a variant's feed limit.
- The UI summary and verification report present the same estimate and reasons.

## Module responsibilities

| Module | Owns | Must not |
| --- | --- | --- |
| `core/shared` | Units, `SourceSpan`, `Diagnostic`, `Pose`, `Move`, `BlockState` types | Know about flavors, files, or UI. |
| `core/gcode` | Lexing, parsing, AST, modal state transitions, code-word semantics | Resolve files, run macros, or render. |
| `core/macros` | Restricted expression evaluation, `IF/GOTO`, `#3000`, variable store | Full macro language, I/O, or loops beyond the agreed subset. |
| `core/interpreter` | Program control flow, subprogram stack, offsets (`G54.1`, `G10 L20`, `G52`, `G68`), tool state, move emission, canonical toolpath sampling and bounds | UI concerns or diagnostic policy. |
| `core/rules` | Rule interface, baseline rules, severity resolution, profile overrides | Mutate interpreter state. |
| `core/profiles` | Flavor/variant/preference types, built-in definitions, resolution, validation, custom M-codes, system variables | Contain G-code parsing logic. |
| `core/simulation` | Stock model, height-map removal, cycle-time estimation, geometric checks | Parse G-code or know about React. |

**Implementation note (v1):** `core/gcode/modal.ts` currently holds modal transitions, `G52`/`G68`/`G54.1` frame resolution, macro control flow, the `M98`/`M99` call stack and the block evaluator. Split macro execution into `core/macros` and the execution controller into `core/interpreter` later; the public `evaluateProgram`/`applyBlock` surface and `ProgramSet` input are written to survive that split.
| `app` | Layout, editor models, command palette, panels, state orchestration | Implement G-code semantics. |
| `platform` | File open/save, project folders, preferences persistence, dialogs | Interpret programs. |
| `workers` | Off-main-thread simulation, request IDs, cancellation | Touch the DOM. |

## 4-axis handling (positional)

- `Pose` carries an optional `a` angle in degrees.
- Work offsets (`G54.1`, `G10 L20`) and `G52`/`G68` transforms are resolved in the interpreter before move emission.
- The variant geometry supplies the A-axis rotary center and axis; backplot rotates the part/toolpath about that center.
- Height-map material removal remains 3-axis in v1. Moves at a non-zero A angle are still drawn, but stock is not carved for the rotated setup; the verification report calls this out.
- Lathe support later reuses `Pose` but not the mill rotary-center model.

## Macro evaluator scope

Supported in v1:

- `IF[<expr> <EQ|NE|GT|LT|GE|LE> <expr>] GOTO <label>`
- `#3000=1(message)` alarm
- System-variable reads: `#3700`, `#11003`, `#11006`, `#11032`, configurable through the flavor/variant
- Simple arithmetic in expressions where needed by the corpus

Explicitly deferred:

- `WHILE`/`DO` loops, `GOTO` without `IF`, macro subroutines (`G65`), I/O, and full variable ranges.
- Unknown system variables produce `unknown-system-variable` warnings and evaluate as unknown, so downstream branches are marked approximate rather than silently assumed.

## Core interfaces (first draft)

```ts
type Severity = 'error' | 'warning' | 'info' | 'off';
type FileId = string;

interface SourceSpan {
  file: FileId;
  line: number;       // 1-based
  column: number;     // 1-based
  length?: number;
}

interface Diagnostic {
  ruleId: string;
  severity: Severity;
  message: string;
  span: SourceSpan;
  related?: SourceSpan[];
  data?: Record<string, unknown>;
}

interface Pose {
  x: number; y: number; z: number; // mm, machine or work frame per context
  a?: number;                       // degrees, 4th axis
}

type Move =
  | { kind: 'rapid' | 'linear'; from: Pose; to: Pose; feed?: number; line: number }
  | { kind: 'arc'; from: Pose; to: Pose; plane: 'XY' | 'ZX' | 'YZ'; clockwise: boolean;
      center?: [number, number]; radius?: number; feed: number; line: number }
  | { kind: 'dwell'; seconds: number; line: number }
  | { kind: 'tool-change'; tool: number; line: number }
  | { kind: 'spindle'; rpm: number; direction: 'cw' | 'ccw' | 'stop'; line: number }
  | { kind: 'coolant'; state: 'on' | 'off' | 'mist'; line: number }
  | { kind: 'alarm'; code: number; message: string; line: number };

interface BlockState {
  line: number;
  modal: ModalState;     // units, distance mode, plane, feed mode, motion, comp, cycles...
  workOffset: Pose;      // active offset translation
  tool: { number: number; lengthOffset?: number; radius?: number };
}

interface EvaluationResult {
  diagnostics: Diagnostic[];
  moves: Move[];
  blockStates: BlockState[];
  cycleTimeSec: number;
}
```

`ModalState` is specified in [`docs/modal-state.md`](./modal-state.md), including modal groups, flavor defaults, transition order, transforms, and diagnostics ownership.

## Flavor data flow

- Built-in flavors are static TypeScript data in `core/profiles/builtin/`.
- Custom profiles are full clones of one built-in flavor/variant pair, stored as `user` flavors in the v2 settings document. A clone carries `baseFlavorId`; its variant carries `baseVariantId` so malformed stored fields can recover from the correct source variant. Built-ins are never modified.
- Clones are validated on load: unknown bases, missing names/variants and duplicate ids are dropped; invalid fields fall back to the source variant. Rule severities and structured overrides are preserved.
- The combined built-in + user catalog drives both profile resolution and preference validation, so saved defaults can point at a custom flavor.
- Resolution produces a `ResolvedMachineProfile` consumed by parser/modal/interpreter/rules/simulation.
- Custom M-codes and system variables live in the flavor/variant data, not in code branches.

## Threading

- Parsing, macro evaluation, modal state, interpretation, and rules run on the main thread. Real programs are thousands of lines, not millions; this keeps diagnostics snappy and simple.
- Stock removal runs in a Web Worker; cycle-time estimation stays on the UI thread.
- Requests carry a monotonically increasing ID; stale results are discarded on new edits.
- Re-evaluate on a short debounce (150–250 ms) initially; incremental parsing is a later optimization.

## Persistence

- **Project folder**: `project.json` + `programs/` + `subprograms/`. Relative paths make subprogram resolution deterministic.
- **Single-file open**: wrap the file in an ephemeral project rooted at its directory, so `M98` resolution still works.
- **Preferences and custom profiles**: one versioned app settings document (`{ version: 2, preferences, customFlavors }`) holds global defaults (units, per-flavor default variant) and full flavor clones. Native builds resolve the Tauri app-config directory inside bounded Rust commands so the webview never supplies a path; browser dev uses localStorage. Version 1 documents are migrated to an empty clone list. Loaded values are validated against the combined built-in + user catalog, so stale or unknown ids fall back to shipped defaults instead of resolving to a missing profile. Project files still carry their explicit flavor and variant.

## Testing strategy

| Layer | Test type |
| --- | --- |
| Lexer/parser | Unit tests per word/comment/expression form. |
| Modal engine | Golden state snapshots at every block of corpus programs. |
| Macro evaluator | Branch tables for `IF/GOTO` and `#3000`; unknown-variable warnings. |
| Interpreter | Golden `Move[]` JSON snapshots. |
| Rules | One positive/negative corpus case per rule. |
| Profiles | Resolution and validation snapshots. |
| Simulation | Height-map assertions on small fixtures; cycle-time tolerance (~5%). |
| UI | Playwright later; not part of Phase 1 gate. |

## Build and CI

- **Linux**: Tauri 2 requires WebKitGTK and related system packages; produce AppImage and/or `.deb`.
- **Windows**: produce MSI/NSIS via `tauri build`.
- **CI**: GitHub Actions matrix `ubuntu-latest` + `windows-latest`; macOS jobs omitted.
- Keep the Rust side minimal until machine control arrives.

## Explicit non-goals for v1

- No plugin runtime, no dynamic flavor loading from untrusted code.
- No machine streaming or serial/USB layers.
- No CAM geometry engine.
- No rotary/4-axis material removal in v1.
- No full macro engine (loops, `WHILE`, I/O, `G65`).
- No telemetry or cloud sync.

## Open architecture questions

Tracked in `gcodeIDE-roadmap.md` under **Open decisions**:

- When (if ever) to extract `core` into a standalone package.
- Whether the A-axis rotary center belongs to variant geometry or a separate machine-kinematics block (currently variant geometry).
- Whether configurable system variables belong to the flavor or the variant.
- When rotary material removal becomes worth the complexity.
