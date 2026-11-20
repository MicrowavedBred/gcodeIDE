import {
  resolveProfile,
  type Flavor,
  type MachineVariant,
  type ResolvedMachineProfile,
  type UserPreferences,
} from '../types';

const metadata = {
  createdAt: '2026-11-19T00:00:00.000Z',
  updatedAt: '2026-11-19T00:00:00.000Z',
};

const customMCode = (code: string, description: string) => ({
  code,
  description,
  category: 'other' as const,
  affectsSimulation: false,
});

export const brotherSpeedioFlavor: Flavor = {
  id: 'brother-speedio',
  name: 'Brother Speedio',
  vendor: 'Brother',
  source: 'builtin',
  machineType: 'mill',
  dialect: {
    nativeUnits: 'mm',
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
    cannedCycles: ['G73', 'G77', 'G81', 'G83'],
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
    spindle: { rpmRange: [0, 16000], cssSupported: false },
    feedMode: 'G94',
    programEnd: 'M30',
    home: { code: 'G28', requiresIntermediate: false },
    codeGroups: {
      G0: 'motion',
      G1: 'motion',
      G2: 'motion',
      G3: 'motion',
      G73: 'motion',
      G77: 'motion',
      G80: 'motion',
      G81: 'motion',
      G83: 'motion',
      G17: 'plane',
      G18: 'plane',
      G19: 'plane',
      G90: 'distance',
      G91: 'distance',
      'G90.1': 'arcCenter',
      'G91.1': 'arcCenter',
      G93: 'feedMode',
      G94: 'feedMode',
      G95: 'feedMode',
      G20: 'units',
      G21: 'units',
      G40: 'cutterComp',
      G41: 'cutterComp',
      G42: 'cutterComp',
      G43: 'toolLength',
      G44: 'toolLength',
      G49: 'toolLength',
      G54: 'workOffset',
      G55: 'workOffset',
      G56: 'workOffset',
      G57: 'workOffset',
      G58: 'workOffset',
      G59: 'workOffset',
      'G54.1': 'workOffset',
      G98: 'cycleReturn',
      G99: 'cycleReturn',
      G68: 'rotation',
      G69: 'rotation',
      G50: 'scaling',
      G51: 'scaling',
      G96: 'spindleMode',
      G97: 'spindleMode',
      G4: 'none',
      G10: 'none',
      G28: 'none',
      G30: 'none',
      G52: 'none',
      G53: 'none',
    },
  },
  capabilities: {
    supportsCutterComp: true,
    supportsToolLengthComp: true,
    supportsCannedCycles: true,
    supportsSubprograms: true,
    supportsMacros: true,
    supportsRigidTapping: false,
    maxAxes: 4,
  },
  rules: {},
  display: {
    machineView: 'mill3axis',
    stockShape: 'rectangular',
    defaultStock: null,
  },
  customMCodes: {
    M400: customMCode('M400', 'Brother vendor M-code (describe in profile)'),
    M401: customMCode('M401', 'Brother vendor M-code (describe in profile)'),
    M494: customMCode('M494', 'Brother vendor M-code (describe in profile)'),
    M495: customMCode('M495', 'Brother vendor M-code (describe in profile)'),
    M496: customMCode('M496', 'Brother vendor M-code (describe in profile)'),
    M497: customMCode('M497', 'Brother vendor M-code (describe in profile)'),
    M501: customMCode('M501', 'Brother vendor M-code (describe in profile)'),
    M800: customMCode('M800', 'Brother vendor M-code (describe in profile)'),
    M801: customMCode('M801', 'Brother vendor M-code (describe in profile)'),
  },
  systemVariables: {
    '#3700': {
      number: '#3700',
      description: 'Current tool number (simulation assumption)',
      value: 28,
      configurable: true,
    },
    '#11003': {
      number: '#11003',
      description: 'Tool length measurement input (unknown in simulation)',
      value: 'unknown',
      configurable: true,
    },
    '#11006': {
      number: '#11006',
      description: 'Tool length measurement input (unknown in simulation)',
      value: 'unknown',
      configurable: true,
    },
    '#11032': {
      number: '#11032',
      description: 'Tool length measurement input (unknown in simulation)',
      value: 'unknown',
      configurable: true,
    },
  },
  variants: [],
  metadata,
};

export const brotherUnspecifiedVariant: MachineVariant = {
  id: 'brother-unspecified',
  flavorId: brotherSpeedioFlavor.id,
  name: 'Unspecified',
  isUnspecified: true,
  geometry: {
    travels: null,
  },
  orientation: 'vertical',
  units: 'inherit',
  metadata,
};

export const brotherS700XD2Variant: MachineVariant = {
  id: 'brother-s700xd2',
  flavorId: brotherSpeedioFlavor.id,
  name: 'Speedio S700XD2',
  geometry: {
    travels: {
      x: { min: -700, max: 0 },
      y: { min: -400, max: 150 },
      z: { min: 0, max: 400 },
    },
    rotaryAxes: {
      a: {
        center: [0, 0, 0],
        axis: 'x',
        range: [-360, 360],
      },
    },
    maxFeedRate: 10000,
    rapidRate: 50000,
  },
  orientation: 'vertical',
  units: 'mm',
  metadata,
};

brotherSpeedioFlavor.variants = [
  brotherUnspecifiedVariant,
  brotherS700XD2Variant,
];

export const defaultUserPreferences: UserPreferences = {
  defaultUnits: 'mm',
  defaultVariantByFlavor: {
    [brotherSpeedioFlavor.id]: brotherUnspecifiedVariant.id,
  },
};

export function brotherProfile(
  variantId: string = brotherUnspecifiedVariant.id,
  preferences: UserPreferences = defaultUserPreferences,
): ResolvedMachineProfile {
  const variant =
    brotherSpeedioFlavor.variants.find((candidate) => candidate.id === variantId) ??
    brotherUnspecifiedVariant;
  return resolveProfile(brotherSpeedioFlavor, variant, preferences);
}
