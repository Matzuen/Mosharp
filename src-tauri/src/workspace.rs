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

/// Create an empty document. The parent folder is created when missing, so the
/// caller can offer "new file inside this folder" without extra round trips.
#[tauri::command]
pub fn create_document(path: String) -> Result<(), String> {
    let target = PathBuf::from(&path);
    if target.exists() {
        return Err("同名文件已存在".to_string());
    }
    if let Some(parent) = target.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        }
    }
    fs::write(&target, "").map_err(|err| err.to_string())
}

/// Create a folder (parents included). Refuses to reuse an existing name.
#[tauri::command]
pub fn create_folder(path: String) -> Result<(), String> {
    let target = PathBuf::from(&path);
    if target.exists() {
        return Err("同名项已存在".to_string());
    }
    fs::create_dir_all(&target).map_err(|err| err.to_string())
}

/// Rename or move an entry. Refuses to overwrite an existing path.
#[tauri::command]
pub fn rename_entry(from: String, to: String) -> Result<(), String> {
    let source = PathBuf::from(&from);
    let target = PathBuf::from(&to);
    if !source.exists() {
        return Err("路径不存在".to_string());
    }
    if target.exists() {
        return Err("目标已存在".to_string());
    }
    fs::rename(&source, &target).map_err(|err| err.to_string())
}

/// Delete a file, or a folder that is already empty. Directories are never
/// removed recursively: the UI has no undo, so a stray click must not take a
/// whole tree with it.
#[tauri::command]
pub fn delete_entry(path: String) -> Result<(), String> {
    let target = PathBuf::from(&path);
    let meta = fs::metadata(&target).map_err(|err| err.to_string())?;
    if !meta.is_dir() {
        return fs::remove_file(&target).map_err(|err| err.to_string());
    }
    let mut entries = fs::read_dir(&target).map_err(|err| err.to_string())?;
    if entries.next().is_some() {
        return Err("文件夹不为空".to_string());
    }
    fs::remove_dir(&target).map_err(|err| err.to_string())
}

pub fn is_markdown_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.ends_with(".md") || lower.ends_with(".markdown") || lower.ends_with(".txt")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(tag: &str) -> PathBuf {
        let mut path = std::env::temp_dir();
        path.push(format!(
            "mosharp-workspace-{tag}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|value| value.as_nanos())
                .unwrap_or_default()
        ));
        fs::create_dir_all(&path).expect("temp root");
        path
    }

    #[test]
    fn creates_a_document_and_refuses_duplicates() {
        let root = temp_root("create");
        let target = root.join("nested/note.md");
        create_document(target.to_string_lossy().into_owned()).expect("create");
        assert!(target.exists(), "the file exists");
        assert_eq!(fs::read_to_string(&target).expect("read"), "");
        assert!(create_document(target.to_string_lossy().into_owned()).is_err(), "duplicate refused");
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn renames_and_refuses_to_overwrite() {
        let root = temp_root("rename");
        let from = root.join("a.md");
        let to = root.join("b.md");
        fs::write(&from, "x").expect("write");
        rename_entry(
            from.to_string_lossy().into_owned(),
            to.to_string_lossy().into_owned(),
        )
        .expect("rename");
        assert!(to.exists() && !from.exists(), "moved");

        fs::write(&from, "y").expect("write");
        assert!(
            rename_entry(
                from.to_string_lossy().into_owned(),
                to.to_string_lossy().into_owned()
            )
            .is_err(),
            "an existing target is refused"
        );
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn deletes_files_but_never_a_non_empty_folder() {
        let root = temp_root("delete");
        let file = root.join("a.md");
        fs::write(&file, "x").expect("write");
        delete_entry(file.to_string_lossy().into_owned()).expect("delete file");
        assert!(!file.exists());

        let folder = root.join("dir");
        fs::create_dir_all(&folder).expect("dir");
        fs::write(folder.join("keep.md"), "x").expect("write");
        assert!(
            delete_entry(folder.to_string_lossy().into_owned()).is_err(),
            "a folder with contents is refused"
        );
        fs::remove_dir_all(&root).ok();
    }
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
