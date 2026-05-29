use crate::error::AppError;
use tracing::{info, warn, error};

#[derive(serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LogLevel {
    Info,
    Warn,
    Error,
}

#[tauri::command]
pub async fn log_message(level: LogLevel, message: String) -> Result<(), AppError> {
    match level {
        LogLevel::Info => info!("{}", message),
        LogLevel::Warn => warn!("{}", message),
        LogLevel::Error => error!("{}", message),
    }
    Ok(())
}
