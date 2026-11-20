# Rules Engine (design)

> Companion to `gcodeIDE-roadmap.md`, `docs/architecture.md` and `docs/modal-state.md`.
> Scope: baseline mill rule catalog from the roadmap's Appendix B.

## Purpose

The modal engine answers *what does this program mean*. The rules engine answers *is what it means acceptable for this machine*. Keeping them separate gives each diagnostic exactly one owner and one source of truth.

```
parsed program + ProgramEvaluation + resolved profile
  → rules engine
  → Diagnostic[] (modal diagnostics merged, severities resolved, sorted by position)
```

## Ownership

| Owner | Diagnostics |
| --- | --- |
| Modal engine | `conflicting-modal-group`, `missing-axis-words`, `invalid-arc-parameters`, `invalid-cycle-parameters`, `unsupported-code`, `unknown-custom-mcode`, `unknown-system-variable`, `missing-motion-mode`, `macro-alarm`, `macro-iteration-limit`, `macro-condition-assumed`, plus parser/lexer diagnostics. |
| Rules engine | `missing-tool-length-comp`, `arc-plane-mismatch`, `travel-limit-exceeded`, `unsafe-cutter-comp-rapid`, `tool-change-while-comp-active`, `unit-mismatch`, `duplicate-sequence-number`, `missing-absolute-mode`, `feed-out-of-range`, `spindle-out-of-range`, `rapid-through-stock`, `missing-program-end`, `unsafe-z-clearance`. |

Do not report the same condition from both engines. If a future rule needs modal facts, read them from `ProgramEvaluation.blockStates` rather than re-deriving them.

## Catalog and severity resolution

`src/core/rules/catalog.ts` is the only registry of rule ids. Every id has a default severity and an owner. Profiles override by id:

1. `variant.ruleOverrides[ruleId]`
2. `flavor.rules[ruleId]`
3. catalog default

`off` disables the rule. Diagnostics produced by the modal engine are passed through the same resolution, so a profile can downgrade or silence structural warnings too. Unknown rule ids produced by the lexer/parser keep their emitted severity.

Adding a rule requires a catalog entry, an implementation in `builtin.ts`, and a positive/negative corpus case.

## Rule contract

```ts
interface RuleDefinition {
  id: string;
  description: string;
  defaultSeverity: Severity;
  check(context: RuleContext): Diagnostic[];
}

interface RuleContext {
  profile: ResolvedMachineProfile;
  program: ParsedProgram;
  evaluation: ProgramEvaluation;
  stock?: StockBounds;                  // coarse fallback for rapid-through-stock
  stockSimulation?: StockSimulation;    // height-map evidence, when configured
  safeZ?: number;                       // unsafe-z-clearance threshold
}
```

Rules are pure: they inspect the context and return diagnostics. They never mutate state or call other rules.

## Geometry-dependent rules

Both rules need configuration the modal engine does not produce:

- `rapid-through-stock` skips `G53`/`G28`/`G30` blocks. With stock simulation enabled it flags a rapid whose sampled path passes below the material present **at that point in execution**, including crossings where both endpoints are outside the stock box. Callers that supply only a stock box keep the coarse endpoint-in-box check.
- `unsafe-z-clearance` runs only when a safe Z height is supplied. It skips `G53` and flags rapids ending below the safe height. It is independent of the height map.

Both are inactive without their respective configuration rather than guessing. The height map models vertical cylindrical cutters only; ball-nose geometry, fixture collision, and rotary removal are out of scope.

## Rule-specific decisions

- **missing-tool-length-comp**: fires only when a work-frame Z motion happens after a tool change before `G43`/`G44`. Trailing `G53` tool-return moves and tool changes with no following cutting motion are ignored.
- **arc-plane-mismatch**: the plane in effect is the block's own `G17`/`G18`/`G19` if present, otherwise the preceding state. `G17` allows `I/J`, `G18` allows `I/K`, `G19` allows `J/K`. A missing `R` and missing in-plane centre words is the same rule.
- **travel-limit-exceeded**: evaluated on `after.machinePosition`, bounded variants only. The default `unspecified` variant has null travels and never fires.
- **unit-mismatch**: compares explicit `G20`/`G21` words against `profile.units`, not against the first block, so a mixed program reports each conflicting switch.
- **duplicate-sequence-number**: reports every reuse with the first occurrence as `related`. The evaluator still resolves `GOTO` forward to the nearest occurrence, matching mill control behaviour.
- **missing-absolute-mode / missing-program-end**: evaluated over executed blocks/events, not the raw file, so a branch that is never taken cannot satisfy or violate them.

## Testing

| Test | What it proves |
| --- | --- |
| Corpus sweep | Every Brother program produces no errors and only expected warnings. |
| One positive/negative pair per rule | The rule fires on its violation and stays quiet on the corrected program. |
| Severity overrides | Flavor and variant overrides apply with the documented precedence; `off` suppresses. |
| Optional context | Stock/safe-Z rules stay silent without context and fire with it. |
