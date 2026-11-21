import { builtinPreferencesCatalog } from '../core/profiles/builtin';
import { normalizeUserPreferences } from '../core/profiles/preferences';
import type { Flavor, UserPreferences } from '../core/profiles/types';
import { platformSettings } from './platform';

const SETTINGS_VERSION = 1;

interface AppSettings {
  version: number;
  preferences: UserPreferences;
}

function defaultPreferences(): UserPreferences {
  return normalizeUserPreferences(null, builtinPreferencesCatalog);
}

/** Loads the versioned settings document, falling back to shipped defaults. */
export async function loadPreferences(): Promise<UserPreferences> {
  const text = await platformSettings.load();
  if (text) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        (parsed as AppSettings).version === SETTINGS_VERSION
      ) {
        return normalizeUserPreferences(
          (parsed as AppSettings).preferences,
          builtinPreferencesCatalog,
        );
      }
    } catch {
      // Malformed settings are discarded rather than trusted.
    }
  }
  return defaultPreferences();
}

export async function savePreferences(
  preferences: UserPreferences,
): Promise<void> {
  const settings: AppSettings = {
    version: SETTINGS_VERSION,
    preferences,
  };
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
