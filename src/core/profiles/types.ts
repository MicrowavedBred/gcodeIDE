import type { Severity } from '../shared/types';

export type Units = 'mm' | 'inch';
export type MachineType = 'mill' | 'lathe';
export type Orientation = 'vertical' | 'horizontal';

export type ModalGroup =
  | 'motion'
  | 'plane'
  | 'distance'
  | 'arcCenter'
  | 'feedMode'
  | 'units'
  | 'cutterComp'
  | 'toolLength'
  | 'workOffset'
  | 'cycleReturn'
  | 'rotation'
  | 'scaling'
  | 'spindleMode'
  | 'none';

export interface ToolLengthSettings {
  enabled: boolean;
  register: 'H';
  requiredWithToolChange: boolean;
}

export interface CutterCompSettings {
  enabled: boolean;
  activate: ['G41', 'G42'];
  cancel: 'G40';
  requiresD: boolean;
}

export interface SubprogramSettings {
  enabled: boolean;
  call: 'M98';
  end: 'M99';
  maxDepth: number;
}

export interface MacroSettings {
  enabled: boolean;
  ifGoto: boolean;
  alarmVariable: '#3000';
  maxIterations: number;
}

export interface CustomMCodeDef {
  code: string;
  description: string;
  category?: 'clamp' | 'coolant' | 'door' | 'conveyor' | 'probe' | 'other';
  affectsSimulation?: boolean;
}

export interface SystemVariableDef {
  number: string;
  description: string;
  value?: number | 'unknown';
  configurable: boolean;
}

export interface DialectSettings {
  nativeUnits?: Units;
  allowUnitSwitch: boolean;
  workOffsets: string[];
  toolLengthComp: ToolLengthSettings;
  cutterComp: CutterCompSettings;
  arcCentering: 'IJ' | 'R' | 'both';
  planeSelect: boolean;
  cannedCycles: string[];
  subprograms: SubprogramSettings;
  macroSupport: 'none' | 'basic' | 'full';
  macros: MacroSettings;
  toolChange: { code: 'M06'; requiresT: boolean };
  spindle: { rpmRange: [number, number]; cssSupported: boolean };
  feedMode: 'G94' | 'G95';
  programEnd: 'M30' | 'M02';
  home: { code: 'G28' | 'G30'; requiresIntermediate: boolean };
  codeGroups: Record<string, ModalGroup>;
}

export interface CapabilityFlags {
  supportsCutterComp: boolean;
  supportsToolLengthComp: boolean;
  supportsCannedCycles: boolean;
  supportsSubprograms: boolean;
  supportsMacros: boolean;
  supportsRigidTapping: boolean;
  maxAxes: number;
}

export interface Travel {
  min: number;
  max: number;
}

export interface Travels {
  x: Travel | null;
  y: Travel | null;
  z: Travel | null;
}

export interface RotaryAxis {
  center: [number, number, number];
  axis: 'x' | 'y' | 'z';
  range: [number, number];
}

export interface GeometrySettings {
  travels: Travels | null;
  rotaryAxes?: { a?: RotaryAxis };
  maxFeedRate?: number;
  rapidRate?: number;
  tableSize?: [number, number];
}

export interface DisplaySettings {
  machineView: 'mill3axis' | 'mill2d' | 'lathe2d';
  stockShape: 'rectangular' | 'cylindrical';
  defaultStock: {
    size: [number, number, number];
    origin: 'center-top' | 'corner-bottom' | 'custom';
  } | null;
}

export interface RuleOverride {
  severity: Severity;
  message?: string;
  threshold?: number;
}

export interface EntityMetadata {
  createdAt: string;
  updatedAt: string;
  notes?: string;
}

export interface Flavor {
  id: string;
  name: string;
  vendor?: string;
  source: 'builtin' | 'user';
  machineType: MachineType;
  dialect: DialectSettings;
  capabilities: CapabilityFlags;
  rules: Record<string, Severity | RuleOverride>;
  display: DisplaySettings;
  customMCodes: Record<string, CustomMCodeDef>;
  systemVariables: Record<string, SystemVariableDef>;
  variants: MachineVariant[];
  metadata: EntityMetadata;
}

export interface MachineVariant {
  id: string;
  flavorId: string;
  name: string;
  isUnspecified?: boolean;
  geometry: GeometrySettings;
  orientation: Orientation;
  units: Units | 'inherit';
  capabilityOverrides?: Partial<CapabilityFlags>;
  ruleOverrides?: Record<string, Severity | RuleOverride>;
  displayOverrides?: Partial<DisplaySettings>;
  metadata: EntityMetadata;
}

export interface UserPreferences {
  defaultUnits: Units;
  defaultVariantByFlavor: Record<string, string>;
}

export interface ResolvedMachineProfile {
  flavor: Flavor;
  variant: MachineVariant;
  units: Units;
  travels: Travels | null;
  orientation: Orientation;
  capabilities: CapabilityFlags;
  display: DisplaySettings;
}

export function resolveProfile(
  flavor: Flavor,
  variant: MachineVariant,
  preferences: UserPreferences,
): ResolvedMachineProfile {
  return {
    flavor,
    variant,
    units:
      variant.units === 'inherit' ? preferences.defaultUnits : variant.units,
    travels: variant.geometry.travels,
    orientation: variant.orientation,
    capabilities: {
      ...flavor.capabilities,
      ...variant.capabilityOverrides,
    },
    display: {
      ...flavor.display,
      ...variant.displayOverrides,
    },
  };
}
