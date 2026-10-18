use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

const POLL_MS: u64 = 350;
const STABLE_GAP_MS: u64 = 60;
const STABLE_ROUNDS: u32 = 2;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentChangedPayload {
    pub path: String,
    pub kind: String,
}

#[derive(Clone)]
struct TrackedFile {
    /// Path as the frontend knows it (for matching tabs).
    display_path: String,
    /// Absolute path used for filesystem reads.
    abs_path: PathBuf,
    last_mtime_ms: u64,
    last_len: u64,
    missing: bool,
}

#[derive(Default)]
pub struct FileWatchState {
    poll_started: AtomicBool,
    suppress_until: Mutex<HashMap<String, Instant>>,
    tracked: Mutex<HashMap<String, TrackedFile>>,
}

fn normalize_key(path: &str) -> String {
    let mut value = path.replace('\\', "/");
    if let Some(stripped) = value.strip_prefix("//?/") {
        value = stripped.to_string();
    }
    if let Some(stripped) = value.strip_prefix("//./") {
        value = stripped.to_string();
    }
    value.to_lowercase()
}

fn strip_long_path(path: PathBuf) -> PathBuf {
    let text = path.to_string_lossy();
    if let Some(rest) = text.strip_prefix(r"\\?\") {
        return PathBuf::from(rest);
    }
    if let Some(rest) = text.strip_prefix("//?/") {
        return PathBuf::from(rest);
    }
    path
}

fn canonical_or(path: &Path) -> PathBuf {
    strip_long_path(fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf()))
}

fn file_signature(path: &Path) -> Option<(u64, u64)> {
    let meta = fs::metadata(path).ok()?;
    if !meta.is_file() {
        return None;
    }
    let len = meta.len();
    let mtime_ms = meta
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0);
    Some((mtime_ms, len))
}

fn wait_until_stable(path: &Path) -> Option<(u64, u64)> {
    let mut last = None;
    for _ in 0..STABLE_ROUNDS {
        let Some(sig) = file_signature(path) else {
            return None;
        };
        if last == Some(sig) {
            return Some(sig);
        }
        last = Some(sig);
        thread::sleep(Duration::from_millis(STABLE_GAP_MS));
    }
    let sig = file_signature(path)?;
    if last == Some(sig) {
        Some(sig)
    } else {
        // Content may still be flushing; accept the latest snapshot once.
        Some(sig)
    }
}

impl FileWatchState {
    pub fn suppress(&self, path: &str, ms: u64) {
        if let Ok(mut map) = self.suppress_until.lock() {
            map.insert(
                normalize_key(path),
                Instant::now() + Duration::from_millis(ms),
            );
        }
    }

    fn is_suppressed(&self, path: &str) -> bool {
        let key = normalize_key(path);
        let Ok(mut map) = self.suppress_until.lock() else {
            return false;
        };
        match map.get(&key) {
            Some(until) if *until > Instant::now() => true,
            Some(_) => {
                map.remove(&key);
                false
            }
            None => false,
        }
    }
}

fn start_poller(app: AppHandle) {
    thread::spawn(move || loop {
        thread::sleep(Duration::from_millis(POLL_MS));
        let Some(state) = app.try_state::<FileWatchState>() else {
            break;
        };

        let snapshot: Vec<TrackedFile> = {
            let Ok(tracked) = state.tracked.lock() else {
                continue;
            };
            tracked.values().cloned().collect()
        };

        for item in snapshot {
            if state.is_suppressed(&item.display_path) || state.is_suppressed(&item.abs_path.to_string_lossy())
            {
                continue;
            }

            match file_signature(&item.abs_path) {
                None => {
                    if !item.missing {
                        if let Ok(mut tracked) = state.tracked.lock() {
                            if let Some(entry) = tracked.get_mut(&normalize_key(&item.display_path)) {
                                entry.missing = true;
                            }
                        }
                        let _ = app.emit(
                            "document-changed",
                            DocumentChangedPayload {
                                path: item.display_path.clone(),
                                kind: "remove".into(),
                            },
                        );
                    }
                }
                Some((mtime_ms, len)) => {
                    let changed = item.missing || mtime_ms != item.last_mtime_ms || len != item.last_len;
                    if !changed {
                        continue;
                    }

                    // Atomic saves often rewrite via temp+rename. Wait until
                    // mtime/size stop moving before telling the editor to reload.
                    let Some((stable_mtime, stable_len)) = wait_until_stable(&item.abs_path) else {
                        continue;
                    };
                    if state.is_suppressed(&item.display_path) {
                        continue;
                    }

                    if let Ok(mut tracked) = state.tracked.lock() {
                        if let Some(entry) = tracked.get_mut(&normalize_key(&item.display_path)) {
                            // Another save may have landed while we waited.
                            if entry.last_mtime_ms == stable_mtime
                                && entry.last_len == stable_len
                                && !entry.missing
                            {
                                continue;
                            }
                            entry.last_mtime_ms = stable_mtime;
                            entry.last_len = stable_len;
                            entry.missing = false;
                        }
                    }

                    let _ = app.emit(
                        "document-changed",
                        DocumentChangedPayload {
                            path: item.display_path,
                            kind: if item.missing { "create".into() } else { "modify".into() },
                        },
                    );
                }
            }
        }
    });
}

#[tauri::command]
pub fn sync_file_watches(
    app: AppHandle,
    state: State<'_, FileWatchState>,
    paths: Vec<String>,
) -> Result<(), String> {
    let mut next = HashMap::new();
    for display_path in paths {
        let trimmed = display_path.trim();
        if trimmed.is_empty() {
            continue;
        }
        let key = normalize_key(trimmed);
        let abs_path = canonical_or(Path::new(trimmed));
        let (mtime_ms, len, missing) = match file_signature(&abs_path) {
            Some((mtime_ms, len)) => (mtime_ms, len, false),
            None => (0, 0, true),
        };
        next.insert(
            key,
            TrackedFile {
                display_path: trimmed.to_string(),
                abs_path,
                last_mtime_ms: mtime_ms,
                last_len: len,
                missing,
            },
        );
    }

    *state.tracked.lock().map_err(|err| err.to_string())? = next;

    if state
        .poll_started
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_ok()
    {
        start_poller(app);
    }
    Ok(())
}

#[tauri::command]
pub fn suppress_file_watch(
    state: State<'_, FileWatchState>,
    path: String,
    ms: Option<u64>,
) -> Result<(), String> {
    state.suppress(&path, ms.unwrap_or(1200));
    // Also refresh the tracked signature so our own save does not look external.
    if let Ok(mut tracked) = state.tracked.lock() {
        let key = normalize_key(&path);
        if let Some(entry) = tracked.get_mut(&key) {
            if let Some((mtime_ms, len)) = file_signature(&entry.abs_path) {
                entry.last_mtime_ms = mtime_ms;
                entry.last_len = len;
                entry.missing = false;
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn touch_file_watch_baseline(
    state: State<'_, FileWatchState>,
    path: String,
) -> Result<(), String> {
    let key = normalize_key(&path);
    let abs = canonical_or(Path::new(&path));
    if let Ok(mut tracked) = state.tracked.lock() {
        if let Some(entry) = tracked.get_mut(&key) {
            if let Some((mtime_ms, len)) = file_signature(&abs) {
                entry.abs_path = abs;
                entry.last_mtime_ms = mtime_ms;
                entry.last_len = len;
                entry.missing = false;
            }
        }
    }
    Ok(())
}

/// Keep the file name recognisable in the recovery folder.
///
/// Unicode letters are allowed through so a Chinese or Japanese name stays
/// readable; everything that could change the path (separators, dots, colons)
/// becomes an underscore.
fn safe_stem(name: &str) -> String {
    let stem = Path::new(name)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("untitled");
    let cleaned: String = stem
        .chars()
        .map(|ch| {
            if ch.is_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect();
    if cleaned.trim_matches('_').is_empty() {
        "untitled".to_string()
    } else {
        cleaned
    }
}

#[tauri::command]
pub fn save_recovery_copy(suggested_name: String, content: String) -> Result<String, String> {
    let dir = recovery_dir()?;

    let safe = safe_stem(&suggested_name);
    // Millisecond stamp plus a create-exclusive retry: several tabs can be
    // discarded in the same second and every copy must survive on its own.
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis())
        .unwrap_or(0);
    let mut attempt: u32 = 0;
    loop {
        let name = if attempt == 0 {
            format!("{stamp}-{safe}.md")
        } else {
            format!("{stamp}-{safe}-{attempt}.md")
        };
        let path = dir.join(name);
        match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
        {
            Ok(mut file) => {
                use std::io::Write;
                file.write_all(content.as_bytes())
                    .map_err(|err| err.to_string())?;
                return Ok(path.to_string_lossy().into_owned());
            }
            Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists && attempt < 1000 => {
                attempt += 1;
            }
            Err(err) => return Err(err.to_string()),
        }
    }
}

fn recovery_dir() -> Result<PathBuf, String> {
    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .ok_or_else(|| "找不到用户目录".to_string())?;
    let dir = PathBuf::from(home).join(".mosharp").join("recovered");
    fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    Ok(dir)
}

/// One recovery copy, as listed for the restore dialog.
#[derive(serde::Serialize)]
pub struct RecoveryEntry {
    pub path: String,
    pub name: String,
    pub size: u64,
    /// Milliseconds since the epoch; 0 when the timestamp is unavailable.
    pub modified: u64,
}

#[tauri::command]
pub fn list_recovery_copies() -> Result<Vec<RecoveryEntry>, String> {
    let dir = recovery_dir()?;
    let mut entries = Vec::new();
    let read = match fs::read_dir(&dir) {
        Ok(read) => read,
        // A missing folder just means nothing was ever recovered.
        Err(_) => return Ok(entries),
    };
    for item in read.flatten() {
        let path = item.path();
        if !path.is_file() {
            continue;
        }
        let metadata = match item.metadata() {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };
        let modified = metadata
            .modified()
            .ok()
            .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
            .map(|value| value.as_millis() as u64)
            .unwrap_or(0);
        entries.push(RecoveryEntry {
            path: path.to_string_lossy().into_owned(),
            name: path
                .file_name()
                .map(|value| value.to_string_lossy().into_owned())
                .unwrap_or_default(),
            size: metadata.len(),
            modified,
        });
    }
    // Newest first: the copy you want is usually the one just written.
    entries.sort_by(|left, right| right.modified.cmp(&left.modified));
    Ok(entries)
}

/// Delete one recovery copy. Paths outside the recovery folder are refused.
#[tauri::command]
pub fn delete_recovery_copy(path: String) -> Result<(), String> {
    let dir = recovery_dir()?;
    let candidate = PathBuf::from(&path);
    let parent = candidate
        .parent()
        .ok_or_else(|| "无效的路径".to_string())?;
    // Compare canonical forms so `..` cannot escape the folder.
    let parent = parent.canonicalize().map_err(|err| err.to_string())?;
    let root = dir.canonicalize().map_err(|err| err.to_string())?;
    if parent != root {
        return Err("只能删除恢复目录里的副本".to_string());
    }
    if !candidate.is_file() {
        return Err("该副本已不存在".to_string());
    }
    fs::remove_file(&candidate).map_err(|err| err.to_string())
}

/// Path of the recovery folder, created on demand so the UI can reveal it.
#[tauri::command]
pub fn recovery_folder() -> Result<String, String> {
    recovery_dir().map(|dir| dir.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::safe_stem;

    #[test]
    fn keeps_readable_names() {
        assert_eq!(safe_stem("笔记.md"), "笔记");
        assert_eq!(safe_stem("daily-note.md"), "daily-note");
        assert_eq!(safe_stem("未命名"), "未命名");
    }

    #[test]
    fn strips_path_separators_and_spaces() {
        // `Path::file_stem` already drops directories, so only the remaining
        // characters need cleaning.
        assert_eq!(safe_stem("../etc/passwd.md"), "passwd");
        assert_eq!(safe_stem("a b.md"), "a_b");
        assert_eq!(safe_stem("笔记 2024.md"), "笔记_2024");
    }
}
