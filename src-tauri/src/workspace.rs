use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;

#[derive(Serialize)]
pub struct DirEntryInfo {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

#[tauri::command]
pub fn list_directory(path: String) -> Result<Vec<DirEntryInfo>, String> {
    let root = PathBuf::from(&path);
    let meta = fs::metadata(&root).map_err(|err| err.to_string())?;
    if !meta.is_dir() {
        return Err("路径不是文件夹".to_string());
    }

    let mut entries = Vec::new();
    for entry in fs::read_dir(&root).map_err(|err| err.to_string())? {
        let entry = entry.map_err(|err| err.to_string())?;
        let file_type = entry.file_type().map_err(|err| err.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        let is_dir = file_type.is_dir();
        if !is_dir && !is_markdown_name(&name) {
            continue;
        }
        entries.push(DirEntryInfo {
            name,
            path: entry.path().to_string_lossy().into_owned(),
            is_dir,
        });
    }

    entries.sort_by(|left, right| {
        right
            .is_dir
            .cmp(&left.is_dir)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
    Ok(entries)
}

#[tauri::command]
pub fn reveal_in_folder(path: String) -> Result<(), String> {
    let target = PathBuf::from(&path);
    if !target.exists() {
        return Err("路径不存在".to_string());
    }
    reveal_path(&target)
}

pub fn is_markdown_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.ends_with(".md") || lower.ends_with(".markdown") || lower.ends_with(".txt")
}

#[cfg(windows)]
fn reveal_path(path: &Path) -> Result<(), String> {
    let absolute = fs::canonicalize(path).map_err(|err| err.to_string())?;
    let display = absolute.to_string_lossy().replacen(r"\\?\", "", 1);
    Command::new("explorer")
        .arg(format!("/select,{display}"))
        .spawn()
        .map_err(|err| err.to_string())?;
    Ok(())
}

#[cfg(target_os = "macos")]
fn reveal_path(path: &Path) -> Result<(), String> {
    Command::new("open")
        .args(["-R", &path.to_string_lossy()])
        .spawn()
        .map_err(|err| err.to_string())?;
    Ok(())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn reveal_path(path: &Path) -> Result<(), String> {
    let folder = if path.is_dir() {
        path.to_path_buf()
    } else {
        path.parent()
            .map(Path::to_path_buf)
            .ok_or_else(|| "无法定位所在文件夹".to_string())?
    };
    Command::new("xdg-open")
        .arg(folder)
        .spawn()
        .map_err(|err| err.to_string())?;
    Ok(())
}
