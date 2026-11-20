use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

const GCODE_EXTENSIONS: &[&str] = &["nc", "gcode", "tap", "cnc", "txt"];
const MAX_FILE_BYTES: u64 = 8 * 1024 * 1024;
const MAX_FOLDER_FILES: usize = 400;
const MAX_DEPTH: usize = 4;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedFile {
    pub path: String,
    pub name: String,
    pub text: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedFolder {
    pub path: String,
    pub name: String,
    pub files: Vec<LoadedFile>,
}

fn is_gcode_file(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            GCODE_EXTENSIONS
                .iter()
                .any(|candidate| extension.eq_ignore_ascii_case(candidate))
        })
}

fn display_name(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("<unnamed>")
        .to_string()
}

fn validate_write_text(text: &str) -> Result<(), String> {
    if text.len() as u64 > MAX_FILE_BYTES {
        return Err(format!(
            "Program is larger than {} MB",
            MAX_FILE_BYTES / (1024 * 1024)
        ));
    }
    Ok(())
}

fn read_text(path: &Path) -> Result<String, String> {
    let metadata = fs::metadata(path)
        .map_err(|error| format!("Cannot inspect {}: {error}", path.display()))?;
    if !metadata.is_file() {
        return Err(format!("{} is not a file", path.display()));
    }
    if metadata.len() > MAX_FILE_BYTES {
        return Err(format!(
            "{} is larger than {} MB",
            path.display(),
            MAX_FILE_BYTES / (1024 * 1024)
        ));
    }
    fs::read_to_string(path)
        .map_err(|error| format!("Cannot read {}: {error}", path.display()))
}

fn to_loaded_file(path: &Path, text: String) -> LoadedFile {
    LoadedFile {
        path: path.to_string_lossy().into_owned(),
        name: display_name(path),
        text,
    }
}

fn collect_gcode_files(
    directory: &Path,
    depth: usize,
    output: &mut Vec<PathBuf>,
) -> Result<(), String> {
    if output.len() >= MAX_FOLDER_FILES || depth > MAX_DEPTH {
        return Ok(());
    }

    let entries = fs::read_dir(directory)
        .map_err(|error| format!("Cannot list {}: {error}", directory.display()))?;
    let mut subdirectories = Vec::new();

    for entry in entries {
        let entry = entry.map_err(|error| {
            format!("Cannot read an entry in {}: {error}", directory.display())
        })?;
        let path = entry.path();
        let Ok(file_type) = entry.file_type() else {
            continue;
        };

        if file_type.is_dir() {
            subdirectories.push(path);
        } else if file_type.is_file() && is_gcode_file(&path) {
            output.push(path);
            if output.len() >= MAX_FOLDER_FILES {
                return Ok(());
            }
        }
    }

    subdirectories.sort();
    for subdirectory in subdirectories {
        collect_gcode_files(&subdirectory, depth + 1, output)?;
    }
    Ok(())
}

#[tauri::command]
pub fn read_program_file(path: String) -> Result<LoadedFile, String> {
    let path = PathBuf::from(path);
    let text = read_text(&path)?;
    Ok(to_loaded_file(&path, text))
}

#[tauri::command]
pub fn write_program_file(path: String, text: String) -> Result<LoadedFile, String> {
    validate_write_text(&text)?;
    let path = PathBuf::from(path);
    fs::write(&path, text.as_bytes())
        .map_err(|error| format!("Cannot write {}: {error}", path.display()))?;
    Ok(to_loaded_file(&path, text))
}

#[tauri::command]
pub fn read_project_folder(path: String) -> Result<LoadedFolder, String> {
    let root = PathBuf::from(path);
    let metadata = fs::metadata(&root)
        .map_err(|error| format!("Cannot inspect {}: {error}", root.display()))?;
    if !metadata.is_dir() {
        return Err(format!("{} is not a folder", root.display()));
    }

    let mut paths = Vec::new();
    collect_gcode_files(&root, 0, &mut paths)?;
    paths.sort();

    let files = paths
        .iter()
        .filter_map(|path| read_text(path).ok().map(|text| to_loaded_file(path, text)))
        .collect();

    Ok(LoadedFolder {
        path: root.to_string_lossy().into_owned(),
        name: display_name(&root),
        files,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_gcode_extensions_case_insensitively() {
        assert!(is_gcode_file(Path::new("O1801.NC")));
        assert!(is_gcode_file(Path::new("pocket.gcode")));
        assert!(is_gcode_file(Path::new("probe.TAP")));
        assert!(!is_gcode_file(Path::new("setup-sheet.pdf")));
        assert!(!is_gcode_file(Path::new("program")));
    }

    #[test]
    fn writes_and_round_trips_a_program() {
        let path = std::env::temp_dir().join(format!(
            "gcodeide-save-test-{}.nc",
            std::process::id()
        ));
        let path = path.to_string_lossy().into_owned();
        let text = "G21 G90 G0 X0\nM30\n";

        let saved = write_program_file(path.clone(), text.to_string()).unwrap();
        assert_eq!(saved.text, text);
        assert_eq!(read_program_file(path.clone()).unwrap().text, text);
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn rejects_oversized_writes() {
        let text = "x".repeat(MAX_FILE_BYTES as usize + 1);
        assert!(write_program_file("unused.nc".to_string(), text).is_err());
    }
}
