use std::collections::HashMap;
use tauri::{Emitter, EventTarget, Manager};
use tiny_http::{Server, Request, Response, StatusCode};
use std::fs;
use std::path::Path;
use std::time::Duration;

pub const CALLBACK_PORT: u16 = 62000;
pub const CALLBACK_REDIRECT_URI: &str = "http://localhost:62000/callback";

fn read_dev_url() -> Option<String> {
    if let Ok(dev_url) = std::env::var("TAURI_DEV_URL") {
        return Some(dev_url);
    }
    let config_path = Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/tauri.conf.json"));
    let content = fs::read_to_string(config_path).ok()?;
    let config: serde_json::Value = serde_json::from_str(&content).ok()?;
    config["build"]["devUrl"].as_str().map(|s| s.to_string())
}

fn error_page(msg: &str) -> Response<std::io::Cursor<Vec<u8>>> {
    let body = format!(
        r#"<html><body style="font-family:Arial,sans-serif;text-align:center;padding:40px"><h1>エラー</h1><p>{}</p><p>ブラウザを閉じて、アプリからもう一度お試しください。</p></body></html>"#,
        msg
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
        let error_msg = params.get("error_description")
            .unwrap_or(error_code)
            .to_string();
        let _ = request.respond(error_page(&error_msg));
        let _ = app.emit("oauth-error", &error_msg);
        return;
    }

    // Validate state parameter (CSRF protection)
    let state = match params.get("state") {
        Some(s) if !s.is_empty() => s.clone(),
        _ => {
            let _ = request.respond(error_page("stateパラメータが見つかりません"));
            return;
        }
    };

    // Validate code parameter
    let code = match params.get("code") {
        Some(c) if !c.is_empty() => c.clone(),
        _ => {
            let _ = request.respond(error_page("認証コードが見つかりません"));
            return;
        }
    };

    println!("[callback_server] code received, verifying state={}", state);

    // Verify state and get code_verifier for PKCE
    let verifier = match crate::commands::auth::verify_and_get_verifier(&state) {
        Some(v) => v,
        None => {
            let _ = request.respond(error_page("stateの有効期限が切れました。再度認証を開始してください。"));
            return;
        }
    };

    println!("[callback_server] state verified, exchanging code for tokens");

    let dev_url = read_dev_url();

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
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

    let response = match client
        .post("https://oauth2.googleapis.com/token")
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(body)
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            let _ = request.respond(error_page(&format!("リクエストに失敗しました: {}", e)));
            return;
        }
    };

    let response_text = match response.text().await {
        Ok(t) => t,
        Err(e) => {
            let _ = request.respond(error_page(&format!("レスポンスの読み込みに失敗しました: {}", e)));
            return;
        }
    };

    let token_data: serde_json::Value = match serde_json::from_str(&response_text) {
        Ok(v) => v,
        Err(_) => {
            let _ = request.respond(error_page(&format!("レスポンスの解析に失敗しました: {}", response_text)));
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
            let _ = request.respond(error_page(msg));
            return;
        }
    };

    let refresh_token = token_data["refresh_token"].as_str().map(|s| s.to_string());

    let user_info = match client
        .get("https://www.googleapis.com/oauth2/v3/userinfo")
        .header("Authorization", format!("Bearer {}", access_token))
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            let _ = request.respond(error_page(&format!("ユーザー情報の取得に失敗しました: {}", e)));
            return;
        }
    };

    let user_info_text = match user_info.text().await {
        Ok(t) => t,
        Err(e) => {
            let _ = request.respond(error_page(&format!("ユーザー情報の読み込みに失敗しました: {}", e)));
            return;
        }
    };

    let user_info: serde_json::Value = match serde_json::from_str(&user_info_text) {
        Ok(v) => v,
        Err(e) => {
            let _ = request.respond(error_page(&format!("ユーザー情報の解析に失敗しました: {}", e)));
            return;
        }
    };

    let email = user_info["email"].as_str().unwrap_or("unknown").to_string();
    println!("[callback_server] OAuth success for email={}", email);

    // Save tokens/accounts via add_account_internal (single source of truth)
    match crate::commands::auth::add_account_internal(email.clone(), access_token, refresh_token).await {
        Ok(_) => println!("[callback_server] account saved for {}", email),
        Err(e) => {
            println!("[callback_server] failed to save account: {}", e);
            let _ = request.respond(error_page(&format!("アカウント保存に失敗しました: {}", e)));
            return;
        }
    }

    // Notify frontend that a new account was added via OAuth
    if let Some(window) = app.get_webview_window("main") {
        match window.emit_to(EventTarget::webview("main"), "oauth-account-added", &email) {
            Ok(_) => println!("[callback_server] emitted oauth-account-added for {}", email),
            Err(e) => println!("[callback_server] failed to emit event: {}", e),
        }
    } else {
        println!("[callback_server] main window not found");
    }

    // Return success page
    let success_html = if dev_url.is_some() {
        r#"<html><body style="font-family:Arial,sans-serif;text-align:center;padding:40px">
<h1>認証完了</h1><p>ブラウザを閉じて、アプリに戻ってください。</p></body></html>"#
    } else {
        &format!("<html><body style=\"font-family:Arial,sans-serif;text-align:center;padding:40px\"><h1>認証完了</h1><p>アカウント「{}」を追加しました。<br>ブラウザを閉じて、アプリに戻ってください。</p></body></html>", email)
    };
    let _ = request.respond(Response::from_string(success_html).with_status_code(StatusCode(200)));
}

pub fn start_server(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        use socket2::{Domain, Protocol, Socket, Type};
        use std::net::{SocketAddr, TcpListener};

        let addr: SocketAddr = format!("127.0.0.1:{}", CALLBACK_PORT).parse().unwrap();
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

        let server = Server::from_listener(listener, None)
            .expect("Failed to start OAuth callback server");

        println!("[callback_server] listening on port {}", CALLBACK_PORT);

        for request in server.incoming_requests() {
            let app = app.clone();
            println!("[callback_server] incoming request");
            tauri::async_runtime::spawn(async move {
                handle_request(request, app).await;
            });
        }
    });
}
