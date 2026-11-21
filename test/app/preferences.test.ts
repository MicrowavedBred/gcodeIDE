import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  builtinFlavorsById,
  builtinProfile,
} from '../../src/core/profiles/builtin';
import {
  loadPreferences,
  savePreferences,
  variantForFlavor,
} from '../../src/app/preferences';
import { APP_SETTINGS_KEY } from '../../src/app/platform';
import type { UserPreferences } from '../../src/core/profiles/types';

function mockStorage(values: Map<string, string> = new Map()) {
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  });
  return values;
}

describe('app preferences', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('round-trips saved units and default variants', async () => {
    mockStorage();
    await savePreferences({
      defaultUnits: 'inch',
      defaultVariantByFlavor: { 'haas-mill': 'haas-vf2' },
    });

    const loaded = await loadPreferences();

    expect(loaded.defaultUnits).toBe('inch');
    expect(loaded.defaultVariantByFlavor['haas-mill']).toBe('haas-vf2');
    expect(loaded.defaultVariantByFlavor['brother-speedio']).toBe(
      'brother-unspecified',
    );
  });

  it('falls back to shipped defaults for malformed or stale documents', async () => {
    const values = mockStorage();

    values.set(APP_SETTINGS_KEY, '{not json');
    expect((await loadPreferences()).defaultUnits).toBe('mm');

    values.set(
      APP_SETTINGS_KEY,
      JSON.stringify({ version: 99, preferences: { defaultUnits: 'inch' } }),
    );
    const loaded = await loadPreferences();
    expect(loaded.defaultUnits).toBe('mm');
    expect(loaded.defaultVariantByFlavor['haas-mill']).toBe('haas-unspecified');
  });

  it('applies remembered units to variants that inherit them', async () => {
    mockStorage();
    const preferences: UserPreferences = {
      defaultUnits: 'inch',
      defaultVariantByFlavor: {},
    };
    await savePreferences(preferences);

    const loaded = await loadPreferences();
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
});
