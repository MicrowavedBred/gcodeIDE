use serde_json::{Map, Value};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const SETTINGS_FILE: &str = "settings.json";
const MAX_SETTINGS_BYTES: u64 = 256 * 1024;

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("Cannot resolve settings directory: {error}"))?;
    Ok(directory.join(SETTINGS_FILE))
}

fn read_document_at(path: &Path) -> Result<Map<String, Value>, String> {
    if !path.exists() {
        return Ok(Map::new());
    }
    let metadata = fs::metadata(path)
        .map_err(|error| format!("Cannot inspect {}: {error}", path.display()))?;
    if metadata.len() > MAX_SETTINGS_BYTES {
        return Err("Settings file is too large".to_string());
    }
    let text = fs::read_to_string(path)
        .map_err(|error| format!("Cannot read {}: {error}", path.display()))?;
    if text.trim().is_empty() {
        return Ok(Map::new());
    }
    let value: Value = serde_json::from_str(&text)
        .map_err(|error| format!("Settings file is invalid: {error}"))?;
    value
        .as_object()
        .cloned()
        .ok_or_else(|| "Settings file must contain a JSON object".to_string())
}

fn write_document_at(path: &Path, document: &Map<String, Value>) -> Result<(), String> {
    let text = serde_json::to_string_pretty(document)
        .map_err(|error| format!("Cannot serialize settings: {error}"))?;
    if text.len() as u64 > MAX_SETTINGS_BYTES {
        return Err("Settings are too large".to_string());
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Cannot create settings directory: {error}"))?;
    }
    fs::write(path, text.as_bytes())
        .map_err(|error| format!("Cannot write {}: {error}", path.display()))
}

#[tauri::command]
pub fn load_app_settings(app: AppHandle) -> Result<Option<String>, String> {
    let document = read_document_at(&settings_path(&app)?)?;
    if document.is_empty() {
        return Ok(None);
    }
    serde_json::to_string(&Value::Object(document))
        .map(Some)
        .map_err(|error| format!("Cannot serialize settings: {error}"))
}

#[tauri::command]
pub fn save_app_settings(app: AppHandle, text: String) -> Result<(), String> {
    if text.len() as u64 > MAX_SETTINGS_BYTES {
        return Err("Settings are too large".to_string());
    }
    let value: Value = serde_json::from_str(&text)
        .map_err(|error| format!("Settings must be valid JSON: {error}"))?;
    let document = value
        .as_object()
        .cloned()
        .ok_or_else(|| "Settings must be a JSON object".to_string())?;
    write_document_at(&settings_path(&app)?, &document)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_a_settings_document() {
        let path = std::env::temp_dir().join(format!(
            "gcodeide-settings-test-{}.json",
            std::process::id()
        ));
        let mut document = Map::new();
        document.insert("version".to_string(), Value::from(1));
        document.insert("label".to_string(), Value::from("saved"));

        write_document_at(&path, &document).unwrap();
        let loaded = read_document_at(&path).unwrap();

        assert_eq!(loaded.get("version").and_then(Value::as_i64), Some(1));
        assert_eq!(loaded.get("label").and_then(Value::as_str), Some("saved"));
        fs::remove_file(&path).unwrap();
    }

    #[test]
    fn treats_a_missing_document_as_empty() {
        let path = std::env::temp_dir().join(format!(
            "gcodeide-settings-missing-{}.json",
            std::process::id()
        ));
        assert!(read_document_at(&path).unwrap().is_empty());
    }
}
