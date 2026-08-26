use tauri::{Manager, WebviewBuilder, WebviewUrl};
use std::io::{Read, Write};

pub fn start_unread_server(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        if let Ok(listener) = std::net::TcpListener::bind("127.0.0.1:14205") {
            for stream in listener.incoming() {
                if let Ok(mut stream) = stream {
                    let mut buf = [0; 1024];
                    if let Ok(size) = stream.read(&mut buf) {
                        let req = String::from_utf8_lossy(&buf[..size]);
                        if req.starts_with("GET /update?") {
                            let parts: Vec<&str> = req.split(' ').collect();
                            if parts.len() > 1 {
                                let path = parts[1];
                                let mut acc = String::new();
                                let mut count = 0;
                                
                                if let Some(query) = path.split('?').nth(1) {
                                    for param in query.split('&') {
                                        let kv: Vec<&str> = param.split('=').collect();
                                        if kv.len() == 2 {
                                            if kv[0] == "acc" {
                                                acc = kv[1].to_string();
                                            } else if kv[0] == "count" {
                                                count = kv[1].parse().unwrap_or(0);
                                            }
                                        }
                                    }
                                }
                                
                                if !acc.is_empty() {
                                    use tauri::Emitter;
                                    #[derive(serde::Serialize, Clone)]
                                    struct UnreadPayload {
                                        account_id: String,
                                        count: u32,
                                    }
                                    let _ = app.emit("unread_update", UnreadPayload {
                                        account_id: acc,
                                        count
                                    });
                                }
                            }
                        }
                    }
                    let response = "HTTP/1.1 200 OK\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\nOK";
                    let _ = stream.write(response.as_bytes());
                }
            }
        }
    });
}

#[tauri::command]
pub async fn hide_all_webviews(app: tauri::AppHandle) -> Result<(), String> {
    for (label, webview) in app.webviews() {
        if label.starts_with("acc_") {
            let _ = webview.hide();
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn switch_account_webview(app: tauri::AppHandle, account_id: String) -> Result<(), String> {
    let main_window = app.get_window("main").ok_or("Main window not found")?;
    
    // Hide all existing webviews that are accounts (start with acc_)
    for (label, webview) in app.webviews() {
        if label.starts_with("acc_") {
            if label == account_id {
                let _ = webview.show();
            } else {
                let _ = webview.hide();
            }
        }
    }

    // Check if the target webview already exists
    if app.get_webview(&account_id).is_none() {
        let profile_dir = app.path().app_data_dir().unwrap_or_default().join("profiles").join(&account_id);
        
        let window_size = main_window.inner_size().unwrap_or_default();
        let scale_factor = main_window.scale_factor().unwrap_or(1.0);
        
        // Calculate the position and size. The sidebar is 64px wide.
        let sidebar_width = 64.0;
        let width = (window_size.width as f64) / scale_factor - sidebar_width;
        let height = (window_size.height as f64) / scale_factor;
        
        let init_script = format!(r#"
            if (window === window.top) {{
                setInterval(() => {{
                    let title = document.title;
                    // Only update if we are reasonably sure it's the main window title
                    if (title.includes("Gmail") || title.includes("Google")) {{
                        let match = title.match(/\((\d+)\)/);
                        let count = match ? match[1] : '0';
                        fetch("http://127.0.0.1:14205/update?acc={}&count=" + count).catch(() => {{}});
                    }}
                }}, 3000);
            }}
        "#, account_id);

        let builder = WebviewBuilder::new(&account_id, WebviewUrl::External("https://mail.google.com/".parse().unwrap()))
            .data_directory(profile_dir)
            .transparent(true)
            .incognito(false)
            .initialization_script(&init_script);
            
        let child = main_window.add_child(
            builder,
            tauri::LogicalPosition::new(sidebar_width, 0.0),
            tauri::LogicalSize::new(width.max(0.0), height.max(0.0)),
        ).map_err(|e: tauri::Error| e.to_string())?;
        
        let _ = child.show();
    }
    
    Ok(())
}
