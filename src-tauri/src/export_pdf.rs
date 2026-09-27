use std::time::Duration;

use tauri::webview::WebviewWindow;
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2_7, ICoreWebView2Environment6,
};
use webview2_com::PrintToPdfCompletedHandler;
use windows::core::{Interface, PCWSTR};

fn wide_path(path: &str) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    std::ffi::OsStr::new(path)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

/// Print the current page to a PDF. Margins are zero so the page background
/// painted by CSS fills the sheet, including the margin band.
#[tauri::command]
pub async fn print_pdf(
    window: WebviewWindow,
    path: String,
    page_width: f64,
    page_height: f64,
) -> Result<(), String> {
    if let Some(parent) = std::path::Path::new(&path).parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        }
    }

    let (tx, rx) = std::sync::mpsc::channel();
    window
        .with_webview(move |webview| {
            let started = (|| -> Result<(), String> {
                unsafe {
                    let environment: ICoreWebView2Environment6 = webview
                        .environment()
                        .cast()
                        .map_err(|err| err.to_string())?;
                    let core = webview.controller().CoreWebView2().map_err(|err| err.to_string())?;
                    let printer: ICoreWebView2_7 = core.cast().map_err(|err| err.to_string())?;
                    let settings = environment.CreatePrintSettings().map_err(|err| err.to_string())?;
                    settings
                        .SetShouldPrintBackgrounds(true)
                        .map_err(|err| err.to_string())?;
                    settings.SetMarginTop(0.0).map_err(|err| err.to_string())?;
                    settings.SetMarginBottom(0.0).map_err(|err| err.to_string())?;
                    settings.SetMarginLeft(0.0).map_err(|err| err.to_string())?;
                    settings.SetMarginRight(0.0).map_err(|err| err.to_string())?;
                    settings
                        .SetPageWidth(page_width)
                        .map_err(|err| err.to_string())?;
                    settings
                        .SetPageHeight(page_height)
                        .map_err(|err| err.to_string())?;
                    let wide = wide_path(&path);
                    let tx_done = tx.clone();
                    let handler = PrintToPdfCompletedHandler::create(Box::new(move |result, ok| {
                        let _ = tx_done.send(if result.is_ok() && ok {
                            Ok(())
                        } else {
                            Err("无法写入 PDF".to_string())
                        });
                        Ok(())
                    }));
                    printer
                        .PrintToPdf(PCWSTR(wide.as_ptr()), &settings, &handler)
                        .map_err(|err| err.to_string())?;
                    Ok(())
                }
            })();
            if let Err(err) = started {
                let _ = tx.send(Err(err));
            }
        })
        .map_err(|err| err.to_string())?;

    rx.recv_timeout(Duration::from_secs(90))
        .map_err(|_| "导出 PDF 超时".to_string())?
}
