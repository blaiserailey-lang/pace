//! Sign-in for Google Calendar and Spotify, and a small bridge for their APIs.
//!
//! Desktop OAuth with PKCE: we open the browser, catch the redirect on a loopback port, and swap the
//! code for tokens. The refresh token goes in the macOS Keychain; access tokens only live in memory.
//! The web view never sees a token: it asks `api_request` to call an allow-listed API on its behalf.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::sync::{mpsc, Mutex};
use std::time::{Duration, Instant};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

pub const REDIRECT_PORT: u16 = 53682;
pub const REDIRECT_URI: &str = "http://127.0.0.1:53682/callback";
const KEYCHAIN_SERVICE: &str = "com.blaiserailey.pace";

struct ProviderInfo {
    auth_url: &'static str,
    token_url: &'static str,
    extra: &'static [(&'static str, &'static str)],
}

/// "google:2" is a second Google account: same provider, its own Keychain entry and tokens.
fn kind(name: &str) -> &str {
    name.split(':').next().unwrap_or(name)
}

fn provider(name: &str) -> Result<ProviderInfo, String> {
    match kind(name) {
        "google" => Ok(ProviderInfo {
            auth_url: "https://accounts.google.com/o/oauth2/v2/auth",
            token_url: "https://oauth2.googleapis.com/token",
            // Ask for a refresh token every time so reconnecting always works.
            extra: &[("access_type", "offline"), ("prompt", "consent")],
        }),
        "spotify" => Ok(ProviderInfo {
            auth_url: "https://accounts.spotify.com/authorize",
            token_url: "https://accounts.spotify.com/api/token",
            extra: &[],
        }),
        _ => Err(format!("Unknown provider {name}")),
    }
}

/// Only these APIs can be called through the bridge.
pub fn allowed_url(provider: &str, url: &str) -> bool {
    let prefixes: &[&str] = match kind(provider) {
        "google" => &["https://www.googleapis.com/calendar/v3/"],
        "spotify" => &["https://api.spotify.com/v1/"],
        _ => &[],
    };
    prefixes.iter().any(|p| url.starts_with(p))
}

#[derive(Serialize, Deserialize, Clone)]
struct Saved {
    client_id: String,
    #[serde(default)]
    client_secret: Option<String>,
    refresh_token: String,
}

#[derive(Default)]
pub struct Tokens(Mutex<HashMap<String, (String, Instant)>>);

fn keychain(provider: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYCHAIN_SERVICE, provider).map_err(|e| e.to_string())
}
fn load(provider: &str) -> Option<Saved> {
    let raw = keychain(provider).ok()?.get_password().ok()?;
    serde_json::from_str(&raw).ok()
}
fn store(provider: &str, saved: &Saved) -> Result<(), String> {
    keychain(provider)?.set_password(&serde_json::to_string(saved).unwrap()).map_err(|e| e.to_string())
}

pub fn enc(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}
fn dec(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'+' => out.push(b' '),
            b'%' if i + 2 < b.len() => {
                if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                    out.push(v);
                    i += 2;
                } else {
                    out.push(b'%');
                }
            }
            c => out.push(c),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

pub fn pkce_challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}
fn random_string(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    getrandom::getrandom(&mut buf).expect("system randomness");
    URL_SAFE_NO_PAD.encode(buf)
}

/// Parses `GET /callback?code=..&state=.. HTTP/1.1` into its query pairs.
pub fn parse_callback(request_line: &str) -> Option<HashMap<String, String>> {
    let target = request_line.split_whitespace().nth(1)?;
    let (path, query) = target.split_once('?').unwrap_or((target, ""));
    if path != "/callback" {
        return None;
    }
    Some(
        query
            .split('&')
            .filter(|p| !p.is_empty())
            .map(|p| {
                let (k, v) = p.split_once('=').unwrap_or((p, ""));
                (dec(k), dec(v))
            })
            .collect(),
    )
}

fn open_browser(url: &str) {
    #[cfg(target_os = "macos")]
    let _ = std::process::Command::new("open").arg(url).spawn();
    #[cfg(target_os = "windows")]
    let _ = std::process::Command::new("cmd").args(["/C", "start", "", url]).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let _ = std::process::Command::new("xdg-open").arg(url).spawn();
}

/// Waits for the browser to come back to the loopback port with a code.
fn wait_for_code(listener: TcpListener, state: String) -> Result<String, String> {
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { continue };
            let mut line = String::new();
            let _ = BufReader::new(&stream).read_line(&mut line);
            let Some(q) = parse_callback(&line) else {
                let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n");
                continue;
            };
            let ok = q.get("state") == Some(&state) && q.contains_key("code");
            let msg = if ok { "You're connected. You can close this tab and go back to BLOB." } else { "Sign-in didn't finish. Go back to BLOB and try again." };
            let body = format!("<!doctype html><meta charset=utf-8><title>BLOB</title><body style=\"font:16px system-ui;background:#05060a;color:#fff;display:grid;place-items:center;height:100vh;margin:0\"><p>{msg}</p>");
            let _ = stream.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).as_bytes());
            let result = if ok {
                Ok(q["code"].clone())
            } else {
                Err(q.get("error").cloned().unwrap_or_else(|| "Sign-in was cancelled".into()))
            };
            let _ = tx.send(result);
            break;
        }
    });
    rx.recv_timeout(Duration::from_secs(300)).map_err(|_| "Sign-in timed out. Try again.".to_string())?
}

fn post_form(url: &str, form: &[(&str, &str)]) -> Result<Value, String> {
    match ureq::post(url).timeout(Duration::from_secs(20)).send_form(form) {
        Ok(r) => serde_json::from_str(&r.into_string().map_err(|e| e.to_string())?).map_err(|e| e.to_string()),
        Err(ureq::Error::Status(code, r)) => Err(format!("{code}: {}", r.into_string().unwrap_or_default())),
        Err(e) => Err(e.to_string()),
    }
}

fn remember(tokens: &Tokens, provider: &str, v: &Value) -> Result<String, String> {
    let access = v["access_token"].as_str().ok_or("No access token in the response")?.to_string();
    let ttl = v["expires_in"].as_u64().unwrap_or(3600).saturating_sub(60);
    tokens.0.lock().unwrap().insert(provider.into(), (access.clone(), Instant::now() + Duration::from_secs(ttl)));
    Ok(access)
}

fn refresh(tokens: &Tokens, provider_name: &str) -> Result<String, String> {
    let p = provider(provider_name)?;
    let saved = load(provider_name).ok_or("Not connected")?;
    let mut form = vec![("grant_type", "refresh_token"), ("refresh_token", saved.refresh_token.as_str()), ("client_id", saved.client_id.as_str())];
    if let Some(s) = saved.client_secret.as_deref() {
        form.push(("client_secret", s));
    }
    let v = post_form(p.token_url, &form)?;
    // Spotify may rotate the refresh token.
    if let Some(rt) = v["refresh_token"].as_str() {
        store(provider_name, &Saved { refresh_token: rt.into(), ..saved })?;
    }
    remember(tokens, provider_name, &v)
}

fn access_token(tokens: &Tokens, provider: &str) -> Result<String, String> {
    if let Some((t, exp)) = tokens.0.lock().unwrap().get(provider) {
        if Instant::now() < *exp {
            return Ok(t.clone());
        }
    }
    refresh(tokens, provider)
}

#[tauri::command]
pub async fn oauth_connect(
    tokens: tauri::State<'_, Tokens>,
    provider: String,
    client_id: String,
    client_secret: Option<String>,
    scopes: Vec<String>,
) -> Result<(), String> {
    let p = provider_info_owned(&provider)?;
    let client_id = client_id.trim().to_string();
    if client_id.is_empty() {
        return Err("Add a client ID first".into());
    }
    let client_secret = client_secret.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    let listener = TcpListener::bind(("127.0.0.1", REDIRECT_PORT)).map_err(|e| format!("Port {REDIRECT_PORT} is busy: {e}"))?;
    let verifier = random_string(48);
    let state = random_string(16);
    let mut url = format!(
        "{}?response_type=code&client_id={}&redirect_uri={}&scope={}&state={}&code_challenge={}&code_challenge_method=S256",
        p.0, enc(&client_id), enc(REDIRECT_URI), enc(&scopes.join(" ")), state, pkce_challenge(&verifier)
    );
    for (k, v) in p.2 {
        url.push_str(&format!("&{k}={}", enc(v)));
    }
    open_browser(&url);
    let code = tauri::async_runtime::spawn_blocking(move || wait_for_code(listener, state)).await.map_err(|e| e.to_string())??;
    let (token_url, cid, secret) = (p.1, client_id.clone(), client_secret.clone());
    let v = tauri::async_runtime::spawn_blocking(move || {
        let mut form = vec![
            ("grant_type", "authorization_code"),
            ("code", code.as_str()),
            ("redirect_uri", REDIRECT_URI),
            ("client_id", cid.as_str()),
            ("code_verifier", verifier.as_str()),
        ];
        if let Some(s) = secret.as_deref() {
            form.push(("client_secret", s));
        }
        post_form(token_url, &form)
    })
    .await
    .map_err(|e| e.to_string())??;
    let refresh_token = v["refresh_token"].as_str().ok_or("Google didn't send a refresh token. Disconnect BLOB in your Google account settings, then try again.")?;
    store(&provider, &Saved { client_id, client_secret, refresh_token: refresh_token.into() })?;
    remember(&tokens, &provider, &v)?;
    Ok(())
}

fn provider_info_owned(name: &str) -> Result<(&'static str, &'static str, &'static [(&'static str, &'static str)]), String> {
    let p = provider(name)?;
    Ok((p.auth_url, p.token_url, p.extra))
}

#[tauri::command]
pub fn oauth_status(provider: String) -> bool {
    load(&provider).is_some()
}

#[tauri::command]
pub fn oauth_disconnect(tokens: tauri::State<'_, Tokens>, provider: String) -> Result<(), String> {
    tokens.0.lock().unwrap().remove(&provider);
    match keychain(&provider)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// Calls an allow-listed API with the stored sign-in. Returns the JSON body, or null for empty replies.
#[tauri::command]
pub async fn api_request(
    tokens: tauri::State<'_, Tokens>,
    provider: String,
    method: String,
    url: String,
    body: Option<Value>,
) -> Result<Value, String> {
    if !allowed_url(&provider, &url) {
        return Err("That address isn't allowed".into());
    }
    let tokens: &Tokens = &tokens;
    // ureq is blocking; these calls are short and the command runs off the main thread.
    let mut retried = false;
    loop {
        let token = access_token(tokens, &provider)?;
        let req = ureq::request(&method, &url).timeout(Duration::from_secs(20)).set("Authorization", &format!("Bearer {token}"));
        let res = match &body {
            Some(b) => req.set("Content-Type", "application/json").send_string(&b.to_string()),
            None if method != "GET" => req.set("Content-Length", "0").call(),
            None => req.call(),
        };
        return match res {
            Ok(r) => {
                let text = r.into_string().map_err(|e| e.to_string())?;
                Ok(if text.trim().is_empty() { Value::Null } else { serde_json::from_str(&text).unwrap_or(Value::String(text)) })
            }
            Err(ureq::Error::Status(401, _)) if !retried => {
                retried = true;
                tokens.0.lock().unwrap().remove(&provider);
                continue;
            }
            Err(ureq::Error::Status(code, r)) => Err(format!("{code}: {}", r.into_string().unwrap_or_default())),
            Err(e) => Err(e.to_string()),
        };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pkce_matches_rfc_7636_example() {
        assert_eq!(pkce_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    }

    #[test]
    fn reads_the_callback() {
        let q = parse_callback("GET /callback?code=4%2F0Ab_x&state=abc&scope=a+b HTTP/1.1").unwrap();
        assert_eq!(q["code"], "4/0Ab_x");
        assert_eq!(q["state"], "abc");
        assert_eq!(q["scope"], "a b");
        assert!(parse_callback("GET /favicon.ico HTTP/1.1").is_none());
    }

    #[test]
    fn only_known_apis_are_reachable() {
        assert!(allowed_url("google", "https://www.googleapis.com/calendar/v3/calendars/primary/events"));
        assert!(!allowed_url("google", "https://gmail.googleapis.com/gmail/v1/users/me/messages"));
        assert!(allowed_url("spotify", "https://api.spotify.com/v1/me/player/play"));
        assert!(!allowed_url("google", "https://api.spotify.com/v1/me"));
        assert!(!allowed_url("spotify", "https://evil.example/v1/"));
        assert!(allowed_url("google:2", "https://www.googleapis.com/calendar/v3/users/me/calendarList"));
        assert!(provider("google:abc").is_ok());
        assert!(provider("dropbox").is_err());
    }

    #[test]
    fn encodes_for_urls() {
        assert_eq!(enc("a b/c:d"), "a%20b%2Fc%3Ad");
    }
}
