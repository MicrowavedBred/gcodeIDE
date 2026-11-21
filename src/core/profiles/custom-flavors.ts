import type {
  CapabilityFlags,
  CustomMCodeDef,
  DisplaySettings,
  Flavor,
  GeometrySettings,
  MachineVariant,
  RuleOverride,
  Travels,
  UserFlavor,
  Units,
  Orientation,
} from './types';
import type { Severity } from '../shared/types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isSeverity(value: unknown): value is Severity {
  return value === 'error' || value === 'warning' || value === 'info' || value === 'off';
}

function numberOr(value: unknown, fallback: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Keeps plain severity strings and structured overrides across save/load. */
function normalizeRuleOverrides(
  value: unknown,
  fallback: Record<string, Severity | RuleOverride>,
): Record<string, Severity | RuleOverride> {
  const source = isRecord(value) ? value : fallback;
  const result: Record<string, Severity | RuleOverride> = {};
  for (const [ruleId, entry] of Object.entries(source)) {
    if (isSeverity(entry)) {
      result[ruleId] = entry;
    } else if (isRecord(entry) && isSeverity(entry.severity)) {
      const override: RuleOverride = { severity: entry.severity };
      if (typeof entry.message === 'string') override.message = entry.message;
      if (typeof entry.threshold === 'number' && Number.isFinite(entry.threshold)) {
        override.threshold = entry.threshold;
      }
      result[ruleId] = override;
    }
  }
  return result;
}

const customMCodeCategories: Array<NonNullable<CustomMCodeDef['category']>> = [
  'clamp',
  'coolant',
  'door',
  'conveyor',
  'probe',
  'other',
];

/** Validates the persisted vendor M-code registry; malformed entries are dropped. */
function normalizeCustomMCodes(
  value: unknown,
  fallback: Record<string, CustomMCodeDef>,
): Record<string, CustomMCodeDef> {
  const source = isRecord(value) ? value : fallback;
  const result: Record<string, CustomMCodeDef> = {};
  for (const [key, entry] of Object.entries(source)) {
    if (!/^M\d+$/.test(key) || !isRecord(entry)) continue;
    const code = typeof entry.code === 'string' ? entry.code : key;
    if (code !== key || typeof entry.description !== 'string') {
      continue;
    }
    const definition: CustomMCodeDef = { code, description: entry.description };
    if (customMCodeCategories.includes(entry.category as NonNullable<CustomMCodeDef['category']>)) {
      definition.category = entry.category as CustomMCodeDef['category'];
    }
    if (typeof entry.affectsSimulation === 'boolean') {
      definition.affectsSimulation = entry.affectsSimulation;
    }
    result[key] = definition;
  }
  return result;
}

function travelOr(value: unknown, fallback: { min: number; max: number } | null) {
  if (value === null) return null;
  if (!isRecord(value)) return fallback;
  const min = numberOr(value.min, undefined);
  const max = numberOr(value.max, undefined);
  return min !== undefined && max !== undefined ? { min, max } : fallback;
}

function normalizeTravels(value: unknown, fallback: Travels | null): Travels | null {
  if (value === null) return null;
  if (!isRecord(value)) return fallback;
  return {
    x: travelOr(value.x, fallback?.x ?? null),
    y: travelOr(value.y, fallback?.y ?? null),
    z: travelOr(value.z, fallback?.z ?? null),
  };
}

function normalizeGeometry(value: unknown, fallback: GeometrySettings): GeometrySettings {
  if (!isRecord(value)) return clone(fallback);
  const table = value.tableSize;
  return {
    ...clone(fallback),
    travels: normalizeTravels(value.travels, fallback.travels),
    rotaryAxes: isRecord(value.rotaryAxes)
      ? (value.rotaryAxes as GeometrySettings['rotaryAxes'])
      : fallback.rotaryAxes,
    maxFeedRate: numberOr(value.maxFeedRate, fallback.maxFeedRate),
    rapidRate: numberOr(value.rapidRate, fallback.rapidRate),
    tableSize:
      Array.isArray(table) &&
      table.length === 2 &&
      table.every((entry) => typeof entry === 'number' && Number.isFinite(entry))
        ? [table[0], table[1]]
        : fallback.tableSize,
  };
}

function normalizeVariant(
  value: unknown,
  fallback: MachineVariant,
  flavorId: string,
): MachineVariant {
  const source = isRecord(value) ? value : {};
  const units: Units | 'inherit' =
    source.units === 'mm' || source.units === 'inch' || source.units === 'inherit'
      ? source.units
      : fallback.units;
  const orientation: Orientation =
    source.orientation === 'vertical' || source.orientation === 'horizontal'
      ? source.orientation
      : fallback.orientation;

  return {
    id: typeof source.id === 'string' && source.id ? source.id : fallback.id,
    flavorId,
    name: typeof source.name === 'string' && source.name ? source.name : fallback.name,
    baseVariantId:
      typeof source.baseVariantId === 'string' && source.baseVariantId
        ? source.baseVariantId
        : fallback.baseVariantId ?? fallback.id,
    isUnspecified:
      typeof source.isUnspecified === 'boolean'
        ? source.isUnspecified
        : fallback.isUnspecified,
    geometry: normalizeGeometry(source.geometry, fallback.geometry),
    orientation,
    units,
    capabilityOverrides: isRecord(source.capabilityOverrides)
      ? (source.capabilityOverrides as Partial<CapabilityFlags>)
      : fallback.capabilityOverrides,
    ruleOverrides: normalizeRuleOverrides(
      source.ruleOverrides,
      fallback.ruleOverrides ?? {},
    ),
    displayOverrides: isRecord(source.displayOverrides)
      ? (source.displayOverrides as Partial<DisplaySettings>)
      : fallback.displayOverrides,
    metadata:
      isRecord(source.metadata) &&
      typeof source.metadata.createdAt === 'string' &&
      typeof source.metadata.updatedAt === 'string'
        ? {
            createdAt: source.metadata.createdAt,
            updatedAt: source.metadata.updatedAt,
            ...(typeof source.metadata.notes === 'string'
              ? { notes: source.metadata.notes }
              : {}),
          }
        : clone(fallback.metadata),
  };
}

function normalizeCustomFlavor(
  value: unknown,
  bases: Map<string, Flavor>,
): UserFlavor | null {
  if (!isRecord(value)) return null;
  const { id, name, baseFlavorId } = value;
  if (
    typeof id !== 'string' ||
    !id ||
    typeof name !== 'string' ||
    !name ||
    typeof baseFlavorId !== 'string'
  ) {
    return null;
  }
  const base = bases.get(baseFlavorId);
  if (!base) return null;
  const storedVariants = Array.isArray(value.variants) ? value.variants : [];
  if (storedVariants.length === 0) return null;

  const variants = storedVariants.map((entry, index) => {
    const sourceVariantId =
      isRecord(entry) && typeof entry.baseVariantId === 'string'
        ? entry.baseVariantId
        : undefined;
    const baseVariant =
      (sourceVariantId
        ? base.variants.find((candidate) => candidate.id === sourceVariantId)
        : undefined) ??
      base.variants[index] ??
      base.variants[0];
    return normalizeVariant(entry, baseVariant, id);
  });
  const rules = normalizeRuleOverrides(value.rules, base.rules);
  const recordOr = <T,>(stored: unknown, fallback: T): T =>
    isRecord(stored) ? (stored as T) : clone(fallback);

  return {
    ...clone(base),
    id,
    name,
    source: 'user',
    baseFlavorId,
    variants,
    rules,
    dialect: recordOr(value.dialect, base.dialect),
    capabilities: recordOr(value.capabilities, base.capabilities),
    display: recordOr(value.display, base.display),
    customMCodes: normalizeCustomMCodes(value.customMCodes, base.customMCodes),
    systemVariables: recordOr(value.systemVariables, base.systemVariables),
    metadata: recordOr(value.metadata, base.metadata),
  };
}

/** Creates a user flavor from one built-in flavor/variant pair. */
export function cloneFlavor(
  base: Flavor,
  variantId: string,
  id: string,
  name: string,
): UserFlavor | null {
  const variant = base.variants.find((candidate) => candidate.id === variantId);
  if (!variant || !id || !name) return null;

  const copy = clone(base);
  const clonedVariant: MachineVariant = {
    ...clone(variant),
    id: `${id}-variant`,
    flavorId: id,
    baseVariantId: variant.id,
    isUnspecified: variant.isUnspecified ?? false,
    ruleOverrides: { ...variant.ruleOverrides },
  };
  return {
    ...copy,
    id,
    name,
    source: 'user',
    baseFlavorId: base.id,
    variants: [clonedVariant],
  };
}

/** Drops invalid or duplicate clones and fills missing fields from their base. */
export function normalizeCustomFlavors(
  value: unknown,
  bases: Map<string, Flavor>,
): UserFlavor[] {
  if (!Array.isArray(value)) return [];
  const result: UserFlavor[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const flavor = normalizeCustomFlavor(entry, bases);
    if (!flavor || seen.has(flavor.id)) continue;
    seen.add(flavor.id);
    result.push(flavor);
  }
  return result;
}
