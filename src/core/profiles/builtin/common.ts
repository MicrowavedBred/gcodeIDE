import type { ModalGroup } from '../types';

export const PROFILE_METADATA = {
  createdAt: '2026-11-19T00:00:00.000Z',
  updatedAt: '2026-11-19T00:00:00.000Z',
};

/**
 * Groups shared by the Fanuc-derived mill dialects. Flavors start from this
 * table and delete what they do not support; the modal engine reports any
 * remaining unknown G-code as `unsupported-code`.
 */
export function millCodeGroups(): Record<string, ModalGroup> {
  return {
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
  };
}

export function removeCodes(
  groups: Record<string, ModalGroup>,
  codes: string[],
): Record<string, ModalGroup> {
  for (const code of codes) delete groups[code];
  return groups;
}
