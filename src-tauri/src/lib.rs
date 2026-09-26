mod document;
mod watch;
mod workspace;

use document::{read_document, write_document};
use watch::{
    save_recovery_copy, suppress_file_watch, sync_file_watches, touch_file_watch_baseline,
    FileWatchState,
};
use workspace::{list_directory, reveal_in_folder};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(FileWatchState::default())
        .invoke_handler(tauri::generate_handler![
            read_document,
            write_document,
            list_directory,
            reveal_in_folder,
            sync_file_watches,
            suppress_file_watch,
            touch_file_watch_baseline,
            save_recovery_copy
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
