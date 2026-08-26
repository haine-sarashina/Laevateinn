use std::fs;
use std::path::PathBuf;
use tauri::Manager;

pub mod commands;

use commands::webview_manager::{switch_account_webview, hide_all_webviews, start_unread_server, spawn_background_webviews};

const STATE_FILE: &str = "window-state.json";

fn get_state_path(app_handle: &tauri::AppHandle) -> PathBuf {
    app_handle.path().app_config_dir().unwrap().join(STATE_FILE)
}

fn load_window_state_from_disk(
    app_handle: &tauri::AppHandle,
) -> Option<(u32, u32, i32, i32, bool)> {
    let path = get_state_path(app_handle);
    let content = fs::read_to_string(&path).ok()?;
    let obj: serde_json::Value = serde_json::from_str(&content).ok()?;
    let w = obj.get("width")?.as_u64()? as u32;
    let h = obj.get("height")?.as_u64()? as u32;
    let x = obj.get("x")?.as_i64()? as i32;
    let y = obj.get("y")?.as_i64()? as i32;
    let maximized = obj.get("maximized")?.as_bool()?;
    Some((w, h, x, y, maximized))
}

fn save_window_state_to_disk(
    app_handle: &tauri::AppHandle,
    width: u32,
    height: u32,
    x: i32,
    y: i32,
    maximized: bool,
) {
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
    let _ = fs::write(
        &path,
        serde_json::to_string_pretty(&json).unwrap_or_default(),
    );
}

#[tauri::command]
fn load_window_state(app: tauri::AppHandle) -> Option<serde_json::Value> {
    let path = get_state_path(&app);
    let content = std::fs::read_to_string(&path).ok()?;
    serde_json::from_str(&content).ok()
}

#[tauri::command]
fn save_window_state_cmd(
    app: tauri::AppHandle,
    width: u32,
    height: u32,
    x: i32,
    y: i32,
    maximized: bool,
) {
    save_window_state_to_disk(&app, width, height, x, y, maximized);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let app_handle = app.handle().clone();

            start_unread_server(app_handle.clone());

            let (width, height, win_x, win_y, maximized) =
                load_window_state_from_disk(&app_handle).unwrap_or((1200, 800, 0, 0, false));

            let (width, height) = if width > 10000 || height > 10000 {
                (1200, 800)
            } else {
                (width, height)
            };

            if let Some(win) = app_handle.get_webview_window("main") {
                let version = app_handle.package_info().version.to_string();
                let _ = win.set_title(&format!("Laevateinn v{}", version));
                
                let _ = win.set_size(tauri::Size::Physical(tauri::PhysicalSize::new(
                    width, height,
                )));
                if !maximized && (win_x != 0 || win_y != 0) {
                    let _ = win.set_position(tauri::Position::Physical(
                        tauri::PhysicalPosition::new(win_x, win_y),
                    ));
                }
                if maximized {
                    let _ = win.maximize();
                }

                let show_win = win.clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                    let _ = show_win.show();
                });

                let save_handle = app_handle.clone();
                let close_win = win.clone();
                let resize_win = win.clone();

                win.on_window_event(move |event| {
                    match event {
                        tauri::WindowEvent::CloseRequested { .. } => {
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
                            save_window_state_to_disk(&h, width, height, x, y, is_max);
                            h.exit(0);
                        },
                        tauri::WindowEvent::Resized(size) => {
                            // Resize all child webviews to match the new size minus sidebar
                            let scale_factor = resize_win.scale_factor().unwrap_or(1.0);
                            let sidebar_width = 64.0;
                            let width = (size.width as f64) / scale_factor - sidebar_width;
                            let height = (size.height as f64) / scale_factor;
                            
                            if width > 0.0 && height > 0.0 {
                                let logical_size = tauri::LogicalSize::new(width, height);
                                let logical_pos = tauri::LogicalPosition::new(sidebar_width, 0.0);
                                
                                for (label, webview) in save_handle.webviews() {
                                    if label.starts_with("acc_") {
                                        let _ = webview.set_size(tauri::Size::Logical(logical_size));
                                        let _ = webview.set_position(tauri::Position::Logical(logical_pos));
                                    }
                                }
                            }
                        },
                        _ => {}
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_window_state,
            save_window_state_cmd,
            switch_account_webview,
            hide_all_webviews,
            spawn_background_webviews
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
