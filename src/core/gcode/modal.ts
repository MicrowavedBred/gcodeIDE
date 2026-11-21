import type {
  Diagnostic,
  Pose,
  SourceSpan,
  Vec3,
} from '../shared/types';
import type {
  ResolvedMachineProfile,
  Units,
} from '../profiles/types';
import type { ParsedBlock, ParsedProgram, Word } from './parser';

export type MotionMode =
  | 'G0'
  | 'G1'
  | 'G2'
  | 'G3'
  | 'G4'
  | 'G28'
  | 'G30'
  | 'G53'
  | 'G73'
  | 'G77'
  | 'G80'
  | 'G81'
  | 'G83';

export type Plane = 'XY' | 'ZX' | 'YZ';
export type DistanceMode = 'absolute' | 'incremental';
export type FeedMode = 'G93' | 'G94' | 'G95';
export type SpindleMode = 'rpm' | 'css';
export type CoolantState = 'off' | 'mist' | 'flood';
export type CycleCode = 'G73' | 'G77' | 'G81' | 'G83';

export interface WorkOffset {
  code: string;
  translation: Vec3;
  a?: number;
}

export interface CycleState {
  code: CycleCode;
  z?: number;
  r?: number;
  q?: number;
  p?: number;
  i?: number;
}

export interface ModalState {
  motion: MotionMode;
  motionInitialized: boolean;
  plane: Plane;
  distance: DistanceMode;
  arcCenter: 'incremental' | 'absolute';
  units: Units;
  feedMode: FeedMode;
  cutterComp: { mode: 'off' | 'left' | 'right'; register: number | null };
  toolLength: {
    mode: 'off' | 'positive' | 'negative';
    register: number | null;
    lRegister: number | null;
  };
  workOffsetCode: string;
  cycleReturn: 'initial' | 'r';
  cycle: CycleState | null;
  rotation: {
    angleDeg: number;
    center: [number, number];
    plane: Plane;
  } | null;
  scaling: { factor: number } | null;
  spindleMode: SpindleMode;
}

export interface MachineState {
  modal: ModalState;
  position: Pose;
  machinePosition: Pose;
  offsets: Record<string, WorkOffset>;
  localOffset: Vec3;
  tool: {
    requested: number | null;
    active: number | null;
    lengthOffset: number | null;
    radiusOffset: number | null;
    lRegister: number | null;
  };
  spindle: {
    rpm: number | null;
    css: number | null;
    maxRpm: number | null;
    direction: 'cw' | 'ccw' | 'stop';
  };
  coolant: CoolantState;
  feed: number | null;
  sequenceNumber: number | null;
}

export type Move =
  | {
      kind: 'rapid' | 'linear';
      from: Pose;
      to: Pose;
      feed: number | null;
      feedMode?: FeedMode;
      line: number;
    }
  | {
      kind: 'arc';
      from: Pose;
      to: Pose;
      plane: Plane;
      clockwise: boolean;
      center?: [number, number];
      radius?: number;
      feed: number | null;
      feedMode?: FeedMode;
      line: number;
    }
  | {
      kind: 'canned-cycle';
      code: CycleCode;
      from: Pose;
      at: Pose;
      z?: number;
      r?: number;
      q?: number;
      p?: number;
      i?: number;
      feed: number | null;
      feedMode?: FeedMode;
      line: number;
    };

export type SemanticEvent =
  | { kind: 'move'; move: Move }
  | { kind: 'tool-change'; tool: number; line: number }
  | {
      kind: 'spindle';
      direction: 'cw' | 'ccw' | 'stop';
      rpm: number | null;
      line: number;
    }
  | { kind: 'coolant'; state: CoolantState; line: number }
  | {
      kind: 'offset-set';
      code: string;
      translation: Vec3;
      a?: number;
      line: number;
    }
  | { kind: 'custom-mcode'; code: string; description: string; line: number }
  | { kind: 'dwell'; seconds: number; line: number }
  | { kind: 'program-stop'; code: string; line: number }
  | { kind: 'program-end'; code: string; line: number }
  | { kind: 'alarm'; message: string; line: number }
  | { kind: 'home'; axes: string[]; line: number }
  | { kind: 'subprogram-call'; number: number; file: string; line: number }
  | { kind: 'subprogram-return'; number: number | null; file: string; line: number };

export interface BlockState {
  block: ParsedBlock;
  before: MachineState;
  after: MachineState;
  events: SemanticEvent[];
  diagnostics: Diagnostic[];
}

export interface ProgramSet {
  main: ParsedProgram;
  /** Additional files that may contain O-numbered subprograms. */
  subprograms: ParsedProgram[];
}

export interface ProgramEvaluation {
  blockStates: BlockState[];
  events: SemanticEvent[];
  diagnostics: Diagnostic[];
  /** True when control flow depended on a system variable with no known value. */
  approximate: boolean;
}

const MM_PER_INCH = 25.4;
const MOTION_CODES = new Set([
  'G0',
  'G1',
  'G2',
  'G3',
  'G73',
  'G77',
  'G80',
  'G81',
  'G83',
]);
const CYCLE_CODES = new Set<CycleCode>(['G73', 'G77', 'G81', 'G83']);
const STANDARD_M_CODES = new Set([
  'M0',
  'M1',
  'M2',
  'M3',
  'M4',
  'M5',
  'M6',
  'M7',
  'M8',
  'M9',
  'M30',
  'M98',
  'M99',
]);

const toMm = (value: number, units: Units): number =>
  units === 'inch' ? value * MM_PER_INCH : value;

const clonePose = (pose: Pose): Pose => ({ ...pose });

const cloneState = (state: MachineState): MachineState => ({
  modal: {
    ...state.modal,
    cutterComp: { ...state.modal.cutterComp },
    toolLength: { ...state.modal.toolLength },
    cycle: state.modal.cycle ? { ...state.modal.cycle } : null,
    rotation: state.modal.rotation
      ? { ...state.modal.rotation, center: [...state.modal.rotation.center] }
      : null,
    scaling: state.modal.scaling ? { ...state.modal.scaling } : null,
  },
  position: clonePose(state.position),
  machinePosition: clonePose(state.machinePosition),
  offsets: Object.fromEntries(
    Object.entries(state.offsets).map(([key, offset]) => [
      key,
      { ...offset, translation: { ...offset.translation } },
    ]),
  ),
  localOffset: { ...state.localOffset },
  tool: { ...state.tool },
  spindle: { ...state.spindle },
  coolant: state.coolant,
  feed: state.feed,
  sequenceNumber: state.sequenceNumber,
});

export function initialMachineState(
  profile: ResolvedMachineProfile,
): MachineState {
  const offsets: Record<string, WorkOffset> = {};
  for (const code of profile.flavor.dialect.workOffsets) {
    if (code === 'G54.1') continue;
    offsets[code] = { code, translation: { x: 0, y: 0, z: 0 } };
  }

  return {
    modal: {
      motion: 'G0',
      motionInitialized: false,
      plane: 'XY',
      distance: 'absolute',
      arcCenter: 'incremental',
      units: profile.units,
      feedMode: profile.flavor.dialect.feedMode,
      cutterComp: { mode: 'off', register: null },
      toolLength: { mode: 'off', register: null, lRegister: null },
      workOffsetCode: 'G54',
      cycleReturn: 'initial',
      cycle: null,
      rotation: null,
      scaling: null,
      spindleMode: 'rpm',
    },
    position: { x: 0, y: 0, z: 0, a: 0 },
    machinePosition: { x: 0, y: 0, z: 0, a: 0 },
    offsets,
    localOffset: { x: 0, y: 0, z: 0 },
    tool: {
      requested: null,
      active: null,
      lengthOffset: null,
      radiusOffset: null,
      lRegister: null,
    },
    spindle: {
      rpm: null,
      css: null,
      maxRpm: profile.flavor.dialect.spindle.rpmRange[1],
      direction: 'stop',
    },
    coolant: 'off',
    feed: null,
    sequenceNumber: null,
  };
}

function normalizeCode(word: Word): string {
  if (word.value === undefined) return word.raw.toUpperCase();
  return `${word.letter}${word.value}`;
}

function getWord(block: ParsedBlock, letter: string): Word | undefined {
  return block.words.find((word) => word.letter === letter);
}

function getCodes(block: ParsedBlock): string[] {
  return block.words
    .filter((word) => word.letter === 'G' || word.letter === 'M')
    .map(normalizeCode);
}

function diagnostic(
  ruleId: string,
  severity: Diagnostic['severity'],
  message: string,
  span: SourceSpan,
): Diagnostic {
  return { ruleId, severity, message, span };
}

function ensureOffset(state: MachineState, code: string): WorkOffset {
  const existing = state.offsets[code];
  if (existing) return existing;
  const created: WorkOffset = {
    code,
    translation: { x: 0, y: 0, z: 0 },
  };
  state.offsets[code] = created;
  return created;
}

function rotate(point: Vec3, rotation: NonNullable<ModalState['rotation']>): Vec3 {
  const radians = (rotation.angleDeg * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = point.x - rotation.center[0];
  const dy = point.y - rotation.center[1];
  return {
    x: rotation.center[0] + dx * cos - dy * sin,
    y: rotation.center[1] + dx * sin + dy * cos,
    z: point.z,
  };
}

function unrotate(
  point: Vec3,
  rotation: NonNullable<ModalState['rotation']>,
): Vec3 {
  const radians = (rotation.angleDeg * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = point.x - rotation.center[0];
  const dy = point.y - rotation.center[1];
  return {
    x: rotation.center[0] + dx * cos + dy * sin,
    y: rotation.center[1] - dx * sin + dy * cos,
    z: point.z,
  };
}

function workToMachine(point: Pose, state: MachineState): Pose {
  const local: Vec3 = {
    x: point.x + state.localOffset.x,
    y: point.y + state.localOffset.y,
    z: point.z + state.localOffset.z,
  };
  const rotated = state.modal.rotation
    ? rotate(local, state.modal.rotation)
    : local;
  const offset =
    state.offsets[state.modal.workOffsetCode]?.translation ??
    ({ x: 0, y: 0, z: 0 } as Vec3);
  return {
    x: rotated.x + offset.x,
    y: rotated.y + offset.y,
    z: rotated.z + offset.z,
    a: (point.a ?? 0) + (state.offsets[state.modal.workOffsetCode]?.a ?? 0),
  };
}

function machineToWork(point: Pose, state: MachineState): Pose {
  const offset =
    state.offsets[state.modal.workOffsetCode]?.translation ??
    ({ x: 0, y: 0, z: 0 } as Vec3);
  const local: Vec3 = {
    x: point.x - offset.x,
    y: point.y - offset.y,
    z: point.z - offset.z,
  };
  const unrotated = state.modal.rotation
    ? unrotate(local, state.modal.rotation)
    : local;
  return {
    x: unrotated.x - state.localOffset.x,
    y: unrotated.y - state.localOffset.y,
    z: unrotated.z - state.localOffset.z,
    a:
      (point.a ?? 0) -
      (state.offsets[state.modal.workOffsetCode]?.a ?? 0),
  };
}

function applyG10(
  state: MachineState,
  block: ParsedBlock,
  events: SemanticEvent[],
  diagnostics: Diagnostic[],
): void {
  const l = getWord(block, 'L')?.value;
  const p = getWord(block, 'P')?.value;
  if (l === undefined || p === undefined) return;

  const units = state.modal.units;
  const translation: Vec3 = {
    x: toMm(getWord(block, 'X')?.value ?? 0, units),
    y: toMm(getWord(block, 'Y')?.value ?? 0, units),
    z: toMm(getWord(block, 'Z')?.value ?? 0, units),
  };
  const a = getWord(block, 'A')?.value;

  if (l === 20) {
    const code = `G54.1 P${p}`;
    state.offsets[code] = { code, translation, a };
    events.push({ kind: 'offset-set', code, translation, a, line: block.line });
    return;
  }

  if (l === 2) {
    const code = `G5${3 + p}`;
    state.offsets[code] = { code, translation, a };
    events.push({ kind: 'offset-set', code, translation, a, line: block.line });
    return;
  }

  if (l >= 10 && l <= 13) {
    // Tool-offset data (Brother OFFSET.OFS). Keep as an event; tool geometry
    // is outside v1 until the tool library lands.
    events.push({
      kind: 'offset-set',
      code: `G10 L${l} P${p}`,
      translation,
      line: block.line,
    });
    return;
  }

  diagnostics.push(
    diagnostic(
      'unsupported-g10',
      'warning',
      `Unsupported G10 L${l} data-setting form.`,
      block.words[0]?.span ?? { file: block.file, line: block.line, column: 1 },
    ),
  );
}

function applyG52(
  state: MachineState,
  block: ParsedBlock,
): void {
  const units = state.modal.units;
  const x = getWord(block, 'X');
  const y = getWord(block, 'Y');
  const z = getWord(block, 'Z');
  if (!x && !y && !z) {
    state.localOffset = { x: 0, y: 0, z: 0 };
    return;
  }
  if (x?.value !== undefined) state.localOffset.x = toMm(x.value, units);
  if (y?.value !== undefined) state.localOffset.y = toMm(y.value, units);
  if (z?.value !== undefined) state.localOffset.z = toMm(z.value, units);
}

function applyMCode(
  state: MachineState,
  block: ParsedBlock,
  profile: ResolvedMachineProfile,
  code: string,
  events: SemanticEvent[],
  diagnostics: Diagnostic[],
): void {
  const span = block.words.find((word) => normalizeCode(word) === code)?.span ?? {
    file: block.file,
    line: block.line,
    column: 1,
  };

  switch (code) {
    case 'M3':
    case 'M4':
      state.spindle.direction = code === 'M3' ? 'cw' : 'ccw';
      events.push({
        kind: 'spindle',
        direction: state.spindle.direction,
        rpm: state.spindle.rpm,
        line: block.line,
      });
      return;
    case 'M5':
      state.spindle.direction = 'stop';
      events.push({
        kind: 'spindle',
        direction: 'stop',
        rpm: state.spindle.rpm,
        line: block.line,
      });
      return;
    case 'M6': {
      if (state.tool.requested === null) {
        diagnostics.push(
          diagnostic(
            'missing-tool',
            'warning',
            'Tool change without a requested T word.',
            span,
          ),
        );
      }
      state.tool.active = state.tool.requested;
      events.push({
        kind: 'tool-change',
        tool: state.tool.active ?? -1,
        line: block.line,
      });
      return;
    }
    case 'M7':
      state.coolant = 'mist';
      events.push({ kind: 'coolant', state: 'mist', line: block.line });
      return;
    case 'M8':
      state.coolant = 'flood';
      events.push({ kind: 'coolant', state: 'flood', line: block.line });
      return;
    case 'M9':
      state.coolant = 'off';
      events.push({ kind: 'coolant', state: 'off', line: block.line });
      return;
    case 'M0':
    case 'M1':
      events.push({ kind: 'program-stop', code, line: block.line });
      return;
    case 'M2':
    case 'M30':
      events.push({ kind: 'program-end', code, line: block.line });
      return;
    case 'M98':
    case 'M99':
      return;
    default:
      break;
  }

  const custom = profile.flavor.customMCodes[code];
  if (custom) {
    events.push({
      kind: 'custom-mcode',
      code,
      description: custom.description,
      line: block.line,
    });
    return;
  }

  if (!STANDARD_M_CODES.has(code)) {
    diagnostics.push(
      diagnostic(
        'unknown-custom-mcode',
        'warning',
        `M-code ${code} is not defined for ${profile.flavor.name}.`,
        span,
      ),
    );
  }
}

function axisTarget(
  current: number,
  word: Word | undefined,
  distance: DistanceMode,
  units: Units,
  scale = 1,
): number | undefined {
  if (!word || word.value === undefined) return undefined;
  const value = toMm(word.value, units) * scale;
  return distance === 'incremental' ? current + value : value;
}

/**
 * Convert constant surface speed into a clamped spindle RPM. Surface speed is
 * m/min in mm mode and ft/min in inch mode; internal X is always a radius in
 * millimetres. A zero diameter clamps to the configured ceiling.
 */
function cssRpm(
  surfaceSpeed: number,
  radiusMm: number,
  units: Units,
  maxRpm: number | null,
): number {
  const ceiling =
    maxRpm !== null && Number.isFinite(maxRpm) && maxRpm > 0
      ? maxRpm
      : Infinity;
  const diameterMm = radiusMm * 2;
  if (!Number.isFinite(surfaceSpeed) || diameterMm <= 0) {
    return ceiling === Infinity ? 0 : ceiling;
  }
  const surfaceMmPerMin =
    units === 'inch' ? surfaceSpeed * 12 * MM_PER_INCH : surfaceSpeed * 1000;
  return Math.min(surfaceMmPerMin / (Math.PI * diameterMm), ceiling);
}

/** Lathe U/W axes are always incremental, regardless of G90/G91. */
function incrementalAxisTarget(
  current: number,
  word: Word | undefined,
  units: Units,
  scale = 1,
): number | undefined {
  if (!word || word.value === undefined) return undefined;
  return current + toMm(word.value, units) * scale;
}

function axisTargetDegrees(
  current: number,
  word: Word | undefined,
  distance: DistanceMode,
): number | undefined {
  if (!word || word.value === undefined) return undefined;
  return distance === 'incremental' ? current + word.value : word.value;
}

function cycleParams(
  block: ParsedBlock,
  units: Units,
): Omit<CycleState, 'code'> {
  const z = getWord(block, 'Z');
  const r = getWord(block, 'R');
  const q = getWord(block, 'Q');
  const p = getWord(block, 'P');
  const i = getWord(block, 'I');
  return {
    z: z?.value !== undefined ? toMm(z.value, units) : undefined,
    r: r?.value !== undefined ? toMm(r.value, units) : undefined,
    q: q?.value !== undefined ? toMm(q.value, units) : undefined,
    p: p?.value,
    i: i?.value,
  };
}

function validateCodeGroups(
  block: ParsedBlock,
  profile: ResolvedMachineProfile,
  diagnostics: Diagnostic[],
): void {
  const groups = new Map<string, string>();
  for (const word of block.words) {
    if (word.letter !== 'G') continue;
    const code = normalizeCode(word);
    const group = profile.flavor.dialect.codeGroups[code];
    if (!group) {
      diagnostics.push(
        diagnostic(
          'unsupported-code',
          'warning',
          `G-code ${code} is not defined for ${profile.flavor.name}.`,
          word.span,
        ),
      );
      continue;
    }
    if (group === 'none') continue;
    const existing = groups.get(group);
    if (existing && existing !== code) {
      // G80 cancels a canned cycle and is commonly programmed alongside an
      // explicit motion code (e.g. `G00 G90 G40 G80`). The explicit motion
      // code still selects the mode, so this is not a group conflict.
      const g80Cancel =
        group === 'motion' &&
        (existing === 'G80' || code === 'G80') &&
        existing !== code;
      if (!g80Cancel) {
        diagnostics.push(
          diagnostic(
            'conflicting-modal-group',
            'error',
            `Conflicting codes in modal group ${group}: ${existing} and ${code}.`,
            word.span,
          ),
        );
      }
    }
    groups.set(group, code);
  }
}

export function applyBlock(
  state: MachineState,
  block: ParsedBlock,
  profile: ResolvedMachineProfile,
): { state: MachineState; events: SemanticEvent[]; diagnostics: Diagnostic[] } {
  const next = cloneState(state);
  const events: SemanticEvent[] = [];
  const diagnostics: Diagnostic[] = [];
  const codes = getCodes(block);
  const codeSet = new Set(codes);
  const isLathe = profile.flavor.machineType === 'lathe';

  validateCodeGroups(block, profile, diagnostics);

  if (block.sequenceNumber !== null) next.sequenceNumber = block.sequenceNumber;

  if (block.macro) {
    return { state: next, events, diagnostics };
  }

  if (codeSet.has('G20')) next.modal.units = 'inch';
  if (codeSet.has('G21')) next.modal.units = 'mm';
  const units = next.modal.units;

  if (codeSet.has('G17')) next.modal.plane = 'XY';
  if (codeSet.has('G18')) next.modal.plane = 'ZX';
  if (codeSet.has('G19')) next.modal.plane = 'YZ';

  if (codeSet.has('G90')) next.modal.distance = 'absolute';
  if (codeSet.has('G91')) next.modal.distance = 'incremental';

  if (codeSet.has('G90.1')) next.modal.arcCenter = 'absolute';
  if (codeSet.has('G91.1')) next.modal.arcCenter = 'incremental';

  if (codeSet.has('G93')) next.modal.feedMode = 'G93';
  if (codeSet.has('G94')) next.modal.feedMode = 'G94';
  if (codeSet.has('G95')) next.modal.feedMode = 'G95';

  if (codeSet.has('G40')) next.modal.cutterComp = { mode: 'off', register: null };
  if (codeSet.has('G41')) {
    next.modal.cutterComp = {
      mode: 'left',
      register: getWord(block, 'D')?.value ?? null,
    };
  }
  if (codeSet.has('G42')) {
    next.modal.cutterComp = {
      mode: 'right',
      register: getWord(block, 'D')?.value ?? null,
    };
  }

  if (codeSet.has('G49')) {
    next.modal.toolLength = { mode: 'off', register: null, lRegister: null };
  }
  if (codeSet.has('G43')) {
    next.modal.toolLength = {
      mode: 'positive',
      register: getWord(block, 'H')?.value ?? null,
      lRegister: getWord(block, 'L')?.value ?? null,
    };
  }
  if (codeSet.has('G44')) {
    next.modal.toolLength = {
      mode: 'negative',
      register: getWord(block, 'H')?.value ?? null,
      lRegister: getWord(block, 'L')?.value ?? null,
    };
  }

  if (codeSet.has('G98')) next.modal.cycleReturn = 'initial';
  if (codeSet.has('G99')) next.modal.cycleReturn = 'r';

  if (codeSet.has('G96')) next.modal.spindleMode = 'css';
  if (codeSet.has('G97')) {
    next.modal.spindleMode = 'rpm';
    next.spindle.css = null;
  }

  if (codeSet.has('G69')) next.modal.rotation = null;
  if (codeSet.has('G68')) {
    const x = getWord(block, 'X');
    const y = getWord(block, 'Y');
    const r = getWord(block, 'R');
    if (x?.value !== undefined && y?.value !== undefined && r?.value !== undefined) {
      next.modal.rotation = {
        angleDeg: r.value,
        center: [toMm(x.value, units), toMm(y.value, units)],
        plane: next.modal.plane,
      };
    } else {
      diagnostics.push(
        diagnostic(
          'invalid-rotation-parameters',
          'error',
          'G68 requires X, Y, and R words.',
          block.words[0]?.span ?? { file: block.file, line: block.line, column: 1 },
        ),
      );
    }
  }

  if (codeSet.has('G50')) next.modal.scaling = null;
  if (codeSet.has('G51')) {
    const x = getWord(block, 'X');
    const y = getWord(block, 'Y');
    const z = getWord(block, 'Z');
    const factor = x?.value ?? y?.value ?? z?.value;
    if (factor !== undefined) next.modal.scaling = { factor };
  }

  if (codeSet.has('G10')) {
    applyG10(next, block, events, diagnostics);
  }

  if (codeSet.has('G52')) {
    applyG52(next, block);
  }

  for (const word of block.words) {
    if (word.letter !== 'G') continue;
    const code = normalizeCode(word);
    if (profile.flavor.dialect.codeGroups[code] !== 'workOffset') continue;
    next.modal.workOffsetCode = code;
    ensureOffset(next, code);
  }

  if (codeSet.has('G54.1')) {
    const p = getWord(block, 'P')?.value;
    if (p !== undefined) {
      const code = `G54.1 P${p}`;
      next.modal.workOffsetCode = code;
      ensureOffset(next, code);
    }
  }

  const tWord = getWord(block, 'T');
  if (tWord?.value !== undefined) next.tool.requested = tWord.value;

  const sWord = getWord(block, 'S');
  if (sWord?.value !== undefined) {
    if (next.modal.spindleMode === 'css') {
      next.spindle.css = sWord.value;
      if (profile.flavor.dialect.spindle.cssSupported) {
        next.spindle.rpm = cssRpm(
          sWord.value,
          next.position.x,
          units,
          next.spindle.maxRpm,
        );
      }
    } else {
      next.spindle.rpm = sWord.value;
    }
  }

  const fWord = getWord(block, 'F');
  if (fWord?.value !== undefined) {
    next.feed =
      next.modal.feedMode === 'G94'
        ? toMm(fWord.value, units)
        : fWord.value;
  }

  for (const code of codes.filter((candidate) => candidate.startsWith('M'))) {
    applyMCode(next, block, profile, code, events, diagnostics);
  }

  const explicitMotions = codes.filter((code) =>
    MOTION_CODES.has(code),
  ) as MotionMode[];
  // G80 is a cancellation code; a concurrent motion code selects the mode,
  // matching the `G00 ... G80` idiom used by Brother programs.
  const motionCode =
    explicitMotions.find((code) => code !== 'G80') ?? explicitMotions[0];

  if (codeSet.has('G80')) {
    next.modal.cycle = null;
  }

  if (motionCode) {
    next.modal.motion = motionCode;
    next.modal.motionInitialized = true;
    if (CYCLE_CODES.has(motionCode as CycleCode)) {
      next.modal.cycle = {
        ...next.modal.cycle,
        code: motionCode as CycleCode,
        ...cycleParams(block, units),
      };
    }
  }

  if (codeSet.has('G4')) {
    const p = getWord(block, 'P')?.value;
    const x = getWord(block, 'X')?.value;
    const seconds = x ?? p ?? 0;
    events.push({ kind: 'dwell', seconds, line: block.line });
  }

  if (codeSet.has('G28') || codeSet.has('G30')) {
    const axes = ['X', 'Y', 'Z', 'A'].filter((letter) => getWord(block, letter));
    const homeAxes = axes.length > 0 ? axes : ['X', 'Y', 'Z', 'A'];
    const target = clonePose(next.machinePosition);
    for (const axis of homeAxes) {
      if (axis === 'A') target.a = 0;
      else target[axis.toLowerCase() as 'x' | 'y' | 'z'] = 0;
    }
    next.machinePosition = target;
    next.position = machineToWork(target, next);
    events.push({ kind: 'home', axes: homeAxes, line: block.line });
  }

  const isDataOnly =
    codeSet.has('G4') ||
    codeSet.has('G10') ||
    codeSet.has('G28') ||
    codeSet.has('G30') ||
    codeSet.has('G52') ||
    codeSet.has('G68') ||
    codeSet.has('G69');

  if (!isDataOnly) {
    const machineMove = codeSet.has('G53');
    const target = clonePose(next.position);
    const x = getWord(block, 'X');
    const y = getWord(block, 'Y');
    const z = getWord(block, 'Z');
    const a = getWord(block, 'A');
    const u = getWord(block, 'U');
    const w = getWord(block, 'W');

    if (!isLathe) {
      for (const word of [u, w]) {
        if (word?.value !== undefined) {
          diagnostics.push(
            diagnostic(
              'unsupported-lathe-axis',
              'warning',
              `Axis ${word.letter} is only supported on lathe flavors; ignoring.`,
              word.span,
            ),
          );
        }
      }
    }

    if (machineMove) {
      if (x?.value !== undefined) {
        target.x = toMm(x.value, units) * (isLathe ? 0.5 : 1);
      }
      if (!isLathe && y?.value !== undefined) target.y = toMm(y.value, units);
      if (z?.value !== undefined) target.z = toMm(z.value, units);
      if (!isLathe && a?.value !== undefined) target.a = a.value;
    } else if (isLathe) {
      // X is diameter-programmed; store the radius internally. U is an
      // incremental diameter, W an incremental Z.
      const xt = axisTarget(
        next.position.x,
        x,
        next.modal.distance,
        units,
        0.5,
      );
      const zt = axisTarget(next.position.z, z, next.modal.distance, units);
      if (xt !== undefined) target.x = xt;
      if (zt !== undefined) target.z = zt;
      const ut = incrementalAxisTarget(target.x, u, units, 0.5);
      const wt = incrementalAxisTarget(target.z, w, units);
      if (ut !== undefined) target.x = ut;
      if (wt !== undefined) target.z = wt;
    } else {
      const xt = axisTarget(next.position.x, x, next.modal.distance, units);
      const yt = axisTarget(next.position.y, y, next.modal.distance, units);
      const zt = axisTarget(next.position.z, z, next.modal.distance, units);
      const at = axisTargetDegrees(
        next.position.a ?? 0,
        a,
        next.modal.distance,
      );
      if (xt !== undefined) target.x = xt;
      if (yt !== undefined) target.y = yt;
      if (zt !== undefined) target.z = zt;
      if (at !== undefined) target.a = at;
    }

    const hasAxisWord = Boolean(x || z || (isLathe ? u || w : y || a));
    const firstAxisWord = x ?? z ?? (isLathe ? u ?? w : y ?? a);
    const mode = motionCode ?? next.modal.motion;

    if (!motionCode && hasAxisWord && !next.modal.motionInitialized) {
      diagnostics.push(
        diagnostic(
          'missing-motion-mode',
          'warning',
          'Axis words appear before any motion mode has been established; assuming G0.',
          firstAxisWord?.span ?? {
            file: block.file,
            line: block.line,
            column: 1,
          },
        ),
      );
    }

    if (hasAxisWord && (mode === 'G0' || mode === 'G1')) {
      const move: Move = {
        kind: mode === 'G0' ? 'rapid' : 'linear',
        from: clonePose(next.position),
        to: clonePose(target),
        feed: next.feed,
        feedMode: next.modal.feedMode,
        line: block.line,
      };
      events.push({ kind: 'move', move });
      next.position = target;
      next.machinePosition = machineMove ? target : workToMachine(target, next);
    } else if (hasAxisWord && (mode === 'G2' || mode === 'G3')) {
      const arc = buildArcMove(next, block, target, mode === 'G2', units);
      if (arc) {
        events.push({ kind: 'move', move: arc });
        next.position = target;
        next.machinePosition = workToMachine(target, next);
      }
    } else if (
      hasAxisWord &&
      (mode === 'G81' || mode === 'G83' || mode === 'G73' || mode === 'G77')
    ) {
      const cycle = next.modal.cycle;
      if (cycle) {
        events.push({
          kind: 'move',
          move: {
            kind: 'canned-cycle',
            code: cycle.code,
            from: clonePose(next.position),
            at: target,
            z: cycle.z,
            r: cycle.r,
            q: cycle.q,
            p: cycle.p,
            i: cycle.i,
            feed: next.feed,
            feedMode: next.modal.feedMode,
            line: block.line,
          },
        });
        next.position = target;
        next.machinePosition = workToMachine(target, next);
      }
    } else if (hasAxisWord && mode === 'G80') {
      diagnostics.push(
        diagnostic(
          'motion-cancelled',
          'warning',
          'Axis words follow G80 with no active motion mode.',
          firstAxisWord?.span ?? {
            file: block.file,
            line: block.line,
            column: 1,
          },
        ),
      );
    }
  }

  return { state: next, events, diagnostics };
}

function buildArcMove(
  state: MachineState,
  block: ParsedBlock,
  target: Pose,
  clockwise: boolean,
  units: Units,
): Move | null {
  const i = getWord(block, 'I');
  const j = getWord(block, 'J');
  const k = getWord(block, 'K');
  const r = getWord(block, 'R');
  const plane = state.modal.plane;

  let center: [number, number] | undefined;
  if (r?.value !== undefined) {
    center = undefined;
  } else if (plane === 'XY') {
    const ci = i?.value !== undefined ? toMm(i.value, units) : 0;
    const cj = j?.value !== undefined ? toMm(j.value, units) : 0;
    center = [state.position.x + ci, state.position.y + cj];
  } else if (plane === 'ZX') {
    const ck = k?.value !== undefined ? toMm(k.value, units) : 0;
    const ci = i?.value !== undefined ? toMm(i.value, units) : 0;
    center = [state.position.z + ck, state.position.x + ci];
  } else {
    const cj = j?.value !== undefined ? toMm(j.value, units) : 0;
    const ck = k?.value !== undefined ? toMm(k.value, units) : 0;
    center = [state.position.y + cj, state.position.z + ck];
  }

  if (!center && r?.value === undefined) {
    return null;
  }

  return {
    kind: 'arc',
    from: clonePose(state.position),
    to: clonePose(target),
    plane,
    clockwise,
    center,
    radius: r?.value !== undefined ? toMm(r.value, units) : undefined,
    feed: state.feed,
    feedMode: state.modal.feedMode,
    line: block.line,
  };
}

interface MacroResult {
  jump?: number;
  stop?: boolean;
  approximate?: boolean;
}

function compare(
  left: number,
  operator: string,
  right: number,
): boolean | undefined {
  switch (operator) {
    case 'EQ':
      return left === right;
    case 'NE':
      return left !== right;
    case 'GT':
      return left > right;
    case 'LT':
      return left < right;
    case 'GE':
      return left >= right;
    case 'LE':
      return left <= right;
    default:
      return undefined;
  }
}

function macroValue(
  token: { type: string; value?: number },
  profile: ResolvedMachineProfile,
  diagnostics: Diagnostic[],
  span: SourceSpan,
): number | null {
  if (token.type === 'number') return token.value ?? null;
  if (token.type === 'variable') {
    const key = `#${token.value}`;
    const variable = profile.flavor.systemVariables[key];
    if (!variable || variable.value === undefined || variable.value === 'unknown') {
      diagnostics.push(
        diagnostic(
          'unknown-system-variable',
          'warning',
          `System variable ${key} has no configured value.`,
          span,
        ),
      );
      return null;
    }
    return variable.value;
  }
  return null;
}

/**
 * Resolve a GOTO target the way mill controls do: search forward from the
 * current block, wrapping to the first occurrence if the target is not ahead.
 * Programs reuse section-local labels such as `N20`, so the first match in
 * file order is not always correct.
 */
function resolveLabel(
  labels: Map<number, number[]>,
  target: number,
  pc: number,
): number | undefined {
  const occurrences = labels.get(target);
  if (!occurrences || occurrences.length === 0) return undefined;
  return occurrences.find((index) => index > pc) ?? occurrences[0];
}

function applyMacro(
  block: ParsedBlock,
  labels: Map<number, number[]>,
  pc: number,
  profile: ResolvedMachineProfile,
  diagnostics: Diagnostic[],
): MacroResult {
  const macro = block.macro;
  if (!macro) return {};

  const span = macro.span;

  if (macro.kind === 'alarm') {
    const message = macro.message || `Macro alarm ${macro.variable}`;
    diagnostics.push(diagnostic('macro-alarm', 'error', message, span));
    return { stop: true };
  }

  if (macro.kind === 'assignment') {
    diagnostics.push(
      diagnostic(
        'unsupported-macro',
        'warning',
        `Unsupported macro assignment for variable #${macro.variable}.`,
        span,
      ),
    );
    return {};
  }

  if (macro.kind === 'unknown') {
    diagnostics.push(
      diagnostic('unsupported-macro', 'warning', 'Unsupported macro statement.', span),
    );
    return {};
  }

  if (macro.kind === 'goto') {
    if (macro.target === null) {
      diagnostics.push(
        diagnostic('invalid-macro-target', 'error', 'GOTO target is missing.', span),
      );
      return {};
    }
    const target = resolveLabel(labels, macro.target, pc);
    if (target === undefined) {
      diagnostics.push(
        diagnostic(
          'missing-label',
          'error',
          `GOTO target N${macro.target} was not found.`,
          span,
        ),
      );
      return {};
    }
    return { jump: target };
  }

  if (macro.kind === 'if-goto') {
    const open = macro.tokens.findIndex((token) => token.type === 'bracket-open');
    const close = macro.tokens.findIndex((token) => token.type === 'bracket-close');
    if (open < 0 || close < 0 || close <= open) {
      diagnostics.push(
        diagnostic(
          'invalid-macro-condition',
          'error',
          'IF condition is missing brackets.',
          span,
        ),
      );
      return {};
    }
    const conditionTokens = macro.tokens.slice(open + 1, close);
    const operatorToken = conditionTokens.find(
      (token) => token.type === 'identifier',
    );
    if (!operatorToken || conditionTokens.length < 3) {
      diagnostics.push(
        diagnostic(
          'invalid-macro-condition',
          'error',
          'IF condition must be <value> <operator> <value>.',
          span,
        ),
      );
      return {};
    }
    const leftToken = conditionTokens[0];
    const rightToken = conditionTokens[conditionTokens.length - 1];
    const left = macroValue(leftToken, profile, diagnostics, span);
    const right = macroValue(rightToken, profile, diagnostics, span);
    const approximate = left === null || right === null;
    const operator = operatorToken.raw.toUpperCase();
    const result = approximate ? true : compare(left, operator, right);

    if (result === undefined) {
      diagnostics.push(
        diagnostic(
          'invalid-macro-condition',
          'error',
          `Unsupported comparison operator ${operator}.`,
          span,
        ),
      );
      return {};
    }

    if (approximate) {
      diagnostics.push(
        diagnostic(
          'macro-condition-assumed',
          'info',
          'Condition involves an unconfigured system variable; assuming the check passes.',
          span,
        ),
      );
    }

    if (!result) return { approximate };

    if (macro.target === null) {
      diagnostics.push(
        diagnostic('invalid-macro-target', 'error', 'GOTO target is missing.', span),
      );
      return { approximate };
    }
    const target = resolveLabel(labels, macro.target, pc);
    if (target === undefined) {
      diagnostics.push(
        diagnostic(
          'missing-label',
          'error',
          `GOTO target N${macro.target} was not found.`,
          span,
        ),
      );
      return { approximate };
    }
    return { jump: target, approximate };
  }

  return {};
}

interface ExecutionFrame {
  program: ParsedProgram;
  pc: number;
  startIndex: number;
  returnPc: number | null;
  number: number | null;
  repeatsLeft: number;
}

function findSubprogram(
  number: number,
  programs: ParsedProgram[],
): { program: ParsedProgram; startIndex: number } | undefined {
  for (const program of programs) {
    const index = program.blocks.findIndex((block) =>
      block.words.some(
        (word) => word.letter === 'O' && word.value === number,
      ),
    );
    if (index >= 0) return { program, startIndex: index + 1 };
  }
  return undefined;
}

function buildLabelMap(program: ParsedProgram): Map<number, number[]> {
  const labels = new Map<number, number[]>();
  program.blocks.forEach((block, index) => {
    if (block.sequenceNumber === null) return;
    const occurrences = labels.get(block.sequenceNumber) ?? [];
    occurrences.push(index);
    labels.set(block.sequenceNumber, occurrences);
  });
  return labels;
}

export function evaluateProgram(
  source: ParsedProgram | ProgramSet,
  profile: ResolvedMachineProfile,
): ProgramEvaluation {
  const main = 'main' in source ? source.main : source;
  const programs = 'main' in source
    ? [source.main, ...source.subprograms]
    : [source];
  const labelMaps = new Map<ParsedProgram, Map<number, number[]>>(
    programs.map((program) => [program, buildLabelMap(program)]),
  );

  let state = initialMachineState(profile);
  const blockStates: BlockState[] = [];
  const events: SemanticEvent[] = [];
  const diagnostics: Diagnostic[] = programs.flatMap(
    (program) => program.diagnostics,
  );

  const frames: ExecutionFrame[] = [
    {
      program: main,
      pc: 0,
      startIndex: 0,
      returnPc: null,
      number: null,
      repeatsLeft: 1,
    },
  ];

  const maxJumps = profile.flavor.dialect.macros.maxIterations;
  const maxDepth = profile.flavor.dialect.subprograms.maxDepth;
  let approximate = false;
  let jumps = 0;

  while (frames.length > 0) {
    const frame = frames[frames.length - 1];
    if (frame.pc >= frame.program.blocks.length) {
      if (frame.returnPc === null) break;
      if (frame.repeatsLeft > 1) {
        frame.repeatsLeft -= 1;
        frame.pc = frame.startIndex;
        continue;
      }
      frames.pop();
      const parent = frames[frames.length - 1];
      if (parent && frame.returnPc !== null) parent.pc = frame.returnPc;
      continue;
    }

    const block = frame.program.blocks[frame.pc];
    const labels = labelMaps.get(frame.program)!;

    if (block.macro) {
      const result = applyMacro(block, labels, frame.pc, profile, diagnostics);
      if (result.approximate) approximate = true;
      const macroEvents: SemanticEvent[] = [];
      if (block.macro.kind === 'alarm') {
        macroEvents.push({
          kind: 'alarm',
          message: block.macro.message,
          line: block.line,
        });
      }
      blockStates.push({
        block,
        before: state,
        after: state,
        events: macroEvents,
        diagnostics: diagnostics.filter(
          (entry) =>
            entry.span.line === block.line && entry.span.file === block.file,
        ),
      });
      events.push(...macroEvents);
      if (result.stop) break;
      if (result.jump !== undefined) {
        jumps += 1;
        if (jumps > maxJumps) {
          diagnostics.push(
            diagnostic(
              'macro-iteration-limit',
              'error',
              `Macro execution exceeded ${maxJumps} jumps.`,
              block.macro.span,
            ),
          );
          break;
        }
        frame.pc = result.jump;
        continue;
      }
      frame.pc += 1;
      continue;
    }

    const before = state;
    const applied = applyBlock(before, block, profile);
    state = applied.state;
    blockStates.push({
      block,
      before,
      after: state,
      events: applied.events,
      diagnostics: applied.diagnostics,
    });
    diagnostics.push(...applied.diagnostics);
    events.push(...applied.events);

    const codes = getCodes(block);

    if (codes.includes('M98')) {
      const number = getWord(block, 'P')?.value;
      const span =
        getWord(block, 'P')?.span ??
        ({ file: block.file, line: block.line, column: 1 } as SourceSpan);
      if (number === undefined) {
        diagnostics.push(
          diagnostic(
            'missing-subprogram',
            'error',
            'M98 requires a P word with the subprogram number.',
            span,
          ),
        );
      } else {
        const subprogram = findSubprogram(number, programs);
        if (!subprogram) {
          diagnostics.push(
            diagnostic(
              'missing-subprogram',
              'error',
              `Subprogram O${number} was not found in the program set.`,
              span,
            ),
          );
        } else if (frames.length >= maxDepth) {
          diagnostics.push(
            diagnostic(
              'subprogram-depth-exceeded',
              'error',
              `Subprogram nesting exceeds the flavor limit of ${maxDepth}.`,
              span,
            ),
          );
        } else {
          events.push({
            kind: 'subprogram-call',
            number,
            file: subprogram.program.file,
            line: block.line,
          });
          frames.push({
            program: subprogram.program,
            pc: subprogram.startIndex,
            startIndex: subprogram.startIndex,
            returnPc: frame.pc + 1,
            number,
            repeatsLeft: Math.max(1, getWord(block, 'L')?.value ?? 1),
          });
          continue;
        }
      }
    }

    const returns = codes.includes('M99');
    if (returns) {
      events.push({
        kind: 'subprogram-return',
        number: frame.number,
        file: frame.program.file,
        line: block.line,
      });
      if (frame.returnPc === null) break;
      if (frame.repeatsLeft > 1) {
        frame.repeatsLeft -= 1;
        frame.pc = frame.startIndex;
      } else {
        frames.pop();
        const parent = frames[frames.length - 1];
        if (parent) parent.pc = frame.returnPc;
      }
      continue;
    }

    if (codes.includes('M2') || codes.includes('M30')) break;
    frame.pc += 1;
  }

  return { blockStates, events, diagnostics, approximate };
}
