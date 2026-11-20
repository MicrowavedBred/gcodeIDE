import { describe, expect, it } from 'vitest';
import { analyzeProgram } from '../../src/app/analysis';
import { buildSubprograms, mainFileFromFolder } from '../../src/app/program-set';
import { brotherProfile } from '../../src/core/profiles/builtin/brother';

const folder = {
  path: '/projects/job',
  name: 'job',
  files: [
    {
      path: '/projects/job/sub.nc',
      name: 'sub.nc',
      text: 'O2000\nG0 X10\nM99\n',
    },
    {
      path: '/projects/job/main.nc',
      name: 'main.nc',
      text: 'G21 G90 G0 X0\nM98 P2000\nM30\n',
    },
    {
      path: '/projects/job/notes.md',
      name: 'notes.md',
      text: 'not a program',
    },
  ],
};

describe('project folder to ProgramSet', () => {
  it('selects the first G-code file as the main program', () => {
    expect(mainFileFromFolder(folder)?.name).toBe('main.nc');
  });

  it('parses subprograms and excludes the open main program', () => {
    const subprograms = buildSubprograms(folder, '/projects/job/main.nc');
    expect(subprograms.map((program) => program.file)).toEqual([
      '/projects/job/sub.nc',
    ]);
  });

  it('resolves M98 against files loaded from the folder', () => {
    const main = mainFileFromFolder(folder)!;
    const subprograms = buildSubprograms(folder, main.path);
    const result = analyzeProgram(main.text, main.path, brotherProfile(), subprograms);

    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(
      result.evaluation.blockStates.some(
        (state) => state.block.file === '/projects/job/sub.nc',
      ),
    ).toBe(true);
    expect(
      result.evaluation.events.find((event) => event.kind === 'subprogram-call'),
    ).toMatchObject({ number: 2000, file: '/projects/job/sub.nc' });
  });
});
