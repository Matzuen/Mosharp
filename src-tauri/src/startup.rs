use std::sync::Mutex;

/// Documents handed to this launch on the command line (Explorer double-click /
/// file association), consumed exactly once by the frontend.
#[derive(Default)]
pub struct StartupFiles(Mutex<Vec<String>>);

impl StartupFiles {
    pub fn new(files: Vec<String>) -> Self {
        Self(Mutex::new(files))
    }
}

/// Extract the document paths from a process argument list.
///
/// Windows passes the double-clicked file as a plain argument, so anything that
/// is not a flag and ends in a Markdown extension counts as a document.
pub fn markdown_args(args: &[String]) -> Vec<String> {
    args.iter()
        .skip(1)
        .filter(|arg| !arg.starts_with('-'))
        .filter(|arg| {
            let lower = arg.to_ascii_lowercase();
            if !(lower.ends_with(".md") || lower.ends_with(".markdown") || lower.ends_with(".txt")) {
                return false;
            }
            std::path::Path::new(arg).is_file()
        })
        .cloned()
        .collect()
}

/// Hand the startup documents to the UI. Draining keeps a re-render from
/// reopening them.
#[tauri::command]
pub fn take_startup_files(state: tauri::State<'_, StartupFiles>) -> Vec<String> {
    state
        .0
        .lock()
        .map(|mut files| std::mem::take(&mut *files))
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::markdown_args;
    use std::fs;

    fn fixture(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("mosharp-args-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join(name);
        fs::write(&path, "x").unwrap();
        path
    }

    #[test]
    fn picks_the_double_clicked_document() {
        let md = fixture("note.md").to_string_lossy().into_owned();
        let args = vec!["mosharp.exe".to_string(), md.clone()];
        assert_eq!(markdown_args(&args), vec![md]);
    }

    #[test]
    fn skips_the_executable_path_itself() {
        let exe = "C:\\Apps\\mosharp.exe".to_string();
        assert!(markdown_args(&[exe]).is_empty());
    }

    #[test]
    fn ignores_flags_and_other_files() {
        let md = fixture("doc.markdown").to_string_lossy().into_owned();
        let png = fixture("shot.png").to_string_lossy().into_owned();
        let args = vec![
            "mosharp.exe".to_string(),
            "--enable-logging".to_string(),
            png,
            md.clone(),
        ];
        assert_eq!(markdown_args(&args), vec![md]);
    }

    #[test]
    fn ignores_paths_that_do_not_exist() {
        let missing = std::env::temp_dir()
            .join("mosharp-does-not-exist-12345.md")
            .to_string_lossy()
            .into_owned();
        assert!(markdown_args(&["mosharp.exe".to_string(), missing]).is_empty());
    }

    #[test]
    fn keeps_several_documents() {
        let a = fixture("a.md").to_string_lossy().into_owned();
        let b = fixture("b.txt").to_string_lossy().into_owned();
        let args = vec!["mosharp.exe".to_string(), a.clone(), b.clone()];
        assert_eq!(markdown_args(&args), vec![a, b]);
    }
}
