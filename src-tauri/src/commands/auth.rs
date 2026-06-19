use keyring::Entry;
use serde::{Deserialize, Serialize};
use crate::error::AppError;
use tracing::info;
use tauri::Emitter;
use std::collections::HashMap;
use std::sync::LazyLock;
use std::time::Instant;
use base64::Engine;
use sha2::Digest;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AccountInfo {
    pub id: String,
    pub name: String,
}

pub struct AuthFlowState {
    pub auth_url: String,
    pub state: String,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: Option<String>,
    #[allow(dead_code)]
    expires_in: Option<i64>,
    refresh_token: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
}

pub const SERVICE_NAME: &str = "laevateinn-mail";
const ACCOUNTS_LIST_KEY: &str = "accounts_list";
/// Default client credentials (used when env vars are not set)
const DEFAULT_CLIENT_ID: &str = "199450902096-mbc7ucd7777rtek56gnprac1mcfjobuk.apps.googleusercontent.com";
const DEFAULT_CLIENT_SECRET: &str = "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";

/// Resolve CLIENT_ID from env `GOOGLE_OAUTH_CLIENT_ID`, falling back to default.
pub static CLIENT_ID: LazyLock<String> = LazyLock::new(|| {
    std::env::var("GOOGLE_OAUTH_CLIENT_ID").ok().unwrap_or_else(|| DEFAULT_CLIENT_ID.to_string())
});

/// Resolve CLIENT_SECRET from env `GOOGLE_OAUTH_CLIENT_SECRET`, falling back to default.
pub static CLIENT_SECRET: LazyLock<String> = LazyLock::new(|| {
    std::env::var("GOOGLE_OAUTH_CLIENT_SECRET").ok().unwrap_or_else(|| DEFAULT_CLIENT_SECRET.to_string())
});
const TOKEN_ENDPOINT: &str = "https://oauth2.googleapis.com/token";
const REDIRECT_URI: &str = "http://localhost:62000/callback";

/// TTL for PKCE verifiers in the store (5 minutes)
const VERIFIER_TTL_SECS: u64 = 300;

struct VerifierEntry {
    verifier: String,
    created_at: Instant,
}

/// In-memory store mapping OAuth state -> (code_verifier, created_at)
static VERIFIER_STORE: LazyLock<std::sync::RwLock<HashMap<String, VerifierEntry>>> =
    LazyLock::new(|| std::sync::RwLock::new(HashMap::new()));

/// Retrieve and remove the code_verifier for the given state.
/// Returns None if the state is not found or has expired.
pub fn verify_and_get_verifier(state: &str) -> Option<String> {
    let mut store = VERIFIER_STORE.write().ok()?;
    let entry = store.get_mut(state)?;
    if entry.created_at.elapsed().as_secs() > VERIFIER_TTL_SECS {
        store.remove(state);
        return None;
    }
    let entry = store.remove(state);
    entry.map(|e| e.verifier)
}

/// In-memory cache of account IDs. Workaround for Windows Credential Manager
/// not immediately reflecting CredWriteW changes in CredReadW.
static ACCOUNT_CACHE: LazyLock<std::sync::RwLock<Vec<String>>> =
    LazyLock::new(|| std::sync::RwLock::new(Vec::new()));
pub fn cleanup_expired_verifiers() {
    let mut store = match VERIFIER_STORE.write() {
        Ok(s) => s,
        Err(_) => return,
    };
    store.retain(|_, _entry| _entry.created_at.elapsed().as_secs() <= VERIFIER_TTL_SECS);
}

fn get_token_entry(account_id: &str, token_type: &str) -> Result<Entry, AppError> {
    let key = format!("account_{}:{}", account_id, token_type);
    Ok(Entry::new(SERVICE_NAME, &key)?)
}

fn get_accounts_list() -> Result<Vec<String>, AppError> {
    // Try keyring first
    if let Some(accounts) = Entry::new(SERVICE_NAME, ACCOUNTS_LIST_KEY)
        .ok()
        .and_then(|e| e.get_password().ok())
        .filter(|p| !p.is_empty())
        .and_then(|p| serde_json::from_str::<Vec<String>>(&p).ok())
    {
        // Sync cache with keyring result
        if let Ok(mut cache) = ACCOUNT_CACHE.write() {
            *cache = accounts.clone();
        }
        return Ok(accounts);
    }

    // Fall back to in-memory cache (works around Windows Credential Manager delay)
    if let Ok(cache) = ACCOUNT_CACHE.read() {
        let accounts = cache.clone();
        if !accounts.is_empty() {
            println!("[get_accounts_list] returning {} accounts from in-memory cache", accounts.len());
            return Ok(accounts);
        }
    }

    Ok(vec![])
}

fn save_accounts_list(list: &[String]) -> Result<(), AppError> {
    let entry = Entry::new(SERVICE_NAME, ACCOUNTS_LIST_KEY)?;
    let json = serde_json::to_string(list)?;
    println!("[save_accounts_list] saving: {}", json);
    entry.set_password(&json)?;
    println!("[save_accounts_list] done");

    // Update in-memory cache immediately
    if let Ok(mut cache) = ACCOUNT_CACHE.write() {
        *cache = list.to_vec();
    }

    Ok(())
}

#[tauri::command]
pub async fn get_accounts() -> Result<Vec<AccountInfo>, AppError> {
    let ids = get_accounts_list()?;
    println!("[get_accounts] returning {} accounts", ids.len());
    let accounts = ids.into_iter().map(|id| AccountInfo {
        id: id.clone(),
        name: id.clone(),
    }).collect();
    Ok(accounts)
}

#[tauri::command]
pub async fn switch_active_for_account(_id: String) -> Result<(), AppError> {
    // No-op: active account management is handled entirely on the frontend.
    // Kept for backwards compatibility with the frontend invoke call.
    Ok(())
}

pub async fn add_account_internal(id: String, access_token: String, refresh_token: Option<String>) -> Result<(), AppError> {
    println!("[add_account_internal] adding account: {}", id);
    let access_entry = get_token_entry(&id, "access")?;
    access_entry.set_password(&access_token)?;
    println!("[add_account_internal] access token saved");

    if let Some(rt) = refresh_token {
        let refresh_entry = get_token_entry(&id, "refresh")?;
        refresh_entry.set_password(&rt)?;
        println!("[add_account_internal] refresh token saved");
    }

    let mut list = get_accounts_list()?;
    println!("[add_account_internal] current list has {} accounts", list.len());
    if !list.contains(&id) {
        list.push(id.clone());
        save_accounts_list(&list)?;
        println!("[add_account_internal] saved account list with {} accounts", list.len());
    }

    info!("Added account: {}", id);
    Ok(())
}

#[tauri::command]
pub async fn add_account(app: tauri::AppHandle, id: String, access_token: String, refresh_token: Option<String>) -> Result<(), AppError> {
    add_account_internal(id.clone(), access_token, refresh_token).await?;
    let _ = app.emit("oauth-account-added", &id);
    Ok(())
}

#[tauri::command]
pub async fn remove_account(app: tauri::AppHandle, id: String) -> Result<(), AppError> {
    if let Ok(access_entry) = get_token_entry(&id, "access") {
        let _ = access_entry.delete_credential();
    }
    if let Ok(refresh_entry) = get_token_entry(&id, "refresh") {
        let _ = refresh_entry.delete_credential();
    }

    let mut list = get_accounts_list()?;
    list.retain(|x| x != &id);
    save_accounts_list(&list)?;

    info!("Removed account: {}", id);
    let _ = app.emit("oauth-account-removed", &id);
    Ok(())
}

pub fn get_access_token_for(account_id: &str) -> Result<Option<String>, AppError> {
    let entry = get_token_entry(account_id, "access")?;
    match entry.get_password() {
        Ok(token) => Ok(if token.is_empty() { None } else { Some(token) }),
        Err(_) => Ok(None),
    }
}

pub fn get_refresh_token_for(account_id: &str) -> Result<Option<String>, AppError> {
    let entry = get_token_entry(account_id, "refresh")?;
    match entry.get_password() {
        Ok(token) => Ok(if token.is_empty() { None } else { Some(token) }),
        Err(_) => Ok(None),
    }
}

fn generate_pkce_challenge() -> (String, String) {
    let verifier: String = (0..64)
        .map(|_| {
            let bytes = rand::random::<u8>();
            match bytes % 64 {
                0..=25 => (b'a' + bytes % 26) as char,
                26..=51 => (b'A' + (bytes - 26) % 26) as char,
                52..=61 => (b'0' + (bytes - 52) % 10) as char,
                62 => '-',
                _ => '_',
            }
        })
        .collect();

    let hash = sha2::Sha256::digest(verifier.as_bytes());
    let challenge = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(hash);

    (verifier, challenge)
}

fn generate_state() -> String {
    (0..32)
        .map(|_| {
            let bytes = rand::random::<u8>();
            (bytes % 26 + b'a') as char
        })
        .collect()
}

#[tauri::command]
pub async fn start_auth_flow(app: tauri::AppHandle) -> Result<serde_json::Value, AppError> {
    // Start the callback server on-demand (idempotent — no-op if already running).
    crate::callback_server::start_server(app.clone());

    // Auto-shutdown after 5 minutes as a safety net.
    // If the OAuth callback is processed earlier, handle_request will shut down
    // the server immediately. This timeout handles cases where the user never
    // completes the flow.
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(300)).await;
        crate::callback_server::stop_callback_server();
    });

    let (verifier, challenge) = generate_pkce_challenge();
    let state = generate_state();

    // Store verifier keyed by state
    {
        let mut store = VERIFIER_STORE.write().map_err(|e| {
            AppError::AuthError(format!("Failed to acquire verifier store lock: {}", e))
        })?;
        store.insert(state.clone(), VerifierEntry { verifier, created_at: std::time::Instant::now() });
    }

    let auth_endpoint = "https://accounts.google.com/o/oauth2/v2/auth";
    // mail.google.com = 完全アクセス（送受信・削除・ラベル操作など）
    // gmail.settings.basic = 設定系API（Vacation Responder、フィルター管理）
    let scope = "openid email https://www.googleapis.com/auth/mail.google.com https://www.googleapis.com/auth/gmail.settings.basic";
    let auth_url = format!(
        "{}?client_id={}&redirect_uri={}&response_type=code&scope={}&access_type=offline&prompt=consent&code_challenge={}&code_challenge_method=S256&state={}",
        auth_endpoint, CLIENT_ID.as_str(), REDIRECT_URI, scope, challenge, state
    );

    Ok(serde_json::json!({ "auth_url": auth_url, "state": state }))
}

pub async fn refresh_access_token_for(account_id: &str) -> Result<String, AppError> {
    let refresh_entry = get_token_entry(account_id, "refresh")?;
    let refresh_token = match refresh_entry.get_password() {
        Ok(rt) if !rt.is_empty() => rt,
        _ => return Err(AppError::AuthError("No refresh token".to_string())),
    };
    let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(30)).build().map_err(|e| AppError::AuthError(e.to_string()))?;
    let body = format!("client_id={}&client_secret={}&refresh_token={}&grant_type=refresh_token", CLIENT_ID.as_str(), CLIENT_SECRET.as_str(), refresh_token);
    let response = client.post(TOKEN_ENDPOINT).header("Content-Type", "application/x-www-form-urlencoded").body(body).send().await.map_err(AppError::from)?;
    let status = response.status();
    let response_token_text = response.text().await.map_err(AppError::from)?;
    println!("[auth] token refresh response status: {} body: {}", status, response_token_text);
    let token_data: Option<TokenResponse> = serde_json::from_str(&response_token_text).ok();
    if let Some(data) = &token_data {
        if let Some(ref error) = data.error {
            let error_desc = data.error_description.as_deref().unwrap_or("不明なエラー");
            println!("[auth] Google returned error: {} - {}", error, error_desc);
            return Err(AppError::AuthError(format!("認証が切れています（{}: {}）。再ログインしてください。", error, error_desc)));
        }
    }
    if !status.is_success() {
        return Err(AppError::AuthError(format!("トークン更新に失敗しました（HTTP {}）。再ログインしてください。", status)));
    }
    if let Some(data) = token_data {
        if let Some(access_token) = data.access_token {
            let access_entry = get_token_entry(account_id, "access")?;
            access_entry.set_password(&access_token)?;
            if let Some(new_rt) = data.refresh_token {
                let refresh_entry = get_token_entry(account_id, "refresh")?;
                let _ = refresh_entry.set_password(&new_rt);
                println!("[auth] refresh token rotated and saved");
            }
            Ok(access_token)
        } else {
            Err(AppError::AuthError(format!("トークン更新応答に access_token がありません。再ログインしてください。")))
        }
    } else {
        Err(AppError::AuthError(format!("トークン更新のレスポンス解析に失敗しました。再ログインしてください。")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serial_test::serial;

    // Helper to clean up VERIFIER_STORE between tests
    fn clear_verifier_store() {
        if let Ok(mut store) = VERIFIER_STORE.write() {
            store.clear();
        }
    }

    // --- generate_pkce_challenge tests ---
    #[test]
    fn pkce_verifier_length_is_64() {
        let (verifier, _) = generate_pkce_challenge();
        assert_eq!(verifier.len(), 64);
    }

    #[test]
    fn pkce_verifier_contains_only_valid_chars() {
        let (verifier, _) = generate_pkce_challenge();
        for c in verifier.chars() {
            assert!(
                c.is_ascii_alphanumeric() || c == '-' || c == '_',
                "verifier contains invalid char: {}",
                c
            );
        }
    }

    #[test]
    fn pkce_challenge_is_base64url_encoded() {
        let (_, challenge) = generate_pkce_challenge();
        for c in challenge.chars() {
            assert!(
                c.is_ascii_alphanumeric() || c == '-' || c == '_',
                "challenge contains invalid char: {}",
                c
            );
        }
    }

    #[test]
    fn pkce_challenge_is_sha256_of_verifier() {
        let (verifier, challenge) = generate_pkce_challenge();
        let expected_hash = sha2::Sha256::digest(verifier.as_bytes());
        let expected_challenge = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(expected_hash);
        assert_eq!(challenge, expected_challenge);
    }

    #[test]
    fn pkce_different_calls_produce_different_verifiers() {
        let (v1, _) = generate_pkce_challenge();
        let (v2, _) = generate_pkce_challenge();
        assert_ne!(v1, v2);
    }

    // --- generate_state tests ---
    #[test]
    fn state_length_is_32() {
        let state = generate_state();
        assert_eq!(state.len(), 32);
    }

    #[test]
    fn state_contains_only_lowercase_letters() {
        let state = generate_state();
        for c in state.chars() {
            assert!(c.is_ascii_lowercase(), "state contains non-lowercase char: {}", c);
        }
    }

    #[test]
    fn state_different_calls_produce_different_values() {
        let s1 = generate_state();
        let s2 = generate_state();
        assert_ne!(s1, s2);
    }

    // --- verify_and_get_verifier tests --- (#[serial] for global VERIFIER_STORE)
    #[serial]
    #[test]
    fn verify_and_get_verifier_returns_verifier_for_valid_state() {
        clear_verifier_store();
        let state = "test_state_123";
        let verifier = "test_verifier_value";
        VERIFIER_STORE.write().unwrap().insert(
            state.to_string(),
            VerifierEntry {
                verifier: verifier.to_string(),
                created_at: std::time::Instant::now(),
            },
        );
        let result = verify_and_get_verifier(state);
        assert_eq!(result, Some(verifier.to_string()));
    }

    #[serial]
    #[test]
    fn verify_and_get_verifier_returns_none_for_missing_state() {
        clear_verifier_store();
        let result = verify_and_get_verifier("nonexistent_state");
        assert!(result.is_none());
    }

    #[serial]
    #[test]
    fn verify_and_get_verifier_consumes_entry() {
        clear_verifier_store();
        let state = "consume_test";
        VERIFIER_STORE.write().unwrap().insert(
            state.to_string(),
            VerifierEntry {
                verifier: "v".to_string(),
                created_at: std::time::Instant::now(),
            },
        );
        assert!(verify_and_get_verifier(state).is_some());
        assert!(verify_and_get_verifier(state).is_none()); // consumed
    }

    // --- cleanup_expired_verifiers tests --- (#[serial] for global VERIFIER_STORE)
    #[serial]
    #[test]
    fn cleanup_removes_expired_entries() {
        clear_verifier_store();
        let state = "expired_state";
        VERIFIER_STORE.write().unwrap().insert(
            state.to_string(),
            VerifierEntry {
                verifier: "v".to_string(),
                created_at: std::time::Instant::now()
                    - std::time::Duration::from_secs(VERIFIER_TTL_SECS + 10),
            },
        );
        cleanup_expired_verifiers();
        let result = verify_and_get_verifier(state);
        assert!(result.is_none());
    }

    #[serial]
    #[test]
    fn cleanup_keeps_valid_entries() {
        clear_verifier_store();
        let state = "valid_state";
        VERIFIER_STORE.write().unwrap().insert(
            state.to_string(),
            VerifierEntry {
                verifier: "valid_v".to_string(),
                created_at: std::time::Instant::now(),
            },
        );
        cleanup_expired_verifiers();
        let result = verify_and_get_verifier(state);
        assert_eq!(result, Some("valid_v".to_string()));
    }

    #[serial]
    #[test]
    fn expired_verifier_returns_none() {
        clear_verifier_store();
        let state = "too_old_state";
        VERIFIER_STORE.write().unwrap().insert(
            state.to_string(),
            VerifierEntry {
                verifier: "v".to_string(),
                created_at: std::time::Instant::now()
                    - std::time::Duration::from_secs(VERIFIER_TTL_SECS + 1),
            },
        );
        let result = verify_and_get_verifier(state);
        assert!(result.is_none()); // expired, so None
    }
}
