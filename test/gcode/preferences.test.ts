import { describe, expect, it } from 'vitest';
import {
  normalizeUserPreferences,
  type PreferencesCatalog,
} from '../../src/core/profiles/preferences';

const catalog: PreferencesCatalog = {
  defaultUnits: 'mm',
  flavors: [
    {
      id: 'haas-mill',
      defaultVariantId: 'haas-unspecified',
      variantIds: ['haas-unspecified', 'haas-vf2'],
    },
    {
      id: 'grbl',
      defaultVariantId: 'grbl-unspecified',
      variantIds: ['grbl-unspecified', 'grbl-3018'],
    },
  ],
};

describe('normalizeUserPreferences', () => {
  it('uses catalog defaults for missing or malformed data', () => {
    expect(normalizeUserPreferences(null, catalog)).toEqual({
      defaultUnits: 'mm',
      defaultVariantByFlavor: {
        'haas-mill': 'haas-unspecified',
        grbl: 'grbl-unspecified',
      },
    });
    expect(normalizeUserPreferences({ defaultUnits: 'furlongs' }, catalog).defaultUnits).toBe('mm');
  });

  it('accepts valid units and known flavor variants', () => {
    const preferences = normalizeUserPreferences(
      {
        defaultUnits: 'inch',
        defaultVariantByFlavor: {
          'haas-mill': 'haas-vf2',
          grbl: 'grbl-3018',
        },
      },
      catalog,
    );

    expect(preferences.defaultUnits).toBe('inch');
    expect(preferences.defaultVariantByFlavor['haas-mill']).toBe('haas-vf2');
    expect(preferences.defaultVariantByFlavor.grbl).toBe('grbl-3018');
  });

  it('ignores unknown flavors, unknown variants and extra fields', () => {
    const preferences = normalizeUserPreferences(
      {
        defaultUnits: 'mm',
        surprise: true,
        defaultVariantByFlavor: {
          'haas-mill': 'not-a-variant',
          'made-up-flavor': 'anything',
        },
      },
      catalog,
    );

    expect(preferences).toEqual({
      defaultUnits: 'mm',
      defaultVariantByFlavor: {
        'haas-mill': 'haas-unspecified',
        grbl: 'grbl-unspecified',
      },
    });
  });
});
