use crate::commands::auth::get_access_token_for;
use crate::commands::auth::refresh_access_token_for;
use crate::error::AppError;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tauri::Emitter;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelEmailArgs {
    pub account_id: String,
    pub message_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelEmailResponse {
    pub success: bool,
    pub message_id: String,
    pub cancelled: bool,
}

/// Cancel a sent email by moving it to the trash (LABEL_TRASH)
#[tauri::command]
pub async fn cancel_email(
    app: tauri::AppHandle,
    account_id: String,
    message_id: String,
) -> Result<CancelEmailResponse, AppError> {
    let client = Client::new();

    // keyringからアクセストークンを直接取得（事前tokeninfoチェックは行わない）
    let token = get_access_token_for(&account_id)?.ok_or_else(|| {
        AppError::AuthError("No access token found. Please login first.".to_string())
    })?;

    // First, check if the email exists and has not been already trashed
    let url = format!(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/{}?format=metadata",
        message_id
    );

    let mut response = client
        .get(&url)
        .bearer_auth(&token)
        .send()
        .await
        .map_err(AppError::from)?;

    // レスポンスが401の場合: トークンをリフレッシュして自動リトライ
    if response.status() == 401 {
        println!(
            "[gmail] cancel_email: 401 received, refreshing token for {}",
            account_id
        );
        let new_token = refresh_access_token_for(&account_id).await?;
        // 新しいトークンは keyring に再保存済み（refresh_access_token_for 内で保存される）
        let _ = app.emit("token-refreshed", &account_id);
        response = client
            .get(&url)
            .bearer_auth(&new_token)
            .send()
            .await
            .map_err(AppError::from)?;
        if response.status() == 401 {
            // リトライ後も401の場合: クレデンシャルが無効である可能性が高い
            let error_text = response.text().await.map_err(AppError::from)?;
            return Err(AppError::AuthError(format!(
                "認証が無効です。アカウントを再設定してください。Gmail: {}",
                error_text
            )));
        }
    }

    if !response.status().is_success() {
        let error_text = response.text().await.map_err(AppError::from)?;
        return Err(AppError::ApiError(format!(
            "Gmail API error checking message: {}",
            error_text
        )));
    }

    // Parse the response to check if it's already trashed
    let json: serde_json::Value = response.json().await.map_err(AppError::from)?;

    // Check if the message is already in trash
    let labels: Vec<String> = json
        .get("labelIds")
        .and_then(|l| l.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();

    let is_trashed = labels.contains(&"TRASH".to_string()) || labels.contains(&"LABEL_TRASH".to_string());

    if is_trashed {
        println!("[gmail] cancel_email: message {} is already trashed", message_id);
        return Ok(CancelEmailResponse {
            success: true,
            message_id,
            cancelled: false, // Already cancelled
        });
    }

    // If not trashed, move it to trash by adding the TRASH label and removing from INBOX
    let modify_url = format!(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/{}/modifyLabels",
        message_id
    );

    let payload = serde_json::json!({
        "addLabelIds": ["TRASH"],
        "removeLabelIds": ["INBOX"]
    });

    let mut response = client
        .post(&modify_url)
        .bearer_auth(&token)
        .json(&payload)
        .send()
        .await
        .map_err(AppError::from)?;

    // レスポンスが401の場合: トークンをリフレッシュして自動リトライ
    if response.status() == 401 {
        println!(
            "[gmail] cancel_email modifyLabels: 401 received, refreshing token for {}",
            account_id
        );
        let new_token = refresh_access_token_for(&account_id).await?;
        // 新しいトークンは keyring に再保存済み（refresh_access_token_for 内で保存される）
        let _ = app.emit("token-refreshed", &account_id);
        response = client
            .post(&modify_url)
            .bearer_auth(&new_token)
            .json(&payload)
            .send()
            .await
            .map_err(AppError::from)?;
        if response.status() == 401 {
            // リトライ後も401の場合: クレデンシャルが無効である可能性が高い
            let error_text = response.text().await.map_err(AppError::from)?;
            return Err(AppError::AuthError(format!(
                "認証が無効です。アカウントを再設定してください。Gmail: {}",
                error_text
            )));
        }
    }

    if !response.status().is_success() {
        let error_text = response.text().await.map_err(AppError::from)?;
        return Err(AppError::ApiError(format!(
            "Gmail API error modifying labels: {}",
            error_text
        )));
    }

    println!("[gmail] cancel_email: successfully cancelled message {}", message_id);
    Ok(CancelEmailResponse {
        success: true,
        message_id,
        cancelled: true,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cancel_email_args_serializes() {
        let args = CancelEmailArgs {
            account_id: "user@test.com".to_string(),
            message_id: "msg123".to_string(),
        };
        let json = serde_json::to_value(&args).unwrap();
        assert_eq!(json["accountId"], "user@test.com");
        assert_eq!(json["messageId"], "msg123");
    }

    #[test]
    fn cancel_email_response_serializes() {
        let resp = CancelEmailResponse {
            success: true,
            message_id: "msg123".to_string(),
            cancelled: true,
        };
        let json = serde_json::to_value(&resp).unwrap();
        assert_eq!(json["success"], true);
        assert_eq!(json["messageId"], "msg123");
        assert_eq!(json["cancelled"], true);
    }
}