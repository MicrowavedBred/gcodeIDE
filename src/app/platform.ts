import { PROJECT_FILE_EXTENSION } from './project-file';

export const GCODE_EXTENSIONS = ['nc', 'gcode', 'tap', 'cnc', 'txt'];
const MAX_FOLDER_FILES = 400;
const PROJECT_FILE_FILTERS = [
  { name: 'gcodeIDE project', extensions: [PROJECT_FILE_EXTENSION] },
];

export interface LoadedFile {
  path: string;
  name: string;
  text: string;
}

export interface LoadedFolder {
  path: string;
  name: string;
  files: LoadedFile[];
}

/** Browser key for the app settings document; native builds use the config dir. */
export const APP_SETTINGS_KEY = 'gcodeide.settings.v1';

export interface PlatformSettingsIO {
  /** Returns the stored settings document, or null when nothing is saved yet. */
  load(): Promise<string | null>;
  save(text: string): Promise<void>;
}

export interface PlatformFileIO {
  readonly native: boolean;
  openProgram(): Promise<LoadedFile | null>;
  openProject(): Promise<LoadedFolder | null>;
  /** Reopens a persisted folder path; browsers return null and prompt instead. */
  openProjectFolderAt(path: string): Promise<LoadedFolder | null>;
  /** Writes back to an already resolved path; browser dev downloads instead. */
  saveProgram(file: LoadedFile): Promise<LoadedFile | null>;
  /** Always prompts for a destination (or downloads in the browser). */
  saveProgramAs(file: LoadedFile): Promise<LoadedFile | null>;
  openProjectFile(): Promise<LoadedFile | null>;
  saveProjectFile(name: string, text: string): Promise<LoadedFile | null>;
  /** Saves a verification report as Markdown. */
  saveReportFile(name: string, text: string): Promise<LoadedFile | null>;
}

export function isGcodeName(name: string): boolean {
  const dot = name.lastIndexOf('.');
  if (dot < 1) return false;
  const extension = name.slice(dot + 1);
  return GCODE_EXTENSIONS.some((candidate) =>
    extension.toLowerCase() === candidate,
  );
}

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

async function nativeOpenProjectFolderAt(path: string): Promise<LoadedFolder | null> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<LoadedFolder>('read_project_folder', { path });
}

async function nativeOpenProgram(): Promise<LoadedFile | null> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const path = await open({
    multiple: false,
    directory: false,
    filters: [
      { name: 'G-code programs', extensions: GCODE_EXTENSIONS },
    ],
  });
  if (typeof path !== 'string') return null;

  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<LoadedFile>('read_program_file', { path });
}

async function nativeOpenProject(): Promise<LoadedFolder | null> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const path = await open({ multiple: false, directory: true });
  if (typeof path !== 'string') return null;

  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<LoadedFolder>('read_project_folder', { path });
}

function pickFiles(directory: boolean, accept?: string): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = !directory;
    if (directory) {
      (input as HTMLInputElement & { webkitdirectory: boolean }).webkitdirectory =
        true;
    } else {
      input.accept =
        accept ?? GCODE_EXTENSIONS.map((extension) => `.${extension}`).join(',');
    }
    const cleanup = () => input.remove();
    input.addEventListener('change', () => {
      const files = Array.from(input.files ?? []);
      cleanup();
      resolve(files);
    });
    input.addEventListener('cancel', () => {
      cleanup();
      resolve([]);
    });
    document.body.appendChild(input);
    input.click();
  });
}

async function writeNativeFile(path: string, text: string): Promise<LoadedFile> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<LoadedFile>('write_program_file', { path, text });
}

async function nativeSaveProgram(file: LoadedFile): Promise<LoadedFile> {
  return writeNativeFile(file.path, file.text);
}

async function nativeSaveProgramAs(file: LoadedFile): Promise<LoadedFile | null> {
  const { save } = await import('@tauri-apps/plugin-dialog');
  const path = await save({
    defaultPath: file.name,
    filters: [{ name: 'G-code programs', extensions: GCODE_EXTENSIONS }],
  });
  if (typeof path !== 'string') return null;
  return writeNativeFile(path, file.text);
}

function projectFileName(name: string): string {
  return name.toLowerCase().endsWith(`.${PROJECT_FILE_EXTENSION}`)
    ? name
    : `${name}.${PROJECT_FILE_EXTENSION}`;
}

function reportFileName(name: string): string {
  const base = name.replace(/\.[^.]+$/, '');
  return base.toLowerCase().endsWith('-report')
    ? `${base}.md`
    : `${base}-report.md`;
}

async function nativeSaveReportFile(
  name: string,
  text: string,
): Promise<LoadedFile | null> {
  const { save } = await import('@tauri-apps/plugin-dialog');
  const path = await save({
    defaultPath: reportFileName(name),
    filters: [{ name: 'Verification report', extensions: ['md', 'txt'] }],
  });
  if (typeof path !== 'string') return null;
  return writeNativeFile(path, text);
}

async function nativeOpenProjectFile(): Promise<LoadedFile | null> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const path = await open({
    multiple: false,
    directory: false,
    filters: PROJECT_FILE_FILTERS,
  });
  if (typeof path !== 'string') return null;
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<LoadedFile>('read_program_file', { path });
}

async function nativeSaveProjectFile(
  name: string,
  text: string,
): Promise<LoadedFile | null> {
  const { save } = await import('@tauri-apps/plugin-dialog');
  const path = await save({
    defaultPath: projectFileName(name),
    filters: PROJECT_FILE_FILTERS,
  });
  if (typeof path !== 'string') return null;
  return writeNativeFile(path, text);
}

/** Browser saves are downloads because file paths are not writable from the webview. */
export function downloadText(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function browserSaveProgram(file: LoadedFile): Promise<LoadedFile> {
  downloadText(file.name, file.text);
  return file;
}

async function browserOpenProgram(): Promise<LoadedFile | null> {
  const [file] = await pickFiles(false);
  if (!file) return null;
  return { path: file.name, name: file.name, text: await file.text() };
}

async function browserOpenProjectFile(): Promise<LoadedFile | null> {
  const [file] = await pickFiles(false, `.${PROJECT_FILE_EXTENSION}`);
  if (!file) return null;
  return { path: file.name, name: file.name, text: await file.text() };
}

async function browserSaveProjectFile(
  name: string,
  text: string,
): Promise<LoadedFile | null> {
  const fileName = projectFileName(name);
  downloadText(fileName, text);
  return { path: fileName, name: fileName, text };
}

export async function browserSaveReportFile(
  name: string,
  text: string,
): Promise<LoadedFile | null> {
  const fileName = reportFileName(name);
  downloadText(fileName, text);
  return { path: fileName, name: fileName, text };
}

async function browserOpenProjectFolderAt(): Promise<LoadedFolder | null> {
  return null;
}

async function browserOpenProject(): Promise<LoadedFolder | null> {
  const files = await pickFiles(true);
  const selected = files.filter((file) => isGcodeName(file.name)).slice(0, MAX_FOLDER_FILES);
  const rootName = selected[0]?.webkitRelativePath.split('/')[0] || 'Project';
  const loaded = await Promise.all(
    selected.map(async (file) => ({
      path: file.webkitRelativePath || file.name,
      name: file.name,
      text: await file.text(),
    })),
  );
  return { path: rootName, name: rootName, files: loaded };
}

const nativeIO: PlatformFileIO = {
  native: true,
  openProgram: nativeOpenProgram,
  openProject: nativeOpenProject,
  openProjectFolderAt: nativeOpenProjectFolderAt,
  saveProgram: nativeSaveProgram,
  saveProgramAs: nativeSaveProgramAs,
  openProjectFile: nativeOpenProjectFile,
  saveProjectFile: nativeSaveProjectFile,
  saveReportFile: nativeSaveReportFile,
};

const browserIO: PlatformFileIO = {
  native: false,
  openProgram: browserOpenProgram,
  openProject: browserOpenProject,
  openProjectFolderAt: browserOpenProjectFolderAt,
  saveProgram: browserSaveProgram,
  saveProgramAs: browserSaveProgram,
  openProjectFile: browserOpenProjectFile,
  saveProjectFile: browserSaveProjectFile,
  saveReportFile: browserSaveReportFile,
};

/** Native dialogs in Tauri; hidden file inputs when running in a browser. */
export const platformFileIO: PlatformFileIO = isTauri() ? nativeIO : browserIO;

async function nativeLoadSettings(): Promise<string | null> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string | null>('load_app_settings');
}

async function nativeSaveSettings(text: string): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('save_app_settings', { text });
}

export async function browserLoadSettings(): Promise<string | null> {
  try {
    return globalThis.localStorage?.getItem(APP_SETTINGS_KEY) ?? null;
  } catch {
    return null;
  }
}

export async function browserSaveSettings(text: string): Promise<void> {
  try {
    globalThis.localStorage?.setItem(APP_SETTINGS_KEY, text);
  } catch {
    // Storage can be disabled; settings then remain session-only.
  }
}

const nativeSettingsIO: PlatformSettingsIO = {
  load: nativeLoadSettings,
  save: nativeSaveSettings,
};

const browserSettingsIO: PlatformSettingsIO = {
  load: browserLoadSettings,
  save: browserSaveSettings,
};

/** Native settings live in the app config dir; browsers use localStorage. */
export const platformSettings: PlatformSettingsIO = isTauri()
  ? nativeSettingsIO
  : browserSettingsIO;
