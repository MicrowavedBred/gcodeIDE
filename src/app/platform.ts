export const GCODE_EXTENSIONS = ['nc', 'gcode', 'tap', 'cnc', 'txt'];
const MAX_FOLDER_FILES = 400;

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

export interface PlatformFileIO {
  readonly native: boolean;
  openProgram(): Promise<LoadedFile | null>;
  openProject(): Promise<LoadedFolder | null>;
  /** Writes back to an already resolved path; browser dev downloads instead. */
  saveProgram(file: LoadedFile): Promise<LoadedFile | null>;
  /** Always prompts for a destination (or downloads in the browser). */
  saveProgramAs(file: LoadedFile): Promise<LoadedFile | null>;
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

function pickFiles(directory: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = !directory;
    if (directory) {
      (input as HTMLInputElement & { webkitdirectory: boolean }).webkitdirectory =
        true;
    } else {
      input.accept = GCODE_EXTENSIONS.map((extension) => `.${extension}`).join(',');
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
  saveProgram: nativeSaveProgram,
  saveProgramAs: nativeSaveProgramAs,
};

const browserIO: PlatformFileIO = {
  native: false,
  openProgram: browserOpenProgram,
  openProject: browserOpenProject,
  saveProgram: browserSaveProgram,
  saveProgramAs: browserSaveProgram,
};

/** Native dialogs in Tauri; hidden file inputs when running in a browser. */
export const platformFileIO: PlatformFileIO = isTauri() ? nativeIO : browserIO;
