import {
  builtinFlavors,
  builtinFlavorsById,
  builtinPreferencesCatalog,
  builtinUserPreferences,
} from '../core/profiles/builtin';
import { normalizeCustomFlavors } from '../core/profiles/custom-flavors';
import {
  catalogFromFlavors,
  normalizeUserPreferences,
} from '../core/profiles/preferences';
import type { Flavor, UserFlavor, UserPreferences } from '../core/profiles/types';
import { platformSettings } from './platform';

export const SETTINGS_VERSION = 2;

export interface AppSettings {
  version: number;
  preferences: UserPreferences;
  customFlavors: UserFlavor[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function defaultSettings(): AppSettings {
  return {
    version: SETTINGS_VERSION,
    preferences: normalizeUserPreferences(null, builtinPreferencesCatalog),
    customFlavors: [],
  };
}

/** Reads v1 or v2 settings and validates them against the current catalog. */
export async function loadSettings(): Promise<AppSettings> {
  const text = await platformSettings.load();
  if (text) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (isRecord(parsed) && (parsed.version === 1 || parsed.version === 2)) {
        const customFlavors = normalizeCustomFlavors(
          parsed.customFlavors,
          builtinFlavorsById,
        );
        const catalog = catalogFromFlavors(
          [...builtinFlavors, ...customFlavors],
          builtinUserPreferences,
        );
        return {
          version: SETTINGS_VERSION,
          preferences: normalizeUserPreferences(parsed.preferences, catalog),
          customFlavors,
        };
      }
    } catch {
      // Malformed settings are discarded rather than trusted.
    }
  }
  return defaultSettings();
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await platformSettings.save(JSON.stringify(settings));
}

/** Picks a flavor's remembered variant, then its unspecified/first variant. */
export function variantForFlavor(
  flavorId: string,
  flavor: Flavor | undefined,
  preferences: UserPreferences,
): string {
  return (
    preferences.defaultVariantByFlavor[flavorId] ??
    flavor?.variants.find((variant) => variant.isUnspecified)?.id ??
    flavor?.variants[0]?.id ??
    ''
  );
}
