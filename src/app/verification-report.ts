import type { ProgramAnalysis } from './analysis';
import type { Move } from '../core/gcode/modal';
import type { CycleTimeEstimate } from '../core/simulation/cycle-time';

export interface VerificationReportInput {
  fileName: string;
  flavorName: string;
  variantName: string;
  analysis: ProgramAnalysis;
  cycleTime: CycleTimeEstimate;
}

export function formatDuration(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  if (whole < 60) return `${whole}s`;
  const minutes = Math.floor(whole / 60);
  return `${minutes}m ${whole % 60}s`;
}

function endPose(move: Move) {
  return move.kind === 'canned-cycle' ? move.at : move.to;
}

/** Builds a deterministic, plain-text verification report for copy or download. */
export function buildVerificationReport({
  fileName,
  flavorName,
  variantName,
  analysis,
  cycleTime,
}: VerificationReportInput): string {
  const { counts, lengthsMm } = analysis.toolpath;
  const severities = { error: 0, warning: 0, info: 0 };
  for (const diagnostic of analysis.diagnostics) {
    if (diagnostic.severity !== 'off') severities[diagnostic.severity] += 1;
  }

  const time = cycleTime.seconds === null
    ? `unavailable (${cycleTime.reasons.join(' ')})`
    : formatDuration(cycleTime.seconds);

  const lines = [
    '# Verification report',
    '',
    `- Program: ${fileName}`,
    `- Machine: ${flavorName} / ${variantName}`,
    `- Blocks: ${analysis.program.blocks.length}`,
    `- Moves: ${analysis.toolpath.moves.length} (rapid ${counts.rapid}, linear ${counts.linear}, arc ${counts.arc}, cycle ${counts.cycle})`,
    `- Travel: ${lengthsMm.total.toFixed(1)} mm`,
    `- Cycle time: ${time}`,
    `- Diagnostics: ${severities.error} errors, ${severities.warning} warnings, ${severities.info} info`,
    '',
    '## Diagnostics',
    '',
  ];

  if (analysis.diagnostics.length === 0) {
    lines.push('No diagnostics.');
  } else {
    for (const diagnostic of analysis.diagnostics) {
      lines.push(
        `- L${diagnostic.span.line}:${diagnostic.span.column} ${diagnostic.severity} ${diagnostic.ruleId}: ${diagnostic.message}`,
      );
    }
  }

  const notes: string[] = [];
  if (cycleTime.approximateCycles) {
    notes.push('Canned-cycle time is approximated from R plane, depth, feed and peck Q.');
  }
  if (analysis.evaluation.approximate) {
    notes.push('Macro evaluation was approximate.');
  }
  if (analysis.toolpath.moves.some((move) => (endPose(move).a ?? 0) !== 0)) {
    notes.push('A-axis positions are shown but rotary material removal is not modelled.');
  }
  notes.push('Verification output is advisory, not machine authorization.');

  lines.push('', '## Notes', '');
  for (const note of notes) lines.push(`- ${note}`);
  lines.push('');

  return lines.join('\n');
}
