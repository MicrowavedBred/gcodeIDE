import {
  resolveProfile,
  type Flavor,
  type MachineVariant,
  type ModalGroup,
  type ResolvedMachineProfile,
  type UserPreferences,
} from '../types';
import { PROFILE_METADATA as metadata } from './common';

/**
 * Lathe code groups for this slice. Lathe canned cycles are deferred, so only
 * the motion, positioning and spindle-mode codes needed for X/Z diameter
 * programming and G96/G97 are recognised.
 */
function latheCodeGroups(): Record<string, ModalGroup> {
  return {
    G0: 'motion',
    G1: 'motion',
    G2: 'motion',
    G3: 'motion',
    G80: 'motion',
    G18: 'plane',
    G90: 'distance',
    G91: 'distance',
    G94: 'feedMode',
    G95: 'feedMode',
    G20: 'units',
    G21: 'units',
    G40: 'cutterComp',
    G41: 'cutterComp',
    G42: 'cutterComp',
    G54: 'workOffset',
    G55: 'workOffset',
    G56: 'workOffset',
    G57: 'workOffset',
    G58: 'workOffset',
    G59: 'workOffset',
    G96: 'spindleMode',
    G97: 'spindleMode',
    G4: 'none',
    G28: 'none',
    G30: 'none',
    G50: 'none',
  };
}

export const fanucLatheFlavor: Flavor = {
  id: 'fanuc-lathe',
  name: 'Fanuc Lathe',
  vendor: 'Fanuc',
  source: 'builtin',
  machineType: 'lathe',
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
      enabled: true,
      activate: ['G41', 'G42'],
      cancel: 'G40',
      requiresD: false,
    },
    arcCentering: 'IJ',
    planeSelect: false,
    cannedCycles: [],
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
    toolChange: { code: 'M06', requiresT: false },
    spindle: { rpmRange: [0, 4000], cssSupported: true },
    feedMode: 'G94',
    programEnd: 'M30',
    home: { code: 'G28', requiresIntermediate: false },
    codeGroups: latheCodeGroups(),
  },
  capabilities: {
    supportsCutterComp: true,
    supportsToolLengthComp: false,
    supportsCannedCycles: false,
    supportsSubprograms: true,
    supportsMacros: true,
    supportsRigidTapping: false,
    maxAxes: 2,
  },
  rules: {},
  display: {
    machineView: 'lathe2d',
    stockShape: 'cylindrical',
    defaultStock: null,
  },
  customMCodes: {},
  systemVariables: {},
  variants: [],
  metadata,
};

export const fanucLatheUnspecifiedVariant: MachineVariant = {
  id: 'fanuc-lathe-unspecified',
  flavorId: fanucLatheFlavor.id,
  name: 'Unspecified',
  isUnspecified: true,
  geometry: { travels: null },
  orientation: 'horizontal',
  units: 'inherit',
  metadata,
};

fanucLatheFlavor.variants = [fanucLatheUnspecifiedVariant];

export function fanucLatheProfile(
  variantId: string = fanucLatheUnspecifiedVariant.id,
  preferences: UserPreferences = {
    defaultUnits: 'mm',
    defaultVariantByFlavor: {
      [fanucLatheFlavor.id]: fanucLatheUnspecifiedVariant.id,
    },
  },
): ResolvedMachineProfile {
  const variant =
    fanucLatheFlavor.variants.find((candidate) => candidate.id === variantId) ??
    fanucLatheUnspecifiedVariant;
  return resolveProfile(fanucLatheFlavor, variant, preferences);
}
