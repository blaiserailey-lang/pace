//! Native side of Pace.
//!
//! The web view owns the day plan and the on-screen clock. It reports the
//! current block to `sync_timer`, and this side keeps a wall-clock deadline so
//! the menu-bar countdown and the "time's up" notification keep working even
//! when the window is hidden and its timers are throttled.

use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, State, WindowEvent};
#[cfg(target_os = "macos")]
use tauri::RunEvent;
use tauri_plugin_notification::NotificationExt;

mod oauth;

const TRAY_ID: &str = "pace-tray";

#[derive(Default)]
struct Timer {
    running: bool,
    /// When the current block ends. `None` when no day is in progress.
    ends_at: Option<Instant>,
    /// Seconds left when paused, so the menu bar can keep showing it.
    paused_left: Option<u64>,
    label: String,
    next_title: String,
    next_body: String,
    notified: bool,
}

type Shared = Arc<Mutex<Timer>>;

#[tauri::command]
fn sync_timer(
    state: State<'_, Shared>,
    running: bool,
    remaining_s: f64,
    label: String,
    next_title: String,
    next_body: String,
) {
    let mut t = state.lock().unwrap();
    let left = Duration::from_secs_f64(remaining_s.max(0.0));
    t.running = running;
    t.label = label;
    t.next_title = next_title;
    t.next_body = next_body;
    if running {
        t.ends_at = Some(Instant::now() + left);
        t.paused_left = None;
        // A fresh block (or more time added) re-arms the alert.
        t.notified = left.is_zero();
    } else {
        t.ends_at = None;
        t.paused_left = if t.label.is_empty() { None } else { Some(left.as_secs()) };
    }
}

/// Downloads a calendar feed (the "secret address in iCal format") for the web view, which
/// can't fetch it itself because of browser cross-origin rules.
#[tauri::command]
async fn fetch_text(url: String) -> Result<String, String> {
    let url = url.trim().replacen("webcal://", "https://", 1);
    if !url.starts_with("https://") {
        return Err("Only https calendar links are supported".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        ureq::get(&url)
            .timeout(std::time::Duration::from_secs(20))
            .call()
            .map_err(|e| e.to_string())?
            .into_string()
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(serde::Serialize)]
struct UpdateInfo {
    current: String,
    version: Option<String>,
    notes: Option<String>,
}

/// Looks for a newer build published by CI. `version` is None when this one is the latest.
#[tauri::command]
async fn check_update(app: AppHandle) -> Result<UpdateInfo, String> {
    use tauri_plugin_updater::UpdaterExt;
    let current = app.package_info().version.to_string();
    let update = app.updater().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())?;
    Ok(UpdateInfo { current, version: update.as_ref().map(|u| u.version.clone()), notes: update.and_then(|u| u.body) })
}

/// Downloads the newer build, checks its signature, swaps it in, and restarts BLOB.
#[tauri::command]
async fn install_update(app: AppHandle) -> Result<(), String> {
    use tauri_plugin_updater::UpdaterExt;
    let update = app.updater().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())?;
    let Some(update) = update else { return Err("BLOB is already up to date".into()) };
    update.download_and_install(|_, _| {}, || {}).await.map_err(|e| e.to_string())?;
    app.restart();
}

fn fmt(secs: u64) -> String {
    format!("{:02}:{:02}", secs / 60, secs % 60)
}

/// Text shown next to the menu-bar icon.
fn tray_text(t: &Timer) -> String {
    match (t.running, t.ends_at, t.paused_left) {
        (true, Some(end), _) => {
            let left = end.saturating_duration_since(Instant::now()).as_secs();
            format!("{} {}", t.label, fmt(left))
        }
        (false, _, Some(left)) => format!("Paused {}", fmt(left)),
        _ => String::new(),
    }
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// Once a second: refresh the menu-bar countdown and fire the end-of-block alert.
fn start_ticker(app: AppHandle, state: Shared) {
    thread::spawn(move || {
        let mut last_text = String::from("\u{0}");
        loop {
            let (text, alert) = {
                let mut t = state.lock().unwrap();
                let mut alert = None;
                if let (true, Some(end)) = (t.running, t.ends_at) {
                    if !t.notified && Instant::now() >= end {
                        t.notified = true;
                        alert = Some((t.next_title.clone(), t.next_body.clone()));
                    }
                }
                (tray_text(&t), alert)
            };
            if text != last_text {
                if let Some(tray) = app.tray_by_id(TRAY_ID) {
                    let _ = tray.set_title(if text.is_empty() { None } else { Some(text.as_str()) });
                    let _ = tray.set_tooltip(Some(if text.is_empty() { "BLOB" } else { text.as_str() }));
                }
                last_text = text;
            }
            if let Some((title, body)) = alert {
                let _ = app.notification().builder().title(title).body(body).show();
            }
            thread::sleep(Duration::from_secs(1));
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state: Shared = Arc::new(Mutex::new(Timer::default()));

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(state.clone())
        .manage(oauth::Tokens::default())
        .invoke_handler(tauri::generate_handler![
            sync_timer,
            fetch_text,
            check_update,
            install_update,
            oauth::oauth_connect,
            oauth::oauth_status,
            oauth::oauth_disconnect,
            oauth::api_request
        ])
        .setup(move |app| {
            let show = MenuItem::with_id(app, "show", "Show BLOB", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit BLOB", true, Some("CmdOrCtrl+Q"))?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            let mut tray = TrayIconBuilder::with_id(TRAY_ID)
                .tooltip("BLOB")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show_main(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;

            // Ask for notification permission up front so the first alert isn't lost.
            let _ = app.notification().request_permission();

            start_ticker(app.handle().clone(), state.clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the window keeps the day running in the menu bar.
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building BLOB");

    app.run(|app, event| {
        #[cfg(target_os = "macos")]
        if let RunEvent::Reopen { .. } = event {
            show_main(app);
        }
        let _ = (app, event);
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tray_text_shows_running_paused_and_idle() {
        let mut t = Timer {
            running: true,
            ends_at: Some(Instant::now() + Duration::from_secs(125) + Duration::from_millis(500)),
            label: "Focus".into(),
            ..Default::default()
        };
        assert_eq!(tray_text(&t), "Focus 02:05");
        t.running = false;
        t.ends_at = None;
        t.paused_left = Some(61);
        assert_eq!(tray_text(&t), "Paused 01:01");
        assert_eq!(tray_text(&Timer::default()), "");
    }
}
