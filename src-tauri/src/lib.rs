use std::fs;
use std::path::PathBuf;
use tauri::Manager;

pub mod commands;
pub mod error;
pub mod callback_server;

use commands::auth::{start_auth_flow, get_accounts, add_account, remove_account, switch_active_for_account};
use commands::logger::log_message;
use commands::gmail::{list_messages, get_message_details, list_labels, send_email, modify_labels};

const STATE_FILE: &str = "window-state.json";

fn get_state_path(app_handle: &tauri::AppHandle) -> PathBuf {
    app_handle.path().app_config_dir().unwrap().join(STATE_FILE)
}

fn load_window_state_from_disk(app_handle: &tauri::AppHandle) -> Option<(u32, u32, i32, i32, bool)> {
    let path = get_state_path(app_handle);
    let content = fs::read_to_string(&path).ok()?;
    let obj: serde_json::Value = serde_json::from_str(&content).ok()?;
    let w = obj.get("width")?.as_u64()? as u32;
    let h = obj.get("height")?.as_u64()? as u32;
    let x = obj.get("x")?.as_i64()? as i32;
    let y = obj.get("y")?.as_i64()? as i32;
    let maximized = obj.get("maximized")?.as_bool()?;
    println!("[state] restoring: w={} h={} x={} y={} maximized={}", w, h, x, y, maximized);
    Some((w, h, x, y, maximized))
}

fn save_window_state_to_disk(app_handle: &tauri::AppHandle, width: u32, height: u32, x: i32, y: i32, maximized: bool) {
    let path = get_state_path(app_handle);
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let json = serde_json::json!({
        "width": width,
        "height": height,
        "x": x,
        "y": y,
        "maximized": maximized
    });
    let _ = fs::write(&path, serde_json::to_string_pretty(&json).unwrap_or_default());
    println!("[state] saved: w={} h={} x={} y={} maximized={}", width, height, x, y, maximized);
}

#[tauri::command]
fn load_window_state(app: tauri::AppHandle) -> Option<serde_json::Value> {
    let path = get_state_path(&app);
    let content = std::fs::read_to_string(&path).ok()?;
    serde_json::from_str(&content).ok()
}

#[tauri::command]
fn save_window_state_cmd(app: tauri::AppHandle, width: u32, height: u32, x: i32, y: i32, maximized: bool) {
    println!("[state] save_cmd: w={} h={} x={} y={} maximized={}", width, height, x, y, maximized);
    save_window_state_to_disk(&app, width, height, x, y, maximized);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_handle = app.handle().clone();
            println!("[state] setup: starting window state restore");

            let (width, height, win_x, win_y, maximized) = load_window_state_from_disk(&app_handle)
                .unwrap_or((1200, 800, 0, 0, false));

            // Sanity check: if saved size exceeds reasonable bounds, use defaults
            let (width, height) = if width > 10000 || height > 10000 {
                println!("[state] sanity check failed: w={} h={} > 10000, using defaults (1200x800)", width, height);
                (1200, 800)
            } else {
                (width, height)
            };

            if let Some(win) = app_handle.get_webview_window("main") {
                // Restore size (physical pixels, same as saved)
                let _ = win.set_size(tauri::Size::Physical(tauri::PhysicalSize::new(width, height)));
                // Restore position (physical pixels, same as saved)
                if !maximized && (win_x != 0 || win_y != 0) {
                    let _ = win.set_position(
                        tauri::Position::Physical(
                            tauri::PhysicalPosition::new(win_x, win_y)
                        )
                    );
                }
                // Restore maximized state
                if maximized {
                    let _ = win.maximize();
                }

                // Do NOT call win.show() here — the webview hasn't rendered yet,
                // which causes a white flash. Instead we spawn a short delay to let
                // the webview load its content before showing.
                //
                // Note: on_page_load is only available on WebviewWindowBuilder (build-time),
                // not on the already-created WebviewWindow instance. A delay-based approach
                // is the pragmatic solution for Tauri 2 with visible:false windows.
                let show_win = win.clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                    println!("[state] showing window after load delay");
                    let _ = show_win.show();
                });

                // Save state on close and exit
                let save_handle = app_handle.clone();
                let close_win = win.clone();
                win.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { .. } = event {
                        let h = save_handle.clone();
                        let w = close_win.clone();
                        let (width, height) = match w.inner_size() {
                            Ok(s) => (s.width as u32, s.height as u32),
                            Err(_) => (1200, 800),
                        };
                        let (x, y) = match w.outer_position() {
                            Ok(p) => (p.x as i32, p.y as i32),
                            Err(_) => (-1, -1),
                        };
                        let is_max = w.is_maximized().unwrap_or(false);
                        eprintln!("[state] close: w={} h={} x={} y={} maximized={}", width, height, x, y, is_max);
                        save_window_state_to_disk(&h, width, height, x, y, is_max);
                        h.exit(0);
                    }
                });
            }

            // Note: Callback server is now started on-demand in start_auth_flow.
            // Boot-time start removed to minimize port exposure time.

            // Periodic cleanup of expired PKCE verifiers
            tauri::async_runtime::spawn(async {
                let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(60));
                interval.tick().await;
                loop {
                    interval.tick().await;
                    commands::auth::cleanup_expired_verifiers();
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_window_state,
            save_window_state_cmd,
            get_accounts,
            start_auth_flow,
            add_account,
            remove_account,
            switch_active_for_account,
            list_messages,
            get_message_details,
            list_labels,
            send_email,
            modify_labels,
            log_message
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
