# CNC IDE Roadmap (working document)

> Living document. Last updated: 2026-11-19.
> Workspace: `/home/bread/Documents/Opencode/gcodeIDE`.
> Targets: **Linux (primary dev) and Windows**. macOS explicitly out of scope.
> This file is the single source of truth for scope and sequencing. Expand it as decisions are made.

---

## Decision log

| Date | Decision | Notes |
| --- | --- | --- |
| 2026-11-19 | Desktop app first | Tauri preferred (React + TypeScript + Monaco + three.js); Electron fallback if serial/USB ecosystem wins later. |
| 2026-11-19 | No CAM in MVP | Future phase. |
| 2026-11-19 | No machine control / DNC in MVP | Future phase; core is designed to support it later. |
| 2026-11-19 | Mill-first | Lathe in Phase 3. |
| 2026-11-19 | Simulation depth: backplot + stock removal | No fixture/kinematic collision in MVP. |
| 2026-11-19 | Minimal first release | No tool library, no setup sheets in first usable release. |
| 2026-11-19 | Custom profiles = clone a built-in flavor and edit | Built-in flavors: Haas Mill, Fanuc Mill, GRBL, LinuxCNC Mill. |
| 2026-11-19 | Distribution model undecided | Keep core platform-agnostic; defer license/plugin commitments. |
| 2026-11-19 | Flavors have no fixed size | Travels unspecified/unbounded by default; default orientation vertical, selectable. |
| 2026-11-19 | Per-flavor default machine variant | User selects a variant (e.g. Haas VF-2) per flavor; new programs using that flavor inherit it. |
| 2026-11-19 | Metric default, user-configurable | Global user preference defaults to mm; per-variant override available. |
| 2026-11-19 | Baseline diagnostics accepted | 14 core rules + 2 macro/custom-code warnings; see Appendix B. |
| 2026-11-19 | Subprograms moved to Phase 1 core | M98/M99 parsing and project-folder resolution required for MVP. |
| 2026-11-19 | Target platforms: Linux + Windows | macOS explicitly out of scope. Tauri supports both; CI matrix covers both. |
| 2026-11-19 | Real corpus is Brother Speedio S700XD2 | 9 `.NC` programs + `OFFSET.OFS`; 4-axis A, `G54.1`/`G10 L20` offsets, `G52`/`G68` transforms, `G77` tapping, custom M-codes, limited macros. |
| 2026-11-19 | Brother, Haas, Fanuc equal priority | GRBL/LinuxCNC remain built-in but secondary. |
| 2026-11-19 | 4-axis: parse + positional backplot | A-axis tracked, offsets applied, toolpath rotated; no rotary material removal in v1. |
| 2026-11-19 | Constrained macro evaluator in MVP | `IF/GOTO`, `#3000` alarms, configurable system variables; unknown variables warn. |

---

## Product thesis

A CNC IDE should be the connective tissue between the **program**, the **verification**, and the **machine**. For v1, machine control and CAM are deferred, so the product is a *G-code workbench*:

> Import G-code → understand it semantically per machine flavor → simulate it against a stock model → flag problems before anyone runs it.

The architectural centerpiece is a **shared program model + interpreter/modal-state engine**. Editor diagnostics, backplot, cycle-time estimate, and (later) streaming safety all consume the same interpreted program. Four separate parsers would disagree — and in this domain disagreement is dangerous.

---

## MVP scope (first usable release)

### In
- Local-first desktop app.
- Open/import G-code files; project = program + selected flavor/variant + notes.
- Monaco editor with G-code syntax highlighting, snippets, folding.
- Dialect-aware lexer/parser and **modal-state engine** (units, work offsets, tool length comp, cutter comp, plane, feed/spindle modes, canned cycles).
- Built-in **mill flavors**: Brother Speedio, Haas, Fanuc, GRBL, LinuxCNC (Brother/Haas/Fanuc equal priority; GRBL/LinuxCNC secondary).
- **Custom machine profiles** created by cloning a built-in flavor/variant and editing fields.
- **Per-flavor user defaults**: choose a machine variant (e.g. Haas VF-2) and it is applied to every new program using that flavor.
- **Basic M98/M99 subprogram support**: parsing, call stack with depth limit, and resolution from the project folder.
- **Constrained macro evaluator**: `IF/GOTO`, `#3000` alarms, configurable `#3700`/`#11003`/`#11006`/`#11032`; unknown system variables warn.
- **Custom M-code registry** per flavor so vendor codes (e.g. Brother `M400`/`M494`/`M800`) are described, not flagged unsupported.
- **4-axis A parsing** and positional backplot; material removal stays 3-axis in v1.
- Diagnostics panel: severity, line jump, plain-English explanations.
- Interpreter → canonical move list (rapid / linear / arc / canned cycle).
- 2D/3D backplot with tool shapes and color-coded moves.
- Rectangular stock model + height-map material removal.
- Travel-limit checks, gouge / air-cut detection, cycle-time estimate.
- In-app verification report.
- Snapshots/undo of program edits.

### Out (explicitly)
- CAM of any kind.
- Machine control, DNC, jog, MDI, streaming.
- Tool/material library, feeds/speeds calculator.
- Setup sheet export, revisions/diff, templates beyond editor snippets.
- Lathe support (Phase 3).
- Fixture/vise/chuck/tool-holder collision simulation.
- Rotary/4-axis material removal.
- Full macro engine (loops, `WHILE`, I/O), conversational dialects (Mazatrol/Heidenhain-style).
- Multi-user, fleet monitoring, telemetry.

---

## Flavors, machine variants, and user defaults

Three distinct concepts — keeping them separate is what lets one dialect family span many machines:

1. **Flavor** — a dialect family: Haas Mill, Fanuc Mill, GRBL, LinuxCNC Mill. It defines syntax, supported codes, canned cycles, compensation behavior, code overrides, baseline rules, and a catalog of known machine variants. **A flavor itself has no size**: travels are unspecified/unbounded unless a variant is chosen.
2. **Machine variant** — concrete geometry and orientation for a flavor: e.g. `haas-vf2` (30" × 16" × 20"), or the always-present `unspecified` variant with unbounded travels. Default orientation is **vertical** and is selectable per variant.
3. **User preferences** — global choices: default units (**metric**) and the **default variant per flavor**. If the user sets VF-2 as the Haas Mill default, every new program selecting Haas Mill resolves to VF-2.

Resolution when a program selects a flavor:

```
Flavor → UserPreferences.defaultVariantByFlavor[flavorId]
       → concrete MachineVariant (fallback: that flavor's 'unspecified' variant)
```

Units precedence: `MachineVariant.units` (`mm` / `inch` / `inherit`) → user preference (default `mm`). Internal storage is always **millimetres**; conversion happens only at the UI boundary.

Custom profiles remain clone-and-edit: clone a variant (usually `unspecified`) and adjust geometry, orientation, dialect overrides, and rules.

---

## Reference corpus reality: Brother Speedio

The first real-world target is the repository's `cnc programs/Brother/` corpus — nine `.NC` programs plus `OFFSET.OFS`, all metric, for a **Brother Speedio S700XD2** with a 4th (A) axis.

Observed features that must be modeled:

| Area | Observed in corpus |
| --- | --- |
| Offsets | `G10 L20 Pn X.. Y.. Z.. A..`, `G54.1 Pn` extended offsets, `G10 G90 L10/L11/L12/L13 Pn R..` in `OFFSET.OFS`. |
| Motion | `G0`/`G1`/`G2`/`G3`, `G53` machine-coordinate moves, A-axis positioning (`A0`, `A90`, `A180`, `A-90`, `A340`), `G4X1` dwell. |
| Transforms | `G52` local translation, `G68`/`G69` coordinate rotation. |
| Cycles | `G81`, `G83` with `P`, `G73` with `Q`, `G77` tapping (Brother-specific), `G98` return plane. |
| Compensation | `G43 H..` and `G43 L.. H..`, `G41`/`G42`/`G40`. |
| Custom M-codes | `M400`/`M401`, `M494`/`M495`, `M496`/`M497`, `M501`, `M800`/`M801` — descriptions unknown, must be user-definable. |
| Macros | `IF[#.... EQ/NE/GT/LT/GE/LE ....] GOTO n`, `#3000=1(message)`, system variables `#3700`, `#11003`, `#11006`, `#11032`. |
| Subprograms | None observed in this corpus; `M98`/`M99` remains a requirement for other sources. |

Proposed impact (pending confirmation):
- Add **Brother Speedio** as a built-in flavor, likely the primary v1 target.
- Add **4-axis A positioning** to the interpreter and backplot; stage material-removal support for rotary setups.
- Add a **constrained macro evaluator**: `IF/GOTO`, `#3000` alarms, configurable system variables. Unknown system variables warn rather than silently pass.
- Add a **custom M-code registry** per flavor so vendor codes are described, not flagged unsupported.
- Extend the baseline corpus schema with Brother-specific positive/negative programs.

---

## Roadmap

| Phase | Focus | Key deliverables | Exit milestone | Rough time |
| --- | --- | --- | --- | --- |
| 0 | Definition | Flavor/variant/preference schema, reference corpus, acceptance criteria, stack confirmation | Written spec + corpus committed | 1–2 wks |
| 1 | Core IDE + flavors | Desktop shell, project model, Monaco editor, lexer/parser, modal-state engine, built-in flavors + variants (Brother, Haas, Fanuc, GRBL, LinuxCNC), user defaults, clone/edit UI, **M98/M99 subprograms**, **constrained macro evaluator**, custom M-code registry, diagnostics panel | Open a real Brother/Haas/Fanuc program with subprograms and macros; get correct per-flavor warnings | 4–6 wks |
| 2 | Verification | Interpreter → moves, 2D/3D backplot, **4-axis positional transforms**, tool shapes, 3-axis stock + height-map removal, canned cycles, cycle time, travel/gouge/rules checks, verification report | Simulate any imported mill program against its resolved variant | 6–10 wks |
| 3 | Lathe support | Fanuc/Haas lathe flavors, diameter programming, U/W, G96/G97, lathe cycles (G71/G72/G70/G74/G75/G76), turret view, rotational stock | Same IDE handles lathe programs | 6–8 wks |
| 4 | Customization depth | Full profile editor, configurable rule engine/severity, custom warnings, advanced subprogram/macro handling, advanced diagnostics | Users model their actual machine without touching code | 3–4 wks |
| 5 | Workflow extras | Tool/material library, feeds/speeds, revisions/diff, setup sheets, templates | Daily-driver usable beyond verification | 4–6 wks |
| Future | Machine control | Driver abstraction, GRBL/LinuxCNC/Haas/Fanuc connectors, jog/MDI/stream, safety gates, audit log | Safely stream a verified program | — |
| Future | CAM-lite | 2.5D mill ops, lathe ops, DXF import, post processors, simulate-before-export | Import/sketch → generate → simulate → post | — |
| Future | Advanced | Digital twins, live tooling/sub-spindle, plugin marketplace, monitoring dashboard | — | — |

**Ordering rationale:** the interpreter must precede both simulation and streaming safety, so Phases 1–2 are non-negotiable. Subprograms are pulled into Phase 1 because real Haas/Fanuc programs depend on them. Lathe follows immediately while the interpreter is fresh. Connectivity and CAM are deliberately gated until the core is trustworthy.

---

## Phase details

### Phase 0 — Definition
- Confirm Tauri + React + TypeScript + Monaco + three.js.
- Finalize Flavor / MachineVariant / UserPreferences schema (Appendix A).
- Finalize baseline diagnostic rule catalog and corpus (Appendix B).
- Assemble reference corpus with expected results.
- Write acceptance criteria:
  - 95%+ of corpus parses with zero false-positive errors.
  - Modal state correct at every line.
  - Cycle time within ~5% of a trusted estimate on sample parts.
  - All baseline rules (14 core + 2 macro/custom-code) each have a seeded corpus case that triggers them correctly.
  - Subprogram call/return resolves correctly for nested calls up to the depth limit.
- Decide repo structure and test strategy (parser/modal unit tests, golden interpreted-move snapshots, visual backplot checks).

### Phase 1 — Core IDE + flavors
- App shell, project file format, file I/O, snapshots/undo.
- Monaco editor + G-code grammar + snippets.
- Parser + modal-state engine driven by active flavor/variant.
- Built-in flavors with variant catalogs (Brother, Haas, Fanuc, GRBL, LinuxCNC); `unspecified` variant with unbounded travels and vertical orientation.
- User preferences: metric default and per-flavor default variant selection.
- Clone/edit UI for custom profiles.
- **M98/M99 subprogram parsing, depth-limited call stack, project-folder resolution.**
- **Constrained macro evaluator**: `IF/GOTO`, `#3000`, configurable system variables, unknown-variable warnings.
- **Custom M-code registry** with per-flavor descriptions.
- **Rules engine** with per-flavor/variant severity overrides for the baseline catalog (tool length comp, arcs, travels, cutter comp, units, feeds/spindle, program end).
- Diagnostics panel with severity, line navigation, explanations.
- *Milestone:* open real Brother/Haas/Fanuc programs with subprograms and macros; correct per-flavor warnings.

### Phase 2 — Verification
- Flavor-aware interpreter producing canonical moves.
- **4-axis positional transforms**: A-axis rotation about the machine's rotary center, applied to work offsets and displayed toolpaths.
- three.js backplot: tool shapes, rapid/feed/arc/canned-cycle coloring, rotated 4-axis positions.
- Rectangular stock + **3-axis** height-map removal (rotary regions flagged, not carved).
- Canned cycles (G81–G89, G73, G83, G84, G77 as supported by flavor).
- Travel-limit (bounded variants only), gouge, rapid-through-stock and clearance checks; cycle-time estimate.
- In-app verification report.
- *Milestone:* simulate any imported mill program against its resolved variant, including positional 4-axis work.

### Phase 3 — Lathe support
- Fanuc Lathe / Haas Lathe flavors.
- Diameter-programmed X, U/W incremental, G96/G97 CSS with RPM clamping.
- Lathe cycles: G71/G72/G73/G70/G74/G75/G76.
- Rotational stock model and 2D lathe view; turret representation.
- Extend interpreter/rules for lathe-specific diagnostics.

### Phase 4 — Customization depth
- Full profile editor (extend clone/edit from Phase 1).
- User-defined rules and custom warning scripting on top of the baseline engine.
- Advanced subprogram/macro handling.

### Phase 5 — Workflow extras
- Tool/material library with real geometry.
- Feeds/speeds calculator.
- Revisions/diff, notes, setup sheet PDF, templates.

---

## Design principles

1. **One interpreter, many consumers** — diagnostics, backplot, time estimate, and later streaming safety all read the same interpreted program.
2. **Flavors are dialect; machines are geometry** — one flavor can span many machine sizes without duplicating semantics.
3. **Profiles are data, not code** — dialects and machine behavior live in editable profiles.
4. **Conservative diagnostics** — when unsure, warn rather than silently pass. False positives are tolerable; false negatives are not.
5. **Test against real programs** — the corpus is the spec.
6. **Internal units are millimetres** — convert only at the UI boundary.
7. **Lathe is a first-class citizen eventually**, but mill-first proves the architecture without doubling early complexity.
8. **Offline-first, no telemetry by default.**
9. **Real corpus drives priority** — Brother, Haas, and Fanuc are equal; the corpus decides what gets built first.

---

## Risks & mitigations

| Risk | Mitigation |
| --- | --- |
| Dialect quirks / macro complexity | Reference corpus, per-flavor code overrides, conservative "unknown = warn" behavior. |
| False-positive diagnostics erode trust | Corpus-driven rule tuning, severity overrides, per-rule disable. |
| Modal-state bugs | Unit tests per code; golden state snapshots at every corpus line. |
| Height-map performance on large programs | Typed arrays, Web Workers, progressive refinement; cap resolution by variant. |
| Unbounded `unspecified` variant hides real travel problems | Clearly label verification as geometry-agnostic; encourage selecting a real variant for pre-flight checks. |
| Scope creep into CAM/control | Hard boundary through Phase 5; revisit only with an explicit decision. |
| Safety expectations despite "no control" | Clearly label output as verification-only; never imply machine-ready authorization. |

---

## Open decisions

- Final stack: Tauri vs Electron (decide in Phase 0).
- When (if ever) to add rotary/4-axis material removal.
- Whether other shops need additional macro constructs or system variables beyond the Brother subset.
- Which concrete variants ship in each built-in flavor catalog (e.g. Haas VF-2/VF-3, Fanuc 0i-M generic, Brother Speedio S700XD2, GRBL 3018, LinuxCNC generic). Flavors themselves stay sizeless.
- Stock shape/origin conventions per flavor and variant.
- Whether user preferences live in a global settings file with per-project overrides (leaning that way).
- Distribution/license model (deferred).

---

## Next steps

1. Add native file open and platform-side project folder → `ProgramSet` resolution for externally stored subprograms.
2. Refactor move emission into the canonical `Move[]` interpreter output under `core/interpreter` and feed the backplot from it.
3. Add stock height-map simulation and the two geometry-dependent rules (`rapid-through-stock`, `unsafe-z-clearance`) end-to-end.
4. Expand reference programs for each flavor (arcs, cycles, offsets, macros) as negative corpus cases are added.

### Implementation status

| Area | State |
| --- | --- |
| Lexer / parser | Done; zero lexical errors across the Brother corpus. |
| Modal-state engine | Done for mill motion, units, offsets, transforms, cycles, macros, 4-axis positioning. |
| Macro evaluator | `IF/GOTO` with forward label search, `#3000` alarms, unknown-variable approximation. |
| Rules engine | 13 rule implementations + modal-owned diagnostics, severity overrides per flavor/variant. |
| Brother flavor | Built-in; S700XD2 variant + unbounded `unspecified` default. |
| Corpus tests | Golden executed-block and move counts for all 10 Brother files. |
| Subprogram execution | `M98`/`M99` call stack, repeat counts, depth limit, `ProgramSet` file resolution. |
| Other flavors | Built-in Haas, Fanuc, GRBL, LinuxCNC + reference programs in `test/fixtures/programs/`. |
| Tauri shell / UI | Tauri 2 shell scaffolded in `src-tauri/`; Monaco editor, diagnostics panel, and three.js backplot wired in memory. Native file open pending. |

---

## Appendix A — Draft data model v1 (Phase 0 artifact)

```ts
type Severity = 'error' | 'warning' | 'info' | 'off';
type Units = 'mm' | 'inch';

interface Flavor {
  id: string;                       // 'haas-mill'
  name: string;                     // 'Haas Mill'
  vendor?: string;
  source: 'builtin' | 'user';
  machineType: 'mill' | 'lathe';    // v1: 'mill' only
  dialect: DialectSettings;
  codeOverrides: Record<string, CodeOverride>; // dialect-specific semantics
  capabilities: CapabilityFlags;    // baseline for the flavor
  rules: Record<string, Severity | RuleOverride>;
  display: DisplaySettings;         // defaults; variants may override
  customMCodes: Record<string, CustomMCodeDef>;   // vendor M-codes
  systemVariables: Record<string, SystemVariableDef>; // macro inputs
  variants: MachineVariant[];       // always includes 'unspecified'
  metadata: EntityMetadata;
}

interface CustomMCodeDef {
  code: string;                     // 'M400'
  description: string;              // user-facing explanation
  category?: 'clamp' | 'coolant' | 'door' | 'conveyor' | 'probe' | 'other';
  affectsSimulation?: boolean;      // false => event only
}

interface SystemVariableDef {
  number: string;                   // '#3700'
  description: string;
  value?: number | 'unknown';
  configurable: boolean;
}

interface MachineVariant {
  id: string;                       // 'haas-vf2' | 'unspecified'
  flavorId: string;
  name: string;                     // 'VF-2' | 'Unspecified'
  isUnspecified?: boolean;          // true => unbounded travels, no assumed stock
  geometry: GeometrySettings;       // travels may be null/unbounded
  orientation: 'vertical' | 'horizontal'; // default 'vertical'
  units: Units | 'inherit';         // default 'inherit' -> user preference
  capabilityOverrides?: Partial<CapabilityFlags>;
  ruleOverrides?: Record<string, Severity | RuleOverride>;
  displayOverrides?: Partial<DisplaySettings>;
  metadata: EntityMetadata;
}

interface UserPreferences {
  defaultUnits: Units;                          // default 'mm'
  defaultVariantByFlavor: Record<string, string>; // flavorId -> variantId
  // theme, panel layout, etc.
}

// Composition produced when a program selects a flavor.
interface ResolvedMachineProfile {
  flavor: Flavor;
  variant: MachineVariant;
  units: Units;                     // resolved from variant + preferences
  travels: Travels | null;          // null => unbounded
  orientation: 'vertical' | 'horizontal';
  capabilities: CapabilityFlags;
  rules: Record<string, Severity | RuleOverride>;
  display: DisplaySettings;
}

interface DialectSettings {
  nativeUnits?: Units;                  // informational hint only
  allowUnitSwitch: boolean;             // G20/G21
  workOffsets: string[];                // ['G54', ..., 'G59', 'G54.1 P1']
  toolLengthComp: {
    enabled: boolean;
    register: 'H';
    requiredWithToolChange: boolean;
  };
  cutterComp: {
    enabled: boolean;
    activate: ['G41', 'G42'];
    cancel: 'G40';
    requiresD: boolean;
  };
  arcCentering: 'IJ' | 'R' | 'both';
  planeSelect: boolean;                 // G17/G18/G19
  cannedCycles: string[];               // ['G81','G82','G83','G84','G85','G73','G89']
  subprograms: {
    enabled: boolean;
    call: 'M98';
    end: 'M99';
    maxDepth: number;
  };
  macroSupport: 'none' | 'basic' | 'full';
  macros: {
    enabled: boolean;
    ifGoto: boolean;
    alarmVariable: '#3000';
    maxIterations: number;          // max GOTO jumps; guards runaway loops
  };
  toolChange: { code: 'M06'; requiresT: boolean };
  spindle: { rpmRange: [number, number]; cssSupported: boolean };
  feedMode: 'G94' | 'G95';
  programEnd: 'M30' | 'M02';
  home: { code: 'G28' | 'G30'; requiresIntermediate: boolean };
}

interface CodeOverride {
  meaning?: string;
  parameters?: string[];
  unsupported?: boolean;
  note?: string;
}

type Travel = [number, number] | null; // null => unbounded on that axis
interface Travels { x: Travel; y: Travel; z: Travel }

interface GeometrySettings {
  travels: Travels | null;          // null => entirely unbounded
  rotaryAxes?: {
    a?: {
      center: [number, number, number]; // machine-space pivot, mm
      axis: 'x' | 'y' | 'z';            // rotation axis
      range: [number, number];           // degrees
    };
  };
  maxFeedRate?: number;
  rapidRate?: number;
  tableSize?: [number, number];
}

interface CapabilityFlags {
  supportsCutterComp: boolean;
  supportsToolLengthComp: boolean;
  supportsCannedCycles: boolean;
  supportsSubprograms: boolean;
  supportsMacros: boolean;
  supportsRigidTapping: boolean;
  maxAxes: number;
}

interface RuleOverride {
  severity: Severity;
  message?: string;
  threshold?: number;
}

interface DisplaySettings {
  machineView: 'mill3axis' | 'mill2d' | 'lathe2d'; // v1: mill views only
  stockShape: 'rectangular' | 'cylindrical';
  defaultStock: {
    size: [number, number, number];
    origin: 'center-top' | 'corner-bottom' | 'custom';
  } | null;                         // null for 'unspecified' variant
}

interface EntityMetadata {
  createdAt: string;
  updatedAt: string;
  notes?: string;
}
```

Built-in flavor seeds (sizeless by default):

| Flavor | Dialect traits | Stock variants |
| --- | --- | --- |
| Brother Speedio | 4-axis A, `G54.1` extended offsets, `G10 L20`, `G52`/`G68`, `G77` tapping, custom M-codes, limited macros | `unspecified` (default), `speedio-s700xd2`, user-added |
| Haas Mill | Fanuc-like, G54–G59, G43 H, G41/G42 D, rich canned cycles, subprograms, limited macros | `unspecified` (default), `haas-vf2`, `haas-vf3`, user-added |
| Fanuc Mill | Conservative subset, cycle semantics per control series, subprograms, macros configurable | `unspecified` (default), `fanuc-0im-generic`, user-added |
| GRBL | G0/G1/G2/G3, G20/G21, G54–G59, no cutter comp, no canned cycles, no subprograms | `unspecified` (default), `grbl-3018`, user-added |
| LinuxCNC Mill | Flexible G-code, G43, cutter comp, canned cycles, configurable travels | `unspecified` (default), `linuxcnc-generic`, user-added |

---

## Appendix B — Baseline rules and reference corpus (Phase 0 artifact)

### Baseline rule catalog

| Rule ID | Default severity | Description |
| --- | --- | --- |
| `missing-tool-length-comp` | error | Tool change without `G43`/`H`. |
| `arc-plane-mismatch` | error | Arc command inconsistent with active plane. |
| `travel-limit-exceeded` | error | Commanded position outside variant travels (bounded variants only). |
| `unsafe-cutter-comp-rapid` | error | Rapid while `G41`/`G42` active. |
| `tool-change-while-comp-active` | error | `T`/`M06` while compensation active. |
| `unit-mismatch` | warning | Program units differ from resolved profile/user default. |
| `unsupported-code` | warning | Code not supported by the active flavor. |
| `duplicate-sequence-number` | warning | Repeated `N` value. |
| `missing-absolute-mode` | warning | Program never establishes `G90`/`G91`. |
| `feed-out-of-range` | warning | `F` outside variant limits. |
| `spindle-out-of-range` | warning | `S` outside spindle range. |
| `rapid-through-stock` | warning | Rapid path intersects stock material. |
| `missing-program-end` | warning | No `M30`/`M02`. |
| `unsafe-z-clearance` | warning | Z rapid below configured safe height. |
| `unknown-system-variable` | warning | Macro references a system variable with no configured value. |
| `unknown-custom-mcode` | warning | Vendor M-code not defined in the active flavor. |

### Positive programs (must parse cleanly and simulate correctly)

| File | Flavor | Exercises |
| --- | --- | --- |
| `Brother/O1801.NC` | Brother Speedio | 4-axis positioning, `G54.1`/`G10 L20` offsets, `G77` tapping, custom M-codes, `IF/GOTO` + `#3000`. |
| `Brother/O3690.NC` | Brother Speedio | `G52`/`G68` transforms, `G83 P`, cutter comp, A-axis work at A-90/A0. |
| `Brother/O4697.NC` | Brother Speedio | `G73 Q`, `G52`/`G68`/`G69`, many custom M-codes. |
| `Brother/OFFSET.OFS` | Brother Speedio | `G10 G90 L10–L13 Pn R..` offset file parsing. |
| `haas_face_drill.nc` | Haas Mill | G21/G17/G90, G54, G43 H01, facing, G81/G83 peck drilling, M30. |
| `haas_pocket_comp.nc` | Haas Mill | G41/G42 D02, arcs with I/J and R, G40 cancel, work offsets. |
| `haas_subprogram.nc` | Haas Mill | M98/P repeated slot, nested M99 return. |
| `fanuc_boltpattern.nc` | Fanuc Mill | Fanuc canned-cycle variant, incremental/absolute mix, tool change. |
| `grbl_router.nc` | GRBL | Rapid/line/arc only, metric, G54; no false errors for unsupported features. |
| `linuxcnc_offset.nc` | LinuxCNC Mill | G10 L2 offset set, G54, G43, tool change, metric/inch switch. |

### Negative programs (each must trigger its rule)

| File | Rule ID | Expected diagnostic |
| --- | --- | --- |
| `bad_missing_g43.nc` | `missing-tool-length-comp` | Tool change without `G43`. |
| `bad_arc_plane.nc` | `arc-plane-mismatch` | Arc commanded in wrong plane. |
| `bad_travel.nc` | `travel-limit-exceeded` | Position exceeds travels (run with bounded `haas-vf2` variant). |
| `bad_units.nc` | `unit-mismatch` | Inch program on metric profile. |
| `bad_comp_rapid.nc` | `unsafe-cutter-comp-rapid` | Rapid while `G41` active. |
| `bad_unsupported_cycle.nc` | `unsupported-code` | Canned cycle used on GRBL flavor. |
| `bad_duplicate_seq.nc` | `duplicate-sequence-number` | Repeated `N` number. |
| `bad_no_g90.nc` | `missing-absolute-mode` | Program never sets `G90`/`G91`. |
| `bad_feed_range.nc` | `feed-out-of-range` | `F` exceeds variant max feed. |
| `bad_spindle_range.nc` | `spindle-out-of-range` | `S` exceeds spindle range. |
| `bad_rapid_through_stock.nc` | `rapid-through-stock` | Rapid traverses stock. |
| `bad_no_m30.nc` | `missing-program-end` | No `M30`/`M02`. |
| `bad_toolchange_comp.nc` | `tool-change-while-comp-active` | `T`/`M06` while `G41`/`G42` active. |
| `bad_z_clearance.nc` | `unsafe-z-clearance` | Z rapid below safe clearance. |
| `bad_macro_unknown_var.nc` | `unknown-system-variable` | `IF[#9999 EQ 0] GOTO 10` with `#9999` unset. |
| `bad_custom_mcode.nc` | `unknown-custom-mcode` | Vendor M-code absent from the active flavor registry. |

Acceptance criteria map directly onto this corpus. Every new rule must add a corpus case.
