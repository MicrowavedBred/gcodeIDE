import type { Severity } from '../shared/types';

export interface RuleCatalogEntry {
  id: string;
  defaultSeverity: Severity;
  description: string;
  /** Which engine produces the diagnostic. */
  owner: 'modal' | 'rules';
}

/**
 * Single source of truth for rule identities, default severities and
 * ownership. Profiles override entries by id; unknown ids are rejected by
 * profile validation.
 */
export const ruleCatalog: RuleCatalogEntry[] = [
  {
    id: 'missing-tool-length-comp',
    defaultSeverity: 'error',
    description: 'Tool change followed by work-frame Z motion without G43/G44.',
    owner: 'rules',
  },
  {
    id: 'arc-plane-mismatch',
    defaultSeverity: 'error',
    description: 'Arc centre words do not match the active plane.',
    owner: 'rules',
  },
  {
    id: 'travel-limit-exceeded',
    defaultSeverity: 'error',
    description: 'Commanded position outside variant travels.',
    owner: 'rules',
  },
  {
    id: 'unsafe-cutter-comp-rapid',
    defaultSeverity: 'error',
    description: 'Rapid while G41/G42 active.',
    owner: 'rules',
  },
  {
    id: 'tool-change-while-comp-active',
    defaultSeverity: 'error',
    description: 'T/M06 while compensation active.',
    owner: 'rules',
  },
  {
    id: 'unit-mismatch',
    defaultSeverity: 'warning',
    description: 'Program units differ from the resolved profile units.',
    owner: 'rules',
  },
  {
    id: 'unsupported-code',
    defaultSeverity: 'warning',
    description: 'Code not supported by the active flavor.',
    owner: 'modal',
  },
  {
    id: 'duplicate-sequence-number',
    defaultSeverity: 'warning',
    description: 'Repeated N value.',
    owner: 'rules',
  },
  {
    id: 'missing-absolute-mode',
    defaultSeverity: 'warning',
    description: 'Program never establishes G90/G91.',
    owner: 'rules',
  },
  {
    id: 'feed-out-of-range',
    defaultSeverity: 'warning',
    description: 'F outside variant limits.',
    owner: 'rules',
  },
  {
    id: 'spindle-out-of-range',
    defaultSeverity: 'warning',
    description: 'S outside spindle range.',
    owner: 'rules',
  },
  {
    id: 'rapid-through-stock',
    defaultSeverity: 'warning',
    description: 'Rapid path intersects stock material.',
    owner: 'rules',
  },
  {
    id: 'missing-program-end',
    defaultSeverity: 'warning',
    description: 'No M30/M02.',
    owner: 'rules',
  },
  {
    id: 'unsafe-z-clearance',
    defaultSeverity: 'warning',
    description: 'Z rapid below configured safe height.',
    owner: 'rules',
  },
  {
    id: 'unknown-system-variable',
    defaultSeverity: 'warning',
    description: 'Macro references a system variable with no configured value.',
    owner: 'modal',
  },
  {
    id: 'unknown-custom-mcode',
    defaultSeverity: 'warning',
    description: 'Vendor M-code not defined in the active flavor.',
    owner: 'modal',
  },
  // Structural diagnostics emitted by the modal engine that do not appear in
  // the roadmap's baseline catalog but still need overridable severities.
  {
    id: 'conflicting-modal-group',
    defaultSeverity: 'error',
    description: 'Two codes from the same modal group in one block.',
    owner: 'modal',
  },
  {
    id: 'invalid-rotation-parameters',
    defaultSeverity: 'error',
    description: 'G68 is missing X, Y or R.',
    owner: 'modal',
  },
  {
    id: 'macro-alarm',
    defaultSeverity: 'error',
    description: 'Macro alarm raised by #3000.',
    owner: 'modal',
  },
  {
    id: 'macro-iteration-limit',
    defaultSeverity: 'error',
    description: 'Macro execution exceeded the iteration limit.',
    owner: 'modal',
  },
  {
    id: 'missing-motion-mode',
    defaultSeverity: 'warning',
    description: 'Axis words before any motion mode is established.',
    owner: 'modal',
  },
  {
    id: 'missing-tool',
    defaultSeverity: 'warning',
    description: 'Tool change without a requested T word.',
    owner: 'modal',
  },
  {
    id: 'missing-label',
    defaultSeverity: 'error',
    description: 'GOTO target was not found.',
    owner: 'modal',
  },
  {
    id: 'invalid-macro-target',
    defaultSeverity: 'error',
    description: 'GOTO target is missing.',
    owner: 'modal',
  },
  {
    id: 'invalid-macro-condition',
    defaultSeverity: 'error',
    description: 'IF condition is malformed.',
    owner: 'modal',
  },
  {
    id: 'unsupported-macro',
    defaultSeverity: 'warning',
    description: 'Unsupported macro statement.',
    owner: 'modal',
  },
  {
    id: 'unsupported-g10',
    defaultSeverity: 'warning',
    description: 'Unsupported G10 data-setting form.',
    owner: 'modal',
  },
  {
    id: 'motion-cancelled',
    defaultSeverity: 'warning',
    description: 'Axis words after G80 with no active motion mode.',
    owner: 'modal',
  },
  {
    id: 'macro-condition-assumed',
    defaultSeverity: 'info',
    description: 'Macro condition assumed true because a variable is unknown.',
    owner: 'modal',
  },
  {
    id: 'missing-subprogram',
    defaultSeverity: 'error',
    description: 'M98 references a subprogram that cannot be resolved.',
    owner: 'modal',
  },
  {
    id: 'subprogram-depth-exceeded',
    defaultSeverity: 'error',
    description: 'M98 nesting exceeds the flavor limit.',
    owner: 'modal',
  },
  {
    id: 'unsupported-lathe-axis',
    defaultSeverity: 'warning',
    description: 'U/W axis words used on a non-lathe flavor.',
    owner: 'modal',
  },
  {
    id: 'lathe-css-without-rpm-limit',
    defaultSeverity: 'warning',
    description: 'G96 constant surface speed has no finite spindle RPM limit.',
    owner: 'rules',
  },
];

export const ruleCatalogById = new Map(
  ruleCatalog.map((entry) => [entry.id, entry]),
);

const ORDERED_IDS = ruleCatalog.map((entry) => entry.id);

export function defaultSeverity(ruleId: string): Severity {
  const entry = ruleCatalogById.get(ruleId);
  return entry ? entry.defaultSeverity : 'warning';
}

export function isKnownRule(ruleId: string): boolean {
  return ruleCatalogById.has(ruleId);
}

export function sortByRuleOrder(diagnostics: Array<{ ruleId: string }>): void {
  diagnostics.sort(
    (a, b) =>
      ORDERED_IDS.indexOf(a.ruleId) - ORDERED_IDS.indexOf(b.ruleId),
  );
}
