use tauri::{Manager, WebviewBuilder, WebviewUrl};

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
        
        let builder = WebviewBuilder::new(&account_id, WebviewUrl::External("https://mail.google.com/".parse().unwrap()))
            .data_directory(profile_dir)
            .transparent(true)
            .incognito(false); // Make sure it persists
            
        let child = main_window.add_child(
            builder,
            tauri::LogicalPosition::new(sidebar_width, 0.0),
            tauri::LogicalSize::new(width.max(0.0), height.max(0.0)),
        ).map_err(|e: tauri::Error| e.to_string())?;
        
        let _ = child.show();
    }
    
    Ok(())
}
