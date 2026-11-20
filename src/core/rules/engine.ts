import type { Diagnostic, Severity } from '../shared/types';
import type { ResolvedMachineProfile, RuleOverride } from '../profiles/types';
import { builtinRules } from './builtin';
import { defaultSeverity, ruleCatalogById } from './catalog';
import type { RuleContext } from './types';

function overrideSeverity(
  override: Severity | RuleOverride | undefined,
): Severity | undefined {
  if (override === undefined) return undefined;
  return typeof override === 'string' ? override : override.severity;
}

/**
 * Variant overrides win over flavor overrides, which win over catalog
 * defaults. `off` disables a rule entirely.
 */
export function severityFor(
  profile: ResolvedMachineProfile,
  ruleId: string,
): Severity {
  return (
    overrideSeverity(profile.variant.ruleOverrides?.[ruleId]) ??
    overrideSeverity(profile.flavor.rules[ruleId]) ??
    defaultSeverity(ruleId)
  );
}

const SEVERITY_RANK: Record<Severity, number> = {
  error: 0,
  warning: 1,
  info: 2,
  off: 3,
};

/**
 * Run policy/safety rules and merge them with modal-engine diagnostics,
 * applying flavor/variant severity overrides to both. Results are sorted by
 * source position, then severity.
 */
export function runRules(context: RuleContext): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const diagnostic of context.evaluation.diagnostics) {
    const known = ruleCatalogById.has(diagnostic.ruleId);
    const severity = known
      ? severityFor(context.profile, diagnostic.ruleId)
      : diagnostic.severity;
    if (severity === 'off') continue;
    diagnostics.push({ ...diagnostic, severity });
  }

  for (const rule of builtinRules) {
    const severity = severityFor(context.profile, rule.id);
    if (severity === 'off') continue;
    for (const diagnostic of rule.check(context)) {
      diagnostics.push({ ...diagnostic, severity });
    }
  }

  diagnostics.sort((a, b) => {
    if (a.span.line !== b.span.line) return a.span.line - b.span.line;
    if (a.span.column !== b.span.column) return a.span.column - b.span.column;
    return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
  });

  return diagnostics;
}
