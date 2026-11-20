import { describe, expect, it } from 'vitest';
import {
  createProjectFile,
  parseProjectFile,
  resolveMainFile,
  serializeProjectFile,
} from '../../src/app/project-file';
import type { LoadedFile, LoadedFolder } from '../../src/app/platform';

const main: LoadedFile = {
  path: '/work/job/sub/main.nc',
  name: 'main.nc',
  text: 'G21\nM30\n',
};

const folder: LoadedFolder = {
  path: '/work/job',
  name: 'job',
  files: [
    main,
    { path: '/work/job/sub/helper.nc', name: 'helper.nc', text: 'M99\n' },
  ],
};

describe('project file serialization', () => {
  it('stores the folder association and a main program path relative to it', () => {
    const document = createProjectFile({
      flavorId: 'haas-mill',
      variantId: 'haas-vf2',
      folder,
      main,
    });
    expect(document).toEqual({
      version: 1,
      flavorId: 'haas-mill',
      variantId: 'haas-vf2',
      folderName: 'job',
      folderPath: '/work/job',
      mainProgram: 'sub/main.nc',
    });
    expect(parseProjectFile(serializeProjectFile(document))).toEqual(document);
  });

  it('normalizes Windows paths and falls back to the file name outside a folder', () => {
    const document = createProjectFile({
      flavorId: 'haas-mill',
      variantId: 'haas-vf2',
      folder: null,
      main: { ...main, path: 'C:\\job\\sub\\main.nc' },
    });
    expect(document.mainProgram).toBe('main.nc');
    expect(document.folderPath).toBeNull();
  });

  it('rejects unsupported versions and missing fields', () => {
    expect(() => parseProjectFile('{"version":2}')).toThrow(
      'Unsupported project file version',
    );
    expect(() => parseProjectFile('not json')).toThrow('not valid JSON');
    expect(() =>
      parseProjectFile(
        '{"version":1,"flavorId":"haas-mill","variantId":"","folderName":null,"folderPath":null,"mainProgram":"main.nc"}',
      ),
    ).toThrow('variantId must be a non-empty string');
  });
});

describe('main program resolution', () => {
  it('finds the saved program by relative path, then by name', () => {
    expect(resolveMainFile(folder, 'sub/main.nc')).toBe(main);
    expect(resolveMainFile(folder, 'job/sub/main.nc')).toBe(main);
    expect(resolveMainFile(folder, 'main.nc')).toBe(main);
    expect(resolveMainFile(folder, 'missing.nc')).toBeNull();
  });
});
