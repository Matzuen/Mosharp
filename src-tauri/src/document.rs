use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use serde::Serialize;

const MAX_BYTES: u64 = 64 * 1024 * 1024;
static TEMP_NONCE: AtomicU64 = AtomicU64::new(0);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedDocument {
    pub path: String,
    pub content: String,
    pub mtime_ms: u64,
}

fn map_io_error(err: std::io::Error, action: &str, path: &Path) -> String {
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("文件");
    #[cfg(windows)]
    {
        match err.raw_os_error() {
            Some(32) | Some(33) | Some(1224) => {
                return format!("无法{action}「{name}」：文件正被其他程序占用");
            }
            Some(5) => return format!("无法{action}「{name}」：没有写入权限"),
            Some(3) => return format!("无法{action}「{name}」：找不到路径"),
            _ => {}
        }
    }
    format!("无法{action}「{name}」：{err}")
}

fn file_mtime_ms(path: &Path) -> u64 {
    fs::metadata(path)
        .and_then(|meta| meta.modified())
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

#[tauri::command]
pub fn read_document(path: String) -> Result<OpenedDocument, String> {
    let target = PathBuf::from(&path);
    let meta = fs::metadata(&target).map_err(|err| map_io_error(err, "打开", &target))?;
    if !meta.is_file() {
        return Err("只能打开文件".to_string());
    }
    if meta.len() > MAX_BYTES {
        return Err(format!("文件有 {} 字节，超过 64MB 上限", meta.len()));
    }
    let content = fs::read_to_string(&target).map_err(|err| {
        if err.kind() == std::io::ErrorKind::InvalidData {
            "文件不是 UTF-8 文本".to_string()
        } else {
            map_io_error(err, "打开", &target)
        }
    })?;
    Ok(OpenedDocument {
        path,
        content,
        mtime_ms: file_mtime_ms(&target),
    })
}

#[tauri::command]
pub fn write_document(path: String, content: String) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("没有保存路径".to_string());
    }
    let target = PathBuf::from(&path);
    if let Some(parent) = target.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|err| map_io_error(err, "保存", &target))?;
        }
    }

    let file_name = target
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "文件名无效".to_string())?;
    let parent = match target.parent() {
        Some(parent) if !parent.as_os_str().is_empty() => parent.to_path_buf(),
        _ => PathBuf::from("."),
    };
    let temp = parent.join(format!(
        ".{file_name}.{}.{}.mosharp-tmp",
        std::process::id(),
        TEMP_NONCE.fetch_add(1, Ordering::Relaxed)
    ));

    let write_result = (|| -> Result<(), String> {
        let mut file =
            File::create(&temp).map_err(|err| map_io_error(err, "保存", &target))?;
        file.write_all(content.as_bytes())
            .map_err(|err| map_io_error(err, "保存", &target))?;
        file.sync_all()
            .map_err(|err| map_io_error(err, "保存", &target))?;
        rename_replace(&temp, &target).map_err(|err| map_io_error(err, "保存", &target))
    })();

    if write_result.is_err() && temp.exists() {
        let _ = fs::remove_file(&temp);
    }
    write_result
}

#[cfg(windows)]
fn rename_replace(from: &Path, to: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    fn wide(path: &Path) -> Vec<u16> {
        path.as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    let from_wide = wide(from);
    let to_wide = wide(to);
    let ok = unsafe {
        MoveFileExW(
            from_wide.as_ptr(),
            to_wide.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if ok == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn rename_replace(from: &Path, to: &Path) -> std::io::Result<()> {
    fs::rename(from, to)
}

#[cfg(test)]
mod tests {
    use super::{read_document, write_document};

    #[test]
    fn atomic_overwrite_roundtrip() {
        let dir = std::env::temp_dir().join(format!("mosharp-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("note.md");
        let path_str = path.to_string_lossy().into_owned();

        write_document(path_str.clone(), "第一版\n".to_string()).unwrap();
        write_document(path_str.clone(), "第二版\n".to_string()).unwrap();
        let opened = read_document(path_str).unwrap();
        assert_eq!(opened.content, "第二版\n");

        let leftover = std::fs::read_dir(&dir).unwrap().any(|entry| {
            entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .contains("mosharp-tmp")
        });
        assert!(!leftover);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
