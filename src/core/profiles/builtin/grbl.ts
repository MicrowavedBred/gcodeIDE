import {
  resolveProfile,
  type Flavor,
  type MachineVariant,
  type ResolvedMachineProfile,
  type UserPreferences,
} from '../types';
import { millCodeGroups, PROFILE_METADATA as metadata, removeCodes } from './common';

// GRBL deliberately omits Fanuc features the controller does not implement:
// cutter comp, length-comp registers, canned cycles, rotation/scaling, macros
// and subprograms. Programs using them should produce `unsupported-code`.
const grblCodeGroups = removeCodes(millCodeGroups(), [
  'G40',
  'G41',
  'G42',
  'G43',
  'G44',
  'G49',
  'G73',
  'G77',
  'G80',
  'G81',
  'G83',
  'G54.1',
  'G68',
  'G69',
  'G50',
  'G51',
  'G96',
  'G97',
  'G93',
  'G95',
  'G98',
  'G99',
  'G30',
]);

export const grblFlavor: Flavor = {
  id: 'grbl',
  name: 'GRBL',
  vendor: 'GRBL',
  source: 'builtin',
  machineType: 'mill',
  dialect: {
    nativeUnits: 'mm',
    allowUnitSwitch: true,
    workOffsets: ['G54', 'G55', 'G56', 'G57', 'G58', 'G59'],
    toolLengthComp: {
      enabled: false,
      register: 'H',
      requiredWithToolChange: false,
    },
    cutterComp: {
      enabled: false,
      activate: ['G41', 'G42'],
      cancel: 'G40',
      requiresD: false,
    },
    arcCentering: 'both',
    planeSelect: true,
    cannedCycles: [],
    subprograms: {
      enabled: false,
      call: 'M98',
      end: 'M99',
      maxDepth: 1,
    },
    macroSupport: 'none',
    macros: {
      enabled: false,
      ifGoto: false,
      alarmVariable: '#3000',
      maxIterations: 1,
    },
    toolChange: { code: 'M06', requiresT: false },
    spindle: { rpmRange: [0, 30000], cssSupported: false },
    feedMode: 'G94',
    programEnd: 'M30',
    home: { code: 'G28', requiresIntermediate: false },
    codeGroups: grblCodeGroups,
  },
  capabilities: {
    supportsCutterComp: false,
    supportsToolLengthComp: false,
    supportsCannedCycles: false,
    supportsSubprograms: false,
    supportsMacros: false,
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
  systemVariables: {},
  variants: [],
  metadata,
};

export const grblUnspecifiedVariant: MachineVariant = {
  id: 'grbl-unspecified',
  flavorId: grblFlavor.id,
  name: 'Unspecified',
  isUnspecified: true,
  geometry: { travels: null },
  orientation: 'vertical',
  units: 'mm',
  metadata,
};

export const grbl3018Variant: MachineVariant = {
  id: 'grbl-3018',
  flavorId: grblFlavor.id,
  name: '3018 router',
  geometry: {
    travels: {
      x: { min: 0, max: 300 },
      y: { min: 0, max: 180 },
      z: { min: -45, max: 0 },
    },
    maxFeedRate: 1000,
  },
  orientation: 'vertical',
  units: 'mm',
  metadata,
};

grblFlavor.variants = [grblUnspecifiedVariant, grbl3018Variant];

export function grblProfile(
  variantId: string = grblUnspecifiedVariant.id,
  preferences: UserPreferences = {
    defaultUnits: 'mm',
    defaultVariantByFlavor: { [grblFlavor.id]: grblUnspecifiedVariant.id },
  },
): ResolvedMachineProfile {
  const variant =
    grblFlavor.variants.find((candidate) => candidate.id === variantId) ??
    grblUnspecifiedVariant;
  return resolveProfile(grblFlavor, variant, preferences);
}
