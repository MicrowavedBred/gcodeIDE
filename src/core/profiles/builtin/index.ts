import { catalogFromFlavors, type PreferencesCatalog } from '../preferences';
import type { Flavor, ResolvedMachineProfile, UserPreferences } from '../types';
import { brotherProfile, brotherSpeedioFlavor, defaultUserPreferences as brotherDefaults } from './brother';
import { fanucLatheFlavor, fanucLatheProfile } from './fanuc-lathe';
import { fanucMillFlavor, fanucProfile } from './fanuc';
import { grblFlavor, grblProfile } from './grbl';
import { haasMillFlavor, haasProfile } from './haas';
import { linuxcncMillFlavor, linuxcncProfile } from './linuxcnc';

export * from './brother';
export * from './fanuc';
export * from './fanuc-lathe';
export * from './grbl';
export * from './haas';
export * from './linuxcnc';

/** Built-in flavors in user-facing order. */
export const builtinFlavors: Flavor[] = [
  brotherSpeedioFlavor,
  haasMillFlavor,
  fanucMillFlavor,
  grblFlavor,
  linuxcncMillFlavor,
  fanucLatheFlavor,
];

export const builtinFlavorsById = new Map(
  builtinFlavors.map((flavor) => [flavor.id, flavor]),
);

/** Default unit and per-flavor variant selection shipped with the app. */
export const builtinUserPreferences: UserPreferences = {
  defaultUnits: brotherDefaults.defaultUnits,
  defaultVariantByFlavor: Object.fromEntries(
    builtinFlavors.map((flavor) => [
      flavor.id,
      flavor.variants.find((variant) => variant.isUnspecified)?.id ??
        flavor.variants[0].id,
    ]),
  ),
};

/** Valid choices for persisted preferences, derived from the shipped flavors. */
export const builtinPreferencesCatalog: PreferencesCatalog = catalogFromFlavors(
  builtinFlavors,
  builtinUserPreferences,
);

export function builtinProfile(
  flavorId: string,
  variantId?: string,
  preferences: UserPreferences = builtinUserPreferences,
): ResolvedMachineProfile | undefined {
  switch (flavorId) {
    case brotherSpeedioFlavor.id:
      return brotherProfile(variantId, preferences);
    case haasMillFlavor.id:
      return haasProfile(variantId, preferences);
    case fanucMillFlavor.id:
      return fanucProfile(variantId, preferences);
    case fanucLatheFlavor.id:
      return fanucLatheProfile(variantId, preferences);
    case grblFlavor.id:
      return grblProfile(variantId, preferences);
    case linuxcncMillFlavor.id:
      return linuxcncProfile(variantId, preferences);
    default:
      return undefined;
  }
}
