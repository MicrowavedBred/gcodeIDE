import type { Units, UserPreferences } from './types';

/** The flavor/variant choices that count as valid when loading saved preferences. */
export interface PreferencesFlavorCatalog {
  id: string;
  defaultVariantId: string;
  variantIds: string[];
}

export interface PreferencesCatalog {
  defaultUnits: Units;
  flavors: PreferencesFlavorCatalog[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validates persisted preferences against the available flavors and variants.
 * Unknown flavors, unknown variants and extra fields are discarded rather than
 * carried forward, so stale settings cannot resolve to a missing profile.
 */
export function normalizeUserPreferences(
  value: unknown,
  catalog: PreferencesCatalog,
): UserPreferences {
  const source = isRecord(value) ? value : {};
  const defaultUnits: Units =
    source.defaultUnits === 'mm' || source.defaultUnits === 'inch'
      ? source.defaultUnits
      : catalog.defaultUnits;
  const savedVariants = isRecord(source.defaultVariantByFlavor)
    ? source.defaultVariantByFlavor
    : {};
  const defaultVariantByFlavor: Record<string, string> = {};

  for (const flavor of catalog.flavors) {
    const candidate = savedVariants[flavor.id];
    defaultVariantByFlavor[flavor.id] =
      typeof candidate === 'string' && flavor.variantIds.includes(candidate)
        ? candidate
        : flavor.defaultVariantId;
  }

  return { defaultUnits, defaultVariantByFlavor };
}
