use crate::commands::auth::get_access_token_for;
use crate::commands::auth::refresh_access_token_for;
use crate::error::AppError;
use rand::Rng;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tauri::Emitter;

#[derive(Debug, Serialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct GmailMessageSummary {
    pub id: String,
    pub thread_id: String,
    pub subject: String,
    pub from: String,
    pub date: String,
    pub snippet: String,
    pub unread: bool,
    pub starred: bool,
}

#[derive(Debug, Serialize)]
#[allow(non_snake_case)]
pub struct ListMessagesResponse {
    pub messages: Option<Vec<GmailMessageSummary>>,
    #[serde(rename = "nextPageToken")]
    pub nextPageToken: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentInfo {
    pub filename: String,
    pub mime_type: String,
    pub size_bytes: u64,
    /// Base64-encoded attachment data (inline for smaller files)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageDetail {
    pub id: String,
    pub snippet: String,
    pub subject: String,
    pub from: String,
    pub date: String,
    pub body: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub attachments: Vec<AttachmentInfo>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ListMessagesArgs {
    pub account_id: String,
    pub page_token: Option<String>,
    pub max_results: Option<u32>,
    pub label_id: Option<String>,
    pub query: Option<String>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct MessageDetailArgs {
    pub account_id: String,
    pub message_id: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GmailLabel {
    pub id: String,
    pub name: String,
    pub display_name: String,
    pub label_type: String,
    pub messages_unread: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListLabelsResponse {
    pub labels: Vec<GmailLabel>,
}

#[tauri::command]
pub async fn list_labels(
    app: tauri::AppHandle,
    account_id: String,
) -> Result<ListLabelsResponse, AppError> {
    // keyringからアクセストークンを直接取得（事前tokeninfoチェックは行わない）
    let token = get_access_token_for(&account_id)?.ok_or_else(|| {
        AppError::AuthError("No access token found. Please login first.".to_string())
    })?;

    let client = Client::new();
    let url = "https://gmail.googleapis.com/gmail/v1/users/me/labels";
    let mut response = client
        .get(url)
        .bearer_auth(&token)
        .send()
        .await
        .map_err(AppError::from)?;

    // レスポンスが401の場合: トークンをリフレッシュして自動リトライ
    if response.status() == 401 {
        println!(
            "[gmail] list_labels: 401 received, refreshing token for {}",
            account_id
        );
        let new_token = refresh_access_token_for(&account_id).await?;
        // 新しいトークンは keyring に再保存済み（refresh_access_token_for 内で保存される）
        let _ = app.emit("token-refreshed", &account_id);
        response = client
            .get(url)
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
            "Gmail API error: {}",
            error_text
        )));
    }

    let json: serde_json::Value = response.json().await.map_err(AppError::from)?;

    let labels: Vec<GmailLabel> = json
        .get("labels")
        .and_then(|l| l.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|l| {
                    let raw_name = l
                        .get("name")
                        .and_then(|n| n.as_str())
                        .unwrap_or("")
                        .to_string();
                    let display_name = l
                        .get("displayName")
                        .and_then(|d| d.as_str())
                        .unwrap_or(&raw_name)
                        .to_string();
                    Some(GmailLabel {
                        id: l.get("id")?.as_str()?.to_string(),
                        name: raw_name,
                        display_name,
                        label_type: l.get("type")?.as_str()?.to_string(),
                        messages_unread: l
                            .get("messagesUnread")
                            .and_then(|v| v.as_u64())
                            .unwrap_or(0),
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    Ok(ListLabelsResponse { labels })
}

// 注: get_valid_token() は削除された。
// 以前はここでtokeninfoエンドポイントを事前に叩いていたが、不要なAPI呼び出しを削減するため廃止した。
// 代わりに、各Gmail APIコマンドでアクセストークンを直接keyringから取得し、
// レスポンスが401の場合にのみトークンリフレッシュ + リトライする方式に変更した。
fn is_url_char(c: char) -> bool {
    c.is_alphanumeric() || "-._~:/?#[]@!$&'()*+,=%".contains(c)
}

/// Measure byte length of valid URL characters starting from the beginning of `s`
fn valid_url_len(s: &str) -> usize {
    let bytes = s.as_bytes();
    let mut len = 0;
    while len < bytes.len() {
        if !s[..len].is_char_boundary(len) {
            return len;
        }
        let ch = s[len..].chars().next();
        match ch {
            Some(c) if is_url_char(c) => len += c.len_utf8(),
            _ => break,
        }
    }
    len
}

/// Strip trailing punctuation that is unlikely part of the URL
fn strip_trailing_punctuation(url: &str) -> &str {
    let trailing = ['.', ',', ';', ':', '"', '\'', ')', '>'];
    url.trim_end_matches(|c| trailing.contains(&c))
}

/// Convert plain text to HTML: escape special chars, hyperlink URLs, convert newlines to <br>
fn plain_text_to_html(text: &str) -> String {
    let mut result = String::with_capacity(text.len());
    for line in text.split('\n') {
        let mut i = 0;
        while i < line.len() {
            let mut found_pos = None;

            for scheme in ["https://", "http://", "ftp://"] {
                if let Some(pos) = line[i..].find(scheme) {
                    let abs_pos = i + pos;
                    found_pos = Some(abs_pos.min(found_pos.unwrap_or(line.len())));
                }
            }

            match found_pos {
                Some(pos) => {
                    // Escape non-URL text before the URL
                    for c in line[i..pos].chars() {
                        match c {
                            '&' => result.push_str("&amp;"),
                            '<' => result.push_str("&lt;"),
                            '>' => result.push_str("&gt;"),
                            '"' => result.push_str("&quot;"),
                            c => result.push(c),
                        }
                    }

                    // Extract URL
                    let url_start = pos;
                    let url_len = valid_url_len(&line[url_start..]);
                    let url = strip_trailing_punctuation(&line[url_start..url_start + url_len]);

                    result.push_str("<a href=\"");
                    // Escape URL for href attribute (only &)
                    result.push_str(&url.replace('&', "&amp;"));
                    result.push_str("\" target=\"_blank\" rel=\"noopener\">");
                    result.push_str(url);
                    result.push_str("</a>");

                    i = url_start + url.len();
                }
                None => {
                    // No more URLs; escape the rest
                    for c in line[i..].chars() {
                        match c {
                            '&' => result.push_str("&amp;"),
                            '<' => result.push_str("&lt;"),
                            '>' => result.push_str("&gt;"),
                            '"' => result.push_str("&quot;"),
                            c => result.push(c),
                        }
                    }
                    break;
                }
            }
        }
        result.push_str("<br>");
    }
    result
}

/// 再帰的にpayloadとネストされたpartsからヘッダーを取得（大文字小文字不感）
fn extract_headers_recursive(
    part: &serde_json::Value,
    subject: &mut String,
    from: &mut String,
    date: &mut String,
) {
    if let Some(headers) = part["headers"].as_array() {
        for header in headers {
            let name = header["name"].as_str().unwrap_or("");
            let value = header["value"].as_str().unwrap_or("").to_string();
            let name_upper = name.to_uppercase();
            match name_upper.as_str() {
                "SUBJECT" => *subject = value,
                "FROM" => *from = value,
                "DATE" => *date = value,
                _ => {}
            }
        }
    }

    if let Some(parts) = part["parts"].as_array() {
        for subpart in parts {
            extract_headers_recursive(subpart, subject, from, date);
        }
    }
}

async fn fetch_message_meta(
    client: &Client,
    token: &str,
    msg_id: &str,
) -> Option<(String, String, String, String, bool, bool)> {
    let url = format!(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/{}?format=metadata",
        msg_id
    );

    let response = client.get(&url).bearer_auth(token).send().await;

    let response = match response {
        Ok(r) => r,
        Err(e) => {
            println!("[gmail] fetch_meta {} error: {}", msg_id, e);
            return None;
        }
    };

    if !response.status().is_success() {
        println!(
            "[gmail] fetch_meta {} status: {}",
            msg_id,
            response.status()
        );
        return None;
    }

    let json = match response.json::<serde_json::Value>().await {
        Ok(j) => j,
        Err(e) => {
            println!("[gmail] fetch_meta {} parse error: {}", msg_id, e);
            return None;
        }
    };

    // Debug: log all header names, and Subject/From/Date full values
    if let Some(payload) = json.get("payload") {
        if let Some(headers) = payload.get("headers").and_then(|h| h.as_array()) {
            println!(
                "[gmail] fetch_meta {} headers count: {}",
                msg_id,
                headers.len()
            );
            let mut has_subject = false;
            let mut has_from = false;
            let mut has_date = false;
            for h in headers.iter() {
                if let (Some(name), Some(value)) = (
                    h.get("name").and_then(|n| n.as_str()),
                    h.get("value").and_then(|v| v.as_str()),
                ) {
                    match name {
                        "Subject" => {
                            has_subject = true;
                            println!("  [Subject] = {}", value);
                        }
                        "From" => {
                            has_from = true;
                            println!("  [From] = {}", value);
                        }
                        "Date" => {
                            has_date = true;
                            println!("  [Date] = {}", value);
                        }
                        _ => {
                            println!("  [{}]", name);
                        }
                    }
                }
            }
            println!(
                "[gmail] fetch_meta {} S={} F={} D={}",
                msg_id, has_subject, has_from, has_date
            );
        } else {
            println!("[gmail] fetch_meta {} NO headers in payload", msg_id);
        }
        // Also check nested parts for headers
        if let Some(parts) = payload.get("parts").and_then(|p| p.as_array()) {
            println!("[gmail] fetch_meta {} parts count: {}", msg_id, parts.len());
            for (i, part) in parts.iter().enumerate() {
                if let Some(headers) = part.get("headers").and_then(|h| h.as_array()) {
                    println!(
                        "[gmail] fetch_meta {} part[{}] has {} headers",
                        msg_id,
                        i,
                        headers.len()
                    );
                    for h in headers.iter() {
                        if let (Some(name), Some(value)) = (
                            h.get("name").and_then(|n| n.as_str()),
                            h.get("value").and_then(|v| v.as_str()),
                        ) {
                            match name {
                                "Subject" => println!("  [part[{}] Subject] = {}", i, value),
                                "From" => println!("  [part[{}] From] = {}", i, value),
                                "Date" => println!("  [part[{}] Date] = {}", i, value),
                                _ => println!("  [part[{}] {}]", i, name),
                            }
                        }
                    }
                }
            }
        }
    }

    let snippet = json["snippet"].as_str().unwrap_or("").to_string();
    let mut subject = "No Subject".to_string();
    let mut from = "Unknown".to_string();
    let mut date = "Unknown".to_string();

    if let Some(payload) = json.get("payload") {
        extract_headers_recursive(payload, &mut subject, &mut from, &mut date);
    }

    let label_ids: Vec<&str> = json
        .get("labelIds")
        .and_then(|l| l.as_array())
        .map(|arr| arr.iter().filter_map(|v| v.as_str()).collect())
        .unwrap_or_default();
    let unread = label_ids.contains(&"UNREAD");
    let starred = label_ids.contains(&"STARRED");

    println!(
        "[gmail] fetch_meta {} result: subject='{}' from='{}' date='{}' unread={} starred={}",
        msg_id, subject, from, date, unread, starred
    );

    Some((subject, from, date, snippet, unread, starred))
}

#[tauri::command]
pub async fn list_messages(
    app: tauri::AppHandle,
    account_id: String,
    page_token: Option<String>,
    max_results: Option<u32>,
    label_id: Option<String>,
    query: Option<String>,
) -> Result<ListMessagesResponse, AppError> {
    let max_results = max_results.unwrap_or(20);
    println!(
        "[gmail] list_messages: account_id={}, page_token={:?}, max_results={}, label_id={:?}, query={:?}",
        account_id, page_token, max_results, label_id, query
    );

    // keyringからアクセストークンを直接取得（事前tokeninfoチェックは行わない）
    let token = get_access_token_for(&account_id)?.ok_or_else(|| {
        AppError::AuthError("No access token found. Please login first.".to_string())
    })?;

    let client = Client::new();

    let do_list_request = |token: &str, page_token: Option<&str>, label_id: Option<&str>, query: Option<&str>| {
        let client = &client;
        let max_results = max_results;
        let mut request = client
            .get("https://gmail.googleapis.com/gmail/v1/users/me/messages")
            .bearer_auth(token)
            .query(&[("maxResults", &max_results.to_string())]);
        if let Some(pt) = page_token {
            if !pt.is_empty() {
                request = request.query(&[("pageToken", pt)]);
            }
        }
        if let Some(lid) = label_id {
            if !lid.is_empty() {
                request = request.query(&[("labelIds", lid)]);
            }
        }
        if let Some(q) = query {
            if !q.is_empty() {
                request = request.query(&[("q", q)]);
            }
        }
        request.send()
    };

    let mut response = do_list_request(&token, page_token.as_deref(), label_id.as_deref(), query.as_deref())
        .await
        .map_err(AppError::from)?;

    // レスポンスが401の場合: トークンをリフレッシュして自動リトライ
    if response.status() == 401 {
        println!(
            "[gmail] list_messages: 401 received, refreshing token for {}",
            account_id
        );
        let new_token = refresh_access_token_for(&account_id).await?;
        // 新しいトークンは keyring に再保存済み（refresh_access_token_for 内で保存される）
        let _ = app.emit("token-refreshed", &account_id);
        response = do_list_request(&new_token, page_token.as_deref(), label_id.as_deref(), query.as_deref())
            .await
            .map_err(AppError::from)?;
        if response.status() == 401 {
            // リトライ後も401の場合: クレデンシャルが無効である可能性が高い
            println!("[gmail] list_messages: still 401 after token refresh for {} - credentials may be invalid", account_id);
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
            "Gmail API error: {}",
            error_text
        )));
    }

    // Parse response manually via serde_json::Value for robustness against Gmail API shape changes
    let json: serde_json::Value = response.json().await.map_err(AppError::from)?;

    // Extract message IDs from the messages array
    let raw_messages: &[serde_json::Value] = json
        .get("messages")
        .and_then(|m| m.as_array())
        .map(|v| v.as_slice())
        .unwrap_or(&[]);

    let message_ids: Vec<String> = raw_messages
        .iter()
        .filter_map(|m| {
            m.get("id")
                .and_then(|id| id.as_str())
                .map(|s| s.to_string())
        })
        .collect();

    // Build summary list with default fields, then enrich
    let mut messages: Vec<GmailMessageSummary> = raw_messages
        .iter()
        .filter_map(|m| {
            let id_str = m.get("id").and_then(|v| v.as_str())?;
            let thread_id_str = m
                .get("threadId")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            Some(GmailMessageSummary {
                id: id_str.to_string(),
                thread_id: thread_id_str,
                subject: String::new(),
                from: String::new(),
                date: String::new(),
                snippet: String::new(),
                unread: false,
                starred: false,
            })
        })
        .collect();

    println!(
        "[gmail] Found {} message IDs, fetching metadata",
        message_ids.len()
    );

    // Fetch metadata for each message
    let mut enriched_count = 0;
    for msg_id in &message_ids {
        if let Some((subject, from, date, snippet, unread, starred)) =
            fetch_message_meta(&client, &token, msg_id).await
        {
            let id_str = msg_id.as_str();
            if let Some(m) = messages.iter_mut().find(|msg| msg.id.as_str() == id_str) {
                m.subject = subject;
                m.from = from;
                m.date = date;
                m.snippet = snippet;
                m.unread = unread;
                m.starred = starred;
                enriched_count += 1;
            }
        }
    }

    println!(
        "[gmail] Enriched {} of {} messages",
        enriched_count,
        message_ids.len()
    );

    // Extract and normalize nextPageToken (empty string → None)
    let next_page_token = json
        .get("nextPageToken")
        .and_then(|t| t.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());

    println!("[gmail] returning nextPageToken={:?}", next_page_token);

    Ok(ListMessagesResponse {
        messages: Some(messages),
        nextPageToken: next_page_token,
    })
}

#[tauri::command]
pub async fn get_message_details(
    app: tauri::AppHandle,
    account_id: String,
    message_id: String,
) -> Result<MessageDetail, AppError> {
    let client = Client::new();
    let url = format!(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/{}",
        message_id
    );

    // keyringからアクセストークンを直接取得（事前tokeninfoチェックは行わない）
    let token = get_access_token_for(&account_id)?.ok_or_else(|| {
        AppError::AuthError("No access token found. Please login first.".to_string())
    })?;

    let mut response = client
        .get(&url)
        .bearer_auth(&token)
        .send()
        .await
        .map_err(AppError::from)?;

    // レスポンスが401の場合: トークンをリフレッシュして自動リトライ
    if response.status() == 401 {
        println!(
            "[gmail] get_message_details: 401 received, refreshing token for {}",
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
            println!("[gmail] get_message_details: still 401 after token refresh for {} - credentials may be invalid", account_id);
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
            "Gmail API error: {}",
            error_text
        )));
    }

    let json: serde_json::Value = response.json().await.map_err(AppError::from)?;

    let snippet = json["snippet"].as_str().unwrap_or("").to_string();

    let mut subject = "No Subject".to_string();
    let mut from = "Unknown Sender".to_string();
    let mut date = "Unknown Date".to_string();
    let mut body = "".to_string();

    // 1. Parse Headers (recursive — searches payload and nested parts)
    if let Some(payload) = json.get("payload") {
        extract_headers_recursive(payload, &mut subject, &mut from, &mut date);
    }

    // 2. Parse Body (Recursive search for text/plain, text/html, and image/* with CID)
    let payload = &json["payload"];

    let mut text_body = "".to_string();
    let mut html_body = "".to_string();
    let mut cid_map: Vec<(String, String)> = Vec::new();

    fn search_parts(
        part: &serde_json::Value,
        text_ref: &mut String,
        html_ref: &mut String,
        cids: &mut Vec<(String, String)>,
        attachments: &mut Vec<AttachmentInfo>,
    ) {
        let _mime = part["mimeType"].as_str().unwrap_or("unknown");

        // Extract Content-ID, charset, and filename from headers
        let (content_id, charset, filename_hdr) = if let Some(headers) = part["headers"].as_array()
        {
            let (mut cid, mut cs, mut fn_name): (Option<String>, Option<String>, Option<String>) =
                (None, None, None);
            for h in headers {
                let name = h.get("name").and_then(|n| n.as_str());
                let value = h.get("value").and_then(|v| v.as_str());
                let name_upper = name.map(|n| n.to_uppercase());
                match name_upper.as_deref() {
                    Some("CONTENT-ID") | Some("CID") => {
                        cid = value.map(|s| s.to_string());
                    }
                    Some("CONTENT-TYPE") => {
                        cs = value.and_then(|v| {
                            v.find("charset")
                                .map(|idx| &v[idx..])
                                .and_then(|s| s.splitn(2, '=').nth(1))
                                .map(|s| {
                                    s.trim_matches(|c| c == '"' || c == '\'').trim().to_string()
                                })
                        });
                    }
                    Some("CONTENT-DISPOSITION") => {
                        fn_name = value.and_then(|v| {
                            v.find("filename")
                                .map(|idx| &v[idx..])
                                .and_then(|s| s.splitn(2, '=').nth(1))
                                .map(|s| s.trim_matches('"').trim().to_string())
                        });
                    }
                    _ => {}
                }
            }
            (cid, cs, fn_name)
        } else {
            (None, None, None)
        };

        if let Some(data) = part["body"]["data"].as_str() {
            let mime_type = part["mimeType"].as_str().unwrap_or("");

            // Gmail API uses URL-safe base64 without padding, but some messages
            // may have padding or use standard base64. Try multiple strategies.
            let decoded_bytes =
                base64::Engine::decode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, data)
                    .or_else(|_| {
                        let stripped = data.trim_end_matches('=');
                        base64::Engine::decode(
                            &base64::engine::general_purpose::URL_SAFE_NO_PAD,
                            stripped,
                        )
                    })
                    .or_else(|_| {
                        base64::Engine::decode(&base64::engine::general_purpose::STANDARD, data)
                    })
                    .or_else(|_| {
                        let stripped = data.trim_end_matches('=');
                        base64::Engine::decode(
                            &base64::engine::general_purpose::STANDARD_NO_PAD,
                            stripped,
                        )
                    });

            if let Ok(decoded) = decoded_bytes {
                if mime_type.starts_with("text/") {
                    let charset_ref = encoding_rs::Encoding::for_label(
                        charset.as_ref().map(|s| s.as_bytes()).unwrap_or(b"utf-8"),
                    )
                    .unwrap_or(encoding_rs::UTF_8);
                    let (decoded_str, _, had_errors) = charset_ref.decode(&decoded);

                    // If charset decoding had errors, try UTF-8 as fallback
                    let (final_str, _, _) = if had_errors && charset.as_deref() != Some("utf-8") {
                        encoding_rs::UTF_8.decode(&decoded)
                    } else {
                        (decoded_str, charset_ref, had_errors)
                    };

                    // For text/html, always set body even with decode errors
                    // (replacement chars for bad bytes, but rest of HTML is usable)
                    if mime_type == "text/html" {
                        *html_ref = final_str.to_string();
                    } else if mime_type == "text/plain" {
                        *text_ref = final_str.to_string();
                    }
                } else if mime_type.starts_with("image/") {
                    if let Some(cid) = &content_id {
                        let b64 = base64::Engine::encode(
                            &base64::engine::general_purpose::STANDARD,
                            &decoded,
                        );
                        let data_uri = format!("data:{};base64,{}", mime_type, b64);
                        cids.push((cid.clone(), data_uri));
                    }
                } else {
                    // File attachment (PDF, DOC, ZIP, etc.)
                    if let Some(filename) = &filename_hdr {
                        let b64_data = base64::Engine::encode(
                            &base64::engine::general_purpose::STANDARD,
                            &decoded,
                        );
                        attachments.push(AttachmentInfo {
                            filename: filename.clone(),
                            mime_type: mime_type.to_string(),
                            size_bytes: decoded.len() as u64,
                            data: Some(b64_data),
                        });
                    }
                }
            }
        }
        if let Some(parts) = part["parts"].as_array() {
            for subpart in parts {
                search_parts(subpart, text_ref, html_ref, cids, attachments);
            }
        }
    }

    // Collect attachments alongside body parsing
    let mut attachments: Vec<AttachmentInfo> = Vec::new();
    search_parts(
        payload,
        &mut text_body,
        &mut html_body,
        &mut cid_map,
        &mut attachments,
    );

    // Prefer HTML body for proper rendering; fallback to plain text
    if !html_body.is_empty() {
        // Replace cid: references with base64 data URIs
        // Use unique placeholders to avoid double-replacement corruption
        let mut resolved = html_body.clone();
        let mut replacements: Vec<(String, String)> = Vec::new();
        for (idx, (cid, data_uri)) in cid_map.iter().enumerate() {
            let placeholder = format!("__CID_REPLACEMENT_{}__", idx);
            // Normalize CID: strip angle brackets if present (<cid:xxx> -> cid:xxx)
            let normalized = cid.trim_start_matches("<").trim_end_matches(">");
            let cid_ref = if normalized.starts_with("cid:") {
                normalized.to_string()
            } else {
                "cid:".to_string() + normalized
            };
            let cid_ref_angle = "<".to_string() + &cid_ref + ">";
            // Replace both <cid:xxx> and cid:xxx forms with placeholder
            resolved = resolved.replace(&cid_ref_angle, &placeholder);
            resolved = resolved.replace(&cid_ref, &placeholder);
            replacements.push((placeholder, data_uri.clone()));
        }
        // Now replace placeholders with actual data URIs (no risk of double-replace)
        for (placeholder, data_uri) in &replacements {
            resolved = resolved.replace(placeholder, data_uri);
        }
        body = resolved;
    } else if !text_body.is_empty() {
        body = plain_text_to_html(&text_body);
    }

    Ok(MessageDetail {
        id: message_id,
        snippet,
        subject,
        from,
        date,
        body,
        attachments,
    })
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SendEmailArgs {
    pub account_id: String,
    pub to: String,
    pub subject: String,
    pub body: String,
    #[serde(default)]
    pub cc: Option<String>,
    #[serde(default)]
    pub bcc: Option<String>,
    #[serde(default)]
    pub attachments: Vec<SendAttachment>,
}

/// Single attachment for sending an email.
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendAttachment {
    pub filename: String,
    /// MIME type override. When empty (`""`), the type is inferred from the file extension.
    #[serde(default)]
    pub mime_type: String,
    /// Base64-encoded binary data of the attachment.
    pub data: String,
}

/// Infer a MIME type from a file extension when the caller did not provide one.
fn infer_mime_type(filename: &str) -> String {
    let ext = std::path::Path::new(filename)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    match ext.as_str() {
        "pdf" => "application/pdf",
        "doc" | "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xls" | "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "ppt" | "pptx" => {
            "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        }
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        "txt" => "text/plain; charset=UTF-8",
        "csv" => "text/csv; charset=UTF-8",
        "htm" | "html" => "text/html; charset=UTF-8",
        "zip" => "application/zip",
        "gz" | "gzip" => "application/gzip",
        "tar" => "application/x-tar",
        "json" => "application/json",
        "xml" => "application/xml",
        _ => "application/octet-stream",
    }
    .to_string()
}

/// Generate a random MIME boundary string using the `rand` crate.
fn generate_boundary() -> String {
    let mut rng = rand::thread_rng();
    let part_num: u32 = rng.gen();
    let random_str: u64 = rng.gen();
    format!("----=_Part_{}_{}", part_num, random_str)
}

/// Build a full MIME message (RFC 2822) with attachments.
/// Returns the raw email string ready for Gmail API `users.messages.send`.
fn build_multipart_message(
    to: &str,
    subject: &str,
    body: &str,
    cc: Option<&str>,
    bcc: Option<&str>,
    attachments: &[SendAttachment],
) -> String {
    let boundary = generate_boundary();

    let mut msg = String::with_capacity(4096);

    // Headers
    msg.push_str(&format!("To: {}\r\n", to));
    msg.push_str(&format!("Subject: {}\r\n", subject));
    if let Some(cc_addr) = cc {
        msg.push_str(&format!("Cc: {}\r\n", cc_addr));
    }
    if let Some(bcc_addr) = bcc {
        msg.push_str(&format!("Bcc: {}\r\n", bcc_addr));
    }
    msg.push_str(&format!(
        "MIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=\"{}\"\r\n\r\n",
        boundary
    ));

    // HTML body part
    msg.push_str(&format!("--{}\r\n", boundary));
    msg.push_str("Content-Type: text/html; charset=UTF-8\r\n\r\n");
    msg.push_str(body);
    msg.push_str("\r\n");

    // Attachment parts
    for att in attachments {
        msg.push_str(&format!("--{}\r\n", boundary));
        let mime = if att.mime_type.is_empty() {
            infer_mime_type(&att.filename)
        } else {
            att.mime_type.clone()
        };
        msg.push_str(&format!("Content-Type: {}\r\n", mime));
        msg.push_str(&format!(
            "Content-Disposition: attachment; filename=\"{}\"\r\n",
            att.filename
        ));
        msg.push_str("Content-Transfer-Encoding: base64\r\n\r\n");
        msg.push_str(&att.data);
        msg.push_str("\r\n");
    }

    // Closing boundary
    msg.push_str(&format!("--{}--\r\n", boundary));

    msg
}

/// 引数構造体: Gmail API messages.modifyLabels
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModifyLabelsArgs {
    pub account_id: String,
    pub message_id: String,
    /// 追加するラベルIDリスト (LABEL_STARRED, LABEL_IMPORTANT など)
    #[serde(default)]
    pub add_label_ids: Vec<String>,
    /// 削除するラベルIDリスト (LABEL_INBOX, LABEL_TRASH など)
    #[serde(default)]
    pub remove_label_ids: Vec<String>,
}

/// レスポンス: modifyLabels の結果 (空だが成功を示す)
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModifyLabelsResponse {
    pub success: bool,
    pub message_id: String,
}

/// レスポンス: sendEmail の結果
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SendEmailResponse {
    pub success: bool,
    pub message_id: String,
}

#[tauri::command]
pub async fn send_email(
    app: tauri::AppHandle,
    account_id: String,
    to: String,
    subject: String,
    body: String,
    cc: Option<String>,
    bcc: Option<String>,
    attachments: Vec<SendAttachment>,
    scheduled_send_time_ms: Option<u64>,
) -> Result<SendEmailResponse, AppError> {
    let client = Client::new();
    let url = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

    // keyringからアクセストークンを直接取得（事前tokeninfoチェックは行わない）
    let token = get_access_token_for(&account_id)?.ok_or_else(|| {
        AppError::AuthError("No access token found. Please login first.".to_string())
    })?;

    // Build the raw RFC 2822 email message
    let raw = if attachments.is_empty() {
        // Plain text/html email (no attachments) — existing logic
        let mut headers = format!("To: {}\r\nSubject: {}\r\n", to, subject);
        if let Some(cc_addr) = &cc {
            headers.push_str(&format!("Cc: {}\r\n", cc_addr));
        }
        if let Some(bcc_addr) = &bcc {
            headers.push_str(&format!("Bcc: {}\r\n", bcc_addr));
        }
        headers.push_str("Content-Type: text/html; charset=UTF-8\r\nMIME-Version: 1.0\r\n\r\n");
        format!("{}{}", headers, body)
    } else {
        // Multipart MIME with attachments
        build_multipart_message(
            &to,
            &subject,
            &body,
            cc.as_deref(),
            bcc.as_deref(),
            &attachments,
        )
    };

    let raw_encoded = base64::Engine::encode(
        &base64::engine::general_purpose::URL_SAFE_NO_PAD,
        raw.as_bytes(),
    );

    // scheduled_send_time_ms が指定されていれば Gmail API に scheduledSendTimestamp を設定する
    // Gmail API は UNIX epoch 秒を要求するため、ミリ秒→秒に変換する
    let payload = if let Some(ts_ms) = scheduled_send_time_ms {
        let ts_secs = ts_ms / 1000;
        serde_json::json!({ "raw": raw_encoded, "scheduledSendTimestamp": ts_secs })
    } else {
        serde_json::json!({ "raw": raw_encoded })
    };

    println!(
        "[gmail] send_email: account_id={}, scheduled={}",
        account_id,
        scheduled_send_time_ms.is_some()
    );

    let mut response = client
        .post(url)
        .bearer_auth(&token)
        .json(&payload)
        .send()
        .await
        .map_err(AppError::from)?;

    // レスポンスが401の場合: トークンをリフレッシュして自動リトライ
    if response.status() == 401 {
        println!(
            "[gmail] send_email: 401 received, refreshing token for {}",
            account_id
        );
        let new_token = refresh_access_token_for(&account_id).await?;
        // 新しいトークンは keyring に再保存済み（refresh_access_token_for 内で保存される）
        let _ = app.emit("token-refreshed", &account_id);
        response = client
            .post(url)
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
            "Gmail API error: {}",
            error_text
        )));
    }

    // Parse the response to get the message ID
    let json: serde_json::Value = response.json().await.map_err(AppError::from)?;
    let message_id = json["id"].as_str().unwrap_or("").to_string();

    println!("[gmail] email sent successfully for {}, message_id={}", account_id, message_id);
    Ok(SendEmailResponse {
        success: true,
        message_id,
    })
}

/// Gmail API messages.modifyLabels を呼び出してラベルの追加/削除を行う。
/// スター切替、アーカイブ、ゴミ箱移動、スパム報告など、すべてこの1つのコマンドで実現する。
#[tauri::command]
pub async fn modify_labels(
    app: tauri::AppHandle,
    account_id: String,
    message_id: String,
    add_label_ids: Vec<String>,
    remove_label_ids: Vec<String>,
) -> Result<ModifyLabelsResponse, AppError> {
    let client = Client::new();
    let url = format!(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/{}/modify",
        message_id
    );

    // keyringからアクセストークンを直接取得
    let token = get_access_token_for(&account_id)?.ok_or_else(|| {
        AppError::AuthError("No access token found. Please login first.".to_string())
    })?;

    let payload = serde_json::json!({
        "addLabelIds": if add_label_ids.is_empty() { serde_json::Value::Null } else { serde_json::json!(add_label_ids) },
        "removeLabelIds": if remove_label_ids.is_empty() { serde_json::Value::Null } else { serde_json::json!(remove_label_ids) },
    });

    // ログ出力: 何を行うか可視化する
    println!(
        "[gmail] modify_labels: message_id={}, add={:?}, remove={:?}",
        message_id, add_label_ids, remove_label_ids
    );

    let mut response = client
        .post(&url)
        .bearer_auth(&token)
        .json(&payload)
        .send()
        .await
        .map_err(AppError::from)?;

    // レスポンスが401の場合: トークンをリフレッシュして自動リトライ
    if response.status() == 401 {
        println!(
            "[gmail] modify_labels: 401 received, refreshing token for {}",
            account_id
        );
        let new_token = refresh_access_token_for(&account_id).await?;
        let _ = app.emit("token-refreshed", &account_id);
        response = client
            .post(&url)
            .bearer_auth(&new_token)
            .json(&payload)
            .send()
            .await
            .map_err(AppError::from)?;
        if response.status() == 401 {
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
            "Gmail API modifyLabels error: {}",
            error_text
        )));
    }

    println!(
        "[gmail] modify_labels: success for message_id={}",
        message_id
    );
    Ok(ModifyLabelsResponse {
        success: true,
        message_id,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- is_url_char tests ---
    #[test]
    fn is_url_char_alphanumeric() {
        assert!(is_url_char('a'));
        assert!(is_url_char('Z'));
        assert!(is_url_char('9'));
    }

    #[test]
    fn is_url_char_allowed_symbols() {
        assert!(is_url_char('-'));
        assert!(is_url_char('.'));
        assert!(is_url_char('/'));
        assert!(is_url_char('?'));
        assert!(is_url_char('#'));
        assert!(is_url_char('@'));
        assert!(is_url_char('%'));
    }

    #[test]
    fn is_url_char_rejects_control_chars() {
        assert!(!is_url_char('\n'));
        assert!(!is_url_char('\r'));
        assert!(!is_url_char('\t'));
        assert!(!is_url_char('\0'));
    }

    // --- valid_url_len tests ---
    #[test]
    fn valid_url_len_simple_http() {
        let url = "https://example.com/path?q=1";
        assert_eq!(valid_url_len(url), url.len());
    }

    #[test]
    fn valid_url_len_empty() {
        assert_eq!(valid_url_len(""), 0);
    }

    #[test]
    fn valid_url_len_unicode() {
        // Each CJK char is 3 bytes in UTF-8, so 3 chars = 9 bytes.
        // Space is not a valid URL char, so the function stops there.
        let s = "日本語 hello";
        assert_eq!(valid_url_len(s), 9);
    }

    #[test]
    fn valid_url_len_pure_unicode() {
        // CJK chars are alphanumeric in Rust (Unicode-aware), so they count
        assert_eq!(valid_url_len("日本語"), 9); // 3 × 3 bytes
    }

    #[test]
    fn valid_url_len_stops_at_newline() {
        assert_eq!(valid_url_len("hello\nworld"), 5);
    }

    // --- strip_trailing_punctuation tests ---
    #[test]
    fn strip_trailing_strips_period() {
        assert_eq!(
            strip_trailing_punctuation("https://x.com."),
            "https://x.com"
        );
    }

    #[test]
    fn strip_trailing_strips_multiple() {
        assert_eq!(
            strip_trailing_punctuation("https://x.com..."),
            "https://x.com"
        );
    }

    #[test]
    fn strip_trailing_strips_closing_paren() {
        assert_eq!(
            strip_trailing_punctuation("https://x.com)"),
            "https://x.com"
        );
    }

    #[test]
    fn strip_trailing_no_change_if_none() {
        let url = "https://example.com/path";
        assert_eq!(strip_trailing_punctuation(url), url);
    }

    #[test]
    fn strip_trailing_strips_comma_semicolon_colon() {
        assert_eq!(
            strip_trailing_punctuation("https://x.com;,:"),
            "https://x.com"
        );
    }

    // --- plain_text_to_html tests (HIGH VALUE) ---
    #[test]
    fn plain_text_to_html_escapes_ampersand() {
        assert_eq!(plain_text_to_html("a & b"), "a &amp; b<br>");
    }

    #[test]
    fn plain_text_to_html_escapes_less_than() {
        assert_eq!(plain_text_to_html("<div>"), "&lt;div&gt;<br>");
    }

    #[test]
    fn plain_text_to_html_converts_newlines() {
        assert_eq!(plain_text_to_html("line1\nline2"), "line1<br>line2<br>");
    }

    #[test]
    fn plain_text_to_html_links_https_url() {
        let result = plain_text_to_html("Visit https://example.com please");
        assert!(result.contains(r#"href="https://example.com""#));
        assert!(result.contains(r#"target="_blank""#));
        assert!(result.contains("</a>"));
    }

    #[test]
    fn plain_text_to_html_links_http_url() {
        let result = plain_text_to_html("See http://old-site.org");
        assert!(result.contains(r#"href="http://old-site.org""#));
    }

    #[test]
    fn plain_text_to_html_links_ftp_url() {
        let result = plain_text_to_html("Files at ftp://files.example.com/pub");
        assert!(result.contains(r#"href="ftp://files.example.com/pub""#));
    }

    #[test]
    fn plain_text_to_html_strips_trailing_punctuation_from_url() {
        let result = plain_text_to_html("Go to https://example.com. Now.");
        // The period after the URL should be stripped from href, then re-added as text
        assert!(result.contains(r#"href="https://example.com""#));
    }

    #[test]
    fn plain_text_to_html_handles_multiple_urls() {
        let result = plain_text_to_html("A https://a.com and http://b.org end");
        assert!(result.contains(r#"href="https://a.com""#));
        assert!(result.contains(r#"href="http://b.org""#));
    }

    #[test]
    fn plain_text_to_html_amps_in_url_are_escaped() {
        let result = plain_text_to_html("https://example.com?foo=1&bar=2");
        // The href attribute should escape & to &amp;
        assert!(result.contains("&amp;"));
    }

    #[test]
    fn plain_text_to_html_empty_string() {
        assert_eq!(plain_text_to_html(""), "<br>");
    }

    #[test]
    fn plain_text_to_html_only_newlines() {
        assert_eq!(plain_text_to_html("\n\n"), "<br><br><br>");
    }

    // --- extract_headers_recursive tests ---
    #[test]
    fn extract_headers_finds_subject() {
        let payload = serde_json::json!({
            "headers": [{"name": "Subject", "value": "Test Subject"}]
        });
        let (mut subj, mut from, mut date) = ("".to_string(), "".to_string(), "".to_string());
        extract_headers_recursive(&payload, &mut subj, &mut from, &mut date);
        assert_eq!(subj, "Test Subject");
    }

    #[test]
    fn extract_headers_case_insensitive() {
        let payload = serde_json::json!({
            "headers": [
                {"name": "subject", "value": "lowercase subject"},
                {"name": "FROM", "value": "User <user@example.com>"},
                {"name": "date", "value": "Mon, 1 Jan 2024"}
            ]
        });
        let (mut subj, mut from, mut date) = ("".to_string(), "".to_string(), "".to_string());
        extract_headers_recursive(&payload, &mut subj, &mut from, &mut date);
        assert_eq!(subj, "lowercase subject");
        assert_eq!(from, "User <user@example.com>");
        assert_eq!(date, "Mon, 1 Jan 2024");
    }

    #[test]
    fn extract_headers_nested_parts() {
        let payload = serde_json::json!({
            "headers": [],
            "parts": [{
                "headers": [{"name": "Subject", "value": "Nested Subject"}],
                "parts": []
            }]
        });
        let (mut subj, _, _) = ("".to_string(), "".to_string(), "".to_string());
        extract_headers_recursive(&payload, &mut subj, &mut String::new(), &mut String::new());
        assert_eq!(subj, "Nested Subject");
    }

    #[test]
    fn extract_headers_no_headers_key() {
        let payload = serde_json::json!({});
        let (mut subj, mut from, mut date) = ("".to_string(), "".to_string(), "".to_string());
        extract_headers_recursive(&payload, &mut subj, &mut from, &mut date);
        assert!(subj.is_empty());
        assert!(from.is_empty());
        assert!(date.is_empty());
    }

    #[test]
    fn extract_headers_deeply_nested() {
        let payload = serde_json::json!({
            "headers": [{"name": "Subject", "value": "Outer Subject"}],
            "parts": [{
                "mimeType": "multipart/mixed",
                "headers": [],
                "parts": [{
                    "headers": [
                        {"name": "From", "value": "Deep Sender <deep@test.com>"}
                    ],
                    "parts": []
                }]
            }]
        });
        let (mut subj, mut from, _) = ("".to_string(), "".to_string(), "".to_string());
        extract_headers_recursive(&payload, &mut subj, &mut from, &mut String::new());
        assert_eq!(subj, "Outer Subject"); // outer takes precedence
        assert_eq!(from, "Deep Sender <deep@test.com>");
    }

    // --- ModifyLabelsArgs serialization tests ---
    #[test]
    fn modify_labels_args_serializes_star_add() {
        let args = ModifyLabelsArgs {
            account_id: "user@test.com".to_string(),
            message_id: "msg123".to_string(),
            add_label_ids: vec!["LABEL_STARRED".to_string()],
            remove_label_ids: vec![],
        };
        let json = serde_json::to_value(&args).unwrap();
        assert_eq!(json["accountId"], "user@test.com");
        assert_eq!(json["messageId"], "msg123");
        assert_eq!(json["addLabelIds"], serde_json::json!(["LABEL_STARRED"]));
        assert!(json["removeLabelIds"].is_array());
        assert_eq!(json["removeLabelIds"].as_array().unwrap().len(), 0);
    }

    #[test]
    fn modify_labels_args_serializes_star_remove() {
        let args = ModifyLabelsArgs {
            account_id: "user@test.com".to_string(),
            message_id: "msg456".to_string(),
            add_label_ids: vec![],
            remove_label_ids: vec!["LABEL_STARRED".to_string()],
        };
        let json = serde_json::to_value(&args).unwrap();
        assert!(json["addLabelIds"].as_array().unwrap().is_empty());
        assert_eq!(json["removeLabelIds"], serde_json::json!(["LABEL_STARRED"]));
    }

    #[test]
    fn modify_labels_args_serializes_archive() {
        let args = ModifyLabelsArgs {
            account_id: "user@test.com".to_string(),
            message_id: "msg789".to_string(),
            add_label_ids: vec![],
            remove_label_ids: vec!["LABEL_INBOX".to_string()],
        };
        let json = serde_json::to_value(&args).unwrap();
        assert_eq!(json["removeLabelIds"], serde_json::json!(["LABEL_INBOX"]));
    }

    #[test]
    fn modify_labels_args_serializes_trash() {
        let args = ModifyLabelsArgs {
            account_id: "user@test.com".to_string(),
            message_id: "msgTrash".to_string(),
            add_label_ids: vec!["LABEL_TRASH".to_string()],
            remove_label_ids: vec!["LABEL_INBOX".to_string()],
        };
        let json = serde_json::to_value(&args).unwrap();
        assert_eq!(json["addLabelIds"], serde_json::json!(["LABEL_TRASH"]));
        assert_eq!(json["removeLabelIds"], serde_json::json!(["LABEL_INBOX"]));
    }

    #[test]
    fn modify_labels_args_serializes_spam() {
        let args = ModifyLabelsArgs {
            account_id: "user@test.com".to_string(),
            message_id: "msgSpam".to_string(),
            add_label_ids: vec!["LABEL_SPAM".to_string()],
            remove_label_ids: vec!["LABEL_INBOX".to_string()],
        };
        let json = serde_json::to_value(&args).unwrap();
        assert_eq!(json["addLabelIds"], serde_json::json!(["LABEL_SPAM"]));
    }

    #[test]
    fn modify_labels_args_default_is_empty() {
        let args = ModifyLabelsArgs::default();
        assert!(args.account_id.is_empty());
        assert!(args.message_id.is_empty());
        assert!(args.add_label_ids.is_empty());
        assert!(args.remove_label_ids.is_empty());
    }

    #[test]
    fn modify_labels_args_multiple_add_labels() {
        let args = ModifyLabelsArgs {
            account_id: "user@test.com".to_string(),
            message_id: "msgMulti".to_string(),
            add_label_ids: vec!["LABEL_STARRED".to_string(), "LABEL_IMPORTANT".to_string()],
            remove_label_ids: vec![],
        };
        let json = serde_json::to_value(&args).unwrap();
        let add_arr = json["addLabelIds"].as_array().unwrap();
        assert_eq!(add_arr.len(), 2);
        assert_eq!(add_arr[0], "LABEL_STARRED");
        assert_eq!(add_arr[1], "LABEL_IMPORTANT");
    }

    // --- ModifyLabelsResponse serialization tests ---
    #[test]
    fn modify_labels_response_serializes() {
        let resp = ModifyLabelsResponse {
            success: true,
            message_id: "msg123".to_string(),
        };
        let json = serde_json::to_value(&resp).unwrap();
        assert_eq!(json["success"], true);
        assert_eq!(json["messageId"], "msg123");
    }

    #[test]
    fn modify_labels_response_serializes_with_camel_case() {
        let resp = ModifyLabelsResponse {
            success: true,
            message_id: "abc".to_string(),
        };
        let json_str = serde_json::to_string(&resp).unwrap();
        assert!(json_str.contains("success"));
        assert!(json_str.contains("messageId"));
    }

    // --- SendEmailArgs serialization tests (CC/BCC) ---
    #[test]
    fn send_email_args_with_cc() {
        let args = SendEmailArgs {
            account_id: "user@test.com".to_string(),
            to: "to@example.com".to_string(),
            subject: "Hello".to_string(),
            body: "<p>Hi</p>".to_string(),
            cc: Some("cc@example.com".to_string()),
            bcc: None,
            attachments: Vec::new(),
        };
        let json = serde_json::to_value(&args).unwrap();
        assert_eq!(json["cc"], "cc@example.com");
        assert!(json["bcc"].is_null());
    }

    #[test]
    fn send_email_args_with_bcc() {
        let args = SendEmailArgs {
            account_id: "user@test.com".to_string(),
            to: "to@example.com".to_string(),
            subject: "Test".to_string(),
            body: "<p>Body</p>".to_string(),
            cc: None,
            bcc: Some("bcc@example.com".to_string()),
            attachments: Vec::new(),
        };
        let json = serde_json::to_value(&args).unwrap();
        assert!(json["cc"].is_null());
        assert_eq!(json["bcc"], "bcc@example.com");
    }

    #[test]
    fn send_email_args_with_both_cc_bcc() {
        let args = SendEmailArgs {
            account_id: "user@test.com".to_string(),
            to: "to@example.com".to_string(),
            subject: "Multi".to_string(),
            body: "<p>Hi</p>".to_string(),
            cc: Some("cc@example.com".to_string()),
            bcc: Some("bcc@example.com".to_string()),
            attachments: Vec::new(),
        };
        let json = serde_json::to_value(&args).unwrap();
        assert_eq!(json["cc"], "cc@example.com");
        assert_eq!(json["bcc"], "bcc@example.com");
    }

    // --- AttachmentInfo serialization tests ---
    #[test]
    fn attachment_info_serializes_pdf() {
        let att = AttachmentInfo {
            filename: "report.pdf".to_string(),
            mime_type: "application/pdf".to_string(),
            size_bytes: 1024 * 512,
            data: Some("base64data".to_string()),
        };
        let json = serde_json::to_value(&att).unwrap();
        assert_eq!(json["filename"], "report.pdf");
        assert_eq!(json["mimeType"], "application/pdf");
        assert_eq!(json["sizeBytes"], 1024 * 512);
        assert_eq!(json["data"], "base64data");
    }

    #[test]
    fn attachment_info_serializes_without_data() {
        let att = AttachmentInfo {
            filename: "large.zip".to_string(),
            mime_type: "application/zip".to_string(),
            size_bytes: 1024 * 1024 * 50,
            data: None,
        };
        let json = serde_json::to_value(&att).unwrap();
        assert!(json.get("data").is_none()); // skip_serializing_if = "Option::is_none"
    }

    #[test]
    fn message_detail_with_empty_attachments_skips_field() {
        let detail = MessageDetail {
            id: "msg123".to_string(),
            snippet: "Test email".to_string(),
            subject: "Hello".to_string(),
            from: "sender@example.com".to_string(),
            date: "Mon, 1 Jan 2024".to_string(),
            body: "<p>Hi</p>".to_string(),
            attachments: vec![],
        };
        let json_str = serde_json::to_string(&detail).unwrap();
        // Empty attachments should be skipped due to skip_serializing_if
        assert!(!json_str.contains("attachments"));
    }

    #[test]
    fn message_detail_with_attachments_includes_field() {
        let detail = MessageDetail {
            id: "msg456".to_string(),
            snippet: "Email with attachment".to_string(),
            subject: "Report".to_string(),
            from: "bot@example.com".to_string(),
            date: "Tue, 2 Jan 2024".to_string(),
            body: "<p>See attached</p>".to_string(),
            attachments: vec![AttachmentInfo {
                filename: "data.csv".to_string(),
                mime_type: "text/csv".to_string(),
                size_bytes: 2048,
                data: Some("aGVsbG8=".to_string()),
            }],
        };
        let json_str = serde_json::to_string(&detail).unwrap();
        assert!(json_str.contains("attachments"));
        assert!(json_str.contains("data.csv"));
    }

    // --- MIME multipart building tests ---
    #[test]
    fn infer_mime_type_pdf() {
        assert_eq!(infer_mime_type("document.pdf"), "application/pdf");
    }

    #[test]
    fn infer_mime_type_image() {
        assert_eq!(infer_mime_type("photo.png"), "image/png");
        assert_eq!(infer_mime_type("photo.jpg"), "image/jpeg");
        assert_eq!(infer_mime_type("photo.jpeg"), "image/jpeg");
        assert_eq!(infer_mime_type("image.gif"), "image/gif");
    }

    #[test]
    fn infer_mime_type_text() {
        assert_eq!(infer_mime_type("notes.txt"), "text/plain; charset=UTF-8");
        assert_eq!(infer_mime_type("data.csv"), "text/csv; charset=UTF-8");
    }

    #[test]
    fn infer_mime_type_archive() {
        assert_eq!(infer_mime_type("archive.zip"), "application/zip");
        assert_eq!(infer_mime_type("backup.tar"), "application/x-tar");
    }

    #[test]
    fn infer_mime_type_unknown_extension() {
        assert_eq!(infer_mime_type("file.xyz"), "application/octet-stream");
        assert_eq!(infer_mime_type("noext"), "application/octet-stream");
    }

    #[test]
    fn build_multipart_message_no_attachments() {
        let msg = build_multipart_message("to@test.com", "Subject", "Body", None, None, &[]);
        assert!(msg.contains("To: to@test.com"));
        assert!(msg.contains("Subject: Subject"));
        assert!(!msg.contains("Cc:"));
        assert!(!msg.contains("Bcc:"));
    }

    #[test]
    fn build_multipart_message_with_cc_bcc() {
        let msg = build_multipart_message(
            "to@test.com",
            "Subject",
            "Body",
            Some("cc@test.com"),
            Some("bcc@test.com"),
            &[],
        );
        assert!(msg.contains("Cc: cc@test.com"));
        assert!(msg.contains("Bcc: bcc@test.com"));
    }

    #[test]
    fn build_multipart_message_with_attachment() {
        let attachments = vec![SendAttachment {
            filename: "test.pdf".to_string(),
            mime_type: "".to_string(),
            data: "dGVzdCBkYXRh".to_string(),
        }];
        let msg = build_multipart_message(
            "to@test.com",
            "Subject",
            "<p>Body</p>",
            None,
            None,
            &attachments,
        );
        assert!(msg.contains("multipart/mixed"));
        assert!(msg.contains("Content-Type: application/pdf"));
        assert!(msg.contains("Content-Disposition: attachment; filename=\"test.pdf\""));
        assert!(msg.contains("dGVzdCBkYXRh"));
    }

    #[test]
    fn build_multipart_message_with_custom_mime_type() {
        let attachments = vec![SendAttachment {
            filename: "file.txt".to_string(),
            mime_type: "application/custom".to_string(),
            data: "data".to_string(),
        }];
        let msg = build_multipart_message(
            "to@test.com",
            "Subject",
            "<p>Body</p>",
            None,
            None,
            &attachments,
        );
        assert!(msg.contains("Content-Type: application/custom"));
    }

    #[test]
    fn generate_boundary_is_valid() {
        let boundary = generate_boundary();
        assert!(boundary.starts_with("----=_Part_"));
    }

    // --- ListMessagesArgs serialization tests ---
    #[test]
    fn list_messages_args_with_query_serializes() {
        let args = ListMessagesArgs {
            account_id: "user@test.com".to_string(),
            page_token: None,
            max_results: Some(20),
            label_id: None,
            query: Some("from:boss important".to_string()),
        };
        let json = serde_json::to_value(&args).unwrap();
        assert_eq!(json["accountId"], "user@test.com");
        assert_eq!(json["query"], "from:boss important");
        assert_eq!(json["maxResults"], 20);
    }

    #[test]
    fn list_messages_args_without_query_defaults() {
        let args = ListMessagesArgs::default();
        assert!(args.query.is_none());
        let json = serde_json::to_value(&args).unwrap();
        // Default values are omitted due to #[serde(default)]
        assert!(json.get("query").is_none() || json["query"].is_null());
    }
}
