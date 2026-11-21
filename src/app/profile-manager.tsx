import { useEffect, useState } from 'react';
import { ruleCatalog } from '../core/rules/catalog';
import type {
  CustomMCodeDef,
  MachineVariant,
  Orientation,
  Travels,
  Units,
  UserFlavor,
} from '../core/profiles/types';
import type { Severity } from '../core/shared/types';

interface ProfileManagerProps {
  customFlavors: UserFlavor[];
  onClone(): void;
  onSave(flavor: UserFlavor): void;
  onDelete(flavorId: string): void;
  onClose(): void;
}

type RuleChoice = Severity | 'default';
type TravelAxis = 'x' | 'y' | 'z';

const severityChoices: Array<{ value: RuleChoice; label: string }> = [
  { value: 'default', label: 'Default' },
  { value: 'error', label: 'Error' },
  { value: 'warning', label: 'Warning' },
  { value: 'info', label: 'Info' },
  { value: 'off', label: 'Off' },
];

const mCodePattern = /^M\d+$/;

function numeric(value: string): number | undefined {
  if (value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function currentRuleChoice(flavor: UserFlavor, ruleId: string): RuleChoice {
  const override = flavor.rules[ruleId];
  if (override === undefined) return 'default';
  const severity =
    typeof override === 'string'
      ? override
      : typeof override === 'object' && override !== null
        ? override.severity
        : undefined;
  return severity === 'error' || severity === 'warning' || severity === 'info' || severity === 'off'
    ? severity
    : 'default';
}

/** Dialog for cloning and editing full copies of built-in flavors. */
export function ProfileManager({
  customFlavors,
  onClone,
  onSave,
  onDelete,
  onClose,
}: ProfileManagerProps) {
  const [draft, setDraft] = useState<UserFlavor | null>(
    () => customFlavors[0] ?? null,
  );
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [newMCode, setNewMCode] = useState('');
  const [newMCodeDescription, setNewMCodeDescription] = useState('');
  const [mCodeError, setMCodeError] = useState('');

  useEffect(() => {
    setNewMCode('');
    setNewMCodeDescription('');
    setMCodeError('');
  }, [draft?.id]);

  useEffect(() => {
    if (customFlavors.length === 0) {
      setDraft(null);
      return;
    }
    if (!draft || !customFlavors.some((flavor) => flavor.id === draft.id)) {
      setDraft(customFlavors[customFlavors.length - 1]);
      setConfirmDelete(false);
    }
  }, [customFlavors, draft]);

  function updateVariant(patch: Partial<MachineVariant>) {
    setDraft((current) =>
      current
        ? {
            ...current,
            variants: current.variants.map((variant, index) =>
              index === 0 ? { ...variant, ...patch } : variant,
            ),
          }
        : current,
    );
  }

  function updateTravel(axis: TravelAxis, bound: 'min' | 'max', value: string) {
    if (!draft) return;
    const parsed = numeric(value);
    if (value.trim() !== '' && parsed === undefined) return;
    const variant = draft.variants[0];
    const travel = variant.geometry.travels?.[axis] ?? null;
    const nextTravel =
      parsed === undefined
        ? null
        : travel
          ? { ...travel, [bound]: parsed }
          : { min: parsed, max: parsed };
    const travels: Travels = {
      x: variant.geometry.travels?.x ?? null,
      y: variant.geometry.travels?.y ?? null,
      z: variant.geometry.travels?.z ?? null,
      [axis]: nextTravel,
    };
    updateVariant({ geometry: { ...variant.geometry, travels } });
  }

  function updateRate(field: 'rapidRate' | 'maxFeedRate', value: string) {
    if (!draft) return;
    const variant = draft.variants[0];
    updateVariant({
      geometry: { ...variant.geometry, [field]: numeric(value) },
    });
  }

  function updateRule(ruleId: string, choice: RuleChoice) {
    setDraft((current) => {
      if (!current) return current;
      const rules = { ...current.rules };
      if (choice === 'default') delete rules[ruleId];
      else rules[ruleId] = choice;
      return { ...current, rules };
    });
  }

  function updateMCode(code: string, patch: Partial<CustomMCodeDef>) {
    setDraft((current) => {
      if (!current || !current.customMCodes[code]) return current;
      return {
        ...current,
        customMCodes: {
          ...current.customMCodes,
          [code]: { ...current.customMCodes[code], ...patch },
        },
      };
    });
  }

  function removeMCode(code: string) {
    setDraft((current) => {
      if (!current || !current.customMCodes[code]) return current;
      const customMCodes = { ...current.customMCodes };
      delete customMCodes[code];
      return { ...current, customMCodes };
    });
  }

  function addMCode() {
    if (!draft) return;
    const code = newMCode.trim().toUpperCase();
    const description = newMCodeDescription.trim();
    if (!mCodePattern.test(code)) {
      setMCodeError('Use M followed by digits, for example M400.');
      return;
    }
    if (draft.customMCodes[code]) {
      setMCodeError(`${code} is already defined.`);
      return;
    }
    if (!description) {
      setMCodeError('Enter a description.');
      return;
    }
    setDraft((current) =>
      current
        ? {
            ...current,
            customMCodes: {
              ...current.customMCodes,
              [code]: {
                code,
                description,
                category: 'other',
                affectsSimulation: false,
              },
            },
          }
        : current,
    );
    setNewMCode('');
    setNewMCodeDescription('');
    setMCodeError('');
  }

  const variant = draft?.variants[0];
  const dirty =
    !!draft &&
    customFlavors.some(
      (flavor) =>
        flavor.id === draft.id && JSON.stringify(flavor) !== JSON.stringify(draft),
    );

  return (
    <div className="confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="profiles-title">
      <div className="profile-card">
        <div className="profile-header">
          <h2 id="profiles-title">Custom profiles</h2>
          <button type="button" onClick={onClose} aria-label="Close profile manager">
            ×
          </button>
        </div>

        <div className="profile-body">
          <div className="profile-list">
            {customFlavors.map((flavor) => (
              <button
                type="button"
                key={flavor.id}
                aria-pressed={flavor.id === draft?.id}
                onClick={() => {
                  setDraft(flavor);
                  setConfirmDelete(false);
                }}
              >
                {flavor.name}
                <small>{flavor.baseFlavorId}</small>
              </button>
            ))}
            <button type="button" className="profile-clone" onClick={onClone}>
              + Clone current profile
            </button>
          </div>

          {draft && variant ? (
            <div className="profile-editor">
              <label className="control">
                <span>Profile name</span>
                <input
                  value={draft.name}
                  onChange={(event) =>
                    setDraft({ ...draft, name: event.target.value })
                  }
                />
              </label>

              <label className="control">
                <span>Variant name</span>
                <input
                  value={variant.name}
                  onChange={(event) =>
                    updateVariant({ name: event.target.value })
                  }
                />
              </label>

              <div className="profile-row">
                <label className="control">
                  <span>Units</span>
                  <select
                    value={variant.units}
                    onChange={(event) =>
                      updateVariant({ units: event.target.value as Units | 'inherit' })
                    }
                  >
                    <option value="inherit">Inherit default</option>
                    <option value="mm">mm</option>
                    <option value="inch">inch</option>
                  </select>
                </label>
                <label className="control">
                  <span>Orientation</span>
                  <select
                    value={variant.orientation}
                    onChange={(event) =>
                      updateVariant({
                        orientation: event.target.value as Orientation,
                      })
                    }
                  >
                    <option value="vertical">Vertical</option>
                    <option value="horizontal">Horizontal</option>
                  </select>
                </label>
              </div>

              <fieldset className="profile-fieldset">
                <legend>Travels (mm, blank = unbounded)</legend>
                {(['x', 'y', 'z'] as TravelAxis[]).map((axis) => {
                  const travel = variant.geometry.travels?.[axis] ?? null;
                  return (
                    <div className="profile-row" key={axis}>
                      <span className="profile-axis">{axis.toUpperCase()}</span>
                      <label className="control">
                        <span>Min</span>
                        <input
                          type="number"
                          step="1"
                          value={travel ? String(travel.min) : ''}
                          onChange={(event) =>
                            updateTravel(axis, 'min', event.target.value)
                          }
                        />
                      </label>
                      <label className="control">
                        <span>Max</span>
                        <input
                          type="number"
                          step="1"
                          value={travel ? String(travel.max) : ''}
                          onChange={(event) =>
                            updateTravel(axis, 'max', event.target.value)
                          }
                        />
                      </label>
                    </div>
                  );
                })}
              </fieldset>

              <div className="profile-row">
                <label className="control">
                  <span>Rapid (mm/min)</span>
                  <input
                    type="number"
                    min="1"
                    step="100"
                    value={
                      variant.geometry.rapidRate === undefined
                        ? ''
                        : String(variant.geometry.rapidRate)
                    }
                    onChange={(event) => updateRate('rapidRate', event.target.value)}
                  />
                </label>
                <label className="control">
                  <span>Max feed (mm/min)</span>
                  <input
                    type="number"
                    min="1"
                    step="100"
                    value={
                      variant.geometry.maxFeedRate === undefined
                        ? ''
                        : String(variant.geometry.maxFeedRate)
                    }
                    onChange={(event) => updateRate('maxFeedRate', event.target.value)}
                  />
                </label>
              </div>

              <details className="profile-rules">
                <summary>Rule severities ({Object.keys(draft.rules).length} overridden)</summary>
                <div className="profile-rule-list">
                  {ruleCatalog.map((rule) => (
                    <label className="profile-rule" key={rule.id}>
                      <span title={rule.description}>{rule.id}</span>
                      <select
                        value={currentRuleChoice(draft, rule.id)}
                        onChange={(event) =>
                          updateRule(rule.id, event.target.value as RuleChoice)
                        }
                      >
                        {severityChoices.map((choice) => (
                          <option key={choice.value} value={choice.value}>
                            {choice.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
              </details>

              <details className="profile-rules">
                <summary>
                  Custom M-codes ({Object.keys(draft.customMCodes).length} defined)
                </summary>
                <div className="profile-rule-list">
                  {Object.values(draft.customMCodes)
                    .filter(
                      (entry) =>
                        entry &&
                        typeof entry.code === 'string' &&
                        typeof entry.description === 'string',
                    )
                    .sort((a, b) => a.code.localeCompare(b.code))
                    .map((entry) => (
                      <div className="profile-rule" key={entry.code}>
                        <span className="profile-mcode-code">{entry.code}</span>
                        <input
                          className="profile-mcode-description"
                          aria-label={`Description for ${entry.code}`}
                          value={entry.description}
                          onChange={(event) =>
                            updateMCode(entry.code, {
                              description: event.target.value,
                            })
                          }
                        />
                        <button
                          type="button"
                          className="profile-mcode-remove"
                          aria-label={`Remove ${entry.code}`}
                          onClick={() => removeMCode(entry.code)}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                </div>
                <div className="profile-row profile-mcode-add">
                  <label className="control">
                    <span>Code</span>
                    <input
                      value={newMCode}
                      placeholder="M400"
                      onChange={(event) => {
                        setNewMCode(event.target.value);
                        setMCodeError('');
                      }}
                    />
                  </label>
                  <label className="control">
                    <span>Description</span>
                    <input
                      value={newMCodeDescription}
                      placeholder="Clamp release"
                      onChange={(event) => {
                        setNewMCodeDescription(event.target.value);
                        setMCodeError('');
                      }}
                    />
                  </label>
                  <button type="button" onClick={addMCode}>
                    Add
                  </button>
                </div>
                {mCodeError && (
                  <p className="profile-mcode-error" role="alert">
                    {mCodeError}
                  </p>
                )}
              </details>
            </div>
          ) : (
            <p className="profile-empty">
              Clone the current flavor/variant to create a custom profile.
            </p>
          )}
        </div>

        <div className="confirm-actions">
          <button
            type="button"
            onClick={() => {
              if (!draft) return;
              if (!confirmDelete) {
                setConfirmDelete(true);
                return;
              }
              onDelete(draft.id);
              setConfirmDelete(false);
            }}
            disabled={!draft}
          >
            {confirmDelete ? 'Confirm delete' : 'Delete clone'}
          </button>
          <span className="summary-spacer" />
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            disabled={!dirty}
            onClick={() => {
              if (!draft) return;
              onSave(draft);
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
