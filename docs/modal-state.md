# Modal-State Engine (design)

> Companion to `gcodeIDE-roadmap.md` and `docs/architecture.md`.
> Scope: v1 mill flavors (Brother, Haas, Fanuc, GRBL, LinuxCNC), 4-axis positional, constrained macros.

## Purpose

G-code is modal: a code stays in effect until another code in the same group replaces it. The modal-state engine converts an ordered stream of parsed blocks into:

- **per-block state snapshots** — what the control believes at each line,
- **semantic events** — moves, tool changes, spindle/coolant changes, alarms,
- **structural diagnostics** — conflicting groups, invalid arc/cycle parameters, unsupported codes.

Diagnostics, backplot, cycle-time estimation, and later streaming safety all consume this state. There must be exactly one state machine.

## Position in the pipeline

```
parsed blocks
  → execution controller   (macro control flow, M98/M99, GOTO, alarms)
  → modal machine          (state transitions, events, structural diagnostics)
  → interpreter            (canonical Move[] + resolved frames)
  → rules + simulation
```

The **execution controller** decides *which* blocks run and in what order. The **modal machine** decides *what each executed block means*. Keeping these separate prevents macro control flow from contaminating modal semantics.

## State model

```ts
interface MachineState {
  modal: ModalState;
  position: Pose;            // current work-frame position
  machinePosition: Pose;     // current machine position when known
  offsets: OffsetTable;      // G54..G59, G54.1 Pn, G52 local, G68 rotation
  tool: ToolState;           // requested/active tool, length/radius registers
  spindle: SpindleState;     // mode, rpm/css, direction
  coolant: 'off' | 'mist' | 'flood';
  feed: number | null;       // canonical mm/min
  program: ProgramState;     // current N, call stack, approximate flag
}

interface ModalState {
  motion: MotionMode;        // G0/G1/G2/G3/G80/G81/G83/G73/G77...
  plane: 'XY' | 'ZX' | 'YZ';
  distance: 'absolute' | 'incremental';
  arcCenter: 'incremental' | 'absolute';
  units: 'mm' | 'inch';
  feedMode: 'G93' | 'G94' | 'G95';
  cutterComp: { mode: 'off' | 'left' | 'right'; register: number | null };
  toolLength: { mode: 'off' | 'positive' | 'negative'; register: number | null };
  workOffsetCode: string;    // 'G54' | 'G54.1 P4' | ...
  cycleReturn: 'initial' | 'r'; // G98 | G99
  rotation: { angleDeg: number; center: [number, number]; plane: 'XY' | 'ZX' | 'YZ' } | null;
  scaling: { factor: number } | null;
  spindleMode: 'rpm' | 'css'; // G97 | G96 (lathe later)
}
```

Each block produces a `BlockState`:

```ts
interface BlockState {
  block: ParsedBlock;
  before: MachineState;      // retained for diagnostics and diffing
  after: MachineState;
  events: SemanticEvent[];
  diagnostics: Diagnostic[];
}
```

Storing `before` and `after` is acceptable at v1 scale (thousands of blocks); if memory becomes an issue, switch to `after` + a changed-paths set without changing consumers.

## Modal groups

Every flavor supplies a code table assigning codes to groups and semantics. Do not hard-code Fanuc group numbers globally — dialects disagree.

| Group | Typical codes | Mill default | Notes |
| --- | --- | --- | --- |
| motion | `G0`,`G1`,`G2`,`G3`,`G80`,`G81`,`G83`,`G73`,`G77` | flavor-defined | Canned cycles share group 1 with motion. |
| plane | `G17`,`G18`,`G19` | `G17` | |
| distance | `G90`,`G91` | `G90` | `missing-absolute-mode` if never explicitly set. |
| arc center | `G90.1`,`G91.1` | `G91.1` | Fanuc-style incremental centers. |
| feed mode | `G93`,`G94`,`G95` | `G94` | |
| units | `G20`,`G21` | resolved user/flavor units | Metric default. |
| cutter comp | `G40`,`G41`,`G42` | `G40` | |
| tool length | `G43`,`G44`,`G49` | `G49` | `G43 L.. H..` is Brother-specific. |
| work offset | `G54`–`G59`,`G54.1` | `G54` | Presence/values come from `G10`. |
| cycle return | `G98`,`G99` | `G98` | |
| rotation | `G68`,`G69` | off | |
| scaling | `G50`,`G51` | off | Not in current corpus. |
| spindle mode | `G96`,`G97` | `G97` | Lathe-focused; mills use `G97`. |

Two codes from the same group in one block produce `conflicting-modal-group`. Non-modal codes (`G4`, `G10`, `G28`, `G30`, `G53`) act only on their block.

## Block transition algorithm

```
apply(block, state, profile):
  1. Parse words into groups; reject same-group conflicts.
  2. Apply data-setting codes (G10) to the offset table.
  3. Apply coordinate-system changes (G52, G68/G69, G54.., G54.1).
  4. Apply modal mode changes (plane, distance, units, feed mode, comp, cycle return).
  5. Resolve motion:
       - explicit motion code, or
       - implicit current motion if axis words are present, or
       - repeat canned cycle if cycle active.
  6. Convert axis words to a target Pose using distance mode + units.
  7. Resolve frames (work offset, G52, G68, A-axis) into machine coordinates.
  8. Validate the move (arc parameters, cycle parameters, axis presence).
  9. Emit events and update position/tool/spindle/feed/coolant.
 10. Snapshot state.
```

Order matters: data setting before coordinate selection; coordinate changes before motion; comp and units before distance resolution.

## Word handling rules

- **Axis words**: `X`, `Y`, `Z`, `A`. `U`/`V`/`W` reserved for lathe incremental axes.
- **Implicit motion**: axis words without a motion G-code use the current motion mode. If none has ever been set, use the flavor default and warn (`missing-motion-mode`).
- **Units**: convert all linear values to millimetres immediately; convert displayed values at the UI boundary only.
- **Feed**: normalize to mm/min internally; `G95` (units/rev) needs spindle rpm and is lathe-focused.
- **Arcs**: require a plane, endpoint, and either `I/J/K` or `R`. Mixing `R` with `I/J/K` is a diagnostic. Full-circle arcs with only `R` are invalid.
- **Canned cycles**: `G81`, `G83` (`Q`, `P`), `G73` (`Q`), `G77` (Brother tapping, `R`, `I`). In cycle mode, a block with only position words repeats the cycle. `G80` cancels.
- **Dwell**: `G4 P` or `G4 X` depending on flavor; store seconds.
- **Tool change**: `T` is requested tool; `M6` commits it. `G43 H` / `G43 L H` selects length compensation.
- **Custom M-codes**: looked up in the flavor registry. Known codes emit semantic events with descriptions; unknown codes emit `unknown-custom-mcode`.

## Offsets and transforms

`OffsetTable` holds:

- standard work offsets `G54`–`G59`,
- extended offsets `G54.1 Pn`,
- a local `G52` translation,
- an active `G68` rotation,
- tool-length registers referenced by `H`/`L`.

Resolution order for a programmed point:

```
p_work = rotate_G68( p_program + G52_translation )
p_machine = workOffset_frame( p_work )
```

`workOffset_frame` includes translation and, on 4-axis variants, the offset’s A angle. `G53` bypasses work offsets and uses machine coordinates directly.

This order is a working assumption for v1. Verify it against the Brother manual and seeded expectations before locking it; `G52`/`G68` composition is a known source of subtle bugs.

## 4-axis positional semantics

- `A` is an axis word, modal in position but not a modal group.
- Absolute/incremental follows `G90`/`G91`.
- Selecting a `G54.1 Pn` offset may also select the offset’s stored A angle.
- Backplot rotates the part/toolpath about the variant’s rotary center.
- Material removal remains 3-axis in v1; non-zero-A moves are drawn but not carved, and the verification report states this.

## Subprograms and macros

- The execution controller resolves `M98`/`M99` with a depth-limited call stack (`ExecutionFrame[]`). Modal state is shared across calls, matching typical control behavior. `M98 Pnnnn Lx` repeats a subprogram `x` times; top-level `M99` ends the program.
- Subprogram lookup accepts a `ProgramSet` (main program + additional files): `O` numbers are found in any supplied file and execution resumes after the `O` word. Platform code will map project-folder files into this set.
- `IF[expr op expr] GOTO n` jumps by sequence number (`N`), not file line.
- **GOTO resolves forward from the current block**, wrapping to the first occurrence only when no later match exists. Brother programs reuse section-local labels (`O7963.NC` defines `N20`/`N30` twice); first-match lookup makes control flow loop forever.
- `#3000=1(message)` aborts execution and emits an alarm event.
- System variables (`#3700`, `#11003`, `#11006`, `#11032`) are configurable in the flavor/variant.
- **Tool-length inputs default to “unknown”.** `#3700` maps to the spindle tool and is seeded; `#11003`/`#11006`/`#11032` are machine measurements a simulator cannot know. A condition involving an unknown variable is **assumed true** (the operator-fixed path), emits `macro-condition-assumed` at `info`, and sets `ProgramEvaluation.approximate`.
- **Data-setting blocks run before the first branch target.** `O7963.NC` sets `G10 L20 P2/P3` above the tool check; evaluation starts at the first block, so those offsets exist before `N10`.

## Corpus-driven decisions

These came from evaluating all ten Brother files end-to-end (see `src/core/gcode/modal.ts`):

- **`G80` is a cancel code, not a competing motion mode.** Brother emits `G00 G90 G40 G80` at the top of every tool section. `G80` clears the active canned cycle; the explicit motion code in the same block still selects the mode. `validateCodeGroups` exempts this pair from `conflicting-modal-group`.
- **Deduplicated labels are the program's problem, not an error.** Duplicate `N` values produce the rules-engine warning `duplicate-sequence-number`, while execution still works via forward search.
- **Alarms terminate evaluation.** `#3000` stops the program and the remaining blocks are not part of the trace or the event list.
- **`M30`/`M02` terminate evaluation.** Trailing blocks after the program end are parsed but not executed.
- **The macro iteration limit counts jumps, not blocks.** Linear programs of any length run to completion even for flavors with macro support disabled; only `GOTO`/`IF GOTO` transitions are capped by `macros.maxIterations`.

## Diagnostic ownership

Modal engine owns structural/semantic diagnostics:

- `conflicting-modal-group`, `invalid-rotation-parameters`, `missing-motion-mode`, `missing-tool`
- `unsupported-code`, `unknown-custom-mcode`, `unknown-system-variable`, `unsupported-macro`, `unsupported-g10`, `motion-cancelled`
- `missing-label`, `invalid-macro-target`, `invalid-macro-condition`, `macro-alarm`, `macro-iteration-limit`, `macro-condition-assumed`, `missing-subprogram`, `subprogram-depth-exceeded`

Rules engine owns policy/safety diagnostics:

- `missing-tool-length-comp`, `unsafe-cutter-comp-rapid`, `tool-change-while-comp-active`
- `travel-limit-exceeded`, `feed-out-of-range`, `spindle-out-of-range`
- `rapid-through-stock`, `unsafe-z-clearance`
- `duplicate-sequence-number`, `missing-absolute-mode`, `missing-program-end`, `unit-mismatch`

Keep this split explicit so the same condition is not reported twice.

## Testing

| Test | What it proves |
| --- | --- |
| Group transition units | Each code changes only its group and preserves the rest. |
| Corpus golden states | Every block of `O1801.NC`, `O3690.NC`, `O4697.NC`, etc. matches expected `ModalState` + events. |
| Conflict cases | Same-group collisions and invalid arcs/cycles produce the right diagnostics. |
| Transform cases | `G52`/`G68`/`G54.1`/`G10 L20` produce expected machine coordinates. |
| Subprogram trace | `M98`/`M99` call/return and shared modal state. |
| Macro trace | `IF/GOTO` execution order and `#3000` alarm. |
| 4-axis | A-angle changes produce expected rotated poses. |

## Open questions

- Exact reset defaults per flavor: `G90` vs `G91`, `G54` vs “unset”, `G17`, `G94`, `G98`.
- Precise `G52`/`G68` composition order; confirm against the Brother manual.
- Whether `G10 L10`–`L13` in `OFFSET.OFS` are tool-length or work-offset data for this control.
- How to surface “approximate” execution caused by unknown macro variables without cascading warnings.
- Whether to store full `before`/`after` snapshots or diffs once corpus size grows.
