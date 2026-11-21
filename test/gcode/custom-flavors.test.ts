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
