import type { RuleDefinition } from './types';
import type { Diagnostic, Severity } from '../shared/types';
import {
  blockCodes,
  blockSpan,
  isInsideStock,
  moveEvents,
  wordSpan,
} from './types';

const diagnostic = (
  ruleId: string,
  severity: Severity,
  message: string,
  span: Diagnostic['span'],
  related?: Diagnostic['related'],
): Diagnostic => ({ ruleId, severity, message, span, related });

const MOTION_CODES = new Set([
  'G0',
  'G1',
  'G2',
  'G3',
  'G73',
  'G77',
  'G81',
  'G83',
]);

/**
 * A tool change is only a problem when the tool is used for a work-frame Z
 * motion before G43/G44 selects its length compensation. Trailing tool
 * returns programmed with G53 do not need compensation.
 */
const missingToolLengthComp: RuleDefinition = {
  id: 'missing-tool-length-comp',
  description: 'Tool change followed by work-frame Z motion without G43/G44.',
  defaultSeverity: 'error',
  check({ evaluation }) {
    const diagnostics: Diagnostic[] = [];
    let pending: { span: Diagnostic['span']; line: number } | null = null;

    for (const blockState of evaluation.blockStates) {
      const codes = blockCodes(blockState.block);
      const hasComp =
        codes.includes('G43') || codes.includes('G44');
      const toolChange = blockState.events.find(
        (event) => event.kind === 'tool-change',
      );

      if (toolChange) {
        pending = {
          span:
            wordSpan(blockState.block, 'T') ??
            wordSpan(blockState.block, 'M') ??
            blockSpan(blockState.block),
          line: blockState.block.line,
        };
      }

      if (hasComp) {
        pending = null;
        continue;
      }

      if (!pending) continue;

      const isMachineFrame = codes.includes('G53');
      const hasZ = blockState.block.words.some((word) => word.letter === 'Z');
      const hasMotion = codes.some((code) => MOTION_CODES.has(code));

      if (!isMachineFrame && hasZ && hasMotion) {
        diagnostics.push(
          diagnostic(
            'missing-tool-length-comp',
            'error',
            `Tool change at line ${pending.line} is followed by Z motion without G43/G44.`,
            pending.span,
          ),
        );
        pending = null;
      }
    }

    return diagnostics;
  },
};

const arcPlaneMismatch: RuleDefinition = {
  id: 'arc-plane-mismatch',
  description: 'Arc centre words do not match the active plane, or are missing.',
  defaultSeverity: 'error',
  check({ evaluation }) {
    const diagnostics: Diagnostic[] = [];

    for (const blockState of evaluation.blockStates) {
      const codes = blockCodes(blockState.block);
      const arcCode = codes.find((code) => code === 'G2' || code === 'G3');
      if (!arcCode) continue;

      const planeWord = codes.find(
        (code) => code === 'G17' || code === 'G18' || code === 'G19',
      );
      const plane =
        planeWord === 'G17'
          ? 'XY'
          : planeWord === 'G18'
            ? 'ZX'
            : planeWord === 'G19'
              ? 'YZ'
              : blockState.before.modal.plane;
      const has = (letter: string) =>
        blockState.block.words.some((word) => word.letter === letter);
      const valid =
        plane === 'XY'
          ? { i: true, j: true, k: false }
          : plane === 'ZX'
            ? { i: true, j: false, k: true }
            : { i: false, j: true, k: true };

      const wrong = (['I', 'J', 'K'] as const).filter(
        (letter) => has(letter) && !valid[letter.toLowerCase() as 'i' | 'j' | 'k'],
      );

      if (wrong.length > 0) {
        diagnostics.push(
          diagnostic(
            'arc-plane-mismatch',
            'error',
            `${arcCode} uses ${wrong.join('/')} while the active plane is ${plane}.`,
            wordSpan(blockState.block, wrong[0]) ??
              blockSpan(blockState.block),
          ),
        );
        continue;
      }

      const hasRadius = has('R');
      const hasCenter = (['I', 'J', 'K'] as const).some((letter) =>
        has(letter),
      );
      if (!hasRadius && !hasCenter) {
        diagnostics.push(
          diagnostic(
            'arc-plane-mismatch',
            'error',
            `${arcCode} needs either R or in-plane I/J/K centre words.`,
            wordSpan(blockState.block, 'G') ??
              blockSpan(blockState.block),
          ),
        );
      }
    }

    return diagnostics;
  },
};

const travelLimitExceeded: RuleDefinition = {
  id: 'travel-limit-exceeded',
  description: 'Commanded machine position exceeds the variant travels.',
  defaultSeverity: 'error',
  check({ evaluation, profile }) {
    const travels = profile.travels;
    if (!travels) return [];

    const diagnostics: Diagnostic[] = [];
    const axes: Array<'x' | 'y' | 'z'> = ['x', 'y', 'z'];

    for (const blockState of evaluation.blockStates) {
      if (moveEvents(blockState).length === 0) continue;
      const position = blockState.after.machinePosition;

      for (const axis of axes) {
        const travel = travels[axis];
        if (!travel) continue;
        const value = position[axis];
        if (value < travel.min || value > travel.max) {
          diagnostics.push(
            diagnostic(
              'travel-limit-exceeded',
              'error',
              `${axis.toUpperCase()} ${value.toFixed(2)} exceeds travel ${travel.min}..${travel.max}.`,
              wordSpan(blockState.block, axis.toUpperCase()) ??
                blockSpan(blockState.block),
            ),
          );
        }
      }
    }

    return diagnostics;
  },
};

const unsafeCutterCompRapid: RuleDefinition = {
  id: 'unsafe-cutter-comp-rapid',
  description: 'Rapid motion while cutter compensation is active.',
  defaultSeverity: 'error',
  check({ evaluation }) {
    const diagnostics: Diagnostic[] = [];

    for (const blockState of evaluation.blockStates) {
      if (blockState.before.modal.cutterComp.mode === 'off') continue;
      const rapid = moveEvents(blockState).find(
        (event) => event.move.kind === 'rapid',
      );
      if (!rapid) continue;

      diagnostics.push(
        diagnostic(
          'unsafe-cutter-comp-rapid',
          'error',
          'Rapid traverse while cutter compensation is active.',
          wordSpan(blockState.block, 'G') ?? blockSpan(blockState.block),
        ),
      );
    }

    return diagnostics;
  },
};

const toolChangeWhileCompActive: RuleDefinition = {
  id: 'tool-change-while-comp-active',
  description: 'Tool change while cutter compensation is active.',
  defaultSeverity: 'error',
  check({ evaluation }) {
    const diagnostics: Diagnostic[] = [];

    for (const blockState of evaluation.blockStates) {
      const toolChange = blockState.events.some(
        (event) => event.kind === 'tool-change',
      );
      if (!toolChange) continue;
      if (blockState.before.modal.cutterComp.mode === 'off') continue;

      diagnostics.push(
        diagnostic(
          'tool-change-while-comp-active',
          'error',
          'Tool change while cutter compensation is active; cancel with G40 first.',
          wordSpan(blockState.block, 'M') ?? blockSpan(blockState.block),
        ),
      );
    }

    return diagnostics;
  },
};

const unitMismatch: RuleDefinition = {
  id: 'unit-mismatch',
  description: 'Program units differ from the resolved profile units.',
  defaultSeverity: 'warning',
  check({ program, profile }) {
    const diagnostics: Diagnostic[] = [];

    for (const block of program.blocks) {
      for (const word of block.words) {
        if (word.letter !== 'G') continue;
        if (word.value === undefined) continue;
        const code = `G${word.value}`;
        const wrong =
          (code === 'G20' && profile.units === 'mm') ||
          (code === 'G21' && profile.units === 'inch');
        if (!wrong) continue;

        diagnostics.push(
          diagnostic(
            'unit-mismatch',
            'warning',
            `${code} selects ${code === 'G20' ? 'inch' : 'millimetre'} units but the profile defaults to ${profile.units}.`,
            word.span,
          ),
        );
      }
    }

    return diagnostics;
  },
};

const duplicateSequenceNumber: RuleDefinition = {
  id: 'duplicate-sequence-number',
  description: 'A sequence number is used more than once.',
  defaultSeverity: 'warning',
  check({ program }) {
    const diagnostics: Diagnostic[] = [];
    const first = new Map<number, Diagnostic['span']>();

    for (const block of program.blocks) {
      if (block.sequenceNumber === null) continue;
      const existing = first.get(block.sequenceNumber);
      if (existing) {
        const span =
          wordSpan(block, 'N') ?? blockSpan(block);
        diagnostics.push(
          diagnostic(
            'duplicate-sequence-number',
            'warning',
            `Sequence number N${block.sequenceNumber} is reused; GOTO resolves forward to the nearest match.`,
            span,
            [existing],
          ),
        );
        continue;
      }
      const span = wordSpan(block, 'N');
      if (span) first.set(block.sequenceNumber, span);
    }

    return diagnostics;
  },
};

const missingAbsoluteMode: RuleDefinition = {
  id: 'missing-absolute-mode',
  description: 'Program never establishes G90 or G91.',
  defaultSeverity: 'warning',
  check({ program, evaluation }) {
    const established = evaluation.blockStates.some((blockState) =>
      blockCodes(blockState.block).some(
        (code) => code === 'G90' || code === 'G91',
      ),
    );
    if (established) return [];

    const firstBlock = program.blocks.find((block) => block.words.length > 0);
    return [
      diagnostic(
        'missing-absolute-mode',
        'warning',
        'Program never selects G90 or G91; distance mode is assumed.',
        firstBlock ? blockSpan(firstBlock) : { file: program.file, line: 1, column: 1 },
      ),
    ];
  },
};

const feedOutOfRange: RuleDefinition = {
  id: 'feed-out-of-range',
  description: 'Feed rate exceeds the variant maximum.',
  defaultSeverity: 'warning',
  check({ evaluation, profile }) {
    const maxFeed = profile.variant.geometry.maxFeedRate;
    if (maxFeed === undefined) return [];

    const diagnostics: Diagnostic[] = [];
    for (const blockState of evaluation.blockStates) {
      const feed = blockState.after.feed;
      if (feed === null || feed <= maxFeed) continue;
      diagnostics.push(
        diagnostic(
          'feed-out-of-range',
          'warning',
          `Feed ${feed} mm/min exceeds the variant maximum of ${maxFeed}.`,
          wordSpan(blockState.block, 'F') ?? blockSpan(blockState.block),
        ),
      );
    }

    return diagnostics;
  },
};

const spindleOutOfRange: RuleDefinition = {
  id: 'spindle-out-of-range',
  description: 'Spindle speed is outside the flavor range.',
  defaultSeverity: 'warning',
  check({ evaluation, profile }) {
    const [min, max] = profile.flavor.dialect.spindle.rpmRange;
    const diagnostics: Diagnostic[] = [];

    for (const blockState of evaluation.blockStates) {
      const word = blockState.block.words.find((entry) => entry.letter === 'S');
      if (!word || word.value === undefined) continue;
      if (word.value >= min && word.value <= max) continue;
      diagnostics.push(
        diagnostic(
          'spindle-out-of-range',
          'warning',
          `Spindle speed ${word.value} rpm is outside ${min}..${max}.`,
          word.span,
        ),
      );
    }

    return diagnostics;
  },
};

const rapidThroughStock: RuleDefinition = {
  id: 'rapid-through-stock',
  description: 'Rapid move passes through the stock envelope.',
  defaultSeverity: 'warning',
  check({ evaluation, stock }) {
    if (!stock) return [];
    const diagnostics: Diagnostic[] = [];

    for (const blockState of evaluation.blockStates) {
      const codes = blockCodes(blockState.block);
      if (codes.includes('G53') || codes.includes('G28') || codes.includes('G30')) {
        continue;
      }

      for (const event of moveEvents(blockState)) {
        if (event.move.kind !== 'rapid') continue;
        const { from, to } = event.move;
        const inside = isInsideStock(to, stock) || isInsideStock(from, stock);
        if (!inside) continue;

        diagnostics.push(
          diagnostic(
            'rapid-through-stock',
            'warning',
            'Rapid move starts or ends inside the stock envelope.',
            wordSpan(blockState.block, 'G') ?? blockSpan(blockState.block),
          ),
        );
      }
    }

    return diagnostics;
  },
};

const unsafeZClearance: RuleDefinition = {
  id: 'unsafe-z-clearance',
  description: 'Rapid Z move below the configured safe height.',
  defaultSeverity: 'warning',
  check({ evaluation, safeZ }) {
    if (safeZ === undefined) return [];
    const diagnostics: Diagnostic[] = [];

    for (const blockState of evaluation.blockStates) {
      const codes = blockCodes(blockState.block);
      if (codes.includes('G53')) continue;

      for (const event of moveEvents(blockState)) {
        if (event.move.kind !== 'rapid') continue;
        if (event.move.to.z >= safeZ) continue;
        diagnostics.push(
          diagnostic(
            'unsafe-z-clearance',
            'warning',
            `Rapid down to Z${event.move.to.z} is below the safe height Z${safeZ}.`,
            wordSpan(blockState.block, 'Z') ?? blockSpan(blockState.block),
          ),
        );
      }
    }

    return diagnostics;
  },
};

const missingProgramEnd: RuleDefinition = {
  id: 'missing-program-end',
  description: 'Program has no executed M30/M02.',
  defaultSeverity: 'warning',
  check({ program, evaluation }) {
    const ended = evaluation.events.some(
      (event) => event.kind === 'program-end',
    );
    if (ended) return [];

    const last = [...program.blocks].reverse().find((block) => block.words.length > 0);
    return [
      diagnostic(
        'missing-program-end',
        'warning',
        'Program has no M30 or M02 program end.',
        last ? blockSpan(last) : { file: program.file, line: 1, column: 1 },
      ),
    ];
  },
};

export const builtinRules: RuleDefinition[] = [
  missingToolLengthComp,
  arcPlaneMismatch,
  travelLimitExceeded,
  unsafeCutterCompRapid,
  toolChangeWhileCompActive,
  unitMismatch,
  duplicateSequenceNumber,
  missingAbsoluteMode,
  feedOutOfRange,
  spindleOutOfRange,
  rapidThroughStock,
  unsafeZClearance,
  missingProgramEnd,
];
