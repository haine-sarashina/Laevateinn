use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error, Serialize)]
#[serde(tag = "type", content = "message")]
pub enum AppError {
    #[error("Authentication error: {0}")]
    AuthError(String),

    #[error("Network error: {0}")]
    NetworkError(String),

    #[error("API error: {0}")]
    ApiError(String),

    #[error("Storage error: {0}")]
    StorageError(String),

    #[error("Internal error: {0}")]
    InternalError(String),
}

// Implement From for common error types
impl From<reqwest::Error> for AppError {
    fn from(err: reqwest::Error) -> Self {
        AppError::NetworkError(err.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(err: serde_json::Error) -> Self {
        AppError::InternalError(err.to_string())
    }
}

impl From<keyring::Error> for AppError {
    fn from(err: keyring::Error) -> Self {
        AppError::StorageError(err.to_string())
    }
}

impl From<tauri::Error> for AppError {
    fn from(err: tauri::Error) -> Self {
        AppError::InternalError(err.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_error_auth_error_display() {
        let err = AppError::AuthError("Invalid token".to_string());
        assert!(err.to_string().contains("Invalid token"));
    }

    #[test]
    fn app_error_network_error_display() {
        let err = AppError::NetworkError("connection refused".to_string());
        assert!(err.to_string().contains("connection refused"));
    }

    #[test]
    fn app_error_api_error_display() {
        let err = AppError::ApiError("403 Forbidden".to_string());
        assert!(err.to_string().contains("403"));
    }

    #[test]
    fn app_error_storage_error_display() {
        let err = AppError::StorageError("key not found".to_string());
        assert!(err.to_string().contains("key not found"));
    }

    #[test]
    fn app_error_internal_error_display() {
        let err = AppError::InternalError("unexpected state".to_string());
        assert!(err.to_string().contains("unexpected state"));
    }

    #[test]
    fn from_serde_json_error_produces_internal_error() {
        let json_err = serde_json::from_str::<serde_json::Value>("not json").unwrap_err();
        let app_err = AppError::from(json_err);
        // Should be InternalError variant
        assert!(matches!(app_err, AppError::InternalError(_)));
    }
}
