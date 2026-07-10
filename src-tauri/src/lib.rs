use serde::Deserialize;
use std::collections::HashMap;
use tauri::image::Image;
use tauri::menu::{MenuBuilder, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Listener, LogicalSize, Manager, PhysicalPosition, Runtime, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_updater::UpdaterExt;

mod tray_icon_rgba;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Sub2apiRequest {
    url: String,
    headers: HashMap<String, String>,
    method: Option<String>,
    body: Option<serde_json::Value>,
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![sub2api_request])
        .setup(|app| {
            let handle = app.handle().clone();
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_always_on_top(true);
                let _ = window.set_decorations(false);
                let _ = window.set_shadow(false);
                let _ = window.set_size(LogicalSize::new(184.0, 132.0));
                let _ = window.show();
            }

            let show_monitor_item = MenuItem::with_id(app, "show_monitor", "显示监控面板", true, None::<&str>)?;
            let settings_item = MenuItem::with_id(app, "open_settings", "设置", true, None::<&str>)?;
            let check_update_item = MenuItem::with_id(app, "check_update", "检查更新", true, None::<&str>)?;
            let version_item = MenuItem::with_id(app, "version", format!("当前版本 v{}", env!("CARGO_PKG_VERSION")), false, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "退出 Token Orb", true, None::<&str>)?;
            let menu = MenuBuilder::new(app)
                .item(&show_monitor_item)
                .item(&settings_item)
                .item(&check_update_item)
                .item(&version_item)
                .separator()
                .item(&quit_item)
                .build()?;

            let event_check_update_item = check_update_item.clone();
            let event_version_item = version_item.clone();
            app.listen("token-orb-update-status", move |event| {
                set_tray_update_status(&event_check_update_item, &event_version_item, read_update_available(event.payload()));
            });

            let startup_check_update_item = check_update_item.clone();
            let startup_version_item = version_item.clone();
            let startup_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Ok(updater) = startup_handle.updater() {
                    if let Ok(update) = updater.check().await {
                        set_tray_update_status(&startup_check_update_item, &startup_version_item, update.is_some());
                    }
                }
            });

            TrayIconBuilder::with_id("main")
                .menu(&menu)
                .icon(Image::new(
                    tray_icon_rgba::TRAY_ICON_RGBA,
                    tray_icon_rgba::TRAY_ICON_WIDTH,
                    tray_icon_rgba::TRAY_ICON_HEIGHT,
                ))
                .show_menu_on_left_click(false)
                .tooltip("Token Orb")
                .on_menu_event(move |app, event| match event.id().as_ref() {
                    "show_monitor" => toggle_monitor(app, None),
                    "open_settings" => open_settings(app),
                    "check_update" => open_update_window(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(move |_tray, event| {
                    if let TrayIconEvent::Click {
                        button,
                        button_state,
                        rect,
                        ..
                    } = event
                    {
                        if button == MouseButton::Left && button_state == MouseButtonState::Up {
                            toggle_monitor(&handle, tray_anchor(&rect));
                        }
                    }
                })
                .build(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running token orb");
}

#[tauri::command]
async fn sub2api_request(request: Sub2apiRequest) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let method = request.method.as_deref().unwrap_or("GET").to_ascii_uppercase();
    let mut builder = match method.as_str() {
        "POST" => client.post(&request.url),
        "GET" => client.get(&request.url),
        _ => return Err(format!("sub2api 不支持的请求方法: {method}")),
    };

    for (key, value) in request.headers {
        builder = builder.header(key, value);
    }
    if let Some(body) = request.body {
        builder = builder.json(&body);
    }

    let response = builder
        .send()
        .await
        .map_err(|error| format!("sub2api 请求失败: {error}"))?;
    let status = response.status();

    if !status.is_success() {
        let detail = response.text().await.unwrap_or_default();
        return Err(format_sub2api_http_error(status.as_u16(), &detail));
    }

    response
        .json::<serde_json::Value>()
        .await
        .map_err(|error| format!("sub2api 响应解析失败: {error}"))
}

fn format_sub2api_http_error(status: u16, detail: &str) -> String {
    let message = read_sub2api_error_detail(detail);
    if status == 401 || status == 403 {
        if message.is_empty() {
            return format!("认证失败，Token 错误或已失效（HTTP {status}）");
        }
        return format!("认证失败，Token 错误或已失效：{message}");
    }

    if message.is_empty() {
        return format!("sub2api 请求失败: HTTP {status}");
    }
    format!("sub2api 请求失败（HTTP {status}）：{message}")
}

fn read_sub2api_error_detail(detail: &str) -> String {
    let trimmed = detail.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    if let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) {
        if let Some(message) = read_error_message(&value) {
            return message;
        }
    }

    trimmed.to_string()
}

fn read_error_message(value: &serde_json::Value) -> Option<String> {
    if let Some(message) = value.as_str().map(str::trim).filter(|message| !message.is_empty()) {
        return Some(message.to_string());
    }

    let object = value.as_object()?;
    for key in ["message", "error", "detail", "msg"] {
        if let Some(message) = object.get(key).and_then(read_error_message) {
            return Some(message);
        }
    }
    None
}

fn read_update_available(payload: &str) -> bool {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(payload) else {
        return false;
    };

    value
        .as_bool()
        .or_else(|| value.get("available").and_then(serde_json::Value::as_bool))
        .unwrap_or(false)
}

fn set_tray_update_status<R: Runtime>(check_update_item: &MenuItem<R>, version_item: &MenuItem<R>, available: bool) {
    if available {
        let _ = check_update_item.set_text("有版本更新");
        let _ = version_item.set_text(format!("当前版本 v{} · 有版本更新", env!("CARGO_PKG_VERSION")));
        return;
    }

    let _ = check_update_item.set_text("检查更新");
    let _ = version_item.set_text(format!("当前版本 v{}", env!("CARGO_PKG_VERSION")));
}

fn toggle_monitor<R: Runtime>(app: &AppHandle<R>, anchor: Option<PhysicalPosition<i32>>) {
    if let Some(window) = app.get_webview_window("platform") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            position_monitor(&window, anchor);
            let _ = window.show();
            let _ = window.set_focus();
        }
        return;
    }

    let window = WebviewWindowBuilder::new(app, "platform", WebviewUrl::App("index.html?view=platform".into()))
        .title("Token Orb 平台信息")
        .inner_size(370.0, 300.0)
        .resizable(false)
        .decorations(false)
        .transparent(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .shadow(false)
        .build();

    if let Ok(window) = window {
        position_monitor(&window, anchor);
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn open_settings<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("settings") {
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }

    let _ = WebviewWindowBuilder::new(app, "settings", WebviewUrl::App("index.html?view=settings".into()))
        .title("Token Orb 设置")
        .inner_size(390.0, 570.0)
        .resizable(false)
        .decorations(true)
        .always_on_top(true)
        .build();
}

fn open_update_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("updater") {
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.emit("token-orb-check-update", ());
        return;
    }

    let window = WebviewWindowBuilder::new(app, "updater", WebviewUrl::App("index.html?view=updater".into()))
        .title("Token Orb 更新")
        .inner_size(420.0, 360.0)
        .resizable(false)
        .decorations(true)
        .always_on_top(true)
        .build();

    if let Ok(window) = window {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn position_monitor<R: Runtime>(window: &WebviewWindow<R>, anchor: Option<PhysicalPosition<i32>>) {
    if let Some(anchor) = anchor {
        let x = anchor.x - 185;
        let y = anchor.y + 8;
        let _ = window.set_position(PhysicalPosition::new(x.max(8), y.max(8)));
        return;
    }

    if let Ok(Some(monitor)) = window.current_monitor() {
        let size = monitor.size();
        let position = monitor.position();
        let x = position.x + size.width as i32 - 410;
        let y = position.y + 32;
        let _ = window.set_position(PhysicalPosition::new(x, y));
    }
}

fn tray_anchor(rect: &tauri::Rect) -> Option<PhysicalPosition<i32>> {
    match rect.position {
        tauri::Position::Physical(position) => Some(PhysicalPosition::new(position.x, position.y)),
        tauri::Position::Logical(position) => Some(PhysicalPosition::new(position.x as i32, position.y as i32)),
    }
}
