use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::Duration;
use tauri::{Emitter, EventTarget, Manager};
use tiny_http::{Request, Response, Server, StatusCode};
use std::time::{SystemTime, UNIX_EPOCH};

pub const CALLBACK_PORT: u16 = 62000;
pub const CALLBACK_REDIRECT_URI: &str = "http://localhost:62000/callback";

/// Global server state for lifecycle management.
/// shutdown_flag is set by handle_request after processing the OAuth callback,
/// causing the accept loop to exit (within ~1 second due to read_timeout).
static CALLBACK_SERVER_STATE: OnceLock<CallbackServerState> = OnceLock::new();

struct CallbackServerState {
    shutdown_flag: Arc<AtomicBool>,
    running: Arc<AtomicBool>,
}

fn read_dev_url() -> Option<String> {
    if let Ok(dev_url) = std::env::var("TAURI_DEV_URL") {
        return Some(dev_url);
    }
    let config_path = Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/tauri.conf.json"));
    let content = fs::read_to_string(config_path).ok()?;
    let config: serde_json::Value = serde_json::from_str(&content).ok()?;
    config["build"]["devUrl"].as_str().map(|s| s.to_string())
}

fn escape_html(input: &str) -> String {
    input
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#x27;")
}

fn get_timestamp() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("Time went backwards");
    format!("[{:010}]", now.as_secs())
}

fn error_page(msg: &str) -> Response<std::io::Cursor<Vec<u8>>> {
    let escaped_msg = escape_html(msg);
    let body = format!(
        r#"<html><body style="font-family:Arial,sans-serif;text-align:center;padding:40px"><h1>エラー</h1><p>{}</p><p>ブラウザを閉じて、アプリからもう一度お試しください。</p></body></html>"#,
        escaped_msg
    );
    Response::from_string(body).with_status_code(StatusCode(500))
}

/// Parse query string parameters into a HashMap
fn parse_query_params(query: &str) -> HashMap<String, String> {
    url::form_urlencoded::parse(query.as_bytes())
        .map(|(k, v)| (k.into_owned(), v.into_owned()))
        .collect()
}

pub async fn handle_request(request: Request, app: tauri::AppHandle) {
    let url = request.url().to_string();
    println!("[callback_server] received request for {}", url);

    if !url.starts_with("/callback") {
        let _ = request.respond(Response::from_string("OK"));
        return;
    }

    // Extract query parameters
    let params = if let Some(query_start) = url.find('?') {
        parse_query_params(&url[query_start + 1..])
    } else {
        HashMap::new()
    };
    println!("[callback_server] parsed params: {:?}", params);

    // Check for OAuth error from Google
    if let Some(error_code) = params.get("error") {
        let error_msg = params
            .get("error_description")
            .unwrap_or(error_code)
            .to_string();
        println!("[callback_server] OAuth error received: {}", error_msg);
        let _ = request.respond(error_page(&error_msg));
        let _ = app.emit("oauth-error", &error_msg);
        return;
    }

    // Validate state parameter (CSRF protection)
    let state = match params.get("state") {
        Some(s) if !s.is_empty() => s.clone(),
        _ => {
            println!("[callback_server] Invalid state parameter");
            let _ = request.respond(error_page("stateパラメータが見つかりません"));
            return;
        }
    };

    // Validate code parameter
    let code = match params.get("code") {
        Some(c) if !c.is_empty() => c.clone(),
        _ => {
            println!("[callback_server] Invalid code parameter");
            let _ = request.respond(error_page("認証コードが見つかりません"));
            return;
        }
    };

    println!("[callback_server] code received, verifying state={}", state);

    // Verify state and get code_verifier for PKCE
    let verifier = match crate::commands::auth::verify_and_get_verifier(&state) {
        Some(v) => v,
        None => {
            println!("[callback_server] State verification failed");
            let _ = request.respond(error_page(
                "stateの有効期限が切れました。再度認証を開始してください。",
            ));
            return;
        }
    };

    println!("[callback_server] state verified, exchanging code for tokens");

    let dev_url = read_dev_url();

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .expect("Failed to build reqwest client");

    // Token exchange with PKCE verifier
    let body = format!(
        "client_id={}&client_secret={}&code={}&redirect_uri={}&grant_type=authorization_code&code_verifier={}",
        crate::commands::auth::CLIENT_ID.as_str(),
        crate::commands::auth::CLIENT_SECRET.as_str(),
        code,
        CALLBACK_REDIRECT_URI,
        verifier
    );

    println!("[callback_server] Sending token exchange request");

    let response = match client
        .post("https://oauth2.googleapis.com/token")
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(body)
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            println!("[callback_server] Token exchange request failed: {}", e);
            let _ = request.respond(error_page(&format!("リクエストに失敗しました: {}", e)));
            return;
        }
    };

    println!("[callback_server] Token exchange response received");

    let response_text = match response.text().await {
        Ok(t) => t,
        Err(e) => {
            println!("[callback_server] Failed to read token response: {}", e);
            let _ = request.respond(error_page(&format!(
                "レスポンスの読み込みに失敗しました: {}",
                e
            )));
            return;
        }
    };

    println!("[callback_server] Token exchange response text: {}", response_text);

    let token_data: serde_json::Value = match serde_json::from_str(&response_text) {
        Ok(v) => v,
        Err(e) => {
            println!("[callback_server] Failed to parse token response: {}", e);
            let _ = request.respond(error_page(&format!(
                "レスポンスの解析に失敗しました: {}",
                response_text
            )));
            return;
        }
    };

    let access_token = match token_data["access_token"].as_str() {
        Some(t) => t.to_string(),
        None => {
            let msg = token_data["error_description"]
                .as_str()
                .or_else(|| token_data["error"].as_str())
                .unwrap_or("アクセストークンを取得できませんでした");
            println!("[callback_server] Token exchange error: {}", msg);
            let _ = request.respond(error_page(msg));
            return;
        }
    };

    let refresh_token = token_data["refresh_token"].as_str().map(|s| s.to_string());

    println!("[callback_server] Access token received, fetching user info");

    let user_info = match client
        .get("https://www.googleapis.com/oauth2/v3/userinfo")
        .header("Authorization", format!("Bearer {}", access_token))
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            println!("[callback_server] Failed to fetch user info: {}", e);
            let _ = request.respond(error_page(&format!(
                "ユーザー情報の取得に失敗しました: {}",
                e
            )));
            return;
        }
    };

    let user_info_text = match user_info.text().await {
        Ok(t) => t,
        Err(e) => {
            println!("[callback_server] Failed to read user info: {}", e);
            let _ = request.respond(error_page(&format!(
                "ユーザー情報の読み込みに失敗しました: {}",
                e
            )));
            return;
        }
    };

    println!("[callback_server] User info received: {}", user_info_text);

    let user_info: serde_json::Value = match serde_json::from_str(&user_info_text) {
        Ok(v) => v,
        Err(e) => {
            println!("[callback_server] Failed to parse user info: {}", e);
            let _ = request.respond(error_page(&format!(
                "ユーザー情報の解析に失敗しました: {}",
                e
            )));
            return;
        }
    };

    let email = user_info["email"].as_str().unwrap_or("unknown").to_string();
    println!("[callback_server] OAuth success for email={}", email);

    // Save tokens/accounts via add_account_internal (single source of truth)
    println!("[callback_server] Attempting to save account for {}", email);
    match crate::commands::auth::add_account_internal(email.clone(), access_token, refresh_token)
        .await
    {
        Ok(_) => println!("[callback_server] account saved for {}", email),
        Err(e) => {
            println!("[callback_server] failed to save account: {}", e);
            let _ = request.respond(error_page(&format!("アカウント保存に失敗しました: {}", e)));
            return;
        }
    }

    // Notify frontend that a new account was added via OAuth
    println!("[callback_server] Emitting oauth-account-added event for {}", email);
    if let Some(window) = app.get_webview_window("main") {
        match window.emit_to(EventTarget::webview("main"), "oauth-account-added", &email) {
            Ok(_) => println!(
                "[callback_server] emitted oauth-account-added for {}",
                email
            ),
            Err(e) => println!("[callback_server] failed to emit event: {}", e),
        }
    } else {
        println!("[callback_server] main window not found");
    }

    // Return success page
    println!("[callback_server] Preparing success page for {}", email);
    let success_html = if dev_url.is_some() {
        r#"<html><body style="font-family:Arial,sans-serif;text-align:center;padding:40px">
<h1>認証完了</h1><p>ブラウザを閉じて、アプリに戻ってください。</p></body></html>"#
    } else {
        let escaped_email = escape_html(&email);
        &format!("<html><body style=\"font-family:Arial,sans-serif;text-align:center;padding:40px\"><h1>認証完了</h1><p>アカウント「{}」を追加しました。<br>ブラウザを閉じて、アプリに戻ってください。</p></body></html>", escaped_email)
    };

    println!("[callback_server] Sending success response for {}", email);
    // Ensure the response is sent and properly closed
    let response = Response::from_string(success_html).with_status_code(StatusCode(200));
    if let Err(e) = request.respond(response) {
        eprintln!("[callback_server] Failed to send success response: {}", e);
    } else {
        println!("[callback_server] Success response sent successfully");
    }

    println!("[callback_server] Success response sent, stopping server");
    // OAuth callback processed — shut down the server to minimize port exposure.
    stop_callback_server();
}

pub fn start_server(app: tauri::AppHandle) {
    let state = CALLBACK_SERVER_STATE.get_or_init(|| CallbackServerState {
        shutdown_flag: Arc::new(AtomicBool::new(false)),
        running: Arc::new(AtomicBool::new(false)),
    });

    // Idempotent: do nothing if the server is already running.
    if state.running.swap(true, Ordering::SeqCst) {
        return;
    }

    // Reset shutdown flag for fresh start.
    state.shutdown_flag.store(false, Ordering::SeqCst);

    let shutdown_flag = state.shutdown_flag.clone();
    let running = state.running.clone();

    // IMPORTANT: this accept loop uses tiny_http's synchronous, blocking
    // `incoming_requests()` iterator. Running it inside `tauri::async_runtime::spawn`
    // would occupy a Tokio worker thread for the entire lifetime of the server
    // without ever yielding via `.await`, which can starve every other task
    // scheduled on that runtime (including the per-request handlers spawned
    // below) if the runtime doesn't have enough free worker threads. Running it
    // on its own dedicated OS thread avoids consuming a Tokio worker thread at all.
    std::thread::spawn(move || {
        use socket2::{Domain, Protocol, Socket, Type};
        use std::net::{SocketAddr, TcpListener};

        let addr: SocketAddr = format!("127.0.0.1:{}", CALLBACK_PORT).parse().unwrap();
        println!("[callback_server] attempting to bind to {}", addr);

        let socket = Socket::new(Domain::IPV4, Type::STREAM, Some(Protocol::TCP))
            .expect("Failed to create socket");
        socket
            .set_reuse_address(true)
            .expect("Failed to set SO_REUSEADDR");
        socket
            .set_read_timeout(Some(Duration::from_secs(1)))
            .expect("Failed to set read timeout (critical for clean shutdown)");
        socket.bind(&addr.into()).expect("Failed to bind");
        socket.listen(128).expect("Failed to listen");
        let listener: TcpListener = socket.into();

        let server =
            Server::from_listener(listener, None).expect("Failed to start OAuth callback server");

        println!("[callback_server] listening on port {}", CALLBACK_PORT);

        // Accept loop with shutdown support.
        // The incoming_requests() iterator blocks internally, but the socket's
        // read_timeout (1s) ensures it periodically wakes up.
        // We check the shutdown flag before spawning each request handler.
        for request in server.incoming_requests() {
            if shutdown_flag.load(Ordering::SeqCst) {
                break;
            }
            println!("[callback_server] incoming request");
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                println!("[callback_server] spawned task started");
                match tokio::time::timeout(
                    std::time::Duration::from_secs(15),
                    handle_request(request, app),
                )
                .await
                {
                    Ok(_) => println!("[callback_server] spawned task finished"),
                    Err(_) => {
                        println!("[callback_server] spawned task TIMED OUT after 15s - dropping connection");
                    }
                }
            });
        }

        running.store(false, Ordering::SeqCst);
        println!("[callback_server] stopped");
    });
}

/// Stop the callback server (graceful shutdown).
/// Sets the shutdown flag; the accept loop checks this between requests
/// and exits within ~1 second (bounded by read_timeout on the socket).
pub fn stop_callback_server() {
    if let Some(state) = CALLBACK_SERVER_STATE.get() {
        state.shutdown_flag.store(true, Ordering::SeqCst);
        println!("[callback_server] shutdown requested");
    }
}

/// Check if the callback server is currently running.
pub fn is_running() -> bool {
    if let Some(state) = CALLBACK_SERVER_STATE.get() {
        state.running.load(Ordering::SeqCst)
    } else {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- escape_html tests ---
    #[test]
    fn escape_html_escapes_ampersand() {
        assert_eq!(escape_html("cat & dog"), "cat &amp; dog");
    }

    #[test]
    fn escape_html_escapes_less_than() {
        assert_eq!(escape_html("<div>"), "&lt;div&gt;");
    }

    #[test]
    fn escape_html_escapes_double_quotes() {
        assert_eq!(escape_html(r#"say "hi""#), r#"say &quot;hi&quot;"#);
    }

    #[test]
    fn escape_html_escapes_single_quotes() {
        assert_eq!(escape_html("it's"), "it&#x27;s");
    }

    #[test]
    fn escape_html_xss_prevention() {
        assert_eq!(
            escape_html("<script>alert('x')&done</script>"),
            "&lt;script&gt;alert(&#x27;x&#x27;)&amp;done&lt;/script&gt;"
        );
    }

    #[test]
    fn escape_html_empty_string() {
        assert_eq!(escape_html(""), "");
    }

    #[test]
    fn escape_html_plain_text_unchanged() {
        assert_eq!(escape_html("Hello, World! 123"), "Hello, World! 123");
    }

    // --- parse_query_params tests ---
    #[test]
    fn parse_query_params_single() {
        let result = parse_query_params("foo=bar");
        assert_eq!(result.get("foo"), Some(&"bar".to_string()));
        assert_eq!(result.len(), 1);
    }

    #[test]
    fn parse_query_params_multiple() {
        let result = parse_query_params("code=abc123&state=xyz789");
        assert_eq!(result.get("code"), Some(&"abc123".to_string()));
        assert_eq!(result.get("state"), Some(&"xyz789".to_string()));
    }

    #[test]
    fn parse_query_params_empty() {
        let result = parse_query_params("");
        assert!(result.is_empty());
    }

    #[test]
    fn parse_query_params_url_decodes() {
        let result = parse_query_params("email=user%40example.com");
        assert_eq!(result.get("email"), Some(&"user@example.com".to_string()));
    }
}
