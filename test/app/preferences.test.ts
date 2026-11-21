import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  loadSettings,
  saveSettings,
  variantForFlavor,
} from '../../src/app/preferences';
import { APP_SETTINGS_KEY } from '../../src/app/platform';
import {
  builtinFlavors,
  builtinFlavorsById,
  builtinProfile,
  haasMillFlavor,
} from '../../src/core/profiles/builtin';
import { cloneFlavor } from '../../src/core/profiles/custom-flavors';
import {
  catalogFromFlavors,
  normalizeUserPreferences,
} from '../../src/core/profiles/preferences';
import { findProfile } from '../../src/core/profiles/registry';
import type { UserPreferences } from '../../src/core/profiles/types';

function mockStorage(values: Map<string, string> = new Map()) {
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  });
  return values;
}

async function savePrefs(preferences: UserPreferences) {
  await saveSettings({ version: 2, preferences, customFlavors: [] });
}

describe('app preferences', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('round-trips saved units and default variants', async () => {
    mockStorage();
    await savePrefs({
      defaultUnits: 'inch',
      defaultVariantByFlavor: { 'haas-mill': 'haas-vf2' },
    });

    const loaded = (await loadSettings()).preferences;

    expect(loaded.defaultUnits).toBe('inch');
    expect(loaded.defaultVariantByFlavor['haas-mill']).toBe('haas-vf2');
    expect(loaded.defaultVariantByFlavor['brother-speedio']).toBe(
      'brother-unspecified',
    );
  });

  it('falls back to shipped defaults for malformed or stale documents', async () => {
    const values = mockStorage();

    values.set(APP_SETTINGS_KEY, '{not json');
    expect((await loadSettings()).preferences.defaultUnits).toBe('mm');

    values.set(
      APP_SETTINGS_KEY,
      JSON.stringify({ version: 99, preferences: { defaultUnits: 'inch' } }),
    );
    const loaded = (await loadSettings()).preferences;
    expect(loaded.defaultUnits).toBe('mm');
    expect(loaded.defaultVariantByFlavor['haas-mill']).toBe('haas-unspecified');
  });

  it('applies remembered units to variants that inherit them', async () => {
    mockStorage();
    const preferences: UserPreferences = {
      defaultUnits: 'inch',
      defaultVariantByFlavor: {},
    };
    await savePrefs(preferences);

    const loaded = (await loadSettings()).preferences;
    const profile = builtinProfile('brother-speedio', undefined, loaded);

    expect(profile?.units).toBe('inch');
  });

  it('selects remembered, then unspecified, then first variant', () => {
    const haas = builtinFlavorsById.get('haas-mill');
    const withDefault: UserPreferences = {
      defaultUnits: 'mm',
      defaultVariantByFlavor: { 'haas-mill': 'haas-vf2' },
    };
    const withoutDefault: UserPreferences = {
      defaultUnits: 'mm',
      defaultVariantByFlavor: {},
    };

    expect(variantForFlavor('haas-mill', haas, withDefault)).toBe('haas-vf2');
    expect(variantForFlavor('haas-mill', haas, withoutDefault)).toBe(
      'haas-unspecified',
    );
    expect(variantForFlavor('missing', undefined, withoutDefault)).toBe('');
  });

  it('writes version 2 documents with an empty custom flavor list', async () => {
    const values = mockStorage();
    await savePrefs({
      defaultUnits: 'mm',
      defaultVariantByFlavor: {},
    });

    expect(JSON.parse(values.get(APP_SETTINGS_KEY)!)).toEqual({
      version: 2,
      preferences: expect.any(Object),
      customFlavors: [],
    });
  });

  it('migrates version 1 documents without custom flavors', async () => {
    const values = mockStorage();
    values.set(
      APP_SETTINGS_KEY,
      JSON.stringify({
        version: 1,
        preferences: {
          defaultUnits: 'inch',
          defaultVariantByFlavor: { 'haas-mill': 'haas-vf2' },
        },
      }),
    );

    const settings = await loadSettings();

    expect(settings.version).toBe(2);
    expect(settings.preferences.defaultUnits).toBe('inch');
    expect(settings.preferences.defaultVariantByFlavor['haas-mill']).toBe('haas-vf2');
    expect(settings.customFlavors).toEqual([]);
  });

  it('persists custom clones and resolves them with the combined catalog', async () => {
    mockStorage();
    const clone = cloneFlavor(
      haasMillFlavor,
      'haas-vf2',
      'user-haas-persist',
      'Persisted Haas',
    );
    if (!clone) throw new Error('expected a clone');
    clone.variants[0].geometry.rapidRate = 9000;

    await saveSettings({
      version: 2,
      preferences: { defaultUnits: 'mm', defaultVariantByFlavor: {} },
      customFlavors: [clone],
    });
    const settings = await loadSettings();
    const flavors = [...builtinFlavors, ...settings.customFlavors];
    const preferences = normalizeUserPreferences(
      settings.preferences,
      catalogFromFlavors(flavors, {
        defaultUnits: 'mm',
        defaultVariantByFlavor: {},
      }),
    );
    const profile = findProfile(
      flavors,
      clone.id,
      `${clone.id}-variant`,
      preferences,
    );

    expect(settings.customFlavors).toHaveLength(1);
    expect(profile?.flavor.name).toBe('Persisted Haas');
    expect(profile?.variant.geometry.rapidRate).toBe(9000);
  });

  it('discards malformed clones without losing preferences', async () => {
    const values = mockStorage();
    values.set(
      APP_SETTINGS_KEY,
      JSON.stringify({
        version: 2,
        preferences: { defaultUnits: 'inch', defaultVariantByFlavor: {} },
        customFlavors: [{ id: 'broken', name: 'Broken', baseFlavorId: 'missing' }],
      }),
    );

    const settings = await loadSettings();

    expect(settings.customFlavors).toEqual([]);
    expect(settings.preferences.defaultUnits).toBe('inch');
  });
});
