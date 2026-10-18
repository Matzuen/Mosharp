mod close_gate;
mod document;
mod export_pdf;
mod search;
mod startup;
mod watch;
mod workspace;

use document::{
    place_image, read_document, read_image_data_uri, save_image, write_bytes, write_document,
};
use search::search_workspace;
use startup::{markdown_args, take_startup_files, StartupFiles};
use tauri::{Emitter, Manager};
use watch::{
    delete_recovery_copy, list_recovery_copies, recovery_folder, save_recovery_copy, suppress_file_watch,
    sync_file_watches,
    touch_file_watch_baseline, FileWatchState,
};
use workspace::{
    create_document, create_folder, delete_entry, list_directory, rename_entry, reveal_in_folder,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let initial_files = markdown_args(&std::env::args().collect::<Vec<_>>());

    tauri::Builder::default()
        // Registered first: it must intercept a second launch before anything else.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // A second launch is normally "open this file in the running window".
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
            let files = markdown_args(&argv);
            if !files.is_empty() {
                let _ = app.emit("mosharp-open-files", files);
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(FileWatchState::default())
        .manage(close_gate::CloseGate::default())
        .manage(StartupFiles::new(initial_files))
        .on_window_event(close_gate::on_window_event)
        .invoke_handler(tauri::generate_handler![
            read_document,
            write_document,
            write_bytes,
            read_image_data_uri,
            export_pdf::print_pdf,
            save_image,
            place_image,
            list_directory,
            reveal_in_folder,
            create_document,
            create_folder,
            rename_entry,
            delete_entry,
            search_workspace,
            sync_file_watches,
            suppress_file_watch,
            touch_file_watch_baseline,
            save_recovery_copy,
            list_recovery_copies,
            delete_recovery_copy,
            recovery_folder,
            take_startup_files,
            close_gate::set_unsaved,
            close_gate::ack_close_prompt,
            close_gate::resolve_close
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
