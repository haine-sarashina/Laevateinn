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
                        } else if req.starts_with("GET /open?url=") {
                            let parts: Vec<&str> = req.split(' ').collect();
                            if parts.len() > 1 {
                                let path = parts[1];
                                if let Some(url_param) = path.strip_prefix("/open?url=") {
                                    let mut url = String::new();
                                    let mut chars = url_param.chars();
                                    while let Some(c) = chars.next() {
                                        if c == '%' {
                                            let hex = format!("{}{}", chars.next().unwrap_or('0'), chars.next().unwrap_or('0'));
                                            if let Ok(byte) = u8::from_str_radix(&hex, 16) {
                                                url.push(byte as char);
                                            }
                                        } else if c == '+' {
                                            url.push(' ');
                                        } else {
                                            url.push(c);
                                        }
                                    }
                                    use tauri_plugin_opener::OpenerExt;
                                    let _ = app.opener().open_url(url, None::<&str>);
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

fn create_account_webview(app: &tauri::AppHandle, account_id: &str, show: bool) -> Result<(), String> {
    if app.get_webview(account_id).is_some() {
        return Ok(());
    }

    let main_window = app.get_window("main").ok_or("Main window not found")?;
    
    let profile_dir = app.path().app_data_dir().unwrap_or_default().join("profiles").join(account_id);
    
    let window_size = main_window.inner_size().unwrap_or_default();
    let scale_factor = main_window.scale_factor().unwrap_or(1.0);
    
    let sidebar_width = 64.0;
    let width = (window_size.width as f64) / scale_factor - sidebar_width;
    let height = (window_size.height as f64) / scale_factor;
    
    let init_script = format!(r#"
        if (window === window.top) {{
            setInterval(() => {{
                let title = document.title;
                let match = title.match(/\((\d+)\)/);
                let count = match ? match[1] : '0';
                fetch("http://127.0.0.1:14205/update?acc={}&count=" + count).catch(() => {{}});
            }}, 3000);
            
            document.addEventListener('click', (e) => {{
                let target = e.target.closest('a');
                if (target && target.href) {{
                    let url = target.href;
                    if (url.includes('google.com/url?q=')) {{
                        let params = new URLSearchParams(url.split('?')[1]);
                        if (params.has('q')) {{
                            url = params.get('q');
                        }}
                    }}
                    if (!url.startsWith('https://mail.google.com/') && !url.startsWith('javascript:')) {{
                        e.preventDefault();
                        fetch("http://127.0.0.1:14205/open?url=" + encodeURIComponent(url)).catch(() => {{}});
                    }}
                }}
            }}, true);
        }}
    "#, account_id);

    let builder = WebviewBuilder::new(account_id, WebviewUrl::External("https://mail.google.com/".parse().unwrap()))
        .data_directory(profile_dir)
        .transparent(true)
        .incognito(false)
        .disable_drag_drop_handler()
        .initialization_script(&init_script);
        
    let child = main_window.add_child(
        builder,
        tauri::LogicalPosition::new(sidebar_width, 0.0),
        tauri::LogicalSize::new(width.max(0.0), height.max(0.0)),
    ).map_err(|e: tauri::Error| e.to_string())?;
    
    if show {
        let _ = child.show();
    } else {
        let _ = child.hide();
    }
    
    Ok(())
}

#[tauri::command]
pub async fn switch_account_webview(app: tauri::AppHandle, account_id: String) -> Result<(), String> {
    for (label, webview) in app.webviews() {
        if label.starts_with("acc_") {
            if label == account_id {
                let _ = webview.show();
            } else {
                let _ = webview.hide();
            }
        }
    }
    create_account_webview(&app, &account_id, true)?;
    Ok(())
}

#[tauri::command]
pub async fn spawn_background_webviews(app: tauri::AppHandle, account_ids: Vec<String>) -> Result<(), String> {
    for account_id in account_ids {
        let _ = create_account_webview(&app, &account_id, false);
    }
    Ok(())
}

#[tauri::command]
pub async fn set_app_badge(app: tauri::AppHandle, count: u32) -> Result<(), String> {
    if let Some(main_window) = app.get_window("main") {
        if count > 0 {
            let _ = main_window.set_badge_count(Some(count as i64));
        } else {
            let _ = main_window.set_badge_count(None);
        }
    }
    Ok(())
}
