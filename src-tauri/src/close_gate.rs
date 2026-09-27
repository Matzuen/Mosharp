use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::thread;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, Runtime, State, Window, WindowEvent};

/// Tracks unsaved work so the window can close without waiting on the webview.
///
/// A JS `onCloseRequested` listener makes Rust call `prevent_close` before the
/// page runs. If CodeMirror is busy, or a native confirm dialog is awaited
/// inside that handler, the close never finishes and the process stays up.
pub struct CloseGate {
    pub unsaved: AtomicBool,
    waiting: AtomicU64,
    acked: AtomicBool,
    seq: AtomicU64,
}

impl Default for CloseGate {
    fn default() -> Self {
        Self {
            unsaved: AtomicBool::new(false),
            waiting: AtomicU64::new(0),
            acked: AtomicBool::new(false),
            seq: AtomicU64::new(1),
        }
    }
}

pub fn on_window_event<R: Runtime>(window: &Window<R>, event: &WindowEvent) {
    let WindowEvent::CloseRequested { api, .. } = event else {
        return;
    };

    let gate = window.state::<CloseGate>();
    if !gate.unsaved.load(Ordering::SeqCst) {
        return;
    }

    api.prevent_close();
    if gate.waiting.load(Ordering::SeqCst) != 0 {
        return;
    }

    let token = gate.seq.fetch_add(1, Ordering::SeqCst);
    gate.acked.store(false, Ordering::SeqCst);
    gate.waiting.store(token, Ordering::SeqCst);
    let _ = window.emit("mosharp-confirm-close", token);

    let timer_window = window.clone();
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(2000));
        let win = timer_window.clone();
        let _ = timer_window.run_on_main_thread(move || {
            let gate = win.state::<CloseGate>();
            let still_waiting = gate.waiting.load(Ordering::SeqCst) == token;
            let acked = gate.acked.load(Ordering::SeqCst);
            if still_waiting && !acked {
                gate.waiting.store(0, Ordering::SeqCst);
                let _ = win.destroy();
            }
        });
    });
}

#[tauri::command]
pub fn set_unsaved(gate: State<CloseGate>, unsaved: bool) {
    gate.unsaved.store(unsaved, Ordering::SeqCst);
}

#[tauri::command]
pub fn ack_close_prompt(gate: State<CloseGate>, token: u64) {
    if gate.waiting.load(Ordering::SeqCst) == token {
        gate.acked.store(true, Ordering::SeqCst);
    }
}

#[tauri::command]
pub fn resolve_close(app: AppHandle, gate: State<CloseGate>, token: u64, allow: bool) {
    if gate.waiting.load(Ordering::SeqCst) != token {
        return;
    }
    gate.waiting.store(0, Ordering::SeqCst);
    gate.acked.store(false, Ordering::SeqCst);
    if allow {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.destroy();
        }
    }
}
