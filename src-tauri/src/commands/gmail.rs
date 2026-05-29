use serde::{Deserialize, Serialize};
use crate::commands::auth::{get_access_token_for, refresh_access_token_for};
use crate::error::AppError;
use reqwest::Client;

#[derive(Debug, Serialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct GmailMessageSummary {
    pub id: String,
    pub thread_id: String,
    pub subject: String,
    pub from: String,
    pub date: String,
    pub snippet: String,
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
pub struct MessageDetail {
    pub id: String,
    pub snippet: String,
    pub subject: String,
    pub from: String,
    pub date: String,
    pub body: String,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ListMessagesArgs {
    pub account_id: String,
    pub page_token: Option<String>,
    pub max_results: Option<u32>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct MessageDetailArgs {
    pub account_id: String,
    pub message_id: String,
}

async fn get_valid_token(account_id: &str) -> Result<String, AppError> {
    get_access_token_for(account_id)?
        .ok_or_else(|| AppError::AuthError("No access token found. Please login first.".to_string()))
}

fn is_url_char(c: char) -> bool {
    c.is_alphanumeric()
        || "-._~:/?#[]@!$&'()*+,=%".contains(c)
}

/// Measure byte length of valid URL characters starting from the beginning of `s`
fn valid_url_len(s: &str) -> usize {
    let bytes = s.as_bytes();
    let mut len = 0;
    while len < bytes.len() {
        if !s[..len].is_char_boundary(len) { return len; }
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
) -> Option<(String, String, String, String)> {
    let url = format!(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/{}?format=metadata",
        msg_id
    );

    let response = client
        .get(&url)
        .bearer_auth(token)
        .send()
        .await;

    let response = match response {
        Ok(r) => r,
        Err(e) => {
            println!("[gmail] fetch_meta {} error: {}", msg_id, e);
            return None;
        }
    };

    if !response.status().is_success() {
        println!("[gmail] fetch_meta {} status: {}", msg_id, response.status());
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
            println!("[gmail] fetch_meta {} headers count: {}", msg_id, headers.len());
            let mut has_subject = false;
            let mut has_from = false;
            let mut has_date = false;
            for h in headers.iter() {
                if let (Some(name), Some(value)) = (h.get("name").and_then(|n| n.as_str()), h.get("value").and_then(|v| v.as_str())) {
                    match name {
                        "Subject" => { has_subject = true; println!("  [Subject] = {}", value); }
                        "From" => { has_from = true; println!("  [From] = {}", value); }
                        "Date" => { has_date = true; println!("  [Date] = {}", value); }
                        _ => { println!("  [{}]", name); }
                    }
                }
            }
            println!("[gmail] fetch_meta {} S={} F={} D={}", msg_id, has_subject, has_from, has_date);
        } else {
            println!("[gmail] fetch_meta {} NO headers in payload", msg_id);
        }
        // Also check nested parts for headers
        if let Some(parts) = payload.get("parts").and_then(|p| p.as_array()) {
            println!("[gmail] fetch_meta {} parts count: {}", msg_id, parts.len());
            for (i, part) in parts.iter().enumerate() {
                if let Some(headers) = part.get("headers").and_then(|h| h.as_array()) {
                    println!("[gmail] fetch_meta {} part[{}] has {} headers", msg_id, i, headers.len());
                    for h in headers.iter() {
                        if let (Some(name), Some(value)) = (h.get("name").and_then(|n| n.as_str()), h.get("value").and_then(|v| v.as_str())) {
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

    println!("[gmail] fetch_meta {} result: subject='{}' from='{}' date='{}'", msg_id, subject, from, date);

    Some((subject, from, date, snippet))
}

#[tauri::command]
pub async fn list_messages(
    account_id: String,
    page_token: Option<String>,
    max_results: Option<u32>,
) -> Result<ListMessagesResponse, AppError> {
    let max_results = max_results.unwrap_or(20);
    let client = Client::new();
    println!("[gmail] list_messages: account_id={}, page_token={:?}, max_results={}", account_id, page_token, max_results);
    let mut token = get_valid_token(&account_id).await?;

    let do_list_request = |token: &str, page_token: Option<&str>| {
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
        request.send()
    };

    let mut response = do_list_request(&token, page_token.as_deref()).await.map_err(AppError::from)?;

    if response.status() == 401 {
        println!("[gmail] 401 received, refreshing token for {}", account_id);
        token = refresh_access_token_for(&account_id).await?;
        response = do_list_request(&token, page_token.as_deref()).await.map_err(AppError::from)?;
        if response.status() == 401 {
            println!("[gmail] still 401 after token refresh for {} - credentials may be invalid", account_id);
            let error_text = response.text().await.map_err(AppError::from)?;
            return Err(AppError::AuthError(format!("認証が無効です。アカウントを再設定してください。Gmail: {}", error_text)));
        }
    }

    if !response.status().is_success() {
        let error_text = response.text().await.map_err(AppError::from)?;
        return Err(AppError::ApiError(format!("Gmail API error: {}", error_text)));
    }

    // Parse response manually via serde_json::Value for robustness against Gmail API shape changes
    let json: serde_json::Value = response.json().await.map_err(AppError::from)?;

    // Extract message IDs from the messages array
    let raw_messages: &[serde_json::Value] = json.get("messages")
        .and_then(|m| m.as_array())
        .map(|v| v.as_slice())
        .unwrap_or(&[]);

    let message_ids: Vec<String> = raw_messages
        .iter()
        .filter_map(|m| m.get("id").and_then(|id| id.as_str()).map(|s| s.to_string()))
        .collect();

    // Build summary list with default fields, then enrich
    let mut messages: Vec<GmailMessageSummary> = raw_messages
        .iter()
        .filter_map(|m| {
            let id_str = m.get("id").and_then(|v| v.as_str())?;
            let thread_id_str = m.get("threadId").and_then(|v| v.as_str()).unwrap_or("").to_string();
            Some(GmailMessageSummary {
                id: id_str.to_string(),
                thread_id: thread_id_str,
                subject: String::new(),
                from: String::new(),
                date: String::new(),
                snippet: String::new(),
            })
        })
        .collect();

    println!("[gmail] Found {} message IDs, fetching metadata", message_ids.len());

    // Fetch metadata for each message
    let mut enriched_count = 0;
    for msg_id in &message_ids {
        if let Some((subject, from, date, snippet)) = fetch_message_meta(&client, &token, msg_id).await {
            let id_str = msg_id.as_str();
            if let Some(m) = messages.iter_mut().find(|msg| msg.id.as_str() == id_str) {
                m.subject = subject;
                m.from = from;
                m.date = date;
                m.snippet = snippet;
                enriched_count += 1;
            }
        }
    }

    println!("[gmail] Enriched {} of {} messages", enriched_count, message_ids.len());

    // Extract and normalize nextPageToken (empty string → None)
    let next_page_token = json.get("nextPageToken")
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
    account_id: String,
    message_id: String,
) -> Result<MessageDetail, AppError> {
    let client = Client::new();
    let url = format!("https://gmail.googleapis.com/gmail/v1/users/me/messages/{}", message_id);
    let mut token = get_valid_token(&account_id).await?;

    let mut response = client
        .get(&url)
        .bearer_auth(&token)
        .send()
        .await
        .map_err(AppError::from)?;

    if response.status() == 401 {
        println!("[gmail] 401 received, refreshing token for {}", account_id);
        token = refresh_access_token_for(&account_id).await?;
        response = client
            .get(&url)
            .bearer_auth(&token)
            .send()
            .await
            .map_err(AppError::from)?;
        if response.status() == 401 {
            println!("[gmail] still 401 after token refresh for {} - credentials may be invalid", account_id);
            let error_text = response.text().await.map_err(AppError::from)?;
            return Err(AppError::AuthError(format!("認証が無効です。アカウントを再設定してください。Gmail: {}", error_text)));
        }
    }

    if !response.status().is_success() {
        let error_text = response.text().await.map_err(AppError::from)?;
        return Err(AppError::ApiError(format!("Gmail API error: {}", error_text)));
    }

    let json: serde_json::Value = response
        .json()
        .await
        .map_err(AppError::from)?;

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

    fn search_parts(part: &serde_json::Value, text_ref: &mut String, html_ref: &mut String, cids: &mut Vec<(String, String)>) {
        let mime = part["mimeType"].as_str().unwrap_or("unknown");

        // Extract Content-ID and charset from headers
        let (content_id, charset) = if let Some(headers) = part["headers"].as_array() {
            let (mut cid, mut cs): (Option<String>, Option<String>) = (None, None);
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
                                .map(|s| s.trim_matches(|c| c == '"' || c == '\'').trim().to_string())
                        });
                    }
                    _ => {}
                }
            }
            (cid, cs)
        } else {
            (None, None)
        };

        if let Some(data) = part["body"]["data"].as_str() {
            let mime_type = part["mimeType"].as_str().unwrap_or("");

            // Gmail API uses URL-safe base64 without padding, but some messages
            // may have padding or use standard base64. Try multiple strategies.
            let decoded_bytes = base64::Engine::decode(
                &base64::engine::general_purpose::URL_SAFE_NO_PAD, data
            ).or_else(|_| {
                let stripped = data.trim_end_matches('=');
                base64::Engine::decode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, stripped)
            }).or_else(|_| {
                base64::Engine::decode(&base64::engine::general_purpose::STANDARD, data)
            }).or_else(|_| {
                let stripped = data.trim_end_matches('=');
                base64::Engine::decode(&base64::engine::general_purpose::STANDARD_NO_PAD, stripped)
            });

            if let Ok(decoded) = decoded_bytes {
                if mime_type.starts_with("text/") {
                    let charset_ref = encoding_rs::Encoding::for_label(
                        charset.as_ref()
                            .map(|s| s.as_bytes())
                            .unwrap_or(b"utf-8")
                    ).unwrap_or(encoding_rs::UTF_8);
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
                        let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &decoded);
                        let data_uri = format!("data:{};base64,{}", mime_type, b64);
                        cids.push((cid.clone(), data_uri));
                    }
                }
            }
        }
        if let Some(parts) = part["parts"].as_array() {
            for subpart in parts {
                search_parts(subpart, text_ref, html_ref, cids);
            }
        }
    }

    search_parts(payload, &mut text_body, &mut html_body, &mut cid_map);

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
    })
}
