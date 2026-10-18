use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::workspace::is_markdown_name;

/// Hard stop for pathological trees; the UI reports `truncated` instead of
/// pretending the result is complete.
const MAX_ENTRIES: usize = 50_000;
const MAX_DEPTH: usize = 32;
const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;
const MAX_PREVIEW_CHARS: usize = 160;

/// Directories that never contain documents worth searching.
const SKIP_DIRS: [&str; 9] = [
    "node_modules",
    "target",
    "dist",
    "build",
    ".git",
    ".svn",
    ".hg",
    "__pycache__",
    "vendor",
];

#[derive(Serialize)]
pub struct WalkEntry {
    pub path: String,
    pub name: String,
    pub is_dir: bool,
}

#[derive(Serialize)]
pub struct TextMatch {
    pub path: String,
    pub line: usize,
    pub text: String,
}

#[derive(Serialize)]
pub struct WorkspaceSearch {
    /// Files whose *name* matches, including files inside collapsed folders.
    pub names: Vec<WalkEntry>,
    /// Lines whose text matches, so search is not limited to what is loaded.
    pub matches: Vec<TextMatch>,
    pub truncated: bool,
}

fn preview(line: &str) -> String {
    let trimmed = line.trim();
    if trimmed.chars().count() <= MAX_PREVIEW_CHARS {
        return trimmed.to_string();
    }
    let mut out = String::new();
    for ch in trimmed.chars().take(MAX_PREVIEW_CHARS) {
        out.push(ch);
    }
    out.push('…');
    out
}

/// How a line is matched: a plain needle or a regular expression.
enum Matcher {
    Text { needle: String, case_sensitive: bool },
    Pattern(regex::Regex),
}

impl Matcher {
    fn is_match(&self, line: &str) -> bool {
        match self {
            Matcher::Text { needle, case_sensitive } => {
                if *case_sensitive {
                    line.contains(needle.as_str())
                } else {
                    line.to_lowercase().contains(needle.as_str())
                }
            }
            Matcher::Pattern(pattern) => pattern.is_match(line),
        }
    }
}

/// Build the matcher for one search. A bad pattern is reported, not ignored.
fn build_matcher(query: &str, case_sensitive: bool, regex: bool) -> Result<Matcher, String> {
    if regex {
        let pattern = if case_sensitive {
            query.to_string()
        } else {
            format!("(?i:{query})")
        };
        return regex::Regex::new(&pattern)
            .map(Matcher::Pattern)
            .map_err(|err| format!("正则表达式无效：{err}"));
    }
    Ok(Matcher::Text {
        needle: if case_sensitive {
            query.to_string()
        } else {
            query.to_lowercase()
        },
        case_sensitive,
    })
}

fn scan_file(path: &Path, matcher: &Matcher, budget: usize) -> Vec<TextMatch> {
    let mut out = Vec::new();
    let meta = match fs::metadata(path) {
        Ok(meta) => meta,
        Err(_) => return out,
    };
    if meta.len() > MAX_FILE_BYTES {
        return out;
    }
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(_) => return out,
    };
    // A NUL byte early on means this is not a text document.
    if bytes.iter().take(2048).any(|byte| *byte == 0) {
        return out;
    }
    let text = String::from_utf8_lossy(&bytes);
    for (index, line) in text.lines().enumerate() {
        if matcher.is_match(line) {
            out.push(TextMatch {
                path: path.to_string_lossy().into_owned(),
                line: index + 1,
                text: preview(line),
            });
            if out.len() >= budget {
                break;
            }
        }
    }
    out
}

/// Walk the workspace once and answer both searches.
///
/// A single traversal keeps the two result sets consistent and avoids reading
/// every file twice. The tree in the sidebar is loaded lazily, so a pure
/// front-end filter could never see files inside folders the user has not
/// expanded — which is exactly what this fixes.
#[tauri::command]
pub async fn search_workspace(
    root: String,
    query: String,
    limit: Option<usize>,
    case_sensitive: Option<bool>,
    use_regex: Option<bool>,
) -> Result<WorkspaceSearch, String> {
    // Reading thousands of files must not run on the main thread, or the window
    // stutters while the search is in flight.
    tauri::async_runtime::spawn_blocking(move || {
        search_workspace_blocking(root, query, limit, case_sensitive, use_regex)
    })
        .await
        .map_err(|err| err.to_string())?
}

fn search_workspace_blocking(
    root: String,
    query: String,
    limit: Option<usize>,
    case_sensitive: Option<bool>,
    use_regex: Option<bool>,
) -> Result<WorkspaceSearch, String> {
    let base = PathBuf::from(&root);
    let meta = fs::metadata(&base).map_err(|err| err.to_string())?;
    if !meta.is_dir() {
        return Err("路径不是文件夹".to_string());
    }
    let query = query.trim().to_string();
    if query.is_empty() {
        return Ok(WorkspaceSearch {
            names: Vec::new(),
            matches: Vec::new(),
            truncated: false,
        });
    }
    let matcher = build_matcher(&query, case_sensitive.unwrap_or(false), use_regex.unwrap_or(false))?;
    let max_hits = limit.unwrap_or(200).clamp(1, 2000);

    let mut names = Vec::new();
    let mut matches = Vec::new();
    let mut truncated = false;
    let mut visited = 0usize;
    let mut stack = vec![(base.clone(), 0usize)];

    'walk: while let Some((dir, depth)) = stack.pop() {
        if depth > MAX_DEPTH {
            continue;
        }
        let entries = match fs::read_dir(&dir) {
            Ok(entries) => entries,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            visited += 1;
            if visited > MAX_ENTRIES {
                truncated = true;
                break 'walk;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') {
                continue;
            }
            let file_type = match entry.file_type() {
                Ok(file_type) => file_type,
                Err(_) => continue,
            };
            let path = entry.path();
            if file_type.is_dir() {
                if SKIP_DIRS.contains(&name.as_str()) {
                    continue;
                }
                stack.push((path, depth + 1));
                continue;
            }
            if !is_markdown_name(&name) {
                continue;
            }
            if names.len() < max_hits && matcher.is_match(&name) {
                names.push(WalkEntry {
                    path: path.to_string_lossy().into_owned(),
                    name,
                    is_dir: false,
                });
            }
            if matches.len() < max_hits {
                matches.extend(scan_file(&path, &matcher, max_hits - matches.len()));
            }
        }
    }

    names.sort_by(|left, right| left.name.to_lowercase().cmp(&right.name.to_lowercase()));
    Ok(WorkspaceSearch {
        names,
        matches,
        truncated,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(tag: &str) -> PathBuf {
        let mut path = std::env::temp_dir();
        path.push(format!(
            "mosharp-search-{tag}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|value| value.as_nanos())
                .unwrap_or_default()
        ));
        fs::create_dir_all(&path).expect("temp root");
        path
    }

    fn write(path: &Path, text: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("parent");
        }
        fs::write(path, text).expect("write");
    }

    #[test]
    fn finds_files_inside_unexpanded_folders() {
        let root = temp_root("names");
        write(&root.join("top.md"), "# top\n");
        write(&root.join("deep/nested/note.md"), "# note\n");
        write(&root.join("node_modules/skip.md"), "# skip\n");

        let found = search_workspace_blocking(root.to_string_lossy().into_owned(), "note".into(), None, None, None)
            .expect("search");
        assert_eq!(found.names.len(), 1, "nested match found");
        assert!(found.names[0].path.ends_with("note.md"));
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn skips_ignored_folders_and_reports_matches() {
        let root = temp_root("content");
        write(&root.join("a.md"), "第一行\nNeedle 在这一行\n");
        write(&root.join("node_modules/b.md"), "Needle\n");

        let found = search_workspace_blocking(root.to_string_lossy().into_owned(), "needle".into(), None, None, None)
            .expect("search");
        assert_eq!(found.matches.len(), 1, "only the real document matches");
        assert_eq!(found.matches[0].line, 2);
        assert!(found.matches[0].text.contains("Needle"));
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn empty_query_returns_nothing() {
        let root = temp_root("empty");
        write(&root.join("a.md"), "x");
        let found = search_workspace_blocking(root.to_string_lossy().into_owned(), "   ".into(), None, None, None)
            .expect("search");
        assert!(found.names.is_empty() && found.matches.is_empty());
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn case_sensitive_search_skips_other_casings() {
        let root = temp_root("case");
        write(&root.join("a.md"), "Needle\nneedle\n");

        let loose = search_workspace_blocking(
            root.to_string_lossy().into_owned(),
            "Needle".into(),
            None,
            None,
            None,
        )
        .expect("search");
        assert_eq!(loose.matches.len(), 2, "case-insensitive by default");

        let strict = search_workspace_blocking(
            root.to_string_lossy().into_owned(),
            "Needle".into(),
            None,
            Some(true),
            None,
        )
        .expect("search");
        assert_eq!(strict.matches.len(), 1, "only the exact casing matches");
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn regex_search_matches_patterns_and_reports_bad_ones() {
        let root = temp_root("regex");
        write(&root.join("a.md"), "version 1.2.3\nversion 2.0.0\nnothing here\n");

        let found = search_workspace_blocking(
            root.to_string_lossy().into_owned(),
            "version \\d+\\.\\d+".into(),
            None,
            Some(true),
            Some(true),
        )
        .expect("search");
        assert_eq!(found.matches.len(), 2, "the pattern matches two lines");

        let bad = search_workspace_blocking(
            root.to_string_lossy().into_owned(),
            "(".into(),
            None,
            None,
            Some(true),
        );
        assert!(bad.is_err(), "an invalid pattern is reported");
        fs::remove_dir_all(&root).ok();
    }
}
