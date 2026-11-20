import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { evaluateProgram } from '../../src/core/gcode/modal';
import { parseProgram } from '../../src/core/gcode/parser';
import { runRules } from '../../src/core/rules/engine';
import type { RuleContext } from '../../src/core/rules/types';
import { brotherProfile, brotherS700XD2Variant } from '../../src/core/profiles/builtin/brother';
import { brotherSpeedioFlavor } from '../../src/core/profiles/builtin/brother';
import { defaultUserPreferences } from '../../src/core/profiles/builtin/brother';
import { resolveProfile } from '../../src/core/profiles/types';
import type { ResolvedMachineProfile } from '../../src/core/profiles/types';

const corpusDir = fileURLToPath(
  new URL('../../cnc programs/Brother/', import.meta.url),
);

function analyze(
  text: string,
  profile: ResolvedMachineProfile = brotherProfile(),
  extras: Pick<RuleContext, 'stock' | 'safeZ'> = {},
) {
  const program = parseProgram(text, 'test.nc');
  return runRules({
    profile,
    program,
    evaluation: evaluateProgram(program, profile),
    ...extras,
  });
}

const rules = (text: string, profile?: ResolvedMachineProfile) =>
  analyze(text, profile).map((diagnostic) => diagnostic.ruleId);

const boundedProfile = resolveProfile(
  brotherSpeedioFlavor,
  {
    ...brotherS700XD2Variant,
    id: 'test-bounded',
    geometry: {
      ...brotherS700XD2Variant.geometry,
      maxFeedRate: 10000,
    },
  },
  defaultUserPreferences,
);

describe('rule catalog on the Brother corpus', () => {
  const files = readdirSync(corpusDir)
    .filter((name) => /\.(nc|ofs)$/i.test(name))
    .sort();

  for (const file of files) {
    it(`reports no rule violations for ${file}`, () => {
      const text = readFileSync(join(corpusDir, file), 'utf8');
      const diagnostics = analyze(text);
      const errors = diagnostics.filter(
        (diagnostic) => diagnostic.severity === 'error',
      );
      expect(errors, JSON.stringify(errors.slice(0, 5))).toEqual([]);

      // Duplicate section-local labels are intentional in O7963; everything
      // else should be limited to unconfigured system variables and the
      // resulting "condition assumed" notes.
      const allowedWarnings = new Set(['unknown-system-variable']);
      if (file === 'O7963.NC') allowedWarnings.add('duplicate-sequence-number');
      const unexpected = diagnostics.filter(
        (diagnostic) =>
          diagnostic.severity === 'warning' &&
          !allowedWarnings.has(diagnostic.ruleId),
      );
      expect(
        unexpected,
        JSON.stringify(unexpected.slice(0, 5)),
      ).toEqual([]);

      const unexpectedInfo = diagnostics.filter(
        (diagnostic) =>
          diagnostic.severity === 'info' &&
          diagnostic.ruleId !== 'macro-condition-assumed',
      );
      expect(unexpectedInfo, JSON.stringify(unexpectedInfo.slice(0, 5))).toEqual(
        [],
      );
    });
  }
});

describe('missing-tool-length-comp', () => {
  it('flags work-frame Z motion after a tool change', () => {
    expect(
      rules(
        [
          'G21 G90',
          'T4 M6',
          'G0 X10 Y10',
          'G0 Z5',
          'M30',
        ].join('\n'),
      ),
    ).toContain('missing-tool-length-comp');
  });

  it('accepts G43 before the first Z move', () => {
    expect(
      rules(
        ['G21 G90', 'T4 M6', 'G0 X10 Y10', 'G0 G43 Z5 H4', 'M30'].join('\n'),
      ),
    ).not.toContain('missing-tool-length-comp');
  });

  it('ignores G53 tool returns', () => {
    expect(
      rules(
        [
          'G21 G90 G0 X0 Y0',
          'T28 M6',
          'G53 G0 X0 Y0 Z530',
          'M30',
        ].join('\n'),
      ),
    ).not.toContain('missing-tool-length-comp');
  });
});

describe('arc-plane-mismatch', () => {
  it('flags K in G17', () => {
    expect(
      rules('G17 G90 G0 X0 Y0\nG2 X10 Y0 I5 J0 K1 F100\nM30'),
    ).toContain('arc-plane-mismatch');
  });

  it('accepts in-plane centre words', () => {
    expect(
      rules('G17 G90 G0 X0 Y0\nG2 X10 Y0 I5 J0 F100\nM30'),
    ).not.toContain('arc-plane-mismatch');
  });

  it('flags arcs without R or centre words', () => {
    expect(rules('G17 G90 G0 X0 Y0\nG2 X10 Y0 F100\nM30')).toContain(
      'arc-plane-mismatch',
    );
  });
});

describe('travel-limit-exceeded', () => {
  it('is silent on unbounded variants', () => {
    expect(rules('G21 G90 G0 X99999 Y0 Z0\nM30')).not.toContain(
      'travel-limit-exceeded',
    );
  });

  it('flags positions outside bounded travels', () => {
    expect(
      rules('G21 G90 G0 X500 Y0 Z0\nM30', boundedProfile),
    ).toContain('travel-limit-exceeded');
  });
});

describe('compensation rules', () => {
  it('flags rapid while cutter comp is active', () => {
    expect(
      rules(
        ['G21 G90 G0 X0 Y0', 'G1 G41 X10 Y0 D1 F100', 'G0 X20', 'M30'].join(
          '\n',
        ),
      ),
    ).toContain('unsafe-cutter-comp-rapid');
  });

  it('flags tool change while cutter comp is active', () => {
    expect(
      rules(
        ['G21 G90 G0 X0 Y0', 'G1 G41 X10 Y0 D1 F100', 'T2 M6', 'M30'].join(
          '\n',
        ),
      ),
    ).toContain('tool-change-while-comp-active');
  });
});

describe('program-level rules', () => {
  it('flags inch programs on a metric profile', () => {
    expect(rules('G20 G90 G0 X0 Y0\nM30')).toContain('unit-mismatch');
  });

  it('flags duplicate sequence numbers', () => {
    expect(rules('N10 G0 X0\nN20 G0 X1\nN20 G0 X2\nM30')).toContain(
      'duplicate-sequence-number',
    );
  });

  it('flags a program that never selects a distance mode', () => {
    expect(rules('G21 G0 X0 Y0 Z0\nM30')).toContain('missing-absolute-mode');
  });

  it('flags feeds above the variant maximum', () => {
    expect(
      rules('G21 G90 G0 X0\nG1 X10 F20000\nM30', boundedProfile),
    ).toContain('feed-out-of-range');
  });

  it('flags spindle speeds outside the flavor range', () => {
    expect(rules('G21 G90 G0 X0\nS99999 M3\nM30')).toContain(
      'spindle-out-of-range',
    );
  });

  it('flags a missing program end', () => {
    expect(rules('G21 G90 G0 X0 Y0 Z0')).toContain('missing-program-end');
  });
});

describe('optional geometry rules', () => {
  it('flags rapids below a configured safe Z', () => {
    expect(
      rules('G21 G90 G0 X0 Y0 Z50\nG0 Z1\nM30'),
    ).not.toContain('unsafe-z-clearance');
    expect(
      analyze('G21 G90 G0 X0 Y0 Z50\nG0 Z1\nM30', brotherProfile(), {
        safeZ: 5,
      }).map((diagnostic) => diagnostic.ruleId),
    ).toContain('unsafe-z-clearance');
  });

  it('flags rapids inside the stock envelope', () => {
    const diagnostics = analyze(
      'G21 G90 G0 X0 Y0 Z20\nG0 X5 Y5 Z-1\nM30',
      brotherProfile(),
      {
        stock: {
          min: { x: -10, y: -10, z: -5 },
          max: { x: 10, y: 10, z: 0 },
        },
      },
    );
    expect(
      diagnostics.some(
        (diagnostic) => diagnostic.ruleId === 'rapid-through-stock',
      ),
    ).toBe(true);
  });
});

describe('severity overrides', () => {
  it('can downgrade or disable a rule per flavor', () => {
    const profile = resolveProfile(
      { ...brotherSpeedioFlavor, rules: { 'missing-program-end': 'off', 'unit-mismatch': 'info' } },
      brotherSpeedioFlavor.variants[0],
      defaultUserPreferences,
    );
    const diagnostics = analyze('G20 G90 G0 X0 Y0', profile);
    expect(
      diagnostics.some((diagnostic) => diagnostic.ruleId === 'missing-program-end'),
    ).toBe(false);
    expect(
      diagnostics.find((diagnostic) => diagnostic.ruleId === 'unit-mismatch')
        ?.severity,
    ).toBe('info');
  });

  it('lets variant overrides win over flavor overrides', () => {
    const profile = resolveProfile(
      { ...brotherSpeedioFlavor, rules: { 'missing-program-end': 'warning' } },
      {
        ...brotherSpeedioFlavor.variants[0],
        id: 'test-override',
        ruleOverrides: { 'missing-program-end': 'error' },
      },
      defaultUserPreferences,
    );
    const diagnostics = analyze('G21 G90 G0 X0 Y0', profile);
    expect(
      diagnostics.find(
        (diagnostic) => diagnostic.ruleId === 'missing-program-end',
      )?.severity,
    ).toBe('error');
  });
});
