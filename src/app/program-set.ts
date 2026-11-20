import { parseProgram, type ParsedProgram } from '../core/gcode/parser';
import { isGcodeName, type LoadedFile, type LoadedFolder } from './platform';

/** First file in a folder, used as the main program when a project is opened. */
export function mainFileFromFolder(folder: LoadedFolder): LoadedFile | null {
  return [...folder.files].sort((a, b) => a.path.localeCompare(b.path))[0] ?? null;
}

/**
 * Parses every G-code file in a folder except the open main program so `M98`
 * can resolve O-numbered subprograms stored as separate files.
 */
export function buildSubprograms(
  folder: LoadedFolder,
  mainPath?: string,
): ParsedProgram[] {
  return folder.files
    .filter((file) => file.path !== mainPath && isGcodeName(file.name))
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((file) => parseProgram(file.text, file.path));
}
