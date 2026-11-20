import type { LoadedFile, LoadedFolder } from './platform';

export const PROJECT_FILE_VERSION = 1;
export const PROJECT_FILE_EXTENSION = 'gcodeide';

export interface ProjectFileV1 {
  version: 1;
  flavorId: string;
  variantId: string;
  folderName: string | null;
  folderPath: string | null;
  mainProgram: string;
}

export interface ProjectFileInput {
  flavorId: string;
  variantId: string;
  folder: LoadedFolder | null;
  main: LoadedFile;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
}

function relativeProgramPath(folderPath: string | null, main: LoadedFile): string {
  if (!folderPath) return main.name;
  const folder = normalizePath(folderPath);
  const file = normalizePath(main.path);
  if (file.startsWith(`${folder}/`)) return file.slice(folder.length + 1);
  return main.name;
}

export function createProjectFile(input: ProjectFileInput): ProjectFileV1 {
  return {
    version: PROJECT_FILE_VERSION,
    flavorId: input.flavorId,
    variantId: input.variantId,
    folderName: input.folder?.name ?? null,
    folderPath: input.folder?.path ?? null,
    mainProgram: relativeProgramPath(input.folder?.path ?? null, input.main),
  };
}

export function serializeProjectFile(project: ProjectFileV1): string {
  return `${JSON.stringify(project, null, 2)}\n`;
}

function optionalString(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new Error(`${field} must be a string or null.`);
  return value;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return value;
}

export function parseProjectFile(text: string): ProjectFileV1 {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('Project file is not valid JSON.');
  }
  if (typeof value !== 'object' || value === null) {
    throw new Error('Project file must contain a JSON object.');
  }
  const record = value as Record<string, unknown>;
  if (record.version !== PROJECT_FILE_VERSION) {
    throw new Error(`Unsupported project file version: ${String(record.version)}.`);
  }
  return {
    version: PROJECT_FILE_VERSION,
    flavorId: requiredString(record.flavorId, 'flavorId'),
    variantId: requiredString(record.variantId, 'variantId'),
    folderName: optionalString(record.folderName, 'folderName'),
    folderPath: optionalString(record.folderPath, 'folderPath'),
    mainProgram: requiredString(record.mainProgram, 'mainProgram'),
  };
}

/** Finds the saved main program in a reselected folder, tolerating path moves. */
export function resolveMainFile(
  folder: LoadedFolder,
  mainProgram: string,
): LoadedFile | null {
  const target = normalizePath(mainProgram);
  const targetName = target.split('/').pop() ?? target;
  return (
    folder.files.find((file) => normalizePath(file.path) === target) ??
    folder.files.find((file) => normalizePath(file.path).endsWith(`/${target}`)) ??
    folder.files.find((file) => file.name === targetName) ??
    null
  );
}
