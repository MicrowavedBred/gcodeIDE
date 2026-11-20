import {
  resolveProfile,
  type Flavor,
  type MachineVariant,
  type ResolvedMachineProfile,
  type UserPreferences,
} from '../types';
import { millCodeGroups, PROFILE_METADATA as metadata } from './common';

export const fanucMillFlavor: Flavor = {
  id: 'fanuc-mill',
  name: 'Fanuc Mill',
  vendor: 'Fanuc',
  source: 'builtin',
  machineType: 'mill',
  dialect: {
    nativeUnits: 'inch',
    allowUnitSwitch: true,
    workOffsets: ['G54', 'G55', 'G56', 'G57', 'G58', 'G59', 'G54.1'],
    toolLengthComp: {
      enabled: true,
      register: 'H',
      requiredWithToolChange: true,
    },
    cutterComp: {
      enabled: true,
      activate: ['G41', 'G42'],
      cancel: 'G40',
      requiresD: true,
    },
    arcCentering: 'IJ',
    planeSelect: true,
    cannedCycles: ['G73', 'G81', 'G83'],
    subprograms: {
      enabled: true,
      call: 'M98',
      end: 'M99',
      maxDepth: 8,
    },
    macroSupport: 'basic',
    macros: {
      enabled: true,
      ifGoto: true,
      alarmVariable: '#3000',
      maxIterations: 10000,
    },
    toolChange: { code: 'M06', requiresT: true },
    spindle: { rpmRange: [0, 10000], cssSupported: false },
    feedMode: 'G94',
    programEnd: 'M30',
    home: { code: 'G28', requiresIntermediate: false },
    codeGroups: millCodeGroups(),
  },
  capabilities: {
    supportsCutterComp: true,
    supportsToolLengthComp: true,
    supportsCannedCycles: true,
    supportsSubprograms: true,
    supportsMacros: true,
    supportsRigidTapping: false,
    maxAxes: 3,
  },
  rules: {},
  display: {
    machineView: 'mill3axis',
    stockShape: 'rectangular',
    defaultStock: null,
  },
  customMCodes: {},
  systemVariables: {
    '#3700': {
      number: '#3700',
      description: 'Current tool number (simulation assumption)',
      value: 1,
      configurable: true,
    },
  },
  variants: [],
  metadata,
};

export const fanucUnspecifiedVariant: MachineVariant = {
  id: 'fanuc-unspecified',
  flavorId: fanucMillFlavor.id,
  name: 'Unspecified',
  isUnspecified: true,
  geometry: { travels: null },
  orientation: 'vertical',
  units: 'inherit',
  metadata,
};

export const fanuc0imVariant: MachineVariant = {
  id: 'fanuc-0im-generic',
  flavorId: fanucMillFlavor.id,
  name: '0i-M (generic)',
  geometry: {
    travels: null,
    maxFeedRate: 10000,
    rapidRate: 30000,
  },
  orientation: 'vertical',
  units: 'inch',
  metadata,
};

fanucMillFlavor.variants = [fanucUnspecifiedVariant, fanuc0imVariant];

export function fanucProfile(
  variantId: string = fanucUnspecifiedVariant.id,
  preferences: UserPreferences = {
    defaultUnits: 'mm',
    defaultVariantByFlavor: { [fanucMillFlavor.id]: fanucUnspecifiedVariant.id },
  },
): ResolvedMachineProfile {
  const variant =
    fanucMillFlavor.variants.find((candidate) => candidate.id === variantId) ??
    fanucUnspecifiedVariant;
  return resolveProfile(fanucMillFlavor, variant, preferences);
}
