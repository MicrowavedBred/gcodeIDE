import { describe, expect, it } from 'vitest';
import {
  builtinFlavors,
  builtinFlavorsById,
  builtinUserPreferences,
  haasMillFlavor,
} from '../../src/core/profiles/builtin';
import {
  cloneFlavor,
  normalizeCustomFlavors,
} from '../../src/core/profiles/custom-flavors';
import { catalogFromFlavors } from '../../src/core/profiles/preferences';
import { findProfile } from '../../src/core/profiles/registry';
import { normalizeUserPreferences } from '../../src/core/profiles/preferences';

const cloneId = 'user-haas-test';

function makeClone() {
  const clone = cloneFlavor(
    haasMillFlavor,
    'haas-vf2',
    cloneId,
    'My Haas',
  );
  if (!clone) throw new Error('expected a clone');
  return clone;
}

describe('custom flavor clones', () => {
  it('copies the chosen variant without mutating the built-in flavor', () => {
    const clone = makeClone();
    clone.rules['travel-limit-exceeded'] = 'off';
    clone.variants[0].geometry.rapidRate = 1;

    expect(clone.source).toBe('user');
    expect(clone.baseFlavorId).toBe('haas-mill');
    expect(clone.variants).toHaveLength(1);
    expect(clone.variants[0]).toMatchObject({
      id: `${cloneId}-variant`,
      flavorId: cloneId,
      name: 'VF-2',
      units: 'inch',
      isUnspecified: false,
      geometry: { rapidRate: 1, tableSize: [914, 356] },
    });
    expect(haasMillFlavor.variants[1].geometry.rapidRate).toBe(34000);
    expect(haasMillFlavor.rules['travel-limit-exceeded']).not.toBe('off');
  });

  it('rejects clones without a known base, a name or variants', () => {
    const clone = makeClone();
    const invalid = [
      { ...clone, id: 'no-base', baseFlavorId: 'unknown-flavor' },
      { ...clone, id: '', name: '' },
      { ...clone, id: 'no-variants', variants: [] },
    ];

    expect(normalizeCustomFlavors(JSON.parse(JSON.stringify([clone, ...invalid])), builtinFlavorsById)).toEqual([
      JSON.parse(JSON.stringify(clone)),
    ]);
  });

  it('preserves edited fields and structured rule overrides across a save/load round trip', () => {
    const clone = makeClone();
    clone.name = 'Shop Haas';
    clone.rules['travel-limit-exceeded'] = {
      severity: 'warning',
      message: 'Check fixture clearance',
      threshold: 12,
    };
    clone.rules['unsafe-cutter-comp-rapid'] = 'off';
    const variant = clone.variants[0];
    variant.name = 'VF-2 low feed';
    variant.units = 'mm';
    variant.orientation = 'horizontal';
    variant.geometry.travels = {
      x: { min: -100, max: 100 },
      y: null,
      z: { min: -50, max: 0 },
    };
    variant.geometry.maxFeedRate = 4000;
    variant.ruleOverrides = { 'missing-tool-length-comp': 'info' };

    const stored = JSON.parse(JSON.stringify([clone]));
    const [loaded] = normalizeCustomFlavors(stored, builtinFlavorsById);

    expect(loaded).toEqual(clone);
  });

  it('round-trips user-defined M-code descriptions', () => {
    const clone = makeClone();
    clone.customMCodes = {
      M400: {
        code: 'M400',
        description: 'Clamp release',
        category: 'clamp',
        affectsSimulation: false,
      },
      M777: { code: 'M777', description: 'Door interlock bypass' },
    };

    const [loaded] = normalizeCustomFlavors(
      JSON.parse(JSON.stringify([clone])),
      builtinFlavorsById,
    );

    expect(loaded.customMCodes).toEqual(clone.customMCodes);
  });

  it('drops malformed M-code entries and falls back to the base registry', () => {
    const clone = makeClone();
    const stored = JSON.parse(JSON.stringify([clone]));
    stored[0].customMCodes = {
      M400: { code: 'M400', description: 'Valid', category: 'probe', affectsSimulation: true },
      m401: { code: 'm401', description: 'Lowercase key' },
      M402: { code: 'M999', description: 'Code mismatch' },
      M403: { code: 'M403', description: '' },
      M404: { code: 'M404', description: 42 },
      M405: { code: 'M405', description: 'Bad category', category: 'turbo' },
      notAnMCode: { code: 'notAnMCode', description: 'Bad key' },
    };

    const [loaded] = normalizeCustomFlavors(stored, builtinFlavorsById);

    expect(loaded.customMCodes).toEqual({
      M400: { code: 'M400', description: 'Valid', category: 'probe', affectsSimulation: true },
      M403: { code: 'M403', description: '' },
      M405: { code: 'M405', description: 'Bad category' },
    });

    const broken = JSON.parse(JSON.stringify([clone]));
    broken[0].customMCodes = 'not-a-record';
    const [fallback] = normalizeCustomFlavors(broken, builtinFlavorsById);
    expect(fallback.customMCodes).toEqual(haasMillFlavor.customMCodes);
  });

  it('drops duplicate clone ids', () => {
    const clone = makeClone();
    const loaded = normalizeCustomFlavors(
      JSON.parse(JSON.stringify([clone, { ...clone, name: 'Duplicate' }])),
      builtinFlavorsById,
    );

    expect(loaded).toHaveLength(1);
    expect(loaded[0].name).toBe('My Haas');
  });

  it('drops invalid values and fills malformed variant fields from the base', () => {
    const clone = makeClone();
    clone.variants[0].geometry.travels = { x: { min: 0, max: 10 }, y: null, z: null };
    const stored = JSON.parse(JSON.stringify([clone]));
    stored[0].variants[0].units = 'furlongs';
    stored[0].variants[0].geometry.travels.x.min = 'left';
    stored[0].rules = { 'travel-limit-exceeded': 'furlongs' };

    const [loaded] = normalizeCustomFlavors(stored, builtinFlavorsById);

    expect(loaded.rules).toEqual({});
    expect(loaded.variants[0].units).toBe('inch');
    expect(loaded.variants[0].geometry.travels?.x).toEqual(haasMillFlavor.variants[1].geometry.travels?.x);
  });
});

describe('combined profile catalog', () => {
  it('resolves a custom profile with its own geometry', () => {
    const clone = makeClone();
    clone.variants[0].geometry.rapidRate = 10000;
    const flavors = [...builtinFlavors, clone];
    const preferenceCatalog = catalogFromFlavors(flavors, builtinUserPreferences);
    const preferences = normalizeUserPreferences(null, preferenceCatalog);

    const profile = findProfile(
      flavors,
      clone.id,
      `${clone.id}-variant`,
      preferences,
    );

    expect(profile?.flavor.id).toBe(clone.id);
    expect(profile?.variant.geometry.rapidRate).toBe(10000);
    expect(findProfile(flavors, 'missing', undefined, preferences)).toBeUndefined();
  });

  it('falls back to the first variant when a saved variant id is stale', () => {
    const clone = makeClone();
    const profile = findProfile(
      [...builtinFlavors, clone],
      clone.id,
      'haas-vf2',
      builtinUserPreferences,
    );

    expect(profile?.variant.id).toBe(`${clone.id}-variant`);
  });

  it('includes custom flavors in the preference catalog with their own default variant', () => {
    const clone = makeClone();
    const catalog = catalogFromFlavors(
      [...builtinFlavors, clone],
      builtinUserPreferences,
    );
    const entry = catalog.flavors.find((flavor) => flavor.id === clone.id);

    expect(entry).toEqual({
      id: clone.id,
      defaultVariantId: `${clone.id}-variant`,
      variantIds: [`${clone.id}-variant`],
    });
  });
});
