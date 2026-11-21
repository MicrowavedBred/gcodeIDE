import type { Flavor, ResolvedMachineProfile, UserPreferences } from './types';
import { resolveProfile as resolveMachineProfile } from './types';

/** Resolves a flavor/variant pair from the combined built-in + user catalog. */
export function findProfile(
  flavors: readonly Flavor[],
  flavorId: string,
  variantId: string | undefined,
  preferences: UserPreferences,
): ResolvedMachineProfile | undefined {
  const flavor = flavors.find((candidate) => candidate.id === flavorId);
  if (!flavor) return undefined;
  const variant =
    flavor.variants.find((candidate) => candidate.id === variantId) ??
    flavor.variants[0];
  if (!variant) return undefined;
  return resolveMachineProfile(flavor, variant, preferences);
}
