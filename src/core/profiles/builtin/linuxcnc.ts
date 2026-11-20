import {
  resolveProfile,
  type Flavor,
  type MachineVariant,
  type ResolvedMachineProfile,
  type UserPreferences,
} from '../types';
import { millCodeGroups, PROFILE_METADATA as metadata, removeCodes } from './common';

// LinuxCNC supports G59.1-G59.3 rather than Fanuc's G54.1 extended offsets.
const linuxcncCodeGroups = removeCodes(millCodeGroups(), ['G54.1']);
for (const offset of ['G59.1', 'G59.2', 'G59.3']) {
  linuxcncCodeGroups[offset] = 'workOffset';
}

export const linuxcncMillFlavor: Flavor = {
  id: 'linuxcnc-mill',
  name: 'LinuxCNC Mill',
  vendor: 'LinuxCNC',
  source: 'builtin',
  machineType: 'mill',
  dialect: {
    nativeUnits: 'mm',
    allowUnitSwitch: true,
    workOffsets: [
      'G54',
      'G55',
      'G56',
      'G57',
      'G58',
      'G59',
      'G59.1',
      'G59.2',
      'G59.3',
    ],
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
    macroSupport: 'none',
    macros: {
      enabled: false,
      ifGoto: false,
      alarmVariable: '#3000',
      maxIterations: 1,
    },
    toolChange: { code: 'M06', requiresT: true },
    spindle: { rpmRange: [0, 20000], cssSupported: false },
    feedMode: 'G94',
    programEnd: 'M30',
    home: { code: 'G28', requiresIntermediate: false },
    codeGroups: linuxcncCodeGroups,
  },
  capabilities: {
    supportsCutterComp: true,
    supportsToolLengthComp: true,
    supportsCannedCycles: true,
    supportsSubprograms: true,
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

export const linuxcncUnspecifiedVariant: MachineVariant = {
  id: 'linuxcnc-unspecified',
  flavorId: linuxcncMillFlavor.id,
  name: 'Unspecified',
  isUnspecified: true,
  geometry: { travels: null },
  orientation: 'vertical',
  units: 'inherit',
  metadata,
};

export const linuxcncGenericVariant: MachineVariant = {
  id: 'linuxcnc-generic',
  flavorId: linuxcncMillFlavor.id,
  name: 'Generic mill',
  geometry: {
    travels: null,
    maxFeedRate: 8000,
  },
  orientation: 'vertical',
  units: 'mm',
  metadata,
};

linuxcncMillFlavor.variants = [
  linuxcncUnspecifiedVariant,
  linuxcncGenericVariant,
];

export function linuxcncProfile(
  variantId: string = linuxcncUnspecifiedVariant.id,
  preferences: UserPreferences = {
    defaultUnits: 'mm',
    defaultVariantByFlavor: {
      [linuxcncMillFlavor.id]: linuxcncUnspecifiedVariant.id,
    },
  },
): ResolvedMachineProfile {
  const variant =
    linuxcncMillFlavor.variants.find(
      (candidate) => candidate.id === variantId,
    ) ?? linuxcncUnspecifiedVariant;
  return resolveProfile(linuxcncMillFlavor, variant, preferences);
}
