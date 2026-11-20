import {
  resolveProfile,
  type Flavor,
  type MachineVariant,
  type ResolvedMachineProfile,
  type UserPreferences,
} from '../types';
import { millCodeGroups, PROFILE_METADATA as metadata } from './common';

export const haasMillFlavor: Flavor = {
  id: 'haas-mill',
  name: 'Haas Mill',
  vendor: 'Haas',
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
    arcCentering: 'both',
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
    spindle: { rpmRange: [0, 15000], cssSupported: false },
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
    supportsRigidTapping: true,
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

export const haasUnspecifiedVariant: MachineVariant = {
  id: 'haas-unspecified',
  flavorId: haasMillFlavor.id,
  name: 'Unspecified',
  isUnspecified: true,
  geometry: { travels: null },
  orientation: 'vertical',
  units: 'inherit',
  metadata,
};

export const haasVf2Variant: MachineVariant = {
  id: 'haas-vf2',
  flavorId: haasMillFlavor.id,
  name: 'VF-2',
  geometry: {
    travels: {
      x: { min: 0, max: 762 },
      y: { min: 0, max: 406 },
      z: { min: 0, max: 508 },
    },
    maxFeedRate: 16500,
    rapidRate: 34000,
    tableSize: [914, 356],
  },
  orientation: 'vertical',
  units: 'inch',
  metadata,
};

haasMillFlavor.variants = [haasUnspecifiedVariant, haasVf2Variant];

export function haasProfile(
  variantId: string = haasUnspecifiedVariant.id,
  preferences: UserPreferences = {
    defaultUnits: 'mm',
    defaultVariantByFlavor: { [haasMillFlavor.id]: haasUnspecifiedVariant.id },
  },
): ResolvedMachineProfile {
  const variant =
    haasMillFlavor.variants.find((candidate) => candidate.id === variantId) ??
    haasUnspecifiedVariant;
  return resolveProfile(haasMillFlavor, variant, preferences);
}
