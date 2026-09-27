mod close_gate;
mod document;
mod watch;
mod workspace;

use document::{place_image, read_document, save_image, write_document};
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
        .manage(close_gate::CloseGate::default())
        .on_window_event(close_gate::on_window_event)
        .invoke_handler(tauri::generate_handler![
            read_document,
            write_document,
            save_image,
            place_image,
            list_directory,
            reveal_in_folder,
            sync_file_watches,
            suppress_file_watch,
            touch_file_watch_baseline,
            save_recovery_copy,
            close_gate::set_unsaved,
            close_gate::ack_close_prompt,
            close_gate::resolve_close
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
